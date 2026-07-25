defmodule Hologram.Test.Fixtures.Template.Renderer.Module92 do
  @moduledoc """
  A generator whose enumerable carries its own commas AND a `key:` of its own inside a map literal —
  neither may be mistaken for the loop's key option, and the implicit key must still apply.
  """

  use Hologram.Component

  prop :items, :list

  @impl Component
  def template do
    ~HOLO"""
    {%for item <- pick(@items, %{key: :ignored, other: 1})}<div>{item.id}</div>{/for}
    """
  end

  def pick(items, _opts), do: items
end
