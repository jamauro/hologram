"use strict";

import Type from "../type.mjs";

export default class VisibleEvent {
  // visibilitychange is not cancelable, so preventDefault would be a no-op.
  static isDefaultAllowed = true;

  // The DOM visibilitychange event fires in BOTH directions; $visible means "the tab/page became
  // visible again", so the transitions to hidden are ignored — only a now-visible document
  // dispatches. Bound via a <document> tag (visibilitychange is a document event, not element-level).
  static isEventIgnored(_event) {
    return document.visibilityState !== "visible";
  }

  // No meaningful payload: hidden transitions are filtered out, so the document is always visible
  // when this dispatches.
  static buildOperationParam(_event) {
    return Type.map([]);
  }
}
