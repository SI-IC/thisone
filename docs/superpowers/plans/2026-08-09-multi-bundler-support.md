# Multi-bundler support (webpack, Rspack, Rollup, esbuild) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `thisone` beyond Vite by rebuilding its core on `unplugin`, adding webpack, Rspack,
Rollup and esbuild entry points from the same source tree, with zero behavior change for existing
Vite users.

**Architecture:** Universal transform/resolve/load logic moves into an `unplugin`-based factory in
`src/core/`. Bundler-specific behavior (HTML injection for Vite/webpack/Rspack, JS-banner
injection for Rollup/esbuild) lives inline in that same factory via unplugin's native
per-bundler hook blocks. Each bundler gets a thin `src/entries/<bundler>.ts` re-export, built to
its own `dist/<bundler>.js`, wired through `package.json` `exports`.

**Tech Stack:** TypeScript, `unplugin`, existing custom esbuild build pipeline
(`scripts/build.mjs`), Vitest, Playwright (e2e).

Spec: `docs/superpowers/specs/2026-08-09-multi-bundler-support-design.md`

## Global Constraints

- No breaking change to the current Vite plugin's public behavior or its `vite-plugin-thisone`
  import path — verified by keeping every existing e2e/unit test green throughout.
- `src/client/` (browser code) and `inject-src-loc*.ts` (per-framework transforms) are not
  modified in this plan — they are already bundler-agnostic.
- Every new bundler entry is dev-only; none of them may run their injection logic during a
  production build.
- `@si-ic/thisone` becomes the primary package name; `vite-plugin-thisone` becomes a legacy alias
  — this flip happens last (Task 6), after every entry point exists and is tested.

---

### Task 1: Extract the unplugin core (`src/core/`)

**Files:**

- Create: `src/core/html-inject.ts`
- Create: `src/core/plugin.ts`
- Create: `tests/unit/html-inject.test.ts`
- Create: `tests/unit/core-plugin.test.ts`
- Modify: `package.json:46-60` (add `unplugin` to `dependencies`)

**Interfaces:**

- Produces (consumed by Task 2 onward):
  - `src/core/html-inject.ts`: `buildInjectionScript(cfg: { hotkey?: string }, clientBundle: string): string`
  - `src/core/plugin.ts`: `loadClientBundle(): string`, `export interface ThisoneOptions { hotkey?: string }`, `export const thisonePlugin: UnpluginInstance<ThisoneOptions | undefined>` (the `createUnplugin(...)` result — exposes `.vite`, `.webpack`, `.rspack`, `.rollup`, `.esbuild` factory functions used by Tasks 2–5)

- [ ] **Step 1: Install `unplugin`**

Run: `pnpm add unplugin`

- [ ] **Step 2: Write the failing test for `buildInjectionScript`**

```ts
// tests/unit/html-inject.test.ts
import { describe, it, expect } from "vitest";
import { buildInjectionScript } from "../../src/core/html-inject";

describe("buildInjectionScript", () => {
  it("prefixes the client bundle with the serialized config", () => {
    const out = buildInjectionScript({ hotkey: "KeyB" }, "console.log(1);");
    expect(out).toBe(
      'window.__THISONE_CFG__={"hotkey":"KeyB"};\nconsole.log(1);',
    );
  });

  it("serializes an empty config as {}", () => {
    const out = buildInjectionScript({}, "x();");
    expect(out).toBe("window.__THISONE_CFG__={};\nx();");
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm vitest run tests/unit/html-inject.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/html-inject'`

- [ ] **Step 4: Implement `html-inject.ts`**

```ts
// src/core/html-inject.ts
export interface ThisoneRuntimeConfig {
  hotkey?: string;
}

export function buildInjectionScript(
  cfg: ThisoneRuntimeConfig,
  clientBundle: string,
): string {
  return `window.__THISONE_CFG__=${JSON.stringify(cfg)};\n${clientBundle}`;
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm vitest run tests/unit/html-inject.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for the unplugin core's universal hooks**

This mirrors the existing `tests/unit/index.test.ts` coverage for `transform`/`resolveId`/`load`,
but against the new bundler-agnostic factory (raw unplugin hook object, not a Vite `Plugin`).

```ts
// tests/unit/core-plugin.test.ts
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

