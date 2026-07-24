"use strict";

import Type from "../type.mjs";

// The native <dialog> `close` event — fired after ANY dismissal (Esc, backdrop light-dismiss under
// closedby, a command="close" button, or a method="dialog" submit). Bound as `$close={...}` on a
// <dialog>, it's the one hook that catches every close path, so a component can drive its open
// state (e.g. unmounting the dialog's body when it closes) off native semantics.
export default class CloseEvent {
  // `close` is not cancelable, so preventDefault would be a no-op — let the default through.
  static isDefaultAllowed = true;

  static buildOperationParam(_event) {
    return Type.map();
  }

  static isEventIgnored(_event) {
    return false;
  }
}
