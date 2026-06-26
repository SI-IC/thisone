# vite-plugin-claude-feedback — Design

**Date:** 2026-06-26
**Status:** Approved design, pending spec review

## Problem

When working with Claude Code on a Vue + Vite project (e.g. inside the _conveyor_ platform, where Claude Code and the project dev server run in the same container), it is hard to tell Claude _what_ to change, _where_, and _in which situation_ — or which page produced which console error. The user wants to point at the running dev preview, optionally select a concrete element, type what they want, and have that reach Claude with full context.

## Goal

A reusable tool for any **Vue 3 + Vite** project that lets the user, from the live dev preview:

1. Press **Alt+C** to open a feedback modal.
2. Optionally enter element-picker mode and select the element they care about.
3. Type a wish / problem report and send it to Claude Code.

Each sent message carries: page **URL**, the selected **element** descriptor, its **Vue component** (name + source file:line + parent chain), and recent **browser console** output. On demand, Claude can ask the browser for a **snapshot** of a component's state or a Pinia store.

Delivery model is **pull**: messages accumulate in a queue; Claude retrieves them via an MCP tool when the user asks (or via a slash command). No automatic push into any chat.

## Non-Goals

- No production behavior — the overlay and servers exist only in `vite serve` (dev). Production builds are untouched.
- No automatic push of feedback into the conveyor chat (possible later as a thin adapter; out of scope here).
- No support for Vue 2, Nuxt-specific internals, or non-Vite bundlers in v1.
- No secret redaction of console contents beyond "we don't add secrets ourselves" — console text is forwarded as the app already logged it.

## Two Artifacts

This repo produces two cooperating artifacts:

### A. Vite plugin — `vite-plugin-claude-feedback` (npm package)

Added to the target project's `vite.config.ts`. Responsibilities:

- `apply: 'serve'` — active only in dev.
- `transformIndexHtml` — inject a small client overlay bundle into every served page.
- `configureServer` — mount the **bridge**: an HTTP + WebSocket server.
- On startup, write `.claude-feedback/bridge.json` (`{ port, pid, startedAt }`) for discovery, and persist the queue to `.claude-feedback/queue.jsonl`.

Options: `{ port?: number, hotkey?: string, consoleBufferSize?: number, queueDir?: string }`. `port` defaults to an OS-assigned free port (written to `bridge.json`); a fixed port may be set for stable multi-host setups.

### B. Claude Code plugin — `claude-feedback`

Installed into Claude Code (and distributable through the conveyor plugin system). Contains:

- `.claude-plugin/plugin.json` — manifest declaring a **stdio** MCP server (`mcp-server.mjs`), a **SessionStart** hook, the skill, and the commands.
- `mcp-server.mjs` — a thin stdio MCP server that reads `.claude-feedback/bridge.json`, connects to the bridge over localhost HTTP, and exposes tools to Claude. It owns no state itself.
- `hooks/session-start.sh` — SessionStart hook: idempotently auto-wire the Vite plugin into the project (see Lifecycle).
- `scripts/wire.mjs` / `scripts/unwire.mjs` — the actual setup/remove logic, shared by the hook and the commands.
- `skills/claude-feedback/SKILL.md` — tells Claude when/how to pull feedback and act on it.
- `commands/feedback.md` — `/feedback` slash command: fetch and summarize pending feedback, then start working on it.
- `commands/feedback-setup.md` — `/feedback:setup` slash command: manually run the wire-in (same as the auto hook).
- `commands/feedback-remove.md` — `/feedback:remove` slash command: un-wire the Vite plugin from the project (manual — there is no auto-remove; see Lifecycle).

**Why stdio MCP in the CC plugin (not HTTP MCP in the Vite process):** stdio is the most robust transport for a bundled CC plugin — Claude owns the MCP process lifecycle, and there is no HTTP-URL/port coupling in the MCP registration. The dynamic bridge port is discovered via the `bridge.json` file instead.

## Installation (how a user enables this in a project)

