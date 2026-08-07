# Root-mount path display mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, independently-toggleable path display mode to the overlay panel that shows the picked element's component chain from the root component (`App`) down to the element, instead of (or alongside, per user choice) the existing file-tree path.

**Architecture:** Extend the existing component-chain walk (`resolveComponent`/`resolveReactComponent`) to keep each ancestor's file (not just its name), add a pure formatter (`formatElementPathFromRoot`) that renders that chain as a breadcrumb, persist the user's chosen mode in `localStorage` via a new small store module (mirrors the existing `target-store.ts` pattern), and wire a toggle button into the overlay panel next to the path text.

**Tech Stack:** TypeScript, Vitest + happy-dom (unit tests), no new dependencies.

## Global Constraints

- The on-screen path text and the clipboard-copied text must always be identical — no separate compact/verbose formats (per approved spec).
- Root-mode format: `Name (file) › Name (file) › ... › <tag> startLine:startCol-endLine:endCol`, root-to-leaf order, `›` separator, ancestors without a `__file` render as bare `Name` (no parens), trailing tag+location omitted when `sourceLoc` is null.
- Default mode is `"tree"` (today's existing file-tree format), persisted in `localStorage` under key `thisone:path-mode`.
- Toggle button styling matches the existing `.target-toggle` pattern (border `#585b70`, hover `#313244`/`#89b4fa`, active state `rgba(137,180,250,.12)` fill + `#89b4fa` border), placed next to `.path` (not inside it).
- Spec: `docs/superpowers/specs/2026-08-07-root-mount-path-design.md`.

---

### Task 1: Extend component chain to carry each ancestor's file

**Files:**

- Modify: `src/client/resolve-component.ts:17-76`
- Modify: `src/client/resolve-component-react.ts:43-78`
- Test: `tests/unit/resolve-component.test.ts:13-61`
- Test: `tests/unit/resolve-component-react.test.ts:64-180`

**Interfaces:**

- Consumes: nothing new.
- Produces: `export interface ChainEntry { name: string; file: string | null }` from `src/client/resolve-component.ts`. `ComponentDescriptor.chain` becomes `ChainEntry[]` (was `string[]`). `chain[0]` is the picked element's nearest ancestor, `chain[chain.length - 1]` is the root.

- [ ] **Step 1: Update the failing tests to expect `ChainEntry[]` in `tests/unit/resolve-component.test.ts`**

Replace the three assertions in the `resolveComponent` describe block:

```ts
it("resolves name/file/chain from the __vueParentComponent chain", () => {
  const root = inst({ __file: "/src/App.vue", name: "App" });
  const counter = inst(
    { __file: "/src/components/Counter.vue", name: "Counter" },
    root,
  );
  const el = document.createElement("button");
  (el as any).__vueParentComponent = counter;
  const r = resolveComponent(el)!;
  expect(r.name).toBe("Counter");
  expect(r.file).toBe("/src/components/Counter.vue");
  expect(r.chain).toEqual([
    { name: "Counter", file: "/src/components/Counter.vue" },
    { name: "App", file: "/src/App.vue" },
  ]);
});
```

```ts
it("skips instances without __file up to the first that has one", () => {
  const withFile = inst({ __file: "/src/components/Counter.vue" });
  const leaf = inst({ name: "Inline" }, withFile);
  const el = document.createElement("span");
  (el as any).__vueParentComponent = leaf;
  const r = resolveComponent(el)!;
  expect(r.name).toBe("Counter");
  expect(r.file).toBe("/src/components/Counter.vue");
  expect(r.chain).toEqual([
    { name: "Inline", file: null },
    { name: "Counter", file: "/src/components/Counter.vue" },
  ]);
});
```

```ts
it("falls back to nearest name and file:null when no __file in chain", () => {
  const el = document.createElement("span");
  (el as any).__vueParentComponent = inst({ name: "Widget" });
  const r = resolveComponent(el)!;
  expect(r.name).toBe("Widget");
  expect(r.file).toBeNull();
  expect(r.chain).toEqual([{ name: "Widget", file: null }]);
});
```

Leave every other test in the file unchanged.

- [ ] **Step 2: Run the test file to confirm it fails against the current (unmodified) source**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: FAIL — the three updated assertions mismatch (`r.chain` is still `string[]`).

- [ ] **Step 3: Update `tests/unit/resolve-component-react.test.ts` to expect `ChainEntry[]`**

Replace the five `.chain` assertions in the `resolveReactComponent` describe block:

```ts
it("resolves name/file/chain by walking fiber.return", () => {
  function App() {}
  (App as any).__file = "/src/App.tsx";
  function Counter() {}
  (Counter as any).__file = "/src/components/Counter.tsx";

  const root = fiber(App);
  const counterFiber = fiber(Counter, root);
  const hostFiber = fiber("button", counterFiber);
  const el = document.createElement("button");
  (el as any).__reactFiber$k1 = hostFiber;

  const r = resolveReactComponent(el)!;
  expect(r.name).toBe("Counter");
  expect(r.file).toBe("/src/components/Counter.tsx");
  expect(r.chain).toEqual([
    { name: "Counter", file: "/src/components/Counter.tsx" },
    { name: "App", file: "/src/App.tsx" },
  ]);
});
```

```ts
it("skips host (string-typed) fibers in the chain", () => {
  function Counter() {}
  (Counter as any).__file = "/src/Counter.tsx";
  const el = document.createElement("span");
  (el as any).__reactFiber$k2 = fiber("span", fiber(Counter));
  const r = resolveReactComponent(el)!;
  expect(r.chain).toEqual([{ name: "Counter", file: "/src/Counter.tsx" }]);
});
```

```ts
it("excludes non-component symbol-tagged fibers (e.g. a context provider) from the chain", () => {
  function App() {}
  (App as any).__file = "/src/App.tsx";
  const providerType: any = { $$typeof: Symbol.for("react.provider") };
  const el = document.createElement("span");
  (el as any).__reactFiber$k5 = fiber(providerType, fiber(App));
  const r = resolveReactComponent(el)!;
  expect(r.chain).toEqual([{ name: "App", file: "/src/App.tsx" }]);
});
```

```ts
it("falls back to nearest name and file:null when no ancestor has __file", () => {
  function Widget() {}
  const el = document.createElement("span");
  (el as any).__reactFiber$k6 = fiber(Widget);
  const r = resolveReactComponent(el)!;
  expect(r.name).toBe("Widget");
  expect(r.file).toBeNull();
  expect(r.chain).toEqual([{ name: "Widget", file: null }]);
});
```

```ts
it("skips ancestors without __file up to the first that has one", () => {
  function Counter() {}
  (Counter as any).__file = "/src/Counter.tsx";
  function Inline() {}
  const el = document.createElement("span");
  (el as any).__reactFiber$k7 = fiber(Inline, fiber(Counter));
  const r = resolveReactComponent(el)!;
  expect(r.name).toBe("Counter");
  expect(r.file).toBe("/src/Counter.tsx");
  expect(r.chain).toEqual([
    { name: "Inline", file: null },
    { name: "Counter", file: "/src/Counter.tsx" },
  ]);
});
```

The remaining tests (`getReactFiberKey`, `reactComponentName`, the "returns null" cases, the memo/forwardRef name tests, and the 1000-ancestor guard test which only checks `.length`) are unchanged.

- [ ] **Step 4: Run both test files to confirm they still fail**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts tests/unit/resolve-component-react.test.ts`
Expected: FAIL — same mismatch, now also in the react test file.

- [ ] **Step 5: Add `ChainEntry` and switch `ComponentDescriptor.chain` in `src/client/resolve-component.ts`**

```ts
export interface ChainEntry {
  name: string;
  file: string | null;
}

export interface ComponentDescriptor {
  name: string;
  file: string | null;
  chain: ChainEntry[];
}
```

Replace `resolveVueComponent`'s body:

```ts
function resolveVueComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  const start = (el as any).__vueParentComponent;
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const name = componentName(cur);
    const file = cur.type?.__file ? String(cur.type.__file) : null;
    chain.push({ name, file });
    if (!resolvedName && file) {
      resolvedName = name;
      resolvedFile = file;
    }
    cur = cur.parent;
  }

  // No `__file` anywhere (e.g. minified prod build) — keep the nearest name.
  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
