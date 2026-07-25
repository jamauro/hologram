# credo:disable-for-this-file Credo.Check.Readability.Specs
defmodule Hologram.Test.Fixtures.Component.Module9 do
  @moduledoc """
  Defines its OWN init/3 — server-side setup the client can't reproduce, so it must NOT be given a
  default init/2 (being created client-side has to keep raising).
  """

  use Hologram.Component

  @impl Component
  def init(_props, component, server), do: {put_state(component, :a, 1), server}

  @impl Component
  def template do
    ~HOLO""
  end
end
