defmodule Hologram.Test.Fixtures.Template.Renderer.Module95 do
  @moduledoc """
  A stateful parent whose keyed children (Module94) infer their cids, so their resolved cids are
  scoped by this component's own cid.
  """

  use Hologram.Component

  alias Hologram.Test.Fixtures.Template.Renderer.Module94

  @impl Component
  def template do
    ~HOLO"""
    87a,<Module32>87b,<{"div"}><slot /></{"div"}>,87x,</Module32>87z
=======
    <span>{@item.id}</span>
    """
  end
end
