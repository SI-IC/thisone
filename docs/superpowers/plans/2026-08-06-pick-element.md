# vite-plugin-pick-element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the feedback-queue pipeline (bridge/MCP/claude-plugin) with a standalone `vite-plugin-pick-element`: Alt+C picks a DOM element, shows its component path (with source line numbers) and a screenshot, click either to copy to the clipboard.

**Architecture:** Purely client-side Vite plugin. `src/plugin/index.ts` keeps the existing `.vue` transform (`injectSourceLocations`) and HTML injection, minus all bridge/HTTP/WS wiring. `src/client/overlay.ts` owns all UI: hotkey, hover/pick, panel render, screenshot, clipboard, drag+persist. Everything server-side (`src/server/**`), the CC-plugin (`claude-plugin/**`), and the marketplace manifest (`.claude-plugin/**`) are deleted.

**Tech Stack:** TypeScript, Vite plugin API, esbuild (bundling), vitest + happy-dom (unit tests), Playwright (e2e), `modern-screenshot` (client-side DOM→canvas capture).

## Global Constraints

- Package renamed to `vite-plugin-pick-element` (was `vite-plugin-claude-feedback`).
- No server, no MCP, no Claude Code integration — GitHub install only, no npm-registry publish.
- Screenshot library: `modern-screenshot@^4.7.0` (latest as of 2026-08-06 — re-check `npm view modern-screenshot version` if this plan is executed later).
- Path text format: `<tag> · ComponentName · file:startLine:startCol-endLine:endCol`, falling back per the spec's edge-case table (see `docs/superpowers/specs/2026-08-06-pick-element-design.md`).
- Screenshot padding: 30px of real surrounding page content on each side (`PADDING_PX = 30`), clamped to viewport bounds.
- Window position persists to `localStorage['pick-element:pos']`.
- Every task that touches `.ts`/`.mjs` files must leave `pnpm build` and the affected `pnpm test:run` suites green before moving on — this repo's tests double as regression coverage for a public GitHub-installed package.

---

### Task 1: Screenshot capture module

**Files:**

- Create: `src/client/screenshot.ts`
- Test: `tests/unit/screenshot.test.ts`
- Modify: `package.json` (add `modern-screenshot` dependency)

**Interfaces:**

- Produces: `PADDING_PX: number`, `paddedCropRect(rect: DOMRect, padding: number, bounds: {width:number; height:number}): CropRect`, `cropCanvas(source: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement`, `captureElementScreenshot(el: Element): Promise<Blob>` — all exported from `src/client/screenshot.ts`. `CropRect = {x:number; y:number; width:number; height:number}`.

- [ ] **Step 1: Add the `modern-screenshot` dependency**

```bash
pnpm add modern-screenshot@^4.7.0
```

- [ ] **Step 2: Write the failing tests for `paddedCropRect`**

```typescript
// tests/unit/screenshot.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  paddedCropRect,
  cropCanvas,
  PADDING_PX,
} from "../../src/client/screenshot";

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect;
}

describe("paddedCropRect", () => {
  it("pads a rect by PADDING_PX on each side", () => {
    const r = paddedCropRect(rect(50, 50, 150, 120), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r).toEqual({ x: 20, y: 20, width: 130, height: 100 });
  });

  it("clamps padding at the top-left bounds edge (boundary)", () => {
    const r = paddedCropRect(rect(10, 5, 60, 40), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(90); // 60+30 - 0
    expect(r.height).toBe(70); // 40+30 - 0
  });

  it("clamps padding at the bottom-right bounds edge (boundary)", () => {
    const r = paddedCropRect(rect(900, 900, 990, 990), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r.width).toBe(100); // 1000 - (900-30)
    expect(r.height).toBe(100);
  });

  it("returns a zero-size rect when the element itself is empty (empty)", () => {
    const r = paddedCropRect(rect(500, 500, 500, 500), 0, {
      width: 1000,
      height: 1000,
    });
    expect(r).toEqual({ x: 500, y: 500, width: 0, height: 0 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/screenshot.test.ts`
