defmodule Mix.Tasks.Holo.Compiler.PageExFunSizesTest do
  use Hologram.Test.BasicCase, async: true
  import ExUnit.CaptureIO
  alias Mix.Tasks.Holo.Compiler.PageExFunSizes, as: Task

  test "run/1" do
    arg = "Hologram.Test.Fixtures.Mix.Tasks.Holo.Compiler.PageExFunSizes.Module1"

    output =
      capture_io(fn ->
        assert Task.run([arg]) == :ok
      end)

    expected_pattern =
      normalize_newlines("""
      \[
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :template, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.LayoutFixture, :template, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :__route__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :__params__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :__layout_module__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.LayoutFixture, :__props__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :__action_names__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :__layout_props__, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.LayoutFixture, :init, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :fun_1, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.Mix\.Tasks\.Holo\.Compiler\.PageExFunSizes\.Module1,
          :fun_2, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.LayoutFixture, :resume, [[:alnum:]]+\}, [[:alnum:]]+\},
        \{\{Hologram\.Test\.Fixtures\.LayoutFixture, :__action_names__, [[:alnum:]]+\}, [[:alnum:]]+\}
      \]
      """)

    assert output =~ Regex.compile!(expected_pattern)
  end
end
