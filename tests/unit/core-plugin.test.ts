import { describe, it, expect } from "vitest";
import { thisonePlugin } from "../../src/core/plugin";
import { injectSourceLocations as injectVue } from "../../src/plugin/inject-src-loc";
import { injectSourceLocations as injectReact } from "../../src/plugin/inject-src-loc-react";
import { injectSourceLocations as injectSvelte } from "../../src/plugin/inject-src-loc-svelte";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../../src/plugin/preact-hook";

function rawInstance(options?: { hotkey?: string }) {
  return thisonePlugin.raw(options, {
    framework: "vite",
    versions: {},
  }) as Record<string, any>;
}

describe("core plugin transformInclude", () => {
  it("matches .vue/.svelte/.tsx/.jsx", () => {
    const p = rawInstance();
    expect(p.transformInclude("/proj/src/Counter.vue")).toBe(true);
    expect(p.transformInclude("/proj/src/Widget.svelte")).toBe(true);
    expect(p.transformInclude("/proj/src/Foo.tsx")).toBe(true);
    expect(p.transformInclude("/proj/src/Foo.jsx")).toBe(true);
  });

  it("does not match unrelated ids", () => {
    const p = rawInstance();
    expect(p.transformInclude("/proj/src/util.ts")).toBe(false);
    expect(p.transformInclude("/proj/src/Counter.vue?vue&type=script")).toBe(
      false,
    );
  });
});

describe("core plugin transform dispatch", () => {
  it("routes .vue through the Vue transform", () => {
    const p = rawInstance();
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const id = "/proj/src/Counter.vue";
    expect(p.transform(src, id)).toBe(injectVue(src, id));
  });

  it("routes .tsx through the React transform", () => {
    const p = rawInstance();
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const id = "/proj/src/Foo.tsx";
    expect(p.transform(src, id)).toBe(injectReact(src, id));
  });

  it("routes .svelte through the Svelte transform", () => {
    const p = rawInstance();
    const src = `<div>hi</div>\n`;
    const id = "/proj/src/Widget.svelte";
    expect(p.transform(src, id)).toBe(injectSvelte(src, id));
  });
});

describe("core plugin preact virtual module wiring", () => {
  it("resolveId maps the virtual id to the \0-prefixed resolved id", () => {
    const p = rawInstance();
    expect(p.resolveId(PREACT_HOOK_VIRTUAL_ID)).toBe(PREACT_HOOK_RESOLVED_ID);
    expect(p.resolveId("some/other/module")).toBeUndefined();
  });

  it("load returns PREACT_HOOK_SOURCE for the resolved id", () => {
    const p = rawInstance();
    expect(p.load(PREACT_HOOK_RESOLVED_ID)).toBe(PREACT_HOOK_SOURCE);
    expect(p.load("some/other/module")).toBeUndefined();
  });
});
