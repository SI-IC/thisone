# e2e harness

Full round-trip test against a real Vue 3 + Vite app (`examples/demo-app/`), driven by headless
Playwright (chromium). Exercises the whole flow that unit tests and smoke tests can't: Alt+C
opening the picker overlay, the element picker resolving a real Vue component, the resolved path
(with component name + source line numbers) being copied to the clipboard, an element screenshot
being captured and copied to the clipboard as a PNG, and the picker panel's dragged position
persisting across reopen and page reload.

## Run

```
bash scripts/e2e.sh
```

This builds the root package, starts the demo app's dev server on a free port, runs
`thisone.e2e.mjs` against it, and tears the dev server down. Prints `e2e ok` and exits 0 on
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

`thisone.e2e.mjs` asserts, in order: the demo page loads clean with no console/page errors,
Alt+C opens the shadow-DOM panel and pick-mode hint, clicking the `Counter` button resolves the
`Counter` component and renders a path string with source line numbers
(`<button> · Counter · Counter.vue:8:col-10:col`), a screenshot of the picked element renders as a
`blob:` image, clicking the path copies it to the clipboard, clicking the screenshot copies a PNG
to the clipboard, picking a different element while the panel is open replaces the selection,
Escape closes the panel, and a dragged panel position is saved to `localStorage` and restored on
reopen/reload. Edge cases — re-pick while open, corrupt `localStorage` falling back to a default
position, and a prod `vite build` not injecting the overlay — are each a separate `check(...)`
block; see the `edge:*` / `prod` labels in the script.

## React harness

`thisone-react.e2e.mjs` covers what's specific to the React path against a **bare**
Vite+React app (`examples/demo-app-react/`, deliberately without `@vitejs/plugin-react`):
source-location + component-name resolution for a plain function component, a
`memo()`-wrapped component, and the default-exported root component, plus the same prod-build
exclusion check as the Vue harness. Panel mechanics (drag, clipboard, screenshot, hotkey) are
framework-agnostic and already fully covered by `thisone.e2e.mjs` against the Vue demo
app — this script doesn't repeat them.

Run:

```
bash scripts/e2e-react.sh
```

Same `link:../..` wiring note as the Vue demo app applies to `examples/demo-app-react`.

## React + `@vitejs/plugin-react` harness

`thisone-react-plugin.e2e.mjs` runs the same three checks (function component, `memo()`-wrapped
component, prod-build exclusion) against a **second** React app,
`examples/demo-app-react-plugin/`, that _does_ install and enable `@vitejs/plugin-react`. thisone's
plugin runs `enforce: "pre"`, so it walks the raw JSX before `@vitejs/plugin-react`'s own
Babel/Fast-Refresh transform ever sees the file — this harness is what proves that ordering holds
and that `data-src-loc` / `__file`/`__name` survive Fast Refresh's own component registration
untouched. `examples/demo-app-react` stays plugin-free on purpose (see above), so this is a
separate fixture rather than a flag on the existing one.

Run:

```
bash scripts/e2e-react-plugin.sh
```

## Preact harness

`thisone-preact.e2e.mjs` covers what's specific to the Preact path against a **bare** Vite+Preact
app (`examples/demo-app-preact/`, deliberately without `@preact/preset-vite`): source-location +
component-name resolution for a plain function component, a `preact/compat`-`memo()`-wrapped
component, and the default-exported root component — each resolved via the `options.diffed`
WeakMap the plugin's virtual module installs, not via any Vue/React internals — plus the same
prod-build exclusion check as the other harnesses (also asserting the `thisone-preact-hook`
virtual module leaves no trace in the build). Panel mechanics (drag, clipboard, screenshot,
hotkey) are framework-agnostic and already fully covered by `thisone.e2e.mjs` against the Vue
demo app — this script doesn't repeat them.

Run:

```
bash scripts/e2e-preact.sh
```

Same `link:../..` wiring note as the other demo apps applies to `examples/demo-app-preact`.

## Browsing both demos live

`scripts/dev-demo.sh` fronts `examples/demo-app` (Vue), `examples/demo-app-react` (React), and
`examples/demo-app-preact` (Preact) with a single dev server on port 3000: the Vue app proxies
`/react-demo/**` and `/preact-demo/**` (including each app's HMR websocket) to two second,
loopback-only Vite instances. Each app's header has a Vue/React/Preact nav link to switch between
them without touching the URL bar's port. Only used for manually poking at the picker in a
browser — not part of any e2e/unit suite.
