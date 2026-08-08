// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveComponent,
  describeElement,
  formatElementPath,
  formatElementPathFromRoot,
} from "../../src/client/resolve-component";

function inst(type: any, parent: any = null): any {
  return { type, parent };
}

describe("resolveComponent", () => {
  it("resolves name/file/chain from the __vueParentComponent chain", () => {
    const root = inst({ __file: "/src/App.vue", name: "App" });
    const counter = inst(
      { __file: "/src/components/Counter.vue", name: "Counter" },
      root,
    );
    const el = document.createElement("button");
    (el as any).__vueParentComponent = counter;
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.vue");
    expect(r.chain).toEqual([
      { name: "Counter", file: "/src/components/Counter.vue" },
      { name: "App", file: "/src/App.vue" },
    ]);
  });

  it("returns null for an element outside the Vue app", () => {
    expect(resolveComponent(document.createElement("div"))).toBeNull();
  });

  it("returns null for null input (empty)", () => {
    expect(resolveComponent(null)).toBeNull();
  });

  it("skips instances without __file up to the first that has one", () => {
    const withFile = inst({ __file: "/src/components/Counter.vue" });
    const leaf = inst({ name: "Inline" }, withFile);
    const el = document.createElement("span");
    (el as any).__vueParentComponent = leaf;
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.vue");
    expect(r.chain).toEqual([
      { name: "Inline", file: null },
      { name: "Counter", file: "/src/components/Counter.vue" },
    ]);
  });

  it("falls back to nearest name and file:null when no __file in chain", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = inst({ name: "Widget" });
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBeNull();
    expect(r.chain).toEqual([{ name: "Widget", file: null }]);
  });

  it("derives the name from the file basename when only __file is present", () => {
    const el = document.createElement("i");
    (el as any).__vueParentComponent = inst({ __file: "/x/y/MyThing.vue" });
    expect(resolveComponent(el)!.name).toBe("MyThing");
  });
});

describe("describeElement", () => {
  it("returns a selector that re-finds the same element", () => {
    document.body.innerHTML = `<section><p class="a b">one</p><p>two</p></section>`;
    const target = document.body.querySelectorAll("p")[1] as Element;
    const d = describeElement(target);
    expect(d.tag).toBe("p");
    expect(document.querySelector(d.selector)).toBe(target);
  });

  it("reports classes and trimmed text", () => {
    document.body.innerHTML = `<div class="x y">  hello  </div>`;
    const d = describeElement(document.querySelector("div")!);
    expect(d.classes).toEqual(["x", "y"]);
    expect(d.text).toBe("hello");
  });

  it("handles the root <html> element without a parent (boundary)", () => {
    const d = describeElement(document.documentElement);
    expect(d.tag).toBe("html");
    expect(document.querySelector(d.selector)).toBe(document.documentElement);
  });

  it("uses an #id shortcut when the element has an id", () => {
    document.body.innerHTML = `<main><button id="go">x</button></main>`;
    const d = describeElement(document.getElementById("go")!);
    expect(d.selector).toBe("#go");
    expect(document.querySelector(d.selector)).toBe(
      document.getElementById("go"),
    );
  });

  it("parses sourceLoc from a data-src-loc attribute", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/Counter.vue:2:3-2:16">hi</div>';
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toEqual({
      file: "/proj/src/Counter.vue",
      startLine: 2,
      startColumn: 3,
      endLine: 2,
      endColumn: 16,
    });
  });

  it("sourceLoc is null when the attribute is absent (element outside a picked template)", () => {
    document.body.innerHTML = "<div>hi</div>";
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toBeNull();
  });

  it("sourceLoc is null for a malformed data-src-loc value (hostile input)", () => {
    document.body.innerHTML = '<div data-src-loc="garbage">hi</div>';
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toBeNull();
  });
});

