# credo:disable-for-this-file Credo.Check.Readability.Specs
defmodule Hologram.Test.Fixtures.Component.Module7 do
  @moduledoc """
  Handles a fixed set of named actions — the enumerable case for __action_names__/0. `:my_action_a`
  appears in two clauses on purpose, to cover deduplication.
  """

  use Hologram.Component

  def action(:my_action_a, %{first?: true}, component), do: component
  def action(:my_action_b, _params, component), do: component
  def action(:my_action_a, _params, component), do: component

  def template do
    ~HOLO""
  end
end
