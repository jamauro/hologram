"use strict";

import Type from "./type.mjs";

export default class ComponentRegistry {
  static entries = Type.map();

  static clear() {
    ComponentRegistry.entries = Type.map();
  }

  // Removes a component's entry from the registry, freeing its retained state.
  // Returns true if an entry was removed, false if the cid was not registered.
  // Safe only for a cid that is not currently rendered; a later re-render re-inits it.
  static deleteEntry(cid) {
    const key = Type.encodeMapKey(cid);

    if (key in ComponentRegistry.entries.data) {
      delete ComponentRegistry.entries.data[key];
      return true;
    }

    return false;
  }

  // Optimized (mutates next_action field in-place)
  static clearNextAction(cid) {
    const entry = ComponentRegistry.entries.data[Type.encodeMapKey(cid)][1];
    const componentStruct = entry.data["atom(struct)"][1];
    componentStruct.data["atom(next_action)"][1] = Type.nil();
  }

  // Returns a component's stored render context (see putComponentContext), or an empty map if the
  // cid is unregistered or has not rendered yet. The empty-map fallback means an off-DOM preload
  // simply gets default prop values when no context is available.
  // Deps: [:maps.get/3]
  static getComponentContext(cid) {
    const entry = ComponentRegistry.getEntry(cid);

    return entry
      ? Erlang_Maps["get/3"](Type.atom("context"), entry, Type.map())
      : Type.map();
  }

  // null instead of boxed nil is returned by default on purpose, because the function is not used by transpiled code.
  // Deps: [:maps.get/2]
  static getComponentEmittedContext(cid) {
    const componentStruct = ComponentRegistry.getComponentStruct(cid);

    return componentStruct
      ? Erlang_Maps["get/2"](Type.atom("emitted_context"), componentStruct)
      : null;
  }

  // null instead of boxed nil is returned by default on purpose, because the function is not used by transpiled code.
  // Deps: [:maps.get/3]
  static getComponentModule(cid) {
    const entry = ComponentRegistry.getEntry(cid);

    return entry
      ? Erlang_Maps["get/3"](Type.atom("module"), entry, null)
      : null;
  }

  // null instead of boxed nil is returned by default on purpose, because the function is not used by transpiled code.
  // Deps: [:maps.get/2]
  static getComponentState(cid) {
    const componentStruct = ComponentRegistry.getComponentStruct(cid);

    return componentStruct
      ? Erlang_Maps["get/2"](Type.atom("state"), componentStruct)
      : null;
  }

  // null instead of boxed nil is returned by default on purpose, because the function is not used by transpiled code.
  // Deps: [:maps.get/3]
  static getComponentStruct(cid) {
    const entry = ComponentRegistry.getEntry(cid);

    return entry
      ? Erlang_Maps["get/3"](Type.atom("struct"), entry, null)
      : null;
  }

  // null instead of boxed nil is returned by default on purpose, because the function is not used by transpiled code.
  // Deps: [:maps.get/3]
  static getEntry(cid) {
    return Erlang_Maps["get/3"](cid, ComponentRegistry.entries, null);
  }

  // Deps: [:maps.is_key/2]
  static isCidRegistered(cid) {
    return Type.isTrue(Erlang_Maps["is_key/2"](cid, ComponentRegistry.entries));
  }

  static populate(entries) {
    ComponentRegistry.entries = entries;
  }

  // Optimized (mutates entries/struct field in-place)
  static putComponentStruct(cid, componentStruct) {
    ComponentRegistry.entries.data[Type.encodeMapKey(cid)][1].data[
      "atom(struct)"
    ][1] = componentStruct;
  }

  // Stores a component's render context (merged received + emitted) on its entry, recorded at
  // render time so put_preload can warm an off-DOM component with its preloader's context. Mutates
  // in-place, adding the "context" key if absent (SSR entries start with only module + struct).
  static putComponentContext(cid, context) {
    ComponentRegistry.entries.data[Type.encodeMapKey(cid)][1].data[
      "atom(context)"
    ] = [Type.atom("context"), context];
  }

  // Optimized (mutates entries field in-place)
  static putEntry(cid, entry) {
    ComponentRegistry.entries.data[Type.encodeMapKey(cid)] = [cid, entry];
  }
}
