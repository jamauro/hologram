defmodule HologramFeatureTests.Events.IntersectPage do
  use Hologram.Page

  import Hologram.Commons.KernelUtils, only: [inspect: 1]
  import Kernel, except: [inspect: 1]

  route "/events/intersect"

  layout HologramFeatureTests.Components.DefaultLayout

  def init(_params, component, _server) do
    put_state(component, intersecting: nil)
  end

  def template do
    ~HOLO"""
    <div style="height: 2000px">Spacer pushes the sentinel below the fold</div>
    <div $intersect="record" id="sentinel" style="height: 10px">Sentinel</div>
    <p>Intersecting: <strong id="result"><code>{inspect(@intersecting)}</code></strong></p>
    """
  end

  def action(:record, %{event: %{is_intersecting: intersecting}}, component) do
    put_state(component, :intersecting, intersecting)
  end
end
