"use strict";

// PATCH (follow-edge) — downstream fork patch; the other hunk (tagged the same) is in
// hologram.mjs render().
//
// A chat-style scroller opted in via `data-scroll-follow="<unique id>"` gets the two scroll
// behaviors chat needs, straddling the render patch:
//
//   1. It RESTS AT ITS END — at the end before a patch ⇒ returned to the end right after it
//      (tail-stick); the first time an id is seen ⇒ pinned to the end (the initial position).
//   2. Away from the end, its reading position is CONTENT-stable: the first visible descendant
//      carrying `data-anchor="<stable key>"` is re-found by key after the patch and returned to
//      its pre-patch offset.
//
// Why (2) can't be left to native CSS scroll anchoring, even in normal flow: the vdom's KEYLESS
// positional diff never actually prepends nodes. Growing a list at its start rewrites every
// existing element's content in place and appends new elements at the END — so the browser sees
// no node move (no scroll adjustment) while the content teleports under the viewport. Native
// anchoring tracks nodes; only a content key survives positional reuse. Anchor keys are content
// identities (entity ids), so they can't be mislabeled the way node positions can.
//
// The scroller id is a content identity too (e.g. a channel id): a reused DOM node whose id
// changes counts as a fresh scroller, and a snapshot taken under the old id can't leak onto the
// new one. A snapshot whose anchor key is gone after the patch (window swap, page navigation)
// restores nothing.
//
// Rule (1) has a CONTINUOUS half. The snapshot/restore straddle only sees layout as it stands
// at each render patch — but content can change height BETWEEN patches: a CSS transition
// growing an always-mounted row (a typing ghost's 0fr→1fr reveal), an image decoding into its
// box. At the patch that starts such a grow the scroller is still at its end (nothing has moved
// yet), so restore() rightly does nothing — and the growth then plays out where no straddle
// runs, leaving an at-end reader clipped by exactly the grown height. A ResizeObserver over
// each scroller's content closes the gap: it reports growth after layout and BEFORE paint, so a
// re-pin in the callback rides a transition frame-by-frame invisibly. The gate reconstructs
// "was at the end before this growth" from the delta itself (distance-from-end minus what just
// grew), so a reader above the end is never touched — their position is rule (2)'s business.
// Shrinks need nothing: when the end rises above scrollTop the browser clamps it, which IS the
// tail-stick. (Mirrors the $reach machinery, which re-arms its loaders off the same signal.)

const AT_END_SLACK = 2;

function atEnd(scroller) {
  return (
    scroller.scrollTop >=
    scroller.scrollHeight - scroller.clientHeight - AT_END_SLACK
  );
}

function pinToEnd(scroller) {
  scroller.scrollTo({
    top: scroller.scrollHeight - scroller.clientHeight,
    left: scroller.scrollLeft,
    behavior: "instant",
  });
}

export default class FollowEdge {
  // Ids already given their initial end-pin (page entry / first mount of that content).
  static seenIds = new Set();

  // {id: {atEnd: true} | {atEnd: false, key, top}} for every opted-in scroller, taken just
  // before the DOM patch. Offsets are relative to the scroller's own box, so a moving scroller
  // doesn't skew the delta.
  static snapshot() {
    const entries = {};

    for (const scroller of document.querySelectorAll("[data-scroll-follow]")) {
      const id = scroller.getAttribute("data-scroll-follow");

      if (atEnd(scroller)) {
        entries[id] = {atEnd: true};
        continue;
      }

      const scrollerRect = scroller.getBoundingClientRect();

      for (const candidate of scroller.querySelectorAll("[data-anchor]")) {
        const rect = candidate.getBoundingClientRect();

        if (rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom) {
          entries[id] = {
            atEnd: false,
            key: candidate.getAttribute("data-anchor"),
            top: rect.top - scrollerRect.top,
          };

          break;
        }
      }
    }

    return entries;
  }

