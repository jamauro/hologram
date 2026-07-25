defmodule Hologram.Test.Fixtures.Template.Renderer.Module91 do
  @moduledoc """
  Repeats items with no `:id` and no explicit key — must stay unkeyed, exactly as `{%for}` behaved
  before keys existed.
  """

  use Hologram.Component

  prop :items, :list

  @impl Component
  def template do
    ~HOLO"""
    {%for item <- @items}<div>{item}</div>{/for}
    """
  end
end
