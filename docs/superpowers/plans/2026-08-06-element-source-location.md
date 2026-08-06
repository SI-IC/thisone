# Element Source Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the picked DOM element's `ElementDescriptor` a `sourceLoc` field with the start/end line+column of that element's tag in its `.vue` source file, and surface it through the MCP `get_feedback` tool.

**Architecture:** A new pre-transform (`src/plugin/inject-src-loc.ts`) parses each `.vue` file's SFC descriptor with `@vue/compiler-sfc`'s `parse()`, walks the already-computed template AST (`descriptor.template.ast`, whose node `loc.offset` values are absolute offsets into the *original* file — no manual line/column math needed), and splices a `data-src-loc="file:startLine:startCol-endLine:endCol"` attribute into the raw source text of every element's opening tag. This is wired into the existing Vite plugin as an `enforce: 'pre'` `transform` hook, so it runs before `@vitejs/plugin-vue`'s own `.vue` → JS compilation and the attribute ends up as a real DOM attribute. The client's `describeElement()` reads that attribute back off the picked element and parses it into `ElementDescriptor.sourceLoc`.

**Tech Stack:** TypeScript, Vite plugin API, `@vue/compiler-sfc` / `@vue/compiler-core` (new direct dependencies), Vitest (`happy-dom` for DOM tests).

## Global Constraints

- Package manager: `pnpm` (per repo `packageManager` field). Use `pnpm add <pkg>@<version>`, never bare `npm install`.
- New dependency versions: `@vue/compiler-sfc@^3.5.41` and `@vue/compiler-core@^3.5.41` (latest on npm as of this plan; both added to `dependencies`, not `devDependencies` — the transform runs inside the published plugin, in the consuming project's dev server).
- The plugin is already `apply: 'serve'` (dev-only) — the new transform must never run in a production build. `isBuild` is already tracked via the existing `config()` hook; reuse it, don't add a second flag.
- Never let the transform hook throw and crash the consumer's dev server — any parse failure must fall back to returning the original source unchanged.
- Test runner: `vitest` with `--max-workers=2` is not a vitest flag; this repo's `test:run` script (`vitest run --passWithNoTests`) already caps concurrency via `vitest.config` if present — just run `pnpm test:run` for the full suite, it finishes in well under 2 minutes (existing suite is ~10 files), no need to ask before running it.
- `pnpm build` must succeed before running `tests/unit/plugin-transform.test.ts` (it asserts against the real `dist/client.js`) — this is a pre-existing repo requirement, not new.

---

### Task 1: `injectSourceLocations` pre-transform

**Files:**
- Create: `src/plugin/inject-src-loc.ts`
- Test: `tests/unit/inject-src-loc.test.ts`
- Modify: `package.json` (add `@vue/compiler-sfc` and `@vue/compiler-core` to `dependencies`)

**Interfaces:**
- Produces: `injectSourceLocations(source: string, file: string): string` — exported from `src/plugin/inject-src-loc.ts`. Given a full `.vue` file's raw text and the value to embed as the `file` segment (the plugin will pass Vite's module `id`), returns the same text with a `data-src-loc="<file>:<startLine>:<startCol>-<endLine>:<endCol>"` attribute spliced into every rendering element's opening tag inside `<template>`. Returns `source` unchanged when there is no template block, or on any parse failure.

- [ ] **Step 1: Add the compiler dependencies**

```bash
pnpm add @vue/compiler-sfc@^3.5.41 @vue/compiler-core@^3.5.41
```

Verify: `grep '"@vue/compiler-sfc"' package.json` shows it under `dependencies` (not `devDependencies`).

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/inject-src-loc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc";

const FILE = "/proj/src/components/Counter.vue";

