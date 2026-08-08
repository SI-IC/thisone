# Svelte support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give thisone's Alt+C picker the same feature set for Svelte 5 (`.svelte` files) that it already has for Vue/React/Preact — source location on the picked DOM element, and full-chain component name/file/ancestor-breadcrumb resolution — dev-only, matched purely by `.svelte` file extension (no detection flag needed), zero overhead for non-Svelte projects.

**Architecture:** Svelte 5's compiler, in dev mode, already attaches everything needed directly to the DOM: `el.__svelte_meta.loc` (the element's own defining file/line/column) and `el.__svelte_meta.parent` (a linked list of `dev_stack` frames — `{type: 'component', file, componentTag, parent}` for component instantiations, plus non-component frame types for `{#if}`/`{#each}`/`{#await}`/`{#key}`/`{#snippet}` blocks that get skipped when building the chain). This was confirmed by reading the installed `svelte@5.56.8` source directly and validated empirically against a real 3-level-nested Vite+Svelte app in a headless browser — see the design spec for the full probe output. No runtime hook or virtual module is needed (unlike Preact). The only new plugin-side work is a small `.svelte`-source transform (mirroring the existing `.vue` transform) that injects `data-src-loc="file:startLine:startCol-endLine:endCol"` into element tags, since `__svelte_meta.loc` alone only carries a start position, not a full range. `resolveComponent()` gains a fourth (last) dispatch branch; `describeElement`/`formatElementPath`/`formatElementPathFromRoot`/overlay/clipboard/screenshot code needs zero changes.