  // All corrections use explicit behavior: "instant" — a bare scrollTop assignment obeys the
  // container's scroll-behavior, so a `scroll-behavior: smooth` scroller would ANIMATE them;
  // corrections maintain an illusion and never animate.
  static restore(entries) {
    for (const scroller of document.querySelectorAll("[data-scroll-follow]")) {
      const id = scroller.getAttribute("data-scroll-follow");
      const firstSeen = !FollowEdge.seenIds.has(id);

      if (firstSeen) {
        FollowEdge.seenIds.add(id);
      }

      // A scroller carrying `data-scroll-animating` has DECLARED an intentional animated scroll
      // (the app sets it around a smooth scrollIntoView and clears it on scrollend): stand down
      // entirely — any scrollTo, even a positional no-op or a tiny delta measured against the
      // moving position, CANCELS the animation (browser-caught: a dispatch landing mid-centering
      // froze the jump-to-divider animation wherever it happened to be). Corrections maintain
      // illusions; they yield to declared intent.
      if (scroller.hasAttribute("data-scroll-animating")) continue;

      const entry = entries[id];

      if (firstSeen || (entry && entry.atEnd)) {
        // Pin only when the patch actually LEFT the end — a positional no-op must not issue a
        // scroll call, because any programmatic scroll (even to the current position) aborts an
        // in-flight smooth scroll an action just started (e.g. a smooth scrollIntoView centering
        // a jump target: it begins at the end, and an unconditional re-pin here killed it).
        if (!atEnd(scroller)) {
          pinToEnd(scroller);
        }

        continue;
      }

      if (!entry) continue;

      const anchor = scroller.querySelector(
        `[data-anchor="${CSS.escape(entry.key)}"]`,
      );

      if (!anchor) continue;

      const delta =
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        entry.top;

      if (delta !== 0) {
        scroller.scrollTo({
          top: scroller.scrollTop + delta,
          left: scroller.scrollLeft,
          behavior: "instant",
        });
      }
    }

    FollowEdge.#syncGrowthObservations();
  }

  // -- rule (1)'s continuous half: follow content growth between patches (see header) --
  //
  // Shape (each piece browser-caught, in order):
  //   * Baselines are re-recorded SYNCHRONOUSLY at every sync (layout is already clean there —
  //     restore() just read it), so patch-time height changes are ABSORBED and deliveries diff
  //     only what changed between patches. Gating deliveries against a pre-patch baseline
  //     instead double-handled the patch: a window slide's rewritten sections read as huge
  //     "growth" that yanked a mid-history reader to the end (verify_window's ascend).
  //   * A follow, once started, is STICKY — it pins on every growth without re-consulting the
  //     gate. The gate alone starved mid-grow: each pin's scroll event renders a throttled
  //     scroll tick, whose re-sync absorbs growth the pin hasn't caught up on into the
  //     baseline; that shortfall leaks out of the delta and "was at the end before this
  //     growth" turns permanently false 2-3 frames in (diag_grow probe: one pin, then
  //     fromEnd climbing monotonically).
  //   * The follow ends only on evidence the reader LEFT: a scrollTop DECREASE (at the end,
  //     away is up — growth and pins both increase scrollTop), a declared animated scroll, or
  //     the scroller changing content identity.

  // Baseline height per observed element (see above: re-recorded at every sync).
  static #lastHeights = new WeakMap();

  // Scrollers whose reader is being held at the end through between-patch growth.
  static #following = new WeakSet();

  // Scrollers whose leave-detection scroll listener is attached (the listener is permanent per
  // element; a replaced DOM node just gets a fresh one on the next sync).
  static #watched = new WeakSet();

  // Last seen scrollTop per watched scroller — a decrease is the reader leaving the end.
  static #lastScrollTops = new WeakMap();

  // Last seen data-scroll-follow id per scroller ELEMENT. The vdom reuses nodes, so a channel
  // switch can hand this element new content under a new id — a follow must not survive that
  // (the new content may enter mid-history via scroll memory).
  static #followIds = new WeakMap();

  // Constructed lazily on first sync — NOT as a field initializer, which would run at module
  // load and throw in environments without the API (jsdom in the test suite provides none).
  static #growthObserver = null;

  // Re-synced after every patch (from restore()): observe each opted-in scroller's boxed
  // content roots. Roots, not every descendant — a grown descendant grows its root, and the
  // gate only needs the scroller-level delta.
  static #syncGrowthObservations() {
    if (typeof ResizeObserver === "undefined") return;

