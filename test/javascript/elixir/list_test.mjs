import {
  assert,
  assertBoxedError,
  defineGlobalErlangAndElixirModules,
} from "../support/helpers.mjs";

import Elixir_List from "../../../assets/js/elixir/list.mjs";
import Interpreter from "../../../assets/js/interpreter.mjs";
import Type from "../../../assets/js/type.mjs";

defineGlobalErlangAndElixirModules();

// IMPORTANT!
// Each JavaScript test has a related Elixir consistency test in test/elixir/hologram/ex_js_consistency/elixir/list_test.exs
// Always update both together.

const list = Type.list([Type.integer(1), Type.integer(2), Type.integer(3)]);

const improperList = Type.improperList([
  Type.integer(1),
  Type.integer(2),
  Type.integer(3),
]);

describe("Elixir_List", () => {
  describe("last/1", () => {
    const last = Elixir_List["last/1"];

    it("returns the last element", () => {
      assert.deepStrictEqual(last(list), Type.integer(3));
    });

    it("returns nil for an empty list", () => {
      assert.deepStrictEqual(last(Type.list()), Type.nil());
    });

    it("does not overflow the stack on a deep list", () => {
      const deepList = Type.list(
        Array.from({length: 100_000}, (_unused, i) => Type.integer(i)),
      );

      assert.deepStrictEqual(last(deepList), Type.integer(99_999));
    });
  });

  describe("last/2", () => {
    const last = Elixir_List["last/2"];

    it("returns the last element of a non-empty list", () => {
      assert.deepStrictEqual(last(list, Type.atom("default")), Type.integer(3));
    });

    it("returns the default for an empty list", () => {
      assert.deepStrictEqual(
        last(Type.list(), Type.atom("default")),
        Type.atom("default"),
      );
    });

    it("raises FunctionClauseError when the argument is not a list", () => {
      assertBoxedError(
        () => last(Type.integer(123), Type.nil()),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("List.last/2", [
          Type.integer(123),
          Type.nil(),
        ]),
      );
    });

    it("raises FunctionClauseError on an improper list", () => {
      assertBoxedError(
        () => last(improperList, Type.nil()),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("List.last/2"),
      );
    });
  });
});
