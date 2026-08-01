defmodule Hologram.ExJsConsistency.Elixir.ListTest do
  @moduledoc """
  IMPORTANT!
  Each Elixir consistency test has a related JavaScript test in test/javascript/elixir/list_test.mjs
  Always update both together.

  The client-side error messages for improper lists are intentionally simplified,
  so the improper-list case asserts only the error type and function head.
  """

  use Hologram.Test.BasicCase, async: true

  @moduletag :consistency

  describe "last/1" do
    test "returns the last element" do
      assert List.last([1, 2, 3]) == 3
    end

    test "returns nil for an empty list" do
      assert List.last([]) == nil
    end
  end

  describe "last/2" do
    test "returns the last element of a non-empty list" do
      assert List.last([1, 2, 3], :default) == 3
    end

    test "returns the default for an empty list" do
      assert List.last([], :default) == :default
    end

    test "raises FunctionClauseError when the argument is not a list" do
      assert_raise FunctionClauseError,
                   ~r/no function clause matching in List\.last\/2/,
                   fn -> List.last(wrap_term(123), nil) end
    end

    test "raises FunctionClauseError on an improper list" do
      assert_raise FunctionClauseError,
                   ~r/no function clause matching in List\.last\/2/,
                   fn -> List.last(wrap_term([1, 2 | 3]), nil) end
    end
  end
end
