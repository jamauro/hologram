defmodule Hologram.Runtime.Connection do
  @moduledoc false

  # TODO: legacy WebSocket transport (app transport is POST + SSE), retire rather than
  # move when splitting up Hologram.Runtime

  @behaviour WebSock

  alias Hologram.Assets.PageDigestRegistry
  alias Hologram.Realtime.SubscriptionRegistry
  alias Hologram.Router.Helpers, as: RouterHelpers
  alias Hologram.Runtime.Deserializer

  @type state :: %{plug_conn: Plug.Conn.t()}

  @impl WebSock
  def init(plug_conn) do
    if Hologram.env() == :dev do
      Phoenix.PubSub.subscribe(Hologram.PubSub, "hologram_live_reload")
    end

    connection_id = UUID.uuid4()

    # context = gproc_context(Hologram.env())
    # :gproc.reg({:n, context, {:hologram_connection, connection_id}})

    state = %{
      connection_id: connection_id,
      plug_conn: plug_conn
    }

    {:ok, state}
  end

  @impl WebSock
  def handle_in({message, [opcode: :text]}, state) do
    {message_type, message_payload, correlation_id} = decode(message)

    case handle_message(message_type, message_payload, state) do
      # Fire-and-forget messages (e.g. "destroy") return no reply — the client's handleMessage
      # mishandles an un-correlated reply, so we send nothing back.
      {:noreply, new_state} ->
        {:ok, new_state}

      {reply_type, reply_payload, new_state} ->
        reply = encode(reply_type, reply_payload, correlation_id)
        {:reply, :ok, {:text, reply}, new_state}
    end
  end

  @impl WebSock
  def handle_info({:compilation_error, lines}, state) do
    message = encode("compilation_error", lines, nil)
    {:push, {:text, message}, state}
  end

  @impl WebSock
  def handle_info(:reload, state) do
    message = encode("reload", :__no_payload__, nil)
    {:push, {:text, message}, state}
  end

  @impl WebSock
  def handle_info(_arg, state) do
    {:ok, state}
  end

  # @impl WebSock
  # def terminate(_reason, state) do
  #   context = gproc_context(Hologram.env())
  #   :gproc.unreg({:n, context, {:hologram_connection, state.connection_id}})

  #   :ok
  # end

  defp decode(message) do
    case Jason.decode!(message) do
      [type, payload, correlation_id] ->
        {type, Deserializer.deserialize(payload), correlation_id}

      # PATCH: fire-and-forget message with a payload but no correlation id (e.g. "destroy").
      [type, payload] ->
        {type, Deserializer.deserialize(payload), nil}

      type ->
        {type, nil, nil}
    end
  end

  defp encode(type, :__no_payload__, nil) do
    Jason.encode!(type)
  end

  defp encode(type, payload, nil) do
    Jason.encode!([type, payload])
  end

  defp encode(type, payload, correlation_id) do
    Jason.encode!([type, payload, correlation_id])
  end

  # defp gproc_context(:dev), do: :l

  # defp gproc_context(:test), do: :l

  # defp gproc_context(_env), do: :g

  defp handle_message("page_bundle_path", page_module, connection_state) do
    page_bundle_path =
      page_module
      |> PageDigestRegistry.lookup()
      |> RouterHelpers.page_bundle_path()

    {"reply", page_bundle_path, connection_state}
  end

  defp handle_message("ping", nil, connection_state) do
    {"pong", :__no_payload__, connection_state}
  end

  # PATCH (put_destroy purge): drop every channel subscription a destroyed component held, so the
  # server stops routing broadcasts to a dead cid. Fired by the client from `deleteEntry`. See
  # vendor/hologram-patch.md.
  defp handle_message("destroy", %{instance_id: instance_id, cid: cid}, connection_state) do
    case SubscriptionRegistry.bindings_of(instance_id) do
      nil ->
        :ok

      bindings ->
        drops = bindings |> Map.keys() |> Enum.filter(fn {_channel, c} -> c == cid end)
        if drops != [], do: SubscriptionRegistry.apply_deltas(instance_id, [], drops, nil)
    end

    {:noreply, connection_state}
  end
end
