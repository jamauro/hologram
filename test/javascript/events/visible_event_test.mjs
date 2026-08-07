"use strict";

import {
  assert,
  defineRuntimeGlobals,
} from "../support/helpers.mjs";

import VisibleEvent from "../../../assets/js/events/visible_event.mjs";
import Type from "../../../assets/js/type.mjs";

defineRuntimeGlobals();

describe("VisibleEvent", () => {
  describe("isEventIgnored()", () => {
    let originalDocument;

    beforeEach(() => {
      originalDocument = globalThis.document;
    });

    afterEach(() => {
      globalThis.document = originalDocument;
    });

    it("dispatches when the document is now visible", () => {
      globalThis.document = {visibilityState: "visible"};

      assert.deepStrictEqual(VisibleEvent.isEventIgnored({}), false);
    });

    it("ignores the transition to hidden", () => {
      globalThis.document = {visibilityState: "hidden"};

      assert.deepStrictEqual(VisibleEvent.isEventIgnored({}), true);
    });
  });

  describe("buildOperationParam()", () => {
    it("builds an empty payload (always visible by the time it dispatches)", () => {
      assert.deepStrictEqual(VisibleEvent.buildOperationParam({}), Type.map([]));
    });
  });
});
