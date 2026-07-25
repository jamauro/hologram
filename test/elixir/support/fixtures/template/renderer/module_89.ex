defmodule Hologram.Test.Fixtures.Template.Renderer.Module89 do
  @moduledoc """
  A stateless-in-practice child whose identity comes from whatever keys it (a `{%for}`), never from
  itself — it defines no `key/1`.
  """

  use Hologram.Component

  prop :item, :map

  @impl Component
  def template do
    ~HOLO"""
    <div>
      <Module88 row={%{id: "a"}} />
      <Module88 row={%{id: "b"}} />
    </div>
=======
    <span>{@item.id}</span>
    """
  end
end
