# thisone Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `vite-plugin-pick-element` to `vite-plugin-thisone`, rewrite the README as an English landing page with a recorded demo GIF, and publish 1.0.0 to npm.

**Architecture:** A mechanical rename across four surfaces — the published package identity (package.json, plugin export), the browser runtime identifiers (host element id, window globals, localStorage keys), the e2e harness (script names, env var, log paths), and the example apps — followed by documentation and release work. Behaviour is unchanged; every task is guarded by the existing unit and e2e suites, which are updated first so they fail on the old names.

**Tech Stack:** TypeScript, Vite 7, esbuild + tsc build (`scripts/build.mjs`), vitest (unit, happy-dom), Playwright (e2e + demo recording), pnpm, husky release hooks.

## Global Constraints

- New package name: `vite-plugin-thisone`. Brand root reserved separately as `thisone`.
- New GitHub repo name: `SI-IC/thisone`; remote URL `git+https://github.com/SI-IC/thisone.git`.
- Plugin export renames: `pickElement` → `thisone`, `PickElementOptions` → `ThisoneOptions`, Vite plugin `name` field → `"vite-plugin-thisone"`.
- Runtime identifier renames: `__pick_element_root` → `__thisone_root`; `__PICK_ELEMENT_CFG__` → `__THISONE_CFG__`; `__pick_element_booted__` → `__thisone_booted__`; localStorage `pick-element:pos` → `thisone:pos`, `pick-element:target-pos` → `thisone:target-pos`, `pick-element:target-enabled` → `thisone:target-enabled`.
- E2E env var `PICK_ELEMENT_E2E_PORT` → `THISONE_E2E_PORT`.
- No backwards-compatibility shims: no `pickElement` alias export, no localStorage key migration, no deprecated npm stub under the old name. The package existed only in the author's own projects.
- README is written in **English**.
- Version reaches `1.0.0` exactly once, in the final task, via `node scripts/release.mjs major`. Do not hand-edit `version` in package.json — the husky `pre-commit` hook auto-bumps the patch on any commit touching `src/`, and intermediate patch bumps (0.4.3, 0.4.4, …) are expected and fine.
- `data-src-loc` (the DOM attribute the transform injects) keeps its name — it is generic and not part of the brand.
- Historic documents under `docs/superpowers/specs/` and `docs/superpowers/plans/` dated before 2026-08-07 are records of past work and are **not** renamed. Only live documentation (`README.md`, `tests/e2e/README.md`) is updated.
- Design source of truth: `docs/superpowers/specs/2026-08-07-thisone-rebrand-design.md`.

## File Structure

| File                                                                  | Responsibility after this plan                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                        | Package identity: new name, description, repo URL, keywords, 1.0.0                                            |
| `src/plugin/index.ts`                                                 | Exports `thisone()` / `ThisoneOptions`; declares plugin name `vite-plugin-thisone`; injects `__THISONE_CFG__` |
| `src/client/index.ts`                                                 | Boot guard `__thisone_booted__`, reads `__THISONE_CFG__`                                                      |
| `src/client/overlay.ts`                                               | `HOST_ID = "__thisone_root"`                                                                                  |
| `src/client/position-store.ts`                                        | localStorage key `thisone:pos`                                                                                |
| `src/client/target-store.ts`                                          | localStorage keys `thisone:target-enabled`, `thisone:target-pos`                                              |
| `tests/unit/*.test.ts`                                                | Same coverage, new identifiers                                                                                |
| `tests/e2e/thisone.e2e.mjs`, `tests/e2e/thisone-react.e2e.mjs`        | Renamed e2e specs                                                                                             |
| `scripts/e2e.sh`, `scripts/e2e-react.sh`, `scripts/e2e-react.test.sh` | Renamed runners, `THISONE_E2E_PORT`, `/tmp/thisone-e2e*.log`                                                  |
| `scripts/record-demo.mjs`                                             | **New.** Drives the Vue demo app with Playwright, records video, converts to `docs/demo.gif`                  |
| `scripts/demo.sh`                                                     | **New.** Boots the demo dev server and runs `record-demo.mjs`, mirroring `scripts/e2e.sh`                     |
| `examples/demo-app/**`, `examples/demo-app-react/**`                  | Import `thisone`, renamed package names and headings                                                          |
| `README.md`                                                           | English landing page, 11 sections per the spec                                                                |
| `packages/thisone-root/`                                              | **New.** Minimal placeholder package that reserves the `thisone` name on npm                                  |