```

- [ ] **Step 6: Mirror the same change in `resolveReactComponent` (`src/client/resolve-component-react.ts`)**

Add the import and update the function body:

```ts
import { baseName } from "./base-name";
import type { ComponentDescriptor, ChainEntry } from "./resolve-component";
```

```ts
export function resolveReactComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const key = getReactFiberKey(el);
  if (!key) return null;
  const start = (el as any)[key];
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const type = cur.type;
    if (isComponentFiberType(type)) {
      const name = reactComponentName(type);
      const rawFile = fileOf(type);
      const file = rawFile ? String(rawFile) : null;
      chain.push({ name, file });
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = file;
      }
    }
    cur = cur.return;
  }

  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
```

- [ ] **Step 7: Run both test files to confirm they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts tests/unit/resolve-component-react.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (catches any other consumer of `ComponentDescriptor.chain` still assuming `string[]` — there are none outside these two files and `overlay.ts`, which Task 4 updates).

- [ ] **Step 9: Commit**

```bash
git add src/client/resolve-component.ts src/client/resolve-component-react.ts tests/unit/resolve-component.test.ts tests/unit/resolve-component-react.test.ts
git commit -m "feat(client): keep each component-chain ancestor's file, not just its name"
```

---

### Task 2: Add `formatElementPathFromRoot`

**Files:**

- Modify: `src/client/resolve-component.ts` (append new export near `formatElementPath`)
- Test: `tests/unit/resolve-component.test.ts` (new `describe("formatElementPathFromRoot", ...)` block)

**Interfaces:**

- Consumes: `ChainEntry[]`, `resolveComponent()`, `describeElement()` (all from Task 1 / existing code in the same file).
- Produces: `export function formatElementPathFromRoot(el: Element): string` from `src/client/resolve-component.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/resolve-component.test.ts` (after the existing `formatElementPath` describe block):

```ts
describe("formatElementPathFromRoot", () => {
  it("builds a root-to-leaf breadcrumb with per-level files and the tag's source location", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/components/Counter.vue:12:3-12:45"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/components/Counter.vue", name: "Counter" },
      parent: {
        type: { __file: "/proj/src/App.vue", name: "App" },
        parent: null,
      },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › Counter (/proj/src/components/Counter.vue) › <div> 12:3-12:45",
    );
  });

  it("handles a single-entry chain when the root component itself is picked (boundary)", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/App.vue:1:1-1:10"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/App.vue", name: "App" },
      parent: null,
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › <div> 1:1-1:10",
    );
  });

  it("renders an ancestor without __file as a bare name (no parens)", () => {
    document.body.innerHTML = "<span></span>";
    const el = document.querySelector("span")!;
    (el as any).__vueParentComponent = {
      type: { name: "Inline" },
      parent: {
        type: { __file: "/proj/src/App.vue", name: "App" },
        parent: null,
      },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/proj/src/App.vue) › Inline › <span>",
    );
  });

  it("omits the source-location suffix when data-src-loc is absent (empty)", () => {
    document.body.innerHTML = "<i></i>";
    const el = document.querySelector("i")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/App.vue", name: "App" },
      parent: null,
    };
    expect(formatElementPathFromRoot(el)).toBe("App (/proj/src/App.vue) › <i>");
  });

  it("falls back to the CSS selector outside the Vue/React app (no component)", () => {
    document.body.innerHTML = '<main><button id="go"></button></main>';
    const el = document.getElementById("go")!;
    expect(formatElementPathFromRoot(el)).toBe("<button> · #go");
  });

  it("works through the React resolver too (dispatcher)", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";
    const el = document.createElement("button");
    (el as any).__reactFiber$rootpath = {
      type: Counter,
      return: { type: App, return: null },
    };
    expect(formatElementPathFromRoot(el)).toBe(
      "App (/src/App.tsx) › Counter (/src/components/Counter.tsx) › <button>",
    );
  });
});
```

Add `formatElementPathFromRoot` to the existing import at the top of the test file:

```ts
import {
  resolveComponent,
  describeElement,
  formatElementPath,
  formatElementPathFromRoot,
} from "../../src/client/resolve-component";
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: FAIL with "formatElementPathFromRoot is not a function" / import error.