**Tech Stack:** TypeScript, new real dependency `svelte` (for `svelte/compiler`'s `parse()`, same category as the existing `@vue/compiler-sfc`/`@vue/compiler-core` dependencies), Vite's `enforce: 'pre'` transform hook (already in place), vitest + happy-dom (unit tests), Playwright (e2e), Svelte 5.56.8 + `@sveltejs/vite-plugin-svelte` 7.2.0 (example app only, devDependency there — not a thisone dependency).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-07-svelte-support-design.md` — read it before starting; this plan implements it verbatim, including its empirical probe evidence for the `__svelte_meta`/`dev_stack` shape.
- **Svelte 5 only.** No Svelte 4 support — out of scope per the design's explicit scope decision.
- New real `dependencies` entry: `svelte` pinned `^5.56.8` (latest stable, confirmed via `npm view svelte version` during planning). Add it next to `modern-screenshot` in `package.json`'s `dependencies` (alphabetical-ish ordering already used there).
- `svelte` must be added to `PLUGIN_BUNDLE_EXTERNAL` in `scripts/build-config.mjs` — the plugin bundle (`dist/index.js`) keeps compiler-ish dependencies external, same reason `@vue/compiler-sfc`/`@vue/compiler-core` are already there (see the `Do not change` comment in `scripts/build.mjs`).
- Plugin stays dev-only: `apply: 'serve'` and the `isBuild` gate in `transform()` are untouched; the new `.svelte` branch sits inside the same early-return as the existing `.vue`/`.tsx`/`.jsx` branches.
- Existing Vue/React/Preact behavior/tests must not change. Any edit to `src/client/resolve-component.ts` or `src/plugin/index.ts` must leave every existing exported name and its Vue/React/Preact-path behavior identical — `tests/unit/resolve-component.test.ts`, `tests/unit/resolve-component-react.test.ts`, `tests/unit/resolve-component-preact.test.ts`, `tests/unit/inject-src-loc.test.ts`, `tests/unit/inject-src-loc-react.test.ts`, and `tests/unit/plugin-transform.test.ts`'s pre-existing cases must stay green throughout.
- Run `pnpm exec tsc --noEmit -p tsconfig.json` after every task that adds/edits a `.ts` file.
- `pnpm build` must succeed after every plugin/client task — several tests (`plugin-transform.test.ts`) require `dist/client.js` to exist via `beforeAll`.
- No detection flag (no `hasSvelte`) — the `.svelte` transform is matched purely by file extension, exactly like the existing `.vue` transform. Do not add a `configResolved`-based detection step; it isn't needed for this feature.

---

### Task 1: `.svelte` source-location transform (+ shared `escapeAttr` extraction)

**Files:**

- Create: `src/plugin/escape-attr.ts`
- Create: `src/plugin/inject-src-loc-svelte.ts`
- Modify: `src/plugin/inject-src-loc.ts`
- Test: `tests/unit/inject-src-loc-svelte.test.ts`

**Interfaces:**

- `escape-attr.ts` produces: `export function escapeAttr(value: string): string`.
- `inject-src-loc-svelte.ts` produces: `export function injectSourceLocations(source: string, file: string): string` — same shape and silent-degrade contract as the Vue transform's export of the same name (different module, so no naming collision). Task 2 imports it aliased.

- [ ] **Step 1: Extract the shared `escapeAttr` helper**

Create `src/plugin/escape-attr.ts`:

```ts
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

In `src/plugin/inject-src-loc.ts`, remove the local `escapeAttr` function definition and replace it with an import:

```ts
import { escapeAttr } from "./escape-attr.js";
```

(Place this import alongside the existing `@vue/compiler-sfc`/`@vue/compiler-core` imports at the top of the file.)

- [ ] **Step 2: Run the existing Vue transform tests to confirm the extraction didn't break anything**

Run: `pnpm exec vitest run tests/unit/inject-src-loc.test.ts`
Expected: PASS, all pre-existing cases unchanged (pure refactor, no behavior change).

- [ ] **Step 3: Write the failing tests for the Svelte transform**

Create `tests/unit/inject-src-loc-svelte.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc-svelte";

const FILE = "/proj/src/components/Counter.svelte";

function attrOf(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc="([^"]+)"`);
  const m = re.exec(html);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${html}`);
  return m[1];
}

describe("injectSourceLocations (Svelte)", () => {
  it("injects file:startLine:startCol-endLine:endCol on a single element", () => {
    const src = `<div>hi</div>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:1:1-1:14`);
  });

  it("injects distinct locations on nested elements", () => {
    const src = `<section>\n  <p>x</p>\n</section>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "section")).toBe(`${FILE}:1:1-3:11`);
    expect(attrOf(out, "p")).toBe(`${FILE}:2:3-2:11`);
  });

  it("injects on multiple root-level elements (Svelte templates have no single-root requirement)", () => {
    const src = `<div>a</div>\n<span>b</span>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:1:1-1:13`);
    expect(attrOf(out, "span")).toBe(`${FILE}:2:1-2:15`);
  });

  it("injects on elements inside {#if} and {#each} blocks without touching the block syntax", () => {
    const src =
      `<div>\n` +
      `  {#if ok}<b>y</b>{/if}\n` +
      `  {#each items as i}<li>{i}</li>{/each}\n` +
      `</div>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "b")).toBe(`${FILE}:2:11-2:19`);
    expect(attrOf(out, "li")).toBe(`${FILE}:3:21-3:33`);
    expect(out).toContain("{#if ok}");
    expect(out).toContain("{#each items as i}");
  });

  it("skips custom component tags but still injects their slotted element children", () => {
    const src = `<MyButton><span>x</span></MyButton>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(out).not.toMatch(/<MyButton[^>]*data-src-loc/);
    expect(attrOf(out, "span")).toBe(`${FILE}:1:11-1:25`);
  });

  it("injects on a self-closing void element", () => {
    const src = `<img src="x.png" />\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "img")).toBe(`${FILE}:1:1-1:20`);
  });

  it("returns the source unchanged when there are no elements (script-only file, empty)", () => {
    const src = `<script>\n  let x = 1;\n</script>\n`;
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to a svelte file <<<>>>";
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("HTML-escapes special characters in the file path (hostile input)", () => {
    const src = `<div>hi</div>\n`;
    const hostileFile = `/tmp/x.svelte" data-evil="1"><img src=x onerror=alert(1)>`;
    const out = injectSourceLocations(src, hostileFile);
    expect(out).toContain(
      'data-src-loc="/tmp/x.svelte&quot; data-evil=&quot;1&quot;&gt;&lt;img src=x onerror=alert(1)&gt;:1:1-1:14"',
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-svelte.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugin/inject-src-loc-svelte'`

- [ ] **Step 5: Add the `svelte` dependency**

```bash
pnpm add svelte@^5.56.8
```

Verify `package.json`'s `dependencies` now includes `"svelte": "^5.56.8"` (alongside the existing `@vue/compiler-core`/`@vue/compiler-sfc`/`modern-screenshot` entries).

In `scripts/build-config.mjs`, add `"svelte"` to the `PLUGIN_BUNDLE_EXTERNAL` array:

```js
export const PLUGIN_BUNDLE_EXTERNAL = [
  "vite",
  "@vue/compiler-sfc",
  "@vue/compiler-core",
  "svelte",
];
```

- [ ] **Step 6: Implement `src/plugin/inject-src-loc-svelte.ts`**

```ts
import { parse } from "svelte/compiler";
import { escapeAttr } from "./escape-attr.js";

interface Insertion {
  offset: number;
  text: string;
}

interface SvelteNode {
  type: string;
  start: number;
  end: number;
  name?: string;
  fragment?: { nodes: SvelteNode[] };
  consequent?: { nodes: SvelteNode[] };
  alternate?: { nodes: SvelteNode[] } | null;
  body?: { nodes: SvelteNode[] };
  fallback?: { nodes: SvelteNode[] } | null;
  pending?: { nodes: SvelteNode[] } | null;
  then?: { nodes: SvelteNode[] } | null;
  catch?: { nodes: SvelteNode[] } | null;
}

function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function collectInsertions(
  nodes: SvelteNode[],
  source: string,
  file: string,
  out: Insertion[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "RegularElement": {
        const start = offsetToLineColumn(source, node.start);
        const end = offsetToLineColumn(source, node.end);
        const value = `${escapeAttr(file)}:${start.line}:${start.column}-${end.line}:${end.column}`;
        out.push({
          offset: node.start + 1 + (node.name?.length ?? 0),
          text: ` data-src-loc="${value}"`,
        });
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      }
      case "IfBlock":
        if (node.consequent)
          collectInsertions(node.consequent.nodes, source, file, out);
        if (node.alternate)
          collectInsertions(node.alternate.nodes, source, file, out);
        break;
      case "EachBlock":
        if (node.body) collectInsertions(node.body.nodes, source, file, out);
        if (node.fallback)
          collectInsertions(node.fallback.nodes, source, file, out);
        break;
      case "AwaitBlock":
        if (node.pending)
          collectInsertions(node.pending.nodes, source, file, out);
        if (node.then) collectInsertions(node.then.nodes, source, file, out);
        if (node.catch) collectInsertions(node.catch.nodes, source, file, out);
        break;
      case "KeyBlock":
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      case "SnippetBlock":
        if (node.body) collectInsertions(node.body.nodes, source, file, out);
        break;
      case "Component":
      case "SvelteComponent":
      case "SvelteSelf":
      case "SvelteElement":
      case "SlotElement":
      case "SvelteBoundary":
      case "SvelteWindow":
      case "SvelteBody":
      case "SvelteHead":
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      default:
        break;
    }
  }
}

export function injectSourceLocations(source: string, file: string): string {
  // Do not change, because a parse failure must silently return the source instead of crashing the dev server.
  let ast;
  try {
    ast = parse(source, { filename: file, modern: true }) as unknown as {
      fragment?: { nodes: SvelteNode[] };
    };
  } catch {
    return source;
  }
  if (!ast?.fragment?.nodes) return source;

  const insertions: Insertion[] = [];
  try {
    collectInsertions(ast.fragment.nodes, source, file, insertions);
  } catch {
    return source;
  }
  if (insertions.length === 0) return source;

  insertions.sort((a, b) => a.offset - b.offset);
  const parts: string[] = [];
  let cursor = 0;
  for (const ins of insertions) {
    parts.push(source.slice(cursor, ins.offset), ins.text);
    cursor = ins.offset;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
```

(`modern: true` is required — without it, `svelte/compiler`'s `parse()` returns the legacy Svelte-4-style `.html` AST shape instead of `.fragment.nodes`, confirmed during planning against the installed `svelte@5.56.8`.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-svelte.test.ts`
Expected: PASS, all 9 cases. Every expected `data-src-loc` value in the test file was computed by running this exact implementation against these exact fixtures during planning — if any assertion fails, the implementation deviated from the plan's code block, not the expected values.

- [ ] **Step 8: Type-check and commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors.

```bash
git add src/plugin/escape-attr.ts src/plugin/inject-src-loc-svelte.ts src/plugin/inject-src-loc.ts \
  tests/unit/inject-src-loc-svelte.test.ts package.json pnpm-lock.yaml scripts/build-config.mjs
git commit -m "feat(plugin): inject data-src-loc into Svelte templates"
```

---

### Task 2: Wire the Svelte transform into the plugin

**Files:**

- Modify: `src/plugin/index.ts`
- Modify: `tests/unit/plugin-transform.test.ts`

**Interfaces:**

- No new exports from `src/plugin/index.ts` — `transform()`'s dispatch gains one more `if` branch.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/plugin-transform.test.ts` (add the import near the other `injectSourceLocations` imports):

```ts
import { injectSourceLocations as injectSvelteSourceLocations } from "../../src/plugin/inject-src-loc-svelte";
```

New `describe` block:

```ts
describe("plugin transform dispatch — Svelte", () => {
  it("routes .svelte files through the Svelte source-location transform", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `<div>hi</div>\n`;
    const file = "/proj/src/Widget.svelte";
    const result = callTransform2(plugin, src, file);
    expect(result).toBe(injectSvelteSourceLocations(src, file));
    expect(result).toContain("data-src-loc=");
  });

  it("does not transform .svelte files during a production build", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "build");
    const result = callTransform2(
      plugin,
      `<div>hi</div>\n`,
      "/proj/src/Widget.svelte",
    );
    expect(result).toBeUndefined();
  });

  it("leaves .vue/.tsx routing untouched (regression)", () => {
    const plugin = thisone() as AnyPlugin;
    callConfig(plugin, "serve");
    const vueResult = callTransform2(
      plugin,
      `<template><div>x</div></template>\n`,
      "/proj/src/Widget.vue",
    );
    expect(vueResult).toContain("data-src-loc=");
    const untouched = callTransform2(
      plugin,
      "const x = 1;",
      "/proj/src/util.ts",
    );
    expect(untouched).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: FAIL — the two Svelte-specific cases fail (`transform()` doesn't recognize `.svelte` yet, so `callTransform2` returns `undefined` instead of transformed output). The regression case passes already (unrelated to this change).

- [ ] **Step 3: Wire the transform in `src/plugin/index.ts`**

Add the import (alongside the existing `injectVueSourceLocations`/`injectReactSourceLocations` imports):

```ts
import { injectSourceLocations as injectSvelteSourceLocations } from "./inject-src-loc-svelte.js";
```

Change the `transform()` hook from:

```ts
transform(code: string, id: string) {
  if (isBuild) return;
  if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    return injectReactSourceLocations(code, id);
  }
  return;
},
```

to:

```ts
transform(code: string, id: string) {
  if (isBuild) return;
  if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
  if (id.endsWith(".svelte")) return injectSvelteSourceLocations(code, id);
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    return injectReactSourceLocations(code, id);
  }
  return;
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS, all cases — pre-existing Vue/React/Preact-detection cases plus the 3 new Svelte-dispatch cases.

- [ ] **Step 5: Type-check, build, full unit suite, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm build
pnpm exec vitest run
```

Expected: no type errors; build succeeds; full unit suite green (confirms Task 1's `escapeAttr` extraction didn't regress `inject-src-loc.test.ts`).

```bash
git add src/plugin/index.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): route .svelte files through the Svelte source-location transform"
```

---

### Task 3: Svelte component resolution (`__svelte_meta` walk)

**Files:**

- Create: `src/client/resolve-component-svelte.ts`
- Test: `tests/unit/resolve-component-svelte.test.ts`

**Interfaces:**

- Consumes: `baseName` from `./base-name`; `type ChainEntry`, `type ComponentDescriptor` from `./resolve-component` (type-only import).
- Produces: `export function resolveSvelteComponent(el: Element | null): ComponentDescriptor | null`. Task 4 imports this into the dispatcher in `resolve-component.ts`.
- Declares a global `Element.__svelte_meta?: SvelteMeta` augmentation — this is the only file that should declare it (avoid duplicate `declare global` blocks for the same property elsewhere).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/resolve-component-svelte.test.ts`:

```ts
// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
// @vitest-environment happy-dom
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/resolve-component-svelte.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/resolve-component-svelte'`

- [ ] **Step 3: Implement `src/client/resolve-component-svelte.ts`**

```ts
// Resolve the Svelte component behind a picked DOM element. Svelte's compiler,
// in dev mode, already attaches everything needed directly to the DOM node
// itself (assign_location in svelte/internal/client/dev/elements.js,
// dev_stack/add_svelte_meta in svelte/internal/client/context.js) — the same
// mechanism the official Svelte Inspector reads. Unlike Preact, no runtime
// hook or WeakMap is needed here.
import { baseName } from "./base-name";
import type { ChainEntry, ComponentDescriptor } from "./resolve-component";

interface SvelteDevStackEntry {
  type: string;
  file: string;
  componentTag?: string;
  parent: SvelteDevStackEntry | null;
}

interface SvelteMeta {
  loc: { file: string; line: number; column: number };
  parent: SvelteDevStackEntry | null;
}

declare global {
  interface Element {
    __svelte_meta?: SvelteMeta;
  }
}

export function resolveSvelteComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const meta = el.__svelte_meta;
  if (!meta) return null;

  const chain: ChainEntry[] = [];
  let childFile = meta.loc.file;

  let cur = meta.parent;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.type === "component") {
      const name = cur.componentTag ?? baseName(childFile);
      chain.push({ name, file: childFile });
      childFile = cur.file;
    }
    cur = cur.parent;
  }
  chain.push({ name: baseName(childFile), file: childFile });

  return { name: chain[0].name, file: chain[0].file, chain };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component-svelte.test.ts`
Expected: PASS, all 7 cases. The 3-level `component -> if -> component -> component(root)` chain shape in the "skips non-'component' dev-stack frames" test mirrors exactly what was observed against a real browser during planning (`App.svelte` → `{#if}` → `Panel.svelte` → `Counter.svelte`).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors. `ChainEntry`/`ComponentDescriptor` are already exported from `resolve-component.ts` in its current (pre-Task-4) state, so this type import resolves immediately — no ordering dependency on Task 4.

```bash
git add src/client/resolve-component-svelte.ts tests/unit/resolve-component-svelte.test.ts
git commit -m "feat(client): resolve Svelte components via the __svelte_meta dev-stack chain"
```

---

### Task 4: `resolveComponent` dispatcher gains the Svelte branch

**Files:**

- Modify: `src/client/resolve-component.ts`
- Modify: `tests/unit/resolve-component.test.ts`

**Interfaces:**

- `resolveComponent(el: Element | null): ResolvedComponent | null` keeps its exact existing signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/resolve-component.test.ts` a new `describe` block:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: the 4 dispatch-to-Svelte cases FAIL — `resolveComponent` doesn't check `__svelte_meta` yet, so it falls through to `null` in every case; the "still returns null" case passes vacuously already.

- [ ] **Step 3: Extend the dispatcher**

In `src/client/resolve-component.ts`:

1. Add the import: `import { resolveSvelteComponent } from "./resolve-component-svelte";`
2. Change the dispatcher body from:

```ts
export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  const react = resolveReactComponent(el);
  if (react) return react;
  return resolvePreactComponent(el);
}
```

to:

```ts
export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  const react = resolveReactComponent(el);
  if (react) return react;
  const preact = resolvePreactComponent(el);
  if (preact) return preact;
  return resolveSvelteComponent(el);
}
```

`resolvePreactComponent` already returns `null` (not throwing) when `window.__THISONE_PREACT_MAP__` is absent or has no entry for the element, so this ordering costs nothing extra for Vue/React/Preact projects — the Svelte branch is only ever reached when all three prior checks miss, and `resolveSvelteComponent` itself short-circuits to `null` in a single `el.__svelte_meta` check when the element was never compiled by Svelte (non-Svelte projects).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: PASS, all cases — every pre-existing Vue/React/Preact test plus the 5 new Svelte-dispatch tests.

- [ ] **Step 5: Full check, type-check, build, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
```

