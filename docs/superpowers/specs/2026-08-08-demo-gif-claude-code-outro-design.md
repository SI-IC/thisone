# demo.gif: Claude Code outro scene

## Problem

`docs/demo.gif` (recorded by `scripts/record-demo.mjs`) currently ends after the pick → screenshot → copy-path
scenes. It doesn't show the actual payoff: pasting what thisone copied into an AI agent and having the agent
act on it correctly. Add a third scene showing a Claude Code terminal receiving the copied path and applying
the requested change.

## Scope

- `examples/demo-app` (Vue) only — the single demo app `scripts/demo.sh` records into `docs/demo.gif`. The
  other four demo apps (`examples/demo-app-{react,react-plugin,preact,svelte}`) exist to exercise
  framework-specific resolution paths in their own e2e suites and are not touched.
- `scripts/record-demo.mjs` gets a new scene; `tests/unit/record-demo.test.ts` gets source-grep coverage for it,
  following the file's existing convention.
- `tests/e2e/thisone.e2e.mjs` needs one selector fix (see Risks) because of the new demo-app markup.

## Demo-app change: decoy buttons

Real, static buttons (no click handlers) so the recording shows multiple similar-looking buttons on screen —
selling that Claude Code identified the _specific_ one from the copied path, not "the only button on the page".

- New file `examples/demo-app/src/widgets/QuickActions.vue` — deliberately outside `src/components/` (a
  different place in the file tree, a different component than `Counter.vue`). Renders 4 plain buttons, styled
  like `Counter.vue`'s button (same look, no store/logic wired up): `Export`, `Share` (left group) and
  `Settings`, `Reset` (right group). No props, no emits — static markup only.
- `App.vue` renders them either side of `Counter`: `[Export] [Share]  <Counter/>  [Settings] [Reset]`, in a
  horizontal flex row.
- The picked element / path stays `Counter.vue:8:3-10:12` — unchanged, since `Counter` is still the button that
  gets clicked in `scenePickAndScreenshot`.

## Recorder change: `sceneClaudeCodeChat`

Third entry in `SCENES`, after `scenePickAndScreenshot` and `sceneCopyPath`.

### Synthetic terminal host

Mirrors the existing `installCursor` pattern: a new `addInitScript(installTerminal, TERMINAL_HOST_ID)`
creates a fixed, full-width (900px, matching `WIDTH`) shadow-DOM host anchored to the bottom of the viewport,
hidden (`transform: translateY(100%)` or `display: none`) until the scene calls it.

Style: option **C** from the visual companion round — "Claude Code branded".

- Dark background `#141413`.
- Header row: `✳ Claude Code`, `#c2c0b6`, small caps-ish label text.
- Input box: 1px border `#3a3934`, rounded corners, containing one line:
  `> make the button red · <button> · Counter · Counter.vue:8:3-10:12` — the prompt text `#e8e6dc`, the path
  segment dimmer `#8a887e`. Both are on the **same line** (per user's explicit correction — not stacked).
- Status line below the box: `● Thinking…` in coral `#d97757`, later replaced by `ok` in `#e8e6dc`.
- Slides up from the bottom edge with a CSS transition; nothing above it needs to move — the viewport is tall
  enough (700px) that the button row (~y 380–440) stays visible above the panel.

Exposed as `window.__demoTerminal`, called from the scene via `page.evaluate`, each step paced with
`page.waitForTimeout` so `captureLoop`'s screenshots (every `FRAME_MS` = 90ms) catch the animation:

- `slideUp()` — reveals the panel (transition).
- `typeText(str)` — appends `str` to the prompt line one character at a time (setInterval-driven internally, or
  the scene calls it once and awaits a duration proportional to `str.length`; implementation detail, not a
  contract change to record-demo's public API).
- `appendPath(str)` — appends the dimmed path segment instantly (paste, not typed).
- `setStatus("thinking" | "ok")` — swaps the status line content/color.

### Scene sequence

```
sceneClaudeCodeChat(ctx):
  press Escape                          // closes the thisone panel from sceneCopyPath, clean frame
  wait ~500ms
  __demoTerminal.slideUp()
  wait for transition to settle
  __demoTerminal.typeText("make the button red")   // paced, ~40-60ms/char
  __demoTerminal.appendPath("<button> · Counter · Counter.vue:8:3-10:12")
  wait ~400ms
  __demoTerminal.setStatus("thinking")
  wait ~900ms                            // sells "AI is working"
  __demoTerminal.setStatus("ok")
  // trigger the button's color change directly (this is a scripted demo, not a real agent call)
  page.evaluate: find the Counter button by text "count is", add a class/inline transition to red
  wait ~1200ms                           // final frame: red button + "ok" terminal, gif loop point
```

No new mouse movement/glide is needed for this scene — the cursor stays wherever `sceneCopyPath` left it
(clicking `.path`), which is off in the panel area that's now closed; that's fine, the terminal panel is the
focus of this scene and the arrow being parked off to the side doesn't distract.

### Why the button turns red via direct DOM styling, not a "real" edit

Nothing in this demo actually calls an LLM — `sceneCopyPath`'s "Copied" state and this scene's "ok" are both
scripted. Directly restyling the button after `setStatus("ok")` is consistent with how the rest of the recorder
already fakes state (e.g. `__demoCursorReparent`).

## Risks

- **`tests/e2e/thisone.e2e.mjs:103`** — `document.querySelector("button")` (used in the "screenshot crop
  targets the picked element" check) currently relies on the Counter button being the _only_ `<button>` on the
  page. With `QuickActions.vue` adding 4 more, sitting before `Counter` in DOM order (`[Export] [Share]
<Counter/> ...`), this now grabs `Export` instead. Fix: change the selector to
  `[...document.querySelectorAll("button")].find(b => b.textContent.includes("count is"))`, matching the same
  text-based approach already used by the Playwright locators elsewhere in this file
  (`button:has-text("count is")`).
- No other `examples/demo-app` e2e assertions key off "the only button on the page" (checked `tests/e2e/thisone.e2e.mjs` and `tests/unit/record-demo.test.ts` — both target the Counter button by text or by the `.path`/`.panel` selectors, unaffected by sibling buttons).

## Testing

- `tests/unit/record-demo.test.ts`: extend the existing `describe("synthetic cursor", ...)`-style source-grep
  coverage with a new block for the terminal host — asserts `installTerminal` is wired via `addInitScript`,
  `TERMINAL_HOST_ID` is distinct from the other two host ids, `sceneClaudeCodeChat` is registered in `SCENES`
  after the other two scenes, and the prompt/path are rendered on the same line (regex spanning both spans on
  one template literal line).
- `scripts/e2e.sh` (`tests/e2e/thisone.e2e.mjs`) after the selector fix — full suite must stay green.
- Manual/visual verification per the recorder's existing convention:
  `THISONE_DEMO_DEBUG_FRAMES=1 node scripts/record-demo.mjs <port>` dumps sampled PNG frames to
  `/tmp/demo-frame-*.png` — inspect the terminal slide-up, the same-line prompt+path, the thinking→ok swap, and
  the final red-button frame.
- Re-record `docs/demo.gif` via `bash scripts/demo.sh` once implemented, and eyeball the full loop.

## Out of scope

- Real Claude Code / any LLM call — this stays a fully scripted, deterministic recording.
- Mirroring the decoy buttons into the other four `examples/demo-app-*` apps.
- Any change to the actual `vite-plugin-thisone` runtime (`src/`) — this is `docs/` + `scripts/` + one example
  app's markup only, so per `/workspace/CLAUDE.md` it does not require a version bump.