describe("formatElementPath", () => {
  it("formats tag, component name, and source line/column range", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/components/Counter.vue:12:3-14:9"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/components/Counter.vue", name: "Counter" },
      parent: null,
    };
    expect(formatElementPath(el)).toBe(
      "<div> · Counter · /proj/src/components/Counter.vue:12:3-14:9",
    );
  });

  it("omits line numbers when data-src-loc is absent (no sourceLoc)", () => {
    document.body.innerHTML = "<span></span>";
    const el = document.querySelector("span")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/Widget.vue", name: "Widget" },
      parent: null,
    };
    expect(formatElementPath(el)).toBe(
      "<span> · Widget (/proj/src/Widget.vue)",
    );
  });

  it("omits the file suffix when the component has no __file", () => {
    document.body.innerHTML = "<i></i>";
    const el = document.querySelector("i")!;
    (el as any).__vueParentComponent = { type: { name: "Anon" }, parent: null };
    expect(formatElementPath(el)).toBe("<i> · Anon");
  });

  it("falls back to the CSS selector outside the Vue app (no component)", () => {
    document.body.innerHTML = '<main><button id="go"></button></main>';
    const el = document.getElementById("go")!;
    expect(formatElementPath(el)).toBe("<button> · #go");
  });
});

describe("formatElementPathFromRoot", () => {
  it("builds a root-to-leaf breadcrumb with per-level files and the tag's source location", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/components/Counter.vue:12:3-12:45"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/components/Counter.vue", name: "Counter" },
      parent: {
        type: { __file: "/proj/src/App.vue", name: "App" },
        parent: null,
      },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › Counter (/proj/src/components/Counter.vue) › <div> 12:3-12:45",
    );
  });

  it("handles a single-entry chain when the root component itself is picked (boundary)", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/App.vue:1:1-1:10"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/App.vue", name: "App" },
      parent: null,
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › <div> 1:1-1:10",
    );
  });

  it("renders an ancestor without __file as a bare name (no parens)", () => {
    document.body.innerHTML = "<span></span>";
    const el = document.querySelector("span")!;
    (el as any).__vueParentComponent = {
      type: { name: "Inline" },
      parent: {
        type: { __file: "/proj/src/App.vue", name: "App" },
        parent: null,
      },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › Inline › <span>",
    );
  });

  it("omits the source-location suffix when data-src-loc is absent (empty)", () => {
    document.body.innerHTML = "<i></i>";
    const el = document.querySelector("i")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/App.vue", name: "App" },
      parent: null,
    };
    expect(formatElementPathFromRoot(el)).toBe("App (/proj/src/App.vue) › <i>");
  });

  it("falls back to the CSS selector outside the Vue/React app (no component)", () => {
    document.body.innerHTML = '<main><button id="go"></button></main>';
    const el = document.getElementById("go")!;
    expect(formatElementPathFromRoot(el)).toBe("<button> · #go");
  });

  it("works through the React resolver too (dispatcher)", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";
    const el = document.createElement("button");
    (el as any).__reactFiber$rootpath = {
      type: Counter,
      return: { type: App, return: null },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/src/App.tsx) › Counter (/src/components/Counter.tsx) › <button>",
    );
  });

  it("agrees with formatElementPath's Anonymous fallback when a React fiber chain has no component-typed ancestor", () => {
    const el = document.createElement("span");
    (el as any).__reactFiber$anon = { type: "span", return: null };
    expect(formatElementPath(el)).toBe("<span> · Anonymous");
    expect(formatElementPathFromRoot(el)).toBe("Anonymous › <span>");
  });

  it("collapses consecutive identical ancestors (recursive component) into a single Name ×N entry", () => {
    document.body.innerHTML = "<li></li>";
    const el = document.querySelector("li")!;
    const app = { type: { __file: "/src/App.vue", name: "App" }, parent: null };
    const node3 = {
      type: { __file: "/src/TreeNode.vue", name: "TreeNode" },
      parent: app,
    };
    const node2 = {
      type: { __file: "/src/TreeNode.vue", name: "TreeNode" },
      parent: node3,
    };
    const node1 = {
      type: { __file: "/src/TreeNode.vue", name: "TreeNode" },
      parent: node2,
    };
    (el as any).__vueParentComponent = node1;
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/src/App.vue) › TreeNode ×3 (/src/TreeNode.vue) › <li>",
    );
  });

  it("does not collapse the same component name/file appearing non-consecutively in the chain", () => {
    document.body.innerHTML = "<span></span>";
    const el = document.querySelector("span")!;
    const app = { type: { __file: "/src/App.vue", name: "App" }, parent: null };
    const b = { type: { __file: "/src/B.vue", name: "B" }, parent: app };
    const aAgain = { type: { __file: "/src/App.vue", name: "App" }, parent: b };
    (el as any).__vueParentComponent = aAgain;
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/src/App.vue) › B (/src/B.vue) › App (/src/App.vue) › <span>",
    );
  });

  it("keeps a single-occurrence entry unsuffixed (no ×1)", () => {
    document.body.innerHTML = "<i></i>";
    const el = document.querySelector("i")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/App.vue", name: "App" },
      parent: null,
    };
    expect(formatElementPathFromRoot(el)).not.toContain("×1");
  });
});

