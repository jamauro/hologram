"use strict";

import App from "./app.mjs";
import ComponentRegistry from "./component_registry.mjs";
import GlobalRegistry from "./global_registry.mjs";
import Hologram from "./hologram.mjs";
import Interpreter from "./interpreter.mjs";
import Logger from "./logger.mjs";
import Serializer from "./serializer.mjs";
import Type from "./type.mjs";

export default class Sse {
  static BASE_RECONNECT_DELAY = 250;
  static HANDSHAKE_PATH = "/hologram/sse/handshake";
  static MAX_RECONNECT_DELAY = 5_000;
  static RECONNECT_BACKOFF_FACTOR = 2;
  static RECONNECT_JITTER = 0.25;
  static SSE_PATH = "/hologram/sse";

  static eventSource = null;
  static reconnectAttempts = 0;
  static reconnectTimer = null;
  // Last connection status pushed to the UI (deduped) and whether the network observers are armed.
  static lastStatus = null;
  static networkListenersInstalled = false;

  // Exponential backoff with ±RECONNECT_JITTER noise. Mirrors the established
  // pattern in `Hologram.Connection` so consecutive SSE reconnect failures
  // don't hammer the handshake endpoint.
  static computeReconnectDelay(attempts) {
    const baseDelay = Math.min(
      $.BASE_RECONNECT_DELAY *
        Math.pow($.RECONNECT_BACKOFF_FACTOR, attempts - 1),
      $.MAX_RECONNECT_DELAY,
    );

    const jitterRange = baseDelay * $.RECONNECT_JITTER;

    return baseDelay + (Math.random() * 2 - 1) * jitterRange;
  }

  static buildHandshakePayload() {
    const receipts = Array.from(
      App.subscriptionReceiptRegistry.entries.values(),
    ).map((triple) => triple.data[2]);

    return Type.map([
      [Type.atom("instance_id"), Type.bitstring(App.instanceId)],
      [Type.atom("receipts"), Type.list(receipts)],
    ]);
  }