- [ ] **Step 3: Implement `formatElementPathFromRoot` in `src/client/resolve-component.ts`**

Append after the existing `formatElementPath` function:

```ts
/**
 * Formats the element's component chain from the root component down to the
 * picked element: `Name (file) › ... › <tag> startLine:startCol-endLine:endCol`.
 * Ancestors without a resolvable `__file` render as a bare name. Falls back to
 * the same CSS-selector format as `formatElementPath` when no component resolves.
 * @param el - DOM element to format
 * @returns root-to-leaf breadcrumb text
 */
export function formatElementPathFromRoot(el: Element): string {
  const d = describeElement(el);
  const c = resolveComponent(el);
  const tag = `<${d.tag}>`;
  if (!c || c.chain.length === 0) return `${tag} · ${d.selector}`;

  const breadcrumb = [...c.chain]
    .reverse()
    .map((entry) => (entry.file ? `${entry.name} (${entry.file})` : entry.name))
    .join(" › ");

  if (d.sourceLoc) {
    const l = d.sourceLoc;
    return `${breadcrumb} › ${tag} ${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
  }
  return `${breadcrumb} › ${tag}`;
}
```

- [ ] **Step 4: Run the test file to confirm it passes**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(client): add formatElementPathFromRoot for the root-mount path mode"
```

