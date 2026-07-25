defmodule Hologram.Test.Fixtures.Template.Renderer.Module93 do
  @moduledoc """
  Repeats with a DISCARDED binding — the loop must stay unkeyed and, above all, must not compile to
  code that reads an underscored variable.
  """

  use Hologram.Component

  @impl Component
  def template do
    ~HOLO"""
    {%for _i <- [1, 2, 3]}<div></div>{/for}
    """
  end
end
