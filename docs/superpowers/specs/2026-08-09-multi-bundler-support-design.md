# Multi-bundler support (webpack, Rspack, Rollup, esbuild) — design

Date: 2026-08-09

## Goal

Extend `thisone` beyond Vite. Today the plugin only ships a Vite entry
(`vite-plugin-thisone`). This design adds webpack, Rspack, Rollup and esbuild entries from the
same package, without duplicating the per-framework source-location logic and without a breaking
change for any existing Vite install.

## Current architecture (recap)

`src/plugin/index.ts` is a single Vite `Plugin` object. It has three responsibilities mixed
together:

1. **Source-location transform** — `transform(code, id)` dispatches to
   `inject-src-loc.ts` / `inject-src-loc-react.ts` / `inject-src-loc-svelte.ts` based on file
   extension. These functions are pure `(code, id) => code` string/AST transforms with no
   dependency on the Vite API — already bundler-agnostic.
2. **Preact hook virtual module** — `resolveId`/`load` serve a virtual module
   (`PREACT_HOOK_VIRTUAL_ID`) containing `preact-hook.ts`'s source. Also bundler-agnostic in
   content; only the resolve/load mechanism is Vite-specific.
3. **Client injection** — `transformIndexHtml` builds a `<script>` tag containing
   `window.__THISONE_CFG__` plus the built `dist/client.js` bundle and injects it into the dev
   HTML. This is the one piece that is genuinely Vite-specific (HTML pipeline).

`src/client/` (the browser-side code: overlay, screenshot, clipboard, stores) has no Vite
dependency at all.

## Approach

Adopt **[unplugin](https://github.com/unjs/unplugin)** as the plugin framework. unplugin exposes
one universal hook set (`transform`, `transformInclude`, `resolveId`, `load`, …) that maps
directly onto what `src/plugin/index.ts` already does, and generates Vite/webpack/Rspack/
Rollup/esbuild/Farm adapters from a single factory. This is the standard approach used by
comparable multi-bundler dev-tool plugins (`unplugin-vue-components`, `unplugin-icons`, UnoCSS).

unplugin also lets a single factory declare bundler-native hook blocks (`vite: {}`,
`webpack(compiler) {}`, `rspack(compiler) {}`) alongside the universal ones, so
bundler-specific behavior (see "Client injection" below) lives in the same file as the universal
logic — no separate per-bundler adapter files needed.

### Package structure

No new package. Everything stays in one package, restructured internally:

```
src/core/
  plugin.ts            # createUnplugin(...) factory — universal hooks + native per-bundler blocks
  html-inject.ts        # shared: builds the __THISONE_CFG__ + client-bundle script content
  inject-src-loc.ts             # unchanged
  inject-src-loc-react.ts       # unchanged
  inject-src-loc-svelte.ts      # unchanged
  preact-hook.ts                # unchanged
src/client/            # unchanged — browser-side code
```

Public entry points via `package.json` `exports`: `.` (defaults to `./vite` for compat),
`./vite`, `./webpack`, `./rspack`, `./rollup`, `./esbuild` — each re-exporting the matching
unplugin-generated build.

### Package naming

`@si-ic/thisone` (currently a thin alias depending on `vite-plugin-thisone`) becomes the primary
package — it's already reserved, already brand-neutral, and avoids fighting the registry's
similarity block on the bare `thisone` name again. `vite-plugin-thisone` is flipped to a legacy
alias: `export { default } from '@si-ic/thisone/vite'`, so any existing install keeps working
unchanged.

### Client injection per bundler

The client bundle is plain JS with no dependency on how it reaches the page — it doesn't need to
arrive via a `<script>` tag specifically, only to execute once in the browser. Two injection
mechanisms cover all five targets:

- **HTML-pipeline injection** (Vite, webpack, Rspack — these own a dev server with an HTML
  entry):
  - Vite: `transformIndexHtml` inside the `vite: {}` block, same as today.
  - webpack / Rspack: inside `webpack(compiler)` / `rspack(compiler)`, hook
    `html-webpack-plugin`'s `beforeEmit` when present; fall back to rewriting the response body in
    `devServer.setupMiddlewares` when it isn't (e.g. custom HTML templates, SSR dev setups).
    Gated to non-production mode, mirroring today's `apply: "serve"`.
- **JS-banner injection** (Rollup, esbuild — no HTML pipeline to hook):
  - Rollup: `output.banner` / `renderChunk`, injecting only into chunks where `chunk.isEntry` is
    true.
  - esbuild: the `banner.js` build option.

Because banner injection can't always distinguish "one true entry" (esbuild applies `banner` to
every entry point in a multi-entry build), the client bundle gets an idempotency guard so a
double injection is a safe no-op rather than a bug:

