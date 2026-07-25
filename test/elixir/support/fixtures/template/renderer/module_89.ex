defmodule Hologram.Test.Fixtures.Template.Renderer.Module89 do
  @moduledoc """
  A stateful parent whose keyed children (Module88) infer their cids, so their resolved cids are
  scoped by this component's own cid.
  """

  use Hologram.Component

  alias Hologram.Test.Fixtures.Template.Renderer.Module88

  @impl Component
  def template do
    ~HOLO"""
<<<<<<< HEAD
    87a,<Module32>87b,<{"div"}><slot /></{"div"}>,87x,</Module32>87z
=======
    <div>
      <Module88 row={%{id: "a"}} />
      <Module88 row={%{id: "b"}} />
    </div>
>>>>>>> a6435c1a9 (Give components an identity and a parent, so call sites stop spelling both)
    """
  end
end