Expected: FAIL — `../../src/client/screenshot` has no exported member `paddedCropRect` (module doesn't exist yet).

- [ ] **Step 4: Write `paddedCropRect` and the module skeleton**

```typescript
// src/client/screenshot.ts
// Element screenshot: render the viewport with modern-screenshot, then crop to
// the element's rect padded by PADDING_PX of real surrounding page content.
import { domToCanvas } from "modern-screenshot";

export const PADDING_PX = 30;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `rect` padded by `padding` on each side, clamped to a `bounds`-sized canvas. */
export function paddedCropRect(
  rect: DOMRect,
  padding: number,
  bounds: { width: number; height: number },
): CropRect {
  const x = Math.max(0, rect.left - padding);
  const y = Math.max(0, rect.top - padding);
  const right = Math.min(bounds.width, rect.right + padding);
  const bottom = Math.min(bounds.height, rect.bottom + padding);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Crop `source` to `rect`, returning a new canvas sized exactly to `rect`. */
export function cropCanvas(
  source: HTMLCanvasElement,
  rect: CropRect,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width));
  out.height = Math.max(1, Math.round(rect.height));
  const ctx = out.getContext("2d")!;
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

/** Screenshot `el` with PADDING_PX of real surrounding page content, as a PNG blob. */
export async function captureElementScreenshot(el: Element): Promise<Blob> {
  const full = await domToCanvas(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const rect = paddedCropRect(el.getBoundingClientRect(), PADDING_PX, {
    width: full.width,
    height: full.height,
  });
  const cropped = cropCanvas(full, rect);
  return new Promise((resolvePromise, reject) => {
    cropped.toBlob((blob) => {
      if (blob) resolvePromise(blob);
      else reject(new Error("toBlob returned null"));
    }, "image/png");
  });
}
```

- [ ] **Step 5: Run tests to verify `paddedCropRect` passes**

Run: `pnpm vitest run tests/unit/screenshot.test.ts`
Expected: `paddedCropRect` tests PASS, `cropCanvas` tests still don't exist yet.

- [ ] **Step 6: Write the failing tests for `cropCanvas`**

```typescript
// append to tests/unit/screenshot.test.ts
describe("cropCanvas", () => {
  it("draws the cropped region onto a new canvas sized to the rect", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as any);
    const source = document.createElement("canvas");

    const out = cropCanvas(source, { x: 10, y: 20, width: 100, height: 50 });

    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    expect(drawImage).toHaveBeenCalledWith(
      source,
      10,
      20,
      100,
      50,
      0,
      0,
      100,
      50,
    );
    vi.restoreAllMocks();
  });

  it("floors output size at 1px for a zero-size crop rect (empty)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as any);
    const source = document.createElement("canvas");

    const out = cropCanvas(source, { x: 0, y: 0, width: 0, height: 0 });

    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 7: Run tests, verify pass**

Run: `pnpm vitest run tests/unit/screenshot.test.ts`
Expected: all PASS (6 tests: 4 `paddedCropRect` + 2 `cropCanvas`).

- [ ] **Step 8: Verify the `modern-screenshot` import resolves for `captureElementScreenshot`**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no type errors. If `domToCanvas`'s actual option names differ from `{width, height}` per its shipped `.d.ts`, adjust `captureElementScreenshot` to match — this function has no unit test (it needs a real browser to render), so type-checking is the only automated guard at this stage; it gets exercised for real in Task 10's e2e test.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/client/screenshot.ts tests/unit/screenshot.test.ts
git commit -m "feat(client): add element screenshot capture (crop-to-rect + padding)"
```

---

### Task 2: Path-text formatter

**Files:**

- Modify: `src/client/resolve-component.ts` (append `formatElementPath`)
- Test: `tests/unit/resolve-component.test.ts` (append `describe("formatElementPath")`)

**Interfaces:**

- Consumes: `describeElement(el: Element): ElementDescriptor`, `resolveComponent(el: Element | null): ResolvedComponent | null` — both already exported from this file.
- Produces: `formatElementPath(el: Element): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to tests/unit/resolve-component.test.ts
import { formatElementPath } from "../../src/client/resolve-component";

describe("formatElementPath", () => {
  it("formats tag, component name, and source line/column range", () => {
    document.body.innerHTML =
      '<div data-src-loc="/proj/src/components/Counter.vue:12:3-14:9"></div>';
    const el = document.querySelector("div")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/components/Counter.vue", name: "Counter" },
      parent: null,
    };
    expect(formatElementPath(el)).toBe(
      "<div> · Counter · /proj/src/components/Counter.vue:12:3-14:9",
    );
  });

  it("omits line numbers when data-src-loc is absent (no sourceLoc)", () => {
    document.body.innerHTML = "<span></span>";
    const el = document.querySelector("span")!;
    (el as any).__vueParentComponent = {
      type: { __file: "/proj/src/Widget.vue", name: "Widget" },
      parent: null,
    };
    expect(formatElementPath(el)).toBe(
      "<span> · Widget (/proj/src/Widget.vue)",
    );
  });

  it("omits the file suffix when the component has no __file", () => {
    document.body.innerHTML = "<i></i>";
    const el = document.querySelector("i")!;
    (el as any).__vueParentComponent = { type: { name: "Anon" }, parent: null };
    expect(formatElementPath(el)).toBe("<i> · Anon");
  });

  it("falls back to the CSS selector outside the Vue app (no component)", () => {
    document.body.innerHTML = '<main><button id="go"></button></main>';
    const el = document.getElementById("go")!;
    expect(formatElementPath(el)).toBe("<button> · #go");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/resolve-component.test.ts`
Expected: FAIL — `formatElementPath` is not exported.

- [ ] **Step 3: Implement `formatElementPath`**

```typescript
// append to src/client/resolve-component.ts
/** `<tag> · ComponentName · file:startLine:startCol-endLine:endCol` for the
 *  copy/display path text — degrades per the design's fallback table when
 *  sourceLoc or the component itself is unavailable. */
export function formatElementPath(el: Element): string {
  const d = describeElement(el);
  const c = resolveComponent(el);
  const tag = `<${d.tag}>`;
  if (!c) return `${tag} · ${d.selector}`;
  if (d.sourceLoc) {
    const l = d.sourceLoc;
    return `${tag} · ${c.name} · ${l.file}:${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
  }
  return c.file ? `${tag} · ${c.name} (${c.file})` : `${tag} · ${c.name}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/resolve-component.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(client): add formatElementPath for the pick-element path text"
```

---

### Task 3: Window position persistence

**Files:**

- Create: `src/client/position-store.ts`
- Test: `tests/unit/position-store.test.ts`

**Interfaces:**

- Produces: `interface Position { x: number; y: number }`, `loadPosition(): Position | null`, `savePosition(pos: Position): void`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/position-store.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPosition, savePosition } from "../../src/client/position-store";

const KEY = "pick-element:pos";

describe("position-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved (empty)", () => {
    expect(loadPosition()).toBeNull();
  });

  it("round-trips a saved position", () => {
    savePosition({ x: 42, y: 7 });
    expect(loadPosition()).toEqual({ x: 42, y: 7 });
  });

  it("returns null for malformed JSON (hostile input)", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPosition()).toBeNull();
  });

  it("returns null when x/y are missing or non-numeric (malformed)", () => {
    localStorage.setItem(KEY, JSON.stringify({ x: "42", y: 7 }));
    expect(loadPosition()).toBeNull();
  });

  it("savePosition does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePosition({ x: 1, y: 1 })).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/position-store.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `position-store.ts`**

```typescript
// src/client/position-store.ts
// Persists the pick-element panel's dragged position across page loads.
const KEY = "pick-element:pos";

export interface Position {
  x: number;
  y: number;
}

export function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePosition(pos: Position): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pos));
  } catch {
    // storage unavailable (private mode, quota) — drag still works this session
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/position-store.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/position-store.ts tests/unit/position-store.test.ts
git commit -m "feat(client): add localStorage-backed panel position persistence"
```

---

### Task 4: Clipboard helpers

**Files:**

- Create: `src/client/clipboard.ts`
- Test: `tests/unit/clipboard.test.ts`

**Interfaces:**

- Produces: `interface CopyResult { ok: boolean }`, `copyText(text: string): Promise<CopyResult>`, `copyImage(blob: Blob): Promise<CopyResult>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/clipboard.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, copyImage } from "../../src/client/clipboard";

function stubClipboard(impl: Partial<Clipboard>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
  });
}

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  // @ts-expect-error test-only global cleanup
  delete globalThis.ClipboardItem;
});

describe("copyText", () => {
  it("writes the text and resolves ok:true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const r = await copyText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(r).toEqual({ ok: true });
  });

  it("resolves ok:false when the browser denies permission (external-failure)", async () => {
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    expect(await copyText("hello")).toEqual({ ok: false });
  });

  it("resolves ok:false when clipboard is unavailable (insecure context / old browser)", async () => {
    stubClipboard({} as Clipboard);
    expect(await copyText("hello")).toEqual({ ok: false });
  });
});

describe("copyImage", () => {
  it("writes a ClipboardItem for the blob and resolves ok:true", async () => {
    // @ts-expect-error test-only global
    globalThis.ClipboardItem = FakeClipboardItem;
    const write = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write });
    const blob = new Blob(["x"], { type: "image/png" });

    const r = await copyImage(blob);

    expect(r).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as FakeClipboardItem;
    expect(item.data["image/png"]).toBe(blob);
  });

  it("resolves ok:false when ClipboardItem is unsupported (old browser)", async () => {
    stubClipboard({ write: vi.fn() });
    const blob = new Blob(["x"], { type: "image/png" });
    expect(await copyImage(blob)).toEqual({ ok: false });
  });

  it("resolves ok:false when the write rejects (external-failure)", async () => {
    // @ts-expect-error test-only global
    globalThis.ClipboardItem = FakeClipboardItem;
    stubClipboard({ write: vi.fn().mockRejectedValue(new Error("denied")) });
    const blob = new Blob(["x"], { type: "image/png" });
    expect(await copyImage(blob)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/clipboard.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `clipboard.ts`**

```typescript
// src/client/clipboard.ts
// Thin wrappers around the Clipboard API that never throw — callers just
// branch on `ok` to show "Copied" / "Failed to copy".
export interface CopyResult {
  ok: boolean;
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!navigator.clipboard?.writeText) return { ok: false };
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function copyImage(blob: Blob): Promise<CopyResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { ok: false };
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/clipboard.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/clipboard.ts tests/unit/clipboard.test.ts
git commit -m "feat(client): add clipboard text/image copy helpers"
```

---

### Task 5: Rewrite the overlay (pick, panel, copy, drag)

**Files:**

- Modify: `src/client/overlay.ts` (full rewrite)
- Modify: `tests/unit/overlay.test.ts` (full rewrite)

**Interfaces:**

- Consumes: `resolveComponent`, `describeElement`, `formatElementPath` from `./resolve-component`; `captureElementScreenshot` from `./screenshot`; `copyText`, `copyImage` from `./clipboard`; `loadPosition`, `savePosition`, `Position` from `./position-store`.
- Produces: `HOST_ID: string`, `interface Overlay { open(): void; close(): void; isOpen(): boolean; destroy(): void }`, `createOverlay(): Overlay`. Note the shrunk surface vs. the old overlay: no `send`/`getConsole`/`tabId`/`onPick` deps, no `isPicking`/`startPick`/`cancelPick`/`lastEl` on the returned object — picking is always-on while the panel is open.

- [ ] **Step 1: Write the failing tests (full replacement of the old file)**

```typescript
// tests/unit/overlay.test.ts (replaces the old bridge/textarea-based suite)
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOverlay, HOST_ID } from "../../src/client/overlay";
import * as screenshot from "../../src/client/screenshot";
import * as clipboard from "../../src/client/clipboard";

