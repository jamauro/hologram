defmodule HologramFeatureTests.Components.Preload.Host do
  use Hologram.Component

  import Hologram.Commons.KernelUtils, only: [inspect: 1]
  import Kernel, except: [inspect: 1]

  alias HologramFeatureTests.Components.Preload.WarmedComponent

  def init(_props, component, _server) do
    component
    |> put_context({:preload, :scope}, "scope-from-host")
    |> put_state(:show, false)
    |> put_state(:init_log, [])
  end

  def template do
    ~HOLO"""
    <button id="preload" $click="preload">Preload</button>
    <button id="show" $click="show">Show</button>
    <button id="hide" $click="hide">Hide</button>
    <button id="destroy" $click="destroy">Destroy</button>
    <p>
      Init log: <strong id="init_log"><code>{inspect(@init_log)}</code></strong>
    </p>
    {%if @show}
      <WarmedComponent cid="warmed" />
    {/if}
    """
  end

  def action(:preload, _params, component) do
    put_preload(component, WarmedComponent, "warmed")
  end

  def action(:show, _params, component) do
    put_state(component, :show, true)
  end

  def action(:hide, _params, component) do
    put_state(component, :show, false)
  end

  def action(:destroy, _params, component) do
    put_destroy(component, "warmed")
  end

  def action(:record_init, params, component) do
    put_state(component, :init_log, component.state.init_log ++ [params.scope])
  end
end
