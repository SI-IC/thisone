# vite-plugin-claude-feedback — Implementation Plan (circle-skill)

> **For agentic workers:** this plan is executed by the **circle-skill** plugin phase by phase (one phase per fresh background session). The preamble (`## Context` / `## Strategy` / `## Risks`) is shared context that the executor reads at the start of EACH phase; it is not duplicated in the phase bodies. Spec source: `docs/superpowers/specs/2026-06-26-vite-plugin-claude-feedback-design.md` — read together with the plan.

## Context

We are building a tool that lets you send Claude Code feedback tied to an element, from a live dev preview of a Vue 3 + Vite project. The user presses **Alt+C** in the preview, optionally selects an element, writes a wish/problem and sends it. Along with the text goes: the page URL, the element descriptor, its **Vue component** (name + `__file:line` + parent chain), and the recent **browser console**. On request, Claude can ask for a **snapshot** of a Pinia store or component state.

Two cooperating artifacts in **one public repo** `https://github.com/SI-IC/vue-pick-problem-skill`:

- **Vite plugin** `vite-plugin-claude-feedback` (repo root, npm package, installed from GitHub without publishing to the npm registry) — injects the client overlay into dev pages and spins up a **bridge** (HTTP + WebSocket) inside the dev server process.
- **Claude Code plugin** `claude-feedback` (`claude-plugin/`, installed via marketplace) — a **stdio MCP server** (a thin HTTP client to the bridge), a **SessionStart hook** for auto-wiring the Vite plugin into the project, a skill and slash commands.

Key decisions (made during brainstorming, not to be reopened): **pull delivery** (feedback accumulates in a file-backed queue, Claude retrieves it with the MCP tool `get_feedback`); **stdio MCP in the CC plugin** (not HTTP MCP in the Vite process) — Claude owns the MCP lifecycle, the dynamic bridge port is discovered via the file `.claude-feedback/bridge.json`; **the bridge is the sole owner** of the queue and the browser connection, the MCP server holds no state of its own; **auto-setup on enable** via the SessionStart hook, **no auto-remove** (manual `/feedback:remove`); **auto-versioning** via husky (patch-bump + sync of both manifests + rebuild `dist/` + tag on every plugin change); the built **`dist/` is committed** (github-install without a toolchain).

Current state: the repo is empty (only `docs/`, git initialized, first commit is the spec). Target project stack: Vue 3.5 + Vite 7 + Pinia 3 + TypeScript (mirrors the conveyor frontend).

## Strategy

Domain dependency graph (phase order):

```
P1 Infra (scaffold+build+versioning+marketplace+README)
      │
      ├──> P2 Server: bridge + queue ───────────────┐
      │                                              │
      ├──> P3 Client collectors: resolve/console/snapshot
      │                                              │
      │        P4 Client overlay + Vite plugin entry ◄── deps [P2, P3]
      │                                              │
      └──> P5 MCP server (stdio → bridge) ◄── deps [P2]
                    │
                P6 CC plugin: manifest+hook+wire/unwire+skill+commands ◄── deps [P5]
                    │
                P7 demo-app + e2e ◄── deps [P4, P5, P6]
```

Shared contracts between phases (fixed in P1/P2, consumed further down):

- **`.claude-feedback/bridge.json`**: `{ port:number, pid:number, startedAt:number, version:string }`. Written by the bridge (P2/P4), read by the MCP server (P5), read by wire.mjs (P6) — only to know that the dev server is alive.
- **Bridge HTTP API** (all on the dev server's single http server; browser paths are proxied by nginx, MCP paths are hit over localhost):
  - browser: `POST /__claude_feedback/message`, WS `GET /__claude_feedback/ws`
  - MCP (localhost): `GET /__claude_feedback/api/feedback?ack=1`, `POST /__claude_feedback/api/request`, `GET /__claude_feedback/api/status`
- **WS protocol** (`/__claude_feedback/ws`): browser→bridge `{type:'hello',tabId,url}` and `{type:'reply',requestId,data?,error?}`; bridge→browser `{type:'request',requestId,kind:'store'|'component'|'console',args}`.
- **FeedbackPayload** (contract from the spec, "Context Payload" section): the bridge assigns `id`,`ts`,`tabId`; the rest is sent by the client.
- **Build output**: `dist/index.js` (Vite plugin, ESM) + `dist/index.d.ts` + `dist/client.js` (client bundle, IIFE, inlined into HTML). `package.json` `exports`/`main`/`types` → point to `dist/`.

TDD discipline: P2, P3, P5 — pure logic (parser/transform/server/state) → tests-first. P4, P6, P7 — UI/glue/config/e2e → tests are mandatory by verify time, but the iron-law ordering does not apply. Each phase commits frequently; on every plugin-code change husky auto-bumps the version (P1 sets up the infra).

## Risks

- **Vue component resolution relies on Vue 3 internals** (`el.__vueParentComponent`, `type.__file`). Risk: fragility across Vue minor versions / `__file` missing in some builds. Mitigation: P3 — feature-detect + graceful null, a test for "element outside the app", e2e on a real demo-app (P7).
- **WS through the preview's nginx proxy** may fail to pass the upgrade. Mitigation: Vite HMR already uses WS through the same proxy (so it does pass); P4 — fallback to reconnect, P7 e2e runs the real localhost proxy path.
- **Auto `pnpm add github:` in the SessionStart hook** automatically touches someone else's project (vite.config, package.json). Mitigation: P6 — strict idempotency, a fast no-op if already wired, explicit logging, abort if not vue+vite.
- **Committing `dist/` + auto-bumping the version** could loop husky (commit→bump→commit). Mitigation: P1 — a guard "version already bumped in this staged set" + the hook does not commit itself, only stages; tag happens in post-commit.
- **github-install resolves the latest tag** at wiring time — if there are no tags yet, install will fail. Mitigation: P1 creates a starting tag `v0.0.1`; wire.mjs (P6) — a clear error if there are no tags.
- **Serializing a store/component** can run into cycles/huge/non-serializable values. Mitigation: P3 — safeStringify with a depth/length cap and cycle-guard, tests for cycles and DOM nodes.

---

## Phase 1 — Infra: scaffold, build, auto-versioning, marketplace, README

<!-- circle: status=done order=10 deps=[] autonomy=auto obstacle="" -->

**Phase goal:** a working repo skeleton — an npm package with a buildable `dist/`, auto-versioning via husky, a marketplace manifest, README. Everything else builds on this.

**Approach (chosen):** build via **`tsup`** (bundles TS into `dist/`, two entries — the plugin and the client IIFE bundle, generates `.d.ts`). Rejected: plain `tsc` (doesn't bundle the client into a single file, doesn't produce IIFE), a hand-written rollup config (more boilerplate for the same result). Versioning — **husky pre-commit (bump+sync+rebuild+stage) + post-commit (tag)**; rejected: `changesets`/`semantic-release` (heavy CI flow, needs a registry; we only need a git tag) and conventional-commits parsing (overkill — a default patch is enough).

**Before adding dependencies** (fresh-versions rule): `npm view tsup version`, `npm view husky version`, `npm view typescript version`, `npm view vitest version`, `npm view @modelcontextprotocol/sdk version`, `npm view ws version`. Pin the current latest. Known as of 2026-06-26: `@modelcontextprotocol/sdk@1.29.0`, `ws@8.21.0`, vite latest 8.1.0 (peer set to `>=5`).

**Steps:**

1. Root `package.json`: `name:"vite-plugin-claude-feedback"`, `version:"0.0.1"`, `type:"module"`, `exports:{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"}}`, `main:"./dist/index.js"`, `types:"./dist/index.d.ts"`, `files:["dist","src","claude-plugin"]`, `peerDependencies:{"vite":">=5"}`, `devDependencies` (tsup, typescript, vitest, ws, @types/ws, husky, @vitejs/plugin-vue for tests), `scripts`: `build`,`test`,`test:run`,`prepare:"husky"`,`release`,`check:versions`. Repo package manager — `pnpm`.
2. `tsconfig.json`: strict, `moduleResolution:"bundler"`, `target:"ES2022"`, `lib:["ES2022","DOM","DOM.Iterable"]`, `types:["node"]`.
3. `tsup.config.ts`: two builds — (a) entry `src/plugin/index.ts` → format esm, dts true, platform node; (b) entry `src/client/index.ts` → `dist/client.js`, format iife, platform browser, no dts. At this stage create stubs `src/plugin/index.ts` (`export default function claudeFeedback(){ return { name:'vite-plugin-claude-feedback' } }`) and `src/client/index.ts` (`/* overlay placeholder */`) — so the build passes.
4. Husky: `scripts/version-sync.mjs` (core function: reads `version` from the root `package.json`, writes it into `claude-plugin/.claude-plugin/plugin.json.version` and into `.claude-plugin/marketplace.json` → `plugins[name==="claude-feedback"]` if a `version` field ever appears there), `scripts/check-versions.mjs` (exit 1 if the three versions diverge), `scripts/release.mjs` (arg `patch|minor|major`, bumps the version in the root package.json via semver, calls version-sync). Hooks: `.husky/pre-commit` — if `src/` or `claude-plugin/` is staged AND the version hasn't been bumped in this commit yet (guard: compare HEAD's version to the working one; equal → bump patch), then `node scripts/release.mjs patch` (sync only, no repeat bump, if already done) → `pnpm build` → `git add dist package.json claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json`. `.husky/post-commit` — `git tag "v$(node -p "require('./package.json').version")"` (idempotent: does not fail if the tag already exists).
5. `.claude-plugin/marketplace.json` — as in the spec ("Marketplace manifest" section): `name:"vue-pick-problem-skill"`, `owner:{name:"SI-IC"}`, plugins[0] = `{name:"claude-feedback", source:"./claude-plugin", description:"...", version:"0.0.1"}`.
6. `claude-plugin/.claude-plugin/plugin.json` — a minimal valid one: `{name:"claude-feedback", version:"0.0.1", description:"..."}` (mcpServers/hooks/skills to be filled in by P5/P6).
7. `README.md` — an install section (marketplace add/install + conveyor library), what happens automatically (SessionStart wire), manual `/feedback:setup` `/feedback:remove`, brief usage (Alt+C). It's fine to leave usage details as a link to the spec; install instructions must be complete.
8. `.gitignore`: `node_modules/`, `.claude-feedback/`, `*.log` (do NOT ignore `dist/`).
9. Starting tag: after the phase's first commit, make sure `v0.0.1` exists (the post-commit hook will create it; if not — `git tag v0.0.1`).

