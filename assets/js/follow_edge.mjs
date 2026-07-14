"use strict";

// PATCH (follow-edge) — downstream fork patch; the other hunk (tagged the same) is in
// hologram.mjs render().
//
// A normal-flow chat scroller gets reading-position stability from NATIVE CSS scroll anchoring
// (which works only in normal flow — browsers suppress it in column-reverse, crbug.com/1102592),
// but "this scroller rests at its end" is not a browser behavior: content appended while the
// view sits at the bottom edge grows scrollHeight and leaves scrollTop behind, and a freshly
// mounted scroller starts at the top. This declares that one missing rule for scrollers opted
// in via `data-scroll-follow="<unique id>"`:
//
//   - at the end before a patch ⇒ returned to the end right after it (tail-stick);
//   - the first time an id is seen ⇒ pinned to the end (the initial position);
//   - away from the end ⇒ untouched — native anchoring owns stability there.
//
// The id is a content identity (e.g. a channel id), so a reused DOM node whose id changes
// counts as a fresh scroller, and a snapshot taken under the old id can't leak onto the new one.

const AT_END_SLACK = 2;

export default class FollowEdge {
  // Ids already given their initial end-pin (page entry / first mount of that content).
  static seenIds = new Set();

  // {id: wasAtEnd} for every opted-in scroller, taken just before the DOM patch.
  static snapshot() {
    const entries = {};

    for (const scroller of document.querySelectorAll("[data-scroll-follow]")) {
      entries[scroller.getAttribute("data-scroll-follow")] =
        scroller.scrollTop >=
        scroller.scrollHeight - scroller.clientHeight - AT_END_SLACK;
    }

    return entries;
  }

  static restore(entries) {
    for (const scroller of document.querySelectorAll("[data-scroll-follow]")) {
      const id = scroller.getAttribute("data-scroll-follow");
      const firstSeen = !FollowEdge.seenIds.has(id);

      if (firstSeen) {
        FollowEdge.seenIds.add(id);
      }

      if (firstSeen || entries[id]) {
        // Explicit behavior: "instant" — a bare scrollTop assignment obeys the container's
        // scroll-behavior, so a `scroll-behavior: smooth` scroller would ANIMATE the correction;
        // corrections maintain an illusion and never animate.
        scroller.scrollTo({
          top: scroller.scrollHeight - scroller.clientHeight,
          left: scroller.scrollLeft,
          behavior: "instant",
        });
      }
    }
  }
}
