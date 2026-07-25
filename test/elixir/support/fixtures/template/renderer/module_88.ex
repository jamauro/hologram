defmodule Hologram.Test.Fixtures.Template.Renderer.Module88 do
  @moduledoc """
  Infers its cid from its props via key/1 instead of taking one at the call site.
  """

  use Hologram.Component

  prop :row, :map

  def key(props), do: props.row.id

  @impl Component
  def template do
    ~HOLO"""
    <div>row = {@row.id}</div>
    """
  end
end