function shadow() {
  return document.getElementById(HOST_ID)!.shadowRoot!;
}
function panel() {
  return shadow().querySelector(".panel") as HTMLElement;
}
function pathEl() {
  return shadow().querySelector(".path") as HTMLElement;
}
function img() {
  return shadow().querySelector("img.shot") as HTMLImageElement;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.spyOn(screenshot, "captureElementScreenshot").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
  // happy-dom has no real object URL implementation
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("overlay", () => {
  it("mounts a shadow-rooted panel on open and is idempotent", () => {
    const o = createOverlay();
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    expect(panel().classList.contains("hidden")).toBe(false);
    expect(o.isOpen()).toBe(true);

    o.open(); // second Alt+C — must not create a second host
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    o.destroy();
  });

  it("shows the empty-state hint before anything is picked", () => {
    const o = createOverlay();
    o.open();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /pick an element/i,
    );
    o.destroy();
  });

  it("picking an element renders its path and screenshot", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    target.textContent = "Click me";
    document.body.appendChild(target);

    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(pathEl().textContent).toMatch(/<button>/);
    expect(img().src).toBe("blob:fake");
    o.destroy();
  });

  it("clicking a different element while open replaces the selection", async () => {
    const o = createOverlay();
    const a = document.createElement("button");
    const b = document.createElement("span");
    document.body.append(a, b);

    o.open();
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await tick();
    expect(pathEl().textContent).toMatch(/<button>/);

    b.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await tick();
    expect(pathEl().textContent).toMatch(/<span>/);
    o.destroy();
  });

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
    expect(shadow().querySelector(".path + .status")?.textContent).toBe(
      "Copied",
    );
    o.destroy();
  });

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
    expect(shadow().querySelector(".path + .status")?.textContent).toBe(
      "Failed to copy",
    );
    o.destroy();
  });

  it("clicking the image copies it and shows a success status", async () => {
    vi.spyOn(clipboard, "copyImage").mockResolvedValue({ ok: true });
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    img().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(shadow().querySelector("img.shot + .status")?.textContent).toBe(
      "Copied",
    );
    o.destroy();
  });

  it("shows a screenshot-failure message when capture rejects", async () => {
    vi.spyOn(screenshot, "captureElementScreenshot").mockRejectedValue(
      new Error("boom"),
    );
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(shadow().querySelector("img.shot")).toBeNull();
    expect(pathEl().textContent).toMatch(/<div>/); // path still rendered/clickable
    o.destroy();
  });

  it("ignores picker clicks on its own panel (composedPath includes host)", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    const before = pathEl().textContent;

    panel().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(pathEl().textContent).toBe(before);
    o.destroy();
  });

  it("closes on Escape", () => {
    const o = createOverlay();
    o.open();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(o.isOpen()).toBe(false);
    o.destroy();
  });

  it("closes on the × button", () => {
    const o = createOverlay();
    o.open();
    (shadow().querySelector(".close") as HTMLElement).click();
    expect(o.isOpen()).toBe(false);
    o.destroy();
  });

  it("restores a persisted position on open", () => {
    localStorage.setItem("pick-element:pos", JSON.stringify({ x: 123, y: 45 }));
    const o = createOverlay();
    o.open();
    expect(panel().style.left).toBe("123px");
    expect(panel().style.top).toBe("45px");
    o.destroy();
  });

  it("falls back to a default position when nothing is persisted (empty)", () => {
    const o = createOverlay();
    o.open();
    expect(panel().style.left).not.toBe("");
    expect(panel().style.top).not.toBe("");
    o.destroy();
  });

  it("destroy removes the host from the document", () => {
    const o = createOverlay();
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    o.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: FAIL — old `overlay.ts` has a different exported shape (`send`/`onPick`/textarea) and no `.path`/`.hint`/`img.shot` markup.

- [ ] **Step 3: Rewrite `src/client/overlay.ts`**

```typescript
// src/client/overlay.ts
// The pick-element overlay: Alt+C opens a small draggable panel; picking a DOM
// element shows its component path (with source line numbers) and a
// screenshot, each click-to-copy. No server, no network — everything happens
// in the page. Native DOM only — no Vue — so it can't conflict with the host
// app's framework or styles.

import { resolveComponent, formatElementPath } from "./resolve-component";
import { captureElementScreenshot } from "./screenshot";
import { copyText, copyImage } from "./clipboard";
import { loadPosition, savePosition, type Position } from "./position-store";

export const HOST_ID = "__pick_element_root";

export interface Overlay {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
.panel {
  position: fixed; width: 340px; z-index: 2147483646;
  background: #1e1e2e; color: #eee; border: 1px solid #444; border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); font-size: 13px; overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; cursor: move; background: #181825; user-select: none;
}
.title { font-weight: 600; font-size: 13px; }
.close {
  cursor: pointer; border: none; background: transparent; color: #a6adc8;
  font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.close:hover { background: #313244; color: #eee; }
.body { padding: 12px; }
.hint { color: #a6adc8; }
.path {
  cursor: pointer; word-break: break-all; padding: 6px; border-radius: 6px;
  background: #11111b; border: 1px solid #45475a;
}
.path:hover { border-color: #89b4fa; }
img.shot {
  display: block; max-width: 100%; margin-top: 8px; cursor: pointer;
  border: 1px solid #45475a; border-radius: 6px;
}
.status { font-size: 11px; color: #a6b8fa; min-height: 14px; margin-top: 4px; }
.status.fail { color: #f38ba8; }
.hidden { display: none !important; }
.pickhint {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
  background: #89b4fa; color: #11111b; padding: 6px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
}
.box {
  position: fixed; z-index: 2147483645; pointer-events: none;
  border: 2px solid #89b4fa; background: rgba(137,180,250,.12); border-radius: 3px;
}
.tip {
  position: fixed; z-index: 2147483647; pointer-events: none;
  background: #11111b; color: #89b4fa; border: 1px solid #89b4fa;
  padding: 2px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap;
}
`;

export function createOverlay(): Overlay {
  const doc = document;
  const win = window;
  let host: HTMLElement | null = null;
  let root: ShadowRoot;
  let panel: HTMLElement;
  let header: HTMLElement;
  let body: HTMLElement;
  let pickHint: HTMLElement;
  let box: HTMLElement;
  let tip: HTMLElement;

  let open = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let currentShotUrl: string | null = null;
  let dragOffset: { dx: number; dy: number } | null = null;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
  ): HTMLElementTagNameMap[K] {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function defaultPosition(): Position {
    return {
      x: Math.max(16, win.innerWidth - 356),
      y: Math.max(16, win.innerHeight - 200),
    };
  }

  function applyPosition(): void {
    const pos = loadPosition() ?? defaultPosition();
    panel.style.left = pos.x + "px";
    panel.style.top = pos.y + "px";
  }

  function ensureMounted(): void {
    if (host) return;
    host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement("div");
      host.id = HOST_ID;
      doc.body.appendChild(host);
    }
    root = host.attachShadow({ mode: "open" });

    const style = doc.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    panel = el("div", "panel hidden");
    header = el("div", "header");
    const title = el("span", "title");
    title.textContent = "Pick an element";
    const closeBtn = el("button", "close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => close());
    header.append(title, closeBtn);

    body = el("div", "body");

    panel.append(header, body);
    root.appendChild(panel);

    pickHint = el("div", "pickhint hidden");
    pickHint.textContent = "Click an element · Esc to close";
    box = el("div", "box hidden");
    tip = el("div", "tip hidden");
    root.append(pickHint, box, tip);

    header.addEventListener("mousedown", onDragStart);
    win.addEventListener("beforeunload", cancelPick);
  }

  // ---- body rendering --------------------------------------------------

  function renderEmpty(): void {
    body.innerHTML = "";
    const hint = el("div", "hint");
    hint.textContent = "Pick an element";
    body.appendChild(hint);
  }

  function showStatus(target: HTMLElement, ok: boolean): void {
    target.textContent = ok ? "Copied" : "Failed to copy";
    target.classList.toggle("fail", !ok);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      target.textContent = "";
      target.classList.remove("fail");
    }, 1500);
  }

  function renderSelection(target: Element): void {
    if (currentShotUrl) {
      URL.revokeObjectURL(currentShotUrl);
      currentShotUrl = null;
    }
    body.innerHTML = "";

    const pathText = formatElementPath(target);
    const pathEl = el("div", "path");
    pathEl.textContent = pathText;
    const pathStatus = el("div", "status");
    pathEl.addEventListener("click", () => {
      void copyText(pathText).then((r) => showStatus(pathStatus, r.ok));
    });

    const imgStatus = el("div", "status");
    body.append(pathEl, pathStatus);

    captureElementScreenshot(target)
      .then((blob) => {
        const img = el("img", "shot");
        img.alt = "screenshot";
        currentShotUrl = URL.createObjectURL(blob);
        img.src = currentShotUrl;
        img.addEventListener("click", () => {
          void copyImage(blob).then((r) => showStatus(imgStatus, r.ok));
        });
        body.append(img, imgStatus);
      })
      .catch(() => {
        imgStatus.textContent = "Failed to capture screenshot";
        imgStatus.classList.add("fail");
        body.append(imgStatus);
      });
  }

  // ---- picking -----------------------------------------------------------

  function pathHasHost(ev: Event): boolean {
    const path = (ev.composedPath?.() ?? []) as EventTarget[];
    return host ? path.includes(host) : false;
  }

  function targetUnder(ev: MouseEvent): Element | null {
    const path = (ev.composedPath?.() ?? []) as EventTarget[];
    for (const t of path) {
      if (t instanceof Element && t !== host) return t;
    }
    return ev.target instanceof Element ? ev.target : null;
  }

  function onMove(ev: MouseEvent): void {
    if (pathHasHost(ev)) {
      box.classList.add("hidden");
      tip.classList.add("hidden");
      return;
    }
    const t = targetUnder(ev);
    if (!t) return;
    const r = t.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.classList.remove("hidden");
    const c = resolveComponent(t);
    tip.textContent = c ? c.name : t.tagName.toLowerCase();
    tip.style.left = r.left + "px";
    tip.style.top = Math.max(0, r.top - 20) + "px";
    tip.classList.remove("hidden");
  }

  function onClick(ev: MouseEvent): void {
    if (pathHasHost(ev)) return; // clicks on our own UI are never picks
    ev.preventDefault();
    ev.stopPropagation();
    const t = targetUnder(ev);
    if (!t) return;
    renderSelection(t);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  }

  function startPick(): void {
    pickHint.classList.remove("hidden");
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
  }

  function cancelPick(): void {
    pickHint.classList.add("hidden");
    box.classList.add("hidden");
    tip.classList.add("hidden");
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
  }

  // ---- drag ----------------------------------------------------------------

  function onDragStart(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList?.contains("close")) return;
    const r = panel.getBoundingClientRect();
    dragOffset = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    win.addEventListener("mousemove", onDragMove);
    win.addEventListener("mouseup", onDragEnd);
  }

  function onDragMove(ev: MouseEvent): void {
    if (!dragOffset) return;
    panel.style.left = ev.clientX - dragOffset.dx + "px";
    panel.style.top = ev.clientY - dragOffset.dy + "px";
  }

  function onDragEnd(): void {
    if (!dragOffset) return;
    dragOffset = null;
    win.removeEventListener("mousemove", onDragMove);
    win.removeEventListener("mouseup", onDragEnd);
    savePosition({
      x: parseFloat(panel.style.left) || 0,
      y: parseFloat(panel.style.top) || 0,
    });
  }

  // ---- open/close ------------------------------------------------------------

  function openModal(): void {
    ensureMounted();
    if (open) return; // Alt+C while open is a no-op (never spawn a second panel)
    open = true;
    panel.classList.remove("hidden");
    applyPosition();
    renderEmpty();
    startPick();
  }

  function close(): void {
    if (!host || !open) return;
    cancelPick();
    open = false;
    panel.classList.add("hidden");
    if (currentShotUrl) {
      URL.revokeObjectURL(currentShotUrl);
      currentShotUrl = null;
    }
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    destroy: () => {
      cancelPick();
      win.removeEventListener("beforeunload", cancelPick);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      open = false;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat(client): rewrite overlay as pick+path+screenshot+copy+drag panel"
```

---

### Task 6: Slim down the plugin entry and client bootstrap

**Files:**

- Modify: `src/client/index.ts`
- Modify: `src/plugin/index.ts`
- Modify: `tests/unit/plugin-transform.test.ts` (drop the `configureServer`/bridge cases, keep transform + HTML-injection cases)

**Interfaces:**

- Consumes: `createOverlay` from `./overlay` (client), `injectSourceLocations` from `./inject-src-loc.js` (plugin) — both already produced.
- Produces: `pickElement(options?: PickElementOptions): Plugin` and `default pickElement` from `src/plugin/index.ts`; `interface PickElementOptions { hotkey?: string }`.

- [ ] **Step 1: Rewrite `src/client/index.ts`**

```typescript
// src/client/index.ts
// Overlay bootstrap — the entry esbuild bundles into dist/client.js and the
// Vite plugin inlines into dev pages. Binds the Alt+C hotkey and mounts the
// overlay. Runs exactly once per document.

import { createOverlay } from "./overlay";

interface PickElementConfig {
  hotkey?: string;
}

declare global {
  interface Window {
    __PICK_ELEMENT_CFG__?: PickElementConfig;
    __pick_element_booted__?: boolean;
  }
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__pick_element_booted__) return;
  window.__pick_element_booted__ = true;

  const cfg = window.__PICK_ELEMENT_CFG__ ?? {};
  const hotkey = cfg.hotkey ?? "KeyC";
  const overlay = createOverlay();

  // Capture phase so the app can't swallow the hotkey first.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && e.code === hotkey && !e.repeat) {
        e.preventDefault();
        overlay.open();
      }
    },
    true,
  );
}

