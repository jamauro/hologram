defmodule Hologram.Runtime.Cookie do
  @moduledoc false

  # TODO: consider moving to Hologram.Server (Server-struct concept) when splitting up Hologram.Runtime

  alias Hologram.Commons.StringUtils

  defstruct value: nil,
            domain: nil,
            http_only: true,
            max_age: nil,
            path: nil,
            same_site: :lax,
            secure: true

  @type t :: %__MODULE__{
          value: any(),
          domain: String.t() | nil,
          http_only: boolean(),
          max_age: integer() | nil,
          path: String.t() | nil,
          same_site: :lax | :none | :strict,
          secure: boolean()
        }

  @type op :: __MODULE__.t() | :delete

  @doc """
  Decodes a potentially encoded cookie value.

  If the input string starts with the Hologram-specific "%H" prefix, it removes
  the prefix, Base64-decodes the remaining string, and safely converts it back to the
  original Elixir term using binary_to_term/2 with the :safe option.

  If the input string does not have the "%H" prefix, it returns the string unchanged,
  treating it as a plain cookie value.

  ## Examples

      iex> Cookie.decode("%Hg3cFaGVsbG8")
      :hello

      iex> Cookie.decode("%Hg3QAAAABdwNrZXltAAAABXZhbHVl")
      %{key: "value"}

      iex> Cookie.decode("plain_cookie_value")
      "plain_cookie_value"
  """
  @spec decode(String.t()) :: any()
  def decode(encoded)

  # sobelow_skip ["Misc.BinToTerm"]
  def decode("%H" <> encoded) do
    encoded
    |> Base.decode64!(padding: false)
    |> :erlang.binary_to_term([:safe])
  end

  def decode(plain_string), do: plain_string

  @doc """
  Encodes a term for transport as a cookie value.

  A plain string passes through unchanged — `decode/1` already returns unprefixed strings
  as-is, so the round-trip is lossless, and the value stays readable to whoever inspects the
  cookie outside Hologram (an edge worker, a log, the browser devtools). Everything else is
  converted with Erlang's term_to_binary/1, Base64-encoded without padding, and prefixed with
  "%H" to identify it as a Hologram-encoded value. The "%H" prefix is invalid in URL encoding,
  ensuring clear distinction from other cookie formats — which is also why the one string that
  cannot pass through untouched is a string that itself starts with "%H": it would be
  mistaken for an encoded term on the way back, so it gets wrapped like a term.

  ## Examples

      iex> Cookie.encode("dark")
      "dark"

      iex> Cookie.encode(:hello)
      "%Hg3cFaGVsbG8"

      iex> Cookie.encode(%{key: "value"})
      "%Hg3QAAAABdwNrZXltAAAABXZhbHVl"
  """
  @spec encode(term()) :: String.t()
  def encode(value)

  def encode("%H" <> _rest = value), do: encode_term(value)

  def encode(value) when is_binary(value), do: value

  def encode(value), do: encode_term(value)

  defp encode_term(value) do
    value
    |> :erlang.term_to_binary()
    |> Base.encode64(padding: false)
    |> StringUtils.prepend("%H")
  end
end
