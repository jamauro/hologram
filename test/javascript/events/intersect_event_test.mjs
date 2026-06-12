"use strict";

import {
  assert,
  defineGlobalErlangAndElixirModules,
} from "../support/helpers.mjs";

import IntersectEvent from "../../../assets/js/events/intersect_event.mjs";
import Type from "../../../assets/js/type.mjs";

defineGlobalErlangAndElixirModules();

describe("IntersectEvent", () => {
  describe("buildOperationParam()", () => {
    it("builds a payload from an intersecting observer entry", () => {
      const entry = {isIntersecting: true, intersectionRatio: 0.42};

      const result = IntersectEvent.buildOperationParam(entry);

      assert.deepStrictEqual(
        result,
        Type.map([
          [Type.atom("is_intersecting"), Type.boolean(true)],
          [Type.atom("intersection_ratio"), Type.float(0.42)],
        ]),
      );
    });

    it("reports a non-intersecting (leaving) entry", () => {
      const entry = {isIntersecting: false, intersectionRatio: 0};

      const result = IntersectEvent.buildOperationParam(entry);

      assert.deepStrictEqual(
        result,
        Type.map([
          [Type.atom("is_intersecting"), Type.boolean(false)],
          [Type.atom("intersection_ratio"), Type.float(0)],
        ]),
      );
    });
  });
});