---

### Task 1: Rename the plugin package and its public API

**Files:**

- Modify: `src/plugin/index.ts:8`, `:23`, `:27`, `:34`, `:62`, `:71`
- Modify: `package.json:2-11`
- Test: `tests/unit/plugin-transform.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `export function thisone(options?: ThisoneOptions): Plugin`, `export interface ThisoneOptions { hotkey?: string }`, `export default thisone`. Task 3's example apps import the default export. The injected global is `window.__THISONE_CFG__ = {"hotkey":"KeyC"}`, consumed by Task 2's client boot.

- [ ] **Step 1: Update the unit test to the new names**

In `tests/unit/plugin-transform.test.ts`, change the import and every call site, and the two name assertions:

```ts
import thisone from "../../src/plugin/index";

type AnyPlugin = ReturnType<typeof thisone> & Record<string, any>;
```

Replace every `pickElement(` with `thisone(`. Update the two assertions that pin identifiers:

```ts
expect(tag.children).toContain("__thisone_root");
```

```ts
it("declares name:'vite-plugin-thisone'", () => {
  expect((thisone() as AnyPlugin).name).toBe("vite-plugin-thisone");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: FAIL — the module has no export named `thisone` (the default import resolves, but `name` is still `vite-plugin-pick-element` and the injected script still contains `__pick_element_root`).

- [ ] **Step 3: Rename the exports in the plugin**

In `src/plugin/index.ts`:

```ts
export interface ThisoneOptions {
  hotkey?: string;
}
```

```ts
throw new Error("[thisone] dist/client.js not found — run `pnpm build` first.");
```

```ts
export function thisone(options: ThisoneOptions = {}): Plugin {
```

```ts
    name: "vite-plugin-thisone",
```

```ts
              children: `window.__THISONE_CFG__=${cfgJson};\n${client}`,
```

```ts
export default thisone;
```

Note `__thisone_root` reaches the injected script through `HOST_ID` in the client bundle — Task 2 renames it; this test step passes only after Task 2 in a clean build. To keep Task 1 independently green, run the test with the already-built `dist/client.js` regenerated at the end of Task 2. If it fails on `__thisone_root` alone here, that is expected — carry it to Task 2 and confirm there.

- [ ] **Step 4: Update package identity**

In `package.json`:

```json
  "name": "vite-plugin-thisone",
  "description": "Point at any element in your Vite dev preview and hand your AI agent its exact source location and a screenshot.",
  "keywords": [
    "vite-plugin",
    "ai",
    "agent",
    "llm",
    "context",
    "devtools",
    "inspector",
    "vue",
    "react"
  ],
```

and the repository URL:

```json
    "url": "git+https://github.com/SI-IC/thisone.git"
```

Leave `version` untouched.

- [ ] **Step 5: Run the unit suite**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS except possibly the `__thisone_root` assertion, which Task 2 resolves.

- [ ] **Step 6: Commit**

```bash
git add src/plugin/index.ts package.json tests/unit/plugin-transform.test.ts
git commit -m "refactor(plugin): rename export to thisone and repoint package identity"
```

---

### Task 2: Rename the browser runtime identifiers

**Files:**

- Modify: `src/client/index.ts:3-19`, `src/client/overlay.ts:14`, `src/client/position-store.ts:1`, `src/client/target-store.ts:8-9`
- Test: `tests/unit/index.test.ts:20`, `tests/unit/overlay.test.ts:215`, `:365`, `:387`, `tests/unit/position-store.test.ts:5`, `tests/unit/target-store.test.ts:10`

**Interfaces:**

- Consumes: `window.__THISONE_CFG__` produced by Task 1.
- Produces: host element id `__thisone_root` (Task 3's e2e selectors depend on it), localStorage keys `thisone:pos`, `thisone:target-pos`, `thisone:target-enabled`.

- [ ] **Step 1: Update the unit tests to the new identifiers**

`tests/unit/index.test.ts`:

```ts
delete (window as unknown as Record<string, unknown>).__thisone_booted__;
```

`tests/unit/position-store.test.ts`:

```ts
const KEY = "thisone:pos";
```

`tests/unit/target-store.test.ts`:

```ts
const POS_KEY = "thisone:target-pos";
```

`tests/unit/overlay.test.ts` — replace the three literal keys:

```ts
localStorage.setItem("thisone:pos", JSON.stringify({ x: 123, y: 45 }));
```

```ts
const stored = JSON.parse(localStorage.getItem("thisone:target-pos")!);
```

```ts
expect(localStorage.getItem("thisone:target-pos")).toBeNull();
```

- [ ] **Step 2: Run the unit suite to verify failures**

Run: `pnpm exec vitest run tests/unit`
Expected: FAIL — position/target store tests read keys the source never writes.

- [ ] **Step 3: Rename the runtime identifiers**

`src/client/index.ts`:

```ts
interface ThisoneConfig {
  hotkey?: string;
}

declare global {
  interface Window {
    __THISONE_CFG__?: ThisoneConfig;
    __thisone_booted__?: boolean;
  }
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__thisone_booted__) return;
  window.__thisone_booted__ = true;

  const cfg = window.__THISONE_CFG__ ?? {};
```

`src/client/overlay.ts`:

```ts
export const HOST_ID = "__thisone_root";
```

`src/client/position-store.ts`:

```ts
const KEY = "thisone:pos";
```

`src/client/target-store.ts`:

```ts
const ENABLED_KEY = "thisone:target-enabled";
const POS_KEY = "thisone:target-pos";
```

- [ ] **Step 4: Rebuild and run the full unit suite**

Run: `pnpm build && pnpm exec vitest run tests/unit`
Expected: PASS — all files, including the `__thisone_root` assertion carried over from Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/client tests/unit dist
git commit -m "refactor(client): rename runtime globals and storage keys to thisone"
```

---

### Task 3: Rename the e2e harness and the example apps

**Files:**

- Rename: `tests/e2e/pick-element.e2e.mjs` → `tests/e2e/thisone.e2e.mjs`; `tests/e2e/pick-element-react.e2e.mjs` → `tests/e2e/thisone-react.e2e.mjs`
- Modify: `scripts/e2e.sh`, `scripts/e2e-react.sh`, `scripts/e2e-react.test.sh:21-22`, `tests/e2e/README.md`
- Modify: `examples/demo-app/vite.config.ts`, `examples/demo-app/package.json`, `examples/demo-app/src/App.vue:7`, `examples/demo-app-react/vite.config.ts`, `examples/demo-app-react/package.json`, `examples/demo-app-react/src/App.tsx:6`, `examples/demo-app-react/src/App.test.tsx:8`, `examples/demo-app-react/src/main.test.tsx:10`

**Interfaces:**

- Consumes: the default export `thisone` (Task 1) and the host id `__thisone_root` (Task 2).
- Produces: `bash scripts/e2e.sh` and `bash scripts/e2e-react.sh` as the green-gate commands used by every later task; the Vue demo app at `examples/demo-app` with heading `thisone demo`, which Task 4 records.

- [ ] **Step 1: Rename the e2e spec files**

```bash
git mv tests/e2e/pick-element.e2e.mjs tests/e2e/thisone.e2e.mjs
git mv tests/e2e/pick-element-react.e2e.mjs tests/e2e/thisone-react.e2e.mjs
```

- [ ] **Step 2: Update identifiers inside the specs**

In both renamed files replace every occurrence:

- `#__pick_element_root` → `#__thisone_root`
- `"pick-element:pos"` → `"thisone:pos"`, `"pick-element:target-pos"` → `"thisone:target-pos"`
- `__pick_element` → `__thisone` (the production-build grep guard in `thisone.e2e.mjs:385` and `thisone-react.e2e.mjs:135`)
- usage strings: `usage: thisone.e2e.mjs <port>` and `usage: thisone-react.e2e.mjs <port>`

Verify none survive:

```bash
grep -rn "pick_element\|pick-element" tests/e2e/ || echo "clean"
```

- [ ] **Step 3: Update the runner scripts**

`scripts/e2e.sh`:

```bash
port="${THISONE_E2E_PORT:-5183}"
```

```bash
node_modules/.bin/vite --port "$port" --strictPort >/tmp/thisone-e2e-dev.log 2>&1 &
```

```bash
  cat /tmp/thisone-e2e-dev.log >&2
```

```bash
node tests/e2e/thisone.e2e.mjs "$port"
```

`scripts/e2e-react.sh` — the same four edits with the react suffix: `/tmp/thisone-e2e-react-dev.log` and `node tests/e2e/thisone-react.e2e.mjs "$port"`. Keep its existing port variable name pattern consistent with `e2e.sh` (`THISONE_E2E_PORT`).

`scripts/e2e-react.test.sh`:

```bash
if grep -q 'thisone-react.e2e.mjs' "$script"; then
  echo "ok - scripts/e2e-react.sh delegates to tests/e2e/thisone-react.e2e.mjs"
```

- [ ] **Step 4: Update the example apps**

`examples/demo-app/vite.config.ts`:

```ts
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [vue(), thisone()],
});
```

`examples/demo-app/package.json`:

```json
  "name": "thisone-demo-app",
```

```json
    "vite-plugin-thisone": "link:../.."
```

`examples/demo-app/src/App.vue:7`:

```html
<h1>thisone demo</h1>
```

`examples/demo-app-react/vite.config.ts`:

```ts
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [thisone()],
});
```

`examples/demo-app-react/package.json`: `"name": "thisone-demo-app-react"` and dependency key `"vite-plugin-thisone": "link:../.."`.

`examples/demo-app-react/src/App.tsx:6`: `<h1>thisone react demo</h1>`, and the two tests that assert on it:

```ts
expect(html).toContain("thisone react demo");
```

```ts
      "thisone react demo",
```

- [ ] **Step 5: Reinstall example dependencies so the renamed link resolves**

```bash
cd examples/demo-app && pnpm install && cd ../demo-app-react && pnpm install && cd ../..
```

- [ ] **Step 6: Update `tests/e2e/README.md`**

Replace every `pick-element` occurrence with `thisone` (spec filenames, env var, command lines).

- [ ] **Step 7: Run both e2e suites**

```bash
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react.test.sh
```

Expected: all PASS. If a run reports the port is busy, kill the stray dev server first (`pkill -f "vite --port 5183"`) rather than changing the port.

- [ ] **Step 8: Verify no old identifiers remain outside historic docs**

```bash
grep -rn "pick-element\|pickElement\|PickElement\|pick_element" \
  --include="*.ts" --include="*.tsx" --include="*.vue" --include="*.json" \
  --include="*.mjs" --include="*.sh" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.pnpm-store \
  | grep -v "^./docs/" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add -A tests examples scripts dist
git commit -m "refactor(e2e): rename e2e harness and example apps to thisone"
```

---

### Task 4: Record the demo GIF

**Files:**

- Create: `scripts/record-demo.mjs`
- Create: `scripts/demo.sh`
- Create: `docs/demo.gif` (binary artifact, committed)

**Interfaces:**

- Consumes: the Vue demo app from Task 3 and the host id `__thisone_root` from Task 2.
- Produces: `docs/demo.gif`, referenced by the README in Task 5.

**Background:** Playwright ships its own ffmpeg binary at `~/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux`; the system has no ffmpeg. Playwright records `.webm` per page when `recordVideo` is set on the context, and the file is only finalised after `context.close()`.

- [ ] **Step 1: Write the recorder**

Create `scripts/record-demo.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.argv[2];
if (!port) {
  console.error("usage: record-demo.mjs <port>");
  process.exit(1);
}

const rawDir = resolve(root, ".demo-raw");
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

const ffmpeg = resolve(
  process.env.HOME ?? "",
  ".cache/ms-playwright/ffmpeg-1011/ffmpeg-linux",
);
if (!existsSync(ffmpeg)) {
  console.error(`record-demo: ffmpeg not found at ${ffmpeg}`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1000, height: 640 },
  recordVideo: { dir: rawDir, size: { width: 1000, height: 640 } },
});
const page = await context.newPage();
await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.keyboard.press("Alt+KeyC");
await page.locator("#__thisone_root >> css=.panel").waitFor();
await page.waitForTimeout(600);

const target = page.locator("button").first();
await target.hover();
await page.waitForTimeout(500);
await target.click();

await page.locator("#__thisone_root >> css=img.shot").waitFor();
await page.waitForTimeout(700);
await page.locator("#__thisone_root >> css=.path").click();
await page.waitForTimeout(1200);

await context.close();
await browser.close();

const webm = readdirSync(rawDir).find((f) => f.endsWith(".webm"));
if (!webm) {
  console.error("record-demo: no video produced");
  process.exit(1);
}

const out = resolve(root, "docs/demo.gif");
mkdirSync(dirname(out), { recursive: true });
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    resolve(rawDir, webm),
    "-vf",
    "fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
    out,
  ],
  { stdio: "inherit" },
);
rmSync(rawDir, { recursive: true, force: true });
console.log(`record-demo: wrote ${out}`);
```

- [ ] **Step 2: Write the runner**

Create `scripts/demo.sh` — a copy of `scripts/e2e.sh` that ends in the recorder:

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app"
port="${THISONE_DEMO_PORT:-5187}"

cd "$root"
pnpm build

cd "$demo"
node_modules/.bin/vite --port "$port" --strictPort >/tmp/thisone-demo-dev.log 2>&1 &
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
  cat /tmp/thisone-demo-dev.log >&2
  exit 1
fi

cd "$root"
node scripts/record-demo.mjs "$port"
```

- [ ] **Step 3: Record**

```bash
chmod +x scripts/demo.sh
bash scripts/demo.sh
```

Expected: `record-demo: wrote /workspace/docs/demo.gif`.

- [ ] **Step 4: Verify the artifact**

```bash
ls -lh docs/demo.gif
```

Expected: a file under 5 MB. If it is larger, re-run with `fps=10` and `scale=760:-1` in the ffmpeg filter. Open it with the Read tool to confirm the panel, the path text and the screenshot are visible and the "Copied" state appears.

- [ ] **Step 5: Add the raw-video dir to .gitignore**

Append to `.gitignore`:

```
.demo-raw/
```

- [ ] **Step 6: Commit**

```bash
git add scripts/record-demo.mjs scripts/demo.sh docs/demo.gif .gitignore
git commit -m "chore(demo): record README demo gif from the vue example app"
```

---

### Task 5: Rewrite the README as an English landing page

**Files:**

- Modify: `README.md` (full rewrite)

**Interfaces:**

- Consumes: `docs/demo.gif` (Task 4), the `thisone()` export (Task 1), the clipboard format `<tag> · ComponentName · file:startLine:startCol-endLine:endCol` from `src/client/resolve-component.ts:134`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the new README**

Replace `README.md` entirely with the following structure (11 sections from the spec). Write real prose, not headings alone:

1. `# thisone` + tagline _Point at it. Your AI agent gets the file, the line, and the pixels._ + badges:

```markdown
[![npm](https://img.shields.io/npm/v/vite-plugin-thisone.svg)](https://www.npmjs.com/package/vite-plugin-thisone)
[![license](https://img.shields.io/npm/l/vite-plugin-thisone.svg)](./LICENSE)

`dev-only` · `zero runtime` · `no network`
```

2. The demo, above the fold: `![thisone demo](docs/demo.gif)`
3. **The problem** — 3–4 lines: your agent cannot see the screen; "the third card is 2px off" turns into grep-and-guess across the repo; you have a pixel, it has text, and there is no shared pointing gesture.
4. **The fix** — Alt+C, click, Ctrl+V, plus the real clipboard payload:

```
<button> · CheckoutCard · src/components/CheckoutCard.vue:42:5-48:12
```

5. **Quickstart**:

````markdown
```bash
npm i -D vite-plugin-thisone
```

```ts
// vite.config.ts — Vue
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [vue(), thisone()],
});
```

```ts
// vite.config.ts — React
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [react(), thisone()],
});
```
````

6. **What lands on your clipboard** — break the format into `<tag>`, component name, `file:line:col-line:col`; state the degraded forms produced by `formatElementPath` when the component or source location cannot be resolved (`<tag> · selector`, `<tag> · Name (file)`); describe the PNG screenshot with 30px of real surrounding page on each side.
7. **Options** — table with `hotkey` (default `"KeyC"`, combines with Alt), plus the docked quick-access button (off by default, toggled from the panel, position and state persisted in `localStorage`).
8. **Works with** — Vue 3, React, Vite 5/6/7; `apply: "serve"` means it is absent from production builds.
9. **Why not just X?** — a short table comparing `locatorjs`, `click-to-component`, `vite-plugin-vue-inspector`: they jump _you_ to an editor; `thisone` puts the location **and a picture** on the clipboard for an agent, with no IDE integration.
10. **Privacy** — one line: no server, no network calls, no telemetry; everything happens in the page.
11. **Development / Contributing / License** — carry over the existing development commands (`pnpm install`, `pnpm run setup-hooks`, `pnpm build`, `pnpm test:run`, `bash scripts/e2e.sh`, `bash scripts/demo.sh`), the husky versioning note, the `setup-hooks`-is-not-`prepare` note, and `MIT`.

Do not include a migration section and do not mention the old package name anywhere.

- [ ] **Step 2: Verify every command and identifier in the README is real**

```bash
grep -n "pick-element\|pickElement" README.md || echo "clean"
grep -n "demo.gif" README.md && ls docs/demo.gif
```

Expected: `clean`, and the gif path resolves.

- [ ] **Step 3: Check the formatting renders**

Run: `pnpm exec prettier --check README.md`
Expected: PASS (run `pnpm exec prettier --write README.md` if it fails).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite as thisone landing page"
```

---

### Task 6: Reserve the brand root, release 1.0.0, publish

**Files:**

- Create: `packages/thisone-root/package.json`, `packages/thisone-root/README.md`
- Modify: `package.json` (version, via script)

**Interfaces:**

- Consumes: everything above.
- Produces: npm packages `vite-plugin-thisone@1.0.0` and `thisone@0.0.1`; git tag `v1.0.0`; renamed GitHub repo.

**Note:** neither `npm` nor `gh` is authenticated in this environment. Steps 4, 6 and 7 require the user to authenticate or to perform the action themselves. Stop and ask rather than guessing credentials.

- [ ] **Step 1: Create the placeholder package that reserves the brand root**

`packages/thisone-root/package.json`:

```json
{
  "name": "thisone",
  "version": "0.0.1",
  "description": "Brand root for thisone — the released plugin lives in vite-plugin-thisone.",
  "license": "MIT",
  "author": "SI-IC",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/SI-IC/thisone.git"
  },
  "keywords": ["thisone", "ai", "agent", "devtools"],
  "files": ["README.md"]
}
```

`packages/thisone-root/README.md`:

```markdown
# thisone

Name placeholder. The plugin you want is [`vite-plugin-thisone`](https://www.npmjs.com/package/vite-plugin-thisone).
```

- [ ] **Step 2: Run the full verification gate before releasing**

```bash
pnpm exec vitest run
bash scripts/e2e.sh
bash scripts/e2e-react.sh
bash scripts/e2e-react.test.sh
pnpm exec prettier --check .
```

Expected: all PASS. Do not proceed to the release on any failure.

- [ ] **Step 3: Bump to 1.0.0 and commit**

```bash
node scripts/release.mjs major
pnpm build
git add package.json dist packages
git commit -m "release: thisone 1.0.0"
git tag --list 'v1.0.0'
```

Expected: `scripts/release.mjs` reports the bump to `1.0.0`, and the husky `post-commit` hook has created the `v1.0.0` tag (the `git tag --list` output shows it). If the version is not exactly `1.0.0`, fix `package.json` by re-running `node scripts/release.mjs` with the right level rather than editing by hand, and amend.

- [ ] **Step 4: Rename the GitHub repository (requires the user)**

Ask the user to rename `SI-IC/vue-pick-problem-skill` → `SI-IC/thisone` on GitHub (Settings → Repository name), or run it themselves with an authenticated CLI:

```bash
gh repo rename thisone --repo SI-IC/vue-pick-problem-skill
```

Then repoint the local remote:

```bash
git remote set-url origin git@github.com:SI-IC/thisone.git
git remote -v
```

- [ ] **Step 5: Push the release**

```bash
git push origin main
git push origin v1.0.0
```

Expected: both succeed. The tag is lightweight, so it must be pushed explicitly — `--follow-tags` skips it.

- [ ] **Step 6: Publish to npm (requires the user)**

Ask the user to run `npm login` (this environment reports `ENEEDAUTH`), then:

```bash
npm publish --access public
cd packages/thisone-root && npm publish --access public && cd ../..
```

- [ ] **Step 7: Verify the published packages**

```bash
npm view vite-plugin-thisone version
npm view thisone version
```

Expected: `1.0.0` and `0.0.1`.

- [ ] **Step 8: Set the repository topics (requires the user)**

Ask the user to add these GitHub topics to the repo: `vite-plugin`, `ai`, `agent`, `llm`, `devtools`, `vue`, `react`, `inspector`.

- [ ] **Step 9: Open the awesome-vite pull request (requires the user)**

Propose the entry for the `Framework-agnostic Plugins → Integrations` section of https://github.com/vitejs/awesome-vite:

```markdown
- [vite-plugin-thisone](https://github.com/SI-IC/thisone) - Point at any element in the dev preview and copy its source location and screenshot for an AI agent.
```

---

## Self-Review

**Spec coverage:** naming table → Task 1 + Task 2 + Task 3 + Task 6 (repo rename, brand root); no-migration decision → Global Constraints (explicitly forbids shims); README 11 sections → Task 5 step 1 (all eleven enumerated); demo GIF → Task 4; keywords/topics/awesome-vite → Task 1 step 4 and Task 6 steps 8–9; version 1.0.0 and publication → Task 6; out-of-scope non-Vite entry points → not present in any task, correct.

**Placeholder scan:** no TBD/TODO; every code step carries the literal replacement text; the README task enumerates concrete content per section rather than "write a good README".

**Type consistency:** `thisone()` / `ThisoneOptions` are defined in Task 1 and used unchanged in Tasks 3 and 5. `HOST_ID = "__thisone_root"` is defined in Task 2 and consumed by the selectors in Tasks 3 and 4. `THISONE_E2E_PORT` (Task 3) and `THISONE_DEMO_PORT` (Task 4) are distinct by design — different servers on different ports.

**Known cross-task dependency:** the `__thisone_root` assertion in `tests/unit/plugin-transform.test.ts` cannot pass until Task 2 rebuilds the client bundle. Task 1 step 3 and Task 2 step 4 both call this out.