---

### Task 3: `path-mode-store.ts`

**Files:**

- Create: `src/client/path-mode-store.ts`
- Test: `tests/unit/path-mode-store.test.ts`

**Interfaces:**

- Consumes: nothing (standalone, mirrors `src/client/target-store.ts`).
- Produces: `export type PathMode = "tree" | "root"`, `export function loadPathMode(): PathMode`, `export function savePathMode(mode: PathMode): void`.

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/path-mode-store.test.ts`:

```ts
// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPathMode, savePathMode } from "../../src/client/path-mode-store";

const MODE_KEY = "thisone:path-mode";

describe("path-mode-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to tree mode when nothing was saved (empty)", () => {
    expect(loadPathMode()).toBe("tree");
  });

  it("round-trips the root mode", () => {
    savePathMode("root");
    expect(loadPathMode()).toBe("root");
  });

  it("round-trips back to tree mode", () => {
    savePathMode("root");
    savePathMode("tree");
    expect(loadPathMode()).toBe("tree");
  });

  it("falls back to tree for a malformed stored value (malformed-input)", () => {
    localStorage.setItem(MODE_KEY, "diagonal");
    expect(loadPathMode()).toBe("tree");
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePathMode("root")).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and defaults to tree when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadPathMode()).not.toThrow();
    expect(loadPathMode()).toBe("tree");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run tests/unit/path-mode-store.test.ts`
Expected: FAIL — module `src/client/path-mode-store.ts` does not exist.

- [ ] **Step 3: Implement `src/client/path-mode-store.ts`**

```ts
export type PathMode = "tree" | "root";

const MODE_KEY = "thisone:path-mode";

export function loadPathMode(): PathMode {
  try {
    return localStorage.getItem(MODE_KEY) === "root" ? "root" : "tree";
  } catch {
    return "tree";
  }
}

