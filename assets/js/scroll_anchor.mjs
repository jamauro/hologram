"use strict";

// PATCH (scroll-anchor) — downstream fork patch; the other hunk (tagged the same) is in
// hologram.mjs render().
//
// Browsers implement CSS scroll anchoring for normal flow but suppress it inside
// `flex-direction: column-reverse` scrollers (crbug.com/1102592) — exactly where chat-style panes
// live. In reversed flow the coordinate space is bottom-anchored, so a patch that changes content
// BELOW the viewport (e.g. a sliding message window dropping its newest rows) shifts every
// distance-from-bottom and teleports the view; the browser corrects nothing. This fills that gap
// at the one place the framework has an "after render" moment: snapshot straddling the Snabbdom
// patch, restore right after it.
//
// Opt-in contract:
//   - the scroll container carries `data-scroll-anchor="<unique id>"`
//   - anchorable descendants carry `data-anchor="<stable key>"` — stable across renders (an
//     entity id, never a positional index), so Snabbdom's positional node reuse can't lie about
//     which content an element holds.
//
// A scroller at scrollTop === 0 sits at its native rest edge (the stick-to-bottom edge in
// reversed flow, the top in normal flow), where native behavior is already correct — skipped, so
// tail-stick and explicit scroll-to-rest are never fought. A snapshot whose anchor key is gone
// after the patch (window swap, navigation) restores nothing.
export default class ScrollAnchor {
  // {scrollerId: {key, top}} for every opted-in scroller away from rest, keyed on the first
  // anchorable descendant visible in its viewport. Offsets are relative to the scroller's own
  // box, so a moving scroller doesn't skew the delta.
  static snapshot() {
    const entries = {};

    for (const scroller of document.querySelectorAll("[data-scroll-anchor]")) {
      if (scroller.scrollTop === 0) continue;

      const scrollerRect = scroller.getBoundingClientRect();

      for (const candidate of scroller.querySelectorAll("[data-anchor]")) {
        const rect = candidate.getBoundingClientRect();

        if (rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom) {
          entries[scroller.getAttribute("data-scroll-anchor")] = {
            key: candidate.getAttribute("data-anchor"),
            top: rect.top - scrollerRect.top,
          };

          break;
        }
      }
    }

    return entries;
  }

  static restore(entries) {
    for (const [scrollerId, {key, top}] of Object.entries(entries)) {
      const scroller = document.querySelector(
        `[data-scroll-anchor="${CSS.escape(scrollerId)}"]`,
      );

      if (!scroller) continue;

      const anchor = scroller.querySelector(
        `[data-anchor="${CSS.escape(key)}"]`,
      );

      if (!anchor) continue;

      const delta =
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        top;

      // Explicit behavior: "instant" — a bare scrollTop assignment obeys the container's
      // scroll-behavior, so a `scroll-behavior: smooth` scroller would ANIMATE the correction:
      // frames mid-animation show the un-anchored position, and anything sampling during them
      // (IntersectionObserver callbacks, the next render's snapshot) acts on stale geometry.
      if (delta !== 0) {
        scroller.scrollTo({
          top: scroller.scrollTop + delta,
          left: scroller.scrollLeft,
          behavior: "instant",
        });
      }
    }
  }
}