boot();
```

- [ ] **Step 2: Rewrite `src/plugin/index.ts`**

```typescript
// src/plugin/index.ts
// Vite plugin entry: inlines the client overlay bundle into every dev page and
// stamps `.vue` templates with `data-src-loc` so the overlay can show source
// line numbers. Disabled for production builds — no server, no network.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { injectSourceLocations } from "./inject-src-loc.js";

export interface PickElementOptions {
  /** Hotkey code that opens the picker together with Alt (default 'KeyC'). */
  hotkey?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Locate the built client bundle whether running from dist/ or src/ (tests). */
function loadClientBundle(): string {
  const candidates = [
    resolve(here, "client.js"), // bundled: dist/index.js → dist/client.js
    resolve(here, "../../dist/client.js"), // src/plugin/index.ts → dist/client.js
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(
    "[pick-element] dist/client.js not found — run `pnpm build` first.",
  );
}

export function pickElement(options: PickElementOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const cfgJson = JSON.stringify({ hotkey });

  let isBuild = false;

  return {
    name: "vite-plugin-pick-element",
    apply: "serve",
    enforce: "pre",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    transform(code: string, id: string) {
      if (isBuild || !id.endsWith(".vue")) return;
      return injectSourceLocations(code, id);
    },

    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        if (isBuild) return html;
        const client = loadClientBundle();
        return {
          html,
          tags: [
            {
              tag: "script",
              injectTo: "body" as const,
              children: `window.__PICK_ELEMENT_CFG__=${cfgJson};\n${client}`,
            },
          ],
        };
      },
    },
  };
}