export function savePathMode(mode: PathMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm exec vitest run tests/unit/path-mode-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/path-mode-store.ts tests/unit/path-mode-store.test.ts
git commit -m "feat(client): add path-mode-store for persisting the path display mode"
```

---

### Task 4: Wire the toggle into the overlay panel

**Files:**

- Modify: `src/client/overlay.ts`
- Test: `tests/unit/overlay.test.ts`

**Interfaces:**

- Consumes: `formatElementPathFromRoot` (Task 2), `loadPathMode`/`savePathMode`/`PathMode` (Task 3).
- Produces: no new exports — internal UI wiring only. New DOM: `.path-row` (wraps `.path` + `.path-mode-toggle`), `.path-mode-toggle` button.

- [ ] **Step 1: Update the two existing tests that rely on `.path`'s sibling `.status`**

`.path` moves inside a new `.path-row` wrapper, so `.path + .status` no longer matches — the status div is now a sibling of `.path-row`, not of `.path`. In `tests/unit/overlay.test.ts`, change both occurrences of `.path + .status` to `.path-row + .status`:

```ts
it("clicking the path copies it and shows a success status", async () => {
  vi.spyOn(clipboard, "copyText").mockResolvedValue({ ok: true });
  const o = createOverlay();
  const target = document.createElement("div");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  pathEl().dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(shadow().querySelector(".path-row + .status")?.textContent).toBe(
    "Copied",
  );
  o.destroy();
});
```

```ts
it("shows a failure status when copying the path fails", async () => {
  vi.spyOn(clipboard, "copyText").mockResolvedValue({ ok: false });
  const o = createOverlay();
  const target = document.createElement("div");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  pathEl().dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(shadow().querySelector(".path-row + .status")?.textContent).toBe(
    "Copy failed",
  );
  o.destroy();
});
```

- [ ] **Step 2: Add the new toggle tests**

Add a `pathModeToggle()` helper near the existing `pathEl()`/`img()` helpers at the top of `tests/unit/overlay.test.ts`:

```ts
function pathModeToggle() {
  return shadow().querySelector(".path-mode-toggle") as HTMLElement;
}
```

Append these tests to the `describe("overlay", ...)` block:

```ts
it("defaults to file-tree path mode with an inactive toggle", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  expect(pathModeToggle().classList.contains("active")).toBe(false);
  expect(pathModeToggle().title).toBe("Show path from root component");
  o.destroy();
});

it("clicking the mode toggle switches to the root-mount path for the same selection", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  const before = pathEl().textContent;

  pathModeToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(pathModeToggle().classList.contains("active")).toBe(true);
  expect(pathModeToggle().title).toBe("Show file-tree path");
  expect(pathEl().textContent).not.toBe(before);
  o.destroy();
});

it("clicking the mode toggle does not also trigger the path's copy handler (no bubbling)", async () => {
  vi.spyOn(clipboard, "copyText").mockResolvedValue({ ok: true });
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  pathModeToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await tick();
  expect(shadow().querySelector(".path-row + .status")?.textContent).toBe("");
  o.destroy();
});