Expected: no type errors; full unit suite green; build succeeds.

```bash
git add src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(client): dispatch resolveComponent to the Svelte resolver"
```

---

### Task 5: Svelte example app (`examples/demo-app-svelte`)

**Files:**

- Create: `examples/demo-app-svelte/package.json`
- Create: `examples/demo-app-svelte/vite.config.ts`
- Create: `examples/demo-app-svelte/index.html`
- Create: `examples/demo-app-svelte/src/main.ts`
- Create: `examples/demo-app-svelte/src/app.css`
- Create: `examples/demo-app-svelte/src/App.svelte`
- Create: `examples/demo-app-svelte/src/Panel.svelte`
- Create: `examples/demo-app-svelte/src/Counter.svelte`
- Create: `examples/demo-app-svelte/src/DemoHeader.svelte`
- Modify: `examples/demo-app-react/src/DemoHeader.tsx` (add the Svelte nav link)
- Modify: `examples/demo-app-react/src/DemoHeader.test.tsx`
- Modify: `examples/demo-app-preact/src/DemoHeader.tsx` (add the Svelte nav link)
- Modify: `examples/demo-app/src/components/DemoHeader.vue` (add the Svelte nav link)

**Interfaces:**

- Consumes: the root package via `"vite-plugin-thisone": "link:../.."` (real symlink — `file:` goes stale after a root `pnpm build`, see `tests/e2e/README.md`).
- Produces: a running app whose DOM structure Task 6/7 drive directly — line numbers referenced by future e2e assertions are load-bearing; do not reformat these files afterward without checking Task 7's assertions.
- Deliberately nests `App.svelte` → `{#if}` → `Panel.svelte` → `Counter.svelte` (3 component levels with an `{#if}` frame in between) to exercise the exact if-skip + multi-level chain behavior validated during planning.

