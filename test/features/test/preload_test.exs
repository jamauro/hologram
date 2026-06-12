defmodule HologramFeatureTests.PreloadTest do
  use HologramFeatureTests.TestCase, async: true

  alias HologramFeatureTests.Preload.Page1

  # The Host component emits context and preloads/destroys the WarmedComponent. WarmedComponent, on
  # init, forwards the scope it saw to the host's init_log - so init_log records every time the
  # component's init ran, and which context it inherited each time (even while it is off-DOM).

  feature "put_preload warms a component off-DOM, inheriting the preloader's context", %{
    session: session
  } do
    session
    |> visit(Page1)
    |> assert_text(css("#init_log"), ~r/\[\]/)
    # Preload: the component inits off-DOM (it is never rendered yet - #warmed is absent), and its
    # init inherits the host's context, so init_log records the host's scope, not the prop default.
    |> click(css("button[id='preload']"))
    |> assert_text(css("#init_log"), ~r/\["scope-from-host"\]/)
    |> refute_has(css("#warmed"))
    # Show: it renders, but init is NOT run again (init_log still has a single entry), and it
    # displays the inherited scope.
    |> click(css("button[id='show']"))
    |> assert_text(css("#warmed_scope"), "scope-from-host")
    |> assert_text(css("#init_log"), ~r/\["scope-from-host"\]/)
  end

  feature "put_destroy evicts a retained component so it re-initializes on next render", %{
    session: session
  } do
    session
    |> visit(Page1)
    |> click(css("button[id='preload']"))
    |> click(css("button[id='show']"))
    |> assert_text(css("#warmed_scope"), "scope-from-host")
    # Un-render then render again: the component is retained, so init does NOT run again - init_log
    # still has exactly one entry.
    |> click(css("button[id='hide']"))
    |> click(css("button[id='show']"))
    |> assert_text(css("#init_log"), ~r/\["scope-from-host"\]/)
    # Destroy then render again: the entry is evicted, so init runs a second time - init_log now has
    # two entries.
    |> click(css("button[id='hide']"))
    |> click(css("button[id='destroy']"))
    |> click(css("button[id='show']"))
    |> assert_text(css("#init_log"), ~r/\["scope-from-host", "scope-from-host"\]/)
  end
end
