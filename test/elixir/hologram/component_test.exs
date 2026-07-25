defmodule Hologram.ComponentTest do
  use Hologram.Test.BasicCase, async: true

  import Hologram.Component

  alias Hologram.Component
  alias Hologram.Component.Action
  alias Hologram.Component.Command
  alias Hologram.Reflection
  alias Hologram.Server
  alias Hologram.Server.Broadcast
  alias Hologram.Test.Fixtures.Component.Module1
  alias Hologram.Test.Fixtures.Component.Module2
  alias Hologram.Test.Fixtures.Component.Module3
  alias Hologram.Test.Fixtures.Component.Module4
  alias Hologram.Test.Fixtures.Component.Module5
  alias Hologram.Test.Fixtures.Component.Module7
  alias Hologram.Test.Fixtures.Component.Module8
  alias Hologram.Test.Fixtures.Component.Module9

  @server %Server{cid: "page"}

  test "__is_hologram_component__/0" do
    assert Module1.__is_hologram_component__()
  end

  describe "__action_names__/0" do
    test "lists the handled action names, sorted and deduplicated" do
      assert Module7.__action_names__() == [:my_action_a, :my_action_b]
    end

    test "a catch-all clause claims every action name" do
      assert Module8.__action_names__() == :any
    end

    test "a component with no action/3 clause handles nothing" do
      assert Module4.__action_names__() == []
    end
  end

  test "__props__/0" do
    assert Module4.__props__() == [{:a, :string, []}, {:b, :integer, [opt_1: 111, opt_2: 222]}]
  end

  test "colocated_template_path/1" do
    assert colocated_template_path("/my_dir_1/my_dir_2/my_dir_3/my_file.ex") ==
             "/my_dir_1/my_dir_2/my_dir_3/my_file.holo"
  end

  describe "delete_subscription/2" do
    test "removes {channel, server.cid} from server.subscriptions" do
      result =
        @server
        |> put_subscription(:room_a)
        |> delete_subscription(:room_a)

      assert result.subscriptions == []
    end

    test "leaves bindings for other cids intact (encapsulation)" do
      server_with_layout_binding = %{@server | subscriptions: [{:room_a, "layout"}]}

      result = delete_subscription(server_with_layout_binding, :room_a)

      assert result.subscriptions == [{:room_a, "layout"}]
    end

    test "records :delete in subscription_ops keyed by {channel, server.cid}" do
      result = delete_subscription(@server, :room_a)

      assert result.__meta__.subscription_ops == %{{:room_a, "page"} => :delete}
    end

    test "records :delete even when {channel, cid} is not present in server.subscriptions" do
      result = delete_subscription(@server, :room_a)

      assert result.subscriptions == []
      assert result.__meta__.subscription_ops == %{{:room_a, "page"} => :delete}
    end

    test "raises ArgumentError for an invalid channel" do
      assert_raise ArgumentError, fn -> delete_subscription(@server, "not_a_valid_channel") end
    end
  end

  describe "init/2" do
    test "default implementation returns the component unchanged" do
      # The docs promise both init callbacks are optional. Without this default, a component with no
      # init at all renders on the server but throws the moment it is created client-side instead of
      # hydrated — see Component.build_init_2_clause/1.
      assert Module1.init(%{a: 1}, build_component_struct()) == build_component_struct()
    end

    test "NOT defaulted when the component defines its own init/3" do
      # Server-side setup can't be reproduced on the client, so those must keep raising there rather
      # than silently starting from empty state.
      refute Reflection.has_function?(Module9, :init, 2)
    end

    test "overridden implementation" do
      assert Module2.init(:props_dummy, build_component_struct()) == %Component{
               state: %{overriden: true}
             }
    end
  end

  describe "init/3" do
    test "default implementation" do
      assert Reflection.has_function?(Module1, :init, 3)
    end

    test "overridden implementation" do
      assert Module2.init(:props_dummy, build_component_struct(), build_server_struct()) ==
               {%Component{state: %{overriden: true}}, %Server{}}
    end
  end

  describe "maybe_register_colocated_template_markup/1" do
    test "valid template path" do
      template_path = "#{@fixtures_dir}/component/template_7.holo"

      assert maybe_register_colocated_template_markup(template_path) ==
               {:@, [context: Hologram.Component, imports: [{1, Kernel}]],
                [
                  {:__colocated_template_markup__, [context: Hologram.Component],
                   ["My template 7"]}
                ]}
    end

    test "invalid template path" do
      refute maybe_register_colocated_template_markup("/my_invalid_template_path.holo")
    end
  end

  describe "put_action/2, component struct" do
    test "name" do
      result = put_action(%Component{}, :my_action)

      assert result == %Component{
               next_action: %Action{name: :my_action, params: %{}, target: nil}
             }
    end

    test "spec: name" do
      result = put_action(%Component{}, name: :my_action)

      assert result == %Component{
               next_action: %Action{name: :my_action, params: %{}, target: nil}
             }
    end

    test "spec: params" do
      result = put_action(%Component{}, params: [a: 1, b: 2])

      assert result == %Component{
               next_action: %Action{name: nil, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "spec: target" do
      result = put_action(%Component{}, target: "my_target")

      assert result == %Component{
               next_action: %Action{name: nil, target: "my_target", params: %{}}
             }
    end

    test "spec: delay" do
      result = put_action(%Component{}, delay: 500)

      assert result == %Component{
               next_action: %Action{name: nil, params: %{}, target: nil, delay: 500}
             }
    end

    test "spec: name, params, target, delay" do
      result =
        put_action(%Component{},
          name: :my_action,
          params: [a: 1, b: 2],
          target: "my_target",
          delay: 500
        )

      assert result == %Component{
               next_action: %Action{
                 name: :my_action,
                 params: %{a: 1, b: 2},
                 target: "my_target",
                 delay: 500
               }
             }
    end
  end

  describe "put_action/2, server struct" do
    test "name" do
      result = put_action(%Server{}, :my_action)

      assert result == %Server{
               next_action: %Action{name: :my_action, params: %{}, target: nil}
             }
    end

    test "spec: name" do
      result = put_action(%Server{}, name: :my_action)

      assert result == %Server{
               next_action: %Action{name: :my_action, params: %{}, target: nil}
             }
    end

    test "spec: params" do
      result = put_action(%Server{}, params: [a: 1, b: 2])

      assert result == %Server{
               next_action: %Action{name: nil, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "spec: target" do
      result = put_action(%Server{}, target: "my_target")

      assert result == %Server{
               next_action: %Action{name: nil, target: "my_target", params: %{}}
             }
    end

    test "spec: delay" do
      result = put_action(%Server{}, delay: 750)

      assert result == %Server{
               next_action: %Action{name: nil, params: %{}, target: nil, delay: 750}
             }
    end

    test "spec: name, params, target, delay" do
      result =
        put_action(%Server{},
          name: :my_action,
          params: [a: 1, b: 2],
          target: "my_target",
          delay: 750
        )

      assert result == %Server{
               next_action: %Action{
                 name: :my_action,
                 params: %{a: 1, b: 2},
                 target: "my_target",
                 delay: 750
               }
             }
    end
  end

  describe "put_action/3, component struct" do
    test "accepts params as keyword list" do
      result = put_action(%Component{}, :my_action, a: 1, b: 2)

      assert result == %Component{
               next_action: %Action{name: :my_action, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "accepts params as a map" do
      result = put_action(%Component{}, :my_action, %{a: 1, b: 2})

      assert result == %Component{
               next_action: %Action{name: :my_action, params: %{a: 1, b: 2}, target: nil}
             }
    end
  end

  describe "put_action/3, server struct" do
    test "accepts params as keyword list" do
      result = put_action(%Server{}, :my_action, a: 1, b: 2)

      assert result == %Server{
               next_action: %Action{name: :my_action, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "accepts params as a map" do
      result = put_action(%Server{}, :my_action, %{a: 1, b: 2})

      assert result == %Server{
               next_action: %Action{name: :my_action, params: %{a: 1, b: 2}, target: nil}
             }
    end
  end

  describe "put_broadcast/* (common behavior)" do
    test "prepends so multiple calls accumulate in reverse-of-call order" do
      result =
        @server
        |> put_broadcast({:room, 1}, :first)
        |> put_broadcast({:room, 2}, :second)

      assert result.broadcasts == [
               %Broadcast{channel: {:room, 2}, action_name: :second, params: %{}},
               %Broadcast{channel: {:room, 1}, action_name: :first, params: %{}}
             ]
    end

    test "raises at the call site when the channel is invalid" do
      assert_error ArgumentError,
                   "channel must be a bare atom or tagged tuple; got bare string \"bad-channel\"",
                   fn -> put_broadcast(@server, "bad-channel", :foo) end
    end
  end

  describe "put_broadcast/3" do
    test "defaults params to an empty map" do
      result = put_broadcast(@server, {:room, 42}, :refresh)

      assert result.broadcasts == [
               %Broadcast{channel: {:room, 42}, action_name: :refresh, params: %{}}
             ]
    end
  end

  describe "put_broadcast/4" do
    test "accepts params as a keyword list" do
      result = put_broadcast(@server, {:room, 42}, :append_message, text: "hi")

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :append_message,
                 params: %{text: "hi"}
               }
             ]
    end

    test "accepts params as a map" do
      result = put_broadcast(@server, {:room, 42}, :append_message, %{text: "hi"})

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :append_message,
                 params: %{text: "hi"}
               }
             ]
    end
  end

  describe "put_broadcast_except/* (common behavior)" do
    # Tests here cover what's shared across all put_broadcast_except arities:
    # the single-tuple-vs-list normalization on except, and validator wiring.
    # Per-arity tests below focus on the params dispatch surface.

    test "wraps a single identity tuple into a list and stores on except" do
      result = put_broadcast_except(@server, {:user, "u1"}, {:room, 42}, :refresh)

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :refresh,
                 params: %{},
                 except: [{:user, "u1"}]
               }
             ]
    end

    test "stores a list of identities unchanged on except" do
      except = [{:user, "u1"}, {:session, "s1"}, {:instance, "i1"}]

      result = put_broadcast_except(@server, except, {:room, 42}, :refresh)

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :refresh,
                 params: %{},
                 except: except
               }
             ]
    end

    test "raises at the call site when the channel is invalid" do
      assert_error ArgumentError,
                   "channel must be a bare atom or tagged tuple; got bare string \"bad-channel\"",
                   fn -> put_broadcast_except(@server, {:user, "u1"}, "bad-channel", :foo) end
    end
  end

  describe "put_broadcast_except/4" do
    test "defaults params to an empty map" do
      result = put_broadcast_except(@server, {:user, "u1"}, {:room, 42}, :refresh)

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :refresh,
                 params: %{},
                 except: [{:user, "u1"}]
               }
             ]
    end
  end

  describe "put_broadcast_except/5" do
    test "accepts params as a keyword list" do
      result =
        put_broadcast_except(@server, {:user, "u1"}, {:room, 42}, :append_message, text: "hi")

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :append_message,
                 params: %{text: "hi"},
                 except: [{:user, "u1"}]
               }
             ]
    end

    test "accepts params as a map" do
      result =
        put_broadcast_except(@server, {:user, "u1"}, {:room, 42}, :append_message, %{text: "hi"})

      assert result.broadcasts == [
               %Broadcast{
                 channel: {:room, 42},
                 action_name: :append_message,
                 params: %{text: "hi"},
                 except: [{:user, "u1"}]
               }
             ]
    end
  end

  describe "put_command/2" do
    test "name" do
      result = put_command(%Component{}, :my_command)

      assert result == %Component{
               next_command: %Command{name: :my_command, params: %{}, target: nil}
             }
    end

    test "spec: name" do
      result = put_command(%Component{}, name: :my_command)

      assert result == %Component{
               next_command: %Command{name: :my_command, params: %{}, target: nil}
             }
    end

    test "spec: params" do
      result = put_command(%Component{}, params: [a: 1, b: 2])

      assert result == %Component{
               next_command: %Command{name: nil, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "spec: target" do
      result = put_command(%Component{}, target: "my_target")

      assert result == %Component{
               next_command: %Command{name: nil, target: "my_target", params: %{}}
             }
    end
  end

  describe "put_command/3" do
    test "accepts params as keyword list" do
      result = put_command(%Component{}, :my_command, a: 1, b: 2)

      assert result == %Component{
               next_command: %Command{name: :my_command, params: %{a: 1, b: 2}, target: nil}
             }
    end

    test "accepts params as a map" do
      result = put_command(%Component{}, :my_command, %{a: 1, b: 2})

      assert result == %Component{
               next_command: %Command{name: :my_command, params: %{a: 1, b: 2}, target: nil}
             }
    end
  end

  describe "put_destroy/2" do
    test "records the cid to destroy" do
      result = put_destroy(%Component{}, "my_cid")

      assert result == %Component{next_destroy: "my_cid"}
    end

    test "overwrites a previously recorded cid" do
      result = put_destroy(%Component{next_destroy: "old_cid"}, "new_cid")

      assert result == %Component{next_destroy: "new_cid"}
    end
  end

  test "put_context/3" do
    component = %Component{emitted_context: %{a: 1}}

    assert put_context(component, :b, 2) == %Component{
             emitted_context: %{a: 1, b: 2}
           }
  end

  test "put_page/2" do
    assert put_page(%Component{}, MyPage) == %Component{next_page: MyPage}
  end

  test "put_page/3" do
    assert put_page(%Component{}, MyPage, a: 1, b: 2) == %Component{
             next_page: {MyPage, a: 1, b: 2}
           }
  end

  describe "put_warm/3 and put_warm/4" do
    test "records a warm spec with the given module, cid and props" do
      result = put_warm(%Component{}, MyComponent, "my_cid", %{a: 1})

      assert result == %Component{
               next_warms: [%{cid: "my_cid", module: MyComponent, props: %{a: 1}}]
             }
    end

    test "defaults props to an empty map" do
      result = put_warm(%Component{}, MyComponent, "my_cid")

      assert result == %Component{
               next_warms: [%{cid: "my_cid", module: MyComponent, props: %{}}]
             }
    end

    test "accumulates, prepending so later calls come first" do
      result =
        %Component{}
        |> put_warm(MyComponent, "cid_1")
        |> put_warm(MyComponent, "cid_2")

      assert result == %Component{
               next_warms: [
                 %{cid: "cid_2", module: MyComponent, props: %{}},
                 %{cid: "cid_1", module: MyComponent, props: %{}}
               ]
             }
    end
  end

  describe "put_state/2" do
    test "keyword" do
      component = %Component{state: %{a: 1}}

      assert put_state(component, b: 2, c: 3) == %Component{
               state: %{a: 1, b: 2, c: 3}
             }
    end

    test "map" do
      component = %Component{state: %{a: 1}}

      assert put_state(component, %{b: 2, c: 3}) == %Component{
               state: %{a: 1, b: 2, c: 3}
             }
    end

    test "no-op when every entry equals the current value (state keeps its identity)" do
      component = %Component{state: %{a: 1, b: 2}}

      assert put_state(component, %{a: 1, b: 2}) === component
    end

    test "writes when any entry differs" do
      component = %Component{state: %{a: 1, b: 2}}

      assert put_state(component, %{a: 1, b: 3}) == %Component{state: %{a: 1, b: 3}}
    end

    # Regression: the no-op guard must use exact equality, not a pattern match — on the
    # client a map value in a pattern subset-matches (%{} matches ANY map), so a shrunken
    # map read "unchanged" and the write was discarded.
    test "writes when a map value lost keys" do
      component = %Component{state: %{a: %{x: 1, y: 2}}}

      assert put_state(component, %{a: %{x: 1}}) == %Component{state: %{a: %{x: 1}}}
      assert put_state(component, %{a: %{}}) == %Component{state: %{a: %{}}}
    end
  end

  describe "put_state/3" do
    test "no-op when the value equals the current one; a missing key still writes" do
      component = %Component{state: %{a: 1, b: nil}}

      assert put_state(component, :a, 1) === component
      assert put_state(component, :b, nil) === component
      assert put_state(component, :c, nil) == %Component{state: %{a: 1, b: nil, c: nil}}
    end

    # Regression: see put_state/2 "writes when a map value lost keys".
    test "writes when a map value lost keys" do
      component = %Component{state: %{a: %{x: 1, y: 2}}}

      assert put_state(component, :a, %{x: 1}) == %Component{state: %{a: %{x: 1}}}
      assert put_state(component, :a, %{}) == %Component{state: %{a: %{}}}
    end

    test "non-nested path" do
      component = %Component{state: %{a: 1, b: 2}}
      result = put_state(component, :b, 3)

      assert result == %Component{
               state: %{a: 1, b: 3}
             }
    end

    test "nested path, map" do
      component = %Component{state: %{a: 1, b: %{c: 2, d: 3}}}
      result = put_state(component, [:b, :d], 4)

      assert result == %Component{state: %{a: 1, b: %{c: 2, d: 4}}}
    end

    test "nested path, struct" do
      component = %Component{state: %{a: 1, b: %Module5{x: 2, y: 3}}}
      result = put_state(component, [:b, :y], 4)

      assert result == %Component{state: %{a: 1, b: %Module5{x: 2, y: 4}}}
    end
  end

  describe "put_subscription/2" do
    test "appends {channel, server.cid} to server.subscriptions" do
      result = put_subscription(@server, :room_a)

      assert result.subscriptions == [{:room_a, "page"}]
    end

    test "records :put in subscription_ops keyed by {channel, server.cid}" do
      result = put_subscription(@server, :room_a)

      assert result.__meta__.subscription_ops == %{{:room_a, "page"} => :put}
    end

    test "server.subscriptions and __meta__.subscription_ops stay in sync across multiple calls" do
      result =
        @server
        |> put_subscription(:room_a)
        |> put_subscription(:room_b)

      assert MapSet.new(result.subscriptions) ==
               MapSet.new([{:room_a, "page"}, {:room_b, "page"}])

      assert result.__meta__.subscription_ops == %{
               {:room_a, "page"} => :put,
               {:room_b, "page"} => :put
             }
    end

    test "deduplicates when the same {channel, cid} key is put again" do
      result =
        @server
        |> put_subscription(:room_a)
        |> put_subscription(:room_a)

      assert result.subscriptions == [{:room_a, "page"}]
      assert result.__meta__.subscription_ops == %{{:room_a, "page"} => :put}
    end

    test "raises ArgumentError for an invalid channel" do
      assert_raise ArgumentError, fn -> put_subscription(@server, "not_a_valid_channel") end
    end
  end

  describe "template/0" do
    test "function" do
      assert Module1.template().(%{}) == [text: "Module1 template"]
    end

    test "file (colocated)" do
      result = Module3.template().(%{})

      assert [
               {:text, text},
               {:component, Hologram.UI.Link,
                [{"to", [expression: {Hologram.Test.Fixtures.Component.Module6}]}],
                [text: "Module6"]}
             ] = result

      assert normalize_newlines(text) == "Module3 template\n"
    end
  end
end
