defmodule Hologram.Test.Fixtures.Template.Renderer.Module87 do
  @moduledoc """
  A stateful parent whose keyed children (Module86) infer their cids, so their resolved cids are
  scoped by this component's own cid.
  """

  use Hologram.Component

  alias Hologram.Test.Fixtures.Template.Renderer.Module86

  @impl Component
  def template do
    ~HOLO"""
    <div>
      <Module86 row={%{id: "a"}} />
      <Module86 row={%{id: "b"}} />
    </div>
    """
  end
end
