# credo:disable-for-this-file Credo.Check.Readability.Specs
defmodule Hologram.Test.Fixtures.Component.Module8 do
  @moduledoc """
  Has a catch-all action clause, so it claims every action name — the `:any` case for
  __action_names__/0.
  """

  use Hologram.Component

  def action(:my_action_a, _params, component), do: component
  def action(_name, _params, component), do: component

  def template do
    ~HOLO""
  end
end