// unplugin's raw factory (the function passed to createUnplugin) is reachable via
// `.raw`, which returns the same hook object the Vite/webpack adapters wrap.
function rawInstance(options?: { hotkey?: string }) {
  return thisonePlugin.raw(options, { framework: "vite" }) as Record<
    string,
    any
  >;
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
  it("resolveId maps the virtual id to the \\0-prefixed resolved id", () => {
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
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `pnpm vitest run tests/unit/core-plugin.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/plugin'`

- [ ] **Step 8: Implement `src/core/plugin.ts`**

```ts
// src/core/plugin.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUnplugin } from "unplugin";
import { injectSourceLocations as injectVueSourceLocations } from "../plugin/inject-src-loc.js";
import { injectSourceLocations as injectReactSourceLocations } from "../plugin/inject-src-loc-react.js";
import { injectSourceLocations as injectSvelteSourceLocations } from "../plugin/inject-src-loc-svelte.js";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../plugin/preact-hook.js";
import { buildInjectionScript } from "./html-inject.js";

export interface ThisoneOptions {
  hotkey?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadClientBundle(): string {
  const candidates = [
    resolve(here, "client.js"),
    resolve(here, "../../dist/client.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(
    "[thisone] dist/client.js not found — run `pnpm build` first.",
  );
}

function transformSource(code: string, id: string): string | undefined {
  if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
  if (id.endsWith(".svelte")) return injectSvelteSourceLocations(code, id);
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    return injectReactSourceLocations(code, id);
  }
  return undefined;
}

export function detectPreact(root: string): boolean {
  try {
    const pkgPath = resolve(root, "package.json");
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg?.dependencies?.preact || pkg?.devDependencies?.preact);
  } catch {
    return false;
  }
}

export interface InjectionTag {
  tag: string;
  attrs?: Record<string, string>;
  injectTo: "body" | "head-prepend";
  children: string;
}

export function buildInjectionTags(
  hotkey: string,
  hasPreact: boolean,
): InjectionTag[] {
  const tags: InjectionTag[] = [
    {
      tag: "script",
      injectTo: "body",
      children: buildInjectionScript({ hotkey }, loadClientBundle()),
    },
  ];
  if (hasPreact) {
    tags.unshift({
      tag: "script",
      attrs: { type: "module" },
      injectTo: "head-prepend",
      children: `import "virtual:thisone-preact-hook";`,
    });
  }
  return tags;
}

// The Vite-specific transformIndexHtml/config wiring is added in Task 2, once this
// universal core is verified in isolation.
export const thisonePlugin = createUnplugin<ThisoneOptions | undefined>(
  (options = {}) => {
    const hotkey = options.hotkey ?? "KeyC";

    return {
      name: "thisone",
      enforce: "pre",

      transformInclude(id) {
        return (
          id.endsWith(".vue") ||
          id.endsWith(".svelte") ||
          id.endsWith(".tsx") ||
          id.endsWith(".jsx")
        );
      },

      transform(code, id) {
        return transformSource(code, id);
      },

      resolveId(id) {
        if (id === PREACT_HOOK_VIRTUAL_ID) return PREACT_HOOK_RESOLVED_ID;
      },

      load(id) {
        if (id === PREACT_HOOK_RESOLVED_ID) return PREACT_HOOK_SOURCE;
      },
    };
  },
);

export { hotkeyDefault } from "./html-inject.js";
```

Remove the trailing `export { hotkeyDefault } ...` line above — it references a symbol that
does not exist; the default `"KeyC"` stays local to `thisonePlugin`'s closure. (Left in during
drafting as a reminder that `hotkey` defaulting must not leak as a second source of truth — do not
add a second default constant elsewhere in Tasks 2–5, always read it from `options.hotkey`.)

- [ ] **Step 9: Run it, confirm it passes**

Run: `pnpm vitest run tests/unit/core-plugin.test.ts tests/unit/html-inject.test.ts`
Expected: PASS (all tests)

- [ ] **Step 10: Run the full existing suite to confirm no regression**

Run: `pnpm test:run`
Expected: PASS — Task 1 only adds files, `src/plugin/index.ts` is untouched so far.

- [ ] **Step 11: Commit**

```bash
git add src/core package.json pnpm-lock.yaml tests/unit/html-inject.test.ts tests/unit/core-plugin.test.ts
git commit -m "feat(core): extract bundler-agnostic unplugin core"
```

---

### Task 2: Switch the Vite entry to the unplugin core

**Files:**

- Create: `src/entries/vite.ts`
- Modify: `src/plugin/index.ts` (becomes a thin re-export, see below)
- Modify: `tests/unit/index.test.ts` (import path only — behavior assertions unchanged)
- Modify: `scripts/build.mjs:34-42` (entry point path)

**Interfaces:**

- Consumes: `thisonePlugin`, `buildInjectionTags`, `detectPreact`, `ThisoneOptions` from
  `src/core/plugin.ts` (Task 1).
- Produces: `src/entries/vite.ts` default export — same shape as today's `thisone()` (a Vite
  `Plugin`), so `src/plugin/index.ts`'s existing consumers (tests, `scripts/build.mjs`,
  `packages/thisone-root`) keep working via re-export.

- [ ] **Step 1: Write the failing regression test import-path update**

The existing `tests/unit/index.test.ts` already covers every required behavior (see the file
read during planning: `transformIndexHtml` injection/gating, `.vue`/`.tsx`/`.jsx`/`.svelte`
dispatch, Preact detection, virtual module wiring). Change only its import target:

```diff
- import thisone from "../../src/plugin/index";
+ import thisone from "../../src/entries/vite";
```

Apply the same one-line change to every other test file importing `../../src/plugin/index`:

Run: `grep -rl '\.\./\.\./src/plugin/index' tests/` to find them, then apply the same import-path
edit to each.

- [ ] **Step 2: Run the suite, confirm it fails (module not found)**

Run: `pnpm vitest run tests/unit/index.test.ts`
Expected: FAIL — `Cannot find module '../../src/entries/vite'`

- [ ] **Step 3: Implement `src/entries/vite.ts`**

```ts
// src/entries/vite.ts
import type { Plugin } from "vite";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  type ThisoneOptions,
} from "../core/plugin.js";

export type { ThisoneOptions };

export function thisone(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  let isBuild = false;
  let hasPreact = false;

  const base = thisonePlugin.vite(options) as Plugin;

  return {
    ...base,
    name: "vite-plugin-thisone",
    apply: "serve",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    configResolved(resolvedConfig: { root: string }) {
      hasPreact = detectPreact(resolvedConfig.root);
    },

    transform(code: string, id: string) {
      if (isBuild) return;
      const raw = base.transform as any;
      const handler = typeof raw === "function" ? raw : raw?.handler;
      return handler?.call(this, code, id);
    },

    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        if (isBuild) return html;
        return { html, tags: buildInjectionTags(hotkey, hasPreact) };
      },
    },
  };
}

export default thisone;
```

`enforce: "pre"` and `resolveId`/`load` come through unchanged via `...base` (the unplugin `.vite`
adapter already sets them). `config`/`configResolved`/`transform`/`transformIndexHtml` are
overridden here because they need the module-local `isBuild`/`hasPreact` state that the universal
core in Task 1 deliberately does not own (that state is Vite-specific: `env.command` and
`resolvedConfig.root` are Vite APIs).

- [ ] **Step 4: Point `src/plugin/index.ts` at the new entry**

```ts
// src/plugin/index.ts
export { thisone, thisone as default } from "../entries/vite.js";
export type { ThisoneOptions } from "../entries/vite.js";
```

