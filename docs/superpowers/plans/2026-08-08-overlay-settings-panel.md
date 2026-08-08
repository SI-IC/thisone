# Overlay Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the overlay panel title to "ThisOne", let the pick-mode hint be dragged horizontally with the right mouse button, and replace the ad-hoc path-mode toggle with a collapsible Settings panel (path-mode radio + screenshot on/off + padding), with section titles and a screenshot loading state.

**Architecture:** Three new small localStorage-backed store modules (`pickhint-store.ts`, `settings-store.ts`, `screenshot-store.ts`) following the existing `path-mode-store.ts` pattern, plus edits to `overlay.ts` (DOM structure, event wiring) and `screenshot.ts` (padding becomes a parameter, not just a constant).

**Tech Stack:** TypeScript, Vitest + happy-dom, no new dependencies.

## Global Constraints

- Store modules: try/catch around every `localStorage` call, defaults on parse/read failure, mirror the exact structure of `src/client/path-mode-store.ts` / `src/client/target-store.ts`.
- Panel title text: exactly `"ThisOne"`. Empty-state body hint (`renderEmpty`) stays `"Select an element"` — do not touch it.
- `pickHint` element keeps its current vertical position (`top: 12px`, fixed) — only horizontal (`left`) becomes draggable.
- Path-mode toggle button next to the path (`.path-mode-toggle` in `path-row`) is removed entirely; path mode is chosen only via the Settings radio group.
- Settings panel sits between `.header` and `.body` in the DOM, starts collapsed by default, and its own expanded/collapsed state persists in `localStorage`.
- Screenshot section defaults to enabled; default padding is `30` (matches current `PADDING_PX`).
- Loader text while capturing a screenshot: exactly `"Делаем скриншот"`.
- Section titles: exactly `"Path"` and `"Screenshot"`.
- Run `pnpm test:run` (vitest) after each task; keep it green before moving on.

---

### Task 1: `pickhint-store.ts` — persisted horizontal offset for the pick hint

**Files:**

- Create: `src/client/pickhint-store.ts`
- Test: `tests/unit/pickhint-store.test.ts`

**Interfaces:**

- Produces: `loadPickHintOffsetX(): number | null`, `savePickHintOffsetX(x: number): void`. Storage key: `"thisone:pickhint-x"`. `x` is an absolute `left` value in px (not clamped by the store — clamping to the current viewport happens in `overlay.ts`, since it depends on the live `innerWidth`/element width).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/pickhint-store.test.ts
// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPickHintOffsetX,
  savePickHintOffsetX,
} from "../../src/client/pickhint-store";

const KEY = "thisone:pickhint-x";

