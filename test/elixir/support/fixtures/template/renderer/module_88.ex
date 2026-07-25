defmodule Hologram.Test.Fixtures.Template.Renderer.Module88 do
  @moduledoc """
  Renders keyed children from a `{%for}` — no `cid` at the call site and no `key/1` of its own, so the
  identity comes entirely from the loop (implicitly, off each item's `:id`).
  """

  use Hologram.Component

  alias Hologram.Test.Fixtures.Template.Renderer.Module89

  prop :items, :list

  @impl Component
  def template do
    ~HOLO"""
    {%for item <- @items}<Module89 item={item} />{/for}
    """
  end
end
