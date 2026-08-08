// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect } from "vitest";
import { resolveSvelteComponent } from "../../src/client/resolve-component-svelte";

function meta(file: string, line: number, column: number, parent: any = null) {
  return { loc: { file, line, column }, parent };
}

function componentFrame(
  file: string,
  componentTag: string | undefined,
  parent: any = null,
) {
  return { type: "component", file, componentTag, parent };
}

function blockFrame(type: string, file: string, parent: any = null) {
  return { type, file, parent };
}

describe("resolveSvelteComponent", () => {
  it("returns null for null input (empty)", () => {
    expect(resolveSvelteComponent(null)).toBeNull();
  });

  it("returns null when __svelte_meta is absent (element outside any Svelte tree)", () => {
    expect(resolveSvelteComponent(document.createElement("div"))).toBeNull();
  });

  it("resolves the root component when __svelte_meta.parent is null (top-level mount, no componentTag available)", () => {
    const el = document.createElement("h1");
    (el as any).__svelte_meta = meta("/src/App.svelte", 3, 2, null);
    const r = resolveSvelteComponent(el)!;
    expect(r.name).toBe("App");
    expect(r.file).toBe("/src/App.svelte");
    expect(r.chain).toEqual([{ name: "App", file: "/src/App.svelte" }]);
  });

  it("resolves name/file/chain by walking __svelte_meta.parent through nested components", () => {
    const el = document.createElement("button");
    const rootFrame = componentFrame("/src/App.svelte", "Counter", null);
    (el as any).__svelte_meta = meta("/src/Counter.svelte", 4, 0, rootFrame);
    const r = resolveSvelteComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/Counter.svelte");
    expect(r.chain).toEqual([
      { name: "Counter", file: "/src/Counter.svelte" },
      { name: "App", file: "/src/App.svelte" },
    ]);
  });

  it("skips non-'component' dev-stack frames (if/each/await/key/render) when building the chain", () => {
    const el = document.createElement("button");
    const rootFrame = componentFrame("/src/App.svelte", "Panel", null);
    const ifFrame = blockFrame("if", "/src/Panel.svelte", rootFrame);
    const counterFrame = componentFrame(
      "/src/Panel.svelte",
      "Counter",
      ifFrame,
    );
    (el as any).__svelte_meta = meta("/src/Counter.svelte", 4, 0, counterFrame);
    const r = resolveSvelteComponent(el)!;
    expect(r.chain).toEqual([
      { name: "Counter", file: "/src/Counter.svelte" },
      { name: "Panel", file: "/src/Panel.svelte" },
      { name: "App", file: "/src/App.svelte" },
    ]);
  });

  it("falls back to the file's basename when a frame has no componentTag (root mount)", () => {
    const el = document.createElement("span");
    (el as any).__svelte_meta = meta("/src/widgets/Widget.svelte", 1, 0, null);
    const r = resolveSvelteComponent(el)!;
    expect(r.name).toBe("Widget");
  });

  it("stops walking after 1000 ancestors (guard against cyclic/pathological dev-stack chains)", () => {
    let parent: any = null;
    for (let i = 0; i < 1005; i++) {
      parent = componentFrame(`/src/Level${i}.svelte`, `Level${i}`, parent);
    }
    const el = document.createElement("span");
    (el as any).__svelte_meta = meta("/src/Leaf.svelte", 1, 0, parent);
    const r = resolveSvelteComponent(el)!;
    expect(r.chain.length).toBeLessThanOrEqual(1001);
  });
});
