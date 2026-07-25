defmodule Hologram.Test.Fixtures.Template.Renderer.Module90 do
  @moduledoc """
  Keys its rows EXPLICITLY, and repeats plain elements rather than components — the key lands on the
  element as `data-key`. The items carry no `:id`, so nothing would be keyed implicitly.
  """

  use Hologram.Component

  prop :items, :list

  @impl Component
  def template do
    ~HOLO"""
    {%for item <- @items, key: item.slug}<div>{@items != [] && item.slug}</div>{/for}
    """
  end
end