function attrOf(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc="([^"]+)"`);
  const m = re.exec(html);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${html}`);
  return m[1];
}

describe("injectSourceLocations", () => {
  it("injects file:startLine:startCol-endLine:endCol on a single element", () => {
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:16`);
  });

  it("injects distinct locations on nested elements", () => {
    const src =
      `<template>\n` +
      `  <section>\n` +
      `    <p>x</p>\n` +
      `  </section>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "section")).toBe(`${FILE}:2:3-4:13`);
    expect(attrOf(out, "p")).toBe(`${FILE}:3:5-3:13`);
  });

  it("injects on both roots of a multi-root (fragment) template", () => {
    const src = `<template>\n  <div>a</div>\n  <span>b</span>\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:16`);
    expect(attrOf(out, "span")).toBe(`${FILE}:3:3-3:17`);
  });

  it("injects on elements inside v-if / v-for without touching the directive", () => {
    const src =
      `<template>\n` +
      `  <div v-if="ok"><b>y</b></div>\n` +
      `  <li v-for="i in items">{{ i }}</li>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:32`);
    expect(attrOf(out, "b")).toBe(`${FILE}:2:18-2:26`);
    expect(attrOf(out, "li")).toBe(`${FILE}:3:3-3:38`);
    expect(out).toContain('v-if="ok"');
    expect(out).toContain('v-for="i in items"');
  });

  it("skips the wrapper <template v-if> tag but injects its child element", () => {
    const src =
      `<template>\n` +
      `  <template v-if="ok">\n` +
      `    <p>z</p>\n` +
      `  </template>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "p")).toBe(`${FILE}:3:5-3:13`);
    // the grouping <template> itself never renders a DOM node — no attribute on it
    expect(out).not.toMatch(/<template v-if="ok" data-src-loc/);
  });

  it("injects on a self-closing void element", () => {
    const src = `<template>\n  <img src="x.png" />\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "img")).toBe(`${FILE}:2:3-2:22`);
  });

  it("returns the source unchanged when there is no <template> block (empty)", () => {
    const src = `<script setup>\nconst x = 1;\n</script>\n`;
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to a vue file <<<>>>";
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/inject-src-loc.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugin/inject-src-loc'`.

- [ ] **Step 4: Implement `injectSourceLocations`**

Create `src/plugin/inject-src-loc.ts`:

```ts
// Pre-transform: stamps every rendering element in a .vue file's <template>
// with `data-src-loc="file:startLine:startCol-endLine:endCol"`, computed from
// the SFC compiler's own template AST (offsets are already absolute into the
// original file — no manual line/column bookkeeping needed). Wired in as an
// enforce:'pre' Vite transform hook (see src/plugin/index.ts) so the attribute
// survives into @vitejs/plugin-vue's compile and lands in the real DOM.

import { parse } from "@vue/compiler-sfc";
import {
  NodeTypes,
  ElementTypes,
  type TemplateChildNode,
} from "@vue/compiler-core";

interface Insertion {
  offset: number;
  text: string;
}

function collectInsertions(
  nodes: TemplateChildNode[],
  file: string,
  out: Insertion[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case NodeTypes.ELEMENT: {
        if (node.tagType !== ElementTypes.TEMPLATE) {
          const { start, end } = node.loc;
          const value = `${file}:${start.line}:${start.column}-${end.line}:${end.column}`;
          out.push({
            offset: start.offset + 1 + node.tag.length,
            text: ` data-src-loc="${value}"`,
          });
        }
        collectInsertions(node.children, file, out);
        break;
      }
      case NodeTypes.IF:
        for (const branch of node.branches) {
          collectInsertions(branch.children, file, out);
        }
        break;
      case NodeTypes.FOR:
        collectInsertions(node.children, file, out);
        break;
      default:
        break;
    }
  }
}

export function injectSourceLocations(source: string, file: string): string {
  let ast;
  try {
    ast = parse(source, { filename: file }).descriptor.template?.ast;
  } catch {
    return source;
  }
  if (!ast) return source;

  const insertions: Insertion[] = [];
  try {
    collectInsertions(ast.children, file, insertions);
  } catch {
    return source;
  }
  if (insertions.length === 0) return source;

  insertions.sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const ins of insertions) {
    result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
  }
  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/inject-src-loc.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/plugin/inject-src-loc.ts tests/unit/inject-src-loc.test.ts
git commit -m "feat(plugin): add injectSourceLocations pre-transform"
```

---

### Task 2: Wire the transform into the Vite plugin

**Files:**
- Modify: `src/plugin/index.ts`
- Modify: `tests/unit/plugin-transform.test.ts`

**Interfaces:**
- Consumes: `injectSourceLocations(source: string, file: string): string` from Task 1.
- Produces: the `claudeFeedback()` plugin object gains `enforce: "pre"` and a `transform(code, id)` hook. No new exports.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/plugin-transform.test.ts` (new `describe` block; keep existing ones untouched):

```ts
import { injectSourceLocations } from "../../src/plugin/inject-src-loc";

function callTransform2(plugin: AnyPlugin, code: string, id: string) {
  const t = plugin.transform as any;
  const handler = typeof t === "function" ? t : t.handler;
  return handler.call(plugin, code, id);
}

describe("plugin transform (.vue source location)", () => {
  it("declares enforce:'pre' so it runs before @vitejs/plugin-vue", () => {
    expect((claudeFeedback() as AnyPlugin).enforce).toBe("pre");
  });

  it("injects data-src-loc into .vue source in serve mode", () => {
    const plugin = claudeFeedback() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const out = callTransform2(plugin, src, "/proj/src/Counter.vue");
    expect(out).toBe(injectSourceLocations(src, "/proj/src/Counter.vue"));
    expect(out).toContain('data-src-loc="/proj/src/Counter.vue:2:3-2:16"');
  });

  it("does NOT transform in build mode (gating)", () => {
    const plugin = claudeFeedback() as AnyPlugin;
    callConfig(plugin, "build");
    const src = `<template><div>hi</div></template>`;
    expect(callTransform2(plugin, src, "/proj/src/Counter.vue")).toBeUndefined();
  });

  it("ignores non-.vue ids and .vue sub-requests (?vue&type=...)", () => {
    const plugin = claudeFeedback() as AnyPlugin;
    callConfig(plugin, "serve");
    expect(callTransform2(plugin, "export default {}", "/proj/src/util.ts")).toBeUndefined();
    expect(
      callTransform2(
        plugin,
        "export default {}",
        "/proj/src/Counter.vue?vue&type=script",
      ),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: FAIL — `plugin.enforce` is `undefined`, `plugin.transform` is `undefined`.

- [ ] **Step 3: Implement the hook**

In `src/plugin/index.ts`, add the import near the top (after the `createBridge` import):

```ts
import { injectSourceLocations } from "./inject-src-loc.js";
```

Add `enforce: "pre"` next to the existing `apply: "serve"` in the returned plugin object (`src/plugin/index.ts:70`):

```ts
    name: "vite-plugin-claude-feedback",
    apply: "serve",
    enforce: "pre",
```

Add a `transform` hook right after `config()` (`src/plugin/index.ts:72-74`):

```ts
    config(_config, env) {
      isBuild = env.command === "build";
    },

    transform(code: string, id: string) {
      if (isBuild || !id.endsWith(".vue")) return;
      return injectSourceLocations(code, id);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS (all cases, old + new).

- [ ] **Step 5: Commit**

```bash
git add src/plugin/index.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): wire source-location transform into .vue pipeline"
```

---

### Task 3: Surface `sourceLoc` on `ElementDescriptor`

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/client/resolve-component.ts`
- Modify: `tests/unit/resolve-component.test.ts`

**Interfaces:**
- Consumes: the `data-src-loc` attribute format produced by Task 1/2:
  `"<file>:<startLine>:<startCol>-<endLine>:<endCol>"`.
- Produces: `ElementDescriptor.sourceLoc: SourceLocation | null` (new exported type
  `SourceLocation` from `src/server/types.ts`); `describeElement(el)` in
  `src/client/resolve-component.ts` now populates it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/resolve-component.test.ts`, inside the existing `describe("describeElement", ...)` block:

```ts
  it("parses sourceLoc from a data-src-loc attribute", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/Counter.vue:2:3-2:16">hi</div>';
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toEqual({
      file: "/proj/src/Counter.vue",
      startLine: 2,
      startColumn: 3,
      endLine: 2,
      endColumn: 16,
    });
  });

  it("sourceLoc is null when the attribute is absent (element outside a picked template)", () => {
    document.body.innerHTML = "<div>hi</div>";
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toBeNull();
  });

  it("sourceLoc is null for a malformed data-src-loc value (hostile input)", () => {
    document.body.innerHTML = '<div data-src-loc="garbage">hi</div>';
    const d = describeElement(document.querySelector("div")!);
    expect(d.sourceLoc).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: FAIL — `d.sourceLoc` is `undefined`, not the expected object/`null`.

- [ ] **Step 3: Add the `SourceLocation` type**

In `src/server/types.ts`, replace the `ElementDescriptor` interface (lines 11-19):

```ts
/** Start/end of a picked element's tag inside its .vue source file. */
export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Best-effort description of the picked DOM element. */
export interface ElementDescriptor {
  tag: string;
  classes: string[];
  /** Trimmed text snippet. */
  text: string;
  /** Stable-ish CSS path (nth-of-type based). */
  selector: string;
  /** Tag's start/end position in its .vue source, or null when unresolvable. */
  sourceLoc: SourceLocation | null;
}
```

- [ ] **Step 4: Parse the attribute in `describeElement`**

In `src/client/resolve-component.ts`, add the import and helper, then update
`describeElement` (currently lines 82-89):

```ts
import type {
  ComponentDescriptor,
  ElementDescriptor,
  SourceLocation,
} from "../server/types";

const SRC_LOC_RE = /^(.+):(\d+):(\d+)-(\d+):(\d+)$/;

function parseSourceLoc(raw: string | null): SourceLocation | null {
  if (!raw) return null;
  const m = SRC_LOC_RE.exec(raw);
  if (!m) return null;
  return {
    file: m[1],
    startLine: Number(m[2]),
    startColumn: Number(m[3]),
    endLine: Number(m[4]),
    endColumn: Number(m[5]),
  };
}

export function describeElement(el: Element): ElementDescriptor {
  return {
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList ?? []),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    selector: cssPath(el),
    sourceLoc: parseSourceLoc(el.getAttribute("data-src-loc")),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: PASS (all cases, old + new).

- [ ] **Step 6: Commit**

```bash
git add src/server/types.ts src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(overlay): parse element source location from data-src-loc"
```

---

### Task 4: Update docs + full-suite verification

**Files:**
- Modify: `claude-plugin/mcp-server.mjs:53`
- Modify: `README.md:3`

**Interfaces:**
- Consumes: `ElementDescriptor.sourceLoc` (Task 3) — this task only touches user-facing
  description strings, no new code.

- [ ] **Step 1: Update the `get_feedback` tool description**

In `claude-plugin/mcp-server.mjs`, replace line 53:

```js
      "Drain and return all pending element-anchored feedback messages the user sent from the Vue+Vite dev preview (Alt+C). Each item has: url, message, element (tag/classes/selector/sourceLoc — start/end line+column of the tag in its .vue file, when resolvable), component (Vue name + __file + parent chain), and recent browser console. Acknowledges (removes) the items it returns, so call once and process the whole batch.",
```

- [ ] **Step 2: Update the README summary line**

In `README.md`, replace line 3:

```markdown
Send **element-anchored feedback** from a live Vue 3 + Vite dev preview straight to Claude Code. Press **Alt+C** in the preview, optionally pick an element, type what you want changed, and send. Along with your message Claude receives the page URL, a descriptor of the picked element (tag/classes/selector plus its start/end line and column in the `.vue` source, when resolvable), its **Vue component** (name + `__file:line` + parent chain), and the recent **browser console**. On request Claude can also pull a snapshot of a Pinia store or component state.
```

- [ ] **Step 3: Build and run the full suite**

```bash
pnpm build
pnpm test:run
```

Expected: build succeeds; all tests pass, including the new `inject-src-loc.test.ts`,
the extended `plugin-transform.test.ts`, and the extended `resolve-component.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add claude-plugin/mcp-server.mjs README.md
git commit -m "docs: mention element source location in tool description + README"
```
