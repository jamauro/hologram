defmodule HologramFeatureTests.Preload.Page1 do
  use Hologram.Page

  alias HologramFeatureTests.Components.Preload.Host

  route "/preload/1"

  layout HologramFeatureTests.Components.DefaultLayout

  def template do
    ~HOLO"""
    <Host cid="host" />
    """
  end
end
