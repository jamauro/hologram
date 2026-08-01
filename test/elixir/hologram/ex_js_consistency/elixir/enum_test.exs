defmodule Hologram.ExJsConsistency.Elixir.EnumTest do
  @moduledoc """
  IMPORTANT!
  Each Elixir consistency test has a related JavaScript test in test/javascript/elixir/enum_test.mjs
  Always update both together.

  The client-side error messages for improper lists are intentionally simplified,
  so the improper-list cases assert only the error type and function head.
  """

  use Hologram.Test.BasicCase, async: true

  @moduletag :consistency

  @list [1, 2, 3]

  describe "drop/2" do
    test "drops the given number of elements from the front" do
      assert Enum.drop(@list, 2) == [3]
    end

    test "returns the list itself when the amount is 0" do
      assert Enum.drop(@list, 0) == @list
    end

    test "returns an empty list when the amount covers the whole list" do
      assert Enum.drop(@list, 5) == []
    end

    test "drops from the end when the amount is negative" do
      assert Enum.drop(@list, -2) == [1]
    end

    test "returns an empty list when a negative amount covers the whole list" do
      assert Enum.drop(@list, -5) == []
    end

    test "materializes a non-list enumerable" do
      assert Enum.drop(1..5, 3) == [4, 5]
    end

    test "raises FunctionClauseError when the amount is not an integer" do
      assert_raise FunctionClauseError,
                   ~r/no function clause matching in Enum\.drop\/2/,
                   fn -> Enum.drop(@list, wrap_term(:abc)) end
    end

    # The client raises as soon as it sees an improper list; the BEAM raises only when the walk
    # reaches the improper tail (and names the private walker in the message) — so this asserts
    # a tail-reaching case and only the error type.
    test "raises FunctionClauseError when dropping past the improper tail" do
      assert_raise FunctionClauseError, fn -> Enum.drop(wrap_term([1, 2 | 3]), 5) end
    end
  end

  describe "find_index/2" do
    test "returns the index of the first element for which the fun is truthy" do
      assert Enum.find_index(@list, &(&1 == 2)) == 1
    end

    test "returns nil when no element matches" do
      assert Enum.find_index(@list, &(&1 == 4)) == nil
    end

    test "treats a non-boolean fun result as truthy" do
      assert Enum.find_index(@list, & &1) == 0
    end

    test "materializes a non-list enumerable" do
      assert Enum.find_index(1..5, &(&1 == 4)) == 3
    end

    # The client raises as soon as it sees an improper list; the BEAM raises only when the walk
    # reaches the improper tail (and names the private walker in the message) — so the predicate
    # here must not match within the proper prefix, and only the error type is asserted.
    test "raises FunctionClauseError when the walk reaches the improper tail" do
      assert_raise FunctionClauseError, fn ->
        Enum.find_index(wrap_term([1, 2 | 3]), &(&1 == 4))
      end
    end
  end

  describe "take/2" do
    test "takes the given number of elements from the front" do
      assert Enum.take(@list, 2) == [1, 2]
    end

    test "returns an empty list when the amount is 0" do
      assert Enum.take(@list, 0) == []
    end

    test "returns the list itself when the amount covers the whole list" do
      assert Enum.take(@list, 5) == @list
    end

    test "takes from the end when the amount is negative" do
      assert Enum.take(@list, -2) == [2, 3]
    end

    test "returns the list itself when a negative amount covers the whole list" do
      assert Enum.take(@list, -5) == @list
    end

    test "materializes a non-list enumerable" do
      assert Enum.take(1..5, 2) == [1, 2]
    end

    test "raises FunctionClauseError when the amount is not an integer" do
      assert_raise FunctionClauseError,
                   ~r/no function clause matching in Enum\.take\/2/,
                   fn -> Enum.take(@list, wrap_term(:abc)) end
    end

    # The client raises as soon as it sees an improper list; the BEAM raises only when the walk
    # reaches the improper tail (and names the private walker in the message) — so this asserts
    # a tail-reaching case and only the error type.
    test "raises FunctionClauseError when taking past the improper tail" do
      assert_raise FunctionClauseError, fn -> Enum.take(wrap_term([1, 2 | 3]), 5) end
    end
  end
end
