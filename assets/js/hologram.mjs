"use strict";

import App from "./app.mjs";
import AssetPathRegistry from "./asset_path_registry.mjs";
import Bitstring from "./bitstring.mjs";
import Client from "./client.mjs";
import ComponentRegistry from "./component_registry.mjs";
import Config from "./config.mjs";
import Connection from "./connection.mjs";
import Debouncer from "./debouncer.mjs";
import Deserializer from "./deserializer.mjs";
import ERTS from "./erts.mjs";
import EventListenerRegistry from "./event_listener_registry.mjs";
import EventListeners from "./event_listeners.mjs";
import FollowEdge from "./follow_edge.mjs";
import GlobalRegistry from "./global_registry.mjs";
import HologramBoxedError from "./errors/boxed_error.mjs";
import HologramInterpreterError from "./errors/interpreter_error.mjs";
import HologramRuntimeError from "./errors/runtime_error.mjs";
import InitActionQueue from "./init_action_queue.mjs";
import Interpreter from "./interpreter.mjs";
import JsInterop from "./js_interop.mjs";
import MemoryStorage from "./memory_storage.mjs";
import Operation from "./operation.mjs";
import PerformanceTimer from "./performance_timer.mjs";
import Renderer from "./renderer.mjs";
import Serializer from "./serializer.mjs";
import Sse from "./sse.mjs";
import Throttler from "./throttler.mjs";
import Type from "./type.mjs";
import UncaughtErrorOverlay from "./uncaught_error_overlay.mjs";
import Utils from "./utils.mjs";
import Vdom from "./vdom.mjs";

// Events
import ChangeEvent from "./events/change_event.mjs";
import ClickEvent from "./events/click_event.mjs";
import ClickOutsideEvent from "./events/click_outside_event.mjs";
import CloseEvent from "./events/close_event.mjs";
import FocusEvent from "./events/focus_event.mjs";
import InputEvent from "./events/input_event.mjs";
import KeyboardEvent from "./events/keyboard_event.mjs";
import MouseEvent from "./events/mouse_event.mjs";
import PointerEvent from "./events/pointer_event.mjs";
import ReachEvent from "./events/reach_event.mjs";
import ResizeEvent from "./events/resize_event.mjs";
import ScrollEvent from "./events/scroll_event.mjs";
import SelectEvent from "./events/select_event.mjs";
import SubmitEvent from "./events/submit_event.mjs";
import TransitionEvent from "./events/transition_event.mjs";
import VisibleEvent from "./events/visible_event.mjs";

import ManuallyPortedElixirApplication from "./elixir/application.mjs";
import ManuallyPortedElixirCldrLocale from "./elixir/cldr/locale.mjs";
import ManuallyPortedElixirCldrValidityU from "./elixir/cldr/validity/u.mjs";
import ManuallyPortedElixirCode from "./elixir/code.mjs";
import ManuallyPortedElixirException from "./elixir/exception.mjs";
import ManuallyPortedElixirFunctionClauseError from "./elixir/function_clause_error.mjs";
import ManuallyPortedElixirHologramJS from "./elixir/hologram/js.mjs";
import ManuallyPortedElixirHologramRouterHelpers from "./elixir/hologram/router/helpers.mjs";
import ManuallyPortedElixirIO from "./elixir/io.mjs";
import ManuallyPortedElixirKernel from "./elixir/kernel.mjs";
import ManuallyPortedElixirString from "./elixir/string.mjs";
import ManuallyPortedElixirStringTokenizer from "./elixir/string/tokenizer.mjs";
import ManuallyPortedElixirTask from "./elixir/task.mjs";
import ManuallyPortedElixirURI from "./elixir/uri.mjs";

// TODO: test
export default class Hologram {
  static #ETS_STORAGE_KEY = "hologram_ets";
  static #PAGE_SNAPSHOT_KEY_PREFIX = "hologram_page_snapshot_";

  // Made public to make tests easier
  static prefetchedPages = new Map();

  // Made public to make tests easier
  static virtualDocument = null;

