// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect, beforeEach } from "vitest";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../../src/plugin/preact-hook";

describe("preact-hook virtual module ids", () => {
  it("resolved id is the virtual id prefixed with \0", () => {
    expect(PREACT_HOOK_RESOLVED_ID).toBe("\0" + PREACT_HOOK_VIRTUAL_ID);
  });
});

describe("PREACT_HOOK_SOURCE (evaluated against a fake preact options object)", () => {
  async function evalHookSource(fakeOptions: any) {
    const rewritten = PREACT_HOOK_SOURCE.replace(
      /import\s*\{\s*options\s*\}\s*from\s*["']preact["'];?/,
      "const options = globalThis.__vitestFakePreactOptions;",
    );
    (globalThis as any).__vitestFakePreactOptions = fakeOptions;
    (globalThis as any).__THISONE_PREACT_MAP__ = undefined;
    // eslint-disable-next-line no-new-func
    new Function(rewritten)();
  }

  beforeEach(() => {
    delete (globalThis as any).__THISONE_PREACT_MAP__;
    delete (window as any).__THISONE_PREACT_MAP__;
  });

  it("installs options.diffed and exposes a WeakMap on window.__THISONE_PREACT_MAP__", async () => {
    const fakeOptions: any = {};
    await evalHookSource(fakeOptions);
    expect(typeof fakeOptions.diffed).toBe("function");
    expect(window.__THISONE_PREACT_MAP__).toBeInstanceOf(WeakMap);
  });

  it("populates the map with vnode._dom -> vnode on diffed", async () => {
    const fakeOptions: any = {};
    await evalHookSource(fakeOptions);
    const dom = document.createElement("div");
    const vnode = { _dom: dom, type: "div" };
    fakeOptions.diffed(vnode);
    expect(window.__THISONE_PREACT_MAP__!.get(dom)).toBe(vnode);
  });

  it("does not throw and skips vnodes with no _dom yet", async () => {
    const fakeOptions: any = {};
    await evalHookSource(fakeOptions);
    expect(() => fakeOptions.diffed({ type: "div" })).not.toThrow();
  });

  it("chains a pre-existing options.diffed instead of clobbering it", async () => {
    const calls: any[] = [];
    const fakeOptions: any = { diffed: (v: any) => calls.push(v) };
    await evalHookSource(fakeOptions);
    const dom = document.createElement("span");
    const vnode = { _dom: dom, type: "span" };
    fakeOptions.diffed(vnode);
    expect(calls).toEqual([vnode]);
    expect(window.__THISONE_PREACT_MAP__!.get(dom)).toBe(vnode);
  });
});