describe("pickhint-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved (empty)", () => {
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("round-trips a saved offset", () => {
    savePickHintOffsetX(123.5);
    expect(loadPickHintOffsetX()).toBe(123.5);
  });

  it("returns null for malformed JSON (hostile input)", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("returns null for a non-numeric stored value (malformed-input)", () => {
    localStorage.setItem(KEY, JSON.stringify("left"));
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("returns null for a NaN-producing value (malformed-input)", () => {
    localStorage.setItem(KEY, JSON.stringify(null));
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePickHintOffsetX(10)).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and returns null when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadPickHintOffsetX()).not.toThrow();
    expect(loadPickHintOffsetX()).toBeNull();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/pickhint-store.test.ts`
Expected: FAIL — `src/client/pickhint-store.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/client/pickhint-store.ts
const KEY = "thisone:pickhint-x";

export function loadPickHintOffsetX(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function savePickHintOffsetX(x: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(x));
  } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/pickhint-store.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/pickhint-store.ts tests/unit/pickhint-store.test.ts
git commit -m "feat: add pickhint-store for persisted horizontal pick-hint offset"
```

---

### Task 2: `settings-store.ts` — persisted expanded/collapsed state

**Files:**

- Create: `src/client/settings-store.ts`
- Test: `tests/unit/settings-store.test.ts`

**Interfaces:**

- Produces: `loadSettingsExpanded(): boolean` (default `false`), `saveSettingsExpanded(expanded: boolean): void`. Storage key: `"thisone:settings-expanded"`, same `"1"`/`"0"` string convention as `target-store.ts`'s `loadTargetEnabled`/`saveTargetEnabled`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/settings-store.test.ts
// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSettingsExpanded,
  saveSettingsExpanded,
} from "../../src/client/settings-store";

describe("settings-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to collapsed when nothing was saved (empty)", () => {
    expect(loadSettingsExpanded()).toBe(false);
  });

  it("round-trips the expanded flag", () => {
    saveSettingsExpanded(true);
    expect(loadSettingsExpanded()).toBe(true);
    saveSettingsExpanded(false);
    expect(loadSettingsExpanded()).toBe(false);
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveSettingsExpanded(true)).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and defaults to collapsed when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadSettingsExpanded()).not.toThrow();
    expect(loadSettingsExpanded()).toBe(false);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/settings-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/client/settings-store.ts
const KEY = "thisone:settings-expanded";

export function loadSettingsExpanded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSettingsExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(KEY, expanded ? "1" : "0");
  } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/settings-store.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/settings-store.ts tests/unit/settings-store.test.ts
git commit -m "feat: add settings-store for persisted Settings panel expand state"
```

---

### Task 3: `screenshot-store.ts` — persisted enabled flag + padding

**Files:**

- Create: `src/client/screenshot-store.ts`
- Test: `tests/unit/screenshot-store.test.ts`

**Interfaces:**

- Produces: `loadScreenshotEnabled(): boolean` (default `true`), `saveScreenshotEnabled(enabled: boolean): void`; `loadScreenshotPadding(): number` (default `30`), `saveScreenshotPadding(padding: number): void`. Storage keys: `"thisone:screenshot-enabled"` (`"1"`/`"0"`), `"thisone:screenshot-padding"` (JSON number). Non-finite or negative stored padding falls back to the default.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/screenshot-store.test.ts
// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadScreenshotEnabled,
  saveScreenshotEnabled,
  loadScreenshotPadding,
  saveScreenshotPadding,
} from "../../src/client/screenshot-store";

const PADDING_KEY = "thisone:screenshot-padding";

describe("screenshot-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults enabled to true when nothing was saved (empty)", () => {
    expect(loadScreenshotEnabled()).toBe(true);
  });

  it("round-trips the enabled flag", () => {
    saveScreenshotEnabled(false);
    expect(loadScreenshotEnabled()).toBe(false);
    saveScreenshotEnabled(true);
    expect(loadScreenshotEnabled()).toBe(true);
  });

  it("defaults padding to 30 when nothing was saved (empty)", () => {
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("round-trips a saved padding", () => {
    saveScreenshotPadding(50);
    expect(loadScreenshotPadding()).toBe(50);
  });

  it("falls back to the default for a negative padding (boundary)", () => {
    localStorage.setItem(PADDING_KEY, JSON.stringify(-5));
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("falls back to the default for a non-numeric padding (malformed-input)", () => {
    localStorage.setItem(PADDING_KEY, JSON.stringify("thirty"));
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("falls back to the default for malformed JSON (hostile input)", () => {
    localStorage.setItem(PADDING_KEY, "{not json");
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("accepts zero padding (boundary)", () => {
    saveScreenshotPadding(0);
    expect(loadScreenshotPadding()).toBe(0);
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveScreenshotEnabled(false)).not.toThrow();
    expect(() => saveScreenshotPadding(40)).not.toThrow();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/screenshot-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/client/screenshot-store.ts
const ENABLED_KEY = "thisone:screenshot-enabled";
const PADDING_KEY = "thisone:screenshot-padding";
const DEFAULT_PADDING = 30;

export function loadScreenshotEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function saveScreenshotEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
}

export function loadScreenshotPadding(): number {
  try {
    const raw = localStorage.getItem(PADDING_KEY);
    if (raw === null) return DEFAULT_PADDING;
    const parsed = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_PADDING;
  } catch {
    return DEFAULT_PADDING;
  }
}

export function saveScreenshotPadding(padding: number): void {
  try {
    localStorage.setItem(PADDING_KEY, JSON.stringify(padding));
  } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/screenshot-store.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client/screenshot-store.ts tests/unit/screenshot-store.test.ts
git commit -m "feat: add screenshot-store for persisted enabled flag and padding"
```

---

### Task 4: `screenshot.ts` — accept padding as a parameter

**Files:**

- Modify: `src/client/screenshot.ts:56-76` (the `captureElementScreenshot` signature and its use of `PADDING_PX`)
- Test: `tests/unit/screenshot.test.ts` (add one case; existing cases keep passing unchanged)

**Interfaces:**

- Consumes: nothing new.
- Produces: `captureElementScreenshot(el: Element, excludeRoot?: Node | null, padding?: number): Promise<Blob>` — `padding` defaults to the existing `PADDING_PX` constant (still exported, still `30`, still the store's default in Task 3).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/screenshot.test.ts` (new `describe` block, keep everything else in the file as-is):

```typescript
// add to the top imports:
import { captureElementScreenshot } from "../../src/client/screenshot";
import * as modernScreenshot from "modern-screenshot";

// add this describe block:
describe("captureElementScreenshot padding parameter", () => {
  it("uses a custom padding instead of PADDING_PX when provided", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1000;
    vi.spyOn(modernScreenshot, "domToCanvas").mockResolvedValue(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(["x"], { type: "image/png" }));
      },
    );
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 150,
      bottom: 150,
      width: 50,
      height: 50,
    } as DOMRect);

    const blob = await captureElementScreenshot(el, null, 0);

    expect(blob).toBeInstanceOf(Blob);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/screenshot.test.ts`
Expected: FAIL — `captureElementScreenshot` currently only accepts 2 args; TS will still compile it (extra arg ignored at runtime pre-fix isn't the point) — the real failure is the assertion step below once we check the crop uses the right padding. To make the test meaningfully fail pre-fix, assert the crop width instead of just "isInstanceOf": change the assertion to `expect(blob.size).toBeGreaterThan(0)` is too weak — instead assert on the `drawImage` call args captured via a fresh spy return, requiring padding to reach `paddedCropRect`. Use this stronger version instead of the one above:

```typescript
const drawImage = vi.fn();
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
  drawImage,
} as any);
// ...call captureElementScreenshot(el, null, 0) as above...
// with padding 0 the crop must equal the element rect exactly:
expect(drawImage).toHaveBeenCalledWith(canvas, 100, 100, 50, 50, 0, 0, 50, 50);
```

Full corrected test replaces the body above; expected pre-fix failure: `drawImage` called with `80, 80, 90, 90, 0, 0, 90, 90` (padded by the hardcoded 30) instead of the expected `100, 100, 50, 50, ...`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/client/screenshot.ts — replace the captureElementScreenshot function
export async function captureElementScreenshot(
  el: Element,
  excludeRoot?: Node | null,
  padding: number = PADDING_PX,
): Promise<Blob> {
  const full = await domToCanvas(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
    // Do not change, because restoreScrollPosition:false desyncs the canvas from getBoundingClientRect() on scroll
    features: { restoreScrollPosition: true },
    filter: excludeRoot ? (node) => node !== excludeRoot : undefined,
  });
  const rect = paddedCropRect(el.getBoundingClientRect(), padding, {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/screenshot.test.ts`
Expected: PASS (all existing + new test)

- [ ] **Step 5: Commit**

```bash
git add src/client/screenshot.ts tests/unit/screenshot.test.ts
git commit -m "feat: let captureElementScreenshot take padding as a parameter"
```

---

### Task 5: `overlay.ts` — rename title to "ThisOne"

**Files:**

- Modify: `src/client/overlay.ts:205` (`title.textContent = "Select an element";`)
- Modify: `tests/unit/overlay.test.ts` (no test currently asserts the title text — add one)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/overlay.test.ts`, near the "mounts a shadow-rooted panel" test:

```typescript
it("shows ThisOne as the panel title", () => {
  const o = createOverlay();
  o.open();
  expect(shadow().querySelector(".title")?.textContent).toBe("ThisOne");
  o.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "shows ThisOne"`
Expected: FAIL — actual text is `"Select an element"`.

- [ ] **Step 3: Write minimal implementation**

In `src/client/overlay.ts`, change line 205:

```typescript
title.textContent = "ThisOne";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "shows ThisOne"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat: rename overlay panel title to ThisOne"
```

---

### Task 6: `overlay.ts` — Settings panel skeleton (collapsible, empty body)

**Files:**

- Modify: `src/client/overlay.ts` (`STYLE` constant, `ensureMounted`)
- Modify: `tests/unit/overlay.test.ts`

**Interfaces:**

- Consumes: `loadSettingsExpanded`, `saveSettingsExpanded` from `./settings-store` (Task 2).
- Produces DOM: `.settings` (container, sits between `.header` and `.body`), `.settings-header` (clickable row, contains `.settings-arrow` and text "Settings"), `.settings-body` (content, `hidden` class toggled by clicking `.settings-header`; starts with the class present/absent matching `loadSettingsExpanded()`).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/overlay.test.ts`:

```typescript
function settingsHeader() {
  return shadow().querySelector(".settings-header") as HTMLElement;
}
function settingsBody() {
  return shadow().querySelector(".settings-body") as HTMLElement;
}

it("Settings panel starts collapsed and expands on click, persisting the state", () => {
  const o = createOverlay();
  o.open();
  expect(settingsBody().classList.contains("hidden")).toBe(true);

  settingsHeader().click();
  expect(settingsBody().classList.contains("hidden")).toBe(false);
  expect(localStorage.getItem("thisone:settings-expanded")).toBe("1");
  o.destroy();

  const o2 = createOverlay();
  o2.open();
  expect(settingsBody().classList.contains("hidden")).toBe(false);
  o2.destroy();
});

it("the Settings panel sits between the header and the body", () => {
  const o = createOverlay();
  o.open();
  const children = Array.from(panel().children).map(
    (c) => c.className.split(" ")[0],
  );
  expect(children).toEqual(["header", "settings", "body"]);
  o.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "Settings panel"`
Expected: FAIL — `.settings-header`/`.settings-body` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

Add to `STYLE` in `src/client/overlay.ts` (after the `.body` rule):

```css
.settings {
  border-bottom: 1px solid #313244;
  font-size: 11px;
}
.settings-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  color: #a6adc8;
  user-select: none;
}
.settings-header:hover {
  color: #eee;
}
.settings-arrow {
  display: inline-flex;
  transition: transform 0.1s;
}
.settings-arrow.expanded {
  transform: rotate(90deg);
}
.settings-body {
  padding: 0 10px 8px;
}
.settings-body.hidden {
  display: none !important;
}
```

In `ensureMounted`, replace `panel.append(header, body);` with the Settings block built between them:

```typescript
const settings = el("div", "settings");
const settingsHeader = el("div", "settings-header");
const settingsArrow = el("span", "settings-arrow");
settingsArrow.textContent = "▸";
const settingsLabel = el("span");
settingsLabel.textContent = "Settings";
settingsHeader.append(settingsArrow, settingsLabel);
const settingsBody = el("div", "settings-body");
settings.append(settingsHeader, settingsBody);

const settingsExpanded = loadSettingsExpanded();
settingsBody.classList.toggle("hidden", !settingsExpanded);
settingsArrow.classList.toggle("expanded", settingsExpanded);
settingsHeader.addEventListener("click", () => {
  const expanded = settingsBody.classList.contains("hidden");
  settingsBody.classList.toggle("hidden", !expanded);
  settingsArrow.classList.toggle("expanded", expanded);
  saveSettingsExpanded(expanded);
});

panel.append(header, settings, body);
```

Add the import at the top of the file:

```typescript
import { loadSettingsExpanded, saveSettingsExpanded } from "./settings-store";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "Settings panel"` and `-t "sits between"`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat: add collapsible Settings panel skeleton to overlay"
```

---

### Task 7: `overlay.ts` — path-mode radio group in Settings, remove the old toggle

**Files:**

- Modify: `src/client/overlay.ts` (`STYLE`, `ensureMounted`, `renderSelection`)
- Modify: `tests/unit/overlay.test.ts` (replace the 4 tests that reference `.path-mode-toggle`)

**Interfaces:**

- Consumes: `loadPathMode`, `savePathMode`, `PathMode` (already imported from `./path-mode-store`).
- Produces DOM: inside `.settings-body`, a `.setting-group` containing a `.setting-title` ("Path mode") and two `.radio-row` (`tree`, `root`), each with a native `<input type="radio" name="path-mode">`, a label, and a `.qmark` "?" span carrying a `title` tooltip with the mode's explanation. Selecting a radio updates the module-level `pathMode` and re-renders the current selection if one is picked.
- The existing `.path-mode-toggle` button and its click handler are deleted from `renderSelection`; `renderPathText` no longer touches `modeToggle`.

- [ ] **Step 1: Write the failing test**

Replace these 4 existing tests in `tests/unit/overlay.test.ts` (`"defaults to file-tree path mode with an inactive toggle"`, `"clicking the mode toggle switches to the root-mount path for the same selection"`, `"clicking the mode toggle does not also trigger the path's copy handler (no bubbling)"`, `"path mode persists across a fresh overlay instance"`) and remove the `pathModeToggle()` helper, replacing all of it with:

```typescript
function pathModeRadio(mode: "tree" | "root") {
  return shadow().querySelector(
    `input[name="path-mode"][value="${mode}"]`,
  ) as HTMLInputElement;
}

it("defaults to file-tree path mode selected in Settings", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  expect(pathModeRadio("tree").checked).toBe(true);
  expect(pathModeRadio("root").checked).toBe(false);
  o.destroy();
});

it("selecting the root-mount radio switches the path for the same selection", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  (target as any).__vueParentComponent = {
    type: { __file: "/src/components/Counter.vue", name: "Counter" },
    parent: {
      type: { __file: "/src/App.vue", name: "App" },
      parent: null,
    },
  };
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  const before = pathEl().textContent;

  pathModeRadio("root").click();
  await tick();
  expect(pathModeRadio("root").checked).toBe(true);
  expect(pathEl().textContent).not.toBe(before);
  expect(pathEl().textContent).toMatch(/App .*Counter/);
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
  pathModeRadio("root").click();
  o1.destroy();

  const o2 = createOverlay();
  const target2 = document.createElement("span");
  document.body.appendChild(target2);
  o2.open();
  target2.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(pathModeRadio("root").checked).toBe(true);
  o2.destroy();
});

it("no .path-mode-toggle button remains next to the path", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(shadow().querySelector(".path-mode-toggle")).toBeNull();
  o.destroy();
});

it("each path-mode radio has a question-mark tooltip explaining it", () => {
  const o = createOverlay();
  o.open();
  const qmarks = shadow().querySelectorAll(".setting-group .radio-row .qmark");
  expect(qmarks).toHaveLength(2);
  expect((qmarks[0] as HTMLElement).title.length).toBeGreaterThan(0);
  expect((qmarks[1] as HTMLElement).title.length).toBeGreaterThan(0);
  o.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "path mode"` (and the two new standalone tests by name)
Expected: FAIL — no `input[name="path-mode"]` exists yet, and `.path-mode-toggle` still exists.

- [ ] **Step 3: Write minimal implementation**

Add to `STYLE`:

```css
.setting-group {
  margin-top: 8px;
}
.setting-group:first-child {
  margin-top: 0;
}
.setting-title {
  color: #cdd6f4;
  font-weight: 600;
  margin-bottom: 4px;
}
.radio-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
}
.radio-row label {
  cursor: pointer;
}
.qmark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid #585b70;
  color: #a6adc8;
  font-size: 9px;
  cursor: help;
  flex-shrink: 0;
}
```

In `ensureMounted`, after building `settingsBody` (Task 6) and before `panel.append(header, settings, body)`, add the path-mode group:

```typescript
const PATH_MODE_HELP: Record<PathMode, string> = {
  tree: "Show file-tree path",
  root: "Show path from root component",
};
const pathModeGroup = el("div", "setting-group");
const pathModeTitle = el("div", "setting-title");
pathModeTitle.textContent = "Path mode";
pathModeGroup.appendChild(pathModeTitle);
const pathModeRadios: Record<PathMode, HTMLInputElement> = {} as any;
(["tree", "root"] as PathMode[]).forEach((mode) => {
  const row = el("div", "radio-row");
  const input = el("input");
  input.type = "radio";
  input.name = "path-mode";
  input.value = mode;
  const id = `thisone-path-mode-${mode}`;
  input.id = id;
  const label = el("label");
  label.htmlFor = id;
  label.textContent = mode === "tree" ? "File tree" : "From root component";
  const qmark = el("span", "qmark");
  qmark.textContent = "?";
  qmark.title = PATH_MODE_HELP[mode];
  input.addEventListener("change", () => {
    pathMode = mode;
    savePathMode(pathMode);
    if (currentTarget) renderSelection(currentTarget);
  });
  pathModeRadios[mode] = input;
  row.append(input, label, qmark);
  pathModeGroup.appendChild(row);
});
settingsBody.appendChild(pathModeGroup);
```

Add a module-level `let currentTarget: Element | null = null;` near the other `let` declarations at the top of `createOverlay`, and set it at the start of `renderSelection`:

```typescript
  function renderSelection(target: Element): void {
    currentTarget = target;
    const myPickId = ++pickId;
    // ...unchanged...
```

Sync the radios whenever `pathMode` is loaded/changed — right after `pathMode = loadPathMode();` in `ensureMounted` (this runs after the radios are created above, so move the radio-building block to right before this sync, or add the sync call after both are in scope):

```typescript
pathModeRadios[pathMode].checked = true;
```

(Place this line directly after `pathMode = loadPathMode();` in `ensureMounted`, ensuring `pathModeRadios` has already been declared above it in the function body.)

In `renderSelection`, delete the `modeToggle` button entirely: remove its creation (`const modeToggle = el("button", "path-mode-toggle");`), remove its `innerHTML`/`title`/`active` updates from `renderPathText`, remove its `addEventListener("click", ...)` block, and remove it from `pathRow.append(pathEl, modeToggle)` — leaving:

```typescript
function renderPathText(): void {
  pathEl.textContent = currentPathText();
}
renderPathText();

pathEl.addEventListener("click", () => {
  void copyText(currentPathText()).then((r) => showStatus(pathStatus, r.ok));
});

pathRow.append(pathEl);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat: move path-mode selection into Settings as a radio group"
```

---

### Task 8: `overlay.ts` — screenshot enabled/padding settings + section titles + loader

**Files:**

- Modify: `src/client/overlay.ts` (`STYLE`, `ensureMounted`, `renderSelection`)
- Modify: `tests/unit/overlay.test.ts`

**Interfaces:**

- Consumes: `loadScreenshotEnabled`, `saveScreenshotEnabled`, `loadScreenshotPadding`, `saveScreenshotPadding` from `./screenshot-store` (Task 3); `captureElementScreenshot(target, host, padding)` (Task 4).
- Produces DOM: inside `.settings-body`, a second `.setting-group` ("Show element screenshot") with yes/no radios (`input[name="screenshot-enabled"]`) and a `.padding-row` (number input, id `thisone-padding`) shown only when screenshot is enabled. Inside `renderSelection`'s output: a `.section-title` "Path" before the path row, and — only when screenshots are enabled — a `.section-title` "Screenshot" followed by either `.shot-loading` (text "Делаем скриншот") or the `<img class="shot">`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/overlay.test.ts`:

```typescript
function screenshotRadio(value: "yes" | "no") {
  return shadow().querySelector(
    `input[name="screenshot-enabled"][value="${value}"]`,
  ) as HTMLInputElement;
}
function paddingInput() {
  return shadow().querySelector("#thisone-padding") as HTMLInputElement;
}
function shotLoading() {
  return shadow().querySelector(".shot-loading") as HTMLElement;
}
function sectionTitles() {
  return Array.from(shadow().querySelectorAll(".section-title")).map(
    (n) => n.textContent,
  );
}

it("shows Path and Screenshot section titles when a screenshot is picked", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(sectionTitles()).toEqual(["Path", "Screenshot"]);
  o.destroy();
});

it("shows a 'Делаем скриншот' loader before the image resolves", async () => {
  let resolveCapture!: (b: Blob) => void;
  vi.spyOn(screenshot, "captureElementScreenshot").mockReturnValue(
    new Promise((r) => (resolveCapture = r)),
  );
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();

  expect(shotLoading().textContent).toBe("Делаем скриншот");
  expect(shadow().querySelector("img.shot")).toBeNull();

  resolveCapture(new Blob(["x"], { type: "image/png" }));
  await tick();
  expect(shadow().querySelector(".shot-loading")).toBeNull();
  expect(img().src).toBe("blob:fake");
  o.destroy();
});

it("screenshot defaults to enabled with padding 30", () => {
  const o = createOverlay();
  o.open();
  expect(screenshotRadio("yes").checked).toBe(true);
  expect(screenshotRadio("no").checked).toBe(false);
  expect(paddingInput().value).toBe("30");
  o.destroy();
});

it("selecting 'no' hides the padding row and the screenshot section on the next pick", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();

  screenshotRadio("no").click();
  expect(
    paddingInput().offsetParent === null ||
      paddingInput().closest(".padding-row.hidden"),
  ).toBeTruthy();

  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(sectionTitles()).toEqual(["Path"]);
  expect(shadow().querySelector("img.shot")).toBeNull();
  expect(shadow().querySelector(".shot-loading")).toBeNull();
  o.destroy();
});

it("changing the padding is used on the next screenshot capture", async () => {
  const o = createOverlay();
  const target = document.createElement("button");
  document.body.appendChild(target);
  o.open();

  paddingInput().value = "50";
  paddingInput().dispatchEvent(new Event("change", { bubbles: true }));

  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
  await tick();
  expect(screenshot.captureElementScreenshot).toHaveBeenLastCalledWith(
    target,
    expect.anything(),
    50,
  );
  o.destroy();
});

it("screenshot enabled flag and padding persist across a fresh overlay instance", () => {
  const o1 = createOverlay();
  o1.open();
  screenshotRadio("no").click();
  paddingInput().value = "40";
  paddingInput().dispatchEvent(new Event("change", { bubbles: true }));
  o1.destroy();

  const o2 = createOverlay();
  o2.open();
  expect(screenshotRadio("no").checked).toBe(true);
  expect(paddingInput().value).toBe("40");
  o2.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: FAIL — none of `.section-title`, `.shot-loading`, `input[name="screenshot-enabled"]`, `#thisone-padding` exist yet.

- [ ] **Step 3: Write minimal implementation**

Add to `STYLE`:

```css
.section-title {
  color: #cdd6f4;
  font-weight: 600;
  margin-bottom: 4px;
}
.section-title:not(:first-child) {
  margin-top: 10px;
}
.padding-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px 18px;
}
.padding-row.hidden {
  display: none !important;
}
.padding-row input {
  width: 60px;
  background: #11111b;
  border: 1px solid #45475a;
  color: #eee;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
}
.shot-loading {
  color: #a6adc8;
  margin-top: 8px;
}
```

In `ensureMounted`, after the path-mode group (Task 7), add the screenshot group:

```typescript
const screenshotGroup = el("div", "setting-group");
const screenshotTitle = el("div", "setting-title");
screenshotTitle.textContent = "Show element screenshot";
screenshotGroup.appendChild(screenshotTitle);
const screenshotRadios: Record<"yes" | "no", HTMLInputElement> = {} as any;
const paddingRow = el("div", "padding-row");
const paddingInput = el("input");
(["yes", "no"] as const).forEach((value) => {
  const row = el("div", "radio-row");
  const input = el("input");
  input.type = "radio";
  input.name = "screenshot-enabled";
  input.value = value;
  const id = `thisone-screenshot-${value}`;
  input.id = id;
  const label = el("label");
  label.htmlFor = id;
  label.textContent = value === "yes" ? "Yes" : "No";
  input.addEventListener("change", () => {
    screenshotEnabled = value === "yes";
    saveScreenshotEnabled(screenshotEnabled);
    paddingRow.classList.toggle("hidden", !screenshotEnabled);
    if (currentTarget) renderSelection(currentTarget);
  });
  screenshotRadios[value] = input;
  row.append(input, label);
  screenshotGroup.appendChild(row);
});
const paddingLabel = el("label");
paddingLabel.htmlFor = "thisone-padding";
paddingLabel.textContent = "Padding, px";
paddingInput.type = "number";
paddingInput.id = "thisone-padding";
paddingInput.min = "0";
paddingInput.value = String(loadScreenshotPadding());
paddingInput.addEventListener("change", () => {
  const parsed = Number(paddingInput.value);
  screenshotPadding =
    Number.isFinite(parsed) && parsed >= 0 ? parsed : screenshotPadding;
  paddingInput.value = String(screenshotPadding);
  saveScreenshotPadding(screenshotPadding);
  if (currentTarget) renderSelection(currentTarget);
});
paddingRow.append(paddingLabel, paddingInput);
screenshotGroup.appendChild(paddingRow);
settingsBody.appendChild(screenshotGroup);

screenshotEnabled = loadScreenshotEnabled();
screenshotPadding = loadScreenshotPadding();
screenshotRadios[screenshotEnabled ? "yes" : "no"].checked = true;
paddingRow.classList.toggle("hidden", !screenshotEnabled);
```

Add `screenshotEnabled` and `screenshotPadding` to the module-level `let` declarations at the top of `createOverlay`:

```typescript
let screenshotEnabled = true;
let screenshotPadding = 30;
```

Add the import:

```typescript
import {
  loadScreenshotEnabled,
  saveScreenshotEnabled,
  loadScreenshotPadding,
  saveScreenshotPadding,
} from "./screenshot-store";
```

Rewrite `renderSelection`'s body-building tail (everything from the `pathRow.append(pathEl);` / `const imgStatus = ...` lines to the end of the function) to add the "Path" title, and to gate the screenshot section on `screenshotEnabled` with a loader:

```typescript
const pathTitle = el("div", "section-title");
pathTitle.textContent = "Path";
body.append(pathTitle, pathRow, pathStatus);

if (!screenshotEnabled) return;

const shotTitle = el("div", "section-title");
shotTitle.textContent = "Screenshot";
const loading = el("div", "shot-loading");
loading.textContent = "Делаем скриншот";
const imgStatus = el("div", "status");
body.append(shotTitle, loading);

captureElementScreenshot(target, host, screenshotPadding)
  .then((blob) => {
    if (myPickId !== pickId) return;
    loading.remove();
    const img = el("img", "shot");
    img.alt = "screenshot";
    const url = URL.createObjectURL(blob);
    replaceShotUrl(url);
    img.src = url;
    img.addEventListener("click", () => {
      void copyImage(blob).then((r) => showStatus(imgStatus, r.ok));
    });
    body.append(img, imgStatus);
  })
  .catch(() => {
    if (myPickId !== pickId) return;
    loading.remove();
    imgStatus.textContent = "Screenshot failed";
    imgStatus.classList.add("fail");
    body.append(imgStatus);
  });
```

(This replaces the previous unconditional `body.append(pathRow, pathStatus);` plus the trailing `captureElementScreenshot(target, host).then(...)` block — keep everything above `pathRow.append(pathEl);` from Task 7 unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: PASS (full file, all overlay tests including the pre-existing ones from Tasks 5–7)

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat: add screenshot enabled/padding settings, section titles, and capture loader"
```

---

### Task 9: `overlay.ts` — right-click horizontal drag for the pick hint

**Files:**

- Modify: `src/client/overlay.ts` (`STYLE`, `ensureMounted`)
- Modify: `tests/unit/overlay.test.ts`

**Interfaces:**

- Consumes: `loadPickHintOffsetX`, `savePickHintOffsetX` from `./pickhint-store` (Task 1).
- Behavior: mirrors `onTargetDragStart`/`onTargetDragMove`/`onTargetDragEnd` (right-button-only, `contextmenu` suppressed during drag) but applied to `pickHint`, constrained to `left` only (never touches `top`), clamped to `[0, innerWidth - pickHint.offsetWidth]`, re-clamped on `resize`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/overlay.test.ts`:

```typescript
function pickHint() {
  return shadow().querySelector(".pickhint") as HTMLElement;
}

it("pickHint has a tooltip explaining the right-click drag", () => {
  const o = createOverlay();
  o.open();
  expect(pickHint().title.length).toBeGreaterThan(0);
  o.destroy();
});

it("right-click-dragging the pick hint moves it horizontally within the viewport and persists (edge:browser/UX)", () => {
  const o = createOverlay();
  o.open();
  const hint = pickHint();
  hint.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 2,
      clientX: 400,
      clientY: 12,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 700, clientY: 12 }),
  );
  window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));

  expect(hint.style.top).toBe("");
  const left = parseFloat(hint.style.left);
  expect(left).toBeGreaterThan(0);
  const stored = JSON.parse(localStorage.getItem("thisone:pickhint-x")!);
  expect(stored).toBe(left);
  o.destroy();
});

it("edge:boundary — dragging the pick hint past the right edge clamps it inside the viewport", () => {
  const o = createOverlay();
  o.open();
  const hint = pickHint();
  hint.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 2,
      clientX: 400,
      clientY: 12,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 100000, clientY: 12 }),
  );
  window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));

  const left = parseFloat(hint.style.left);
  expect(left + hint.offsetWidth).toBeLessThanOrEqual(window.innerWidth);
  o.destroy();
});

it("a left-click mousedown on the pick hint does not start a drag (malformed-input guard)", () => {
  const o = createOverlay();
  o.open();
  const hint = pickHint();
  hint.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 400,
      clientY: 12,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 700, clientY: 12 }),
  );
  window.dispatchEvent(new MouseEvent("mouseup"));
  expect(localStorage.getItem("thisone:pickhint-x")).toBeNull();
  o.destroy();
});

it("restores a persisted pick-hint offset on open", () => {
  localStorage.setItem("thisone:pickhint-x", JSON.stringify(77));
  const o = createOverlay();
  o.open();
  expect(pickHint().style.left).toBe("77px");
  o.destroy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/overlay.test.ts -t "pick hint"` (and the tooltip test by name)
Expected: FAIL — `pickHint` has no `title`, doesn't react to right-drag, `.pickhint-x` never written.

- [ ] **Step 3: Write minimal implementation**

In `ensureMounted`, after `pickHint.textContent = "Click an element · Esc to close";`:

```typescript
pickHint.title = "Right-click drag to move horizontally";
```

Add clamp + apply + drag handlers (place near `applyTargetButtonPosition`/`clampOffset`, using the same module-level pattern):

```typescript
let pickHintOffsetX: number | null = null;
let pickHintDragging = false;

function clampPickHintX(x: number): number {
  const width = pickHint.offsetWidth;
  return Math.min(Math.max(0, x), Math.max(0, win.innerWidth - width));
}

function applyPickHintPosition(): void {
  if (pickHintOffsetX === null) {
    pickHint.style.left = "";
    return;
  }
  pickHintOffsetX = clampPickHintX(pickHintOffsetX);
  pickHint.style.left = pickHintOffsetX + "px";
}

function onPickHintDragStart(ev: MouseEvent): void {
  if (ev.button !== 2) return;
  ev.preventDefault();
  pickHintDragging = true;
  win.addEventListener("mousemove", onPickHintDragMove);
  win.addEventListener("mouseup", onPickHintDragEnd);
  win.addEventListener("contextmenu", suppressContextMenu, true);
}

function onPickHintDragMove(ev: MouseEvent): void {
  if (!pickHintDragging) return;
  pickHintOffsetX = clampPickHintX(ev.clientX - pickHint.offsetWidth / 2);
  pickHint.style.left = pickHintOffsetX + "px";
}

function onPickHintDragEnd(): void {
  if (!pickHintDragging) return;
  pickHintDragging = false;
  win.removeEventListener("mousemove", onPickHintDragMove);
  win.removeEventListener("mouseup", onPickHintDragEnd);
  if (pickHintOffsetX !== null) savePickHintOffsetX(pickHintOffsetX);
  setTimeout(() => {
    win.removeEventListener("contextmenu", suppressContextMenu, true);
  }, 0);
}
```

Wire it up in `ensureMounted`, right after the `pickHint` element is appended:

```typescript
pickHintOffsetX = loadPickHintOffsetX();
applyPickHintPosition();
pickHint.addEventListener("mousedown", onPickHintDragStart);
win.addEventListener("resize", applyPickHintPosition);
```

Add cleanup in `destroy()`, alongside the existing `target`-drag cleanup:

```typescript
win.removeEventListener("mousemove", onPickHintDragMove);
win.removeEventListener("mouseup", onPickHintDragEnd);
win.removeEventListener("resize", applyPickHintPosition);
pickHintDragging = false;
```

Add the import:

```typescript
import { loadPickHintOffsetX, savePickHintOffsetX } from "./pickhint-store";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/overlay.test.ts`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add src/client/overlay.ts tests/unit/overlay.test.ts
git commit -m "feat: let the pick hint be dragged horizontally with the right mouse button"
```

---

### Task 10: Full suite + docs pass

**Files:**

- Modify: `docs/superpowers/specs/2026-08-08-overlay-settings-panel-design.md` (mark implemented, if the project keeps a status marker — check the two most recent spec files under `docs/superpowers/specs/` for the convention actually used before editing)
- No new code files.

- [ ] **Step 1: Run the full suite**

Run: `pnpm test:run`
Expected: PASS, 0 failures.

- [ ] **Step 2: Grep for leftover references to removed/renamed things**

Run: `grep -rn "path-mode-toggle\|Select an element\"" src/ tests/` — the only remaining `"Select an element"` hit must be the `renderEmpty` hint (`src/client/overlay.ts`), never the title; `path-mode-toggle` must have zero hits.

Expected: only the one expected hit.

- [ ] **Step 3: Commit (if the spec file or any other doc was updated)**

```bash
git add -A
git commit -m "docs: mark overlay Settings panel spec implemented"
```

(Skip this commit if nothing needed changing.)

---

## Self-Review

**Spec coverage:**

1. Right-drag horizontal pick-hint move, viewport-clamped, persisted, with tooltip → Task 9.
2. Header title "ThisOne" → Task 5.
3. Collapsible Settings block (arrow + "Settings", smaller font, persisted expand state), path-mode radios with "?" tooltips, screenshot yes/no radio (default yes) + padding (default 30) → Tasks 6, 7, 8.
4. Section titles "Path" / "Screenshot" → Task 8.
5. Path shown first, screenshot loader "Делаем скриншот" while capturing → Task 8.

**Type consistency check:** `captureElementScreenshot(el, excludeRoot?, padding?)` (Task 4) matches the three-arg call added in Task 8 (`captureElementScreenshot(target, host, screenshotPadding)`) and the two-arg calls left alone elsewhere (defaults still apply). `PathMode` type reused from `path-mode-store.ts` (already imported in `overlay.ts`) in Task 7's `Record<PathMode, ...>`. Store function names (`loadPickHintOffsetX`/`savePickHintOffsetX`, `loadSettingsExpanded`/`saveSettingsExpanded`, `loadScreenshotEnabled`/`saveScreenshotEnabled`/`loadScreenshotPadding`/`saveScreenshotPadding`) are identical between their defining task and every consuming task.

**Placeholder scan:** no TBD/TODO; every step has literal code, not descriptions.
