# e2e harness

Full round-trip test against a real Vue 3 + Vite + Pinia app (`examples/demo-app/`), driven by
headless Playwright (chromium). Exercises the whole flow that unit tests and smoke tests can't:
Alt+C overlay, element picker resolving a real Vue component, submitted feedback draining through
the bridge queue, and a Pinia store snapshot reflecting live UI state.

## Run

```
bash scripts/e2e.sh
```

This builds the root package, starts the demo app's dev server on a free port, runs
`feedback.e2e.mjs` against it, and tears the dev server down. Prints `e2e ok` and exits 0 on
success. Takes well under a minute.

First run needs the chromium binary:

```
npx playwright install chromium
```

## `examples/demo-app` dependency wiring

`examples/demo-app/package.json` depends on the root package via `link:../..` (a real symlink into
`node_modules`), **not** `file:../..`. pnpm's `file:` protocol copies a snapshot into the pnpm
store at install time — a root `pnpm build` after that install silently does not reach the demo
app, and the e2e suite would exercise a stale `dist/client.js`. `link:` always resolves live.

## What it covers

`feedback.e2e.mjs` asserts, in order: the demo page loads clean, Alt+C opens the shadow-DOM modal,
the element picker resolves the `Counter` component, a submitted message round-trips through
`GET /__claude_feedback/api/feedback?ack=1`, and a `POST /api/request {kind:'store'}` reflects live
increment clicks. Edge cases (empty submission, console ring-buffer cap, concurrent snapshot
requests, unknown store name, missing selector, refresh/reconnect, dev server going away, and a
prod `vite build` not injecting the overlay) are each a separate `check(...)` block — see the
`edge:*` / `prod` labels in the script.
