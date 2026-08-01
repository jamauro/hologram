import {
  assert,
  assertBoxedError,
  contextFixture,
  defineGlobalErlangAndElixirModules,
} from "../support/helpers.mjs";

import Elixir_Enum from "../../../assets/js/elixir/enum.mjs";
import Erlang from "../../../assets/js/erlang/erlang.mjs";
import Interpreter from "../../../assets/js/interpreter.mjs";
import Type from "../../../assets/js/type.mjs";

defineGlobalErlangAndElixirModules();

// IMPORTANT!
// Each JavaScript test has a related Elixir consistency test in test/elixir/hologram/ex_js_consistency/elixir/enum_test.exs
// Always update both together.

// These ports exist because the transpiled versions recurse once per element with no tail-call
// optimization — the deep-list cases are the regression tests for the resulting stack overflow.
const DEEP_COUNT = 100_000;

const deepList = Type.list(
  Array.from({length: DEEP_COUNT}, (_unused, i) => Type.integer(i)),
);

const list = Type.list([Type.integer(1), Type.integer(2), Type.integer(3)]);

const improperList = Type.improperList([
  Type.integer(1),
  Type.integer(2),
  Type.integer(3),
]);

const eqFun = (value) =>
  Type.anonymousFunction(
    1,
    [
      {
        params: (_context) => [Type.variablePattern("elem")],
        guards: [],
        body: (context) => {
          return Erlang["==/2"](context.vars.elem, Type.integer(value));
        },
      },
    ],
    contextFixture(),
  );

describe("Elixir_Enum", () => {
  describe("drop/2", () => {
    const drop = Elixir_Enum["drop/2"];

    it("drops the given number of elements from the front", () => {
      const result = drop(list, Type.integer(2));

      assert.deepStrictEqual(result, Type.list([Type.integer(3)]));
    });

    it("returns the list itself when the amount is 0", () => {
      assert.strictEqual(drop(list, Type.integer(0)), list);
    });

    it("returns an empty list when the amount covers the whole list", () => {
      const result = drop(list, Type.integer(5));

      assert.deepStrictEqual(result, Type.list());
    });

    it("drops from the end when the amount is negative", () => {
      const result = drop(list, Type.integer(-2));

      assert.deepStrictEqual(result, Type.list([Type.integer(1)]));
    });

    it("returns an empty list when a negative amount covers the whole list", () => {
      const result = drop(list, Type.integer(-5));

      assert.deepStrictEqual(result, Type.list());
    });

    it("materializes a non-list enumerable", () => {
      const result = drop(Type.range(1, 5, 1), Type.integer(3));

      assert.deepStrictEqual(
        result,
        Type.list([Type.integer(4), Type.integer(5)]),
      );
    });

    it("raises FunctionClauseError when the amount is not an integer", () => {
      assertBoxedError(
        () => drop(list, Type.atom("abc")),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("Enum.drop/2", [
          list,
          Type.atom("abc"),
        ]),
      );
    });

    it("raises FunctionClauseError when dropping past the improper tail", () => {
      assertBoxedError(
        () => drop(improperList, Type.integer(5)),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("Enumerable.List.reduce/3"),
      );
    });

    it("does not overflow the stack on a deep list", () => {
      const result = drop(deepList, Type.integer(DEEP_COUNT - 1));

      assert.deepStrictEqual(
        result,
        Type.list([Type.integer(DEEP_COUNT - 1)]),
      );
    });
  });

  describe("find_index/2", () => {
    const findIndex = Elixir_Enum["find_index/2"];

    it("returns the index of the first element for which the fun is truthy", () => {
      const result = findIndex(list, eqFun(2));

      assert.deepStrictEqual(result, Type.integer(1));
    });

    it("returns nil when no element matches", () => {
      const result = findIndex(list, eqFun(4));

      assert.deepStrictEqual(result, Type.nil());
    });

    it("treats a non-boolean fun result as truthy", () => {
      const elemFun = Type.anonymousFunction(
        1,
        [
          {
            params: (_context) => [Type.variablePattern("elem")],
            guards: [],
            body: (context) => {
              return context.vars.elem;
            },
          },
        ],
        contextFixture(),
      );

      const result = findIndex(list, elemFun);

      assert.deepStrictEqual(result, Type.integer(0));
    });

    it("materializes a non-list enumerable", () => {
      const result = findIndex(Type.range(1, 5, 1), eqFun(4));

      assert.deepStrictEqual(result, Type.integer(3));
    });

    it("raises FunctionClauseError when the walk reaches the improper tail", () => {
      assertBoxedError(
        () => findIndex(improperList, eqFun(4)),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("Enumerable.List.reduce/3"),
      );
    });

    it("does not overflow the stack on a deep list", () => {
      const result = findIndex(deepList, eqFun(DEEP_COUNT - 1));

      assert.deepStrictEqual(result, Type.integer(DEEP_COUNT - 1));
    });
  });

  describe("take/2", () => {
    const take = Elixir_Enum["take/2"];

    it("takes the given number of elements from the front", () => {
      const result = take(list, Type.integer(2));

      assert.deepStrictEqual(
        result,
        Type.list([Type.integer(1), Type.integer(2)]),
      );
    });

    it("returns an empty list when the amount is 0", () => {
      const result = take(list, Type.integer(0));

      assert.deepStrictEqual(result, Type.list());
    });

    it("returns the list itself when the amount covers the whole list", () => {
      assert.strictEqual(take(list, Type.integer(5)), list);
    });

    it("takes from the end when the amount is negative", () => {
      const result = take(list, Type.integer(-2));

      assert.deepStrictEqual(
        result,
        Type.list([Type.integer(2), Type.integer(3)]),
      );
    });

    it("returns the list itself when a negative amount covers the whole list", () => {
      assert.strictEqual(take(list, Type.integer(-5)), list);
    });

    it("materializes a non-list enumerable", () => {
      const result = take(Type.range(1, 5, 1), Type.integer(2));

      assert.deepStrictEqual(
        result,
        Type.list([Type.integer(1), Type.integer(2)]),
      );
    });

    it("raises FunctionClauseError when the amount is not an integer", () => {
      assertBoxedError(
        () => take(list, Type.atom("abc")),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("Enum.take/2", [
          list,
          Type.atom("abc"),
        ]),
      );
    });

    it("raises FunctionClauseError when taking past the improper tail", () => {
      assertBoxedError(
        () => take(improperList, Type.integer(5)),
        "FunctionClauseError",
        Interpreter.buildFunctionClauseErrorMsg("Enumerable.List.reduce/3"),
      );
    });

    it("does not overflow the stack on a deep list", () => {
      const result = take(deepList, Type.integer(DEEP_COUNT));

      assert.strictEqual(result, deepList);
    });
  });
});