it("path mode persists across a fresh overlay instance", async () => {
  const o1 = createOverlay();
  const target1 = document.createElement("button");
  document.body.appendChild(target1);
  o1.open();
  target1.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  pathModeToggle().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  o1.destroy();

  const o2 = createOverlay();
  const target2 = document.createElement("span");
  document.body.appendChild(target2);
  o2.open();
  target2.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(pathModeToggle().classList.contains("active")).toBe(true);
  o2.destroy();
});
```

- [ ] **Step 3: Run the test file to confirm the new/changed assertions fail**

Run: `pnpm exec vitest run tests/unit/overlay.test.ts`
Expected: FAIL — `.path-mode-toggle` doesn't exist yet, `.path-row` doesn't exist yet.

- [ ] **Step 4: Add imports to `src/client/overlay.ts`**

```ts
import {
  resolveComponent,
  formatElementPath,
  formatElementPathFromRoot,
} from "./resolve-component";
import { captureElementScreenshot } from "./screenshot";
import { copyText, copyImage } from "./clipboard";
import { loadPosition, savePosition, type Position } from "./position-store";
import {
  loadTargetEnabled,
  saveTargetEnabled,
  loadTargetPosition,
  saveTargetPosition,
  type Edge,
  type TargetPosition,
} from "./target-store";
import { loadPathMode, savePathMode, type PathMode } from "./path-mode-store";
```

- [ ] **Step 5: Add CSS for the new elements in the `STYLE` template literal**

Insert right after the existing `.path:hover { border-color: #89b4fa; }` rule:

```css
.path-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.path-mode-toggle {
  cursor: pointer;
  border: 1px solid #585b70;
  background: #11111b;
  color: #a6adc8;
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.path-mode-toggle:hover {
  background: #313244;
  color: #eee;
  border-color: #89b4fa;
}
.path-mode-toggle.active {
  color: #89b4fa;
  border-color: #89b4fa;
  background: rgba(137, 180, 250, 0.12);
}
.path-mode-toggle.active:hover {
  background: #313244;
}
```

And add `flex: 1; min-width: 0;` to the existing `.path { ... }` rule so it shares the row with the toggle button instead of forcing it to wrap:

```css
.path {
  cursor: pointer;
  word-break: break-all;
  padding: 6px;
  border-radius: 6px;
  background: #11111b;
  border: 1px solid #45475a;
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 6: Add the two new icon functions next to `pinIcon`/`targetIcon`**

```ts
function folderIcon(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>`;
}

function branchIcon(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M12 7v4M12 11L6 17M12 11l6 6"/></svg>`;
}
```

- [ ] **Step 7: Add the `pathMode` closure variable and load it in `ensureMounted()`**

Add near the other `let` declarations (next to `let targetEnabled = false;`):

```ts
let pathMode: PathMode = "tree";
```

In `ensureMounted()`, right after `targetEnabled = loadTargetEnabled();`:

```ts
targetEnabled = loadTargetEnabled();
pathMode = loadPathMode();
```

- [ ] **Step 8: Rewrite the path section of `renderSelection()`**

Replace:

```ts
const pathText = formatElementPath(target);
const pathEl = el("div", "path");
pathEl.textContent = pathText;
const pathStatus = el("div", "status");
pathEl.addEventListener("click", () => {
  void copyText(pathText).then((r) => showStatus(pathStatus, r.ok));
});

const imgStatus = el("div", "status");
body.append(pathEl, pathStatus);
```

with:

```ts
const pathRow = el("div", "path-row");
const pathEl = el("div", "path");
const modeToggle = el("button", "path-mode-toggle");
const pathStatus = el("div", "status");

function currentPathText(): string {
  return pathMode === "tree"
    ? formatElementPath(target)
    : formatElementPathFromRoot(target);
}

function renderPathText(): void {
  pathEl.textContent = currentPathText();
  modeToggle.innerHTML = pathMode === "tree" ? folderIcon(14) : branchIcon(14);
  modeToggle.classList.toggle("active", pathMode === "root");
  modeToggle.title =
    pathMode === "tree"
      ? "Show path from root component"
      : "Show file-tree path";
}
renderPathText();

pathEl.addEventListener("click", () => {
  void copyText(currentPathText()).then((r) => showStatus(pathStatus, r.ok));
});
modeToggle.addEventListener("click", (ev) => {
  ev.stopPropagation();
  pathMode = pathMode === "tree" ? "root" : "tree";
  savePathMode(pathMode);
  renderPathText();
});

pathRow.append(pathEl, modeToggle);
const imgStatus = el("div", "status");
body.append(pathRow, pathStatus);
```

- [ ] **Step 9: Run the overlay test file to confirm everything passes**

Run: `pnpm exec vitest run tests/unit/overlay.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full unit suite**

Run: `pnpm test:run`
Expected: PASS, no regressions in other files.

- [ ] **Step 11: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat(overlay): add a toggle for the root-mount path display mode"
```

---

## Final verification (after all tasks)

- [ ] Run `pnpm test:run` — full suite green.
- [ ] Run `pnpm exec tsc --noEmit` — no type errors.
- [ ] Manual smoke check per `references/verify-done.md`'s frontend recipe: build the demo app (`examples/demo-app`), open the picker overlay, pick a nested element (e.g. inside `Counter.vue`), confirm the file-tree path shows by default, click the new toggle, confirm the root-mount breadcrumb appears and matches the format from the spec, click again to confirm it flips back, reload the page and confirm the last-chosen mode is still active.
- [ ] Confirm `CLAUDE.md`'s release rule is satisfied by the pre-commit hook (patch bump + `dist/` rebuild) since this is a behavior change to the client bundle, or bump manually with `pnpm release minor` before the final commit if the hook's auto-bump doesn't fire for some reason — this is a new feature (not just a bug fix), so a minor bump is the correct default per that rule.
