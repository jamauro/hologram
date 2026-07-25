defmodule Hologram.Test.Fixtures.Template.Renderer.Module87 do
  use Hologram.Component

  alias Hologram.Test.Fixtures.Template.Renderer.Module32

  @impl Component
  def template do
    ~HOLO"""
<<<<<<< HEAD
    87a,<Module32>87b,<{"div"}><slot /></{"div"}>,87x,</Module32>87z
=======
    <div>
      <Module86 row={%{id: "a"}} />
      <Module86 row={%{id: "b"}} />
    </div>
>>>>>>> a6435c1a9 (Give components an identity and a parent, so call sites stop spelling both)
    """
  end
end