**Edge cases:**

- empty: `check-versions.mjs` when a `version` field is missing from some manifest → treat as a divergence, exit 1 naming the file.
- boundary: a repeat commit with no plugin-code changes → pre-commit does NOT bump (guard on staged paths), does not loop.
- concurrency: the post-commit tag already exists → `git tag` fails; wrap with `|| true` plus a check that the tag points at the right commit.
- malformed-input: `release.mjs` with an unknown arg → exit 1 with usage.
- deleted-resource: `claude-plugin/.claude-plugin/plugin.json` is missing during sync → a clear error, exit 1.
- external-failure: `pnpm build` fails inside the hook → the commit is aborted (the hook returns a non-zero code), dist does not get out of sync.

**Verify gate (an executable smoke test, not a type-check):**

1. `pnpm install && pnpm build` → `dist/index.js`, `dist/index.d.ts`, `dist/client.js` exist.
2. `node -e "import('./dist/index.js').then(m=>{ const p=m.default(); if(p.name!=='vite-plugin-claude-feedback') process.exit(1); console.log('plugin ok') })"` → prints `plugin ok`.
3. `node scripts/check-versions.mjs` → exit 0, all three versions match (`0.0.1`).
4. Versioning test: `node scripts/release.mjs patch` → the version becomes `0.0.2` in all three manifests; `node scripts/check-versions.mjs` → exit 0. Revert (`git checkout .`) to stay on `0.0.1`.
5. `git ls-remote --tags . || git tag` shows `v0.0.1` locally.

**Contract for subsequent phases:** build command `pnpm build`, output `dist/{index.js,index.d.ts,client.js}`; `package.json exports`; auto-versioning is active (phases just commit, the version bumps itself). `next step: P2 and P3 can start in parallel after P1 (both deps=[1]).`

---

## Phase 2 — Server: bridge + queue

<!-- circle: status=done order=20 deps=[1] autonomy=auto obstacle="" -->

**Phase goal:** `src/server/bridge.ts` + `src/server/queue.ts` — an HTTP+WS server with a file-backed queue and pending snapshot requests with a timeout. Pure backend logic → TDD.

**Approach (chosen):** a single `http.Server` + `ws.WebSocketServer` in `noServer` mode, upgrading on the path `/__claude_feedback/ws`; the bridge exports `createBridge(opts)` (for mounting into Vite via `httpMiddleware`/`handleUpgrade`, P4) and `createStandaloneBridge(opts)` (for tests/smoke — spins up its own http server on top of `createBridge`). Rejected: a separate port just for WS (an extra listener, worse behavior through the proxy) and Vite's `server.ws` (that's the HMR channel, reusing it is fragile). Queue — **append-only JSONL** in `.claude-feedback/queue.jsonl` + an in-memory mirror; ack marks `acked:true` by appending a tombstone line (compacted on read). Rejected: rewriting the whole file on every ack (races, loss on crash).

**Files:** Create `src/server/queue.ts`, `src/server/bridge.ts`, `src/server/types.ts`; Test `tests/unit/queue.test.ts`, `tests/unit/bridge.test.ts`.

**Interfaces (Produces — consumed by P4/P5):**

- `types.ts`: `FeedbackPayload` (fields from the spec), `ConsoleEntry{level,ts,text}`, `SnapshotRequest{requestId,kind:'store'|'component'|'console',args:any}`, `BridgeInfo{port,pid,startedAt,version}`.
- `queue.ts`: `createQueue(dir:string)` → `{ append(p:Omit<FeedbackPayload,'id'|'ts'>&{tabId:string}):FeedbackPayload; readPending(ack:boolean):FeedbackPayload[]; size():number }`. `append` assigns `id` (`fb_`+monotonic counter+random suffix — no `Date.now` ban here, use `process.hrtime.bigint()` and `crypto.randomUUID()`), `ts` (`Date.now()` — allowed at runtime, the ban only applies to workflow scripts; fine in ordinary Node code).
- `bridge.ts`: `createBridge(opts:{queueDir:string, version:string, requestTimeoutMs?:number})` → an object `{ handleUpgrade(req,socket,head), httpMiddleware(req,res,next), writeBridgeInfo(port), requestSnapshot(kind,args):Promise<any>, status():BridgeInfo&{browserConnected:boolean,tabs:string[],queueSize:number}, close() }`. `requestSnapshot` sends a WS `request` to the first connected tab, waits for a `reply` matched by `requestId` with a timeout (default 10000ms) → resolve data / reject `{code:'timeout'|'browser_not_connected'}`.
- `bridge.ts` (test/smoke helper): `createStandaloneBridge(opts)` → `{ bridge, server:http.Server, port:number, close() }` — spins up its own `http.createServer`, attaches `bridge.httpMiddleware` and `bridge.handleUpgrade`, listens on a free port.

**Steps (TDD):**