export default pickElement;
```

- [ ] **Step 3: Trim `tests/unit/plugin-transform.test.ts`**

Read the current file first (`tests/unit/plugin-transform.test.ts`) and remove every test/import tied to `configureServer`, the bridge, or `bridge.json` (the `createServer`/`http.Server` smoke block and its imports). Keep and adapt the `transformIndexHtml` injection tests and the `.vue` transform-gating tests, updating:

- the import from `claudeFeedback` to `pickElement` (`import pickElement from "../../src/plugin/index";`),
- any assertions on `window.__CLAUDE_FEEDBACK_CFG__` to `window.__PICK_ELEMENT_CFG__`,
- any assertions on the plugin's `name` field to `"vite-plugin-pick-element"`.

The resulting file should only exercise: `isBuild` gating (`config()` + `transform()` no-ops during `vite build`), `.vue` transform delegating to `injectSourceLocations`, and `transformIndexHtml` injecting the config + client bundle script tag into dev HTML.

- [ ] **Step 4: Run the plugin tests**

Run: `pnpm build && pnpm vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS (the plugin test loads the real `dist/client.js`, so `pnpm build` must run first).

- [ ] **Step 5: Run the full unit suite to check nothing else broke**

Run: `pnpm test:run`
Expected: `tests/unit/bridge.test.ts`, `queue.test.ts`, `ws-client.test.ts`, `snapshot.test.ts`, `redact.test.ts`, `console-tap.test.ts`, `safe-stringify.test.ts` now FAIL (they import files this task didn't touch yet — `src/client/index.ts` and `src/plugin/index.ts` no longer import them, but the files themselves and their tests still exist). This is expected — Task 7 deletes them. Confirm the _only_ failures are in those seven files; anything else failing is a real regression to fix now.

- [ ] **Step 6: Commit**

```bash
git add src/client/index.ts src/plugin/index.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): drop bridge wiring, slim plugin/client entries to pick-element"
```

---

### Task 7: Delete the server/bridge/queue/console-tap/ws-client/snapshot/redact layer

**Files:**

- Delete: `src/server/bridge.ts`, `src/server/queue.ts`, `src/server/types.ts`
- Delete: `src/client/ws-client.ts`, `src/client/snapshot.ts`, `src/client/redact.ts`, `src/client/console-tap.ts`, `src/client/safe-stringify.ts`
- Delete: `tests/unit/bridge.test.ts`, `tests/unit/queue.test.ts`, `tests/unit/ws-client.test.ts`, `tests/unit/snapshot.test.ts`, `tests/unit/redact.test.ts`, `tests/unit/console-tap.test.ts`, `tests/unit/safe-stringify.test.ts`
- Delete: `tests/smoke/bridge-smoke.mjs`, `tests/smoke/overlay-smoke.mjs`, `tests/smoke/dev-app/` (directory)
- Modify: `package.json` (drop `ws`, `@types/ws` — grep first to confirm nothing else imports `ws`)

**Interfaces:** none — this task only removes code no longer referenced after Task 6.

- [ ] **Step 1: Confirm nothing still imports the files about to be deleted**

Run:

```bash
grep -rln "src/server\|from \"../server\|from \"./ws-client\|from \"./snapshot\|from \"./redact\|from \"./console-tap\|from \"./safe-stringify" src/ tests/unit tests/e2e
```

Expected: only the test files being deleted in this task show up (each test importing its own subject module). If any _other_ file appears, stop and investigate before deleting — Task 6 was supposed to have removed every non-test consumer.

- [ ] **Step 2: Delete the dead source and test files**

```bash
git rm src/server/bridge.ts src/server/queue.ts src/server/types.ts
git rm src/client/ws-client.ts src/client/snapshot.ts src/client/redact.ts src/client/console-tap.ts src/client/safe-stringify.ts
git rm tests/unit/bridge.test.ts tests/unit/queue.test.ts tests/unit/ws-client.test.ts tests/unit/snapshot.test.ts tests/unit/redact.test.ts tests/unit/console-tap.test.ts tests/unit/safe-stringify.test.ts
git rm tests/smoke/bridge-smoke.mjs tests/smoke/overlay-smoke.mjs
git rm -r tests/smoke/dev-app
rmdir src/server 2>/dev/null || true
```

- [ ] **Step 3: Confirm `ws` has no remaining consumer, then drop it**

Run: `grep -rln '"ws"\|from "ws"' src/ scripts/ tests/`
Expected: no hits. Then remove the `ws` and `@types/ws` devDependencies from `package.json`'s `devDependencies` block.

```bash
pnpm remove ws @types/ws
```

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm test:run`
Expected: PASS — the only remaining failures should be the MCP/wire/marketplace tests, which Task 8 deletes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete the bridge/queue/console-tap/ws-client/snapshot/redact layer"
```

---

### Task 8: Remove the CC-plugin/marketplace/MCP layer and simplify release tooling

**Files:**

- Delete: `claude-plugin/` (entire directory)
- Delete: `.claude-plugin/` (entire directory, repo root)
- Delete: `tests/unit/mcp-server.test.mjs`, `tests/unit/mcp-tools.test.mjs`, `tests/unit/mcp-bridge-client.test.mjs`, `tests/unit/vite-config-patch.test.mjs`, `tests/unit/wire-detect.test.mjs`, `tests/unit/wire-update.test.mjs`
- Delete: `tests/smoke/mcp-smoke.mjs`, `tests/smoke/wire-smoke.mjs`
- Delete: `scripts/check-versions.mjs`, `scripts/version-sync.mjs`
- Modify: `scripts/build.mjs` (drop the MCP-server bundling step)
- Modify: `scripts/release.mjs` (bump `package.json` only, no manifest sync)
- Modify: `.husky/pre-commit` (trigger on `src/` only, no manifest staging)
- Modify: `package.json` (rename package, drop `@modelcontextprotocol/sdk` dependency, drop `claude-plugin` from `files`, drop `check:versions` script, add `modern-screenshot` if not already present from Task 1, update `description`)

**Interfaces:** none — pure deletion/simplification, no code outside this task depends on any of it.

- [ ] **Step 1: Delete the CC-plugin, marketplace, and their tests**

```bash
git rm -r claude-plugin
git rm -r .claude-plugin
git rm tests/unit/mcp-server.test.mjs tests/unit/mcp-tools.test.mjs tests/unit/mcp-bridge-client.test.mjs tests/unit/vite-config-patch.test.mjs tests/unit/wire-detect.test.mjs tests/unit/wire-update.test.mjs
git rm tests/smoke/mcp-smoke.mjs tests/smoke/wire-smoke.mjs
```

- [ ] **Step 2: Simplify `scripts/build.mjs`**

Read the current file, then remove the entire `(c)` block that bundles `claude-plugin/mcp-server.mjs` into `claude-plugin/mcp-server.bundled.mjs` (including its `@modelcontextprotocol/sdk` bare-specifier check), and change the final `dts` cleanup loop from `for (const dir of ["plugin", "server", "client"])` to a single `rmSync(resolve(dist, "plugin"), { recursive: true, force: true });` (there is no `dist/server` or `dist/client` `.d.ts` output any more — `src/server` is gone and the client bundle was never part of the tsc program). Update the final `console.log` to `"build ok: dist/{index.js,client.js,index.d.ts}"`.

Also drop the `banner` option from the plugin `esbuild.build()` call (the `createRequire` shim existed only because the old plugin bundled `ws`; `src/plugin/index.ts` no longer imports it after Task 6).

- [ ] **Step 3: Rewrite `scripts/release.mjs`**

```javascript
#!/usr/bin/env node
// Bump the package.json version (patch|minor|major).
// Usage: node scripts/release.mjs <patch|minor|major>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = resolve(ROOT, "package.json");

const LEVELS = new Set(["patch", "minor", "major"]);
const level = process.argv[2];

if (!LEVELS.has(level)) {
  console.error(`release: unknown bump "${level ?? ""}"`);
  console.error("usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) {
    console.error(`release: cannot parse version "${version}"`);
    process.exit(1);
  }
  let [major, minor, patch] = m.slice(1).map(Number);
  if (kind === "major") ((major += 1), (minor = 0), (patch = 0));
  else if (kind === "minor") ((minor += 1), (patch = 0));
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const next = bump(pkg.version, level);
pkg.version = next;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(`release: bumped to ${next} (${level})`);
```

- [ ] **Step 4: Delete `scripts/check-versions.mjs` and `scripts/version-sync.mjs`**

```bash
git rm scripts/check-versions.mjs scripts/version-sync.mjs
```

- [ ] **Step 5: Rewrite `.husky/pre-commit`**

```bash
#!/usr/bin/env bash
# Auto-versioning: when plugin/client code is staged, bump the patch version
# once per commit and rebuild dist/. The hook only STAGES — it never commits —
# so it cannot loop.
set -e

staged="$(git diff --cached --name-only)"
if ! printf '%s\n' "$staged" | grep -qE '^src/'; then
  exit 0
fi

head_ver="$(git show HEAD:package.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||""))}catch{process.stdout.write("")}})' || true)"
work_ver="$(node -p "require('./package.json').version")"

if [ "$head_ver" = "$work_ver" ]; then
  # Version not yet bumped in this commit -> bump patch.
  node scripts/release.mjs patch
fi

pnpm build

git add dist package.json
```

- [ ] **Step 6: Update `package.json`**

Rewrite `package.json` to:

```json
{
  "name": "vite-plugin-pick-element",
  "version": "0.0.12",
  "description": "Pick a DOM element in a Vue+Vite dev preview (Alt+C) and copy its component path or a screenshot to the clipboard.",
  "type": "module",
  "license": "MIT",
  "author": "SI-IC",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/SI-IC/vue-pick-problem-skill.git"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "src"],
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest",
    "test:run": "vitest run --passWithNoTests",
    "release": "node scripts/release.mjs",
    "prepare": "husky"
  },
  "peerDependencies": {
    "vite": ">=5"
  },
  "devDependencies": {
    "@types/node": "24.12.2",
    "@vitejs/plugin-vue": "6.0.3",
    "esbuild": "0.27.2",
    "happy-dom": "20.6.1",
    "husky": "9.1.7",
    "playwright": "^1.62.1",
    "prettier": "^3.9.6",
    "typescript": "5.9.3",
    "vite": "7.3.1",
    "vitest": "4.0.18"
  },
  "packageManager": "pnpm@10.33.0",
  "dependencies": {
    "@vue/compiler-core": "^3.5.41",
    "@vue/compiler-sfc": "^3.5.41",
    "modern-screenshot": "^4.7.0"
  }
}
```

(Keep whatever exact `devDependencies`/`dependencies` versions are actually present in the working tree at this point — Task 1 already added `modern-screenshot`, and pnpm may have nudged other version strings; this block is the target _shape_, not a byte-for-byte diff. Run `pnpm remove @modelcontextprotocol/sdk` if it's still listed.)

- [ ] **Step 7: Reinstall and rebuild**

```bash
pnpm install
pnpm build
```

Expected: no errors; `dist/` now contains only `index.js`, `client.js`, `index.d.ts` (no `mcp-server.bundled.mjs` regenerated — delete it if it's still on disk from a previous build: `rm -f claude-plugin/mcp-server.bundled.mjs`, though `claude-plugin/` itself is already deleted in Step 1).

- [ ] **Step 8: Run the full test suite**

Run: `pnpm test:run`
Expected: all remaining tests PASS (no more MCP/wire/marketplace/bridge/queue tests exist).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: remove CC-plugin/marketplace/MCP layer, simplify release tooling, rename package"
```

---

### Task 9: Rewrite README.md

**Files:**

- Modify: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Rewrite the README**

Replace the full content of `README.md` with:

```markdown
# vite-plugin-pick-element

Pick a DOM element in a live Vue 3 + Vite dev preview and copy its **component path** (tag,
component name, source file:line:col-line:col) or a **screenshot** straight to your clipboard.
No server, no network, no external integration — everything happens in the page.

## Install
```

pnpm add -D github:SI-IC/vue-pick-problem-skill

````

(No npm-registry publish — install straight from GitHub. The built `dist/` is committed to the
repo, so no build toolchain is required on install.)

Add it to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import pickElement from "vite-plugin-pick-element";

export default defineConfig({
  plugins: [vue(), pickElement()],
});
````

`pickElement({ hotkey: "KeyC" })` — override the hotkey code that combines with **Alt** to open
the picker (default `KeyC`, i.e. **Alt+C**).

## Usage

1. Run your Vue+Vite dev server and open the preview.
2. Press **Alt+C** — a small panel opens: "Pick an element".
3. Click any element on the page. The panel shows its path (tag, Vue component name, and the
   source file:line:col-line:col when resolvable) and a screenshot of the element with 30px of
   real surrounding page content padded on each side.
4. Click the path text to copy it, or the screenshot to copy the PNG — either shows "Copied"
   next to what you clicked.
5. Click a different element while the panel is open to replace the selection. Drag the panel by
   its header to reposition it — the position is remembered (`localStorage`) across reloads.
6. Close with the **×** button or **Escape**.

The plugin is disabled for production builds (`vite build`) — nothing it injects ships to users.

See `docs/superpowers/specs/2026-08-06-pick-element-design.md` for the full design.

## Development

```
pnpm install
pnpm build        # -> dist/{index.js, client.js, index.d.ts}
pnpm test:run     # unit tests
bash scripts/e2e.sh   # full e2e against examples/demo-app (see tests/e2e/README.md)
```

Versioning is automatic: a husky `pre-commit` hook bumps the patch version, rebuilds `dist/`, and
stages it when `src/` changes; a `post-commit` hook tags `v<version>`. For a larger bump run
`pnpm release minor` (or `major`) before committing.

## License

MIT

````

- [ ] **Step 2: Grep for stale references the rewrite might have missed**

Run: `grep -in "bridge\|claude-plugin\|marketplace\|mcp\|claude feedback\|claude-feedback" README.md`
Expected: no output (aside from the design-doc filename, which is intentionally historical).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the pick-element redesign"
````

---

### Task 10: Rewrite the e2e test and demo app wiring

**Files:**

- Modify: `examples/demo-app/package.json` (dependency name + rename)
- Modify: `examples/demo-app/vite.config.ts`
- Modify: `examples/demo-app/index.html`, `examples/demo-app/src/App.vue` (cosmetic rename only)
- Delete: `tests/e2e/feedback.e2e.mjs`
- Create: `tests/e2e/pick-element.e2e.mjs`
- Modify: `tests/e2e/README.md`
- Modify: `scripts/e2e.sh`

**Interfaces:** none — this is the top-level black-box test; it consumes the built `dist/client.js` + `dist/index.js` via the demo app's `link:../..` dependency, no direct source imports.

- [ ] **Step 1: Update the demo app's plugin wiring**

`examples/demo-app/package.json` — rename the devDependency:

```json
    "vite-plugin-pick-element": "link:../.."
```

(remove the old `"vite-plugin-claude-feedback": "link:../.."` line; keep everything else)

`examples/demo-app/vite.config.ts`:

```typescript
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import pickElement from "vite-plugin-pick-element";

export default defineConfig({
  plugins: [vue(), pickElement()],
});
```

`examples/demo-app/index.html` — change `<title>claude-feedback demo</title>` to `<title>pick-element demo</title>`.

`examples/demo-app/src/App.vue` — change `<h1>claude-feedback demo</h1>` to `<h1>pick-element demo</h1>`.

- [ ] **Step 2: Reinstall the demo app's link dependency**

```bash
cd examples/demo-app && pnpm install && cd ../..
```

- [ ] **Step 3: Delete the old e2e test and write the new one**

```bash
git rm tests/e2e/feedback.e2e.mjs
```

```javascript
// tests/e2e/pick-element.e2e.mjs
#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app");

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0, "usage: pick-element.e2e.mjs <port>");
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
    return execFileSync("grep", ["-rl", pattern, dir], { encoding: "utf8" }).trim();
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
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

  const panel = page.locator("#__pick_element_root >> css=.panel");
  const pathEl = page.locator("#__pick_element_root >> css=.path");
  const img = page.locator("#__pick_element_root >> css=img.shot");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  await check("panel opens on Alt+C in pick mode", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
    await page
      .locator("#__pick_element_root >> css=.pickhint")
      .waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator('button:has-text("count is")').click();
  await check("picking an element shows its path with component + line numbers", async () => {
    await pathEl.waitFor({ state: "visible", timeout: 2000 });
    const text = await pathEl.textContent();
    assert.match(text ?? "", /<button>/);
    assert.match(text ?? "", /Counter/);
    assert.match(text ?? "", /Counter\.vue:8:\d+-10:\d+/);
  });
  await check("picking an element renders a screenshot", async () => {
    await img.waitFor({ state: "visible", timeout: 5000 });
    const src = await img.getAttribute("src");
    assert.match(src ?? "", /^blob:/);
  });

  await check("clicking the path copies it to the clipboard", async () => {
    await pathEl.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /Counter\.vue:8:\d+-10:\d+/);
  });

  await check("clicking the screenshot copies a PNG to the clipboard", async () => {
    await img.click();
    const types = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items[0]?.types ?? [];
    });
    assert.ok(types.includes("image/png"));
  });

  await check(
    "edge:re-pick — clicking a different element while open replaces the selection",
    async () => {
      await page.locator("h1").click();
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.doesNotMatch(text ?? "", /button/);
    },
  );

  await check("Escape closes the panel", async () => {
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout: 2000 });
  });

  let storedBefore;
  await check(
    "edge:browser/UX — dragged position persists across reopen and reload",
    async () => {
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const header = page.locator("#__pick_element_root >> css=.header");
      const box = await header.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 150);
      await page.mouse.up();
      storedBefore = await page.evaluate(() => localStorage.getItem("pick-element:pos"));
      assert.ok(storedBefore, "position should be saved to localStorage");

      await page.reload({ waitUntil: "networkidle" });
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const restoredLeft = await panel.evaluate((elm) => elm.style.left);
      const stored = JSON.parse(storedBefore);
      assert.equal(restoredLeft, `${stored.x}px`);
    },
  );

  await check(
    "edge:malformed-input — corrupt localStorage falls back to a default position",
    async () => {
      await page.evaluate(() => localStorage.setItem("pick-element:pos", "not json"));
      await page.reload({ waitUntil: "networkidle" });
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const left = await panel.evaluate((elm) => elm.style.left);
      assert.notEqual(left, "");
    },
  );
} finally {
  await browser.close();
}

