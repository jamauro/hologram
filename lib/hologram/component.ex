defmodule Hologram.Component do
  alias Hologram.Commons.MapUtils
  alias Hologram.Commons.Types, as: T
  alias Hologram.Compiler.AST
  alias Hologram.Component
  alias Hologram.Realtime.Channel
  alias Hologram.Server
  alias Hologram.Server.Broadcast

  defstruct emitted_context: %{},
            next_action: nil,
            next_command: nil,
            next_page: nil,
            next_destroy: nil,
            next_warms: [],
            state: %{}

  defmodule Action do
    defstruct delay: 0, name: nil, params: %{}, target: nil

    @type t :: %__MODULE__{
            delay: non_neg_integer,
            name: atom(),
            params: %{atom => any},
            target: String.t() | nil
          }
  end

  defmodule Command do
    defstruct name: nil, params: %{}, target: nil

    @type t :: %__MODULE__{name: atom(), params: %{atom => any}, target: String.t() | nil}
  end

  @type t :: %__MODULE__{
          emitted_context: %{atom => any} | %{{module, atom} => any},
          next_action: Action.t() | nil,
          next_command: Command.t() | nil,
          next_page: module | {module, keyword},
          next_destroy: String.t() | nil,
          next_warms: [%{cid: String.t(), module: module, props: %{atom => any}}],
          state: %{atom => any}
        }

  @doc """
  Handles a client-side action, typically triggered by a user interaction.
  """
  @callback action(atom, %{atom => any}, Component.t()) :: Component.t()

  @doc """
  Handles a server-side command dispatched from the client.
  """
  @callback command(atom, %{atom => any}, Server.t()) :: Server.t()

  @doc """
  Initializes the component struct on the client.
  """
  @callback init(%{atom => any}, Component.t()) :: Component.t()

  @doc """
  Initializes the component and server structs on the server.
  """
  @callback init(%{atom => any}, Component.t(), Server.t()) ::
              {Component.t(), Server.t()} | Component.t() | Server.t()

  @doc """
  Called on each re-subscribed component when the realtime stream resumes after a reconnect gap,
  so it can catch up on broadcasts missed while disconnected. The sibling to `init/2` on the
  reconnect axis: `init` runs once at lifecycle start, `resume` runs on each subsequent resume.
  Optional — the default is a no-op, so a component that doesn't care about reconnect ignores it.
  """
  @callback resume(Component.t()) :: Component.t()

  @doc """
  Returns a template in the form of an anonymous function that given variable bindings returns a DOM.
  """
  @callback template() :: (map -> list)

  @optional_callbacks [action: 3, command: 3, init: 2, resume: 1]

  @doc false
  @spec __helper_imports__() :: keyword
  def __helper_imports__ do
    [
      delete_subscription: 2,
      put_action: 2,
      put_action: 3,
      put_broadcast: 3,
      put_broadcast: 4,
      put_broadcast_except: 4,
      put_broadcast_except: 5,
      put_command: 2,
      put_command: 3,
      put_context: 3,
      put_destroy: 2,
      put_page: 2,
      put_page: 3,
      put_warm: 3,
      put_warm: 4,
      put_state: 2,
      put_state: 3,
      put_subscription: 2
    ]
  end

  defmacro __using__(_opts) do
    template_path = colocated_template_path(__CALLER__.file)

    [
      quote do
        @behaviour Component

        use Hologram.Middleware.Builder

        import Hologram.Component, only: unquote([prop: 2, prop: 3] ++ __helper_imports__())
        import Hologram.Router.Helpers, only: [asset_path: 1, page_path: 1, page_path: 2]
        import Hologram.Server, only: unquote(Hologram.Server.__helper_imports__())
        import Hologram.Template, only: [sigil_HOLO: 2]

        alias Hologram.Component
        alias Hologram.Component.Action
        alias Hologram.Component.Command

        @before_compile Component

        Module.register_attribute(__MODULE__, :__action_names__, accumulate: true)

        @external_resource unquote(template_path)

        @doc """
        Returns true to indicate that the callee module is a component module (has "use Hologram.Component" directive).

        ## Examples

            iex> __is_hologram_component__()
            true
        """
        @spec __is_hologram_component__() :: boolean
        def __is_hologram_component__, do: true

        @impl Component
        def init(_props, component, server), do: {component, server}

        defoverridable init: 3

        # Reconnect catch-up hook (see the `resume/1` callback docs). The default no-op is what makes
        # the framework's per-subscribed-component resume dispatch safe: a component that doesn't
        # override it simply ignores the reconnect signal instead of raising on an unhandled call.
        @impl Component
        def resume(component), do: component

        defoverridable resume: 1

        # Registered AFTER the defaults above ON PURPOSE: an @on_definition hook only sees
        # definitions that follow it, so everything it records is the component author's own code.
        # `__before_compile__` relies on that to tell "this module defines init/3" (server-side
        # initialization, which the client cannot reproduce) from "this module inherited the default
        # one above".
        @on_definition {Component, :__on_definition__}
      end,
      maybe_register_colocated_template_markup(template_path),
      register_props_accumulator()
    ]
  end

  defmacro __before_compile__(env) do
    template_clause = maybe_build_colocated_template_clause(env, Component)

    props_clause =
      quote do
        @doc """
        Returns the list of property definitions for the compiled component.
        """
        @spec __props__() :: list({atom, atom, keyword})
        def __props__, do: Enum.reverse(@__props__)
      end

    [template_clause, props_clause, build_action_names_clause(env), build_init_2_clause(env)]
  end

  # The docs promise that BOTH init callbacks are optional ("Hologram provides default
  # implementations"), but only init/3 has ever had a default — so a component with no init at all
  # renders fine on the server (where a missing init means an empty Component struct) and then throws
  # "is initialized on the client, but doesn't have init/2 implemented" the first time it is created
  # client-side rather than hydrated. That bites any component whose state is incidental, which is
  # exactly what a keyed list row is.
  #
  # The gate is the point. A module that defines its OWN init/3 is doing server-side setup the client
  # cannot reproduce — session, cookies, a DB read — and quietly handing it an empty struct would make
  # its state depend on where it happened to be first rendered. Those keep raising, loudly. Only a
  # component that never asked for initialization gets the default, whose behaviour then matches the
  # server's for the same module: an untouched Component struct.
  @spec build_init_2_clause(Macro.Env.t()) :: Macro.t()
  def build_init_2_clause(env) do
    if Module.defines?(env.module, {:init, 2}) or Module.get_attribute(env.module, :__own_init_3__) do
      quote do
      end
    else
      quote do
        @impl Component
        def init(_props, component), do: component
      end
    end
  end

  @doc """
  Accumulates the action names a component handles, so `__action_names__/0` can answer "does this
  component handle `:foo`?" without calling it. See `build_action_names_clause/1`.
  """
  @spec __on_definition__(Macro.Env.t(), atom, atom, list, list, list | nil) :: :ok
  def __on_definition__(env, _kind, :init, args, _guards, _body) when length(args) == 3 do
    Module.put_attribute(env.module, :__own_init_3__, true)
  end

  def __on_definition__(env, _kind, :action, [name_ast | _rest] = args, _guards, _body)
      when length(args) == 3 do
    # A literal atom pattern IS the atom in AST form; anything else (a variable, `_`, a map pattern)
    # matches action names this can't enumerate, so the module claims all of them.
    name = if is_atom(name_ast), do: name_ast, else: :any

    Module.put_attribute(env.module, :__action_names__, name)
  end

  def __on_definition__(_env, _kind, _name, _args, _guards, _body), do: :ok

  @doc """
  Builds the `__action_names__/0` clause: the sorted list of action names the module handles, or
  `:any` if it has a clause whose first argument isn't a literal atom.

  The client dispatcher reads it to bubble an action its target doesn't handle up to the nearest
  ancestor that does, which is what lets a deeply nested component dispatch without naming the cid
  of the component that owns the handler.
  """
  @spec build_action_names_clause(Macro.Env.t()) :: Macro.t()
  def build_action_names_clause(env) do
    names = Module.get_attribute(env.module, :__action_names__) || []

    action_names =
      if :any in names, do: :any, else: names |> Enum.uniq() |> Enum.sort()

    quote do
      @doc """
      Returns the action names this component handles, or `:any` for a catch-all clause.
      """
      @spec __action_names__() :: [atom] | :any
      def __action_names__, do: unquote(Macro.escape(action_names))
    end
  end

  @doc """
  Resolves the colocated template path for the given component module given its file path.
  """
  @spec colocated_template_path(String.t()) :: String.t()
  def colocated_template_path(templatable_path) do
    Path.rootname(templatable_path) <> ".holo"
  end

  @doc """
  Removes the subscription on `channel` for the current handler's component.

  The subscription is scoped to the component whose handler is running - the
  page in a page handler, the layout in a layout handler, or the component in a
  component handler. Takes effect after the handler returns successfully; if the
  handler raises, it is discarded along with the rest of the changes.

  Idempotent: removing a channel that is not subscribed is a no-op.
  """
  # Removes the {channel, server.cid} key from server.subscriptions and records
  # it as :delete in __meta__.subscription_ops; the framework drains
  # subscription_ops after a successful handler return to drive the
  # SubscriptionRegistry. The :delete op is recorded even when the key is absent
  # so the deletion still flushes to the registry. cid comes from server.cid,
  # set by the framework at handler entry ("page" / "layout" / component cid).
  @spec delete_subscription(Server.t(), atom | tuple) :: Server.t()
  def delete_subscription(server, channel) do
    Channel.validate!(channel)

    key = {channel, server.cid}

    new_subscriptions = List.delete(server.subscriptions, key)

    new_subscription_ops = Map.put(server.__meta__.subscription_ops, key, :delete)
    new_meta = %{server.__meta__ | subscription_ops: new_subscription_ops}

    %{server | subscriptions: new_subscriptions, __meta__: new_meta}
  end

  @doc """
  Builds the template clause for colocated template if markup is registered in module attribute.
  Returns nil if no colocated template is found.
  """
  @spec maybe_build_colocated_template_clause(Macro.Env.t(), module) :: AST.t()
  def maybe_build_colocated_template_clause(env, behaviour) do
    markup = Module.get_attribute(env.module, :__colocated_template_markup__)

    if markup do
      quote do
        @impl unquote(behaviour)
        def template do
          Hologram.Template.sigil_HOLO(unquote(markup), [])
        end
      end
    end
  end

  @doc """
  Registers colocated template markup in a module attribute if the template file exists.
  Returns nil if the template file doesn't exist.
  """
  @spec maybe_register_colocated_template_markup(String.t()) :: AST.t() | nil
  def maybe_register_colocated_template_markup(template_path) do
    if File.exists?(template_path) do
      markup = File.read!(template_path)

      quote do
        @__colocated_template_markup__ unquote(markup)
      end
    end
  end

  @doc """
  Accumulates the given property definition in __props__ module attribute.
  """
  @spec prop(atom, atom, T.opts()) :: Macro.t()
  defmacro prop(name, type, opts \\ []) do
    quote do
      Module.put_attribute(__MODULE__, :__props__, {unquote(name), unquote(type), unquote(opts)})
    end
  end

  @doc """
  Puts the given action spec to the component or server struct's next_action field.
  Next action will be executed by the client-side runtime after the specified delay (in milliseconds, defaults to 0).
  """
  @spec put_action(Component.t() | Server.t(), atom | keyword) :: Component.t() | Server.t()
  def put_action(struct, name_or_spec)

  def put_action(struct, name) when is_atom(name) do
    %{struct | next_action: %Action{name: name}}
  end

  def put_action(struct, spec) when is_list(spec) do
    name = spec[:name]
    params = Map.new(spec[:params] || [])
    target = spec[:target]
    delay = spec[:delay] || 0

    %{struct | next_action: %Action{name: name, params: params, target: target, delay: delay}}
  end

  @doc """
  Puts the given action spec to the component or server struct's next_action field.
  Next action will be executed by the client-side runtime after the specified delay (in milliseconds, defaults to 0).
  """
  @spec put_action(Component.t() | Server.t(), atom, keyword | map) :: Component.t() | Server.t()
  def put_action(struct, name, params) do
    %{struct | next_action: %Action{name: name, params: Map.new(params)}}
  end

  @doc """
  Queues an action broadcast to subscribers of `channel`.

  Sent after the handler returns successfully; if the handler raises, it is
  discarded along with the rest of the changes. Delivered to every cid that
  subscribed to the channel via `put_subscription` on each receiving connection.
  """
  # Appended to server.broadcasts; the framework flushes the queue after a
  # successful handler return.
  @spec put_broadcast(Server.t(), atom | tuple, atom) :: Server.t()
  def put_broadcast(server, channel, action_name) when is_atom(action_name) do
    append_broadcast(server, channel, action_name, %{})
  end

  @doc """
  Queues an action broadcast to subscribers of `channel` with the given params.
  See `put_broadcast/3` for delivery semantics.
  """
  @spec put_broadcast(Server.t(), atom | tuple, atom, keyword | map) :: Server.t()
  def put_broadcast(server, channel, action_name, params) when is_atom(action_name) do
    append_broadcast(server, channel, action_name, params)
  end

  @doc """
  Queues an action broadcast that excludes one or more identities from delivery.

  Like `put_broadcast/3` but takes an `except` argument naming identities
  (`{:instance, id}`, `{:session, id}`, `{:user, id}`) that should not receive
  the broadcast. `except` accepts either a single identity tuple or a list of
  identity tuples.
  """
  @spec put_broadcast_except(
          Server.t(),
          Broadcast.identity() | [Broadcast.identity()],
          atom | tuple,
          atom
        ) :: Server.t()
  def put_broadcast_except(server, except, channel, action_name) when is_atom(action_name) do
    append_broadcast(server, channel, action_name, %{}, except)
  end

  @doc """
  Like `put_broadcast_except/4` but with explicit params.
  """
  @spec put_broadcast_except(
          Server.t(),
          Broadcast.identity() | [Broadcast.identity()],
          atom | tuple,
          atom,
          keyword | map
        ) :: Server.t()
  def put_broadcast_except(server, except, channel, action_name, params)
      when is_atom(action_name) do
    append_broadcast(server, channel, action_name, params, except)
  end

  @doc """
  Puts the given command spec to the component's next_command field.
  Next command will be sent asynchronously to the server.
  """
  @spec put_command(Component.t(), atom | keyword) :: Component.t()
  def put_command(component, name_or_spec)

  def put_command(%Component{} = component, name) when is_atom(name) do
    %{component | next_command: %Command{name: name}}
  end

  def put_command(%Component{} = component, spec) when is_list(spec) do
    name = spec[:name]
    params = Map.new(spec[:params] || [])
    target = spec[:target]

    %{component | next_command: %Command{name: name, params: params, target: target}}
  end

  @doc """
  Puts the given command spec to the component's next_command field.
  Next command will be sent asynchronously to the server.
  """
  @spec put_command(Component.t(), atom, keyword | map) :: Component.t()
  def put_command(%Component{} = component, name, params) do
    %{component | next_command: %Command{name: name, params: Map.new(params)}}
  end

  @doc """
  Records a component `cid` to be destroyed after the current action finishes executing.

  Hologram retains a stateful component's state in the client-side registry even after the
  component stops being rendered, so revisiting it is instant. `put_destroy/2` evicts that
  retained entry, freeing its state - useful for bounding memory when many components have been
  visited (e.g. an LRU policy over conversation panes).

  Only safe for a `cid` that is not currently rendered; if the component is rendered again later
  it is re-initialized from scratch. Recording a destroy for a `cid` that is not registered is a
  no-op.
  """
  @spec put_destroy(Component.t(), String.t()) :: Component.t()
  def put_destroy(%Component{} = component, cid) do
    %{component | next_destroy: cid}
  end

  @doc """
  Puts the given key-value pair to the component's emitted_context field.
  Context emitted by a component is available to all of its child nodes.
  """
  @spec put_context(Component.t(), any, any) :: Component.t()
  def put_context(%{emitted_context: context} = component, key, value) do
    %{component | emitted_context: Map.put(context, key, value)}
  end

  @doc """
  Puts the given page module to the component's next_page field.
  The client will navigate to this page asynchronously after the current action finished executing.
  """
  @spec put_page(Component.t(), module) :: Component.t()
  def put_page(component, page_module) do
    %{component | next_page: page_module}
  end

  @doc """
  Puts the given page module and params to the component's next_page field (as a tuple).
  The client will navigate to this page asynchronously after the current action finished executing.
  """
  @spec put_page(Component.t(), module, keyword) :: Component.t()
  def put_page(component, page_module, params) do
    %{component | next_page: {page_module, params}}
  end

  @doc """
  Records a request to warm a stateful component off-DOM after the current action
  finishes executing.

  Warming runs the component's `init` (and any load it fires) under `cid`, registering it in the
  client-side registry **without rendering it**. When the component is later actually rendered for
  the first time, its state and data are already warm, so the first open is instant. `cid` is passed
  to `init` as the `:cid` prop (exactly as for a normal render), so an entity-bound component derives
  its data from its own cid and needs no extra props; `props` (default `%{}`) supplies anything else.

  The warmed component inherits context from the component that warms it - it resolves
  `from_context` props as if it were rendered, right then, as a child of the warmer.

  Accumulates: a single action may warm several components (e.g. predictive warming).
  """
  @spec put_warm(Component.t(), module, String.t(), map) :: Component.t()
  def put_warm(%Component{} = component, module, cid, props \\ %{}) do
    %{component | next_warms: [%{cid: cid, module: module, props: props} | component.next_warms]}
  end

  @doc """
  Puts the given key-value entries to the component state.
  """
  @spec put_state(Component.t(), keyword | map) :: Component.t()
  def put_state(component, entries)

  def put_state(component, entries) when is_list(entries) do
    put_state(component, Enum.into(entries, %{}))
  end

  def put_state(%{state: state} = component, entries) when is_map(entries) do
    # PATCH (no-op put_state): writing values equal to the current ones returns the component
    # UNCHANGED — the state term keeps its identity, so downstream change-detection (e.g. the
    # memoized renderer's reference checks) sees a genuine no-op instead of an equal-but-new
    # state map. A tick that learned nothing must not invalidate anything.
    # Explicit === equality, NOT a pin-match: the client compiler resolves pins into plain
    # terms inside patterns, where a map value degrades to map-PATTERN subset semantics
    # (%{} matches ANY map) — so a map that lost keys read "unchanged" and the write was
    # silently discarded (browser-caught: typing dots could never clear).
    if Enum.all?(entries, fn {key, value} -> Map.fetch(state, key) === {:ok, value} end) do
      component
    else
      %{component | state: Map.merge(state, entries)}
    end
  end

  @doc """
  If the second arg is a list of keys representing a component state path
  it puts the value in the nested component state path,
  otherwise it puts the given key-value pair to the component state.
  """
  @spec put_state(Component.t(), atom | list(atom), any) :: Component.t()

  def put_state(component, keys, value) when is_list(keys) do
    %{component | state: MapUtils.put_nested(component.state, keys, value)}
  end

  def put_state(%{state: state} = component, key, value) do
    # PATCH (no-op put_state) — see put_state/2 for why explicit equality, not a pin-match.
    # Map.fetch distinguishes a missing key (:error) from present-with-nil, so a missing
    # key still writes.
    if Map.fetch(state, key) === {:ok, value} do
      component
    else
      %{component | state: Map.put(state, key, value)}
    end
  end

  @doc """
  Subscribes the current handler's component to `channel`.

  The subscription is scoped to the component whose handler is running - the
  page in a page handler, the layout in a layout handler, or the component in a
  component handler. Once subscribed, the component receives actions broadcast
  on the channel. Takes effect after the handler returns successfully; if the
  handler raises, it is discarded along with the rest of the changes.

  Idempotent: subscribing to the same channel twice does not duplicate it.
  """
  # Appends the {channel, server.cid} key to server.subscriptions and records it
  # as :put in __meta__.subscription_ops; the framework drains subscription_ops
  # after a successful handler return to drive the SubscriptionRegistry. cid
  # comes from server.cid, set by the framework at handler entry ("page" /
  # "layout" / component cid).
  @spec put_subscription(Server.t(), atom | tuple) :: Server.t()
  def put_subscription(server, channel) do
    Channel.validate!(channel)

    key = {channel, server.cid}

    new_subscriptions =
      if key in server.subscriptions do
        server.subscriptions
      else
        [key | server.subscriptions]
      end

    new_subscription_ops = Map.put(server.__meta__.subscription_ops, key, :put)
    new_meta = %{server.__meta__ | subscription_ops: new_subscription_ops}

    %{server | subscriptions: new_subscriptions, __meta__: new_meta}
  end

  @doc """
  Returns the AST of code that registers __props__ module attribute.
  """
  @spec register_props_accumulator() :: AST.t()
  def register_props_accumulator do
    quote do
      Module.register_attribute(__MODULE__, :__props__, accumulate: true)
    end
  end

  defp append_broadcast(server, channel, action_name, params, except \\ []) do
    Channel.validate!(channel)

    broadcast = %Broadcast{
      channel: channel,
      action_name: action_name,
      params: Map.new(params),
      except: normalize_except(except)
    }

    %{server | broadcasts: [broadcast | server.broadcasts]}
  end

  defp normalize_except({_kind, _id} = identity), do: [identity]

  defp normalize_except(list) when is_list(list), do: list
end
