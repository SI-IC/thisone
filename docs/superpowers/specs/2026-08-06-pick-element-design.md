# vite-plugin-pick-element — design

## Why

`vite-plugin-claude-feedback` currently ships a full feedback pipeline: overlay →
HTTP/WS bridge → on-disk queue → MCP server → Claude Code plugin (hooks, skill,
`/feedback*` commands, marketplace manifest). That whole surface is being
replaced with a much smaller tool: pick a DOM element in a running Vue+Vite
dev preview, see its component path (with source line numbers) and a
screenshot, click either to copy to the clipboard. No server, no MCP, no
Claude Code integration at all — a standalone Vite plugin.

Package renamed to **`vite-plugin-pick-element`**.

## Scope

**In scope:**

- Alt+C opens a small draggable window: "Выберите элемент".
- Hover/click picks a DOM element (reuse existing pick-mode highlight/hint
  from the current overlay).
- On pick, the window shows, stacked vertically:
  1. Text: `<tag> · ComponentName · file:startLine:startCol-endLine:endCol`
  2. A screenshot of the element, with 30px of real surrounding page content
     padded on each side.
- Clicking the text copies it (`navigator.clipboard.writeText`); clicking the
  image copies the PNG (`navigator.clipboard.write` + `ClipboardItem`). Each
  shows a transient "Скопировано" / "Не удалось скопировать" near the click.
- While the window is open, clicking a different element on the page replaces
  the current selection and re-renders both parts.
- Closing via the × button or `Escape`.
- Window position is draggable and persisted to `localStorage`, restored on
  next open.

**Out of scope / removed entirely:**

- `src/server/**` (`bridge.ts`, `queue.ts`, `types.ts`)
- `src/client/ws-client.ts`, `snapshot.ts`, `redact.ts`, `console-tap.ts`
- `claude-plugin/**` (MCP server, SessionStart hook, skill, `/feedback*`
  commands, marketplace manifest)
- The message textarea / Cancel / Send flow, console capture, Pinia/component
  snapshot requests — everything that depended on the bridge.

## Architecture

Purely client-side Vite plugin, two artifacts:

- **`src/plugin/index.ts`** — Vite plugin. Keeps the `.vue` `transform` hook
  (`injectSourceLocations`, unchanged) and `transformIndexHtml` (inlines the
  client bundle, unchanged). Drops `createBridge`, the WS/HTTP
  `configureServer` wiring, and `writeBridgeInfo`.
- **`src/client/overlay.ts`** — all UI and logic: hotkey, hover highlight,
  pick, panel render, screenshot, clipboard copy, drag+persist.

Kept as-is: `src/client/resolve-component.ts` (`describeElement`,
`resolveComponent` — the path-text formatter extends to include
`sourceLoc`), `src/plugin/inject-src-loc.ts`.

## Data flow

1. **Alt+C** → `openModal()` shows the window with "Выберите элемент" and
   immediately enters pick mode (existing `pickHint`/`box`/`tip` highlight).
2. **Click an element on the page** → `selectedEl` updates → panel re-renders:
   - path text from `describeElement()` + `resolveComponent()`, formatted as
     `<tag> · ComponentName · file:startLine:startCol-endLine:endCol`;
   - `<img>` with the screenshot below it.
     While open, clicking a _different_ element replaces the selection and
     re-renders both.
3. **Screenshot**: `modern-screenshot` renders the nearest visible container
   (viewport-level, e.g. `document.documentElement`) to a canvas once per
   click; a second canvas crops that render to
   `getBoundingClientRect(selectedEl)` ± 30px on each side (real page content
   in the padding, not blank margin) → `toBlob('image/png')` →
   `URL.createObjectURL` for the `<img src>`.
4. **Copy**: click on the path text → `navigator.clipboard.writeText(text)`.
   Click on the image → `navigator.clipboard.write([new ClipboardItem({
'image/png': blob })])`. Success shows "Скопировано" for ~1.5s next to the
   clicked element.
5. **Close**: × button or `Escape` → `close()`, cancels pick mode. Nothing
   persists except window position.
6. **Drag**: panel header — plain `mousedown`/`mousemove`/`mouseup` (no new
   dependency). Position `{x, y}` is written to
   `localStorage['pick-element:pos']` on `mouseup`, read back in
   `ensureMounted()`.

## Error handling / edge cases

- **Element outside the Vue app** (`resolveComponent()` → `null`) — path
  falls back to `<tag> · selector` (existing CSS-path fallback), no component
  name/lines.
- **No `data-src-loc`** (element not from a `.vue` template) — omit
  `:line:col-line:col`, keep `<tag> · ComponentName (file)`.
- **`modern-screenshot` throws** (cross-origin resource, unsupported CSS) —
  show "Не удалось сделать скриншот" in place of the image; the path text
  stays clickable/copyable regardless.
- **Clipboard API unavailable/denied** (insecure context, old browser,
  permission denied) — catch and show "Не удалось скопировать" instead of
  "Скопировано"; overlay stays open and usable.
- **Alt+C while already open** — no-op (existing behavior).
- **Click lands inside the overlay's own panel** — pick-mode click handler
  excludes the overlay's own DOM subtree (`host`), so the panel can't select
  or screenshot itself.
- **Resize/scroll between click and screenshot render** —
  `getBoundingClientRect()` is read immediately before rendering, never
  cached from an earlier event.

## Testing

- **Unit** (vitest): path-text formatter (with/without `sourceLoc`,
  with/without `resolveComponent`), the canvas-crop-by-rect±30px function
  (pure function over a mocked 2D context — no real DOM render needed),
  `localStorage` position read/write.
- **E2e** (`tests/e2e`, existing `examples/demo-app` + Playwright): Alt+C
  opens the window → clicking an element shows path+image → clicking the
  path puts text on the clipboard (`navigator.clipboard.readText()` in the
  test) → clicking the image puts a PNG on the clipboard → `Escape` closes →
  reopening restores the persisted position.
- Existing tests for `bridge.ts`/`queue.ts`/`ws-client.ts`/the MCP server are
  deleted along with the code they cover.

## Distribution

GitHub install only (`pnpm add github:SI-IC/vue-pick-problem-skill` or
equivalent), no npm-registry publish — same as today, just without the
claude-plugin auto-wiring step (there is no MCP server left to wire; users
add the plugin to `vite.config` by hand, one line, same as any other Vite
plugin).