- [ ] **Step 1: Create the example app files**

```json
// examples/demo-app-svelte/package.json
{
  "name": "thisone-demo-app-svelte",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "svelte": "5.56.8"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "7.2.0",
    "vite": "8.2.1",
    "vite-plugin-thisone": "link:../.."
  }
}
```

```ts
// examples/demo-app-svelte/vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_SVELTE_PORT ?? 5188);
const proxiedByDevDemoOnPort = process.env.THISONE_DEMO_PORT
  ? Number(process.env.THISONE_DEMO_PORT)
  : undefined;

export default defineConfig({
  plugins: [svelte(), thisone()],
  base: proxiedByDevDemoOnPort ? "/svelte-demo/" : "/",
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: proxiedByDevDemoOnPort
      ? { clientPort: proxiedByDevDemoOnPort, path: "svelte-demo-hmr" }
      : undefined,
  },
});
```

```html
<!-- examples/demo-app-svelte/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>thisone svelte demo</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```ts
// examples/demo-app-svelte/src/main.ts
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
```

```css
/* examples/demo-app-svelte/src/app.css */
:root {
  color-scheme: light;
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    "Segoe UI",
    Roboto,
    sans-serif;
}

body {
  margin: 0;
  background: #f5f6f8;
  color: #16181d;
}

