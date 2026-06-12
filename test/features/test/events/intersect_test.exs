defmodule HologramFeatureTests.Events.IntersectTest do
  use HologramFeatureTests.TestCase, async: true

  alias HologramFeatureTests.Events.IntersectPage

  feature "the intersect event fires with the intersection state as the element enters the viewport",
          %{session: session} do
    session = visit(session, IntersectPage)

    # The sentinel sits below a 2000px spacer (out of view), so the IntersectionObserver's first
    # fire reports it is not intersecting.
    session
    |> assert_text(css("#result"), "false")
    # Scrolling it into view fires again with is_intersecting true.
    |> execute_script("document.getElementById('sentinel').scrollIntoView();")
    |> assert_text(css("#result"), "true")
  end
end