await check("prod build does not inject the overlay", async () => {
  execFileSync("node", [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: demoDir,
    stdio: "pipe",
  });
  const found = grepMatches("__pick_element", resolve(demoDir, "dist"));
  assert.equal(found, "");
  rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
});

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
```

- [ ] **Step 4: Update `scripts/e2e.sh`**

Change the final invocation line from `node tests/e2e/feedback.e2e.mjs "$port"` to
`node tests/e2e/pick-element.e2e.mjs "$port"`, and delete the now-irrelevant
`rm -rf "$demo/.claude-feedback"` line (no bridge queue directory exists any more).

- [ ] **Step 5: Update `tests/e2e/README.md`**

Rewrite its description to match the new flow (drop mentions of the bridge queue, Pinia store
snapshot, and WS reconnect — replace with: Alt+C, element picker resolving a real Vue component,
path + screenshot clipboard copy, drag position persistence). Keep the `link:` vs `file:` pnpm
explanation section verbatim — it's still accurate and still the reason the demo app must use
`link:../..`.

- [ ] **Step 6: Run the e2e suite**

Run: `npx playwright install chromium` (first time only), then `bash scripts/e2e.sh`
Expected: `e2e ok`, all `ok - ...` lines, exit 0.

- [ ] **Step 7: Commit**

```bash
git add examples/demo-app README.md tests/e2e scripts/e2e.sh
git commit -m "test(e2e): rewrite e2e for pick+path+screenshot+copy+drag flow"
```

---

### Task 11: Final verification pass

**Files:** none — verification only.

**Interfaces:** none.

- [ ] **Step 1: Full clean build + unit suite**

```bash
rm -rf dist node_modules/.cache
pnpm install
pnpm build
pnpm test:run
```

Expected: build succeeds, all unit tests PASS.

- [ ] **Step 2: Full e2e suite**

```bash
bash scripts/e2e.sh
```

Expected: `e2e ok`.

- [ ] **Step 3: Grep for leftover references to the removed feature set**

```bash
grep -rniE "claude[_-]?feedback|bridge\.json|modelcontextprotocol|marketplace|mcp[_-]server" \
  --include="*.ts" --include="*.mjs" --include="*.json" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=docs/superpowers .
```

Expected: no output. (`docs/superpowers/specs/2026-06-26-vite-plugin-claude-feedback-design.md`
and the plan/spec files under `docs/superpowers/` are intentionally historical and excluded.)

- [ ] **Step 4: Confirm `pnpm check:versions` is gone and the pre-commit hook still bumps correctly**

```bash
git diff --cached --stat  # should be empty going into this check
touch src/client/overlay.ts && git add src/client/overlay.ts
git commit -m "chore: touch overlay to verify version bump" --dry-run
git reset src/client/overlay.ts
git checkout -- src/client/overlay.ts
```

This is a dry-run sanity check, not a real commit — confirm the hook logic reads correctly by
eye if `--dry-run` doesn't exercise hooks in this git version (`git commit --dry-run` does not
run hooks; instead just re-read `.husky/pre-commit` from Task 8 Step 5 and confirm it references
only `src/` and `package.json`/`dist`, with no leftover `claude-plugin` or manifest paths).

- [ ] **Step 5: Report results to the user**

Summarize: build clean, unit + e2e suites green, no stale references. Note the final `dist/`
contents and confirm the package is ready for a GitHub install per the new README.

No commit for this task — it's verification-only. If anything failed, fix it in a follow-up
commit before considering the plan done.
