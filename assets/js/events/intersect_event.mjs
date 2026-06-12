"use strict";

import Type from "../type.mjs";

export default class IntersectEvent {
  // An intersection observation is not cancelable, so preventDefault would be a no-op.
  static isDefaultAllowed = true;

  // Fired by an IntersectionObserver whenever the bound element enters or leaves its root (the
  // viewport by default), i.e. when it crosses the observer's intersection threshold.
  // The payload snapshots the IntersectionObserverEntry, so the handler can act on entering vs
  // leaving (is_intersecting) or partial visibility (intersection_ratio).
  static buildOperationParam(entry) {
    return Type.map([
      [Type.atom("is_intersecting"), Type.boolean(entry.isIntersecting)],
      [Type.atom("intersection_ratio"), Type.float(entry.intersectionRatio)],
    ]);
  }

  static isEventIgnored(_event) {
    return false;
  }
}