main {
  min-height: 100vh;
  padding-top: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.demo-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 12px;
  background: #fff;
  border-bottom: 1px solid #e2e4e9;
}

.demo-header nav {
  display: flex;
  gap: 8px;
}

.demo-header a {
  padding: 6px 14px;
  border-radius: 6px;
  color: #4b5165;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.demo-header a.active {
  background: #16181d;
  color: #fff;
}
```

```svelte
<!-- examples/demo-app-svelte/src/App.svelte -->
<script lang="ts">
  import DemoHeader from "./DemoHeader.svelte";
  import Panel from "./Panel.svelte";
  import "./app.css";

  let showPanel = true;
</script>

<DemoHeader active="svelte" />
<main>
  <h1>thisone svelte demo</h1>
  {#if showPanel}
    <Panel />
  {/if}
</main>
```

```svelte
<!-- examples/demo-app-svelte/src/Panel.svelte -->
<script lang="ts">
  import Counter from "./Counter.svelte";
</script>

<section>
  <Counter />
</section>
```

```svelte
<!-- examples/demo-app-svelte/src/Counter.svelte -->
<script lang="ts">
  let count = $state(0);
</script>

<button id="counter-btn" onclick={() => (count += 1)}>count is {count}</button>
```

```svelte
<!-- examples/demo-app-svelte/src/DemoHeader.svelte -->
<script lang="ts">
  let { active }: { active: "vue" | "react" | "preact" | "svelte" } = $props();
</script>

<header class="demo-header">
  <nav>
    <a href="/" class={active === "vue" ? "active" : undefined}>Vue</a>
    <a href="/react-demo/" class={active === "react" ? "active" : undefined}>
      React
    </a>
    <a href="/preact-demo/" class={active === "preact" ? "active" : undefined}>
      Preact
    </a>
    <a href="/svelte-demo/" class={active === "svelte" ? "active" : undefined}>
      Svelte
    </a>
  </nav>
</header>
```

- [ ] **Step 2: Update the Vue, React, and Preact demo headers with the Svelte link**

`examples/demo-app-react/src/DemoHeader.tsx` — widen the prop type and add the fourth link:

```tsx
export default function DemoHeader({
  active,
}: {
  active: "vue" | "react" | "preact" | "svelte";
}) {
  return (
    <header className="demo-header">
      <nav>
        <a href="/" className={active === "vue" ? "active" : undefined}>
          Vue
        </a>
        <a
          href="/react-demo/"
          className={active === "react" ? "active" : undefined}
        >
          React
        </a>
        <a
          href="/preact-demo/"
          className={active === "preact" ? "active" : undefined}
        >
          Preact
        </a>
        <a
          href="/svelte-demo/"
          className={active === "svelte" ? "active" : undefined}
        >
          Svelte
        </a>
      </nav>
    </header>
  );
}
```

`examples/demo-app-react/src/DemoHeader.test.tsx` — add a fourth case and widen the existing regexes to tolerate the new link:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DemoHeader from "./DemoHeader";

describe("DemoHeader", () => {
  it('marks the "React" link active when active="react"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="react" />);
    expect(html).toMatch(/<a href="\/react-demo\/" class="active">React<\/a>/);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
    expect(html).toMatch(/<a href="\/svelte-demo\/">Svelte<\/a>/);
  });

  it('marks the "Vue" link active when active="vue"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="vue" />);
    expect(html).toMatch(/<a href="\/" class="active">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
    expect(html).toMatch(/<a href="\/svelte-demo\/">Svelte<\/a>/);
  });

  it('marks the "Preact" link active when active="preact"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="preact" />);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(
      /<a href="\/preact-demo\/" class="active">Preact<\/a>/,
    );
    expect(html).toMatch(/<a href="\/svelte-demo\/">Svelte<\/a>/);
  });

  it('marks the "Svelte" link active when active="svelte"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="svelte" />);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
    expect(html).toMatch(
      /<a href="\/svelte-demo\/" class="active">Svelte<\/a>/,
    );
  });
});
```

`examples/demo-app-preact/src/DemoHeader.tsx` — same widened prop type and fourth link (identical shape to the React one above, `className` stays `className` since this file is still JSX compiled through Preact, not a copy-paste of the React file's import):

```tsx
export default function DemoHeader({
  active,
}: {
  active: "vue" | "react" | "preact" | "svelte";
}) {
  return (
    <header className="demo-header">
      <nav>
        <a href="/" className={active === "vue" ? "active" : undefined}>
          Vue
        </a>
        <a
          href="/react-demo/"
          className={active === "react" ? "active" : undefined}
        >
          React
        </a>
        <a
          href="/preact-demo/"
          className={active === "preact" ? "active" : undefined}
        >
          Preact
        </a>
        <a
          href="/svelte-demo/"
          className={active === "svelte" ? "active" : undefined}
        >
          Svelte
        </a>
      </nav>
    </header>
  );
}
```

`examples/demo-app/src/components/DemoHeader.vue` — widen the prop type and add the fourth link:

```vue
<script setup lang="ts">
defineProps<{ active: "vue" | "react" | "preact" | "svelte" }>();
</script>

<template>
  <header class="demo-header">
    <nav>
      <a href="/" :class="{ active: active === 'vue' }">Vue</a>
      <a href="/react-demo/" :class="{ active: active === 'react' }">React</a>
      <a href="/preact-demo/" :class="{ active: active === 'preact' }"
        >Preact</a
      >
      <a href="/svelte-demo/" :class="{ active: active === 'svelte' }"
        >Svelte</a
      >
    </nav>
  </header>
</template>

<style>
.demo-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 12px;
  background: #fff;
  border-bottom: 1px solid #e2e4e9;
}

.demo-header nav {
  display: flex;
  gap: 8px;
}

.demo-header a {
  padding: 6px 14px;
  border-radius: 6px;
  color: #4b5165;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.demo-header a.active {
  background: #16181d;
  color: #fff;
}
</style>
```

(The Vue `App.vue` passes `active="vue"` already — no change needed there, `active` stays a valid literal under the widened type.)

- [ ] **Step 3: Install and build-sanity-check**

```bash
pnpm build
cd examples/demo-app-svelte
pnpm install
```

Verify `node_modules/vite-plugin-thisone` is a symlink (`ls -la node_modules/vite-plugin-thisone` shows `->`).

```bash
pnpm build
```

Expected: succeeds, produces `dist/index.html` + `dist/assets/*.js`.

```bash
grep -rl "__thisone\|data-src-loc" dist || echo "clean (expected)"
```

Expected: `clean (expected)`.

```bash
rm -rf dist
cd ../..
```

- [ ] **Step 4: Regression-check the Vue, React, and Preact demo apps still build/test clean**

```bash
cd examples/demo-app-react && pnpm exec vitest run && cd ../..
```

Expected: `DemoHeader.test.tsx`'s widened assertions (including the new Svelte case) pass.

```bash
pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: no errors — confirms the widened `active` prop type on the Preact/Vue headers still type-checks against their own `App.tsx`/`App.vue` call sites (each still passes a valid literal from the union).

- [ ] **Step 5: Commit**

```bash
git add examples/demo-app-svelte examples/demo-app-react/src/DemoHeader.tsx \
  examples/demo-app-react/src/DemoHeader.test.tsx examples/demo-app-preact/src/DemoHeader.tsx \
  examples/demo-app/src/components/DemoHeader.vue
git commit -m "test(examples): add a Vite+Svelte demo app for the picker"
```

(`examples/demo-app-svelte/node_modules/` is covered by the repo-root `.gitignore`'s unanchored `node_modules/` pattern.)

---

### Task 6: Wire the Svelte demo into `dev-demo.sh` and the Vue demo's proxy

**Files:**

- Modify: `examples/demo-app/vite.config.ts`
- Modify: `scripts/dev-demo.sh`

**Interfaces:**

- Consumes: `examples/demo-app-svelte` (Task 5).
- Produces: `bash scripts/dev-demo.sh` now fronts four apps (Vue on the main port, React/Preact/Svelte each on their own loopback port, proxied under `/react-demo/`, `/preact-demo/`, `/svelte-demo/`).

- [ ] **Step 1: Extend `examples/demo-app/vite.config.ts`'s proxy**

```ts
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_PORT ?? 3000);
const reactPort = Number(process.env.THISONE_DEMO_REACT_PORT ?? 5185);
const reactTarget = `http://127.0.0.1:${reactPort}`;
const preactPort = Number(process.env.THISONE_DEMO_PREACT_PORT ?? 5186);
const preactTarget = `http://127.0.0.1:${preactPort}`;
const sveltePort = Number(process.env.THISONE_DEMO_SVELTE_PORT ?? 5188);
const svelteTarget = `http://127.0.0.1:${sveltePort}`;

export default defineConfig({
  plugins: [vue(), thisone()],
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: ["vue-pick-problem-skill.e.conveyor.echelon.business"],
    proxy: {
      "/react-demo": {
        target: reactTarget,
        changeOrigin: true,
        ws: true,
      },
      "/preact-demo": {
        target: preactTarget,
        changeOrigin: true,
        ws: true,
      },
      "/svelte-demo": {
        target: svelteTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 2: Extend `scripts/dev-demo.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
react_port="${THISONE_DEMO_REACT_PORT:-5185}"
preact_port="${THISONE_DEMO_PREACT_PORT:-5186}"
svelte_port="${THISONE_DEMO_SVELTE_PORT:-5188}"
vue_port="${THISONE_DEMO_PORT:-3000}"

fuser -k -TERM "${react_port}/tcp" "${preact_port}/tcp" "${svelte_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true
sleep 1
fuser -k -KILL "${react_port}/tcp" "${preact_port}/tcp" "${svelte_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true

react_pid=""
preact_pid=""
svelte_pid=""
vue_pid=""
cleanup() {
  [ -n "$react_pid" ] && kill "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && kill "$preact_pid" 2>/dev/null || true
  [ -n "$svelte_pid" ] && kill "$svelte_pid" 2>/dev/null || true
  [ -n "$vue_pid" ] && kill "$vue_pid" 2>/dev/null || true
  [ -n "$react_pid" ] && wait "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && wait "$preact_pid" 2>/dev/null || true
  [ -n "$svelte_pid" ] && wait "$svelte_pid" 2>/dev/null || true
  [ -n "$vue_pid" ] && wait "$vue_pid" 2>/dev/null || true
}
trap cleanup EXIT

cd "$root"
pnpm build

cd "$root/examples/demo-app-react"
THISONE_DEMO_REACT_PORT="$react_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$react_port" --strictPort --host 127.0.0.1 \
  >/tmp/thisone-demo-react-dev.log 2>&1 &
react_pid=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$react_port/react-demo/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "react demo dev server did not become ready on port $react_port" >&2
  cat /tmp/thisone-demo-react-dev.log >&2
  exit 1
fi

cd "$root/examples/demo-app-preact"
THISONE_DEMO_PREACT_PORT="$preact_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$preact_port" --strictPort --host 127.0.0.1 \
  >/tmp/thisone-demo-preact-dev.log 2>&1 &
preact_pid=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$preact_port/preact-demo/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "preact demo dev server did not become ready on port $preact_port" >&2
  cat /tmp/thisone-demo-preact-dev.log >&2
  exit 1
fi

cd "$root/examples/demo-app-svelte"
THISONE_DEMO_SVELTE_PORT="$svelte_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$svelte_port" --strictPort --host 127.0.0.1 \
  >/tmp/thisone-demo-svelte-dev.log 2>&1 &
svelte_pid=$!

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$svelte_port/svelte-demo/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "svelte demo dev server did not become ready on port $svelte_port" >&2
  cat /tmp/thisone-demo-svelte-dev.log >&2
  exit 1
fi

cd "$root/examples/demo-app"
THISONE_DEMO_REACT_PORT="$react_port" THISONE_DEMO_PREACT_PORT="$preact_port" \
  THISONE_DEMO_SVELTE_PORT="$svelte_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$vue_port" --strictPort --host 0.0.0.0 \
  >/tmp/thisone-demo-vue-dev.log 2>&1 &
vue_pid=$!

wait "$vue_pid"
```

- [ ] **Step 3: Manually verify (dev-only script, no automated test covers it)**

```bash
bash scripts/dev-demo.sh &
sleep 3
curl -sf http://127.0.0.1:3000/ | grep -q "Svelte" && echo "nav link present"
curl -sf http://127.0.0.1:3000/svelte-demo/ | grep -q "thisone svelte demo" || echo "PROXY BROKEN"
kill %1 2>/dev/null || true
```

Expected: `nav link present`, no `PROXY BROKEN` line. Confirm `scripts/dev-demo.test.sh` (existing, bash-syntax-only) still passes: `bash scripts/dev-demo.test.sh`.

- [ ] **Step 4: Commit**

```bash
git add examples/demo-app/vite.config.ts scripts/dev-demo.sh
git commit -m "feat(examples): front the Svelte demo through dev-demo.sh's proxy"
```

---

### Task 7: Svelte e2e (Playwright) + harness script

**Files:**

- Create: `tests/e2e/thisone-svelte.e2e.mjs`
- Create: `scripts/e2e-svelte.sh`
- Create: `scripts/e2e-svelte.test.sh`
- Modify: `tests/e2e/README.md`

**Interfaces:**

- Consumes: `examples/demo-app-svelte` (Task 5), the built `dist/` (Task 2's `pnpm build` output).
- This is the plan's **reproduce-before-done** proof — the only step that exercises the real browser + real Svelte 5 runtime + the actual `__svelte_meta`/`dev_stack` mechanism end-to-end, which the unit tests (mocked meta objects, string-transform output) cannot cover.

- [ ] **Step 1: Write `tests/e2e/thisone-svelte.e2e.mjs`**

```js
#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app-svelte");

const port = Number(process.argv[2]);
assert.ok(
  Number.isInteger(port) && port > 0,
  "usage: thisone-svelte.e2e.mjs <port>",
);
const base = `http://localhost:${port}`;

const errors = [];
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${label}`))
    .catch((err) => {
      errors.push(`${label}: ${err.message}`);
      console.error(`not ok - ${label}: ${err.message}`);
    });
}

function grepMatches(pattern, dir) {
  try {
    return execFileSync("grep", ["-rl", pattern, dir], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const response = await page.goto(base, { waitUntil: "networkidle" });
  await check("demo responds 200", async () => {
    assert.equal(response.status(), 200);
  });
  await check("no console/page errors on load", async () => {
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
  });

  const panel = page.locator("#__thisone_root >> css=.panel");
  const pathEl = page.locator("#__thisone_root >> css=.path");
  const pathModeToggle = page.locator(
    "#__thisone_root >> css=.path-mode-toggle",
  );

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  await check("panel opens on Alt+C", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator("#counter-btn").click();
  await check(
    "picking a host element nested 3 components deep (App -> {#if} -> Panel -> Counter) resolves Counter + file:line via __svelte_meta, no Vue/React/Preact internals present",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<button>/);
      assert.match(text ?? "", /Counter/);
      assert.match(text ?? "", /Counter\.svelte:\d+:\d+-\d+:\d+/);
    },
  );

  await check(
    "root-mount path mode shows the full breadcrumb, skipping the {#if} frame between App and Panel",
    async () => {
      await pathModeToggle.click();
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(
        text ?? "",
        /^App \(.*App\.svelte\) › Panel \(.*Panel\.svelte\) › Counter \(.*Counter\.svelte\) › <button>/,
      );
      await pathModeToggle.click();
    },
  );

  const headingBox = await page.locator("h1").boundingBox();
  assert.ok(headingBox, "h1 should have a bounding box");
  await page.mouse.click(
    headingBox.x + 10,
    headingBox.y + headingBox.height / 2,
  );
  await check(
    "picking a host element inside the root-mounted component resolves App + file:line (no componentTag available for the root)",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<h1>/);
      assert.match(text ?? "", /App/);
      assert.match(text ?? "", /App\.svelte:\d+:\d+-\d+:\d+/);
    },
  );

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 2000 });
} finally {
  await browser.close();
}

await check(
  "prod build does not inject the overlay or any data-src-loc",
  async () => {
    execFileSync(
      "node",
      [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
      { cwd: demoDir, stdio: "pipe" },
    );
    const found = grepMatches(
      "__thisone\\|data-src-loc",
      resolve(demoDir, "dist"),
    );
    assert.equal(found, "");
    rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
  },
);

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
```

- [ ] **Step 2: Write `scripts/e2e-svelte.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app-svelte"
port="${THISONE_E2E_SVELTE_PORT:-5189}"

cd "$root"
pnpm build

cd "$demo"
node_modules/.bin/vite --port "$port" --strictPort >/tmp/thisone-e2e-svelte-dev.log 2>&1 &
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
  echo "demo dev server did not become ready on port $port" >&2
  cat /tmp/thisone-e2e-svelte-dev.log >&2
  exit 1
fi

cd "$root"
node tests/e2e/thisone-svelte.e2e.mjs "$port"
```

```bash
chmod +x scripts/e2e-svelte.sh
```

- [ ] **Step 3: Write `scripts/e2e-svelte.test.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/e2e-svelte.sh"

if bash -n "$script"; then
  echo "ok - scripts/e2e-svelte.sh is syntactically valid bash"
else
  echo "not ok - scripts/e2e-svelte.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/e2e-svelte.sh is executable"
else
  echo "not ok - scripts/e2e-svelte.sh is not executable"
  exit 1
fi

if grep -q 'thisone-svelte.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-svelte.sh delegates to tests/e2e/thisone-svelte.e2e.mjs"
else
  echo "not ok - scripts/e2e-svelte.sh does not delegate to the svelte e2e test"
  exit 1
fi
```

```bash
chmod +x scripts/e2e-svelte.test.sh
```

- [ ] **Step 4: Update `tests/e2e/README.md`**

Add a new section after the existing "Preact harness" section:

````markdown
## Svelte harness

`thisone-svelte.e2e.mjs` covers what's specific to the Svelte path against `examples/demo-app-svelte/`
(a real `@sveltejs/vite-plugin-svelte` app — Svelte has no "bare, no official plugin" mode the way
React/Preact do, since `.svelte` files require the official compiler plugin to build at all):
source-location + component-name resolution 3 components deep (`App` → `{#if}` → `Panel` →
`Counter`, exercising the if-frame-skip in the `__svelte_meta.parent` walk) and the root-mounted
component, each resolved directly from `el.__svelte_meta` — a mechanism Svelte's own compiler
attaches in dev mode, not any thisone-installed hook — plus the same prod-build exclusion check as
the other harnesses. Panel mechanics (drag, clipboard, screenshot, hotkey) are framework-agnostic
and already fully covered by `thisone.e2e.mjs` against the Vue demo app — this script doesn't
repeat them.

Run:

```
bash scripts/e2e-svelte.sh
```

Same `link:../..` wiring note as the other demo apps applies to `examples/demo-app-svelte`.
````

Also extend the "Browsing both demos live" section's final paragraph to mention the fourth app:

```markdown
`scripts/dev-demo.sh` fronts `examples/demo-app` (Vue), `examples/demo-app-react` (React),
`examples/demo-app-preact` (Preact), and `examples/demo-app-svelte` (Svelte) with a single dev
server on port 3000: the Vue app proxies `/react-demo/**`, `/preact-demo/**`, and
`/svelte-demo/**` (including each app's HMR websocket) to three second, loopback-only Vite
instances. Each app's header has a Vue/React/Preact/Svelte nav link to switch between them
without touching the URL bar's port. Only used for manually poking at the picker in a browser —
not part of any e2e/unit suite.
```

- [ ] **Step 5: Run the e2e suite**

```bash
npx playwright install chromium
```

(first time only, if not already installed — skip if `tests/e2e/thisone.e2e.mjs` already runs successfully in this environment)

```bash
bash scripts/e2e-svelte.sh
```

Expected: every `ok - ...` line prints, final line `e2e ok`, exit code 0.

- [ ] **Step 6: Regression-check the existing Vue/React/Preact e2e suites still pass**

```bash
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react-plugin.sh
bash scripts/e2e-preact.sh
```

Expected: `e2e ok` from each — confirms Task 4's dispatcher change and Task 1/2's new plugin transform didn't regress the Vue/React/Preact paths.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/thisone-svelte.e2e.mjs scripts/e2e-svelte.sh scripts/e2e-svelte.test.sh tests/e2e/README.md
git commit -m "test(e2e): add Svelte picker flow against a Vite+Svelte app"
```

---

## Final verification (after Task 7)

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react-plugin.sh
bash scripts/e2e-preact.sh
bash scripts/e2e-svelte.sh
```

Expected: all eight commands succeed. This is the full gate — type-check, unit suite (Vue + React + Preact + Svelte + dispatcher + build-externals), build, and all five e2e harnesses green.
