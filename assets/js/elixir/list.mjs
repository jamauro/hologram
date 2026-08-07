"use strict";

import Interpreter from "../interpreter.mjs";
import Type from "../type.mjs";

// Ported for the same reason as the Enum walks: the transpiled version recurses once per element
// with no tail-call optimization, so a deep list overflows the JS stack. The boxed list already
// holds its elements in an array — the last one is a direct read.

const Elixir_List = {
  // Deps: [List.last/2]
  "last/1": (list) => Elixir_List["last/2"](list, Type.nil()),

  "last/2": function (list, defaultValue) {
    if (!Type.isList(list)) {
      Interpreter.raiseFunctionClauseError("List", "last", 2, [
        ...arguments,
      ]);
    }

    if (list.data.length === 0) {
      return defaultValue;
    }

    if (!Type.isProperList(list)) {
      // The recursive clauses fail on the improper tail.
      // Client-side error message is intentionally simplified.
      Interpreter.raiseFunctionClauseError("List", "last", 2);
    }

    return list.data.at(-1);
  },
};

export default Elixir_List;