1. Test `queue.test.ts`: append→readPending(false) returns the item with id/ts assigned; readPending(true) acks it and a repeat readPending is empty; recreating `createQueue` on the same dir sees the unacked items (file-backed); a corrupted line in the jsonl is skipped without crashing. Run it — fail.
2. Implement `queue.ts` minimally until green. Body-size cap is not here (it's in the bridge).
3. Test `bridge.test.ts` (use `createStandaloneBridge` on top of `http.createServer`): (a) `POST /__claude_feedback/message` with a payload → 200 `{id}`, queue size=1; (b) `GET /__claude_feedback/api/feedback?ack=1` → `{items:[...]}` then empty; (c) `requestSnapshot('store',{})` with no browser connected → reject `browser_not_connected`; (d) with a fake WS client (`ws` in the test) that sends a `reply` on `request` → resolves with data; (e) the WS client stays silent → reject `timeout` (test with `requestTimeoutMs:50`); (f) the `POST /message` body > cap (e.g. 5MB) → 413. Run it — fail.
4. Implement `bridge.ts` until green: a middleware router by path, WS upgrade + a tab registry (`Map<tabId,ws>`), pending `Map<requestId,{resolve,reject,timer}>`, a body-size cap, `writeBridgeInfo` writes `.claude-feedback/bridge.json` atomically (tmp+rename).
5. Run the whole module: `pnpm test:run tests/unit`.
6. Commit (husky auto-bumps the version + rebuilds dist).

**Edge cases (with behavior):**

- empty: `readPending` on an empty/nonexistent queue → `[]` (degrade).
- boundary: a payload exactly at the cap boundary → passes; +1 byte → 413 (reject).
- concurrency: two `requestSnapshot` calls at once → different `requestId`s, replies matched independently; a reply with an unknown `requestId` → ignored (does not crash).
- external-failure: the WS client dropped while waiting (`close`) → the pending request for that tab rejects `browser_not_connected`, the timer is cleared.
- malformed-input: invalid JSON in `POST /message` → 400; a WS message without `type` → ignored.
- deleted-resource: `queue.jsonl` is deleted between append and read → readPending does not crash, returns the in-memory mirror.
- permission: writing `bridge.json` into a read-only dir → log an error, the bridge keeps going (snapshot requests still work, only discovery degrades) — do not crash the dev server.

**Verify gate (an executable smoke test):** the script `tests/smoke/bridge-smoke.mjs` (to be committed): spins up `createStandaloneBridge`, calls `writeBridgeInfo`, actually hits (via `node:http`) `POST /message` + `GET /api/feedback?ack=1`, connects a real `ws` client, runs one `requestSnapshot('console',{})` round-trip → prints `bridge-smoke ok`. Run: `node tests/smoke/bridge-smoke.mjs`. Plus `pnpm test:run tests/unit` green.

**Contract for subsequent phases:** the HTTP/WS API and signatures above are fixed. `next step: P4 mounts the bridge into Vite via httpMiddleware/handleUpgrade in configureServer; P5 (MCP) hits /__claude_feedback/api/* over the localhost port from bridge.json.`

---

## Phase 3 — Client collectors: resolve-component, console-tap, snapshot

<!-- circle: status=done order=30 deps=[1] autonomy=auto obstacle="" -->

**Phase goal:** three pure client-side modules for collecting context. TDD on jsdom/happy-dom.

**Approach (chosen):** component resolution — walk up via `el.__vueParentComponent` (Vue 3 internal `ComponentInternalInstance`), until the first one with `type.__file`; the name comes from `type.name || type.__name || basename(__file)`. Rejected: parsing the `data-v-` scope-id (gives no name/file) and depending on Vue DevTools being installed (not guaranteed). Console-tap — a **tee** (wrap, still call the original), a fixed-size ring buffer. Store snapshot — via Pinia on the devtools hook `window.__VUE_DEVTOOLS_GLOBAL_HOOK__` → `app._instance.appContext.config.globalProperties.$pinia` or `pinia._s` (a Map of stores); serialization — `safeStringify` with a depth/length cap + cycle-guard + stripping functions/DOM. Rejected: `JSON.stringify` directly (fails on cycles, drags in DOM).

**Files:** Create `src/client/resolve-component.ts`, `src/client/console-tap.ts`, `src/client/snapshot.ts`, `src/client/safe-stringify.ts`; Test `tests/unit/resolve-component.test.ts`, `tests/unit/console-tap.test.ts`, `tests/unit/snapshot.test.ts`. Test environment — vitest `environment:'happy-dom'` (add to the `tsup`/vitest config; happy-dom is already familiar from the conveyor frontend).

**Interfaces (Produces — consumed by P4):**

- `resolveComponent(el:Element|null):{ name:string, file:string|null, chain:string[] } | null`
- `installConsoleTap(size?:number):{ getBuffer():ConsoleEntry[]; dispose():void }` (size default 200; wraps `console.{log,info,warn,error,debug}` + `window`'s `error`/`unhandledrejection`)
- `describeElement(el:Element):{ tag:string, classes:string[], text:string, selector:string }` (in the same `resolve-component.ts` or a separate `describe-element.ts` — selector: a stable nth-of-type CSS path)
- `snapshotStore(args:{store?:string}):{ store:string, state:any } | { stores:string[] } | { error:'not_found', available:string[] }`
- `snapshotComponent(args:{selector?:string, last?:boolean}, lastEl?:Element):{ name:string, props:any, state:any } | { error:'not_found' }`
- `safeStringify(value:any, opts?:{maxDepth?:number,maxLen?:number}):any` (returns a value already safe for JSON)

**Steps (TDD):**

1. `safe-stringify.test.ts`: a cycle (`a.self=a`) → doesn't crash, marks it `'[Circular]'`; depth > maxDepth → `'[MaxDepth]'`; a function → `'[Function]'`; a DOM node → `'[DOM:tag]'`; a long string gets truncated. Implement until green.
2. `resolve-component.test.ts`: build a fake DOM where the element's `__vueParentComponent` chain has `type.__file`/`type.name` → correct `name/file/chain`; an element with no Vue instance (outside the app) → `null`; `describeElement` yields tag/classes/text/selector, and the selector finds the same element via `querySelector`. Implement.
3. `console-tap.test.ts`: logging past size → the buffer rings (old entries evicted); `console.error` and an emulated `window.dispatchEvent(new ErrorEvent('error',...))`/`unhandledrejection` land in the buffer; the original `console.log` is still called (spy); `dispose()` removes the wrappers. Implement.
4. `snapshot.test.ts`: simulate `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`/a `pinia._s` Map with a fake store → `snapshotStore({store:'x'})` returns the state; without `store` → a list of ids; a nonexistent id → `{error:'not_found',available}`; a store with a cycle in its state → doesn't crash (via safeStringify); `snapshotComponent` by selector pulls props/state from `__vueParentComponent`. Implement.
5. `pnpm test:run tests/unit` green. Commit.

**Edge cases (with behavior):**

- empty: `resolveComponent(null)` → null; an empty store → `state:{}`.
- boundary: buffer size=0 → doesn't write, doesn't crash; a selector for an element with no parent (`<html>`) → a correct path.
- concurrency: several `installConsoleTap` calls in a row → each layers its own wrapper on top; `dispose` removes only its own (keep the previous reference) — degrade, don't duplicate into a single buffer.
- external-failure: `__VUE_DEVTOOLS_GLOBAL_HOOK__` is missing → `snapshotStore` → `{stores:[]}` / a clear `{error:'no_pinia'}` (no throw).
- malformed-input: `snapshotComponent({selector:'>>>bad'})` → `querySelector` throws → caught, `{error:'not_found'}`.
- deleted-resource: the selector points at an element removed from the DOM → `{error:'not_found'}`.
- browser/UX: an element inside the app's Shadow DOM → resolution returns null gracefully (document the limitation).

**Verify gate (an executable smoke test):** `pnpm test:run tests/unit/resolve-component.test.ts tests/unit/console-tap.test.ts tests/unit/snapshot.test.ts tests/unit/safe-stringify.test.ts` — all green (this is itself executing the code on happy-dom). Additionally, `node -e "/* import dist? no — this is client TS */"` is not needed; the modules are checked by the tests.

**Contract for subsequent phases:** the signatures above are the collectors' public API for the overlay. `next step: P4 imports resolveComponent/describeElement/installConsoleTap to assemble FeedbackPayload, and snapshotStore/snapshotComponent to answer the WS request.`

---

## Phase 4 — Client overlay + Vite plugin entry

<!-- circle: status=done order=40 deps=[2,3] autonomy=auto obstacle="" -->

**Phase goal:** the client overlay (Alt+C, modal, element picker, WS client, payload assembly, answering snapshot requests) + the Vite plugin entry that injects the client bundle and mounts the bridge into the dev server. After this phase the tool works end-to-end on the dev server.

**Approach (chosen):** the overlay renders into a **Shadow DOM** (style isolation both ways), a single root `<div id="__claude_feedback_root">` with `attachShadow`. The UI uses native DOM (no Vue, so as not to conflict with the app and not to bloat the bundle). Default hotkey **Alt+C** (`e.altKey && e.code==='KeyC'`), configurable. Element picker — capture-phase listeners on `document`, highlighting via an absolutely-positioned overlay frame + a tooltip with the component name; a selection click does `preventDefault+stopPropagation` (doesn't reach the app), Esc cancels. Vite entry: `transformIndexHtml` inlines the contents of `dist/client.js` into a `<script>` (with the plugin config via `window.__CLAUDE_FEEDBACK_CFG__`), `configureServer(server)` mounts `bridge.httpMiddleware` onto `server.middlewares` and `bridge.handleUpgrade` onto `server.httpServer.on('upgrade', ...)`, writes `bridge.json` with the actual port (from `server.httpServer.address()` or `server.config.server.port`). `apply:'serve'`. Rejected: injecting via a separate `<script src>` pointed at the bridge port (CORS/proxy pain — inlining is more reliable); rendering the overlay inside the Vue app (version/reactivity conflicts).

**Files:** Create `src/client/index.ts` (bootstrap: cfg, tap, WS, mounting the overlay), `src/client/overlay.ts` (UI: modal+picker), `src/client/ws-client.ts` (reconnect, hello, request→reply handling); Modify `src/plugin/index.ts` (full implementation on top of the P1 stub); Test `tests/unit/plugin-transform.test.ts`, `tests/unit/ws-client.test.ts`.

**Interfaces (Consumes):** from P3 — `resolveComponent`,`describeElement`,`installConsoleTap`,`snapshotStore`,`snapshotComponent`; from P2 — bridge `createBridge` (+ `createStandaloneBridge` for the smoke test), `httpMiddleware`/`handleUpgrade`, HTTP paths, the WS protocol, `FeedbackPayload`.

**Steps:**

1. `plugin-transform.test.ts` (the TDD point for the glue code): call the plugin's default export, run its `transformIndexHtml` hook on minimal HTML → the result contains an inline script with the `__claude_feedback` marker and the serialized cfg; in build mode the hook does not inject (verified through the `config({command:'build'})` gating). Implement the gating + injection in `src/plugin/index.ts`. The client bundle is read from `dist/client.js` (in the dev test — either mock the file read or build before the test; default: the test reads the real `dist/client.js` after `pnpm build`, so the test requires a pre-build — document this in the step).
2. `ws-client.test.ts` (happy-dom + a fake WS): on `request{kind:'console'}` the client calls the collector and sends a `reply` with data; on `request{kind:'store',args:{store:'x'}}` → `snapshotStore`; reconnect on close (a timer). Implement `ws-client.ts`.
3. Implement `overlay.ts`: Shadow DOM, a modal (textarea + "Select element"/"Send"/"Cancel" buttons), an element picker (hover-highlight + a tooltip with the component name from `resolveComponent`, click-select, Esc-cancel), on "Send" assemble the `FeedbackPayload` (url, describeElement, resolveComponent, getBuffer()) and `POST /__claude_feedback/message`.
4. Implement `src/client/index.ts`: read `window.__CLAUDE_FEEDBACK_CFG__`, `installConsoleTap(cfg.consoleBufferSize)`, spin up `ws-client`, wire Alt+C→open the overlay. Keep the "last selected element" for `snapshotComponent({last:true})`.
5. Implement `configureServer` in `src/plugin/index.ts`: mount the bridge middleware + upgrade handler, `writeBridgeInfo(actualPort)`, `closeBundle`/`buildEnd` → `bridge.close()`.
6. `pnpm build && pnpm test:run`. Commit.

**Edge cases (with behavior, incl. browser/UX):**

- empty: "Send" with empty text and no element → allow it (degrade) — a payload goes out with `message:""`, `element:null`, but with the console.
- boundary: a very long text/large buffer → the client sends it as-is, the bridge cap (P2) returns 413 → the overlay shows a "context too large" error, doesn't hang.
- concurrency: Alt+C while the modal is already open → no-op (don't spawn a second one); a double click on "Send" → block the button until the response.
- external-failure: bridge unreachable (POST failed) / WS won't connect → the overlay shows "dev bridge offline", WS auto-reconnects with backoff.
- malformed-input: the app intercepts `keydown` for Alt+C itself → the listener is on `window`'s capture phase, to get it first; a picker click on the overlay itself → ignored (checked via `composedPath`).
- deleted-resource: a snapshot request for an element removed from the DOM → reply `{error:'not_found'}` (from P3).
- browser/UX: switching tabs/refreshing during picking → listeners are removed on `visibilitychange`/`beforeunload`; back-button — the overlay does not persist across navigations (SPA re-render — the overlay reinitializes from `index.ts`); offline — POST fails gracefully.
- prod: `vite build` → nothing gets injected (the test from step 1).

**Verify gate (an executable smoke test):** a mini Vite project in `tests/smoke/dev-app/` (a single `index.html` + `main.ts` + a vite.config with the plugin), driven by a headless Playwright script `tests/smoke/overlay-smoke.mjs`: `npx playwright install chromium` (if needed) → start vite dev (on a free port) → open the page → check HTTP 200 for the document, console clean, the DOM has a shadow root `#__claude_feedback_root` → emulate Alt+C → the modal is visible → enter text, "Send" → `GET /__claude_feedback/api/feedback?ack=1` (over the localhost port) returns a payload with the right `url` and a non-empty `console`. Prints `overlay-smoke ok`. (This is a committed e2e seed; a full demo-app is P7.)

**Contract for subsequent phases:** the tool works on the dev server; `bridge.json` is written with the real port. `next step: P7 reuses this smoke test on a full demo-app with Pinia; P5/P6 don't depend on the UI and could run in parallel.`

---

## Phase 5 — MCP server (stdio → bridge)

<!-- circle: status=done order=50 deps=[2] autonomy=auto obstacle="" -->

**Phase goal:** `claude-plugin/mcp-server.mjs` — a stdio MCP server (via `@modelcontextprotocol/sdk`), a thin HTTP client to the bridge; finds the bridge via `.claude-feedback/bridge.json`. No state of its own.

**Approach (chosen):** `@modelcontextprotocol/sdk`'s `McpServer` + `StdioServerTransport`. Each tool: read `bridge.json` (from `CLAUDE_PROJECT_DIR` or cwd → `.claude-feedback/bridge.json`), hit the corresponding localhost bridge endpoint via `node:http`. If the file is missing / the bridge doesn't respond → a structured "dev server not running" error. Rejected: an HTTP MCP transport (decided in the spec — stdio is more robust for the CC plugin); caching the port in memory (the port changes on a dev restart — read the file every time).

**Files:** Create `claude-plugin/mcp-server.mjs`, `claude-plugin/lib/bridge-client.mjs`; Test `tests/unit/mcp-bridge-client.test.mjs`. (`.mjs` — independent of the Vite plugin build; run directly by node, hence no TS build, so the CC plugin doesn't depend on the Vite package's `dist/`.)

**Interfaces (Produces — consumed by the P6 manifest):** executable `node claude-plugin/mcp-server.mjs` (stdio MCP). Tools:

- `get_feedback` → `GET /__claude_feedback/api/feedback?ack=1` → `{items}`.
- `request_store_snapshot {store?}` → `POST /api/request {kind:'store',args:{store}}`.
- `request_component_snapshot {selector?,last?}` → `POST /api/request {kind:'component',args}`.
- `request_console {level?}` → `POST /api/request {kind:'console',args:{level}}`.
- `feedback_status` → `GET /api/status`.
  `bridge-client.mjs`: `readBridgeInfo(projectDir)`,`callBridge(method,path,body?)` → `{ok,data}|{error}`.

**Steps (TDD where possible):**

1. `mcp-bridge-client.test.mjs` (node:test or vitest): spin up a fake http server, write `bridge.json` into a temp dir → `callBridge('GET','/__claude_feedback/api/status')` returns data; `bridge.json` missing → `{error:'bridge_not_running'}`; the bridge responds 500 → `{error:'bridge_error'}`; connection refused → `{error:'bridge_not_running'}`. Implement `bridge-client.mjs`.
2. Implement `mcp-server.mjs`: register 5 tools, each mapping to `callBridge` and wrapping bridge errors into a human-readable MCP response (no throw — return `content` explaining "ask the user to start the dev server").
3. Smoke-test by starting the server (see verify). Commit.

**Edge cases:**

- empty: `get_feedback` on an empty queue → `{items:[]}` (not an error).
- boundary: `bridge.json` exists, but the port is already taken by another process → `callBridge` gets the wrong response/refused → `bridge_not_running`.
- concurrency: two tool calls in a row → independent http requests, no shared state.
- external-failure: the bridge times out a snapshot → the bridge returns `{error:'timeout'}`, MCP surfaces it as "the browser didn't respond, is the preview open?".
- malformed-input: `bridge.json` is corrupted JSON → `bridge_not_running` (no throw).
- deleted-resource: `bridge.json` is deleted between reading and the request → `bridge_not_running`.
- permission: no permission to read `bridge.json` → the same friendly error.

**Verify gate (an executable smoke test):** `tests/smoke/mcp-smoke.mjs` — spin up `createStandaloneBridge` (from P2's dist? no — the bridge is TS; for the smoke test spin up a fake http server that answers `/api/status` and `/api/feedback`), write `bridge.json`, then launch `mcp-server.mjs` as a child process with a stdio transport and send MCP `initialize` + `tools/list` + call `feedback_status` → verify a status came back. Minimal variant (if spinning up an MCP client is expensive): `node -e` importing `bridge-client.mjs` with a real round-trip to the fake bridge + `node --check claude-plugin/mcp-server.mjs` (syntax) + launching `mcp-server.mjs` with an immediate `tools/list` via `@modelcontextprotocol/sdk`'s Client over `StdioClientTransport`. Default: a full MCP round-trip; fall back to the bridge-client round-trip + `--check` if the sdk-client harness doesn't start up in reasonable time. Prints `mcp-smoke ok`.

**Contract for subsequent phases:** `claude-plugin/mcp-server.mjs` is a working stdio MCP. `next step: P6 registers it in plugin.json's mcpServers as command "node ${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs".`

---

## Phase 6 — CC plugin: manifest, SessionStart hook, wire/unwire, skill, commands

<!-- circle: status=done order=60 deps=[5] autonomy=auto obstacle="" -->

**Phase goal:** package the Claude Code plugin — `plugin.json` (mcpServers+hooks+skills+commands), the SessionStart auto-wiring hook, `wire.mjs`/`unwire.mjs`, a skill, and three commands.

**Approach (chosen):** the SessionStart hook is a shell script `hooks/session-start.sh` that calls `node ${CLAUDE_PLUGIN_ROOT}/scripts/wire.mjs` (idempotently). `wire.mjs`: detects vue+vite in `CLAUDE_PROJECT_DIR`; if already wired (grep for `vite-plugin-claude-feedback` in vite.config AND the dep in package.json) → a fast no-op; otherwise `pnpm/npm/yarn add -D github:SI-IC/vue-pick-problem-skill#<latest-tag>` (resolving the latest tag via `git ls-remote --tags --refs https://github.com/SI-IC/vue-pick-problem-skill`) + an idempotent patch to vite.config (AST via `@babel/parser`? — no, keep it free of heavy deps: a regex insert of the import + adding `claudeFeedback()` into `plugins:[` with a check that it isn't there yet). Rejected: an AST transformer (drags babel into the CC plugin just for a simple insertion — a regex with an idempotency guard is enough for typical `vite.config` files); running install from the hook itself synchronously-blocking (can't be done in the background — but install is quick and one-off, so synchronous with logging is fine).

**Files:** Create `claude-plugin/hooks/session-start.sh`, `claude-plugin/scripts/wire.mjs`, `claude-plugin/scripts/unwire.mjs`, `claude-plugin/scripts/lib/vite-config-patch.mjs`, `claude-plugin/skills/claude-feedback/SKILL.md`, `claude-plugin/commands/feedback.md`, `claude-plugin/commands/feedback-setup.md`, `claude-plugin/commands/feedback-remove.md`; Modify `claude-plugin/.claude-plugin/plugin.json` (add mcpServers/hooks/skills/commands on top of the P1 stub); Test `tests/unit/vite-config-patch.test.mjs`, `tests/unit/wire-detect.test.mjs`.

**Interfaces:** `vite-config-patch.mjs`: `addPlugin(source:string):{changed:boolean,result:string}`, `removePlugin(source:string):{changed:boolean,result:string}` — idempotent string transformations. `wire.mjs`/`unwire.mjs` — CLIs (reading `CLAUDE_PROJECT_DIR`/cwd).

**Steps (TDD on the transformations):**

1. `vite-config-patch.test.mjs`: a typical `vite.config.ts` input (`import vue from '@vitejs/plugin-vue'; export default defineConfig({plugins:[vue()]})`) → `addPlugin` inserts the import and `claudeFeedback()` into the array; a repeated `addPlugin` → `changed:false` (idempotent); `removePlugin` removes both insertions; a variant with an empty `plugins: []`; a variant where the array spans multiple lines. Implement `vite-config-patch.mjs`.
2. `wire-detect.test.mjs`: a fake project dir with `package.json` (vue+vite) + `vite.config.ts` → detect "vue+vite:true, wired:false"; after adding the dep+insertion → "wired:true"; a project without vite → "not_vite" (an abort reason). Implement the detect part of `wire.mjs` (factor out a pure `inspectProject(dir)` function for testability; the install/git part is a thin wrapper, not covered by unit tests, verified in P7).
3. Write `wire.mjs` (inspectProject + install + patch + logging), `unwire.mjs` (patch.removePlugin + uninstall dep). Install picks the package manager by lockfile (`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`).
4. `hooks/session-start.sh`: `#!/usr/bin/env bash`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/wire.mjs"` with `|| true` (never break session start) + logging to stderr.
5. `plugin.json`: `mcpServers:{ "claude-feedback":{ "command":"node", "args":["${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs"] } }`, `hooks:{ "SessionStart":[{ "hooks":[{ "type":"command", "command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\"" }] }] }`, `skills:"./skills/"`, `commands:"./commands/"`. The version is synced by husky.
6. `SKILL.md` (`claude-feedback`): when/how — "when the user mentions they sent feedback from the preview, or asks you to take a look — call `get_feedback`; process each item (url/element/component/console); if needed, call `request_store_snapshot`/`request_component_snapshot`/`request_console`; for large features/breaking changes while working on the plugin itself, call `pnpm release minor|major`".
7. Commands: `feedback.md` (call `get_feedback` and start working), `feedback-setup.md` (run wire.mjs), `feedback-remove.md` (run unwire.mjs).
8. `pnpm test:run`. Commit.

**Edge cases:**

- empty: an empty `vite.config` with no `plugins` key → `addPlugin` adds `plugins:[claudeFeedback()]` (boundary), or if the structure is unrecognized → log "patch failed, add manually: …", don't crash.
- boundary: `vite.config.js`/`.mjs`/`.ts` — detect across all extensions; multiple configs → the first one found, logged.
- concurrency: two sessions start in parallel, both call wire → the idempotency guard + `pnpm add` are safe to repeat (no-op if the dep is present); the patch repeats as `changed:false`.
- external-failure: `git ls-remote` is unreachable (no network) → wire logs "couldn't resolve the tag, skipping install" and doesn't crash (the hook has `|| true`); `pnpm add` fails → log, abort wiring, session start continues.
- malformed-input: a vite.config with exotic syntax where the regex doesn't match `plugins:[` → a log with manual-insertion instructions, exit 0.
- deleted-resource: no `package.json` → "not a node project", no-op.
- permission: no permission to write vite.config → a log error, no-op (don't break the session).

**Verify gate (an executable smoke test):** `tests/smoke/wire-smoke.mjs` — create a temp project dir (package.json vue+vite + vite.config.ts), run `node claude-plugin/scripts/wire.mjs` with `CLAUDE_PROJECT_DIR=<tmp>` and a **mocked install** (env flag `CLAUDE_FEEDBACK_SKIP_INSTALL=1`, to avoid hitting the network) → verify vite.config is patched (contains `claudeFeedback`); then `unwire.mjs` → vite.config reverts to the original. Plus validate the manifest: `node -e "JSON.parse(fs.readFileSync('claude-plugin/.claude-plugin/plugin.json'))"` succeeds and contains mcpServers+hooks. Prints `wire-smoke ok`. Plus `pnpm test:run` green.

**Contract for subsequent phases:** the CC plugin is fully built and installable via the marketplace. `wire.mjs` supports `CLAUDE_FEEDBACK_SKIP_INSTALL=1` for tests. `next step: P7 sets up a real demo-app, runs the full e2e (Alt+C → get_feedback → snapshot).`

---

## Phase 7 — demo-app + e2e harness

<!-- circle: status=done order=70 deps=[4,5,6] autonomy=auto obstacle="" -->

**Phase goal:** a full-fledged Vue 3 + Vite + Pinia demo application and a committed headless e2e that runs the whole flow, including a Pinia store snapshot and the MCP tools.

**Approach (chosen):** `examples/demo-app/` — a minimal Vite-Vue app with a Pinia store (`counter`) and a couple of components, wiring in the local plugin via `vite-plugin-claude-feedback` (a file link to the repo root, not github — for development). E2E on **headless Playwright** (mirrors the workflow-rules verify discipline), harness in `tests/e2e/`. Rejected: e2e via an MCP client from the sdk on top of a running dev server (more expensive) — hitting the bridge's `/api/*` directly over localhost is enough to verify the contract, and the MCP layer is covered by the P5 smoke test.

**Files:** Create `examples/demo-app/` (`package.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/App.vue`, `src/components/Counter.vue`, `src/stores/counter.ts`), `tests/e2e/feedback.e2e.mjs`, `tests/e2e/README.md`, `scripts/e2e.sh`.

**Interfaces (Consumes):** the Vite plugin (P4) via a local link; the bridge `/api/*` (P2); collectors/overlay (P3/P4); `snapshotStore` against a real Pinia (P3).

**Steps:**

1. Build `examples/demo-app` (vue+vite+pinia, a `counter` store with `count`/`increment`, Counter.vue uses the store, App.vue mounts it). vite.config wires in `claudeFeedback()` via a relative import of the root `dist/` (or a `file:..` dependency). `npm view` the vue/vite/pinia/@vitejs/plugin-vue versions before adding them (fresh).
2. `scripts/e2e.sh`: `pnpm build` (root) → start the demo dev server on a free port (in the background, wait for it to be ready over HTTP) → `node tests/e2e/feedback.e2e.mjs PORT` → kill the dev server.
3. `feedback.e2e.mjs` (Playwright chromium): open the demo → assert HTTP 200, console clean, a shadow root is present. Emulate Alt+C → the modal. Enable the picker → click the Counter button → assert the tooltip/selection shows the `Counter` component. Enter text → "Send". Read the demo's `bridge.json` → `GET http://localhost:<bridgePort>/__claude_feedback/api/feedback?ack=1` → assert the payload: `url` is correct, `component.name==='Counter'`, `component.file` contains `Counter.vue`, `element.tag==='button'`, `console` is present. Then click increment in the UI, `POST /api/request {kind:'store',args:{store:'counter'}}` → assert `state.count` reflects the clicks. Assert `vite build` for the demo does not inject the overlay (a separate check: build the demo, grep `dist` for absence of `__claude_feedback`). Print `e2e ok`.
4. Document the test-running strategy in `README.md`/a root doc if the full suite takes > 2 min.
5. Commit (the harness lives in the repo — it gets reused).

**Edge cases (e2e covers real ones):**

- empty: sending with no selection and no text → a payload with `element:null`, `message:''`, `console` non-empty — assert accepted.
- boundary: a large console buffer (generate >200 logs in the demo) → the payload has exactly the last N (a ring).
- concurrency: two snapshot requests in a row over localhost → both correct.
- external-failure: stop the dev server and hit `/api/feedback` → connection refused (demonstrates that MCP would return `bridge_not_running`).
- malformed-input: `POST /api/request` with a nonexistent store `{store:'nope'}` → `{error:'not_found',available:['counter']}`.
- deleted-resource: `request_component_snapshot {selector:'#gone'}` → `{error:'not_found'}`.
- browser/UX: refreshing the demo → the overlay reinitializes, WS reconnects, a repeat Alt+C works.
- prod: demo `vite build` → no injection (asserted in step 3).

**Verify gate (an executable smoke test):** `bash scripts/e2e.sh` → `e2e ok`, exit 0. This is itself the full end-to-end run on a real vue+vite+pinia stack. Plus the whole `pnpm test:run` green. If playwright-chromium isn't installed — `npx playwright install chromium` (part of the harness, not a reason to give up).

**Contract:** the tool is verified end-to-end; the harness is committed. `next step: the version tag is current (husky); the repo is ready for `git push --follow-tags` and installation via the marketplace.`

---

## Log

### Phase 1 — Infra (done, 2026-06-26)

Built the repo skeleton: `package.json` (exports/main/types→`dist/`, peer `vite>=5`), `tsconfig.json`+`tsconfig.dts.json`, versioning scripts (`version-sync.mjs`/`check-versions.mjs`/`release.mjs` — plain Node, inline semver bump, no deps), husky `.husky/{pre-commit,post-commit}`, `.claude-plugin/marketplace.json`, `claude-plugin/.claude-plugin/plugin.json` (with a `version` field), a README with install instructions, `.gitignore` (dist is NOT ignored).

**Deviation from the plan (important for P2+):** the plan named **tsup** as the bundler, but tsup is ABSENT from this machine's offline pnpm store, and the network to npm is extremely slow/flaky. However `esbuild@0.27.2` + `typescript@5.9.3` (and all the other deps) ARE in the store. So the build was done via **esbuild (bundle) + tsc (dts)** in `scripts/build.mjs` — the contract is identical: `pnpm build` → `dist/{index.js (ESM, ws will be bundled), client.js (IIFE), index.d.ts}`. `tsup.config.ts` was NOT created. For P2+ this is transparent: the build command and output are the same. If a tsup feature is needed later — add it as a devDep once the network is available.

**Installing deps:** `pnpm install --offline` fails (the metadata mirror is empty for most packages), but `pnpm install --prefer-offline` works in ~10s (tarballs from the store, metadata from the network — the network is fast once warmed up, 1–4s/package). Version pins are EXACT (matching the store). `@modelcontextprotocol/sdk` (needed by P5) and `tsup` are ABSENT from the store — P5 will require a network install of the sdk (the network works).

**Verify (all green, actually executed):** `pnpm build` → three dist files; `import('./dist/index.js').default().name` === `vite-plugin-claude-feedback` ("plugin ok"); `check-versions` exit 0; `release.mjs patch` → 0.0.2 in all 3 manifests → revert → 0.0.1; edge: bad-arg→exit1, divergence→exit1, `test:run`→passWithNoTests exit0. The `v0.0.1` tag was created by the post-commit hook on the first commit. **Extra auto-versioning smoke test (a contract for all subsequent phases):** a second commit with a `src/` change → pre-commit actually bumped 0.0.1→0.0.2, synced the manifests, rebuilt+staged `dist/`, post-commit set `v0.0.2`; the tree is clean, both tags are in place. The first commit (no HEAD version = the working one) does NOT bump — the guard works.

**No rollbacks.** The repo is currently on `v0.0.2` (the starting `v0.0.1` also exists — step 9's requirement is satisfied). Commits: `38e9c25` (scaffold) + `ca2c1c3` (named export, also verified the bump path).

**Next step:** P2 and P3 can start in parallel (both deps=[1]). Build command `pnpm build`, output `dist/{index.js,index.d.ts,client.js}`, auto-versioning is active (just commit — the version bumps itself). Heads-up for P2: the bridge will pull in `ws` (8.19.0 in the store) — esbuild with `platform:node` bundles ws into `dist/index.js`, node builtins stay external, `vite` is external too. Heads-up for P5: `@modelcontextprotocol/sdk` is NOT in the offline store — budget time for a network install.

### Phase 2 — Server: bridge + queue (done, 2026-06-26)

Built: `src/server/types.ts` (FeedbackPayload/ConsoleEntry/SnapshotRequest/BridgeInfo per the spec), `src/server/queue.ts` (`createQueue(dir,{maxItems})` — append-only JSONL + tombstone-ack `{__ack:id}`, an in-memory mirror, replay skipping corrupted lines, drop-oldest cap at maxItems=1000), `src/server/bridge.ts` (`createBridge`/`createStandaloneBridge`). Bridge: a single http router + a single `WebSocketServer({noServer})`, upgrading strictly on `/__claude_feedback/ws`; `requestSnapshot` sends a WS `request` to the first connection, waits for a `reply` matched by requestId with a timeout (default 10000, tested at 50ms), reject `{code:'timeout'|'browser_not_connected'}`; HTTP: `POST /message` (cap→413, bad-json→400), `GET /api/feedback?ack=1`, `POST /api/request` (kind validation→400), `GET /api/status`; `writeBridgeInfo` atomically (tmp+rename), does not crash on an unwritable dir.

**Contract clarifications (important for P4/P5):**

- `createStandaloneBridge(opts)` returns a **Promise** of `{bridge,server,port,close}` (the port is only known after `listen`) and calls `writeBridgeInfo(port)` ITSELF after bind — mirroring what P4 will do in `configureServer`.
- WS protocol as planned: the reply travels **over WS** (`{type:'reply',requestId,data?,error?}`), NOT via `POST /reply` (the spec mentioned POST — the plan overrode it, and I followed the plan).
- A snapshot failure is returned with HTTP **200** + `{error:code}` (the bridge did its job, the browser didn't); bridge-level errors (missing file/refused) are already the concern of the P5 bridge-client.
- The `tabs` registry is keyed by the **server-side connId**, not the client's `tabId` (that one only appears in `status().tabs`). The P4 client sends `hello{tabId,url}` as usual.

**Verify-gate deviation (keep in mind for P5):** the plan called for a smoke test that "spins up createStandaloneBridge from dist" — but in P2 the `dist/index.js` build only bundles the plugin (it does NOT import the bridge yet, that's P4), there's no server JS in dist. So the `tests/smoke/bridge-smoke.mjs` smoke test bundles `src/server/bridge.ts` itself via esbuild into a temp ESM module and runs a real round-trip (POST→ack→WS snapshot). **Gotcha (a must for P4):** esbuild's ESM output wraps `ws`'s `require()` in a shim that fails with `Dynamic require of "events"`. The fix — a banner `import {createRequire as __cr} from 'module'; const require=__cr(import.meta.url);`. It's present in the smoke test; **once P4 makes `scripts/build.mjs` bundle the bridge into `dist/index.js` (ESM) — the same banner must land in build.mjs**, otherwise the runtime plugin will crash on dev-server startup.

**Self-review (1 pass, 2 subagents):** applied — a connId-keyed registry (fixes ABA/eviction on a duplicate tabId), a loopback+Host allowlist on `/api/*` (protection against `--host` exposure and DNS rebinding), WS `maxPayload=256K`, a queue `maxItems` cap (DoS), kind validation, mkdir once, a sendJson stringify guard, exact ws-path matching, ws error logging. **Deferred to P4/P5 (justified):** an Origin allowlist on the WS upgrade — needs the expected origin from the Vite config, which only P4 has (the connId key already removed the eviction vector; the only remaining risk is "an attacker tab answers the snapshot", which requires winning a first-tab race); per-field shape validation of element/component and demarcating untrusted data for the LLM — that's the surface of P4 (the payload contract) and P5 (MCP). JSONL compaction on disk is an explicit design decision from the plan (append-only + tombstone), not a defect.

**Verify (all green, actually executed):** `pnpm test:run tests/unit` → 26 passed (queue 9 + bridge 17, incl. edge cases: empty/boundary/concurrency/external-failure/permission/malformed-input/deleted-resource); `node tests/smoke/bridge-smoke.mjs` → `bridge-smoke ok`; `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → three dist files. **No rollbacks.** Husky on commit `c139e33` bumped 0.0.2→0.0.3, rebuilt dist, tag `v0.0.3`.

**Next step:** P4 (deps[2,3]) mounts the bridge into Vite: `configureServer(server)` → `server.middlewares.use(bridge.httpMiddleware)` + `server.httpServer.on('upgrade', bridge.handleUpgrade)` + `bridge.writeBridgeInfo(actualPort)`; `buildEnd/closeBundle`→`bridge.close()`. DON'T forget the createRequire banner in `scripts/build.mjs` (see the gotcha above). P5 (deps[2]) hits `/api/*` over localhost from bridge.json; remember the loopback+Host gate — the MCP client sends Host `127.0.0.1:<port>`.

### Phase 3 — Client collectors (done, 2026-06-27)

Built 4 pure client-side modules (consumed by P4): `src/client/safe-stringify.ts` (`safeStringify(value,{maxDepth=6,maxLen=5000,maxNodes=50000})` — cycle-guard via an ancestor Set, a node budget against wide/DAG DoS, NaN/±Inf→strings, Date/RegExp/Error→readable, Map with object keys→`[key#i]` without collisions, `__proto__`-safe assign, DOM→`[DOM:tag]`, fn/symbol/bigint placeholders); `src/client/resolve-component.ts` (`resolveComponent(el)` — walks up via `el.__vueParentComponent.parent` until the first one with `type.__file`, name `name||__name||basename(__file)`, guard 1000; `describeElement(el)` — tag/classes/trimmed-text/CSS-path with `:nth-of-type` and an `#id` short-circuit; exports `componentName(inst)` for P4); `src/client/console-tap.ts` (`installConsoleTap(size=200)` — a tee wrapper for `console.{log,info,warn,error,debug}` + window's `error`/`unhandledrejection`, a ring buffer, per-entry cap 8000, LIFO dispose restores the install-time originals); `src/client/snapshot.ts` (`snapshotStore({store?})`/`snapshotComponent({selector?,last?},lastEl?)` — Pinia via `__VUE_DEVTOOLS_GLOBAL_HOOK__` (apps→`app.config.globalProperties.$pinia` / `_instance.appContext`), structured-error degrade `no_pinia`/`not_found`+available, querySelector in a try/catch).

**Contract clarifications (important for P4):**

- `resolveComponent` returns a `ComponentDescriptor` (from `src/server/types.ts`) — `{name, file:string|null, chain:string[]}`; `null` when `el===null` OR `__vueParentComponent` is absent (an element outside the Vue app / Shadow DOM). `file` is the raw `type.__file` without `:line` (there's no line number at this layer; P4 can add it if desired).
- `snapshotStore` WITHOUT `store` → `{stores:[...]}` (a list of ids); no devtools hook → `{error:'no_pinia'}` (NOT `{stores:[]}` — chose an explicit reason, see the rejected alternative below).
- `snapshotComponent` reads `props` + a merged `{...data, ...setupState}` (setupState wins on collision). `last:true` without `lastEl` → `{error:'not_found'}`. A malformed selector / no match / no instance → `{error:'not_found'}`.
- `installConsoleTap` — `getBuffer()` returns a **copy** (a slice), levels strictly `log|info|warn|error|debug` (window-error and rejection are recorded as `error`). P4 calls `getBuffer()` on "Send" and puts it into `FeedbackPayload.console`.

**Decision (doing X instead of Y):** `snapshotStore` without the hook returns `{error:'no_pinia'}`, not `{stores:[]}` — an empty list is indistinguishable from "Pinia is there, just no stores", while an explicit reason gives P5/Claude a clear signal "open the preview / connect Pinia". The test environment is a per-file `// @vitest-environment happy-dom` doc-comment (NOT the global vitest.config), so that P2's server tests stay on the node default — instead of adding `environmentMatchGlobs` (deprecated in vitest 4) or separate configs.

**Self-review (1 pass, 2 subagents — code+security):** applied — a node budget `maxNodes` (security MEDIUM: wide/DAG DoS, `[Circular]` doesn't catch siblings), a per-entry text cap of 8000 in console-tap (MEDIUM: unbounded memory/payload), NaN/Inf→strings and Date/RegExp/Error branches (MAJOR/MINOR: silent corruption `→null`/`→{}`), a Map object-key collision fix (MAJOR), `__proto__`-safe assign (LOW prototype-pollution, contained), an ancestor Set instead of O(n²) includes, an `||` fallback for an empty ErrorEvent.message, a LIFO-dispose NOTE. **Rejected/deferred (justified):** redacting secrets/PII before they reach the LLM (security MEDIUM, `console-tap.ts`/`snapshot.ts`) — this is explicitly the surface of P4 (the payload contract) / P5 (MCP demarcation) per the P2 log's decision, not the collectors layer; P4 MUST add a redactor (regex `*token*|*secret*|*password*|*api[_-]?key*|authorization|cookie|JWT eyJ…`) on the `getBuffer()` output and the snapshot state before `POST /message`. resolve-component is otherwise clean (the guard is sufficient, the regexes are linear, querySelector has no injection/ReDoS risk).

**Verify (all green, actually executed on happy-dom):** `npx vitest run tests/unit/{safe-stringify,resolve-component,console-tap,snapshot}.test.ts` → 36 passed (8+10+7+11, edge cases: empty/boundary/concurrency/external-failure/permission-N-A/malformed-input/deleted-resource + browser-Shadow-DOM-null); `pnpm test:run tests/unit` → 69 passed (no regression from P2); `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → three dist files. **No rollbacks.** Husky on commit `6bc385e` bumped 0.0.3→0.0.4, rebuilt dist, tag `v0.0.4`, tree clean.

**Next step:** P4 imports `resolveComponent`/`describeElement`/`installConsoleTap` to assemble `FeedbackPayload`, and `snapshotStore`/`snapshotComponent` to answer the WS `request`. The collectors are NOT imported from `dist/` (this is client TS, only bundled into `dist/client.js` once `src/client/index.ts` pulls them in during P4) — P4 imports them by relative path from `src/client/`. **Must for P4 (from the security review):** a secrets redactor on the console buffer and the snapshot output before sending to the queue.

### Phase 4 — Client overlay + Vite plugin entry (done, 2026-06-27)

Built: `src/client/redact.ts` (a security must-have from P3 — `redactString` masks JWTs/`Bearer …`/`key=value` for sensitive keys, `redactDeep` masks values under sensitive KEYS + redacts text, depth-bound 12; `redactConsole` runs per entry line); `src/client/ws-client.ts` (`createWsClient` — `hello` on open, `request{console|store|component}` → the local collector → `reply` with **redacted** data, reconnect with a capped backoff 1s→10s, the WS factory is injected for tests); `src/client/overlay.ts` (`createOverlay` — a Shadow-DOM modal [textarea+Select element/Send/Cancel], an element picker on capture listeners with a hover-box+component tooltip, click-select/Esc-cancel, a `composedPath` guard against the overlay's own UI, payload assembly [url/describeElement/resolveComponent/redactConsole(getBuffer)], 413→"too large", offline→error, a double-submit block, idempotent open); `src/client/index.ts` (bootstrap: cfg from `window.__CLAUDE_FEEDBACK_CFG__`, tap, ws, Alt+C on capture, the last element via `overlay.lastEl()`, a single-boot guard); `src/plugin/index.ts` (full implementation: `config`→build gating, `transformIndexHtml{order:'pre'}`→inlining `dist/client.js`+cfg, `configureServer`→`middlewares.use(httpMiddleware)` + a **path-gated** `upgrade`→`handleUpgrade` (don't kill Vite HMR!) + `writeBridgeInfo(actualPort)` on `listening`, `buildEnd/closeBundle`→close).

**Deviations (important for P5–P7):**

- **Verify smoke test: Playwright → a real Vite dev server.** Playwright/chromium is NOT in the offline store (like tsup in P1), and the network is flaky. But `vite` is a devDep and is present. `tests/smoke/overlay-smoke.mjs` spins up a REAL `vite.createServer` with the built dist plugin against `tests/smoke/dev-app/` (plain html+ts, no vue — the full Pinia demo is P7) and checks the real dev contract: the document inlines client+cfg; `bridge.json` has a live port; feedback `POST /message`→drain round-trip; a snapshot with no browser→`browser_not_connected`; `vite build`→does NOT inject. The overlay's browser JS (Alt+C/shadow/picker/WS-reply) is covered by happy-dom unit tests. The smoke test takes ~1 min (vite dev+build) — does NOT hang.
- **build.mjs: a createRequire banner was added** to the plugin build (implementing the P2 gotcha) — the plugin now bundles bridge→ws; without the banner the runtime would crash with `Dynamic require of events`. Plus dts: the plugin imports `../server`, so the dts program is `src/{plugin,server}`, `rootDir:"src"`, tsc emits a tree under `dist/`, and build.mjs moves `dist/plugin/index.d.ts`→`dist/index.d.ts` and cleans up the rest. The public type surface does NOT reference server types → `index.d.ts` is self-contained (verified).
- **WS upgrade must be path-gated in configureServer** (do NOT pass `bridge.handleUpgrade` directly into `on('upgrade')`): the bridge calls `socket.destroy()` on an unrelated path → would kill Vite HMR. In the plugin: `if (path===WS_PATH) bridge.handleUpgrade(...)`. A gotcha for anyone mounting the bridge.

**Contract for P5/P7:** the dev server writes `.claude-feedback/bridge.json` with the real port; HTTP `/api/*` is under a loopback+Host gate (P5's MCP sends Host `127.0.0.1:<port>`). Client config — `window.__CLAUDE_FEEDBACK_CFG__={hotkey,consoleBufferSize}`. WS reply data is already redacted (P5 must NOT redact again).

**Self-review (1 pass):** the redactor covers both P3-security vectors (console + snapshot). Open questions deferred with justification: an Origin allowlist on the WS upgrade (P2 deferred it to P4 — but it requires the expected origin from the vite config; the connId key already removed the eviction risk, the only remaining one is "an attacker tab wins the first-tab race for a snapshot" — low risk on localhost-dev; not a blocker, leaving it for P7's e2e to confirm the real proxy path); per-field shape validation of the element/component payload — the bridge already stringifies fields via `String()`, deep validation isn't critical for a dev tool.

**Verify (all green, actually executed):** `pnpm test:run` → **99 passed** (10 files: +redact 11, +ws-client 9, +overlay 9, +plugin-transform 5 on top of P1–P3's 69; edge cases: empty/boundary/concurrency/external-failure/malformed-input/deleted-resource/double-submit/413/offline/own-UI-click-ignore); `node tests/smoke/overlay-smoke.mjs` → `overlay-smoke ok` (a real Vite dev+build); `node tests/smoke/bridge-smoke.mjs` → `bridge-smoke ok` (no regression from P2); `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → three dist files, `index.d.ts` is clean, the banner is in place. **No rollbacks.** Husky on commit `33a64da` bumped 0.0.4→0.0.5, rebuilt dist, tag `v0.0.5`, tree clean.

**Next step:** P5 (deps[2]) — the stdio MCP server `claude-plugin/mcp-server.mjs` hits `/api/*` over localhost from `bridge.json`; remember the Host gate. **P1 gotcha:** `@modelcontextprotocol/sdk` is NOT in the offline store — budget time for a network install (`pnpm add`). P7 reuses the `overlay-smoke` approach (real Vite, no Playwright) on a full vue+pinia demo-app — run picker/Alt+C/WS-snapshot either via claude-in-chrome, or by installing playwright if the network allows.

### Phase 5 — MCP server (stdio → bridge) (done, 2026-06-27)

Built: `claude-plugin/lib/bridge-client.mjs` (`readBridgeInfo(projectDir)` — parses `.claude-feedback/bridge.json`, null on missing/malformed/no numeric `port`; `callBridge(method,path,body?,{projectDir})` via `node:http` — re-reads bridge.json on EVERY call [no state of its own → a dev-server restart with a new port is picked up automatically], sets `Host: 127.0.0.1:<port>` to satisfy the bridge's loopback gate, maps: 2xx→`{ok,data}`, 4xx/5xx→`{error:'bridge_error'}`, ECONNREFUSED/timeout/no-file→`{error:'bridge_not_running'}`, an invalid JSON body→`bridge_error`), and `claude-plugin/mcp-server.mjs` (5 tools: `get_feedback`→`GET /api/feedback?ack=1`, `request_store_snapshot{store?}`/`request_component_snapshot{selector?,last?}`/`request_console{level?}`→`POST /api/request {kind,args}`, `feedback_status`→`GET /api/status`). The tools NEVER throw: a bridge error → a friendly `isError` result "start the dev preview/open a tab, then retry"; a browser-level error from `data.error` (`timeout`/`browser_not_connected`/`closing`) → a separate human-readable text; `get_feedback` on an empty queue → `{items:[],note}`.

**Decision (doing X instead of Y):** used the **low-level `Server`** (`@modelcontextprotocol/sdk/server/index.js`) + `setRequestHandler(List/CallToolRequestSchema)` with a **plain JSON-Schema** `inputSchema`, rather than the high-level `McpServer`. Reason: `McpServer.registerTool` describes inputs with zod shapes, but `zod` is only a transitive SDK dependency and under pnpm it does NOT resolve from my file (`import 'zod'`→`ERR_MODULE_NOT_FOUND`). `Server` is softly marked `@deprecated` ("use McpServer for high-level API; Server for advanced use cases") — our case is exactly "advanced", zero extra deps. Args are parsed manually from `req.params.arguments`. The SDK was installed via a network `pnpm add` (`@modelcontextprotocol/sdk@1.29.0`, as the P1 log predicted; the pin was corrected from `^` to the exact `1.29.0` per the repo's convention), landing in `dependencies` (a runtime dep).

**ATTENTION P6 (a packaging risk, NOT a code defect — in P6's/the manifest's scope):** `mcp-server.mjs` `import`s `@modelcontextprotocol/sdk`, which resolves from the repo's `node_modules`. When the CC plugin is installed via the marketplace, `${CLAUDE_PLUGIN_ROOT}` = `claude-plugin/` — node will search up the tree for `@modelcontextprotocol/sdk`; if the marketplace install does NOT bring `node_modules` along, the runtime `node mcp-server.mjs` will crash with `ERR_MODULE_NOT_FOUND`. P6 (owner of plugin.json/packaging) MUST decide: either bundle the sdk into a self-contained `mcp-server.mjs` via esbuild (like `dist/`; then the plan's ".mjs without a build" point gets refined), or a `claude-plugin/package.json` with the dep + an install step, or vendoring. I did NOT change the plan's design autonomously — flagging it here; the verified server does run from the repo.

**Verify gate (actually executed, all green):** TDD — `tests/unit/mcp-bridge-client.test.mjs` written FIRST (8 tests: present/missing/malformed bridge.json, GET data+a loopback-Host assertion, POST body, bridge_not_running when the file is absent, bridge_error on 500, bridge_not_running on a refused port, bridge_error on non-JSON; edge cases: empty/boundary/external-failure/malformed-input/deleted-resource) → fail (no module) → implementation → green. A **full MCP round-trip** smoke test `tests/smoke/mcp-smoke.mjs`: a fake bridge (http, enforcing the Host gate) + bridge.json in a temp dir → `mcp-server.mjs` launched as a REAL child process via `StdioClientTransport`, running `initialize`+`tools/list`(=5 tools)+`feedback_status`+`get_feedback`(drain→ack→empty)+`request_console`/`request_store_snapshot`(forwarding kind+args, unwrapping `{data}`)+an offline bridge→an `isError` result → `mcp-smoke ok`. Plus `node --check` on both `.mjs` files. Regression run: `pnpm test:run` → **107 passed** (11 files: +mcp-bridge-client 8 on top of P1–P4's 99); `node tests/smoke/bridge-smoke.mjs`→`bridge-smoke ok`, `node tests/smoke/overlay-smoke.mjs`→`overlay-smoke ok` (no regression); `tsc -p tsconfig.json --noEmit`→exit 0; `pnpm build`→three dist files. **No rollbacks.** Husky on commit `3fccc9c` bumped 0.0.5→0.0.6, synced the manifests, rebuilt+staged dist, tag `v0.0.6`, `check-versions ok`, tree clean.

### Phase 6 — CC plugin: manifest, SessionStart hook, wire/unwire, skill, commands (done, 2026-08-05)

Built: `claude-plugin/lib/vite-config-patch.mjs` (`addPlugin`/`removePlugin` — idempotent string patches to `vite.config.*`; the key detail: before searching for the `plugins:` key, the source is **masked** — `maskCommentsAndStrings` replaces the contents of comments/strings with spaces of the same length [indices don't shift], the search for `plugins:`/matching brackets runs against the mask, while the insertion happens on the original text at those same indices; the search is further limited to the body of the `defineConfig(`/`export default {` object. CJS configs [`module.exports`] are detected and the patch is rejected with an explicit instruction instead of corrupting the file with an ESM `import`), `claude-plugin/lib/project.mjs` (shared `PKG_NAME`/`CONFIG_NAMES`/`detectPackageManager` — factored out of wire/unwire to avoid duplication), `claude-plugin/scripts/wire.mjs` (`inspectProject(dir)` a pure detect function + `wire(dir)`: install via pnpm/npm/yarn based on the lockfile, from the github tag [resolved via `git ls-remote --tags --refs`, 60s timeout] + a config patch), `claude-plugin/scripts/unwire.mjs` (the reverse operation), `claude-plugin/hooks/session-start.sh` (`node wire.mjs || true`), `claude-plugin/skills/claude-feedback/SKILL.md`, `claude-plugin/commands/{feedback,feedback-setup,feedback-remove}.md`, `claude-plugin/.claude-plugin/plugin.json` (added `mcpServers`/`hooks.SessionStart`/`skills`/`commands`).

**P5's packaging risk closed:** `scripts/build.mjs` got a third step — esbuild bundles `claude-plugin/mcp-server.mjs` (+ `lib/bridge-client.mjs`, + `@modelcontextprotocol/sdk`) into a self-contained `claude-plugin/mcp-server.bundled.mjs` (a createRequire banner as in the P2/P4 gotchas), and build.mjs checks that no bare `import ... from "@modelcontextprotocol/sdk"` remains in the output. `plugin.json`'s `mcpServers.claude-feedback.args` now points at `mcp-server.bundled.mjs`, not the source — a marketplace install without `node_modules` now works (verified: copied the bundle into a directory with no node_modules, `node --check` + an actual process launch — it starts). **Important:** the bundle lives in `claude-plugin/` (NOT in a `dist/` subdirectory), because `mcp-server.mjs` reads the version via a `__dirname`-relative path to `.claude-plugin/plugin.json` — moving it into a subdirectory would break that path.

**Manifest misses (2):** `vite-config-patch.mjs` was placed in `claude-plugin/lib/` instead of `claude-plugin/scripts/lib/` from the manifest — so it sits next to the already-existing `claude-plugin/lib/bridge-client.mjs` (P5), rather than in a new nested directory; `claude-plugin/lib/project.mjs` was created outside the manifest (it appeared during the self-review step to deduplicate wire.mjs/unwire.mjs).

**Self-review (1 pass, 3 subagents — code+security+premortem):** code-review and premortem **independently** found the same CRITICAL issue — `findPluginsArrayRange` matched the first textual occurrence of `plugins:` anywhere in the file, including comments ("// note: plugins: …" before the real array) and unrelated keys (`resolve.alias` before the real `plugins:`), silently patching the wrong array, while the `configWired` flag still became `true` regardless — **applied**: rewritten to use masked search (see above), scoped to the config object's body; a test `does not hijack an unrelated array before a comment` was added. Premortem also caught a CJS config (`module.exports`) — an ESM `import` would have been inserted into a CommonJS file and broken `vite dev` with a syntax error — **applied**: an `isCommonJs` detect + a graceful bail with a note; a test was added. code-review found duplication of `detectPackageManager`/`CONFIG_NAMES`/`PKG_NAME` between wire.mjs/unwire.mjs — **applied**: factored out into `project.mjs`. premortem flagged `execFileSync` calls with no timeout in install/uninstall/`git ls-remote`, invoked from the SessionStart hook for every user — **applied**: `timeout: 60_000` on all three calls. security-review found no command-injection/path-traversal (execFileSync with argv arrays, no shell; the tag regex is anchored to `v\d+\.\d+\.\d+`; CONFIG_NAMES is a fixed whitelist) — **rejected**: the tag-mutability/no-consent-install risk is flagged as design-level and already accepted in the plan's preamble ("Risks" → "Auto `pnpm add github:` in the SessionStart hook touches someone else's project… Mitigation: P6 — strict idempotency") — not reopening it. code-review found that `compareTags` wouldn't survive pre-release tags (`v1.2.0-beta.1`) — **rejected**: tags are created exclusively by this repo's `release.mjs`, always strict `vMAJOR.MINOR.PATCH`, there are no third-party tags in this exercise. premortem pointed out that when multiple config files are found, the first one in a fixed order is used, which doesn't match Vite's real resolution order — **rejected**: the plan explicitly mandates exactly this behavior ("multiple configs → the first one found, logged").

**Verify gate (actually executed, all green):** `tests/smoke/wire-smoke.mjs` — a temp project dir (package.json vue+vite + vite.config.ts) → `wire.mjs` with `CLAUDE_FEEDBACK_SKIP_INSTALL=1` patches the config (`claudeFeedback` + the import line are present) → `unwire.mjs` restores the original look (no `claudeFeedback`, `vue()` in place) → the `plugin.json` manifest is valid and contains `mcpServers`+`hooks` → `mcp-server.bundled.mjs` contains no bare `@modelcontextprotocol/sdk` import + `node --check` passes → an extra project dir with no vite (just `{}` in package.json) doesn't crash `wire.mjs` → `wire-smoke ok`. Plus `pnpm test:run` → **124 passed** (13 files: +vite-config-patch 11 + wire-detect 6 on top of P1–P5's 107); `node tests/smoke/{bridge,mcp,wire}-smoke.mjs` → all ok; `node tests/smoke/overlay-smoke.mjs` → `overlay-smoke ok` (the same post-print hanging process as before — a known quirk of the esbuild service from P4, not a regression); `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → dist + `mcp-server.bundled.mjs`. **No rollbacks.**

**Next step:** P7 (deps[4,5,6]) — a real vue+pinia demo-app + a full e2e (Alt+C → get_feedback → snapshot), plus checking the full marketplace-install path (this repo's plugin into a clean project) with the already-built `mcp-server.bundled.mjs`.

**Next step:** P6 (deps[5]) — `plugin.json mcpServers:{ "claude-feedback":{ command:"node", args:["${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs"] } }` + SessionStart hook/wire/unwire/skill/commands. **First resolve the sdk packaging risk above** (otherwise the MCP server won't start for whoever installs the plugin). Tool names for SKILL.md/commands are fixed: `get_feedback`, `request_store_snapshot`, `request_component_snapshot`, `request_console`, `feedback_status`. `CLAUDE_PROJECT_DIR` is where the server reads `.claude-feedback/bridge.json` from (env, fallback cwd).

## Log

### Phase 7 — demo-app + e2e harness (done, 2026-08-05)

Inherited `in_progress` from a previous session with `examples/demo-app/` already built (vue+pinia+`Counter`/`counter` store), `tests/e2e/feedback.e2e.mjs` (Playwright chromium, the full flow + all the plan's edge cases) and `scripts/e2e.sh`. Additionally installed `npx playwright install chromium` (not in the store) and brought it to green.

**Found and fixed 2 real defects not covered by the previous unit/smoke gates:**

1. **`snapshotStore` couldn't find Pinia without the Vue Devtools extension installed** (`src/client/snapshot.ts`) — the previous `findPinia` could only search via `__VUE_DEVTOOLS_GLOBAL_HOOK__`, which isn't present in headless/ordinary dev. Added a fallback `findPiniaViaMountedRoot` — scanning `document.querySelectorAll("*")` (cap `DOM_SCAN_BUDGET=20000`) looking for `el.__vue_app__.config.globalProperties.$pinia`. A test for the new path was added to `tests/unit/snapshot.test.ts`.
2. **`examples/demo-app/package.json` referenced the plugin via `file:../..`** — pnpm's `file:` protocol copies a snapshot into the `.pnpm` store at `install` time, so subsequent `pnpm build` runs at the root do NOT reach the demo-app (the e2e was running a stale `dist/client.js`, hence the `no_pinia`/undefined failures, which reproduced even without the picker flow). Switched to `link:../..` (a live symlink) + `pnpm install` in the demo-app.

Also: `tests/e2e/feedback.e2e.mjs` compared `body.data.count` instead of `body.data.state.count` (the real shape of `snapshotStore` is `{store,state}`) in two checks ("store snapshot reflects increment clicks" and the concurrency edge case) — the concurrency case was silently passing (`undefined === undefined`), masking defect #2. Fixed to `body.data.state.count`.

Created `tests/e2e/README.md` (the harness, the `link:` vs `file:` gotcha, how to run it, coverage). Added a `bash scripts/e2e.sh` line to the `## Development` section of the root `README.md`.

**Verify (all green, actually executed):** `bash scripts/e2e.sh` → all `ok -`/`edge:*` lines + `e2e ok`, exit 0 (a real Vite dev server, real Pinia, a real button click, a real prod `vite build` grep). `pnpm test:run` → **125 passed** (13 files, +1 test for the mounted-root Pinia fallback on top of P1–P6's 124). `tsc -p tsconfig.json --noEmit` → exit 0. Regression: `node tests/smoke/{bridge,mcp,wire}-smoke.mjs` → all `*-smoke ok`; `node tests/smoke/overlay-smoke.mjs` → prints `overlay-smoke ok` (the same known hanging esbuild-service process after printing as in the P6 log — not a regression, killed manually). `pnpm build` → dist + `mcp-server.bundled.mjs` with no contract changes.

**Self-review:** skipped — the phase was inherited `in_progress` with code already written by a previous session; my part of the work (2 bug fixes + 1 test fix) is a targeted correction following a red e2e run, not a new feature; the self-review threshold (≥20 new non-trivial lines / a security path) wasn't hit per-diff. `<self-review>skipped:trivial</self-review>`.

**Manifest misses:** 0 (the files matched the roles from the plan; the fixes were inside the already-created `snapshot.ts`/`feedback.e2e.mjs`/`demo-app/package.json`).

**No rollbacks.**

**Next step:** the plan is fully implemented (P1–P7 done). Remaining: `git push --follow-tags` to `https://github.com/SI-IC/vue-pick-problem-skill` and a marketplace check on a clean third-party project (a real `pnpm add github:` instead of the `CLAUDE_FEEDBACK_SKIP_INSTALL` mock) — outside this phase's scope, a manual step for the repo owner.
