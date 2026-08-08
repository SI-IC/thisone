# demo.gif Claude Code Outro Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third scene to `scripts/record-demo.mjs` that shows a synthetic Claude-Code-branded terminal
receiving the path thisone already copied, "thinking", replying `ok`, and turning the picked button red — the
new final frame `docs/demo.gif` loops from.

**Architecture:** Decoy buttons go into the Vue demo app (a new component outside `Counter.vue`'s directory) so
the recording shows Claude Code disambiguating among several similar buttons. The recorder gets a synthetic
terminal host (same shadow-DOM-via-`addInitScript` pattern as the existing synthetic cursor) and a new scene
function that drives it. Nothing calls a real LLM — every step is scripted and deterministic, matching how the
rest of the recorder already fakes state.

**Tech Stack:** Vue 3 SFC (demo app), Playwright (recorder), Vitest (source-grep unit tests on the recorder
script, following this file's existing convention — see `tests/unit/record-demo.test.ts`).

## Global Constraints

- Recorder viewport is fixed at `WIDTH = 900`, `HEIGHT = 700` (`scripts/record-demo.mjs:10-11`) — the terminal
  panel must fit this, not introduce its own viewport assumptions.
- `FRAME_MS = 90` (`scripts/record-demo.mjs:12`) — animation steps must be paced with real `page.waitForTimeout`
  calls (or in-page `setTimeout` chains awaited via a returned Promise), not instant DOM mutations, or the gif
  won't show the transition.
- No `src/` files change in this work — per `/workspace/CLAUDE.md` ("Release on push"), this does not require a
  version bump, and the pre-commit hook's auto-bump only triggers on staged `^src/` paths (verified in
  `.husky/pre-commit`).
- Keep the dev server already running on port 3000 alive throughout (project convention — see
  `feedback_keep_dev_server_alive` memory). Use `THISONE_DEMO_PORT` / the demo apps' own ports (5185-5188) or a
  scratch port for any manual dev server you start for verification, and kill it when done — check
  `pgrep -fa vite` before and after each task to make sure no stray dev server is left running on a port another
  task needs (this bit the author during brainstorming: a debug-frame dump left a zombie Vite process on 5187
  that broke `scripts/e2e-preact.sh`'s next run).
- Full verification before any "done" claim: `pnpm test:run` (unit) + `bash scripts/e2e.sh` +
  `bash scripts/e2e-react.sh` + `bash scripts/e2e-react-plugin.sh` + `bash scripts/e2e-preact.sh` +
  `bash scripts/e2e-svelte.sh`, all green.

---

### Task 1: Decoy buttons in the Vue demo app + the two locator fixes they require

**Files:**

- Create: `examples/demo-app/src/widgets/QuickActions.vue`
- Modify: `examples/demo-app/src/App.vue`
- Modify: `scripts/record-demo.mjs:111`
- Modify: `tests/e2e/thisone.e2e.mjs:103`

**Interfaces:**

- Produces: a `QuickActions.vue` component with prop `side: "left" | "right"`, rendering two `<button
type="button">` elements per side with no click handlers. Task 3 does not depend on this component directly
  (it only needs the picked button to still resolve to `Counter.vue:8:3-10:12`, which is unaffected).

This task exists because two places in the codebase assume "the Counter button is the only `<button>` on the
page" — a real risk the moment `QuickActions.vue` renders more of them before `Counter` in DOM order. Both must
be fixed together with the component, in the same task, or the recorder and the e2e suite start clicking the
wrong element.

- [ ] **Step 1: Create the decoy-buttons component**

```vue
<!-- examples/demo-app/src/widgets/QuickActions.vue -->
<script setup lang="ts">
defineProps<{ side: "left" | "right" }>();

const LABELS: Record<"left" | "right", [string, string]> = {
  left: ["Export", "Share"],
  right: ["Settings", "Reset"],
};
</script>

<template>
  <div class="quick-actions">
    <button v-for="label in LABELS[side]" :key="label" type="button">
      {{ label }}
    </button>
  </div>
</template>

<style scoped>
.quick-actions {
  display: flex;
  gap: 12px;
}

button {
  appearance: none;
  border: 1px solid #d7dae1;
  border-radius: 10px;
  background: #ffffff;
  color: #16181d;
  font: inherit;
  font-size: 15px;
  padding: 12px 22px;
  box-shadow: 0 1px 2px rgba(16, 18, 24, 0.06);
  cursor: pointer;
}

button:hover {
  border-color: #b9bec9;
}
</style>
```

`src/widgets/` is intentionally a new top-level directory next to `src/components/` — the decoy buttons must
live in a different place in the file tree and in a different component than `Counter.vue`, so the recorded
`.vue:line` reference the picker shows stays unambiguously `Counter.vue`.

- [ ] **Step 2: Wire it into `App.vue`, either side of `Counter`**

Replace the full contents of `examples/demo-app/src/App.vue`:

```vue
<script setup lang="ts">
import Counter from "./components/Counter.vue";
import DemoHeader from "./components/DemoHeader.vue";
import QuickActions from "./widgets/QuickActions.vue";
</script>

<template>
  <DemoHeader active="vue" />
  <main>
    <h1>thisone demo</h1>
    <div class="actions-row">
      <QuickActions side="left" />
      <Counter />
      <QuickActions side="right" />
    </div>
  </main>
</template>

<style>
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

.actions-row {
  display: flex;
  align-items: center;
  gap: 24px;
}
</style>
```

- [ ] **Step 3: Fix the recorder's button locator**

`scripts/record-demo.mjs:111` currently reads:

```js
await clickAt(page.locator("button").first(), "demo button", 750, 700);
```

With `QuickActions` rendering `Export`/`Share` before `Counter` in DOM order, `.first()` now grabs `Export`.
Change it to target the Counter button by its own text, matching the pattern already used elsewhere in this
codebase for the same reason (see `tests/e2e/thisone.e2e.mjs`'s `button:has-text("count is")` locators):

```js
await clickAt(
  page.locator('button:has-text("count is")'),
  "demo button",
  750,
  700,
);
```

- [ ] **Step 4: Fix the e2e scroll-crop test's button lookup**

`tests/e2e/thisone.e2e.mjs:103` currently reads:

```js
const btn = document.querySelector("button");
```

Same problem, inside a `page.evaluate`. Change it to:

```js
const btn = [...document.querySelectorAll("button")].find((b) =>
  b.textContent.includes("count is"),
);
```

- [ ] **Step 5: Verify the plugin still builds cleanly**

Run: `pnpm build`
Expected: `build ok: dist/{index.js,client.js,index.d.ts}` (this also builds the demo apps' dependency on the
plugin — a Vue template error would surface here or in the next step, not here specifically, but it's a fast
sanity check before the slower e2e run).

- [ ] **Step 6: Run the Vue e2e suite**

First make sure no stray dev server is squatting the port this script uses:

```bash
pgrep -fa "vite.*5187" && kill -9 <pid>   # only if something is listed
```

Run: `bash scripts/e2e.sh`
Expected: ends with `e2e ok` and no `not ok` lines — in particular
`ok - clicking the path copies it to the clipboard` and the scroll-crop check around it must still pass now
that the button lookup targets text instead of position.

- [ ] **Step 7: Commit**

```bash
git add examples/demo-app/src/widgets/QuickActions.vue examples/demo-app/src/App.vue \
  scripts/record-demo.mjs tests/e2e/thisone.e2e.mjs
git commit -m "feat(demo): add decoy buttons around Counter, fix button lookups to match by text"
```

---

### Task 2: Synthetic Claude Code terminal host

**Files:**

- Modify: `scripts/record-demo.mjs` (new constant + new function, alongside `installCursor`)
- Test: `tests/unit/record-demo.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `window.__demoTerminal` in the recorded page, with methods `slideUp()`, `typeText(str): Promise<void>`,
  `appendPath(str)`, `setStatus(state: "thinking" | "ok")`. Task 3's scene calls these by name — the names and
  signatures here are load-bearing for Task 3.

- [ ] **Step 1: Write the failing source-grep tests**

Add this block to `tests/unit/record-demo.test.ts`, right after the existing `describe("synthetic cursor", ...)`
block (before `describe("record-demo browser lifecycle", ...)`):

```ts
describe("synthetic terminal", () => {
  it("draws a Claude Code-branded terminal, because the outro scene needs a plausible chat surface", () => {
    expect(SOURCE).toContain(
      "addInitScript(installTerminal, TERMINAL_HOST_ID)",
    );
    expect(SOURCE).toContain("✳ Claude Code");
  });

  it("uses a host id distinct from the cursor's and the overlay's, so attachShadow cannot collide", () => {
    expect(SOURCE).toContain('TERMINAL_HOST_ID = "__thisone_demo_terminal"');
    expect(SOURCE).not.toMatch(/TERMINAL_HOST_ID = "__thisone_demo_cursor"/);
    expect(SOURCE).not.toMatch(/TERMINAL_HOST_ID = "__thisone_root"/);
  });

  it("exposes slideUp/typeText/appendPath/setStatus on window.__demoTerminal for the scene to drive", () => {
    expect(SOURCE).toContain("window.__demoTerminal");
    expect(SOURCE).toMatch(/slideUp\s*\(\s*\)/);
    expect(SOURCE).toMatch(/typeText\s*\(\s*str\s*\)/);
    expect(SOURCE).toMatch(/appendPath\s*\(\s*str\s*\)/);
    expect(SOURCE).toMatch(/setStatus\s*\(\s*state\s*\)/);
  });

  it("keeps the prompt and the pasted path inside one input block, not a separately labeled section", () => {
    expect(SOURCE).toMatch(
      /class="input">[\s\S]*prompt[\s\S]*path[\s\S]*<\/div>/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/record-demo.test.ts -t "synthetic terminal"`
Expected: FAIL — `TERMINAL_HOST_ID` and `installTerminal` don't exist yet.

- [ ] **Step 3: Add the constant**

In `scripts/record-demo.mjs`, add alongside the existing host id constants (after `const OVERLAY_HOST_ID =
"__thisone_root";`, around line 15):

```js
const TERMINAL_HOST_ID = "__thisone_demo_terminal";
```

- [ ] **Step 4: Add `installTerminal`**

Add this function right after `installCursor` (after its closing brace, currently `scripts/record-demo.mjs:88`):

```js
/**
 * Runs in the page: draws a hidden, bottom-anchored synthetic Claude Code
 * terminal that the outro scene slides into view and drives.
 * @param hostId - id for the terminal's own shadow host
 */
function installTerminal(hostId) {
  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:900px;pointer-events:none;" +
    "z-index:2147483646;transform:translateY(100%);" +
    "transition:transform 400ms ease-out";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .panel { font-family: ui-monospace, Menlo, monospace; background: #141413; }
      .header { padding: 14px 18px 8px; color: #c2c0b6; font-size: 13px; }
      .input {
        margin: 0 18px 16px; border: 1px solid #3a3934; border-radius: 6px;
        padding: 12px 14px; font-size: 14px; line-height: 1.6;
      }
      .prompt { color: #e8e6dc; }
      .path { color: #8a887e; }
      .status { padding: 0 18px 16px; font-size: 14px; line-height: 1.6; }
      .status.thinking { color: #d97757; }
      .status.ok { color: #e8e6dc; }
    </style>
    <div class="panel">
      <div class="header">✳ Claude Code</div>
      <div class="input"><span class="prompt">&gt; <span class="typed"></span></span><span class="path"></span></div>
      <div class="status"></div>
    </div>`;
  const typed = shadow.querySelector(".typed");
  const pathEl = shadow.querySelector(".path");
  const status = shadow.querySelector(".status");

  // Не менять, потому что addInitScript выполняется на document_start, когда document.body ещё null
  if (document.body) document.body.appendChild(host);
  else
    addEventListener("DOMContentLoaded", () => document.body.appendChild(host));

  window.__demoTerminal = {
    slideUp() {
      host.style.transform = "translateY(0)";
    },
    typeText(str) {
      return new Promise((resolve) => {
        if (str.length === 0) {
          resolve();
          return;
        }
        let i = 0;
        const step = () => {
          typed.textContent += str[i];
          i += 1;
          if (i < str.length) setTimeout(step, 45);
          else resolve();
        };
        step();
      });
    },
    appendPath(str) {
      pathEl.textContent = ` · ${str}`;
    },
    setStatus(state) {
      status.className = `status ${state}`;
      status.textContent = state === "thinking" ? "● Thinking…" : "ok";
    },
  };
}
```

Then wire it up next to the cursor's `addInitScript` call — in `recordDemo()`, right after
`await page.addInitScript(installCursor, CURSOR_HOST_ID);` (`scripts/record-demo.mjs:170`):

```js
await page.addInitScript(installTerminal, TERMINAL_HOST_ID);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/record-demo.test.ts`
Expected: all tests PASS (28 existing + 4 new = 32).

- [ ] **Step 6: Commit**

```bash
git add scripts/record-demo.mjs tests/unit/record-demo.test.ts
git commit -m "feat(demo): add a hidden synthetic Claude Code terminal host to the recorder"
```

---

### Task 3: `sceneClaudeCodeChat` — drive the terminal and turn the button red

**Files:**

- Modify: `scripts/record-demo.mjs`
- Test: `tests/unit/record-demo.test.ts`

**Interfaces:**

- Consumes: `window.__demoTerminal.{slideUp,typeText,appendPath,setStatus}` from Task 2. The `.path` element
  selector `#__thisone_root >> css=.path` (already used by `sceneCopyPath`, `scripts/record-demo.mjs:124`).
- Produces: `sceneClaudeCodeChat`, registered as the third and last entry in `SCENES`.

- [ ] **Step 1: Write the failing source-grep tests**

Add to `tests/unit/record-demo.test.ts`, inside the same `describe("synthetic terminal", ...)` block added in
Task 2 (append these two `it`s before its closing `});`):

```ts
it("registers the outro scene last, after pick-and-screenshot and copy-path", () => {
  expect(SOURCE).toMatch(
    /const SCENES = \[\s*scenePickAndScreenshot,\s*sceneCopyPath,\s*sceneClaudeCodeChat,?\s*\];/,
  );
});

it("reads the already-copied path from the panel instead of hardcoding it, so it can't drift from what sceneCopyPath showed", () => {
  expect(SOURCE).toMatch(/css=\.path"\)\s*\.innerText\(\)/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/record-demo.test.ts -t "registers the outro scene last"`
Expected: FAIL — `sceneClaudeCodeChat` isn't defined or registered yet.

- [ ] **Step 3: Implement the scene**

Add this function in `scripts/record-demo.mjs`, right after `sceneCopyPath` (after its closing brace, currently
ending at line 130):

```js
/**
 * Slides up a synthetic Claude Code terminal, sends the already-copied path
 * with a one-line request, and turns the picked button red once "Claude"
 * replies — the payoff frame docs/demo.gif loops from.
 * @param ctx - shared page/glideTo/clickAt from recordDemo
 */
async function sceneClaudeCodeChat(ctx) {
  const { page } = ctx;
  const copiedPath = await page
    .locator("#__thisone_root >> css=.path")
    .innerText();

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.evaluate(() => window.__demoTerminal.slideUp());
  await page.waitForTimeout(450);

  await page.evaluate(
    (text) => window.__demoTerminal.typeText(text),
    "make the button red",
  );
  await page.evaluate(
    (path) => window.__demoTerminal.appendPath(path),
    copiedPath,
  );
  await page.waitForTimeout(400);

  await page.evaluate(() => window.__demoTerminal.setStatus("thinking"));
  await page.waitForTimeout(900);

  await page.evaluate(() => window.__demoTerminal.setStatus("ok"));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes("count is"),
    );
    btn.style.transition =
      "background-color 300ms ease-out, border-color 300ms ease-out, color 300ms ease-out";
    btn.style.backgroundColor = "#dc2626";
    btn.style.borderColor = "#dc2626";
    btn.style.color = "#ffffff";
  });
  await page.waitForTimeout(1200);
}
```

`copiedPath` is read via `.innerText()` (not hardcoded) so this scene can never show a path string that
disagrees with what `sceneCopyPath` just displayed — including the absolute filesystem path, which varies by
checkout location and isn't something this scene should hardcode.

Then register it as the third scene, replacing:

```js
const SCENES = [scenePickAndScreenshot, sceneCopyPath];
```

with:

```js
const SCENES = [scenePickAndScreenshot, sceneCopyPath, sceneClaudeCodeChat];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/record-demo.test.ts`
Expected: all tests PASS (32 existing + 2 new = 34).

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm test:run`
Expected: all test files pass (was 349 tests before this plan; should be 349 + 6 new = 355).

- [ ] **Step 6: Commit**

```bash
git add scripts/record-demo.mjs tests/unit/record-demo.test.ts
git commit -m "feat(demo): add the Claude Code outro scene, wire it up last"
```

---

### Task 4: Re-record docs/demo.gif and verify the full recording end to end

**Files:**

- Modify: `docs/demo.gif` (binary, regenerated by `scripts/demo.sh`)

**Interfaces:**

- Consumes: everything from Tasks 1-3 — this task only records and verifies, no new source changes.

- [ ] **Step 1: Confirm no stray dev server is running on the recorder's port**

```bash
pgrep -fa "vite.*5187"
```

Expected: no output. If something is listed, `kill -9 <pid>` it before continuing — `scripts/demo.sh` uses
`--strictPort` and will fail to start otherwise.

- [ ] **Step 2: Record the gif**

Run: `bash scripts/demo.sh`
Expected: ends with `record-demo: wrote /workspace/docs/demo.gif (N frames)` and no thrown error (a scene
throwing surfaces as `record-demo: scene "sceneClaudeCodeChat" failed`, per the existing per-scene error
wrapping at `scripts/record-demo.mjs:210-217` — if you see that, re-check the `.path` locator and the
`window.__demoTerminal` calls above).

- [ ] **Step 3: Dump and inspect debug frames**

Start a scratch dev server and dump sampled frames, same recipe used during this feature's design:

```bash
(cd examples/demo-app && node_modules/.bin/vite --port 5187 --strictPort >/tmp/thisone-demo-dev-verify.log 2>&1 &)
sleep 2
THISONE_DEMO_DEBUG_FRAMES=1 node scripts/record-demo.mjs 5187
pkill -f "vite --port 5187"
```

This writes 5 sampled PNGs to `/tmp/demo-frame-*.png` (indices `0`, `n/4`, `n/2`, `3n/4`, `n-1` — see
`scripts/record-demo.mjs`'s `THISONE_DEMO_DEBUG_FRAMES` block). Read the two latest ones (highest indices) with
the Read tool and confirm:

- The terminal panel is visible, full-width, dark, with the `✳ Claude Code` header.
- The prompt text and the path are both inside the same input box (may wrap to two lines at the full absolute
  path's length — that's expected, it's still one input block, not a separately labeled "Path" section).
- The Counter button is red in the final frame, and the two extra buttons on each side are visible and
  unstyled (still white/default), showing the disambiguation.
- No decoy button (`Export`/`Share`/`Settings`/`Reset`) is red — only the Counter button changed.

If anything looks wrong, fix it in the relevant Task 1-3 file and re-run from Step 2 — don't hand-edit the gif.

- [ ] **Step 4: Run the full verification suite**

```bash
pnpm test:run
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react-plugin.sh
bash scripts/e2e-preact.sh
bash scripts/e2e-svelte.sh
```

Expected: all green. Between each e2e script, if one fails with a timeout on a `locator`, check `pgrep -fa vite`
first — a leftover process from Step 3 squatting a port is the most likely cause, not a real regression.

- [ ] **Step 5: Confirm the main dev server on port 3000 is untouched**

```bash
pgrep -fa "vite.*port 3000"
curl -sf http://localhost:3000/ >/dev/null && echo "3000 OK"
```

Expected: the same process that was running before this plan started, still running, still responding.

- [ ] **Step 6: Commit the regenerated gif**

```bash
git add docs/demo.gif
git commit -m "chore(demo): re-record docs/demo.gif with the Claude Code outro scene"
```

---

## Self-Review Notes

- **Spec coverage:** Decoy buttons (Task 1), synthetic terminal + API (Task 2), scene sequence + same-line
  prompt/path + red button (Task 3), re-record + visual/e2e verification (Task 4) — all spec sections have a
  task. The spec's "Risks" item (e2e selector fix) is Task 1 Step 4; the equivalent risk in the recorder itself
  (`scripts/record-demo.mjs:111`, not called out in the spec but found during planning) is Task 1 Step 3.
- **Type/name consistency checked:** `TERMINAL_HOST_ID`, `installTerminal`, `window.__demoTerminal` and its four
  method names (`slideUp`, `typeText`, `appendPath`, `setStatus`) are identical across Task 2 (definition) and
  Task 3 (call sites) and their respective tests.
- **No placeholders:** every step has literal code, exact file paths/lines, and exact expected command output.
