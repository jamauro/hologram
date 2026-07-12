"use strict";

import {
  assert,
  defineGlobalErlangAndElixirModules,
  registerWebApis,
  vnode,
} from "./support/helpers.mjs";

import Vdom from "../../assets/js/vdom.mjs";

defineGlobalErlangAndElixirModules();
registerWebApis();

describe("Vdom", () => {
  describe("addKeysToLinkAndScriptVnodes()", () => {
    it("element node that is not a link or script", () => {
      const node = vnode("img", {attrs: {src: "my_src"}}, []);
      Vdom.addKeysToLinkAndScriptVnodes(node);

      assert.deepStrictEqual(node, vnode("img", {attrs: {src: "my_src"}}, []));
    });

    it("text node", () => {
      const node = {
        sel: undefined,
        data: undefined,
        children: undefined,
        text: "my_text",
        elm: undefined,
        key: undefined,
      };

      Vdom.addKeysToLinkAndScriptVnodes(node);

      assert.deepStrictEqual(node, {
        sel: undefined,
        data: undefined,
        children: undefined,
        text: "my_text",
        elm: undefined,
        key: undefined,
      });
    });

    describe("link element", () => {
      it("without attrs field", () => {
        const node = vnode("link", {}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(node, vnode("link", {}, []));
      });

      it("without href attribute, but with some other attribute", () => {
        const node = vnode("link", {attrs: {rel: "stylesheet"}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode("link", {attrs: {rel: "stylesheet"}}, []),
        );
      });

      it("with boolean href attribute", () => {
        const node = vnode("link", {attrs: {href: true}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(node, vnode("link", {attrs: {href: true}}, []));
      });

      it("with non-empty string href attribute", () => {
        const node = vnode("link", {attrs: {href: "my_link"}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode(
            "link",
            {
              key: "__hologramLink__:my_link",
              attrs: {href: "my_link"},
            },
            [],
          ),
        );
      });

      it("nested link nodes", () => {
        const node = vnode("div", {}, [
          vnode("link", {attrs: {href: "my_link_1"}}, []),
          vnode("img", {attrs: {src: "my_src"}}, []),
          vnode("link", {attrs: {href: "my_link_2"}}, []),
        ]);

        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode("div", {}, [
            vnode(
              "link",
              {
                key: "__hologramLink__:my_link_1",
                attrs: {href: "my_link_1"},
              },
              [],
            ),
            vnode("img", {attrs: {src: "my_src"}}, []),
            vnode(
              "link",
              {
                key: "__hologramLink__:my_link_2",
                attrs: {href: "my_link_2"},
              },
              [],
            ),
          ]),
        );
      });
    });

    describe("script element", () => {
      it("without attrs field", () => {
        const node = vnode("script", {}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(node, vnode("script", {}, []));
      });

      it("without src attribute (inline script), but with some other attribute", () => {
        const node = vnode("script", {attrs: {type: "text/javascript"}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode("script", {attrs: {type: "text/javascript"}}, []),
        );
      });

      it("with boolean src attribute", () => {
        const node = vnode("script", {attrs: {src: true}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(node, vnode("script", {attrs: {src: true}}, []));
      });

      it("with non-empty string src attribute", () => {
        const node = vnode("script", {attrs: {src: "my_src"}}, []);
        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode(
            "script",
            {
              key: "__hologramScript__:my_src",
              attrs: {src: "my_src"},
            },
            [],
          ),
        );
      });

      it("nested script nodes", () => {
        const node = vnode("div", {}, [
          vnode("script", {attrs: {src: "my_src_1"}}, []),
          vnode("img", {attrs: {src: "my_src"}}, []),
          vnode("script", {attrs: {src: "my_src_2"}}, []),
        ]);

        Vdom.addKeysToLinkAndScriptVnodes(node);

        assert.deepStrictEqual(
          node,
          vnode("div", {}, [
            vnode(
              "script",
              {
                key: "__hologramScript__:my_src_1",
                attrs: {src: "my_src_1"},
              },
              [],
            ),
            vnode("img", {attrs: {src: "my_src"}}, []),
            vnode(
              "script",
              {
                key: "__hologramScript__:my_src_2",
                attrs: {src: "my_src_2"},
              },
              [],
            ),
          ]),
        );
      });
    });
  });

  describe("from()", () => {
    it("builds virtual DOM from HTML markup", () => {
      const html =
        '<!DOCTYPE html><html lang="en" class="abc"><head></head><body><div attr1="abc" attr2></div><!-- my comment --><span>abc</span></body></html>';

      const result = Vdom.from(html);

      const expected = vnode("html", {attrs: {lang: "en", class: "abc"}}, [
        vnode("head", {attrs: {}}, []),
        vnode("body", {attrs: {}}, [
          vnode("div", {attrs: {attr1: "abc", attr2: true}}, []),
          vnode("!", " my comment "),
          vnode("span", {attrs: {}}, ["abc"]),
        ]),
      ]);

      assert.deepStrictEqual(result, expected);
    });

    describe("link element vnode key", () => {
      it("not a link element", () => {
        const result = Vdom.from(
          '<html><body><a href="my_href"></a></body></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, []),
          vnode("body", {attrs: {}}, [
            vnode("a", {attrs: {href: "my_href"}}, []),
          ]),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("link element without href attribute", () => {
        const result = Vdom.from(
          '<html><head><link ref="stylesheet" /></head></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("link", {attrs: {ref: "stylesheet"}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("link element with empty string href attribute", () => {
        const result = Vdom.from('<html><head><link href="" /></head></html>');

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("link", {attrs: {href: true}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("link element with boolean href attribute", () => {
        const result = Vdom.from("<html><head><link href /></head></html>");

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("link", {attrs: {href: true}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("link element with non-empty href attribute", () => {
        const result = Vdom.from(
          '<html><head><link href="my_href" /></head></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode(
              "link",
              {key: "__hologramLink__:my_href", attrs: {href: "my_href"}},
              [],
            ),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });
    });

    describe("script element vnode key", () => {
      it("not a script element", () => {
        const result = Vdom.from(
          '<html><body><img src="my_src" /></body></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, []),
          vnode("body", {attrs: {}}, [
            vnode("img", {attrs: {src: "my_src"}}, []),
          ]),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element without src attribute (inline script)", () => {
        const result = Vdom.from(
          '<html><head><script type="text/html"></script></head></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("script", {attrs: {type: "text/html"}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element with empty string src attribute", () => {
        const result = Vdom.from(
          '<html><head><script src=""></script></head></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("script", {attrs: {src: true}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element with boolean src attribute", () => {
        const result = Vdom.from(
          "<html><head><script src></script></head></html>",
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode("script", {attrs: {src: true}}, []),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element with non-empty src attribute", () => {
        const result = Vdom.from(
          '<html><head><script src="my_src"></script></head></html>',
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode(
              "script",
              {key: "__hologramScript__:my_src", attrs: {src: "my_src"}},
              [],
            ),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element with non-empty text content", () => {
        const result = Vdom.from(
          "<html><head><script>const x = 123;</script></head></html>",
        );

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [
            vnode(
              "script",
              {key: "__hologramScript__:const x = 123;", attrs: {}},
              ["const x = 123;"],
            ),
          ]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });

      it("script element with empty text content", () => {
        const result = Vdom.from("<html><head><script></script></head></html>");

        const expected = vnode("html", {attrs: {}}, [
          vnode("head", {attrs: {}}, [vnode("script", {attrs: {}}, [])]),
          vnode("body", {attrs: {}}, []),
        ]);

        assert.deepStrictEqual(result, expected);
      });
    });
  });

  describe("fromLiveDom()", () => {
    // The hydration seed (see hologram.mjs #onReady): the renderer's vnode shape — bare-tag
    // sel, id/class as plain attrs — bound to the live DOM node. toVNode's "img.my-class"
    // sels failed sameVnode() against the renderer's bare tags, so hydration rebuilt the page.

    it("element with class and id: bare-tag sel, id/class in attrs, elm bound", () => {
      const el = document.createElement("img");
      el.id = "my-id";
      el.className = "a b";
      el.setAttribute("src", "/files/1");

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.sel, "img");
      assert.deepStrictEqual(result.data.attrs, {
        id: "my-id",
        class: "a b",
        src: "/files/1",
      });
      assert.equal(result.elm, el);
    });

    it("data-* attributes stay plain attrs (the attributes module diffs them)", () => {
      const el = document.createElement("div");
      el.setAttribute("data-theme", "aurora");

      const result = Vdom.fromLiveDom(el);

      assert.deepStrictEqual(result.data.attrs, {"data-theme": "aurora"});
    });

    it("empty-valued attribute becomes true (the renderer's boolean-attr shape)", () => {
      const el = document.createElement("input");
      el.setAttribute("hidden", "");

      const result = Vdom.fromLiveDom(el);

      assert.deepStrictEqual(result.data.attrs, {hidden: true});
    });

    it("text child: a text VNODE (elm-bound), not a bare string", () => {
      const el = document.createElement("span");
      el.textContent = "my_text";

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.children.length, 1);
      assert.equal(result.children[0].sel, undefined);
      assert.equal(result.children[0].text, "my_text");
      assert.equal(result.children[0].elm, el.firstChild);
    });

    it("comment child", () => {
      const el = document.createElement("div");
      el.appendChild(document.createComment("my_comment"));

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.children[0].sel, "!");
      assert.equal(result.children[0].text, "my_comment");
    });

    it("link element gets the stylesheet key (vnode.key AND data.key)", () => {
      const el = document.createElement("link");
      el.setAttribute("href", "/assets/app.css");

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.key, "__hologramLink__:/assets/app.css");
      assert.equal(result.data.key, "__hologramLink__:/assets/app.css");
    });

    it("script element with src gets the script key", () => {
      const el = document.createElement("script");
      el.setAttribute("src", "/hologram/runtime.js");

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.key, "__hologramScript__:/hologram/runtime.js");
    });

    it("inline script keyed by its code", () => {
      const el = document.createElement("script");
      el.textContent = "const x = 123;";

      const result = Vdom.fromLiveDom(el);

      assert.equal(result.key, "__hologramScript__:const x = 123;");
    });
  });
});