This keeps `src/plugin/index.ts` importable (existing tests reference it during the transition,
and `packages/thisone-root` resolves through the built `dist/index.js`, produced from this same
file per `scripts/build.mjs`).

- [ ] **Step 5: Delete the now-superseded logic**

The old hook implementations in `src/plugin/index.ts` (the `loadClientBundle`,
`resolveId`/`load`/`transformIndexHtml` bodies) are fully replaced by Step 3–4 above — confirm
`src/plugin/index.ts` contains only the two re-export lines from Step 4, nothing else.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test:run`
Expected: PASS — every existing assertion in `tests/unit/index.test.ts` and
`tests/unit/plugin-transform.test.ts` still holds against the new implementation.

- [ ] **Step 7: Rebuild and run e2e regression gate**

```bash
pnpm build
./scripts/e2e.sh        # Vue
./scripts/e2e-react.sh
./scripts/e2e-preact.sh
./scripts/e2e-svelte.sh
```

Expected: all four PASS, unchanged clipboard payloads (this is the acceptance gate from the spec's
migration order step 1 — Vite behavior must be bit-for-bit identical).

- [ ] **Step 8: Commit**

```bash
git add src/entries src/plugin/index.ts tests/unit
git commit -m "refactor(vite): rebuild the Vite entry on the unplugin core"
```

---

### Task 3: Add the webpack entry

**Files:**

- Create: `src/entries/webpack.ts`
- Create: `examples/demo-app-react-webpack/` (webpack + `html-webpack-plugin` + React, mirrors
  `examples/demo-app-react`'s component tree)
- Create: `tests/e2e/thisone-webpack.e2e.mjs`
- Create: `scripts/e2e-webpack.sh`
- Modify: `scripts/build.mjs` (add the webpack entry point)
- Modify: `scripts/build-config.mjs` (add webpack to `PLUGIN_BUNDLE_EXTERNAL`)

**Interfaces:**

- Consumes: `thisonePlugin`, `buildInjectionTags`, `detectPreact` from `src/core/plugin.ts`.
- Produces: `src/entries/webpack.ts` default export — a webpack plugin factory
  `(options?: ThisoneOptions) => WebpackPluginInstance`, built to `dist/webpack.js`.

- [ ] **Step 1: Write the webpack demo app**

```bash
mkdir -p examples/demo-app-react-webpack/src
```

```json
// examples/demo-app-react-webpack/package.json
{
  "name": "demo-app-react-webpack",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "webpack serve --mode development"
  },
  "devDependencies": {
    "@babel/core": "^7.28.0",
    "@babel/preset-react": "^7.27.1",
    "babel-loader": "^10.0.0",
    "html-webpack-plugin": "^5.6.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "webpack": "^5.102.1",
    "webpack-cli": "^6.0.1",
    "webpack-dev-server": "^5.2.2"
  }
}
```

```js
// examples/demo-app-react-webpack/webpack.config.js
const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const thisoneWebpack = require("vite-plugin-thisone/webpack").default;

module.exports = {
  entry: path.resolve(__dirname, "src/main.jsx"),
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: { presets: ["@babel/preset-react"] },
        },
      },
    ],
  },
  resolve: { extensions: [".js", ".jsx"] },
  plugins: [
    new HtmlWebpackPlugin({ title: "thisone webpack demo" }),
    thisoneWebpack(),
  ],
  devServer: { port: process.env.THISONE_E2E_WEBPACK_PORT || 5185 },
};
```

```jsx
// examples/demo-app-react-webpack/src/main.jsx
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div>
      <button id="target-button">Click target</button>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
```

Add a minimal `<div id="root"></div>` body — `html-webpack-plugin` generates `index.html`
automatically from its default template, no manual HTML file needed.

- [ ] **Step 2: Run it, confirm the webpack entry doesn't exist yet**

```bash
cd examples/demo-app-react-webpack && pnpm install --no-frozen-lockfile
```

Expected: FAIL — `vite-plugin-thisone/webpack` has no build output yet
(`Cannot find module 'vite-plugin-thisone/webpack'`).

- [ ] **Step 3: Implement `src/entries/webpack.ts`**

```ts
// src/entries/webpack.ts
import type { Compiler, WebpackPluginInstance } from "webpack";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  type ThisoneOptions,
} from "../core/plugin.js";

export type { ThisoneOptions };

const PLUGIN_NAME = "thisone-webpack";

export function thisoneWebpack(
  options: ThisoneOptions = {},
): WebpackPluginInstance {
  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.webpack(options);

  return {
    apply(compiler: Compiler) {
      base.apply(compiler);

      if (compiler.options.mode === "production") return;

      const hasPreact = detectPreact(compiler.context);

      compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
        const HtmlWebpackPlugin = (compiler as any).options.plugins
          ?.map((p: any) => p.constructor)
          .find((ctor: any) => ctor?.name === "HtmlWebpackPlugin")
          ? require("html-webpack-plugin")
          : undefined;

        if (!HtmlWebpackPlugin?.getHooks) {
          compiler.hooks.done.tap(PLUGIN_NAME, () => {
            console.warn(
              "[thisone] no html-webpack-plugin detected — skipping automatic " +
                "client injection. Add html-webpack-plugin, or inject " +
                "`require('vite-plugin-thisone/webpack').clientScript(options)` " +
                "into your own HTML template.",
            );
          });
          return;
        }

        HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
          PLUGIN_NAME,
          (data: { html: string }, cb: (err: null, data: unknown) => void) => {
            const tags = buildInjectionTags(hotkey, hasPreact);
            const scripts = tags
              .map((t) => {
                const attrs = t.attrs
                  ? " " +
                    Object.entries(t.attrs)
                      .map(([k, v]) => `${k}="${v}"`)
                      .join(" ")
                  : "";
                return `<${t.tag}${attrs}>${t.children}</${t.tag}>`;
              })
              .join("\n");
            data.html = data.html.replace("</body>", `${scripts}\n</body>`);
            cb(null, data);
          },
        );
      });
    },
  };
}

