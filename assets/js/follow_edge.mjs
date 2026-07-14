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

const AT_END_SLACK = 2;

function atEnd(scroller) {
  return (
    scroller.scrollTop >=
    scroller.scrollHeight - scroller.clientHeight - AT_END_SLACK
  );
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

      const entry = entries[id];

      if (firstSeen || (entry && entry.atEnd)) {
        scroller.scrollTo({
          top: scroller.scrollHeight - scroller.clientHeight,
          left: scroller.scrollLeft,
          behavior: "instant",
        });

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
  }
}
