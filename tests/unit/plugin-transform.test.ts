import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pickElement from "../../src/plugin/index";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc";

type AnyPlugin = ReturnType<typeof pickElement> & Record<string, any>;

function callConfig(plugin: AnyPlugin, command: "serve" | "build") {
  const hook = plugin.config as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  fn?.call(plugin, {}, { command, mode: command });
}

function callTransform2(plugin: AnyPlugin, code: string, id: string) {
  const t = plugin.transform as any;
  const handler = typeof t === "function" ? t : t.handler;
  return handler.call(plugin, code, id);
}

function callTransform(plugin: AnyPlugin, html: string) {
  const t = plugin.transformIndexHtml as any;
  const handler = typeof t === "function" ? t : t.handler;
  return handler.call(plugin, html, {
    path: "/index.html",
    filename: "index.html",
  });
}

describe("plugin transformIndexHtml", () => {
  beforeAll(() => {
    if (!existsSync(join(process.cwd(), "dist/client.js"))) {
      throw new Error(
        "run `pnpm build` before this test (needs dist/client.js)",
      );
    }
  });

  it("injects the inlined client + config in serve mode", () => {
    const plugin = pickElement({ hotkey: "KeyB" }) as AnyPlugin;
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { tag: string; children: string; injectTo: string }[];
    };
    expect(res.tags).toHaveLength(1);
    const tag = res.tags[0];
    expect(tag.tag).toBe("script");
    expect(tag.injectTo).toBe("body");
    expect(tag.children).toContain("__PICK_ELEMENT_CFG__");
    expect(tag.children).toContain('"hotkey":"KeyB"');
    // the real client bundle is inlined
    expect(tag.children).toContain("__pick_element_root");
  });

  it("does NOT inject in build mode (gating)", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "build");
    const html = "<html><body></body></html>";
    const res = callTransform(plugin, html);
    expect(res).toBe(html);
  });

  it("declares apply:'serve'", () => {
    expect((pickElement() as AnyPlugin).apply).toBe("serve");
  });

  it("declares name:'vite-plugin-pick-element'", () => {
    expect((pickElement() as AnyPlugin).name).toBe("vite-plugin-pick-element");
  });
});

describe("plugin transform (.vue source location)", () => {
  it("declares enforce:'pre' so it runs before @vitejs/plugin-vue", () => {
    expect((pickElement() as AnyPlugin).enforce).toBe("pre");
  });

  it("injects data-src-loc into .vue source in serve mode", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const out = callTransform2(plugin, src, "/proj/src/Counter.vue");
    expect(out).toBe(injectSourceLocations(src, "/proj/src/Counter.vue"));
    expect(out).toContain('data-src-loc="/proj/src/Counter.vue:2:3-2:16"');
  });

  it("does NOT transform in build mode (gating)", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "build");
    const src = `<template><div>hi</div></template>`;
    expect(
      callTransform2(plugin, src, "/proj/src/Counter.vue"),
    ).toBeUndefined();
  });

  it("ignores non-.vue ids and .vue sub-requests (?vue&type=...)", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "serve");
    expect(
      callTransform2(plugin, "export default {}", "/proj/src/util.ts"),
    ).toBeUndefined();
    expect(
      callTransform2(
        plugin,
        "export default {}",
        "/proj/src/Counter.vue?vue&type=script",
      ),
    ).toBeUndefined();
  });
});
