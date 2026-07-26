defmodule Hologram.Template.DOM do
  @moduledoc false

  alias Hologram.Commons.StringUtils
  alias Hologram.Compiler.AST
  alias Hologram.Template.EventModifiers
  alias Hologram.Template.Helpers
  alias Hologram.Template.Parser
  alias Hologram.TemplateSyntaxError

  # Blocks whose rendered node count can change between renders, shifting the position of every
  # sibling that follows them. "raw" and "else" are absent because neither delimits a region whose
  # size can vary: "raw" only marks source to reconstruct, and "else" is a branch within an "if".
  @marked_blocks ["for", "if"]

  @type attribute :: {String.t(), t} | {:spread, {any}}

  # 'dom_node' name used instead of 'node" because type node/0 is a built-in type and it cannot be redefined.
  @type dom_node ::
          {:component, module, list(attribute), t}
          | {:dynamic_tag, {any}, list(attribute), t}
          | {:element, String.t(), list(attribute), t}
          | {:expression, {any}}
          | {:page, module, list(attribute), []}
          | {:public_comment, t}
          | {:text, String.t()}

  @type t :: dom_node | list(dom_node())

  @doc """
  Builds DOM AST from the given parsed tags.

  ## Examples

      iex> tags = [{:start_tag, {"div, []}}, {:text, "abc"}, {:end_tag, "div"}]
      iex> build_ast(tags)
      [{:{}, [line: 1], [:element, "div", [], [{:text, "abc"}]]}]
  """
  @spec build_ast(list(Parser.parsed_tag())) :: AST.t()
  def build_ast(tags) do
    {code, _last_tag_type} =
      tags
      |> add_block_markers()
      |> Enum.reduce({"", nil}, fn tag, {code_acc, last_tag_type} ->
        current_tag_type = if is_tuple(tag), do: elem(tag, 0), else: tag

        # :skip items are fully elided, as if they did not appear
        case render_code(tag) do
          :skip ->
            {code_acc, last_tag_type}

          current_tag_code ->
            {append_code(code_acc, current_tag_code, last_tag_type), current_tag_type}
        end
      end)

    "[#{code}]"
    |> AST.for_code()
    |> substitute_module_attributes()
  end

  # Brackets each block in a pair of marker comments, so that changing how many nodes the block
  # renders can't change the identity of the block's siblings. The client diffs children by tag and
  # position, so without the markers a block that starts rendering an extra node lets the following
  # sibling be paired with the block's content and rebuilt, destroying focus, scroll position and
  # media state.
  #
  # Blocks inside <script> and <style> are left alone: a comment there would be part of the script
  # or stylesheet source rather than markup, and their text-only children have no identity to
  # protect anyway.
  defp add_block_markers(tags) do
    hash = template_hash(tags)

    {marked_tags, _state} =
      Enum.flat_map_reduce(tags, {0, [], 0}, &inject_block_markers(&1, &2, hash))

    marked_tags
  end

  # Builds one marker comment, whose text is four bracketed segments, e.g. "[h:a3f2b1c4:0:o]":
  #
  #   h         namespace, distinguishing a marker from a comment written in the template
  #   a3f2b1c4  template hash, see template_hash/1
  #   0         index of the block within its template, counted in source order
  #   o         side of the pair, "o" opening or "c" closing
  #
  # The marker text doubles as the client-side vnode key, which is why it has to be part of the
  # markup: the client diffs against a virtual DOM derived from server-rendered HTML, and a
  # comment's own text is the only carrier that survives serialization. The client recognizes the
  # same format in Vdom.markerKey/1.
  #
  # Takes the tags that follow the marker, so an opening marker can be built in front of its block
  # without appending to the list it just built.
  defp marker_tags(hash, index, side, tail \\ []) do
    [
      :public_comment_start,
      {:text, "[h:#{hash}:#{index}:#{side}]"},
      :public_comment_end
      | tail
    ]
  end

  defp append_code(code_acc, code, last_tag_type)
       when last_tag_type in [
              :block_end,
              :doctype,
              :end_tag,
              :expression,
              :public_comment_end,
              :self_closing_tag,
              :text
            ] do
    code_acc <> ", " <> code
  end

  defp append_code(code_acc, code, _last_tag_type) do
    code_acc <> code
  end

  # Splits a "$"-prefixed event attribute name on "." into the bare name and its
  # raw modifier segments. Names without "$" (or without ".") carry no modifiers.
  defp decompose_event_attribute_name("$" <> _rest = name) do
    case String.split(name, ".") do
      [base_name] -> {base_name, []}
      [base_name | modifiers] -> {base_name, modifiers}
    end
  end

  defp decompose_event_attribute_name(name), do: {name, []}

  # Splits a `{%for}` head into its generator and the code producing each iteration's key.
  #
  # An explicit `, key: <expr>` wins. Otherwise the key defaults to the item's `:id`, which requires
  # knowing what to call the item — so the default applies only to the plain `var <- enum` form. A
  # destructuring pattern, several generators or a filter all fall back to unkeyed rather than
  # guessing which binding is the identity.
  defp split_key_option(content) do
    segments = split_top_level_commas(content)

    case List.last(segments) do
      <<_::binary>> = last ->
        case Regex.run(~r/^\s*key:\s*(.+)$/s, last) do
          [_match, key_expr] ->
            generator = segments |> Enum.drop(-1) |> Enum.join(",")
            {generator, "(#{key_expr})"}

          nil ->
            {content, default_key_code(segments)}
        end

      _fallback ->
        {content, "nil"}
    end
  end

  # The implicit key needs a name for the item, so it applies only to a lone `var <- enum` generator.
  # Several generators, a filter, or a destructuring pattern leave the loop unkeyed rather than
  # guessing which binding carries the identity. An underscored binding is excluded too: reading a
  # value the author explicitly discarded would be both wrong (it can't be an identity) and noisy
  # (Elixir warns on using an underscored variable, which is an error in a --warnings-as-errors app).
  defp default_key_code([generator]) do
    case Regex.run(~r/^\s*([a-z][a-zA-Z0-9_]*)\s*<-/, generator) do
      [_match, item_var] -> "Hologram.Template.DOM.default_key(#{item_var})"
      nil -> "nil"
    end
  end

  defp default_key_code(_segments), do: "nil"

  # Splits on commas that separate the `{%for}` head's own parts, ignoring those nested inside a call,
  # list, map or string — `{%for x <- f(a, b), key: x.id}` has exactly one top-level comma, and a map
  # literal carrying its own `key:` must not read as the key option.
  defp split_top_level_commas(content) do
    {segments, last, _depth, _quote} =
      content
      |> String.graphemes()
      |> Enum.reduce({[], "", 0, nil}, &scan_grapheme/2)

    segments ++ [last]
  end

  defp scan_grapheme(char, {segments, current, depth, quote_char}) do
    cond do
      quote_char && char == quote_char -> {segments, current <> char, depth, nil}
      quote_char -> {segments, current <> char, depth, quote_char}
      char in ~w(" ') -> {segments, current <> char, depth, char}
      char in ~w|( [ {| -> {segments, current <> char, depth + 1, nil}
      char in ~w|) ] }| -> {segments, current <> char, depth - 1, nil}
      char == "," && depth == 0 -> {segments ++ [current], "", depth, nil}
      true -> {segments, current <> char, depth, nil}
    end
  end

  @doc """
  The implicit `{%for}` key for an item: its `:id` when it has one, otherwise `nil` (unkeyed).
  Called from compiled template code, so it runs on both the server and the client.
  """
  @spec default_key(any) :: any
  def default_key(item) when is_map(item), do: Map.get(item, :id)
  def default_key(_item), do: nil

  @doc """
  Attaches an iteration's key to the node it repeats.

  The key goes to the first COMPONENT node if there is one — becoming its identity, which the
  renderer scopes by the enclosing component — and otherwise to the first element, as `data-key`.
  Only the first: sibling nodes from one iteration can't share a key without colliding, and the
  repeated thing is the component when there is one (the `{%if}` that may also sit in the loop body
  is a conditional decoration of it, not another instance).

  A nil key returns the nodes untouched, and an explicit `cid` or `data-key` written at the call site
  is left alone — spelling it out beats the implicit key.
  """
  @spec key_nodes(any, t) :: t
  def key_nodes(nil, nodes), do: nodes

  def key_nodes(key, nodes) do
    if has_component?(nodes) do
      key_first_component(nodes, key)
    else
      key_first_element(nodes, key)
    end
  end

  # Written as direct recursion over the node list rather than Enum.any?/Enum.map_reduce with
  # captured predicates. This runs once PER ITERATION of every keyed comprehension, and on the
  # client every Enum call and every closure invocation is interpreted: the Enum form measured
  # ~8ms per 120-row list render (Enum.any?'s predicate walk alone was ~3ms of it), against a
  # body that only has to find one node in a list of two or three.
  defp has_component?([{:component, _module, _props, _children} | _rest]), do: true
  defp has_component?([_node | rest]), do: has_component?(rest)
  defp has_component?([]), do: false

  # Replaces the first component (resp. element) node with its keyed copy, leaving the rest alone.
  # A node the clause head doesn't match — text, expression, or the nested list an {%if} inside the
  # loop body produces — is passed over, exactly as the predicate walk did.
  defp key_first_component([{:component, _module, _props, _children} = node | rest], key),
    do: [put_component_key(node, key) | rest]

  defp key_first_component([node | rest], key), do: [node | key_first_component(rest, key)]
  defp key_first_component([], _key), do: []

  defp key_first_element([{:element, _tag, _attrs, _children} = node | rest], key),
    do: [put_element_key(node, key) | rest]

  defp key_first_element([node | rest], key), do: [node | key_first_element(rest, key)]
  defp key_first_element([], _key), do: []

  defp put_component_key({:component, module, props, children} = node, key) do
    if List.keymember?(props, "cid", 0) do
      node
    else
      {:component, module, [{"__key__", [expression: {key}]} | props], children}
    end
  end

  defp put_element_key({:element, tag, attrs, children} = node, key) do
    if List.keymember?(attrs, "data-key", 0) do
      node
    else
      {:element, tag, [{"data-key", [expression: {key}]} | attrs], children}
    end
  end

  defp extract_expression_content(expr_str) do
    expr_str
    |> String.slice(1, String.length(expr_str) - 2)
    |> String.trim()
  end

  # State is {next block index, stack of open blocks, nesting depth inside <script>/<style>}. A
  # block opened inside raw text pushes :skipped so that its end tag pops the stack without
  # emitting a closing marker.
  defp inject_block_markers({:start_tag, {tag_name, _attrs}} = tag, {index, open, depth}, _hash)
       when tag_name in ["script", "style"] do
    {[tag], {index, open, depth + 1}}
  end

  defp inject_block_markers({:end_tag, tag_name} = tag, {index, open, depth}, _hash)
       when tag_name in ["script", "style"] do
    {[tag], {index, open, max(depth - 1, 0)}}
  end

  defp inject_block_markers({:block_start, {block_name, _expr}} = tag, {index, open, 0}, hash)
       when block_name in @marked_blocks do
    {marker_tags(hash, index, "o", [tag]), {index + 1, [index | open], 0}}
  end

  defp inject_block_markers(
         {:block_start, {block_name, _expr}} = tag,
         {index, open, depth},
         _hash
       )
       when block_name in @marked_blocks do
    {[tag], {index, [:skipped | open], depth}}
  end

  defp inject_block_markers(
         {:block_end, block_name} = tag,
         {index, [:skipped | open], depth},
         _hash
       )
       when block_name in @marked_blocks do
    {[tag], {index, open, depth}}
  end

  defp inject_block_markers(
         {:block_end, block_name} = tag,
         {index, [block_index | open], depth},
         hash
       )
       when block_name in @marked_blocks do
    {[tag | marker_tags(hash, block_index, "c")], {index, open, depth}}
  end

  defp inject_block_markers(tag, state, _hash), do: {[tag], state}

  # Wraps implicit keyword list.
  # {a: 1, b: 2} is not valid Elixir code, although {123, a: 1, b: 2} is allowed.
  defp normalize_implicit_keyword_list(templ_expr) do
    regex = ~r/^\{\s*(([a-zA-Z_][a-zA-Z0-9_]*[?!]?|"[^"]+"):\s.+)\}$/s

    case Regex.run(regex, templ_expr) do
      [_full, content, _beginning] ->
        "{[#{content}]}"

      nil ->
        templ_expr
    end
  end

  # Templates checked out on Windows carry CRLF line endings, which would otherwise give the same
  # template a different hash per platform, so markers could not be asserted verbatim.
  defp normalize_newlines(term) when is_binary(term) do
    StringUtils.normalize_newlines(term)
  end

  defp normalize_newlines(term) when is_list(term) do
    Enum.map(term, &normalize_newlines/1)
  end

  defp normalize_newlines(term) when is_tuple(term) do
    term
    |> Tuple.to_list()
    |> Enum.map(&normalize_newlines/1)
    |> List.to_tuple()
  end

  defp normalize_newlines(term), do: term

  defp render_attribute_code({:spread, templ_expr}, _tag_type) do
    "{:spread, #{normalize_implicit_keyword_list(templ_expr)}}"
  end

  defp render_attribute_code({name, value_parts}, :element) do
    value_code = Enum.map_join(value_parts, ", ", &render_code/1)

    case decompose_event_attribute_name(name) do
      {base_name, []} ->
        "{\"#{base_name}\", [#{value_code}]}"

      {base_name, modifiers} ->
        "{\"#{base_name}\", [#{value_code}], #{render_event_modifiers(base_name, modifiers)}}"
    end
  end

  defp render_attribute_code({name, value_parts}, _tag_type) do
    "{\"#{name}\", [" <> Enum.map_join(value_parts, ", ", &render_code/1) <> "]}"
  end

  defp render_code({:block_start, "else"}) do
    "] else ["
  end

  # A comprehension may name the identity of what it repeats:
  #
  #     {%for row <- rows, key: row.msg.id}
  #
  # and when it doesn't, the item's `:id` is used — which covers nearly every list in a Hologram app,
  # since records carry one. The key reaches the iteration's own node (see `key_nodes/2`): a component
  # takes it as its identity, so its state and its memoized subtree follow the DATA across list
  # mutations instead of its position; a plain element takes it as `data-key`, which is what the vnode
  # keyer already reads. An item with no `:id` — an integer, a tuple, a projection map — stays
  # unkeyed, exactly as it behaved before this existed.
  #
  # The wrapper is emitted unconditionally, with a nil key when there is nothing to key on, so that
  # the opening and closing fragments stay symmetrical: `render_code/1` sees a block end with no
  # memory of how its start was rendered.
  defp render_code({:block_start, {"for", expr_str}}) do
    {generator, key_code} =
      expr_str
      |> extract_expression_content()
      |> split_key_option()

    "(for #{generator} do Hologram.Template.DOM.key_nodes(#{key_code}, ["
  end

  defp render_code({:block_end, "for"}) do
    "]) end)"
  end

  defp render_code({:block_start, {"if", expr_str}}) do
    "(if #{extract_expression_content(expr_str)} do ["
  end

  defp render_code({:block_end, "if"}) do
    "] end)"
  end

  # `raw` blocks are useful only in the handling of template sources.
  # `Parser` emits them so that such source can be reconstructed.
  # They can be skipped in the building of the AST here.
  defp render_code({:block_start, "raw"}) do
    :skip
  end

  defp render_code({:block_end, "raw"}) do
    :skip
  end

  defp render_code({:doctype, content}) do
    "{:doctype, \"#{content}\"}"
  end

  defp render_code({:end_tag, _tag_name}) do
    "]}"
  end

  defp render_code({:expression, templ_expr}) do
    "{:expression, #{normalize_implicit_keyword_list(templ_expr)}}"
  end

  defp render_code(:public_comment_end) do
    "]}"
  end

  defp render_code(:public_comment_start) do
    "{:public_comment, ["
  end

  defp render_code({:self_closing_tag, {tag_name, attributes}}) do
    render_code({:start_tag, {tag_name, attributes}}) <> render_code({:end_tag, tag_name})
  end

  # The tag name expression is already brace-wrapped, so emitting its source produces the one-tuple
  # holding the runtime value. Attributes use element-style event decomposition, since the element
  # branch is the only one that can consume events - the component branch filters them out anyway.
  defp render_code({:start_tag, {{:expression, templ_expr}, attributes}}) do
    attributes_code = Enum.map_join(attributes, ", ", &render_attribute_code(&1, :element))

    "{:dynamic_tag, #{templ_expr}, [#{attributes_code}], ["
  end

  defp render_code({:start_tag, {tag_name, attributes}}) do
    tag_type = Helpers.tag_type(tag_name)

    if tag_name in ["window", "document"] do
      validate_reserved_tag_attributes(tag_name, attributes)
    end

    tag_name_code =
      if tag_type == :element do
        "\"#{tag_name}\""
      else
        "alias!(#{tag_name})"
      end

    attributes_code =
      Enum.map_join(attributes, ", ", &render_attribute_code(&1, tag_type))

    "{:#{tag_type}, #{tag_name_code}, [#{attributes_code}], ["
  end

  defp render_code({:text, str}) do
    escaped_str =
      str
      |> HtmlEntities.decode()
      |> String.replace(~s("), ~s(\\"))

    ~s({:text, "#{escaped_str}"})
  end

  # Every event's raw segments are parsed and validated into tagged modifiers at compile time.
  defp render_event_modifiers(base_name, modifiers) do
    inspect(EventModifiers.parse(base_name, modifiers))
  end

  # Distinguishes markers belonging to different templates, since slot content is spliced into the
  # surrounding template's children and bare block indexes would collide there. Derived from the
  # tags rather than the module name so that it stays stable across renames and needs no caller
  # context. Two byte-identical templates share a hash, which degrades to marker churn rather than
  # element identity loss.
  #
  # :erlang.phash2/2 is documented to return the same value for a given term regardless of machine
  # architecture and ERTS version, which is what lets tests assert marker text verbatim.
  defp template_hash(tags) do
    tags
    |> normalize_newlines()
    |> :erlang.phash2(4_294_967_296)
    |> Integer.to_string(36)
    |> String.downcase()
  end

  defp substitute_module_attributes({:@, meta_1, [{name, _meta_2, _args}]}) do
    {{:., meta_1, [{:vars, meta_1, nil}, name]}, [{:no_parens, true} | meta_1], []}
  end

  defp substitute_module_attributes(ast) when is_list(ast) do
    Enum.map(ast, &substitute_module_attributes/1)
  end

  defp substitute_module_attributes(ast) when is_tuple(ast) do
    ast
    |> Tuple.to_list()
    |> Enum.map(&substitute_module_attributes/1)
    |> List.to_tuple()
  end

  defp substitute_module_attributes(ast), do: ast

  # The <window> and <document> tags bind events to the window or document and nothing else, so each
  # attribute must be an event binding (a "$"-prefixed name). Any other attribute fails the build.
  defp validate_reserved_tag_attributes(tag_name, attributes) do
    Enum.each(attributes, fn
      # Spread entries can't carry event bindings, since "$"-prefixed keys are rejected at runtime.
      {:spread, _templ_expr} ->
        raise TemplateSyntaxError,
          message: ~s'the <#{tag_name}> tag accepts only event bindings, but got a spread'

      {name, _value_parts} ->
        unless String.starts_with?(name, "$") do
          raise TemplateSyntaxError,
            message:
              ~s'the <#{tag_name}> tag accepts only event bindings, but got the "#{name}" attribute'
        end
    end)
  end
end
