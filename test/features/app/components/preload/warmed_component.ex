defmodule HologramFeatureTests.Components.Preload.WarmedComponent do
  use Hologram.Component

  prop :scope, :string, from_context: {:preload, :scope}, default: "DEFAULT"

  # Client-side init (used when the component is preloaded off-DOM and when it is first rendered).
  # Stores the inherited scope and queues an action that forwards it to the page, so that the fact
  # that init ran - and the scope it saw - is observable in page state even while the component is
  # not rendered.
  def init(props, component) do
    component
    |> put_state(:scope, props.scope)
    |> put_action(:record)
  end

  def action(:record, _params, component) do
    put_action(component,
      name: :record_init,
      target: "host",
      params: %{scope: component.state.scope}
    )
  end

  def template do
    ~HOLO"""
    <div id="warmed">Warmed scope: <strong id="warmed_scope">{@scope}</strong></div>
    """
  end
end
