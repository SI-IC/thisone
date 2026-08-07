# Preact support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give thisone's Alt+C picker the same feature set for Preact (`.jsx`/`.tsx` compiled through Preact, `preact/compat` HOCs) that it already has for Vue and React — source location on the picked DOM element, and full-chain component name/file/ancestor-breadcrumb resolution — auto-detected from the consuming project's `package.json`, dev-only, adding zero overhead (no extra script tag, no network request) to Vue/React projects.

**Architecture:** JSX source-location injection is already framework-agnostic (`inject-src-loc-react.ts` handles any `.tsx`/`.jsx`); it only needs `preact/compat` added next to `react` in its HOC-import-source allowlist. Component resolution is the new part: Preact attaches no DOM→component back-reference the way Vue (`__vueParentComponent`) and React (`__reactFiber$*`) do, so a small Vite virtual module (loaded only in Preact projects) patches `options.diffed` to build a `WeakMap<Element, VNode>` as the app renders, exposed on `window.__THISONE_PREACT_MAP__`. The client-side resolver looks an element up in that map, then walks `vnode._parent` to the root — the same ancestor-walk shape `resolveVueComponent`/`resolveReactComponent` already use. `resolveComponent()` gains a third dispatch branch; `describeElement`/`formatElementPath`/`formatElementPathFromRoot`/overlay/clipboard/screenshot code needs zero changes.

**Tech Stack:** TypeScript, existing `@babel/*` deps (no new ones), Vite's `resolveId`/`load` plugin hooks for the virtual module, vitest + happy-dom (unit tests), Playwright (e2e), Preact 10.29.8 + `preact/compat` (example app only, devDependency there — not a thisone dependency).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-07-preact-support-design.md` — read it before starting; this plan implements it verbatim.
- No new entries in thisone's own `package.json` `dependencies` — `preact` is never imported by thisone itself, only referenced by bare specifier inside a virtual module string that Vite resolves against the _consuming_ project's `node_modules`. Only `examples/demo-app-preact/package.json` gets `preact`/`preact/compat` as real dependencies.
- Preact pinned to `10.29.8` (latest stable, confirmed via `npm view preact version` during planning) in the example app.
- Plugin stays dev-only: `apply: 'serve'` and the `isBuild` gate in `transform()` are untouched; the new `configResolved`/`resolveId`/`load` hooks and the second `transformIndexHtml` tag must each independently no-op in build mode or when Preact isn't detected.
- Existing Vue and React behavior/tests must not change. Any edit to `src/client/resolve-component.ts` or `src/plugin/index.ts` must leave every existing exported name and its Vue/React-path behavior identical — `tests/unit/resolve-component.test.ts`, `tests/unit/resolve-component-react.test.ts`, `tests/unit/inject-src-loc-react.test.ts`, and `tests/unit/plugin-transform.test.ts`'s pre-existing cases must stay green throughout.
- Run `pnpm exec tsc --noEmit -p tsconfig.json` after every task that adds/edits a `.ts` file.
- `pnpm build` must succeed after every plugin/client task — several tests (`plugin-transform.test.ts`) require `dist/client.js` to exist via `beforeAll`.

---

### Task 1: `preact/compat` in the HOC-import-source allowlist

**Files:**

- Modify: `src/plugin/inject-src-loc-react.ts`
- Modify: `tests/unit/inject-src-loc-react.test.ts`

**Interfaces:**