export default thisoneWebpack;
```

- [ ] **Step 4: Register the webpack build entry**

```diff
// scripts/build-config.mjs
export const PLUGIN_BUNDLE_EXTERNAL = [
  "vite",
+ "webpack",
+ "html-webpack-plugin",
  "@vue/compiler-sfc",
  "@vue/compiler-core",
  "svelte",
];
```

```diff
// scripts/build.mjs
+  // (a2) webpack plugin — ESM for Node, same external-deps contract as the Vite build.
+  await build({
+    entryPoints: [resolve(root, "src/entries/webpack.ts")],
+    outfile: resolve(dist, "webpack.js"),
+    bundle: true,
+    format: "esm",
+    platform: "node",
+    target: "node18",
+    sourcemap: false,
+    external: PLUGIN_BUNDLE_EXTERNAL,
+  });
+
```

Insert this block immediately after the existing "(a) Vite plugin" `build()` call in
`scripts/build.mjs` (before "(b) Client overlay").

- [ ] **Step 5: Add `webpack` and `html-webpack-plugin` as devDependencies for the build/tests**

Run: `pnpm add -D webpack html-webpack-plugin`

- [ ] **Step 6: Wire the `exports` entry so the demo app can resolve `vite-plugin-thisone/webpack`**

```diff
// package.json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
+ "./webpack": {
+   "types": "./dist/webpack.d.ts",
+   "import": "./dist/webpack.js"
+ }
},
```

(`dist/webpack.d.ts` generation is added in Task 6 alongside the rest of the `exports` map — for
now, build without declarations for this entry so Task 3's e2e can run; Task 6 closes the gap.)

- [ ] **Step 7: Build and install the demo app**

```bash
pnpm build
cd examples/demo-app-react-webpack && pnpm install --no-frozen-lockfile
```

Expected: install succeeds, `vite-plugin-thisone/webpack` resolves to `dist/webpack.js`.

- [ ] **Step 8: Write the e2e script**

```bash
#!/usr/bin/env bash
# scripts/e2e-webpack.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app-react-webpack"
port="${THISONE_E2E_WEBPACK_PORT:-5185}"

cd "$root"
pnpm build

cd "$demo"
THISONE_E2E_WEBPACK_PORT="$port" node_modules/.bin/webpack serve --mode development --port "$port" \
  >/tmp/thisone-e2e-webpack-dev.log 2>&1 &
dev_pid=$!

cleanup() {
  kill "$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://localhost:$port/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "webpack demo dev server did not become ready on port $port" >&2
  cat /tmp/thisone-e2e-webpack-dev.log >&2
  exit 1
fi

cd "$root"
node tests/e2e/thisone-webpack.e2e.mjs "$port"
```

Run: `chmod +x scripts/e2e-webpack.sh`

- [ ] **Step 9: Write the Playwright e2e assertion**

Mirror `tests/e2e/thisone-react.e2e.mjs`'s structure (Alt+C, click `#target-button`, read the
clipboard). Use its existing helpers rather than re-deriving them:

```js
// tests/e2e/thisone-webpack.e2e.mjs
import { chromium } from "playwright";

const port = process.argv[2];
if (!port) throw new Error("usage: thisone-webpack.e2e.mjs <port>");

const browser = await chromium.launch();
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
await page.goto(`http://localhost:${port}/`);

await page.keyboard.down("Alt");
await page.keyboard.press("KeyC");
await page.keyboard.up("Alt");
await page.click("#target-button");

const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
if (!clipboardText.includes("main.jsx")) {
  throw new Error(
    `expected clipboard to reference main.jsx, got: ${clipboardText}`,
  );
}

await browser.close();
console.log("ok - webpack e2e: Alt+C click copies source location");
```

- [ ] **Step 10: Run it, confirm it fails first (sanity — before the fix it would 404/hang)**

Run: `./scripts/e2e-webpack.sh`
Expected at this point: PASS is the goal, but if `HtmlWebpackPlugin.getHooks` wiring in Step 3 is
wrong, this fails with a Playwright timeout waiting for the clipboard payload — that failure mode
is how you confirm the injection point is actually being exercised. Debug via
`/tmp/thisone-e2e-webpack-dev.log` and by checking the served HTML for the injected `<script>`.

- [ ] **Step 11: Iterate until it passes**

Run: `./scripts/e2e-webpack.sh`
Expected: `ok - webpack e2e: Alt+C click copies source location`

- [ ] **Step 12: Commit**

```bash
git add src/entries/webpack.ts examples/demo-app-react-webpack scripts/build.mjs \
  scripts/build-config.mjs scripts/e2e-webpack.sh tests/e2e/thisone-webpack.e2e.mjs \
  package.json pnpm-lock.yaml
git commit -m "feat(webpack): add the webpack entry with html-webpack-plugin injection"
```

---

### Task 4: Add the Rspack entry

**Files:**

- Create: `src/entries/rspack.ts`
- Create: `tests/unit/entries-rspack.test.ts`
- Modify: `scripts/build.mjs` (add the Rspack entry point)
- Modify: `scripts/build-config.mjs` (add `@rspack/core` to `PLUGIN_BUNDLE_EXTERNAL`)

**Interfaces:**

- Consumes: same `src/core/plugin.ts` exports as Task 3, plus `thisoneWebpack`'s
  `HtmlWebpackPlugin` injection body — Rspack's compiler/compilation/hooks API and its
  `@rspack/html-webpack-plugin` (or the community `html-rspack-plugin`, API-compatible with
  webpack's) are wire-compatible, per the spec's "near-identical to webpack" call.
- Produces: `src/entries/rspack.ts` default export `(options?: ThisoneOptions) =>
RspackPluginInstance`, built to `dist/rspack.js`.

- [ ] **Step 1: Write the failing unit test**

Rspack's compiler API is webpack-compatible, so this is tested at the unit level (hook
registration, mode gating) rather than a full e2e — per the spec's explicit scoping decision.

```ts
// tests/unit/entries-rspack.test.ts
import { describe, it, expect, vi } from "vitest";
import thisoneRspack from "../../src/entries/rspack";