```js
if (window.__THISONE_INIT__) return;
window.__THISONE_INIT__ = true;
```

This also means Rollup/esbuild get automatic injection with no README instructions required —
originally scoped as a documented manual step, but the JS-banner mechanism removes the need for
that.

## Data flow (unchanged per-bundler, now shared)

1. Bundler processes a component file → universal `transform` hook fires →
   `inject-src-loc*.ts` annotates it with `file:line:col` source data → unchanged output shape.
2. Bundler starts its dev server → native per-bundler hook injects the client bundle (HTML or JS
   banner) → client attaches its Alt+click listener.
3. User Alt+clicks an element → client reads the annotated source data off the DOM/component
   instance → copies path or screenshot to clipboard. Fully unchanged; this is `src/client/`,
   untouched by this design.

## Error handling

- Missing `dist/client.js` at plugin-load time: same fail-fast `throw` as today
  (`loadClientBundle`), now shared code so every bundler entry gets the same guard.
- webpack/Rspack without `html-webpack-plugin` and without a working `devServer.setupMiddlewares`
  (e.g. a fully custom server): injection silently no-ops rather than throwing — this is a dev
  convenience tool, a broken custom setup shouldn't break the user's build. Log a one-line
  `console.warn` explaining the gap.
- Production builds: every bundler entry short-circuits before any hook does real work, same as
  today's `isBuild` check — verified per bundler (`compiler.options.mode`, Rollup/esbuild have no
  build/serve distinction of their own, so those two entries are dev-only in the sense of
  "load them only in your dev config," documented in the README).

## Testing

- Existing unit tests for `inject-src-loc*.ts` are untouched (pure functions, no bundler
  involved).
- Existing e2e suites (`e2e-react`, `e2e-preact`, `e2e-svelte`, Vue via `e2e.sh`) must stay green
  after the extraction — they're the regression guard that the Vite behavior didn't change.
- New e2e: one webpack-dev-server run (React, since it's the framework with the most webpack
  install base) verifying Alt+click → clipboard payload, matching the shape of the existing e2e
  scripts.
- Rspack: unit-level check that the `rspack(compiler)` hook wiring matches webpack's (Rspack's
  compiler API is webpack-compatible), no separate full e2e initially — revisit if drift appears.
- Rollup/esbuild: unit test asserting the banner/renderChunk output contains the injected script
  once per entry chunk; no browser e2e (no framework story to click through yet, these entries
  ship the transform + injection primitives only).

## Migration order

1. Extract `src/core/plugin.ts` (unplugin factory) + `html-inject.ts`, switch the current Vite
   plugin to consume it with **identical** behavior. Existing e2e suites are the acceptance gate.
2. Re-verify the `vite: {}` native block reproduces today's `transformIndexHtml` exactly.
3. Add `webpack(compiler)` + HTML injection + new webpack e2e.
4. Add `rspack(compiler)` (near-identical to webpack).
5. Add `rollup`/`esbuild` entries with JS-banner injection + unit tests.
6. `package.json`: add `unplugin` dependency; make `vite`/`webpack`/`rollup` (etc.) optional peer
   dependencies; flip `@si-ic/thisone` ↔ `vite-plugin-thisone` primary/alias relationship.

## Out of scope

- Farm and other unplugin-supported targets beyond the five listed — add later if there's demand,
  the factory already supports them for free once this lands.
- Any change to `src/client/` behavior, the clipboard payload format, or the screenshot mechanism.
- Publishing/promotion plan for the new entries — that's a distribution decision, not part of this
  architecture spec.