    FollowEdge.#growthObserver ??= new ResizeObserver((entries) =>
      FollowEdge.#followGrowth(entries),
    );

    FollowEdge.#growthObserver.disconnect();

    for (const scroller of document.querySelectorAll("[data-scroll-follow]")) {
      const id = scroller.getAttribute("data-scroll-follow");

      if (FollowEdge.#followIds.get(scroller) !== id) {
        FollowEdge.#followIds.set(scroller, id);
        FollowEdge.#following.delete(scroller);
      }

      if (!FollowEdge.#watched.has(scroller)) {
        FollowEdge.#watched.add(scroller);
        FollowEdge.#lastScrollTops.set(scroller, scroller.scrollTop);

        scroller.addEventListener(
          "scroll",
          () => {
            const previous = FollowEdge.#lastScrollTops.get(scroller);
            FollowEdge.#lastScrollTops.set(scroller, scroller.scrollTop);

            if (scroller.scrollTop < previous) {
              FollowEdge.#following.delete(scroller);
            }
          },
          {passive: true},
        );
      }

      for (const root of FollowEdge.#boxedContentRoots(scroller)) {
        FollowEdge.#lastHeights.set(
          root,
          root.getBoundingClientRect().height,
        );

        FollowEdge.#growthObserver.observe(root, {box: "border-box"});
      }
    }
  }

  // The scroller's direct children, descending through display:contents wrappers (a component
  // host element, e.g. a typing indicator's) — those generate NO box, so a ResizeObserver on
  // them never fires; their children carry the boxes that actually grow.
  static #boxedContentRoots(scroller) {
    const roots = [];

    const collect = (parent) => {
      for (const child of parent.children) {
        if (getComputedStyle(child).display === "contents") {
          collect(child);
        } else {
          roots.push(child);
        }
      }
    };

    collect(scroller);

    return roots;
  }

  // Runs after layout and BEFORE paint (ResizeObserver's slot in the rendering steps), so the
  // pin lands in the same frame as the growth it follows — the reader never sees a clipped
  // frame. Pinning changes scrollTop, never a size, so the observer can't hear its own
  // corrections (no feedback loop).
  static #followGrowth(entries) {
    // Sum each scroller's growth first: two roots growing in one frame must gate as one delta.
    const grown = new Map();

    for (const entry of entries) {
      const height =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const previous = FollowEdge.#lastHeights.get(entry.target);
      FollowEdge.#lastHeights.set(entry.target, height);

      // First sight (nothing to diff) or a shrink (the browser's own scrollTop clamp already
      // keeps an at-end reader at the end): record only. Sub-pixel noise between the sync-time
      // rect read and borderBoxSize is harmless: near the end the atEnd() guard skips the
      // no-op pin; away from it a <1px delta can never bridge the gate.
      if (previous === undefined || height <= previous) continue;

      const scroller = entry.target.closest("[data-scroll-follow]");
      if (!scroller) continue;

      grown.set(scroller, (grown.get(scroller) ?? 0) + (height - previous));
    }

    for (const [scroller, delta] of grown) {
      // Same stand-down as restore(), plus ending the follow: a declared animated scroll is
      // the app moving the reader somewhere ON PURPOSE — holding the end past it would yank
      // them right back.
      if (scroller.hasAttribute("data-scroll-animating")) {
        FollowEdge.#following.delete(scroller);
        continue;
      }

      const fromEnd =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;

      // Start a follow on "was at the end before this growth" — anything further off than the
      // growth itself is a reader who wasn't at the end (leave them to rule (2)). Once
      // following, pin without re-consulting the gate (see the header: sticky). The atEnd()
      // guard mirrors restore(): a positional no-op must not issue a scroll call (it would
      // abort an in-flight smooth scroll).
      if (
        FollowEdge.#following.has(scroller) ||
        fromEnd - delta <= AT_END_SLACK
      ) {
        FollowEdge.#following.add(scroller);

        if (!atEnd(scroller)) {
          pinToEnd(scroller);
        }
      }
    }
  }
}