  static #deps = {
    Bitstring: Bitstring,
    ERTS: ERTS,
    HologramBoxedError: HologramBoxedError,
    HologramInterpreterError: HologramInterpreterError,
    Interpreter: Interpreter,
    MemoryStorage: MemoryStorage,
    Type: Type,
    Utils: Utils,
  };

  // In-memory cache for page snapshots (fastest access)
  static #pageSnapshots = new Map();

  // PATCH (inline-action-cascade) — downstream fork patch; see #processActionResult and executeAction
  // for the other two hunks tagged the same. Depth of the current synchronous action cascade: a
  // forwarded delay-0 action runs inline in the same tick so the whole cross-component update paints as
  // one consistent frame (no intermediate stale-value "flash"). This counter bounds that inline chaining
  // so a pathological action loop falls back to setTimeout scheduling (yielding to the event loop)
  // instead of recursing until the tab freezes.
  // REMOVE this whole patch (all 3 hunks) once upstream coalesces a synchronous cross-component action
  // cascade into a single render — i.e. runs a delay-0 forwarded action before rendering, or extends
  // the render-coalescing roadmap item to span the action cascade. Then the naïve
  // put_state(...) + put_action(target: other) hand-off no longer paints a stale intermediate frame.
  static #actionCascadeDepth = 0;
  static #MAX_ACTION_CASCADE_DEPTH = 50;

  // PATCH (dispatch-coalesce) — downstream fork patch; the other hunk (tagged the same) is in
  // scheduleAction/#drainZeroDelayActions. Zero-delay dispatches queued for the next drain task:
  // co-arriving dispatches (e.g. a Sync record and the :untyped broadcast flushed right after it
  // on the same stream) must execute in ONE task, because the browser may paint between tasks —
  // an intermediate frame where the first action's render is visible but the second's isn't
  // (seen in-app as a one-frame layout bounce when a message replaces the typing ghost).
  // REMOVE both hunks once upstream batches co-arriving dispatches into one rendering task.
  static #pendingZeroDelayActions = [];
  static #zeroDelayDrainScheduled = false;

  static #historyId = null;
  static #isInitiated = false;
  static #pageModule = null;
  static #pageParams = null;
  static #pendingJsInteropActions = [];
  static #registeredPageModules = new Set();
  static #scrollPosition = null;
  static #shouldLoadMountData = true;

  // Public API for dispatching actions from JavaScript.
  // Converts plain JS values to Hologram types and schedules the action for execution.
  // Example: globalThis.Hologram.dispatchAction("increment", "page", {amount: 5})
  static dispatchAction(actionName, target, params = {}) {
    const action = Type.actionStruct({
      name: Type.atom(actionName),
      params: JsInterop.boxActionParam(params),
      target: Type.bitstring(target),
    });

    Hologram.scheduleAction(action);
  }

  // This function is intentionally NOT async. Actions that use Task.await/1 return
  // a Promise, but we handle it with .then() instead of async/await. Making this
  // function async would wrap ALL errors (including from sync actions) in rejected
  // Promises, breaking ChromeDriver/Wallaby error detection which relies on the
  // synchronous "error" event. Async action errors are caught separately via the
  // "unhandledrejection" event listener in #init().
  // TODO: make private (tested implicitely in feature tests)
  // Deps: [:maps.get/2]
  // PATCH (action bubbling) — an action runs on the nearest component, from `target` upward, that
  // actually handles it. Without this a component can only dispatch to a handler by NAMING the cid
  // that owns it, which means plumbing that cid down as a prop to every component that fires the
  // event — and re-plumbing it whenever a new component is inserted in between (extracting a list
  // component out of a pane silently moves "the closest stateful ancestor" one level down).
  //
  // Nearest handler wins, exactly like DOM event handling: the walk stops at the first component
  // whose __action_names__ covers the name, so a child that defines :close keeps its own :close.
  // If nothing in the chain handles it the ORIGINAL target is returned unchanged, so the dispatch
  // raises where it always did rather than failing somewhere surprising.
  static #resolveActionTarget(target, name) {
    let cid = target;
    const seen = new Set();

    while (cid !== null) {
      const cidKey = Type.encodeMapKey(cid);

      // Parentage is data the renderer writes; a cycle in it must not hang the page.
      if (seen.has(cidKey)) {
        break;
      }

      seen.add(cidKey);

      const module = ComponentRegistry.getComponentModule(cid);

      if (module === null) {
        break;
      }

      if (Hologram.#handlesAction(module, name)) {
        return cid;
      }

      cid = Renderer.parentCid(cid);
    }

    return target;
  }

  static #handlesAction(module, name) {
    const moduleProxy = Interpreter.moduleProxy(module);

    // A module compiled before this existed claims everything, which reproduces the pre-bubbling
    // behaviour (dispatch lands on the given target, handled or not).
    if (!("__action_names__/0" in moduleProxy)) {
      return true;
    }

    const actionNames = moduleProxy["__action_names__/0"]();

    if (Type.isAtom(actionNames)) {
      return actionNames.value === "any";
    }

    return actionNames.data.some((actionName) => actionName.value === name.value);
  }

  static executeAction(action) {
    const startTime = performance.now();
    // PATCH (profiling-opt-in) — upstream enables per-function profiling for EVERY dispatch,
    // logging one console line per interpreter call. With DevTools open each log costs real
    // milliseconds, so an O(n) recursion inside a dispatch gets multiplied ~20× — measured: the
    // same ↓ click ran 814ms with the console open vs ~40ms without, and every felt-latency
    // report during dev was distorted the same way. Profile on demand instead:
    //   globalThis.Hologram.profileDispatches = true
    globalThis.Hologram.isProfilingEnabled =
      globalThis.Hologram.profileDispatches === true;

    const name = Erlang_Maps["get/2"](Type.atom("name"), action);
    const params = Erlang_Maps["get/2"](Type.atom("params"), action);

    const target = Hologram.#resolveActionTarget(
      Erlang_Maps["get/2"](Type.atom("target"), action),
      name,
    );

    const componentModule = ComponentRegistry.getComponentModule(target);

    // PATCH: a delayed action (e.g. Holo.Optimistic's fail-timeout) can fire after its target
    // component was destroyed — scheduleAction's setTimeout is not cancelled by put_destroy. The
    // cid no longer resolves, so dispatching would raise inside the timer callback; skip it instead
    // (an action targeting a gone component is a no-op).
    if (componentModule === null) {
      globalThis.Hologram.isProfilingEnabled = false;
      // PATCH (inline-action-cascade) — if this dispatch is the inline continuation of a cascade,
      // the parent DEFERRED its own paint to the tail of the chain, expecting this action to render.
      // A gone target must therefore still flush that deferred paint (and queued-init scheduling)
      // before bailing, or the parent's already-committed state change never reaches the DOM — the
      // same flush the async branch does below. Without this, put_state(...) + put_action(target:
      // gone-cid) silently loses the caller's repaint. Remove with the other (inline-action-cascade)
      // hunks when upstream coalesces the cascade.
      if (Hologram.#actionCascadeDepth > 0) {
        Hologram.render();
        Hologram.#scheduleQueuedInitActions();
      }
      return;
    }

    const componentStruct = ComponentRegistry.getComponentStruct(target);
    const args = [name, params, componentStruct];

    const context = Interpreter.buildContext({
      module: componentModule,
      vars: {},
    });

    const resultComponentStruct = Interpreter.callNamedFunction(
      componentModule,
      Type.atom("action"),
      Type.list(args),
      context,
    );

    if (resultComponentStruct instanceof Promise) {
      // PATCH (inline-action-cascade) — a synchronous cascade can't extend across an async boundary.
      // If the caller deferred its paint to chain into this (now-async) forward, flush that deferred
      // paint now so the accumulated synchronous state is shown; the resolved result renders on its own
      // when it settles. Remove together with the other two hunks tagged (inline-action-cascade).
      if (Hologram.#actionCascadeDepth > 0) {
        Hologram.render();
        Hologram.#scheduleQueuedInitActions();
      }

      resultComponentStruct.then((resolved) =>
        Hologram.#processActionResult(resolved, name, target, startTime),
      );
    } else {
      Hologram.#processActionResult(
        resultComponentStruct,
        name,
        target,
        startTime,
      );
    }
  }

  // PATCH (resume-hook) — invoke a component's `resume/1` lifecycle callback on reconnect (dispatched
  // per re-subscribed cid from sse.mjs). Mirrors executeAction's plumbing but calls `resume` (arity 1,
  // just the struct) instead of `action`, and reuses #processActionResult so any chained
  // put_command/put_action drains exactly as an action's would. A gone cid is a no-op (same as
  // executeAction). Every component has a default no-op `resume`, so an unhandled cid never raises.
  static executeResume(target) {
    const componentModule = ComponentRegistry.getComponentModule(target);

    if (componentModule === null) {
      return;
    }

    const startTime = performance.now();
    globalThis.Hologram.isProfilingEnabled =
      globalThis.Hologram.profileDispatches === true;

    const componentStruct = ComponentRegistry.getComponentStruct(target);

    const context = Interpreter.buildContext({
      module: componentModule,
      vars: {},
    });

    const resultComponentStruct = Interpreter.callNamedFunction(
      componentModule,
      Type.atom("resume"),
      Type.list([componentStruct]),
      context,
    );

    const name = Type.atom("resume");

    if (resultComponentStruct instanceof Promise) {
      resultComponentStruct.then((resolved) =>
        Hologram.#processActionResult(resolved, name, target, startTime),
      );
    } else {
      Hologram.#processActionResult(
        resultComponentStruct,
        name,
        target,
        startTime,
      );
    }
  }

  // Made public to make tests easier
  static executeLoadPrefetchedPageAction(action, eventTargetNode) {
    Hologram.#ensureDomNodeHasHologramId(eventTargetNode);

    const toParam = Hologram.#getToParam(action);
    const pagePath = Hologram.#buildPagePath(toParam);

    const mapKey = Hologram.#buildPrefetchedPagesMapKey(
      eventTargetNode,
      pagePath,
    );

    const mapValue = Hologram.prefetchedPages.get(mapKey);

    if (typeof mapValue === "undefined") {
      return;
    }

    if (mapValue.html === null) {
      mapValue.isNavigateConfirmed = true;
    } else {
      Hologram.prefetchedPages.delete(mapKey);
      Hologram.loadNewPage(pagePath, mapValue.html);
    }
  }

  // Made public to make tests easier
  static executePrefetchPageAction(action, eventTargetNode) {
    Hologram.#ensureDomNodeHasHologramId(eventTargetNode);

    const toParam = Hologram.#getToParam(action);
    const pagePath = Hologram.#buildPagePath(toParam);

    const mapKey = Hologram.#buildPrefetchedPagesMapKey(
      eventTargetNode,
      pagePath,
    );

    if (
      !Hologram.prefetchedPages.has(mapKey) ||
      Hologram.#isPrefetchPageTimedOut(mapKey)
    ) {
      Hologram.prefetchedPages.set(mapKey, {
        html: null,
        isNavigateConfirmed: false,
        pagePath: pagePath,
        timestamp: Date.now(),
      });

      Client.fetchPage(toParam, (resp) =>
        Hologram.handlePrefetchPageSuccess(mapKey, resp),
      );
    }
  }

  static handlePrefetchPageSuccess(mapKey, html) {
    const mapValue = Hologram.prefetchedPages.get(mapKey);

    if (typeof mapValue === "undefined") {
      return;
    }

    if (mapValue.isNavigateConfirmed) {
      Hologram.prefetchedPages.delete(mapKey);
      Hologram.loadNewPage(mapValue.pagePath, html);
    } else {
      mapValue.html = html;
    }
  }

  // Processes a UI event and returns a dispatch function that runs the resulting action or
  // command, or null when the binding is disabled or the event is ignored. The edge concerns
  // that must happen during the event itself - the disabled-binding check, the ignored-event
  // check, preventDefault, stopPropagation, and reading the event payload (the browser nulls
  // currentTarget once dispatch returns) - run synchronously here. Callers invoke the returned
  // dispatch immediately, or hand it to the debouncer so that only the dispatch is deferred
  // while preventDefault still takes effect on every event.
  // Deps: [:maps.get/3]
  static handleUiEvent(
    event,
    eventType,
    operationSpecDom,
    defaultTarget,
    allowDefault = false,
    stopPropagation = false,
    forcePreventDefault = false,
  ) {
    // The guard runs before preventDefault and stopPropagation, so a disabled binding leaves
    // native browser behavior fully untouched.
    if (Operation.isDisabled(operationSpecDom)) {
      return null;
    }

    const eventImpl = Hologram.#getEventImplementation(eventType);

    if (eventImpl.isEventIgnored(event)) {
      return null;
    }

    // allowDefault is the binding's allow_default modifier: it opts this binding out of the
    // framework's preventDefault so the browser's native default proceeds. forcePreventDefault is
    // the binding's prevent_default modifier: it forces preventDefault even on events that allow
    // the default by design (above all keyboard events). Optional call: some event payloads are
    // not DOM events and have no preventDefault method, e.g. a resize binding's ResizeObserverEntry.
    if (forcePreventDefault || (!eventImpl.isDefaultAllowed && !allowDefault)) {
      event.preventDefault?.();
    }

    // stopPropagation is the binding's stop_propagation modifier: it stops the event from
    // bubbling past the bound element, so ancestor and document/window listeners do not fire.
    // Optional call: some event payloads are not DOM events and have no stopPropagation method,
    // e.g. a resize binding's ResizeObserverEntry.
    if (stopPropagation) {
      event.stopPropagation?.();
    }

    // A modifier-only binding carries modifiers but no operation (e.g. $click.stop_propagation with
    // no ={...}): its spec DOM is empty. preventDefault/stopPropagation have already run above, so
    // there is nothing to dispatch — return before building an operation with an empty name atom
    // (which would fall through to #constructFromMultiChunkSyntaxSpec and crash at dispatch). This
    // is the "claim this event and do nothing" primitive: it lets a nested native target (an <a>, a
    // <button>) stop the click reaching an ancestor binding without paying a no-op action's render.
    if (operationSpecDom.data.length === 0) {
      return null;
    }

    const eventParam = eventImpl.buildOperationParam(event);
    const eventTarget = event.target;

    return () => {
      const operation = Operation.fromSpecDom(
        operationSpecDom,
        defaultTarget,
        eventParam,
      );

      if (Operation.isAction(operation)) {
        switch (Hologram.#getActionName(operation)) {
          case "__load_prefetched_page__":
            return Hologram.executeLoadPrefetchedPageAction(
              operation,
              eventTarget,
            );

          case "__prefetch_page__":
            return Hologram.executePrefetchPageAction(operation, eventTarget);

          default: {
            const delay = Erlang_Maps["get/3"](
              Type.atom("delay"),
              operation,
              Type.integer(0),
            );

            if (delay.value === 0n) {
              return Hologram.executeAction(operation);
            } else {
              return Hologram.scheduleAction(operation);
            }
          }
        }
      } else {
        Client.sendCommand(operation);
      }
    };
  }

  // Records an uncaught boxed error and puts it in the page.
  //
  // Nothing is written to the console here: the error carries the whole report
  // as its message, so the entry the browser writes for an error nobody caught
  // holds the Elixir frames and the JavaScript stack below them - one entry,
  // and its stack stays the structured one the devtools resolve through the
  // bundle's source maps.
  static handleUncaughtError(error) {
    if (!(error instanceof HologramBoxedError)) {
      return;
    }

    // Read by the feature test helpers, which assert against the error the
    // page last raised. Both parts are taken as the error derived them, so an
    // error that failed to derive is still reported, with the fault named.
    GlobalRegistry.set("lastBoxedError", {
      module: error.type,
      message: error.text,
    });

    if (globalThis.Hologram.config.errorOverlay) {
      UncaughtErrorOverlay.show(error);
    }
  }

  // Made public to make tests easier
  static async loadNewPage(pagePath, html) {
    await $.#savePageSnapshot();
    $.#historyId = Utils.randomUUID();

    window.requestAnimationFrame(() => {
      Hologram.#patchPage(html);
      window.scrollTo(0, 0);

      history.pushState($.#historyId, null, pagePath);
    });
  }

  // Made public to make tests easier
  // Deps: [:maps.get/2, :maps.get/3, :maps.put/3]
  static queueActionsFromServerInits() {
    for (const [cid, entry] of Object.values(ComponentRegistry.entries.data)) {
      const componentStruct = Erlang_Maps["get/2"](Type.atom("struct"), entry);

      const nextAction = Erlang_Maps["get/3"](
        Type.atom("next_action"),
        componentStruct,
        Type.nil(),
      );

      if (!Type.isNil(nextAction)) {
        ComponentRegistry.clearNextAction(cid);

        let actionWithTarget = nextAction;

        if (
          Type.isNil(
            Erlang_Maps["get/3"](Type.atom("target"), nextAction, Type.nil()),
          )
        ) {
          actionWithTarget = Erlang_Maps["put/3"](
            Type.atom("target"),
            cid,
            nextAction,
          );
        }

        InitActionQueue.enqueue(actionWithTarget);
      }
    }
  }

  // Made public to make tests easier
  static queueSelfEchoes(selfEchoes) {
    for (const action of selfEchoes.data) {
      InitActionQueue.enqueue(action);
    }
  }

  // Made public to make tests easier
  static render() {
    const startTime = performance.now();

    const newVirtualDocument = Renderer.renderPage(
      Hologram.#pageModule,
      Hologram.#pageParams,
    );

    // PATCH (follow-edge) — see follow_edge.mjs. The snapshot must straddle the DOM patch:
    // taken here (after actions ran, so an action's own scrollTo is respected as the new
    // position), applied immediately after patch (the framework's only "after render" moment).
    const followEdges = FollowEdge.snapshot();

    Hologram.virtualDocument = Vdom.patchVirtualDocument(
      Hologram.virtualDocument,
      newVirtualDocument,
    );

    FollowEdge.restore(followEdges);

    // renderPage() collected this render's <window>/<document> bindings into Renderer.listenerBindings
    // and its deferred element bindings (reach, resize) into Renderer.reachBindings and
    // Renderer.resizeBindings. Now that the DOM is patched, reconcile them into real listeners on
    // their targets. The deferred bindings are resolved here because their target is a live DOM
    // element, which exists only after patch. Each resolve also drops a binding whose once modifier
    // has fired, so reconcile tears it down. Every page-entry path reaches render() through
    // #mountPage, so this also tears down a previous page's listeners on navigation.
    EventListenerRegistry.reconcile([
      ...Renderer.resolveListenerBindings(),
      ...Renderer.resolveReachBindings(),
      ...Renderer.resolveResizeBindings(),
    ]);

    // Reach listeners persist across renders, so reconcile alone does not re-run them. Recheck them
    // now that the DOM is patched, so each re-syncs the children it watches and recomputes - firing
    // again as content this render added extends or fills the container.
    EventListeners.recheckScrollEdges();

    console.log("Hologram: page rendered in", PerformanceTimer.diff(startTime));
  }

  static run() {
    Hologram.#onReady(async () => {
      if (!Hologram.#isInitiated) {
        await Hologram.#init();
      }

      try {
        Hologram.#mountPage();
      } catch (error) {
        if (error instanceof HologramBoxedError) {
          error.name = error.type;
          error.message = error.text;
        }

        throw error;
      }

      // SSE must open AFTER `#mountPage()` because the handshake payload
      // includes the receipts merged from `pageMountData.subReceiptAdds` -
      // connecting earlier would send an empty receipts list.
      if (Sse.eventSource === null) {
        Sse.connect();
      }
    });
  }

  // Execute action asynchronously to allow animations and prevent blocking the event loop
  // Deps: [:maps.get/3]
  static scheduleAction(action) {
    const delay = Erlang_Maps["get/3"](
      Type.atom("delay"),
      action,
      Type.integer(0),
    );

    // PATCH (dispatch-coalesce) — zero-delay dispatches queued in the same tick (SSE events
    // arriving in one chunk, broadcast fan-out to several cids, queued init actions) drain in a
    // SINGLE task so all their renders paint together; a paint can never split a task, so no
    // intermediate frame can show one dispatch's render without the other's. Execution order is
    // unchanged (queue order = scheduling order). Delayed actions (delay > 0 — the intentional
    // "async for animations" path) keep their own timers, exactly as before.
    //
    // REMOVE with the field hunk (see #pendingZeroDelayActions). The original body was:
    //     setTimeout(() => Hologram.executeAction(action), Number(delay.value));
    if (Number(delay.value) === 0) {
      $.#pendingZeroDelayActions.push(action);

      if (!$.#zeroDelayDrainScheduled) {
        $.#zeroDelayDrainScheduled = true;
        setTimeout(() => $.#drainZeroDelayActions(), 0);
      }

      return;
    }

    setTimeout(() => Hologram.executeAction(action), Number(delay.value));
  }

  // PATCH (dispatch-coalesce) — drain everything queued by the time this task runs. The queue is
  // snapshotted first: an action scheduled DURING the drain (e.g. the cascade-depth overflow
  // fallback in #processActionResult) gets its own later task, exactly as before this patch. A
  // throwing action doesn't abort the rest of the batch — each action ran in its own task before,
  // so failures stay isolated; reportError re-dispatches through the window "error" event, which
  // executeAction's error-detection contract relies on (see its comment).
  static #drainZeroDelayActions() {
    $.#zeroDelayDrainScheduled = false;

    const batch = $.#pendingZeroDelayActions;
    $.#pendingZeroDelayActions = [];

    for (const action of batch) {
      try {
        Hologram.executeAction(action);
      } catch (error) {
        reportError(error);
      }
    }
  }

  static #buildPagePath(toParam) {
    return Bitstring.toText(
      Elixir_Hologram_Router_Helpers["page_path/1"](toParam),
    );
  }

  static #buildPrefetchedPagesMapKey(eventTargetNode, pagePath) {
    return `${eventTargetNode.__hologramId__}:${pagePath}`;
  }

  static #defineManuallyPortedFunctions() {
    Interpreter.defineManuallyPortedFunction(
      "Application",
      "get_env/3",
      "public",
      ManuallyPortedElixirApplication["get_env/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Cldr.Locale",
      "language_data/0",
      "public",
      ManuallyPortedElixirCldrLocale["language_data/0"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Cldr.Validity.U",
      "encode_key/2",
      "public",
      ManuallyPortedElixirCldrValidityU["encode_key/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Code",
      "ensure_compiled/1",
      "public",
      ManuallyPortedElixirCode["ensure_compiled/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Code",
      "ensure_loaded/1",
      "public",
      ManuallyPortedElixirCode["ensure_loaded/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Exception",
      "format_stacktrace/1",
      "public",
      ManuallyPortedElixirException["format_stacktrace/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "FunctionClauseError",
      "message/1",
      "public",
      ManuallyPortedElixirFunctionClauseError["message/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "call/4",
      "public",
      ManuallyPortedElixirHologramJS["call/4"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "delete/3",
      "public",
      ManuallyPortedElixirHologramJS["delete/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "dispatch_event/5",
      "public",
      ManuallyPortedElixirHologramJS["dispatch_event/5"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "eval/1",
      "public",
      ManuallyPortedElixirHologramJS["eval/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "exec/1",
      "public",
      ManuallyPortedElixirHologramJS["exec/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "get/3",
      "public",
      ManuallyPortedElixirHologramJS["get/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "instanceof/3",
      "public",
      ManuallyPortedElixirHologramJS["instanceof/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "new/3",
      "public",
      ManuallyPortedElixirHologramJS["new/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "set/4",
      "public",
      ManuallyPortedElixirHologramJS["set/4"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.JS",
      "typeof/2",
      "public",
      ManuallyPortedElixirHologramJS["typeof/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Hologram.Router.Helpers",
      "asset_path/1",
      "public",
      ManuallyPortedElixirHologramRouterHelpers["asset_path/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "inspect/1",
      "public",
      ManuallyPortedElixirIO["inspect/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "inspect/2",
      "public",
      ManuallyPortedElixirIO["inspect/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "inspect/3",
      "public",
      ManuallyPortedElixirIO["inspect/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "warn/1",
      "public",
      ManuallyPortedElixirIO["warn/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "warn/2",
      "public",
      ManuallyPortedElixirIO["warn/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "IO",
      "warn_once/3",
      "public",
      ManuallyPortedElixirIO["warn_once/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Kernel",
      "inspect/1",
      "public",
      ManuallyPortedElixirKernel["inspect/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Kernel",
      "inspect/2",
      "public",
      ManuallyPortedElixirKernel["inspect/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "contains?/2",
      "public",
      ManuallyPortedElixirString["contains?/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "downcase/1",
      "public",
      ManuallyPortedElixirString["downcase/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "downcase/2",
      "public",
      ManuallyPortedElixirString["downcase/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "replace/3",
      "public",
      ManuallyPortedElixirString["replace/3"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "trim/1",
      "public",
      ManuallyPortedElixirString["trim/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "upcase/1",
      "public",
      ManuallyPortedElixirString["upcase/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String",
      "upcase/2",
      "public",
      ManuallyPortedElixirString["upcase/2"],
    );

    Interpreter.defineManuallyPortedFunction(
      "String.Tokenizer",
      "tokenize/1",
      "public",
      ManuallyPortedElixirStringTokenizer["tokenize/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "Task",
      "await/1",
      "public",
      ManuallyPortedElixirTask["await/1"],
    );

    Interpreter.defineManuallyPortedFunction(
      "URI",
      "encode/2",
      "public",
      ManuallyPortedElixirURI["encode/2"],
    );
  }

  static #dispatchPendingJsInteropActions() {
    const actions = Hologram.#pendingJsInteropActions;
    Hologram.#pendingJsInteropActions = [];

    actions.forEach(([actionName, target, params]) => {
      Hologram.dispatchAction(actionName, target, params);
    });
  }

  static #ensureDomNodeHasHologramId(eventNode) {
    if (typeof eventNode.__hologramId__ === "undefined") {
      eventNode.__hologramId__ = Utils.randomUUID();
    }
  }

  // Deps: [:maps.get/2]
  static #getActionName(action) {
    return Erlang_Maps["get/2"](Type.atom("name"), action).value;
  }

  static #getEventImplementation(eventType) {
    switch (eventType) {
      case "blur":
      case "focus":
        return FocusEvent;

      case "change":
        return ChangeEvent;

      case "click":
        return ClickEvent;

      case "click_outside":
        return ClickOutsideEvent;

      case "close":
        return CloseEvent;

      case "input":
        return InputEvent;

      case "keydown":
      case "keyup":
        return KeyboardEvent;

      case "mousemove":
        return MouseEvent;

      case "pointercancel":
      case "pointerdown":
      case "pointerenter":
      case "pointerleave":
      case "pointermove":
      case "pointerup":
        return PointerEvent;

      case "reach_bottom":
      case "reach_left":
      case "reach_right":
      case "reach_top":
        return ReachEvent;

      case "resize":
        return ResizeEvent;

      case "scroll":
        return ScrollEvent;

      case "select":
        return SelectEvent;

      case "submit":
        return SubmitEvent;

      case "transitioncancel":
      case "transitionend":
      case "transitionrun":
      case "transitionstart":
        return TransitionEvent;

      case "visibilitychange":
        return VisibleEvent;
    }
  }

  static async #getPageSnapshot(historyId) {
    const snapshotKey = $.#pageSnapshotKey(historyId);

    // Try in-memory cache first (fastest) - returns deserialized object
    if ($.#pageSnapshots.has(snapshotKey)) {
      return $.#pageSnapshots.get(snapshotKey);
    }

    // Try OPFS second
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(snapshotKey, {create: false});
      const file = await fileHandle.getFile();
      const serializedSnapshot = await file.text();
      const deserializedSnapshot = Deserializer.deserialize(serializedSnapshot);

      // Cache the deserialized snapshot in memory for faster subsequent access
      $.#pageSnapshots.set(snapshotKey, deserializedSnapshot);

      return deserializedSnapshot;
    } catch {
      // Fall back to session storage if OPFS fails
      const serializedSnapshot = sessionStorage.getItem(snapshotKey);

      if (serializedSnapshot) {
        const deserializedSnapshot =
          Deserializer.deserialize(serializedSnapshot);

        // Cache the deserialized snapshot in memory for faster subsequent access
        $.#pageSnapshots.set(snapshotKey, deserializedSnapshot);

        return deserializedSnapshot;
      }

      return null;
    }
  }

  // Deps: [:maps.get/2]
  static #getToParam(operation) {
    return Erlang_Maps["get/2"](
      Type.atom("to"),
      Erlang_Maps["get/2"](Type.atom("params"), operation),
    );
  }

  static async #handlePopstateEvent(event) {
    await $.#savePageSnapshot();
    $.#historyId = event.state;

    const pageSnapshot = await $.#getPageSnapshot(event.state);

    if (pageSnapshot) {
      $.#restorePageSnapshot(pageSnapshot);
    }

    if ($.#isPageModuleRegistered(Hologram.#pageModule)) {
      return $.#mountPage(true);
    }

    await Client.fetchPageBundlePath(
      Hologram.#pageModule,
      (resp) => {
        const script = document.createElement("script");
        script.src = resp;
        script.fetchpriority = "high";
        document.head.appendChild(script);
      },
      (_resp) => {
        throw new HologramRuntimeError(
          "Failed to fetch page bundle path for: " +
            Interpreter.inspect(Hologram.#pageModule),
        );
      },
    );
  }

  // Executed only once, on the initial page load.
  // Deps: [:maps.get/2]
  static async #init() {
    window.addEventListener("error", (event) => {
      $.handleUncaughtError(event.error);
    });

    // Async action errors surface as rejected Promises (from the .then() path
    // in executeAction) and fire "unhandledrejection" instead of "error".
    window.addEventListener("unhandledrejection", (event) => {
      $.handleUncaughtError(event.reason);
    });

    window.addEventListener("beforeunload", () => {
      // Force synchronous session storage save since async OPFS may not complete before page termination
      Hologram.#savePageSnapshot(true);

      Hologram.#saveEts();
    });

    window.addEventListener("popstate", Hologram.#handlePopstateEvent);

    window.addEventListener("pageshow", (event) => {
      // Reconnect when page is restored from bfcache OR when navigating back from external page
      if (event.persisted || !Client.isConnected()) {
        Client.connect(true);
      }
    });

    // Losing focus definitively ends any burst of events from an element, so its pending
    // debounced dispatches fire now instead of waiting out the rest of their windows.
    document.addEventListener("focusout", (event) =>
      Debouncer.flush(event.target),
    );

    // Submit is a commit point: everything entered into the form is logically before it, so the
    // form's pending debounced dispatches run first. Capture phase guarantees the flush precedes
    // the form's own bound handler reading the event payload and dispatching.
    document.addEventListener(
      "submit",
      (event) => Debouncer.flushWithin(event.target),
      true,
    );

    // Check if there's already a history state (e.g., when navigating back from external page)
    if (history.state) {
      $.#historyId = history.state;
      const pageSnapshot = await $.#getPageSnapshot(history.state);

      // Only restore state for back/forward navigation, not page reloads
      if (!$.#isPageReload() && pageSnapshot) {
        $.#restorePageSnapshot(pageSnapshot);
      }
    } else {
      $.#historyId = Utils.randomUUID();
      history.replaceState($.#historyId, null, window.location.pathname);
    }

    await $.#restoreEts();

    App.maybeLoadInstanceId();
    Client.connect(false);

    Hologram.#defineManuallyPortedFunctions();

    // PATCH (hydration-adopt) — downstream fork patch; see Vdom.fromLiveDom.
    // Seed the boot vdom in the renderer's vnode shape, bound to the live DOM, so the first
    // patch ADOPTS the SSR-rendered nodes instead of rebuilding the page (snabbdom's toVNode
    // encoded id/class into `sel`, failing sameVnode for every classed element — the whole
    // SSR paint was discarded and every <img> refetched/re-decoded on refresh). fromLiveDom
    // carries the link/script keys itself, so addKeysToLinkAndScriptVnodes is not needed.
    Hologram.virtualDocument = Vdom.fromLiveDom(document.documentElement);

    // TRIAL RESOLUTION (needs review): the adopted seed still has to pick up the block-marker
    // keys and fragment grouping that #985 added, or the boot patch diffs a flat old tree
    // against a fragmented new one. fromLiveDom already stamps the link/script keys, so this
    // pass only re-derives them; the open question is the fragment wrapper, which carries no
    // `elm` of its own.
    Vdom.addKeysToVnodes(Hologram.virtualDocument);

    console.inspect = (term) => console.log(Interpreter.inspect(term));

    $.#pendingJsInteropActions = globalThis.Hologram._pendingJsInteropActions;
    globalThis.Hologram.dispatchAction = $.dispatchAction;
    delete globalThis.Hologram._pendingJsInteropActions;

    Hologram.#isInitiated = true;
  }

  static #isPageModuleRegistered(pageModule) {
    return $.#registeredPageModules.has(pageModule.value);
  }

  // Note: Although using the History API makes it impossible to use the Performance API for detecting
  // what was the last navigation type, when the page is reloaded the navigation type will
  // always be "reload". But the type remains the same for succeeding navigation types within
  // Hologram navigation, hence the additional check for whether the app was already initiated.
  // In case of the new Performance API, there will always be only one entry due to History API use.
  static #isPageReload() {
    // New Performance API
    if ("getEntriesByType" in performance) {
      return (
        !$.#isInitiated &&
        performance.getEntriesByType("navigation")[0].type === "reload"
      );
    }

    // Old Performance API
    return (
      !$.#isInitiated &&
      performance.navigation.type === PerformanceNavigation.TYPE_RELOAD
    );
  }

  static #isPrefetchPageTimedOut(mapKey) {
    return (
      Date.now() - Hologram.prefetchedPages.get(mapKey).timestamp >
      Config.fetchPageTimeoutMs
    );
  }

  static #loadMountData() {
    const mountData = globalThis.Hologram.pageMountData(Hologram.#deps);

    Hologram.#pageModule = mountData.pageModule;
    Hologram.#pageParams = mountData.pageParams;

    ComponentRegistry.populate(mountData.componentRegistry);

    return mountData;
  }

  static #maybeInitAssetPathRegistry() {
    if (AssetPathRegistry.entries === null) {
      AssetPathRegistry.populate(globalThis.Hologram.assetManifest);
    }
  }

  static #mountPage(isPageModuleRegistered = false) {
    // Every page-entry path funnels through here (client-side navigation, back/forward
    // restoration, initial mount), so this is where dispatches still pending from the previous
    // page are dropped - the context they were meant for no longer exists. Cancel, not flush: a
    // dispatch must never execute on a page the user has left. On the initial mount both
    // cancellations are no-ops.
    Debouncer.cancelAll();
    Throttler.cancelAll();

    let mountData = null;

    if ($.#shouldLoadMountData) {
      mountData = Hologram.#loadMountData();
    } else {
      $.#shouldLoadMountData = true;
    }

    if (!isPageModuleRegistered) {
      globalThis.Hologram.pageReachableFunctionDefs(Hologram.#deps);
      $.#registerPageModule($.#pageModule);
    }

    Hologram.#maybeInitAssetPathRegistry();

    Hologram.prefetchedPages.clear();

    Hologram.queueActionsFromServerInits();

    if (mountData) {
      Hologram.queueSelfEchoes(mountData.selfEchoes);

      App.subscriptionReceiptRegistry.merge(
        mountData.subReceiptAdds,
        mountData.subReceiptDrops,
      );
    }

    window.requestAnimationFrame(() => {
      $.render();

      if ($.#scrollPosition) {
        window.scrollTo($.#scrollPosition[0], $.#scrollPosition[1]);
        $.#scrollPosition = null;
      }

      GlobalRegistry.set("mountedPage", Interpreter.inspect($.#pageModule));

      Hologram.#scheduleQueuedInitActions();
      Hologram.#dispatchPendingJsInteropActions();
    });
  }

  // Tested implicitely in feature tests
  static async #navigateToPage(toParam) {
    const pagePath = $.#buildPagePath(toParam);

    return Client.fetchPage(toParam, (resp) =>
      Hologram.loadNewPage(pagePath, resp),
    );
  }

  static #onReady(callback) {
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      callback();
    } else {
      document.addEventListener("DOMContentLoaded", function listener() {
        document.removeEventListener("DOMContentLoaded", listener);
        callback();
      });
    }
  }

  static #pageSnapshotKey(historyId) {
    return `${$.#PAGE_SNAPSHOT_KEY_PREFIX}${historyId}`;
  }

  // TODO: raise error if there is no head or body
  static #patchPage(html) {
    globalThis.Hologram.pageScriptLoaded = false;

    const newVirtualDocument = Vdom.from(html);

    Hologram.virtualDocument = Vdom.patchVirtualDocument(
      Hologram.virtualDocument,
      newVirtualDocument,
    );
  }

  // Deps: [:maps.get/2, :maps.put/3]
  static #processActionResult(resultComponentStruct, name, target, startTime) {
    let nextAction = Erlang_Maps["get/2"](
      Type.atom("next_action"),
      resultComponentStruct,
    );

    const nextPage = Erlang_Maps["get/2"](
      Type.atom("next_page"),
      resultComponentStruct,
    );

    let nextCommand = Erlang_Maps["get/2"](
      Type.atom("next_command"),
      resultComponentStruct,
    );

    if (!Type.isNil(nextCommand)) {
      if (Type.isNil(Erlang_Maps["get/2"](Type.atom("target"), nextCommand))) {
        nextCommand = Erlang_Maps["put/3"](
          Type.atom("target"),
          target,
          nextCommand,
        );
      }

      Client.sendCommand(nextCommand);
    }

    const nextDestroy = Erlang_Maps["get/2"](
      Type.atom("next_destroy"),
      resultComponentStruct,
    );

    if (!Type.isNil(nextDestroy)) {
      ComponentRegistry.deleteEntry(nextDestroy);
      // PATCH: tell the server to drop this cid's channel subscriptions (fire-and-forget, no reply).
      Connection.sendMessage(
        "destroy",
        Type.map([
          [Type.atom("instance_id"), Type.bitstring(App.instanceId)],
          [Type.atom("cid"), nextDestroy],
        ]),
      );
    }

    const nextWarms = Erlang_Maps["get/2"](
      Type.atom("next_warms"),
      resultComponentStruct,
    );

    if (Type.isList(nextWarms) && nextWarms.data.length > 0) {
      // The warmed components inherit the warmer's (the acting component's) context.
      const warmerContext = ComponentRegistry.getComponentContext(target);

      // put_warm prepends, so reverse to warm in call order.
      for (const spec of [...nextWarms.data].reverse()) {
        const moduleProxy = Interpreter.moduleProxy(
          Erlang_Maps["get/2"](Type.atom("module"), spec),
        );

        if (moduleProxy) {
          const props = Erlang_Maps["put/3"](
            Type.atom("cid"),
            Erlang_Maps["get/2"](Type.atom("cid"), spec),
            Erlang_Maps["get/2"](Type.atom("props"), spec),
          );

          Renderer.warmComponent(moduleProxy, props, warmerContext);
        }
      }
    }

    let savedComponentStruct = Erlang_Maps["put/3"](
      Type.atom("next_action"),
      Type.nil(),
      resultComponentStruct,
    );

    savedComponentStruct = Erlang_Maps["put/3"](
      Type.atom("next_command"),
      Type.nil(),
      savedComponentStruct,
    );

    savedComponentStruct = Erlang_Maps["put/3"](
      Type.atom("next_destroy"),
      Type.nil(),
      savedComponentStruct,
    );

    savedComponentStruct = Erlang_Maps["put/3"](
      Type.atom("next_warms"),
      Type.list(),
      savedComponentStruct,
    );

    // The acting component may have destroyed itself via put_destroy; only write its struct back
    // if it is still registered.
    if (ComponentRegistry.isCidRegistered(target)) {
      ComponentRegistry.putComponentStruct(target, savedComponentStruct);
    }

    globalThis.Hologram.isProfilingEnabled = false;

    console.log(
      "Hologram: action",
      `:${name.value}`,
      "executed in",
      PerformanceTimer.diff(startTime),
    );

    // PATCH (inline-action-cascade) — resolve the forwarded action's target (defaults to the acting
    // component) and its delay up front, so we can decide whether to chain it INLINE before rendering.
    if (!Type.isNil(nextAction)) {
      if (Type.isNil(Erlang_Maps["get/2"](Type.atom("target"), nextAction))) {
        nextAction = Erlang_Maps["put/3"](
          Type.atom("target"),
          target,
          nextAction,
        );
      }
    }

    const nextActionDelay = Type.isNil(nextAction)
      ? 0n
      : Erlang_Maps["get/3"](Type.atom("delay"), nextAction, Type.integer(0))
          .value;

    // PATCH (inline-action-cascade) — an immediate (delay-0) forwarded action is the cross-component
    // optimistic hand-off. Running it through scheduleAction (setTimeout) AFTER rendering here would
    // paint an intermediate frame where THIS component is updated but the forward's target is not yet —
    // the "flash". Instead, chain it INLINE in this same tick and defer the paint (and the queued-init
    // scheduling) to the TAIL of the cascade, so every component is consistent in the single frame we
    // paint. Delayed forwards (delay > 0 — the intentional "async for animations" path) keep scheduling,
    // as before. The depth cap makes a pathological forward loop fall back to setTimeout rather than
    // freezing the tab.
    //
    // REMOVE this patch when upstream coalesces the cross-component cascade into one render. The
    // original (pre-patch) body was simply:
    //     Hologram.render();
    //     Hologram.#scheduleQueuedInitActions();
    //     if (!Type.isNil(nextAction)) {
    //       if (Type.isNil(get(:target, nextAction))) nextAction = put(:target, target, nextAction);
    //       Hologram.scheduleAction(nextAction);
    //     }
    //     if (!Type.isNil(nextPage)) $.#navigateToPage(nextPage);
    const chainInline =
      !Type.isNil(nextAction) &&
      nextActionDelay === 0n &&
      Hologram.#actionCascadeDepth < Hologram.#MAX_ACTION_CASCADE_DEPTH;

    if (!chainInline) {
      Hologram.render();
      Hologram.#scheduleQueuedInitActions();
    }

    if (!Type.isNil(nextAction)) {
      if (chainInline) {
        Hologram.#actionCascadeDepth++;

        try {
          Hologram.executeAction(nextAction);
        } finally {
          Hologram.#actionCascadeDepth--;
        }
      } else {
        Hologram.scheduleAction(nextAction);
      }
    }

    if (!Type.isNil(nextPage)) {
      $.#navigateToPage(nextPage);
    }
  }

  static #registerPageModule(pageModule) {
    $.#registeredPageModules.add(pageModule.value);
  }

  static async #restoreEts() {
    const storageKey = $.#ETS_STORAGE_KEY;

    // Try OPFS first
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(storageKey, {create: false});
      const file = await fileHandle.getFile();
      const serialized = await file.text();
      ERTS.ets = Deserializer.deserialize(serialized);
      return;
    } catch {
      // Fall through to session storage
    }

    // Fallback to session storage if OPFS fails
    const serialized = sessionStorage.getItem(storageKey);

    if (serialized) {
      try {
        ERTS.ets = Deserializer.deserialize(serialized);
      } catch (error) {
        console.error("Failed to restore ETS from session storage:", error);
        ERTS.ets = {}; // Reset to empty on deserialization failure
      }
    } else {
      // No stored state found, keep current (likely empty) state
    }
  }

  static #restorePageSnapshot(pageSnapshot) {
    const {
      componentRegistryEntries,
      instanceId,
      pageModule,
      pageParams,
      scrollPosition,
      subscriptionReceipts,
    } = pageSnapshot;

    ComponentRegistry.populate(componentRegistryEntries);

    App.instanceId = instanceId;
    App.subscriptionReceiptRegistry.populate(subscriptionReceipts);

    Hologram.#pageModule = pageModule;
    Hologram.#pageParams = pageParams;

    $.#scrollPosition = scrollPosition;
    $.#shouldLoadMountData = false;
  }

  static async #saveEts() {
    const storageKey = $.#ETS_STORAGE_KEY;
    const serializedEts = Serializer.serialize(ERTS.ets, "client");

    // Save to session storage first (guaranteed to complete synchronously)
    try {
      sessionStorage.setItem(storageKey, serializedEts);
    } catch (error) {
      console.error("Failed to save ETS to session storage:", error);
    }

    // Then try OPFS (async, may not complete before page unload on beforeunload)
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(storageKey, {create: true});
      const writable = await fileHandle.createWritable();
      await writable.write(serializedEts);
      await writable.close();

      // Successfully saved to OPFS, clear session storage
      sessionStorage.removeItem(storageKey);
    } catch (opfsError) {
      console.error("Failed to save ETS to OPFS:", opfsError);
      // Session storage still has the data as fallback
    }
  }

  static async #savePageSnapshot(forceSync = false) {
    const pageSnapshot = {
      componentRegistryEntries: ComponentRegistry.entries,
      instanceId: App.instanceId,
      pageModule: Hologram.#pageModule,
      pageParams: Hologram.#pageParams,
      scrollPosition: [window.scrollX, window.scrollY],
      subscriptionReceipts: Array.from(
        App.subscriptionReceiptRegistry.entries.entries(),
      ),
    };

    const snapshotKey = $.#pageSnapshotKey($.#historyId);

    // Always save deserialized object to in-memory cache first (fastest)
    $.#pageSnapshots.set(snapshotKey, pageSnapshot);

    const serializedPageSnapshot = Serializer.serialize(pageSnapshot, "client");

    // For beforeunload: save synchronously to session storage only
    if (forceSync) {
      try {
        sessionStorage.setItem(snapshotKey, serializedPageSnapshot);
      } catch (error) {
        console.error(
          "Failed to save page snapshot to session storage:",
          error,
        );
      }

      return;
    }

    // For normal navigation: OPFS primary, session storage fallback
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(snapshotKey, {create: true});
      const writable = await fileHandle.createWritable();
      await writable.write(serializedPageSnapshot);
      await writable.close();

      // Successfully saved to OPFS, clear session storage fallback if it exists
      sessionStorage.removeItem(snapshotKey);
    } catch (opfsError) {
      console.error("Failed to save page snapshot to OPFS:", opfsError);

      // Fallback to session storage if OPFS fails
      try {
        sessionStorage.setItem(snapshotKey, serializedPageSnapshot);
      } catch (sessionStorageError) {
        console.error(
          "Failed to save page snapshot to session storage:",
          sessionStorageError,
        );
      }
    }
  }

  static #scheduleQueuedInitActions() {
    const actions = InitActionQueue.dequeueAll();

    actions.forEach((action) => {
      Hologram.scheduleAction(action);
    });
  }
}

const $ = Hologram;
