import { describe, it, expect, beforeAll } from "vitest";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync as rmSyncFs,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import thisone from "../../src/plugin/index";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc";
import { injectSourceLocations as injectReactSourceLocations } from "../../src/plugin/inject-src-loc-react";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../../src/plugin/preact-hook";

type AnyPlugin = ReturnType<typeof thisone> & Record<string, any>;

function callConfig(plugin: AnyPlugin, command: "serve" | "build") {
  const hook = plugin.config as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  fn?.call(plugin, {}, { command, mode: command });
}

function callConfigResolved(plugin: AnyPlugin, root: string) {
  const hook = plugin.configResolved as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  fn?.call(plugin, { root, command: "serve" });
}

function projectWith(pkg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "thisone-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
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
    const plugin = thisone({ hotkey: "KeyB" }) as AnyPlugin;
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { tag: string; children: string; injectTo: string }[];
    };
    expect(res.tags).toHaveLength(1);
    const tag = res.tags[0];
    expect(tag.tag).toBe("script");
    expect(tag.injectTo).toBe("body");
    expect(tag.children).toContain("__THISONE_CFG__");
    expect(tag.children).toContain('"hotkey":"KeyB"');
    // the real client bundle is inlined
    expect(tag.children).toContain("__thisone_root");
  });

  it("does NOT inject in build mode (gating)", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "build");
    const html = "<html><body></body></html>";
    const res = callTransform(plugin, html);
    expect(res).toBe(html);
  });

  it("declares apply:'serve'", () => {
    expect((thisone() as AnyPlugin).apply).toBe("serve");
  });

  it("declares name:'vite-plugin-thisone'", () => {
    expect((thisone() as AnyPlugin).name).toBe("vite-plugin-thisone");
  });
});

describe("plugin transform (.vue source location)", () => {
  it("declares enforce:'pre' so it runs before @vitejs/plugin-vue", () => {
    expect((thisone() as AnyPlugin).enforce).toBe("pre");
  });

  it("injects data-src-loc into .vue source in serve mode", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const out = callTransform2(plugin, src, "/proj/src/Counter.vue");
    expect(out).toBe(injectSourceLocations(src, "/proj/src/Counter.vue"));
    expect(out).toContain('data-src-loc="/proj/src/Counter.vue:2:3-2:16"');
  });

  it("does NOT transform in build mode (gating)", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "build");
    const src = `<template><div>hi</div></template>`;
    expect(
      callTransform2(plugin, src, "/proj/src/Counter.vue"),
    ).toBeUndefined();
  });

  it("ignores non-.vue ids and .vue sub-requests (?vue&type=...)", () => {
    const plugin = thisone() as AnyPlugin;
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

describe("plugin transform (.tsx/.jsx source location)", () => {
  it("injects data-src-loc into .tsx source in serve mode", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = callTransform2(plugin, src, "/proj/src/Foo.tsx");
    expect(out).toBe(injectReactSourceLocations(src, "/proj/src/Foo.tsx"));
    expect(out).toContain('data-src-loc={"/proj/src/Foo.tsx:2:10-2:23"}');
  });

  it("injects data-src-loc into .jsx source in serve mode", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `function Foo() {\n  return <span>hi</span>;\n}\n`;
    const out = callTransform2(plugin, src, "/proj/src/Foo.jsx");
    expect(out).toContain('data-src-loc={"/proj/src/Foo.jsx:2:10-2:25"}');
  });

  it("does NOT transform .tsx in build mode (gating)", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "build");
    const src = `function Foo() { return <div>hi</div>; }`;
    expect(callTransform2(plugin, src, "/proj/src/Foo.tsx")).toBeUndefined();
  });

  it("ignores non-.tsx/.jsx/.vue ids", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    expect(
      callTransform2(plugin, "export const x = 1;", "/proj/src/util.ts"),
    ).toBeUndefined();
  });
});

describe("plugin Preact detection (hasPreact)", () => {
  it("detects preact in dependencies and injects the preact-hook script", () => {
    const root = projectWith({ dependencies: { preact: "10.29.8" } });
    const plugin = thisone() as AnyPlugin;
    callConfigResolved(plugin, root);
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { tag: string; children: string; injectTo: string }[];
    };
    expect(
      res.tags.some((t) => t.children.includes("thisone-preact-hook")),
    ).toBe(true);
    rmSyncFs(root, { recursive: true, force: true });
  });

  it("detects preact in devDependencies too", () => {
    const root = projectWith({ devDependencies: { preact: "10.29.8" } });
    const plugin = thisone() as AnyPlugin;
    callConfigResolved(plugin, root);
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { children: string }[];
    };
    expect(
      res.tags.some((t) => t.children.includes("thisone-preact-hook")),
    ).toBe(true);
    rmSyncFs(root, { recursive: true, force: true });
  });

  it("does not inject the preact-hook script for a project without preact", () => {
    const root = projectWith({ dependencies: { vue: "3.5.41" } });
    const plugin = thisone() as AnyPlugin;
    callConfigResolved(plugin, root);
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { children: string }[];
    };
    expect(
      res.tags.some((t) => t.children.includes("thisone-preact-hook")),
    ).toBe(false);
    rmSyncFs(root, { recursive: true, force: true });
  });

  it("degrades to hasPreact:false when package.json is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "thisone-test-"));
    const plugin = thisone() as AnyPlugin;
    expect(() => callConfigResolved(plugin, root)).not.toThrow();
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { children: string }[];
    };
    expect(
      res.tags.some((t) => t.children.includes("thisone-preact-hook")),
    ).toBe(false);
    rmSyncFs(root, { recursive: true, force: true });
  });

  it("degrades to hasPreact:false when package.json is malformed (hostile input)", () => {
    const root = mkdtempSync(join(tmpdir(), "thisone-test-"));
    writeFileSync(join(root, "package.json"), "{ not json");
    const plugin = thisone() as AnyPlugin;
    expect(() => callConfigResolved(plugin, root)).not.toThrow();
    rmSyncFs(root, { recursive: true, force: true });
  });
});

function callResolveId(plugin: AnyPlugin, id: string) {
  const hook = plugin.resolveId as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  return fn?.call(plugin, id);
}

function callLoad(plugin: AnyPlugin, id: string) {
  const hook = plugin.load as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  return fn?.call(plugin, id);
}

describe("plugin Preact virtual module wiring", () => {
  it("resolveId maps the virtual id to the \0-prefixed resolved id", () => {
    const plugin = thisone() as AnyPlugin;
    expect(callResolveId(plugin, PREACT_HOOK_VIRTUAL_ID)).toBe(
      PREACT_HOOK_RESOLVED_ID,
    );
  });

  it("resolveId ignores unrelated ids", () => {
    const plugin = thisone() as AnyPlugin;
    expect(callResolveId(plugin, "some/other/module")).toBeUndefined();
  });

  it("load returns PREACT_HOOK_SOURCE for the resolved id", () => {
    const plugin = thisone() as AnyPlugin;
    expect(callLoad(plugin, PREACT_HOOK_RESOLVED_ID)).toBe(PREACT_HOOK_SOURCE);
  });

  it("load ignores unrelated ids", () => {
    const plugin = thisone() as AnyPlugin;
    expect(callLoad(plugin, "some/other/module")).toBeUndefined();
  });
});