describe("resolveComponent dispatcher", () => {
  it("returns null for an element outside both the Vue and React trees", () => {
    expect(resolveComponent(document.createElement("i"))).toBeNull();
  });

  it("dispatches to the React resolver when a react fiber key is present (no __vueParentComponent)", () => {
    function Widget() {}
    (Widget as any).__file = "/src/Widget.tsx";
    const el = document.createElement("span");
    (el as any).__reactFiber$test1 = { type: Widget, return: null };
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBe("/src/Widget.tsx");
  });

  it("prefers the Vue resolver when both markers are present (Vue-marker check comes first)", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = {
      type: { name: "VueWidget" },
      parent: null,
    };
    (el as any).__reactFiber$test2 = {
      type: function ReactWidget() {},
      return: null,
    };
    const r = resolveComponent(el)!;
    expect(r.name).toBe("VueWidget");
  });
});

describe("resolveComponent dispatcher — Preact", () => {
  afterEach(() => {
    delete (window as any).__THISONE_PREACT_MAP__;
  });

  it("dispatches to the Preact resolver when the element is in window.__THISONE_PREACT_MAP__ (no Vue/React markers)", () => {
    function Widget() {}
    (Widget as any).__file = "/src/Widget.tsx";
    const el = document.createElement("span");
    const map = new WeakMap<Element, any>();
    map.set(el, { type: Widget, __e: el, __: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBe("/src/Widget.tsx");
  });

  it("prefers the Vue resolver over the Preact map when both are present", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = {
      type: { name: "VueWidget" },
      parent: null,
    };
    const map = new WeakMap<Element, any>();
    map.set(el, { type: function PreactWidget() {}, __e: el, __: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    expect(resolveComponent(el)!.name).toBe("VueWidget");
  });

  it("prefers the React resolver over the Preact map when both are present", () => {
    function ReactWidget() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$preacttest = { type: ReactWidget, return: null };
    const map = new WeakMap<Element, any>();
    map.set(el, { type: function PreactWidget() {}, __e: el, __: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    expect(resolveComponent(el)!.name).toBe("ReactWidget");
  });

  it("still returns null when no resolver claims the element", () => {
    (window as any).__THISONE_PREACT_MAP__ = new WeakMap();
    expect(resolveComponent(document.createElement("i"))).toBeNull();
  });
});

describe("resolveComponent dispatcher — Svelte", () => {
  it("dispatches to the Svelte resolver when __svelte_meta is present (no Vue/React/Preact markers)", () => {
    const el = document.createElement("span");
    (el as any).__svelte_meta = {
      loc: { file: "/src/Widget.svelte", line: 1, column: 0 },
      parent: null,
    };
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBe("/src/Widget.svelte");
  });

  it("prefers the Vue resolver over __svelte_meta when both are present", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = {
      type: { name: "VueWidget" },
      parent: null,
    };
    (el as any).__svelte_meta = {
      loc: { file: "/src/Widget.svelte", line: 1, column: 0 },
      parent: null,
    };
    expect(resolveComponent(el)!.name).toBe("VueWidget");
  });

  it("prefers the React resolver over __svelte_meta when both are present", () => {
    function ReactWidget() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$sveltetest = { type: ReactWidget, return: null };
    (el as any).__svelte_meta = {
      loc: { file: "/src/Widget.svelte", line: 1, column: 0 },
      parent: null,
    };
    expect(resolveComponent(el)!.name).toBe("ReactWidget");
  });

  it("prefers the Preact resolver over __svelte_meta when both are present", () => {
    const el = document.createElement("span");
    const map = new WeakMap<Element, any>();
    map.set(el, { type: function PreactWidget() {}, __e: el, __: null });
    (window as any).__THISONE_PREACT_MAP__ = map;
    (el as any).__svelte_meta = {
      loc: { file: "/src/Widget.svelte", line: 1, column: 0 },
      parent: null,
    };
    const name = resolveComponent(el)!.name;
    delete (window as any).__THISONE_PREACT_MAP__;
    expect(name).toBe("PreactWidget");
  });

  it("still returns null when no resolver claims the element", () => {
    expect(resolveComponent(document.createElement("i"))).toBeNull();
  });
});
