defmodule HologramFeatureTests.Warm.Page1 do
  use Hologram.Page

  alias HologramFeatureTests.Components.Warm.Host

  route "/warm/1"

  layout HologramFeatureTests.Components.DefaultLayout

  def template do
    ~HOLO"""
    <Host cid="host" />
    """
  end
end