Repo: **`https://github.com/SI-IC/vue-pick-problem-skill`** (public). Two artifacts, reduced to **one enable** — the Vite side then wires itself in automatically. No npm-registry publishing — the Vite plugin installs directly from GitHub.

### Step 1 — add the marketplace & enable the plugin

Claude Code marketplace lives at the repo root (`.claude-plugin/marketplace.json`).

```
/plugin marketplace add SI-IC/vue-pick-problem-skill
/plugin install claude-feedback@vue-pick-problem-skill
```

Inside conveyor this is the standard plugin-library flow: add `claude-feedback` to the library (`/plugins`) → per-project override → on container start `PluginInstallService.ensureProjectPlugins` installs it. The stdio MCP server, the `claude-feedback` skill, the SessionStart hook, and the `/feedback*` commands become available.

### Step 2 — automatic wire-in (no manual command needed)

On the **next session start** the plugin's SessionStart hook runs `scripts/wire.mjs`, which idempotently:

1. Detects the project: reads `package.json` + `vite.config.{ts,js,mjs}`; confirms `vue` + `vite` are present. No-op with a logged note otherwise.
2. **If not already wired:** installs the Vite plugin from GitHub (no npm registry), resolving the **latest tag dynamically** so the command never needs hand-editing:
   ```bash
   pnpm add -D "github:SI-IC/vue-pick-problem-skill#$(git ls-remote --tags --refs https://github.com/SI-IC/vue-pick-problem-skill | tail -1 | sed 's:.*/::')"
   ```
   (falls back to `npm i -D` / `yarn add -D` based on the project's lockfile).
3. Patches `vite.config` idempotently: adds `import claudeFeedback from 'vite-plugin-claude-feedback'` and inserts `claudeFeedback()` into `plugins: []`. If already present, does nothing.
4. **If already wired:** fast no-op (a `vite.config` grep + `node_modules` check), no network, no pnpm.

`/feedback:setup` runs the exact same `wire.mjs` on demand (for re-runs or when the hook was skipped). The one-time install cost (network + pnpm) happens only on the first session after enable; every later session start is a cheap no-op.

Result for the user: **enable `claude-feedback` → (next session auto-wires) → press Alt+C in the preview.**

### GitHub-install constraints (design consequences)

- **Prebuilt `dist/` is committed to the repo.** `package.json` `exports`/`main` point at `dist/`, so a `github:` install needs no build toolchain in the container (fast, deterministic). A `prepare` build step is intentionally **not** used.
- The repo root **is** the npm package (`vite-plugin-claude-feedback`); the CC plugin lives in `claude-plugin/` and is shipped via the marketplace, not the git-install. `github:SI-IC/vue-pick-problem-skill` therefore resolves the root `package.json` correctly.
- Installs pin to the **latest tag** resolved at wire time (versioning below keeps a tag current per change).
- Repo is **public** → install needs no auth.

## Lifecycle (auto-setup on enable, manual remove)

Claude Code has **no install/enable/disable/uninstall plugin hooks**, and a disabled plugin executes no code. Therefore:

- **Auto-setup on enable → via the SessionStart hook** (above). Effectively "on enable", since the first session after enabling triggers `wire.mjs`. Idempotent and self-healing across sessions.
- **No auto-remove on disable.** A disabled plugin cannot run anything, and there is no uninstall hook — so removal can only be **manual** via `/feedback:remove` (runs `unwire.mjs`: strips the import + `claudeFeedback()` from `vite.config` and uninstalls the dep). Driving removal from conveyor's `PluginInstallService` was explicitly declined and is out of scope.

## Versioning (automatic, both artifacts)

Single source of truth: the **root `package.json` `version`**. Both artifacts and the marketplace stay in sync automatically as Claude Code changes the repo.

- **Husky `pre-commit`** — when files under `src/` or `claude-plugin/` are staged: bump **patch** (default), sync the new version into `claude-plugin/.claude-plugin/plugin.json` and the `claude-feedback` entry in `.claude-plugin/marketplace.json`, rebuild `dist/`, and stage all of them.
- **Husky `post-commit`** — create the matching git tag `v<version>`.
- **Push** with `git push --follow-tags` so the tag reaches GitHub (what `wire.mjs` resolves as latest).
- **Minor/major** bumps are explicit: Claude runs `pnpm release minor|major` (the skill instructs it to do so for features / breaking changes); default automatic bump is patch.
- A sync check (`scripts/check-versions.mjs`) fails the commit if the three version fields ever diverge, so they cannot drift.

Net effect: every change Claude Code commits to the plugin produces a fresh, installable tag with both artifacts' versions in lockstep.

## Architecture

```
 Browser (dev preview)
   │  Alt+C overlay (Shadow DOM)
   │  POST /__claude_feedback/message      (send feedback)
   │  WS  /__claude_feedback/ws            (receive snapshot requests, reply)
   ▼
 Vite dev server process ─ BRIDGE (HTTP + WS)
   │  owns: connected tabs, feedback queue (file-backed), pending snapshot requests
   │  writes .claude-feedback/bridge.json
   ▲
   │  localhost HTTP:  GET /feedback?ack=1 · POST /request · GET /status
   │
 mcp-server.mjs (stdio)  ◄── launched by Claude Code via plugin manifest
   ▲
   │  MCP stdio
   │
 Claude Code
```

Everything that must touch the dev server lives in the bridge. The MCP server is a pure HTTP client to the bridge — the single, simple interface.

In conveyor, Claude Code, the Vite dev server, and the bridge are all in the **same container**, so `localhost` connects them. On a developer laptop, all three run on `localhost` too. Identical mechanism.

## Components (isolated units)

| Unit              | File                              | Purpose                                                     | Depends on                  |
| ----------------- | --------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Vite plugin entry | `src/plugin/index.ts`             | wire `transformIndexHtml` + `configureServer`, start bridge | bridge                      |
| Bridge            | `src/server/bridge.ts`            | HTTP+WS server, queue, pending requests                     | `ws`, fs                    |
| Queue store       | `src/server/queue.ts`             | append/read/ack feedback in `queue.jsonl`                   | fs                          |
| Client entry      | `src/client/index.ts`             | hotkey, mount overlay in Shadow DOM, WS client              | resolve/console/snapshot    |
| Overlay UI        | `src/client/overlay.ts`           | modal + element-picker rendering & events                   | —                           |
| Component resolve | `src/client/resolve-component.ts` | DOM el → Vue instance → name + `__file` + chain             | —                           |
| Console tap       | `src/client/console-tap.ts`       | ring buffer of console + errors from load                   | —                           |
| Snapshot          | `src/client/snapshot.ts`          | read Pinia store / component state on request               | devtools hook               |
| MCP server        | `claude-plugin/mcp-server.mjs`    | stdio MCP → bridge HTTP client                              | `@modelcontextprotocol/sdk` |

Each unit has one purpose, a defined interface, and is testable alone.

## Data Flow

### Send (pull)

1. User presses **Alt+C** → overlay opens.
2. Optional: user clicks "pick element" → capture-phase hover highlight + component tooltip → click selects, suppressed from the app (`capture` + `preventDefault`/`stopPropagation`). Esc cancels picker.
3. On send, client assembles the **context payload** (below) and `POST /__claude_feedback/message`.
4. Bridge appends to the in-memory queue and `queue.jsonl`.
5. Later, Claude calls `get_feedback` (via `/feedback` or because the user asked) → bridge returns pending items and marks them acked.

### Snapshot request (bidirectional)

1. Claude calls e.g. `request_store_snapshot { store: "projects" }`.
2. MCP server `POST /request { type, args }` to bridge.
3. Bridge generates `requestId`, pushes it over WS to the target tab, and awaits the reply with a **timeout (default 10s)**.
4. Client computes the snapshot and `POST /__claude_feedback/reply { requestId, data | error }`.
5. Bridge resolves the pending promise → HTTP response → MCP returns data to Claude.
6. If no browser connected or timeout → structured error (`browser_not_connected` / `timeout`), never a hang.

## Context Payload (sent with each message)

```jsonc
{
  "id": "fb_<ulid>",
  "ts": 1750000000000,
  "url": "https://preview.example/app/projects/5",
  "message": "this button should be disabled while loading",
  "element": {
    "tag": "button",
    "classes": ["btn", "btn-primary"],
    "text": "Save",            // trimmed snippet
    "selector": "main > form > button.btn-primary:nth-of-type(1)"  // stable-ish CSS path
  } | null,
  "component": {
    "name": "SaveButton",
    "file": "src/components/SaveButton.vue:42",  // from @vitejs/plugin-vue __file
    "chain": ["SaveButton", "ProjectForm", "ProjectView", "App"]
  } | null,
  "console": [ { "level": "error", "ts": ..., "text": "..." }, ... ],  // ring buffer
  "tabId": "tab_<uuid>"
}
```

`element` and `component` are null when the user sends without picking. `console` is always included (may be empty).

## MCP Tools (exposed to Claude)

- `get_feedback` → array of pending payloads; acks them. (Reads via bridge `GET /feedback?ack=1`.)
- `request_store_snapshot { store? }` → snapshot of a Pinia store; with no `store`, returns the list of registered store ids.
- `request_component_snapshot { selector?, last? }` → props + reactive state of a component instance (by CSS selector, or the element from the most recent feedback when `last: true`).
- `request_console { level? }` → fresh console ring buffer on demand (independent of a feedback message).
- `feedback_status` → `{ browserConnected, tabs, queueSize, bridgePort }` for diagnostics.

When `bridge.json` is missing or the bridge is unreachable, every tool returns a friendly structured error telling Claude the dev server isn't running.

## Component Resolution

From the picked DOM element, walk up via `el.__vueParentComponent` (Vue 3 internal `ComponentInternalInstance`) to the first instance whose `type.__file` exists (`@vitejs/plugin-vue` sets `__file` in dev). Report component `name` (from `type.name`/`__name`/filename), `file` as `__file` plus best-effort line, and the parent `chain` up to the root. If Vue internals are absent (element outside the app), `component` is null.

## Console Capture

At client init (before app code where possible), wrap `console.{log,info,warn,error,debug}` and add `window.addEventListener('error' | 'unhandledrejection')`, recording into a fixed-size ring buffer (default 200 entries). Original console behavior is preserved (we tee, not replace). Entries store level, timestamp, and a stringified message. No redaction beyond not introducing secrets ourselves.

## Snapshots

- **Pinia store:** locate stores via `app`'s Pinia instance exposed on the devtools global hook (`window.__VUE_DEVTOOLS_GLOBAL_HOOK__`) / `pinia._s`. Serialize state with a safe stringifier (depth + cycle guard, function/DOM stripping).
- **Component:** from the selector → Vue instance → `props` + `setupState`/`data`, serialized with the same safe stringifier.

## Edge Cases (to implement + test)

- Browser not connected when a snapshot is requested → `browser_not_connected` error, no hang.
- Snapshot timeout (slow/closed tab) → `timeout` error after 10s.
- Multiple preview tabs → bridge tracks tabs; requests target a tab; replies matched by `requestId`.
- Empty message and no element → allowed (console-only / "just a problem" report).
- Element-picker: Esc cancels; selection click never reaches the app (capture + prevent/stop).
- Queue survives page reload **and** Claude restart (file-backed `queue.jsonl`); ack removes items.
- Malformed/oversized payload (huge console / deep store) → bridge caps body size; stringifier caps depth/length.
- App CSS vs overlay isolation → overlay rendered in **Shadow DOM**.
- Requested Pinia store id does not exist → `not_found` listing available ids.
- Production build → nothing injected, no servers (`apply: 'serve'`).
- Bridge port discovery race (MCP starts before bridge wrote file) → MCP retries reading `bridge.json` briefly, then returns the friendly error.

## Testing

**Unit (vitest):**

- `resolve-component`: fake DOM with `__vueParentComponent` chain → correct name/file/chain; element outside app → null.
- `console-tap`: ring buffer wraps at capacity; captures error + unhandledrejection; tees to original console.
- `queue`: append → read → ack; survives reopen; corruption-tolerant line parsing.
- `bridge`: `requestId` matching; snapshot timeout; `browser_not_connected`; body-size cap.
- `snapshot` stringifier: cycles, depth cap, function/DOM stripping.

**E2E (headless Playwright, harness committed to `tests/e2e/`):**

- Boot `examples/demo-app` (Vue 3 + Vite + Pinia) with the plugin.
- Open page → Alt+C → pick element → send → assert bridge `GET /feedback` returns correct URL/element/component/console.
- Drive `request_store_snapshot` against the demo's Pinia store and assert returned state.
- Assert nothing is injected in a production build.

## Package Layout

```
vue-pick-problem-skill/
  README.md                          # CC-plugin install instructions (marketplace add/install, usage)
  package.json                       # vite-plugin-claude-feedback (peer: vite >=5)
  dist/                              # prebuilt, committed (so github: install needs no build)
  .claude-plugin/marketplace.json    # Claude Code marketplace manifest (repo root)
  .husky/{pre-commit,post-commit}    # auto-versioning
  scripts/{release.mjs,check-versions.mjs}
  src/plugin/index.ts
  src/server/{bridge.ts,queue.ts}
  src/client/{index.ts,overlay.ts,resolve-component.ts,console-tap.ts,snapshot.ts}
  claude-plugin/
    .claude-plugin/plugin.json       # mcpServers (stdio) + SessionStart hook + skill/commands
    mcp-server.mjs
    hooks/session-start.sh
    scripts/{wire.mjs,unwire.mjs}
    skills/claude-feedback/SKILL.md
    commands/feedback.md             # /feedback — pull & act on feedback
    commands/feedback-setup.md       # /feedback:setup — manual wire-in
    commands/feedback-remove.md      # /feedback:remove — manual un-wire
  examples/demo-app/                  # Vue 3 + Vite + Pinia for e2e
  tests/{unit,e2e}/
```

`dist/` is a committed build artifact (not in `.gitignore`) because the GitHub install path depends on it.

### README / install instructions (req: repo ships its own install docs)

`README.md` documents, for end users:

- **Marketplace install:** `/plugin marketplace add SI-IC/vue-pick-problem-skill` then `/plugin install claude-feedback@vue-pick-problem-skill`.
- **Conveyor install:** add `claude-feedback` via the plugin library (`/plugins`).
- What happens automatically (SessionStart auto-wire), and the manual `/feedback:setup` / `/feedback:remove` fallbacks.
- Usage: Alt+C in the dev preview, element picker, what context is sent, and the MCP tools Claude can call.

## Dependency Versions (pin latest at implementation, verified 2026-06-26)

- `@modelcontextprotocol/sdk` 1.29.0 (MCP server, stdio)
- `ws` 8.21.0 (bridge WebSocket)
- peer `vite` `>=5` (conveyor uses 7; latest is 8.1.0)
- `@vitejs/plugin-vue` 6.0.7 (demo app)
- `husky` (auto-versioning hooks)

Re-run registry lookups at build time and pin the then-current latest.

## Marketplace manifest (req: repo includes the marketplace)

`.claude-plugin/marketplace.json` at repo root, the plugin sourced from the in-repo subdir:

```json
{
  "name": "vue-pick-problem-skill",
  "owner": { "name": "SI-IC" },
  "description": "Send element-anchored feedback from a Vue+Vite dev preview to Claude Code",
  "plugins": [
    {
      "name": "claude-feedback",
      "source": "./claude-plugin",
      "description": "Alt+C in the dev preview to send Claude the page URL, picked element, its Vue component, and console — pull-based via MCP."
    }
  ]
}
```

## Open Naming

- npm package: `vite-plugin-claude-feedback`
- CC plugin / skill: `claude-feedback`; slash command `/feedback`

Rename freely during spec review.