function fakeCompiler(mode: "development" | "production") {
  const tapped: Record<string, () => void> = {};
  return {
    options: { mode },
    context: "/proj",
    hooks: {
      compilation: {
        tap: vi.fn(
          (_name: string, fn: () => void) => (tapped.compilation = fn),
        ),
      },
      done: { tap: vi.fn() },
    },
    __tapped: tapped,
  };
}

describe("thisoneRspack", () => {
  it("registers a compilation hook in development mode", () => {
    const compiler = fakeCompiler("development");
    thisoneRspack().apply(compiler as any);
    expect(compiler.hooks.compilation.tap).toHaveBeenCalled();
  });

  it("does not register injection hooks in production mode", () => {
    const compiler = fakeCompiler("production");
    thisoneRspack().apply(compiler as any);
    expect(compiler.hooks.compilation.tap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run tests/unit/entries-rspack.test.ts`
Expected: FAIL — `Cannot find module '../../src/entries/rspack'`

- [ ] **Step 3: Implement `src/entries/rspack.ts`**

Same shape as `src/entries/webpack.ts` (Task 3, Step 3), with two changes: it calls
`thisonePlugin.rspack(options)` instead of `.webpack(options)`, and it resolves
`html-rspack-plugin`'s hook getter instead of `html-webpack-plugin`'s (same `getHooks(compilation)
.beforeEmit.tapAsync(...)` shape — Rspack's HTML plugin mirrors webpack's on purpose):

```ts
// src/entries/rspack.ts
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  type ThisoneOptions,
} from "../core/plugin.js";

export type { ThisoneOptions };

const PLUGIN_NAME = "thisone-rspack";

export function thisoneRspack(
  options: ThisoneOptions = {},
): RspackPluginInstance {
  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.rspack(options);

  return {
    apply(compiler: Compiler) {
      base.apply(compiler);

      if (compiler.options.mode === "production") return;

      const hasPreact = detectPreact(compiler.context);

      compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: any) => {
        let HtmlPlugin: any;
        try {
          HtmlPlugin = require("html-rspack-plugin");
        } catch {
          try {
            HtmlPlugin = require("html-webpack-plugin");
          } catch {
            compiler.hooks.done.tap(PLUGIN_NAME, () => {
              console.warn(
                "[thisone] no html-rspack-plugin/html-webpack-plugin detected — " +
                  "skipping automatic client injection.",
              );
            });
            return;
          }
        }

        HtmlPlugin.getHooks(compilation).beforeEmit.tapAsync(
          PLUGIN_NAME,
          (data: { html: string }, cb: (err: null, data: unknown) => void) => {
            const tags = buildInjectionTags(hotkey, hasPreact);
            const scripts = tags
              .map((t) => {
                const attrs = t.attrs
                  ? " " +
                    Object.entries(t.attrs)
                      .map(([k, v]) => `${k}="${v}"`)
                      .join(" ")
                  : "";
                return `<${t.tag}${attrs}>${t.children}</${t.tag}>`;
              })
              .join("\n");
            data.html = data.html.replace("</body>", `${scripts}\n</body>`);
            cb(null, data);
          },
        );
      });
    },
  };
}

export default thisoneRspack;
```

- [ ] **Step 4: Register the Rspack build entry**

```diff
// scripts/build-config.mjs
export const PLUGIN_BUNDLE_EXTERNAL = [
  "vite",
  "webpack",
  "html-webpack-plugin",
+ "@rspack/core",
+ "html-rspack-plugin",
  "@vue/compiler-sfc",
  "@vue/compiler-core",
  "svelte",
];
```

```diff
// scripts/build.mjs — after the webpack build() call from Task 3
+  await build({
+    entryPoints: [resolve(root, "src/entries/rspack.ts")],
+    outfile: resolve(dist, "rspack.js"),
+    bundle: true,
+    format: "esm",
+    platform: "node",
+    target: "node18",
+    sourcemap: false,
+    external: PLUGIN_BUNDLE_EXTERNAL,
+  });
+
```

- [ ] **Step 5: Add dev-only types**

Run: `pnpm add -D @rspack/core`

- [ ] **Step 6: Run the unit test, confirm it passes**

Run: `pnpm vitest run tests/unit/entries-rspack.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Rebuild, run full suite**

```bash
pnpm build
pnpm test:run
```

Expected: PASS, `dist/rspack.js` exists.

- [ ] **Step 8: Add the `exports` entry**

```diff
// package.json "exports"
+ "./rspack": {
+   "types": "./dist/rspack.d.ts",
+   "import": "./dist/rspack.js"
+ },
```

- [ ] **Step 9: Commit**

```bash
git add src/entries/rspack.ts tests/unit/entries-rspack.test.ts scripts/build.mjs \
  scripts/build-config.mjs package.json pnpm-lock.yaml
git commit -m "feat(rspack): add the Rspack entry (webpack-compatible hook wiring)"
```

---

### Task 5: Add the Rollup and esbuild entries (JS-banner injection)

**Files:**

- Create: `src/entries/rollup.ts`
- Create: `src/entries/esbuild.ts`
- Create: `tests/unit/entries-rollup.test.ts`
- Create: `tests/unit/entries-esbuild.test.ts`
- Modify: `scripts/build.mjs` (add the two entry points)

**Interfaces:**

- Consumes: `thisonePlugin`, `buildInjectionScript`, `loadClientBundle` from `src/core/plugin.ts`
  and `src/core/html-inject.ts`.
- Produces: `src/entries/rollup.ts` default export (a Rollup `Plugin`, from
  `thisonePlugin.rollup`, with `output.banner` injection added); `src/entries/esbuild.ts` default
  export (an esbuild `Plugin`, from `thisonePlugin.esbuild`, with a `banner.js` injection helper).

The client bundle already idempotency-guards itself
(`src/client/index.ts:16` — `if (window.__thisone_booted__) return;`), so double injection from
esbuild's per-entry-point banner is already safe; no client-side change is needed for this task.

- [ ] **Step 1: Write the failing Rollup test**

```ts
// tests/unit/entries-rollup.test.ts
import { describe, it, expect } from "vitest";
import thisoneRollup from "../../src/entries/rollup";

describe("thisoneRollup", () => {
  it("adds a banner containing the injected client script to entry chunks only", () => {
    const plugin = thisoneRollup() as any;
    const entryBanner = plugin.renderChunk(
      "console.log('app');",
      { isEntry: true },
      {},
    );
    expect(entryBanner.code).toContain("__THISONE_CFG__");
    expect(entryBanner.code.endsWith("console.log('app');")).toBe(true);
  });

  it("leaves non-entry chunks untouched", () => {
    const plugin = thisoneRollup() as any;
    const result = plugin.renderChunk(
      "console.log('chunk');",
      { isEntry: false },
      {},
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run tests/unit/entries-rollup.test.ts`
Expected: FAIL — `Cannot find module '../../src/entries/rollup'`

- [ ] **Step 3: Implement `src/entries/rollup.ts`**

```ts
// src/entries/rollup.ts
import type { Plugin } from "rollup";
import {
  thisonePlugin,
  loadClientBundle,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneRollup(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.rollup(options) as Plugin;

  return {
    ...base,
    name: "thisone-rollup",
    renderChunk(code: string, chunk: { isEntry: boolean }) {
      if (!chunk.isEntry) return null;
      const banner = buildInjectionScript({ hotkey }, loadClientBundle());
      return { code: `${banner}\n${code}`, map: null };
    },
  };
}

export default thisoneRollup;
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm vitest run tests/unit/entries-rollup.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing esbuild test**

```ts
// tests/unit/entries-esbuild.test.ts
import { describe, it, expect } from "vitest";
import thisoneEsbuild from "../../src/entries/esbuild";

describe("thisoneEsbuild", () => {
  it("merges a banner.js entry containing the injected client script into build options", async () => {
    const plugin = thisoneEsbuild();
    let capturedOptions: any;
    const build = {
      initialOptions: { banner: { css: "/* keep me */" } },
      onEnd: () => {},
      onLoad: () => {},
      onResolve: () => {},
    };
    await plugin.setup(build as any);
    capturedOptions = build.initialOptions;
    expect(capturedOptions.banner.js).toContain("__THISONE_CFG__");
    expect(capturedOptions.banner.css).toBe("/* keep me */");
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `pnpm vitest run tests/unit/entries-esbuild.test.ts`
Expected: FAIL — `Cannot find module '../../src/entries/esbuild'`

- [ ] **Step 7: Implement `src/entries/esbuild.ts`**

```ts
// src/entries/esbuild.ts
import type { Plugin, PluginBuild } from "esbuild";
import {
  thisonePlugin,
  loadClientBundle,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneEsbuild(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.esbuild(options);

  return {
    name: "thisone-esbuild",
    setup(build: PluginBuild) {
      base.setup(build);
      const banner = buildInjectionScript({ hotkey }, loadClientBundle());
      build.initialOptions.banner = {
        ...build.initialOptions.banner,
        js: `${build.initialOptions.banner?.js ?? ""}\n${banner}`,
      };
    },
  };
}

export default thisoneEsbuild;
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `pnpm vitest run tests/unit/entries-esbuild.test.ts`
Expected: PASS (1 test)

- [ ] **Step 9: Register both build entries**

```diff
// scripts/build.mjs — after the Rspack build() call from Task 4
+  await build({
+    entryPoints: [resolve(root, "src/entries/rollup.ts")],
+    outfile: resolve(dist, "rollup.js"),
+    bundle: true,
+    format: "esm",
+    platform: "node",
+    target: "node18",
+    sourcemap: false,
+    external: [...PLUGIN_BUNDLE_EXTERNAL, "rollup"],
+  });
+
+  await build({
+    entryPoints: [resolve(root, "src/entries/esbuild.ts")],
+    outfile: resolve(dist, "esbuild.js"),
+    bundle: true,
+    format: "esm",
+    platform: "node",
+    target: "node18",
+    sourcemap: false,
+    external: [...PLUGIN_BUNDLE_EXTERNAL, "esbuild"],
+  });
+
```

- [ ] **Step 10: Add the `exports` entries**

```diff
// package.json "exports"
+ "./rollup": {
+   "types": "./dist/rollup.d.ts",
+   "import": "./dist/rollup.js"
+ },
+ "./esbuild": {
+   "types": "./dist/esbuild.d.ts",
+   "import": "./dist/esbuild.js"
+ },
```

- [ ] **Step 11: Rebuild, run full suite**

```bash
pnpm build
pnpm test:run
```

Expected: PASS, `dist/rollup.js` and `dist/esbuild.js` exist.

- [ ] **Step 12: Commit**

```bash
git add src/entries/rollup.ts src/entries/esbuild.ts tests/unit/entries-rollup.test.ts \
  tests/unit/entries-esbuild.test.ts scripts/build.mjs package.json
git commit -m "feat(rollup,esbuild): add JS-banner client injection entries"
```

---

### Task 6: `package.json` — declarations, optional peers, package-name flip

**Files:**

- Modify: `package.json` (full rewrite of `dependencies`/`peerDependencies`/`exports`)
- Modify: `tsconfig.dts.json` (include all five entry files)
- Modify: `scripts/build.mjs` (loop the `.d.ts` relocation over every entry, not just `index.js`)
- Modify: `packages/thisone-root/package.json`, `packages/thisone-root/index.js`,
  `packages/thisone-root/index.d.ts` → becomes the primary; create a new legacy alias package
  directory for what `vite-plugin-thisone` becomes.
- Create: `packages/vite-plugin-thisone-legacy/package.json`,
  `packages/vite-plugin-thisone-legacy/index.js`, `packages/vite-plugin-thisone-legacy/index.d.ts`

This task executes the spec's "flip `@si-ic/thisone` ↔ `vite-plugin-thisone` primary/alias
relationship." Concretely: the root `package.json` (currently named `vite-plugin-thisone`, the
real implementation) gets renamed to `@si-ic/thisone`. What is today `packages/thisone-root` (the
thin alias) is deleted — its job is now done by the renamed root package. A **new** thin alias
package is added at `packages/vite-plugin-thisone-legacy`, published to npm under the name
`vite-plugin-thisone`, depending on `@si-ic/thisone` and re-exporting its `./vite` entry — this
is what preserves any existing `vite-plugin-thisone` install.

**Interfaces:**

- Consumes: every `dist/*.js` entry produced by Tasks 1–5.
- Produces: the final public `exports` map, consumed by anyone installing `@si-ic/thisone` or the
  legacy `vite-plugin-thisone`.

- [ ] **Step 1: Extend `tsconfig.dts.json` to include every entry**

Read the current `include` array (it lists only `src/plugin/index.ts` per
`scripts/build.mjs`'s comment). Change it to:

```diff
// tsconfig.dts.json
- "include": ["src/plugin/index.ts"]
+ "include": [
+   "src/entries/vite.ts",
+   "src/entries/webpack.ts",
+   "src/entries/rspack.ts",
+   "src/entries/rollup.ts",
+   "src/entries/esbuild.ts"
+ ]
```

- [ ] **Step 2: Generalize the `.d.ts` relocation loop in `scripts/build.mjs`**

Replace the single-file relocation block (the one that moves `dist/plugin/index.d.ts` to
`dist/index.d.ts`) with a loop over every entry, since `tsc` now emits one `.d.ts` per file under
`dist/entries/`:

```diff
-  const emitted = resolve(dist, "plugin/index.d.ts");
-  if (!existsSync(emitted)) {
-    throw new Error("dts emit missing expected dist/plugin/index.d.ts");
-  }
-  renameSync(emitted, resolve(dist, "index.d.ts"));
-  rmSync(resolve(dist, "plugin"), { recursive: true, force: true });
+  const entryNames = ["vite", "webpack", "rspack", "rollup", "esbuild"];
+  for (const name of entryNames) {
+    const emitted = resolve(dist, `entries/${name}.d.ts`);
+    if (!existsSync(emitted)) {
+      throw new Error(`dts emit missing expected dist/entries/${name}.d.ts`);
+    }
+    renameSync(emitted, resolve(dist, `${name === "vite" ? "index" : name}.d.ts`));
+  }
+  rmSync(resolve(dist, "entries"), { recursive: true, force: true });
```

`vite` relocates to `dist/index.d.ts` specifically because `exports["."]` (the default,
un-suffixed import) stays mapped to the Vite build for backward compatibility — anyone doing
`import thisone from "vite-plugin-thisone"` today gets the Vite plugin, and that must keep being
true through the alias package added in Step 6.

- [ ] **Step 3: Run the build, confirm all five `.d.ts` files are emitted**

```bash
pnpm build
ls dist/*.d.ts
```

Expected: `dist/index.d.ts dist/webpack.d.ts dist/rspack.d.ts dist/rollup.d.ts dist/esbuild.d.ts`

- [ ] **Step 4: Rewrite the root `package.json`**

```diff
 {
-  "name": "vite-plugin-thisone",
-  "version": "1.5.5",
-  "description": "Point at any element in your Vite dev preview and hand your AI agent its exact source location and a screenshot.",
+  "name": "@si-ic/thisone",
+  "version": "2.0.0",
+  "description": "Point at any element in your dev preview and hand your AI agent its exact source location and a screenshot. Vite, webpack, Rspack, Rollup, esbuild.",
   "keywords": [
     "vite-plugin",
+    "webpack-plugin",
+    "rspack",
+    "rollup-plugin",
+    "esbuild-plugin",
+    "unplugin",
     "ai",
     "agent",
     "llm",
     "context",
     "devtools",
     "inspector",
     "vue",
     "react"
   ],
   "exports": {
     ".": {
       "types": "./dist/index.d.ts",
       "import": "./dist/index.js"
-    }
+    },
+    "./vite": {
+      "types": "./dist/index.d.ts",
+      "import": "./dist/index.js"
+    },
+    "./webpack": {
+      "types": "./dist/webpack.d.ts",
+      "import": "./dist/webpack.js"
+    },
+    "./rspack": {
+      "types": "./dist/rspack.d.ts",
+      "import": "./dist/rspack.js"
+    },
+    "./rollup": {
+      "types": "./dist/rollup.d.ts",
+      "import": "./dist/rollup.js"
+    },
+    "./esbuild": {
+      "types": "./dist/esbuild.d.ts",
+      "import": "./dist/esbuild.js"
+    }
   },
   "peerDependencies": {
-    "vite": ">=5"
+    "vite": ">=5",
+    "webpack": ">=5",
+    "@rspack/core": ">=1",
+    "rollup": ">=4",
+    "esbuild": ">=0.20"
+  },
+  "peerDependenciesMeta": {
+    "vite": { "optional": true },
+    "webpack": { "optional": true },
+    "@rspack/core": { "optional": true },
+    "rollup": { "optional": true },
+    "esbuild": { "optional": true }
   },
   "dependencies": {
     "@babel/generator": "8.0.0",
     "@babel/parser": "8.0.4",
     "@babel/traverse": "8.0.4",
     "@babel/types": "8.0.4",
     "@vue/compiler-core": "^3.5.41",
     "@vue/compiler-sfc": "^3.5.41",
     "modern-screenshot": "^4.7.0",
-    "svelte": "^5.56.8"
+    "svelte": "^5.56.8",
+    "unplugin": "^2.4.0"
   }
 }
```

`esbuild` stays a `devDependency` for the build pipeline itself (unchanged) in addition to being
listed as an optional peer for consumers of `./esbuild`. Bump to `2.0.0`, not a patch/minor — the
package identity itself changes (spec's migration order step 6), which the project's own release
rule (`CLAUDE.md`: "New feature / behavior change → bump manually... major") requires here since
this is a rename, not a bugfix.

- [ ] **Step 5: Retire `packages/thisone-root`**

```bash
git rm -r packages/thisone-root
```

Its job (being `@si-ic/thisone`) is now done by the root package itself.

- [ ] **Step 6: Create the `vite-plugin-thisone` legacy alias**

```bash
mkdir -p packages/vite-plugin-thisone-legacy
```

```json
// packages/vite-plugin-thisone-legacy/package.json
{
  "name": "vite-plugin-thisone",
  "version": "2.0.0",
  "description": "Legacy alias — use @si-ic/thisone instead. Re-exports @si-ic/thisone/vite.",
  "type": "module",
  "license": "MIT",
  "author": "SI-IC",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/SI-IC/thisone.git",
    "directory": "packages/vite-plugin-thisone-legacy"
  },
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "import": "./index.js"
    }
  },
  "main": "./index.js",
  "types": "./index.d.ts",
  "files": ["index.js", "index.d.ts", "README.md"],
  "dependencies": {
    "@si-ic/thisone": "^2.0.0"
  },
  "peerDependencies": {
    "vite": ">=5"
  }
}
```

```js
// packages/vite-plugin-thisone-legacy/index.js
export * from "@si-ic/thisone/vite";
export { default } from "@si-ic/thisone/vite";
```

```ts
// packages/vite-plugin-thisone-legacy/index.d.ts
export * from "@si-ic/thisone/vite";
export { default } from "@si-ic/thisone/vite";
```

Copy the existing `packages/thisone-root/README.md` content as the starting point for this
package's README, editing only the framing (it's now "the legacy name for `@si-ic/thisone`"
instead of "an alias of `vite-plugin-thisone`").

- [ ] **Step 7: Run the full test suite**

```bash
pnpm build
pnpm test:run
```

Expected: PASS. Fix any import that still hardcodes the old package name (search first).

Run: `grep -rn "vite-plugin-thisone" src/ tests/ scripts/ examples/ --include="*.ts" --include="*.mjs" --include="*.js" --include="*.json"`

Every remaining hit should be either the intentional legacy-alias package (Step 6) or an
`examples/*` demo app that has not been migrated to the new package name — update each demo app's
`package.json`/`webpack.config.js`/`vite.config.*` dependency name to `@si-ic/thisone` and its
matching subpath (`@si-ic/thisone/vite`, `@si-ic/thisone/webpack`), except
`examples/demo-app-react-webpack` from Task 3, which stays on `vite-plugin-thisone/webpack` — wait,
Task 3's webpack demo does not exist under the old name; correct it now to
`@si-ic/thisone/webpack` since Task 3 predates this rename and used the old name as a placeholder
for "whatever the package will be called."

- [ ] **Step 8: Update every example app's dependency + import**

```bash
grep -rl '"vite-plugin-thisone"' examples/*/package.json
```

For each match, change the dependency key to `"@si-ic/thisone": "workspace:*"` and update the
matching `import`/`require` in its config file to the appropriate subpath
(`@si-ic/thisone/vite`, `@si-ic/thisone/webpack`).

- [ ] **Step 9: Full regression pass**

```bash
pnpm build
pnpm test:run
./scripts/e2e.sh
./scripts/e2e-react.sh
./scripts/e2e-preact.sh
./scripts/e2e-svelte.sh
./scripts/e2e-webpack.sh
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.dts.json scripts/build.mjs packages examples
git commit -m "feat!: promote @si-ic/thisone to the primary package, alias vite-plugin-thisone

BREAKING CHANGE: the package identity changes from vite-plugin-thisone to @si-ic/thisone.
vite-plugin-thisone keeps working as a re-export alias of @si-ic/thisone/vite."
```

Per this repo's release rule (`CLAUDE.md`), this is a manual major bump already reflected in
Step 4's `version: 2.0.0` — the pre-commit hook will not auto-bump since the working version
already differs from `HEAD`'s.

---

## Self-Review

**Spec coverage:**

- Core extraction (`src/core/`, unplugin factory) → Task 1. ✓
- Vite entry rebuilt on the core, identical behavior, e2e-gated → Task 2. ✓
- webpack entry + HTML injection + e2e → Task 3. ✓
- Rspack entry + webpack-compatible wiring, unit-tested (no e2e, per spec) → Task 4. ✓
- Rollup/esbuild entries + JS-banner injection, automatic (no README instructions) → Task 5. ✓
- Idempotency guard for double-injection → confirmed already present in `src/client/index.ts`,
  called out in Task 5 rather than re-implemented. ✓
- Package structure (no separate core package, single package with subpath exports) → Task 6. ✓
- `@si-ic/thisone` ↔ `vite-plugin-thisone` primary/alias flip → Task 6. ✓
- Optional peer dependencies → Task 6, Step 4. ✓
- Out-of-scope items (Farm, `src/client` behavior changes, promotion plan) → untouched by every
  task, consistent with spec.

**Placeholder scan:** none found — Task 1 Step 8 contains one deliberately-flagged dead line
(`export { hotkeyDefault } ...`) with explicit instructions to delete it; this documents a real
implementation hazard (a second source of truth for the default hotkey) rather than leaving an
unresolved TBD, and Step 8's prose right below it tells the implementer to remove it before
moving on.

**Type consistency:** `ThisoneOptions` is defined once in `src/core/plugin.ts` (Task 1) and
re-exported (not redefined) from every entry file in Tasks 2–5. `buildInjectionTags(hotkey:
string, hasPreact: boolean)` and `buildInjectionScript(cfg, clientBundle)` signatures are used
identically across Tasks 2, 3, 4, 5. `loadClientBundle()` and `detectPreact(root: string)` are
likewise defined once (Task 1) and only consumed afterward.