- No signature change to `injectSourceLocations(source: string, relFile: string): string` — same function, wider HOC detection.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/inject-src-loc-react.test.ts` (new `describe` block):

```ts
describe("injectSourceLocations (React) — preact/compat HOCs", () => {
  it("recognizes memo/forwardRef imported from preact/compat", () => {
    const src =
      `import { memo, forwardRef } from "preact/compat";\n` +
      `const Foo = memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).not.toContain("Inner.__file");
  });

  it("recognizes an aliased preact/compat import (import { memo as m } from 'preact/compat')", () => {
    const src =
      `import { memo as m } from "preact/compat";\n` +
      `const Foo = m(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("recognizes a namespace preact/compat import (import * as PreactCompat from 'preact/compat')", () => {
    const src =
      `import * as PreactCompat from "preact/compat";\n` +
      `const Foo = PreactCompat.memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: the 3 new cases FAIL — `preact/compat` imports aren't recognized yet, so no `memo`/`forwardRef` HOC match occurs. (`Foo` still gets statics via the existing generic curried/wrapping-HOC heuristic in `isGenericHocCallWrappingComponent`, so check that the _namespace-qualified_ case, which requires `namespaceLocalNames`, is what actually distinguishes pass/fail — inspect actual failures and adjust assertions only if a case unexpectedly passes via the generic path; do not weaken an assertion to force a fail.)

- [ ] **Step 3: Widen `collectReactAliases`'s import-source check**

In `src/plugin/inject-src-loc-react.ts`, change:

```ts
function collectReactAliases(programNode: t.Program): ReactAliases {
  const hocLocalNames = new Map<string, string>();
  const namespaceLocalNames = new Set<string>();
  for (const stmt of programNode.body) {
    if (!t.isImportDeclaration(stmt) || stmt.source.value !== "react") {
      continue;
    }
```

to:

```ts
const HOC_IMPORT_SOURCES = new Set(["react", "preact/compat"]);

function collectReactAliases(programNode: t.Program): ReactAliases {
  const hocLocalNames = new Map<string, string>();
  const namespaceLocalNames = new Set<string>();
  for (const stmt of programNode.body) {
    if (
      !t.isImportDeclaration(stmt) ||
      !HOC_IMPORT_SOURCES.has(String(stmt.source.value))
    ) {
      continue;
    }
```

(Place the `HOC_IMPORT_SOURCES` constant near the existing `HOC_NAMES` constant at the top of the file.) Nothing else in the file changes — `isHocCallee`'s `React`-named member-expression check already matches a `preact/compat` namespace import aliased as `React`, `PreactCompat`, or anything else, since it only checks `namespaceLocalNames`, which this change already populates correctly regardless of source package.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: PASS, all cases (pre-existing React ones + 3 new preact/compat ones).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/plugin/inject-src-loc-react.ts tests/unit/inject-src-loc-react.test.ts
git commit -m "feat(plugin): recognize preact/compat memo/forwardRef in HOC detection"
```

---

### Task 2: Detect Preact projects (`hasPreact`)

**Files:**

- Modify: `src/plugin/index.ts`
- Modify: `tests/unit/plugin-transform.test.ts`

**Interfaces:**

- Produces: a private `hasPreact: boolean` closure variable inside `thisone()`, set by a new `configResolved` hook. Task 3 reads it from `transformIndexHtml` and gates the extra `resolveId`/`load` handling on it.

- [ ] **Step 1: Write the failing tests**

Add a helper and a new `describe` block to `tests/unit/plugin-transform.test.ts`:

```ts
// add near the other call* helpers at the top of the file
function callConfigResolved(plugin: AnyPlugin, root: string) {
  const hook = plugin.configResolved as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  fn?.call(plugin, { root, command: "serve" });
}
```

```ts
import { mkdtempSync, writeFileSync, rmSync as rmSyncFs } from "node:fs";
import { tmpdir } from "node:os";

function projectWith(pkg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "thisone-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: FAIL — no `configResolved` hook exists yet (`fn?.call` no-ops silently since `hook` is `undefined`, so `hasPreact` stays `false` and every "detects preact" case fails; the two degrade-gracefully cases pass vacuously, which is fine — they'll stay passing after the real implementation too).

- [ ] **Step 3: Implement detection in `src/plugin/index.ts`**

Add these imports at the top (alongside the existing `node:fs`/`node:path` imports):

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
```

(already present — no change needed there). Inside `thisone()`, alongside the existing `let isBuild = false;`:

```ts
let hasPreact = false;
```

Add a new plugin hook (place it next to `config`):

```ts
configResolved(resolvedConfig: { root: string }) {
  try {
    const pkgPath = resolve(resolvedConfig.root, "package.json");
    if (!existsSync(pkgPath)) return;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    hasPreact = Boolean(
      pkg?.dependencies?.preact || pkg?.devDependencies?.preact,
    );
  } catch {
    hasPreact = false;
  }
},
```

In `transformIndexHtml`'s `handler`, extend the `tags` array to conditionally include a second script tag when `hasPreact`:

```ts
transformIndexHtml: {
  order: "pre",
  handler(html: string) {
    if (isBuild) return html;
    const client = loadClientBundle();
    const tags = [
      {
        tag: "script",
        injectTo: "body" as const,
        children: `window.__THISONE_CFG__=${cfgJson};\n${client}`,
      },
    ];
    if (hasPreact) {
      tags.unshift({
        tag: "script",
        attrs: { type: "module" },
        injectTo: "head-prepend" as const,
        children: `import "virtual:thisone-preact-hook";`,
      });
    }
    return { html, tags };
  },
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS, all cases — pre-existing ones (unaffected, `hasPreact` defaults `false` when `configResolved` is never called, matching every earlier test in this file) plus the 5 new detection cases.

- [ ] **Step 5: Type-check, build, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm build
```

Expected: no type errors; build succeeds.

```bash
git add src/plugin/index.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): detect Preact projects via package.json"
```

---

### Task 3: Preact-hook virtual module

**Files:**

- Create: `src/plugin/preact-hook.ts`
- Modify: `src/plugin/index.ts`
- Test: `tests/unit/preact-hook.test.ts`
- Modify: `tests/unit/plugin-transform.test.ts`

**Interfaces:**

- Produces: `export const PREACT_HOOK_VIRTUAL_ID = "virtual:thisone-preact-hook"`, `export const PREACT_HOOK_RESOLVED_ID = "\0" + PREACT_HOOK_VIRTUAL_ID`, `export const PREACT_HOOK_SOURCE: string` (the module body Vite serves for the resolved id). Task 4's client resolver consumes `window.__THISONE_PREACT_MAP__`, the global this source installs — same contract, no direct import between the two.

- [ ] **Step 1: Write the failing test for the module source itself**

```ts
// tests/unit/preact-hook.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../../src/plugin/preact-hook";

describe("preact-hook virtual module ids", () => {
  it("resolved id is the virtual id prefixed with \\0", () => {
    expect(PREACT_HOOK_RESOLVED_ID).toBe("\0" + PREACT_HOOK_VIRTUAL_ID);
  });
});

describe("PREACT_HOOK_SOURCE (evaluated against a fake preact options object)", () => {
  // Simulates what happens once Vite resolves the bare "preact" import inside
  // PREACT_HOOK_SOURCE to this fake module — proves the hook logic itself
  // (chaining, WeakMap population) without needing the real preact package.
  async function evalHookSource(fakeOptions: any) {
    const src = PREACT_HOOK_SOURCE.replace(
      /from\s+["']preact["']/,
      "from '/@fake-preact.js'",
    );
    const blob = new Blob([src], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const registry = (globalThis as any).__vitestFakePreactModules ?? {};
    registry["/@fake-preact.js"] = { options: fakeOptions };
    (globalThis as any).__vitestFakePreactModules = registry;
    // vitest/vite dev transform doesn't let us intercept bare specifiers of
    // dynamically-blobbed modules, so instead: eval a rewritten copy whose
    // "import { options } from ..." becomes a destructure off a global.
    const rewritten = PREACT_HOOK_SOURCE.replace(
      /import\s*\{\s*options\s*\}\s*from\s*["']preact["'];?/,
      "const options = globalThis.__vitestFakePreactOptions;",
    );
    (globalThis as any).__vitestFakePreactOptions = fakeOptions;
    (globalThis as any).__THISONE_PREACT_MAP__ = undefined;
    // eslint-disable-next-line no-new-func
    new Function(rewritten)();
    URL.revokeObjectURL(url);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/preact-hook.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugin/preact-hook'`

- [ ] **Step 3: Implement `src/plugin/preact-hook.ts`**

```ts
// src/plugin/preact-hook.ts
// Preact attaches no DOM->component back-reference the way Vue
// (__vueParentComponent) and React (__reactFiber$*) do. options.diffed fires
// once a vnode's DOM representation is committed (same mechanism the official
// Preact DevTools extension uses), so this module builds the missing
// WeakMap<Element, VNode> itself and exposes it for resolve-component-preact.ts.
export const PREACT_HOOK_VIRTUAL_ID = "virtual:thisone-preact-hook";
export const PREACT_HOOK_RESOLVED_ID = "\0" + PREACT_HOOK_VIRTUAL_ID;

export const PREACT_HOOK_SOURCE = `
import { options } from "preact";
var map = new WeakMap();
var prevDiffed = options.diffed;
options.diffed = function (vnode) {
  if (vnode && vnode._dom) map.set(vnode._dom, vnode);
  if (prevDiffed) prevDiffed(vnode);
};
window.__THISONE_PREACT_MAP__ = map;
`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/preact-hook.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Wire `resolveId`/`load` into `src/plugin/index.ts`**

Add the import:

```ts
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "./preact-hook.js";
```

Add two hooks to the returned plugin object (alongside `config`/`configResolved`/`transform`):

```ts
resolveId(id: string) {
  if (id === PREACT_HOOK_VIRTUAL_ID) return PREACT_HOOK_RESOLVED_ID;
},

load(id: string) {
  if (id === PREACT_HOOK_RESOLVED_ID) return PREACT_HOOK_SOURCE;
},
```

Append to `tests/unit/plugin-transform.test.ts` (new `describe` block; add the import at the top alongside the others: `import { PREACT_HOOK_VIRTUAL_ID, PREACT_HOOK_RESOLVED_ID, PREACT_HOOK_SOURCE } from "../../src/plugin/preact-hook";`):

```ts
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
  it("resolveId maps the virtual id to the \\0-prefixed resolved id", () => {
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts tests/unit/preact-hook.test.ts`
Expected: PASS, all cases, including Task 2's detection tests still green.

- [ ] **Step 7: Type-check, build, full unit suite, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm build
pnpm exec vitest run
```

Expected: no type errors; build succeeds; full unit suite green.

```bash
git add src/plugin/preact-hook.ts src/plugin/index.ts tests/unit/preact-hook.test.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): add virtual module that hooks options.diffed for Preact"
```

---

### Task 4: Preact component resolution (`vnode._parent` walk)

**Files:**

- Create: `src/client/resolve-component-preact.ts`
- Test: `tests/unit/resolve-component-preact.test.ts`

**Interfaces:**

- Consumes: `baseName` from `./base-name`; `type ComponentDescriptor`, `type ChainEntry` from `./resolve-component` (type-only import).
- Produces:
  - `export function preactComponentName(type: any): string`
  - `export function resolvePreactComponent(el: Element | null): ComponentDescriptor | null` — reads `window.__THISONE_PREACT_MAP__`.

  Task 5 imports `resolvePreactComponent` into the dispatcher in `resolve-component.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/resolve-component-preact.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  preactComponentName,
  resolvePreactComponent,
} from "../../src/client/resolve-component-preact";

function vnode(type: any, dom: Element | null, parent: any = null): any {
  return { type, _dom: dom, _parent: parent };
}

function withMap(entries: [Element, any][]): void {
  const map = new WeakMap<Element, any>();
  for (const [el, vn] of entries) map.set(el, vn);
  (window as any).__THISONE_PREACT_MAP__ = map;
}

beforeEach(() => {
  delete (window as any).__THISONE_PREACT_MAP__;
});
afterEach(() => {
  delete (window as any).__THISONE_PREACT_MAP__;
});

describe("preactComponentName", () => {
  it("prefers displayName over the function's own name", () => {
    const type: any = function Foo() {};
    type.displayName = "CustomName";
    expect(preactComponentName(type)).toBe("CustomName");
  });

  it("falls back to the function's own name", () => {
    function Bar() {}
    expect(preactComponentName(Bar)).toBe("Bar");
  });

  it("falls back to __name when name/displayName are absent", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__name = "Baz";
    expect(preactComponentName(type)).toBe("Baz");
  });

  it("derives the name from __file's basename as a last resort", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__file = "/src/components/Widget.tsx";
    expect(preactComponentName(type)).toBe("Widget");
  });

  it("returns Anonymous when nothing is available", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    expect(preactComponentName(type)).toBe("Anonymous");
  });
});

describe("resolvePreactComponent", () => {
  it("returns null for null input (empty)", () => {
    expect(resolvePreactComponent(null)).toBeNull();
  });

  it("returns null when the map is absent (no preact-hook installed)", () => {
    expect(resolvePreactComponent(document.createElement("div"))).toBeNull();
  });

  it("returns null when the element has no entry in the map (outside the Preact tree)", () => {
    withMap([]);
    expect(resolvePreactComponent(document.createElement("div"))).toBeNull();
  });

  it("resolves name/file/chain by walking vnode._parent", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";

    const el = document.createElement("button");
    const appVnode = vnode(App, null);
    const counterVnode = vnode(Counter, el, appVnode);
    withMap([[el, counterVnode]]);

    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.tsx");
    expect(r.chain).toEqual([
      { name: "Counter", file: "/src/components/Counter.tsx" },
      { name: "App", file: "/src/App.tsx" },
    ]);
  });

  it("skips host (string-typed) vnodes in the chain", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    const el = document.createElement("span");
    const counterVnode = vnode(Counter, null);
    const hostVnode = vnode("span", el, counterVnode);
    withMap([[el, hostVnode]]);
    const r = resolvePreactComponent(el)!;
    expect(r.chain).toEqual([{ name: "Counter", file: "/src/Counter.tsx" }]);
  });

  it("falls back to nearest name and file:null when no ancestor has __file", () => {
    function Widget() {}
    const el = document.createElement("span");
    withMap([[el, vnode(Widget, el)]]);
    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBeNull();
    expect(r.chain).toEqual([{ name: "Widget", file: null }]);
  });

  it("skips ancestors without __file up to the first that has one", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    function Inline() {}
    const el = document.createElement("span");
    const counterVnode = vnode(Counter, null);
    const inlineVnode = vnode(Inline, el, counterVnode);
    withMap([[el, inlineVnode]]);
    const r = resolvePreactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/Counter.tsx");
    expect(r.chain).toEqual([
      { name: "Inline", file: null },
      { name: "Counter", file: "/src/Counter.tsx" },
    ]);
  });

  it("stops walking after 1000 ancestors (guard against cyclic/pathological vnode chains)", () => {
    let parent: any = null;
    for (let i = 0; i < 1005; i++) {
      const Comp = () => null;
      parent = vnode(Comp, null, parent);
    }
    const el = document.createElement("span");
    const leaf = vnode(() => null, el, parent);
    withMap([[el, leaf]]);
    const r = resolvePreactComponent(el)!;
    expect(r.chain.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component-preact.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/resolve-component-preact'`

- [ ] **Step 3: Implement `resolve-component-preact.ts`**

```ts
// src/client/resolve-component-preact.ts
// Resolve the Preact component behind a picked DOM element. Preact attaches no
// DOM->vnode back-reference by default (unlike Vue's __vueParentComponent or
// React's __reactFiber$*), so this reads the WeakMap the preact-hook virtual
// module (src/plugin/preact-hook.ts) builds via options.diffed and exposes on
// window.__THISONE_PREACT_MAP__, then walks vnode._parent to the root — same
// shape as resolveVueComponent's `.parent` walk and resolveReactComponent's
// `.return` walk.
import { baseName } from "./base-name";
import type { ChainEntry, ComponentDescriptor } from "./resolve-component";

declare global {
  interface Window {
    __THISONE_PREACT_MAP__?: WeakMap<Element, any>;
  }
}

export function preactComponentName(type: any): string {
  if (type?.displayName) return String(type.displayName);
  if (type?.name) return String(type.name);
  if (type?.__name) return String(type.__name);
  if (type?.__file) return baseName(String(type.__file));
  return "Anonymous";
}

function isComponentVnodeType(type: any): boolean {
  return typeof type === "function";
}

export function resolvePreactComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const map = window.__THISONE_PREACT_MAP__;
  if (!map) return null;
  const start = map.get(el);
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const type = cur.type;
    if (isComponentVnodeType(type)) {
      const name = preactComponentName(type);
      const file = type?.__file ? String(type.__file) : null;
      chain.push({ name, file });
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = file;
      }
    }
    cur = cur._parent;
  }

  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component-preact.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors. `ChainEntry`/`ComponentDescriptor` are already exported from `resolve-component.ts` in its current (pre-Task-5) state, so this type import resolves immediately — no ordering dependency on Task 5.

```bash
git add src/client/resolve-component-preact.ts tests/unit/resolve-component-preact.test.ts
git commit -m "feat(client): resolve Preact components via the options.diffed WeakMap"
```

---

### Task 5: `resolveComponent` dispatcher gains the Preact branch

**Files:**

- Modify: `src/client/resolve-component.ts`
- Modify: `tests/unit/resolve-component.test.ts`

**Interfaces:**

- `resolveComponent(el: Element | null): ResolvedComponent | null` keeps its exact existing signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/resolve-component.test.ts` (new `describe` block; also import `resolvePreactComponent`'s test helpers indirectly by setting `window.__THISONE_PREACT_MAP__` directly, mirroring `resolve-component-preact.test.ts`'s pattern):

```ts
describe("resolveComponent dispatcher — Preact", () => {
  afterEach(() => {
    delete (window as any).__THISONE_PREACT_MAP__;
  });

  it("dispatches to the Preact resolver when the element is in window.__THISONE_PREACT_MAP__ (no Vue/React markers)", () => {
    function Widget() {}
    (Widget as any).__file = "/src/Widget.tsx";
    const el = document.createElement("span");
    const map = new WeakMap<Element, any>();
    map.set(el, { type: Widget, _dom: el, _parent: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBe("/src/Widget.tsx");
  });

  it("prefers the Vue resolver over the Preact map when both are present", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = {
      type: { name: "VueWidget" },
      parent: null,
    };
    const map = new WeakMap<Element, any>();
    map.set(el, { type: function PreactWidget() {}, _dom: el, _parent: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    expect(resolveComponent(el)!.name).toBe("VueWidget");
  });

  it("prefers the React resolver over the Preact map when both are present", () => {
    function ReactWidget() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$preacttest = { type: ReactWidget, return: null };
    const map = new WeakMap<Element, any>();
    map.set(el, { type: function PreactWidget() {}, _dom: el, _parent: null });
    (window as any).__THISONE_PREACT_MAP__ = map;

    expect(resolveComponent(el)!.name).toBe("ReactWidget");
  });

  it("still returns null when no resolver claims the element", () => {
    (window as any).__THISONE_PREACT_MAP__ = new WeakMap();
    expect(resolveComponent(document.createElement("i"))).toBeNull();
  });
});
```

Add `afterEach` to the existing `import { describe, it, expect } from "vitest";` line: `import { describe, it, expect, afterEach } from "vitest";`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: the 3 dispatch-to-Preact cases FAIL (dispatcher doesn't know about the Preact map yet, so `resolveComponent` falls through to the React branch — which returns `null` for elements with no fiber key — instead of resolving via Preact); the "still returns null" case passes vacuously already.

- [ ] **Step 3: Extend the dispatcher**

In `src/client/resolve-component.ts`:

1. Add the import: `import { resolvePreactComponent } from "./resolve-component-preact";`
2. Change the dispatcher body from:

```ts
export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  return resolveReactComponent(el);
}
```

to:

```ts
export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  const react = resolveReactComponent(el);
  if (react) return react;
  return resolvePreactComponent(el);
}
```

`resolveReactComponent` already returns `null` (not throwing) when no `__reactFiber$*` key is present, so this ordering costs nothing extra for Vue/React projects — the Preact branch is only ever reached when both prior checks miss, and `resolvePreactComponent` itself short-circuits to `null` in a single `window.__THISONE_PREACT_MAP__` check when the hook was never installed (non-Preact projects).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: PASS, all cases — every pre-existing Vue/React test plus the 4 new Preact-dispatch tests.

- [ ] **Step 5: Full check, type-check, build, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
```

Expected: no type errors; full unit suite green; build succeeds.

```bash
git add src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(client): dispatch resolveComponent to the Preact resolver"
```

---

### Task 6: Preact example app (`examples/demo-app-preact`)

**Files:**

- Create: `examples/demo-app-preact/package.json`
- Create: `examples/demo-app-preact/vite.config.ts`
- Create: `examples/demo-app-preact/index.html`
- Create: `examples/demo-app-preact/src/main.tsx`
- Create: `examples/demo-app-preact/src/app.css`
- Create: `examples/demo-app-preact/src/App.tsx`
- Create: `examples/demo-app-preact/src/Counter.tsx`
- Create: `examples/demo-app-preact/src/MemoBadge.tsx`
- Create: `examples/demo-app-preact/src/DemoHeader.tsx`
- Modify: `examples/demo-app-react/src/DemoHeader.tsx` (add the Preact nav link)
- Modify: `examples/demo-app-react/src/DemoHeader.test.tsx`
- Modify: `examples/demo-app/src/components/DemoHeader.vue` (add the Preact nav link)

**Interfaces:**

- Consumes: the root package via `"vite-plugin-thisone": "link:../.."` (real symlink, same as `demo-app`/`demo-app-react` — `file:` would go stale after a root `pnpm build`, see `tests/e2e/README.md`).
- Produces: a running app whose DOM structure Task 7/8 drive directly — line numbers referenced by future e2e assertions are load-bearing; do not reformat these files afterward without checking Task 8's regexes.
- Uses `preact/compat`'s `memo` (not `preact`'s own, which doesn't export one) so `MemoBadge.tsx` exercises the exact `preact/compat` HOC path Task 1 added.

- [ ] **Step 1: Create the example app files**

```json
// examples/demo-app-preact/package.json
{
  "name": "thisone-demo-app-preact",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "preact": "10.29.8"
  },
  "devDependencies": {
    "vite": "8.2.1",
    "vite-plugin-thisone": "link:../.."
  }
}
```

```ts
// examples/demo-app-preact/vite.config.ts
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_PREACT_PORT ?? 5186);
const proxiedByDevDemoOnPort = process.env.THISONE_DEMO_PORT
  ? Number(process.env.THISONE_DEMO_PORT)
  : undefined;

export default defineConfig({
  plugins: [thisone()],
  base: proxiedByDevDemoOnPort ? "/preact-demo/" : "/",
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: proxiedByDevDemoOnPort
      ? { clientPort: proxiedByDevDemoOnPort, path: "preact-demo-hmr" }
      : undefined,
  },
});
```

Deliberately no `@preact/preset-vite` — this example proves the plugin's own JSX transform and detection work standalone. JSX is compiled by esbuild's default `jsxFactory`/`jsxFragment` handling — set it explicitly since Preact's runtime export names differ from React's:

```ts
// append to the defineConfig({...}) call above, inside it:
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
```

(Full `vite.config.ts` combines both blocks — `plugins`, `base`, `server`, and `esbuild` as sibling keys of the single `defineConfig({...})` call.)

```html
<!-- examples/demo-app-preact/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>thisone preact demo</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// examples/demo-app-preact/src/main.tsx
import { render } from "preact";
import App from "./App";

render(<App />, document.getElementById("app")!);
```

```css
/* examples/demo-app-preact/src/app.css */
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

```tsx
// examples/demo-app-preact/src/App.tsx
import Counter from "./Counter";
import DemoHeader from "./DemoHeader";
import "./app.css";

export default function App() {
  return (
    <>
      <DemoHeader active="preact" />
      <main>
        <h1>thisone preact demo</h1>
        <Counter />
      </main>
    </>
  );
}
```

```tsx
// examples/demo-app-preact/src/Counter.tsx
import { useState } from "preact/hooks";
import MemoBadge from "./MemoBadge";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>count is {count}</button>
      <MemoBadge label="demo" />
    </div>
  );
}
```

```tsx
// examples/demo-app-preact/src/MemoBadge.tsx
import { memo } from "preact/compat";

const MemoBadge = memo(function MemoBadge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
});

export default MemoBadge;
```

```tsx
// examples/demo-app-preact/src/DemoHeader.tsx
export default function DemoHeader({
  active,
}: {
  active: "vue" | "react" | "preact";
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
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Update the Vue and React demo headers with the Preact link**

`examples/demo-app-react/src/DemoHeader.tsx` — widen the prop type and add the third link:

```tsx
export default function DemoHeader({
  active,
}: {
  active: "vue" | "react" | "preact";
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
      </nav>
    </header>
  );
}
```

`examples/demo-app-react/src/DemoHeader.test.tsx` — add a third case and widen the existing regexes to tolerate the new link (they currently assert the full rendered string ends right after the React link):

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
  });

  it('marks the "Vue" link active when active="vue"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="vue" />);
    expect(html).toMatch(/<a href="\/" class="active">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
  });

  it('marks the "Preact" link active when active="preact"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="preact" />);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(
      /<a href="\/preact-demo\/" class="active">Preact<\/a>/,
    );
  });
});
```

`examples/demo-app/src/components/DemoHeader.vue` — widen the prop type and add the third link:

```vue
<script setup lang="ts">
defineProps<{ active: "vue" | "react" | "preact" }>();
</script>

<template>
  <header class="demo-header">
    <nav>
      <a href="/" :class="{ active: active === 'vue' }">Vue</a>
      <a href="/react-demo/" :class="{ active: active === 'react' }">React</a>
      <a href="/preact-demo/" :class="{ active: active === 'preact' }"
        >Preact</a
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
cd examples/demo-app-preact
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

- [ ] **Step 4: Regression-check the Vue and React demo apps still build clean**

```bash
cd examples/demo-app-react && pnpm exec vitest run && cd ../..
```

Expected: `DemoHeader.test.tsx`'s widened assertions pass.

- [ ] **Step 5: Commit**

```bash
git add examples/demo-app-preact examples/demo-app-react/src/DemoHeader.tsx \
  examples/demo-app-react/src/DemoHeader.test.tsx examples/demo-app/src/components/DemoHeader.vue
git commit -m "test(examples): add a bare Vite+Preact demo app for the picker"
```

(`examples/demo-app-preact/node_modules/` is covered by the repo-root `.gitignore`'s unanchored `node_modules/` pattern.)

---

### Task 7: Wire the Preact demo into `dev-demo.sh` and the Vue demo's proxy

**Files:**

- Modify: `examples/demo-app/vite.config.ts`
- Modify: `scripts/dev-demo.sh`

**Interfaces:**

- Consumes: `examples/demo-app-preact` (Task 6).
- Produces: `bash scripts/dev-demo.sh` now fronts three apps (Vue on the main port, React and Preact each on their own loopback port, proxied under `/react-demo/` and `/preact-demo/`).

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
vue_port="${THISONE_DEMO_PORT:-3000}"

fuser -k -TERM "${react_port}/tcp" "${preact_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true
sleep 1
fuser -k -KILL "${react_port}/tcp" "${preact_port}/tcp" "${vue_port}/tcp" 2>/dev/null || true

react_pid=""
preact_pid=""
vue_pid=""
cleanup() {
  [ -n "$react_pid" ] && kill "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && kill "$preact_pid" 2>/dev/null || true
  [ -n "$vue_pid" ] && kill "$vue_pid" 2>/dev/null || true
  [ -n "$react_pid" ] && wait "$react_pid" 2>/dev/null || true
  [ -n "$preact_pid" ] && wait "$preact_pid" 2>/dev/null || true
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

cd "$root/examples/demo-app"
THISONE_DEMO_REACT_PORT="$react_port" THISONE_DEMO_PREACT_PORT="$preact_port" THISONE_DEMO_PORT="$vue_port" \
  node_modules/.bin/vite --port "$vue_port" --strictPort --host 0.0.0.0 \
  >/tmp/thisone-demo-vue-dev.log 2>&1 &
vue_pid=$!

wait "$vue_pid"
```

- [ ] **Step 3: Manually verify (dev-only script, no automated test covers it)**

```bash
bash scripts/dev-demo.sh &
sleep 3
curl -sf http://127.0.0.1:3000/ | grep -q "Preact" && echo "nav link present"
curl -sf http://127.0.0.1:3000/preact-demo/ | grep -q "thisone preact demo" || echo "PROXY BROKEN"
kill %1 2>/dev/null || true
```

Expected: `nav link present`, no `PROXY BROKEN` line. `scripts/dev-demo.test.sh` (existing) only bash-syntax-checks `dev-demo.sh` — confirm it still passes: `bash scripts/dev-demo.test.sh`.

- [ ] **Step 4: Commit**

```bash
git add examples/demo-app/vite.config.ts scripts/dev-demo.sh
git commit -m "feat(examples): front the Preact demo through dev-demo.sh's proxy"
```

---

### Task 8: Preact e2e (Playwright) + harness script

**Files:**

- Create: `tests/e2e/thisone-preact.e2e.mjs`
- Create: `scripts/e2e-preact.sh`
- Create: `scripts/e2e-preact.test.sh`
- Modify: `tests/e2e/README.md`

**Interfaces:**

- Consumes: `examples/demo-app-preact` (Task 6), the built `dist/` (Task 3/5's `pnpm build` output).
- This is the plan's **reproduce-before-done** proof — the only step that exercises the real browser + real Preact runtime + the actual `options.diffed` hook end-to-end, which the unit tests (mocked vnodes, string-diffed transform output) cannot cover.

- [ ] **Step 1: Write `tests/e2e/thisone-preact.e2e.mjs`**

```js
#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app-preact");

const port = Number(process.argv[2]);
assert.ok(
  Number.isInteger(port) && port > 0,
  "usage: thisone-preact.e2e.mjs <port>",
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
  await check(
    "no console/page errors on load (bare Vite+Preact, no @preact/preset-vite)",
    async () => {
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);
    },
  );

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

  await page.locator('button:has-text("count is")').click();
  await check(
    "picking a host element inside a function component resolves name + file:line (via the options.diffed WeakMap, no Vue/React internals present)",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<button>/);
      assert.match(text ?? "", /Counter/);
      assert.match(text ?? "", /Counter\.tsx:8:\d+-8:\d+/);
    },
  );

  const badgeBox = await page.locator("span.badge").boundingBox();
  assert.ok(badgeBox, "span.badge should have a bounding box");
  await page.mouse.click(
    badgeBox.x + badgeBox.width / 2,
    badgeBox.y + badgeBox.height / 2,
  );
  await check(
    "picking a host element inside a preact/compat memo()-wrapped component resolves the memo's own name",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /^<span> · MemoBadge · /);
      assert.match(text ?? "", /MemoBadge\.tsx:4:\d+-4:\d+/);
    },
  );

  await check(
    "root-mount path mode includes the memo()-wrapped component's own file in the breadcrumb",
    async () => {
      await pathModeToggle.click();
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(
        text ?? "",
        /^App \(.*App\.tsx\) › Counter \(.*Counter\.tsx\) › MemoBadge \(.*MemoBadge\.tsx\) › <span>/,
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
    "picking a host element inside the default-exported root component resolves App + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<h1>/);
      assert.match(text ?? "", /App/);
      assert.match(text ?? "", /App\.tsx:9:\d+-9:\d+/);
    },
  );

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 2000 });
} finally {
  await browser.close();
}

await check(
  "prod build does not inject the overlay, any data-src-loc, or the preact-hook virtual module",
  async () => {
    execFileSync(
      "node",
      [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
      { cwd: demoDir, stdio: "pipe" },
    );
    const found = grepMatches(
      "__thisone\\|data-src-loc\\|thisone-preact-hook",
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

- [ ] **Step 2: Write `scripts/e2e-preact.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app-preact"
port="${THISONE_E2E_PREACT_PORT:-5187}"

cd "$root"
pnpm build

cd "$demo"
node_modules/.bin/vite --port "$port" --strictPort >/tmp/thisone-e2e-preact-dev.log 2>&1 &
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
  cat /tmp/thisone-e2e-preact-dev.log >&2
  exit 1
fi

cd "$root"
node tests/e2e/thisone-preact.e2e.mjs "$port"
```

```bash
chmod +x scripts/e2e-preact.sh
```

- [ ] **Step 3: Write `scripts/e2e-preact.test.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/e2e-preact.sh"

if bash -n "$script"; then
  echo "ok - scripts/e2e-preact.sh is syntactically valid bash"
else
  echo "not ok - scripts/e2e-preact.sh has a syntax error"
  exit 1
fi

if [ -x "$script" ]; then
  echo "ok - scripts/e2e-preact.sh is executable"
else
  echo "not ok - scripts/e2e-preact.sh is not executable"
  exit 1
fi

if grep -q 'thisone-preact.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-preact.sh delegates to tests/e2e/thisone-preact.e2e.mjs"
else
  echo "not ok - scripts/e2e-preact.sh does not delegate to the preact e2e test"
  exit 1
fi
```

```bash
chmod +x scripts/e2e-preact.test.sh
```

- [ ] **Step 4: Update `tests/e2e/README.md`**

Add a new section after the existing "React + `@vitejs/plugin-react` harness" section:

```markdown
## Preact harness

`thisone-preact.e2e.mjs` covers what's specific to the Preact path against a **bare** Vite+Preact
app (`examples/demo-app-preact/`, deliberately without `@preact/preset-vite`): source-location +
component-name resolution for a plain function component, a `preact/compat`-`memo()`-wrapped
component, and the default-exported root component — each resolved via the `options.diffed`
WeakMap the plugin's virtual module installs, not via any Vue/React internals — plus the same
prod-build exclusion check as the other harnesses (also asserting the `thisone-preact-hook`
virtual module leaves no trace in the build). Panel mechanics (drag, clipboard, screenshot,
hotkey) are framework-agnostic and already fully covered by `thisone.e2e.mjs` against the Vue
demo app — this script doesn't repeat them.

Run:
```

bash scripts/e2e-preact.sh

```

Same `link:../..` wiring note as the other demo apps applies to `examples/demo-app-preact`.
```

Also extend the "Browsing both demos live" section's final paragraph to mention the third app:

```markdown
`scripts/dev-demo.sh` fronts `examples/demo-app` (Vue), `examples/demo-app-react` (React), and
`examples/demo-app-preact` (Preact) with a single dev server on port 3000: the Vue app proxies
`/react-demo/**` and `/preact-demo/**` (including each app's HMR websocket) to two second,
loopback-only Vite instances. Each app's header has a Vue/React/Preact nav link to switch between
them without touching the URL bar's port. Only used for manually poking at the picker in a
browser — not part of any e2e/unit suite.
```

- [ ] **Step 5: Run the e2e suite**

```bash
npx playwright install chromium
```

(first time only, if not already installed — skip if `tests/e2e/thisone.e2e.mjs` already runs successfully in this environment)

```bash
bash scripts/e2e-preact.sh
```

Expected: every `ok - ...` line prints, final line `e2e ok`, exit code 0.

- [ ] **Step 6: Regression-check the existing Vue/React e2e suites still pass**

```bash
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react-plugin.sh
```

Expected: `e2e ok` from each — confirms Task 5's dispatcher change and Task 2/3's new plugin hooks didn't regress the Vue/React paths.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/thisone-preact.e2e.mjs scripts/e2e-preact.sh scripts/e2e-preact.test.sh tests/e2e/README.md
git commit -m "test(e2e): add Preact picker flow against a bare Vite+Preact app"
```

---

## Final verification (after Task 8)

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react-plugin.sh
bash scripts/e2e-preact.sh
```

Expected: all seven commands succeed. This is the full gate — type-check, unit suite (Vue + React + Preact + dispatcher + build-externals), build, and all four e2e harnesses green.
