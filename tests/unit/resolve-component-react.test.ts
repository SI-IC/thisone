// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  getReactFiberKey,
  reactComponentName,
  resolveReactComponent,
} from "../../src/client/resolve-component-react";

function fiber(type: any, ret: any = null): any {
  return { type, return: ret };
}

describe("getReactFiberKey", () => {
  it("finds a key starting with __reactFiber$", () => {
    const el = document.createElement("div");
    (el as any).__reactFiber$abc123 = {};
    expect(getReactFiberKey(el)).toBe("__reactFiber$abc123");
  });

  it("returns undefined when no such key exists", () => {
    expect(getReactFiberKey(document.createElement("div"))).toBeUndefined();
  });
});

describe("reactComponentName", () => {
  it("prefers displayName over name", () => {
    const type: any = function Foo() {};
    type.displayName = "CustomName";
    expect(reactComponentName(type)).toBe("CustomName");
  });

  it("falls back to the function's own name", () => {
    function Bar() {}
    expect(reactComponentName(Bar)).toBe("Bar");
  });

  it("falls back to __name when name/displayName are absent", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__name = "Baz";
    expect(reactComponentName(type)).toBe("Baz");
  });

  it("derives the name from __file's basename as a last resort", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__file = "/src/components/Widget.tsx";
    expect(reactComponentName(type)).toBe("Widget");
  });

  it("falls back to the inner memo() target's name when the wrapper has none", () => {
    function Inner() {}
    const wrapper: any = { $$typeof: Symbol.for("react.memo"), type: Inner };
    expect(reactComponentName(wrapper)).toBe("Inner");
  });

  it("returns Anonymous when nothing is available", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    expect(reactComponentName(type)).toBe("Anonymous");
  });
});

describe("resolveReactComponent", () => {
  it("resolves name/file/chain by walking fiber.return", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";

    const root = fiber(App);
    const counterFiber = fiber(Counter, root);
    const hostFiber = fiber("button", counterFiber);
    const el = document.createElement("button");
    (el as any).__reactFiber$k1 = hostFiber;

    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.tsx");
    expect(r.chain).toEqual(["Counter", "App"]);
  });

  it("returns null for an element with no react fiber key (outside the React tree)", () => {
    expect(resolveReactComponent(document.createElement("div"))).toBeNull();
  });

  it("returns null for null input (empty)", () => {
    expect(resolveReactComponent(null)).toBeNull();
  });

  it("skips host (string-typed) fibers in the chain", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    const el = document.createElement("span");
    (el as any).__reactFiber$k2 = fiber("span", fiber(Counter));
    const r = resolveReactComponent(el)!;
    expect(r.chain).toEqual(["Counter"]);
  });

  it("includes a memo-wrapped component via its $$typeof tag and reads its statics", () => {
    const memoType: any = {
      $$typeof: Symbol.for("react.memo"),
      displayName: "MemoBadge",
      __file: "/src/MemoBadge.tsx",
    };
    const el = document.createElement("span");
    (el as any).__reactFiber$k3 = fiber(memoType);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("MemoBadge");
    expect(r.file).toBe("/src/MemoBadge.tsx");
  });

  it("includes a forwardRef-wrapped component via its $$typeof tag", () => {
    const fwdType: any = {
      $$typeof: Symbol.for("react.forward_ref"),
      __file: "/src/Input.tsx",
      __name: "Input",
    };
    const el = document.createElement("input");
    (el as any).__reactFiber$k4 = fiber(fwdType);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Input");
    expect(r.file).toBe("/src/Input.tsx");
  });

  it("falls back to the inner target's __file when an anonymous memo() wrapper has none of its own", () => {
    function Inner() {}
    (Inner as any).__file = "/src/Inner.tsx";
    const wrapper: any = { $$typeof: Symbol.for("react.memo"), type: Inner };
    const el = document.createElement("span");
    (el as any).__reactFiber$k9 = fiber(wrapper);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Inner");
    expect(r.file).toBe("/src/Inner.tsx");
  });

  it("excludes non-component symbol-tagged fibers (e.g. a context provider) from the chain", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    const providerType: any = { $$typeof: Symbol.for("react.provider") };
    const el = document.createElement("span");
    (el as any).__reactFiber$k5 = fiber(providerType, fiber(App));
    const r = resolveReactComponent(el)!;
    expect(r.chain).toEqual(["App"]);
  });

  it("falls back to nearest name and file:null when no ancestor has __file", () => {
    function Widget() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$k6 = fiber(Widget);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBeNull();
    expect(r.chain).toEqual(["Widget"]);
  });

  it("skips ancestors without __file up to the first that has one", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    function Inline() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$k7 = fiber(Inline, fiber(Counter));
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/Counter.tsx");
    expect(r.chain).toEqual(["Inline", "Counter"]);
  });

  it("stops walking after 1000 ancestors (guard against cyclic/pathological fiber chains)", () => {
    let f: any = null;
    for (let i = 0; i < 1005; i++) {
      const Comp = () => null;
      f = fiber(Comp, f);
    }
    const el = document.createElement("span");
    (el as any).__reactFiber$k8 = f;
    const r = resolveReactComponent(el)!;
    expect(r.chain.length).toBeLessThanOrEqual(1000);
  });
});
