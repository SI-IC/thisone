// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  preactComponentName,
  resolvePreactComponent,
} from "../../src/client/resolve-component-preact";

function vnode(type: any, dom: Element | null, parent: any = null): any {
  return { type, _dom: dom, _parent: parent };
}

function withMap(entries: [Element, any][]): void {
  const map = new WeakMap<Element, any>();
  for (const [el, vn] of entries) map.set(el, vn);
  (window as any).__THISONE_PREACT_MAP__ = map;
}

beforeEach(() => {
  delete (window as any).__THISONE_PREACT_MAP__;
});
afterEach(() => {
  delete (window as any).__THISONE_PREACT_MAP__;
});

describe("preactComponentName", () => {
  it("prefers displayName over the function's own name", () => {
    const type: any = function Foo() {};
    type.displayName = "CustomName";
    expect(preactComponentName(type)).toBe("CustomName");
  });

  it("falls back to the function's own name", () => {
    function Bar() {}
    expect(preactComponentName(Bar)).toBe("Bar");
  });

  it("falls back to __name when name/displayName are absent", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__name = "Baz";
    expect(preactComponentName(type)).toBe("Baz");
  });

  it("derives the name from __file's basename as a last resort", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__file = "/src/components/Widget.tsx";
    expect(preactComponentName(type)).toBe("Widget");
  });

  it("returns Anonymous when nothing is available", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    expect(preactComponentName(type)).toBe("Anonymous");
  });
});

describe("resolvePreactComponent", () => {
  it("returns null for null input (empty)", () => {
    expect(resolvePreactComponent(null)).toBeNull();
  });

  it("returns null when the map is absent (no preact-hook installed)", () => {
    expect(resolvePreactComponent(document.createElement("div"))).toBeNull();
  });

  it("returns null when the element has no entry in the map (outside the Preact tree)", () => {
    withMap([]);
    expect(resolvePreactComponent(document.createElement("div"))).toBeNull();
  });

  it("resolves name/file/chain by walking vnode._parent", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";

    const el = document.createElement("button");
    const appVnode = vnode(App, null);
    const counterVnode = vnode(Counter, el, appVnode);
    withMap([[el, counterVnode]]);

    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.tsx");
    expect(r.chain).toEqual([
      { name: "Counter", file: "/src/components/Counter.tsx" },
      { name: "App", file: "/src/App.tsx" },
    ]);
  });

  it("skips host (string-typed) vnodes in the chain", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    const el = document.createElement("span");
    const counterVnode = vnode(Counter, null);
    const hostVnode = vnode("span", el, counterVnode);
    withMap([[el, hostVnode]]);
    const r = resolvePreactComponent(el)!;
    expect(r.chain).toEqual([{ name: "Counter", file: "/src/Counter.tsx" }]);
  });

  it("falls back to nearest name and file:null when no ancestor has __file", () => {
    function Widget() {}
    const el = document.createElement("span");
    withMap([[el, vnode(Widget, el)]]);
    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBeNull();
    expect(r.chain).toEqual([{ name: "Widget", file: null }]);
  });

  it("skips ancestors without __file up to the first that has one", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    function Inline() {}
    const el = document.createElement("span");
    const counterVnode = vnode(Counter, null);
    const inlineVnode = vnode(Inline, el, counterVnode);
    withMap([[el, inlineVnode]]);
    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/Counter.tsx");
    expect(r.chain).toEqual([
      { name: "Inline", file: null },
      { name: "Counter", file: "/src/Counter.tsx" },
    ]);
  });

  it("stops walking after 1000 ancestors (guard against cyclic/pathological vnode chains)", () => {
    let parent: any = null;
    for (let i = 0; i < 1005; i++) {
      const Comp = () => null;
      parent = vnode(Comp, null, parent);
    }
    const el = document.createElement("span");
    const leaf = vnode(() => null, el, parent);
    withMap([[el, leaf]]);
    const r = resolvePreactComponent(el)!;
    expect(r.chain.length).toBeLessThanOrEqual(1000);
  });
});
