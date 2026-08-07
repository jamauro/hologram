"use strict";

import Interpreter from "../interpreter.mjs";
import Type from "../type.mjs";

// These functions are ported because their transpiled versions are hand-recursive and the client
// has no tail-call optimization: one recursion step per element overflows the JS stack near
// ~1,800 elements. Iterating the underlying array keeps stack depth constant.
//
// Non-list enumerables are normalized through the transpiled Enum.to_list/1, which is always
// bundled (it is a client-runtime MFA of the interpreter class). It is resolved through the
// module proxy at call time — ported and transpiled Enum functions share that proxy.

const properListData = (enumerable) => {
  if (Type.isList(enumerable)) {
    if (!Type.isProperList(enumerable)) {
      // Intentionally stricter than the BEAM, which raises only when the walk reaches the
      // improper tail (drop/take can even return an improper remainder before that point).
      // Client-side error message is intentionally simplified.
      Interpreter.raiseFunctionClauseError(
        "Enumerable.List",
        "reduce",
        3,
      );
    }

    return enumerable.data;
  }

  return globalThis.Elixir_Enum["to_list/1"](enumerable).data;
};

const Elixir_Enum = {
  // Deps: [Enum.to_list/1]
  "drop/2": function (enumerable, amount) {
    if (!Type.isInteger(amount)) {
      Interpreter.raiseFunctionClauseError("Enum", "drop", 2, [
        ...arguments,
      ]);
    }

    const data = properListData(enumerable);
    const n = Number(amount.value);

    if (n === 0 && Type.isList(enumerable)) {
      return enumerable;
    }

    return Type.list(
      n >= 0 ? data.slice(n) : data.slice(0, Math.max(data.length + n, 0)),
    );
  },

  // Deps: [Enum.to_list/1]
  "find_index/2": function (enumerable, fun) {
    const data = properListData(enumerable);

    for (let i = 0; i < data.length; i++) {
      if (Type.isTruthy(Interpreter.callAnonymousFunction(fun, [data[i]]))) {
        return Type.integer(i);
      }
    }

    return Type.nil();
  },

  // Deps: [Enum.to_list/1]
  "take/2": function (enumerable, amount) {
    if (!Type.isInteger(amount)) {
      Interpreter.raiseFunctionClauseError("Enum", "take", 2, [
        ...arguments,
      ]);
    }

    const data = properListData(enumerable);
    const n = Number(amount.value);

    if (Type.isList(enumerable) && (n >= data.length || -n >= data.length)) {
      return enumerable;
    }

    return Type.list(
      n >= 0 ? data.slice(0, n) : data.slice(Math.max(data.length + n, 0)),
    );
  },
};

export default Elixir_Enum;
