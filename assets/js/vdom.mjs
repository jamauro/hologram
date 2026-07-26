"use strict";

import {
  attributesModule,
  eventListenersModule,
  h as vnode,
  init,
  vnode as rawVnode,
} from "snabbdom";

const patch = init([attributesModule, eventListenersModule]);

export default class Vdom {
  // PATCH (hydration-adopt) — downstream fork patch; see hologram.mjs #onReady.
  //
  // The boot-time hydration seed: the LIVE document as a vnode tree in the RENDERER's shape —
  // bare-tag sels, ALL attributes (id/class/data-* included) in `data.attrs`, link/script keys —
  // with every vnode bound to its real DOM node (`elm`), so the first patch ADOPTS the
  // server-rendered nodes instead of rebuilding them.
  //
  // snabbdom's `toVNode` was used here before, but it encodes id/class into `sel`
  // ("img.msg-att-img") and data-* into `data.dataset`, while the renderer emits bare tags
  // ("img") with everything in attrs. `sameVnode()` compares `sel` strictly, so every classed
  // element failed the match and the whole page was recreated on boot: the SSR paint was
  // discarded, every <img> refetched + re-decoded (a visible blink on refresh), all for a
  // "hydration" that was designed to be a near-no-op. This is `#buildVnodeFromDomNode`'s shape
  // (the navigation-side builder) plus the `elm` binding only a live tree can carry.
  static fromLiveDom(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // A text VNODE (not a bare string, which only `h()` normalizes) — the old side of a
      // patch must be real vnodes carrying `elm`.
      return rawVnode(undefined, undefined, undefined, node.textContent, node);
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return rawVnode("!", {}, [], node.textContent, node);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return rawVnode("", {}, [], undefined, node);
    }

    const attrs = {};

    for (const attr of node.attributes) {
      attrs[attr.name] = attr.value === "" ? true : attr.value;
    }

    const tagName = node.tagName.toLowerCase();
    const data = {attrs: attrs};

    // The same link/script keys the renderer stamps (and addKeysToLinkAndScriptVnodes used to
    // graft onto the toVNode seed): a stylesheet/script only ever counts as "the same element"
    // as itself, so hydration can't accidentally re-execute or reload one.
    if (tagName === "link" && typeof attrs.href === "string") {
      data.key = `__hologramLink__:${attrs.href}`;
    } else if (
      tagName === "script" &&
      typeof attrs.src === "string" &&
      attrs.src
    ) {
      data.key = `__hologramScript__:${attrs.src}`;
    } else if (tagName === "script" && node.textContent) {
      data.key = `__hologramScript__:${node.textContent}`;
    } else if (typeof attrs["data-key"] === "string" && attrs["data-key"]) {
      // PATCH (keyed-lists) — see renderer.mjs; the adoption seed must carry the same keys.
      data.key = attrs["data-key"];
    } else if (
      typeof attrs["data-anchor"] === "string" &&
      attrs["data-anchor"]
    ) {
      data.key = attrs["data-anchor"];
    }

    const children = Array.from(node.childNodes).map(Vdom.fromLiveDom);

    return rawVnode(tagName, data, children, undefined, node);
  }
  static addKeysToLinkAndScriptVnodes(node) {
    let key;

    switch (node.sel) {
      case "link":
        if (
          node.data?.attrs?.href &&
          typeof node.data.attrs.href === "string"
        ) {
          key = `__hologramLink__:${node.data.attrs.href}`;
        }
        break;

      case "script":
        if (typeof node.data?.attrs?.src === "string" && node.data.attrs.src) {
          key = `__hologramScript__:${node.data.attrs.src}`;
        } else if (node.textContent) {
          // Make sure the script is executed if the code changes.
          key = `__hologramScript__:${node.textContent}`;
        }
        break;
    }

    if (key) {
      node.key = key;
      node.data.key = key;
    }

    if (Array.isArray(node.children)) {
      for (const childNode of node.children) {
        Vdom.addKeysToLinkAndScriptVnodes(childNode);
      }
    }
  }

  static from(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    return Vdom.#buildVnodeFromDomNode(doc.documentElement);
  }

  // Covered in feature tests
  // PATCH (subtree-render) — patches ONE root vnode of a re-rendered component against its previous
  // self. The old vnode carries the live `.elm` from the pass that mounted it, which is all Snabbdom
  // needs to patch in place; identical objects (an unchanged memoized subtree) short-circuit exactly
  // as they do inside a full patch.
  static patchSubtreeRoot(oldRoot, newRoot) {
    return oldRoot === newRoot ? oldRoot : patch(oldRoot, newRoot);
  }

  static patchVirtualDocument(oldVirtualDocument, newVirtualDocument) {
    const newRootVNode = {
      // Keep the same selector (tag name, id, classes)
      sel: oldVirtualDocument.sel,
      // Update only the attributes
      data: {attrs: newVirtualDocument.data.attrs || {}},
      // Keep the same children
      children: oldVirtualDocument.children,
    };

    // Patch only the root vnode attributes
    const patchedVirtualDocument = patch(oldVirtualDocument, newRootVNode);

    // Then patch head and body separately to preserve JavaScript/CSS handling

    const oldHead = oldVirtualDocument.children.find($.#isHeadVnode);

    const newHead = newVirtualDocument.children.find($.#isHeadVnode);

    const oldBody = oldVirtualDocument.children.find($.#isBodyVnode);

    const newBody = newVirtualDocument.children.find($.#isBodyVnode);

    patchedVirtualDocument.children = oldVirtualDocument.children.map(
      (child) => {
        if ($.#isHeadVnode(child)) {
          return patch(oldHead, newHead);
        } else if ($.#isBodyVnode(child)) {
          return patch(oldBody, newBody);
        } else {
          return child;
        }
      },
    );

    return patchedVirtualDocument;
  }

  static #buildVnodeFromDomNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return vnode("!", node.textContent);
    }

    const children = Array.from(node.childNodes).map(
      Vdom.#buildVnodeFromDomNode,
    );

    const attrs = {};

    for (let attr of node.attributes) {
      attrs[attr.name] = attr.value === "" ? true : attr.value;
    }

    const tagName = node.tagName.toLowerCase();
    const data = {attrs: attrs};

    if (tagName === "link" && typeof attrs.href === "string") {
      data.key = `__hologramLink__:${attrs.href}`;
    } else if (
      tagName === "script" &&
      typeof attrs.src === "string" &&
      attrs.src
    ) {
      data.key = `__hologramScript__:${attrs.src}`;
    } else if (tagName === "script" && node.textContent) {
      // Make sure the script is executed if the code changes.
      data.key = `__hologramScript__:${node.textContent}`;
    } else if (typeof attrs["data-key"] === "string" && attrs["data-key"]) {
      // PATCH (keyed-lists) — see renderer.mjs; the navigation-side seed carries the same keys.
      data.key = attrs["data-key"];
    } else if (
      typeof attrs["data-anchor"] === "string" &&
      attrs["data-anchor"]
    ) {
      data.key = attrs["data-anchor"];
    }

    return vnode(tagName, data, children);
  }

  // We're checking html element children,
  // so the nodes are either: head element, body element or text (whitespace) nodes
  static #isBodyVnode(vnode) {
    return vnode.sel?.[0] === "b";
  }

  // We're checking html element children,
  // so the nodes are either: head element, body element or text (whitespace) nodes
  static #isHeadVnode(vnode) {
    return vnode.sel?.[0] === "h";
  }
}

const $ = Vdom;