  static async connect() {
    $.installNetworkListeners();

    try {
      const preHandshakeReceiptCount =
        App.subscriptionReceiptRegistry.entries.size;

      const response = await fetch($.HANDSHAKE_PATH, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: Serializer.serialize($.buildHandshakePayload(), "server"),
      });

      if (!response.ok) {
        Logger.debug(`SSE handshake error: ${response.status}`);
        $.scheduleReconnect();
        return;
      }

      const {handshakeId, refreshedReceipts: encodedRefreshed} =
        await response.json();

      const refreshed =
        Interpreter.evaluateJavaScriptExpression(encodedRefreshed);

      if (preHandshakeReceiptCount > 0 && refreshed.data.length === 0) {
        window.location.reload();
        return;
      }

      App.subscriptionReceiptRegistry.merge(refreshed, Type.list());

      // Resume signal. On a *reconnect* (receipts already existed before this handshake),
      // the realtime stream is back after a gap, so each re-subscribed component may have
      // missed broadcasts while disconnected — dispatch a `resumed` action to it so it can
      // catch up. A first connect (preHandshakeReceiptCount === 0) has nothing to resume.
      // Receipts are `[channel, cid, token]`; the dispatcher is the symmetric partner to
      // `put_subscription` — the framework knows exactly who to notify.
      if (preHandshakeReceiptCount > 0) {
        for (const receipt of refreshed.data) {
          const cid = receipt.data[1];

          if (ComponentRegistry.isCidRegistered(cid)) {
            Hologram.scheduleAction(
              Type.actionStruct({
                name: Type.atom("resumed"),
                params: Type.map(),
                target: cid,
              }),
            );
          }
        }
      }

      const params = new URLSearchParams({
        instance_id: App.instanceId,
        handshake_id: handshakeId,
      });

      $.eventSource = new EventSource(`${$.SSE_PATH}?${params}`);

      $.eventSource.addEventListener("action", (event) => {
        const action = Interpreter.evaluateJavaScriptExpression(event.data);
        const target = Erlang_Maps["get/2"](Type.atom("target"), action);

        // Hologram realtime is fire-and-forget: silently drop actions
        // targeting cids that are not mounted on this client. Keeps the
        // dispatcher's strict contract intact for command responses (where
        // a missing cid is a real bug worth surfacing).
        if (!ComponentRegistry.isCidRegistered(target)) {
          return;
        }

        Hologram.scheduleAction(action);
      });

      $.eventSource.addEventListener("add_sub_receipts", (event) => {
        const receipts = Interpreter.evaluateJavaScriptExpression(event.data);
        App.subscriptionReceiptRegistry.merge(receipts, Type.list());
      });

      $.eventSource.addEventListener("broadcast", (event) => {
        const decoded = Interpreter.evaluateJavaScriptExpression(event.data);
        const [actionName, params, cidsList] = decoded.data;

        for (const cid of cidsList.data) {
          if (!ComponentRegistry.isCidRegistered(cid)) continue;

          const action = Type.actionStruct({
            name: actionName,
            params: params,
            target: cid,
          });

          Hologram.scheduleAction(action);
        }
      });

      $.eventSource.addEventListener("drop_sub_receipts", (event) => {
        const keys = Interpreter.evaluateJavaScriptExpression(event.data);
        App.subscriptionReceiptRegistry.purge(keys);
      });

      $.eventSource.addEventListener("refresh_sub_receipts", (event) => {
        const refreshed = Interpreter.evaluateJavaScriptExpression(event.data);
        App.subscriptionReceiptRegistry.merge(refreshed, Type.list());
      });

      $.eventSource.onopen = () => {
        $.reconnectAttempts = 0;
        $.setConnected(true);
      };

      // JS-driven reconnect: native EventSource auto-reconnect would re-use
      // the original URL with the now-stale single-use handshake_id and
      // produce a 4xx loop. Close the failed connection and re-run the
      // handshake protocol from scratch after an exponential backoff delay.
      // No retry cap: the receipt-expiry path inside `connect()` handles the
      // "give up and reload" case organically once stored receipts age out.
      $.eventSource.onerror = (event) => {
        Logger.debug(`SSE error: ${event.type}`);
        $.setConnected(false);
        $.eventSource.close();

        $.scheduleReconnect();
      };
    } catch (error) {
      Logger.debug(`SSE handshake error: ${error}`);
      $.scheduleReconnect();
    }
  }

  // Maintain the SSE-up flag (read elsewhere as the source of truth) and re-derive the UI status.
  // Called from onopen/onerror.
  static setConnected(value) {
    GlobalRegistry.set("sseConnected?", value);
    $.publishStatus();
  }

  // Connection status is the PRODUCT of two state machines the browser already runs: device network
  // reachability (`navigator.onLine`) and the SSE stream (`sseConnected?`). We only observe and
  // combine them — no polling, no heartbeat watchdog. Offline dominates: a down network makes the
  // stale stream flag meaningless, and "reconnecting" over no network would be a lie.
  static currentStatus() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    return GlobalRegistry.get("sseConnected?") === true ? "live" : "reconnecting";
  }

  // Push the derived status to the layout (always-mounted root, cid "layout") so connection-status
  // UI rides Hologram's normal render — no out-of-band DOM. Deduped, and only once the layout is
  // registered (executeAction would no-op an unknown cid anyway). This is the STATUS signal; the
  // orthogonal data CATCH-UP signal stays a per-subscribed-component `resumed` (see connect()).
  static publishStatus() {
    const status = $.currentStatus();

    if (status !== $.lastStatus && ComponentRegistry.isCidRegistered(Type.bitstring("layout"))) {
      $.lastStatus = status;
      Hologram.dispatchAction("connection_changed", "layout", {status});
    }
  }

  // Observe the device-network state machine. `offline` just re-derives status (→ "offline"). `online`
  // re-derives AND forces a clean re-handshake of the (possibly zombie) stream, reusing the existing
  // reconnect path — so missed broadcasts are caught up via `resumed` and status moves offline →
  // reconnecting → live deterministically, instead of depending on whether the socket happened to
  // survive. Armed once; guarded for the Node test env.
  static installNetworkListeners() {
    if ($.networkListenersInstalled || typeof window === "undefined" ||
        typeof window.addEventListener !== "function") return;
    $.networkListenersInstalled = true;

    window.addEventListener("offline", () => $.publishStatus());
    window.addEventListener("online", () => $.handleOnline());
  }

  static handleOnline() {
    if ($.eventSource) {
      $.eventSource.close();
      $.eventSource = null;
    }

    clearTimeout($.reconnectTimer);
    $.reconnectAttempts = 0;
    // Mark the stream down first so status shows "reconnecting" (network is back, stream isn't yet),
    // then re-handshake from scratch.
    $.setConnected(false);
    $.scheduleReconnect();
  }

  // Bump the failure counter and re-run the handshake protocol from scratch
  // after an exponential backoff delay. Shared by the handshake-failure paths
  // and the post-open EventSource onerror handler so a failure anywhere in the
  // connect lifecycle backs off identically instead of leaving realtime down.
  static scheduleReconnect() {
    $.reconnectAttempts++;
    const delay = $.computeReconnectDelay($.reconnectAttempts);

    $.reconnectTimer = setTimeout(() => $.connect(), delay);
  }
}

const $ = Sse;
