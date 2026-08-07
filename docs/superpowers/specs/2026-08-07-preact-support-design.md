# Preact support

## Problem

The overlay picker resolves the clicked element's owning component for Vue (`el.__vueParentComponent`)
and React (`el.__reactFiber$*`) by reading a back-reference the framework itself attaches to the
DOM node during render. Preact does not attach any such back-reference to arbitrary DOM nodes —
`vnode._dom` points from the vnode to its DOM element, but nothing points the other way. Projects
using Preact get `data-src-loc` injected today (their JSX compiles through the same
`.jsx`/`.tsx` path as React), but `resolveComponent` always falls through to `null`.

## Goal

Same feature set as Vue/React, auto-detected, dev-only, opt-in only for projects that actually
use Preact (must not add a script tag or network request in Vue/React projects):

- Picked-element source location — already works, no changes needed.
- Component resolution: name, defining file, and full ancestor-chain breadcrumb — parity with
  `ComponentDescriptor { name, file, chain }`.

## Approach

### Why a runtime hook is required

Preact fires `options.diffed(vnode)` after each vnode's DOM representation is committed
(confirmed against `preactjs/preact` source and `preactjs.com/guide/v10/options`). This is the
same mechanism the official Preact DevTools extension uses to map DOM nodes back to components.
There is no way to do this lazily at pick-time the way Vue/React do — the map has to be built
as rendering happens, via a hook installed before (or shortly after) the app starts rendering.

### Plugin side — `src/plugin/inject-src-loc-react.ts`

Add `"preact/compat"` alongside `"react"` in `collectReactAliases`'s import-source check for
`memo`/`forwardRef`. JSX shape is identical between React and Preact, so no new file is needed
here — this is the only change to the existing transform.

### Plugin side — detection

`src/plugin/index.ts`, in `config()`: read the consuming project's `package.json` from
`vite root` (same `existsSync`/`readFileSync` pattern already used to locate `client.js`),
check `dependencies`/`devDependencies` for `preact`. Store as `hasPreact: boolean`. Parse failure
or missing file → `hasPreact = false` (degrade silently, never break the dev server).

### Plugin side — new virtual module `src/plugin/preact-hook.ts`

A small module, served only through Vite's `resolveId`/`load` (id: `virtual:thisone-preact-hook`,
resolved id prefixed `\0`), so it's resolved inside the app's own module graph and can
`import { options } from "preact"` and get the exact singleton the app itself uses:

```js
import { options } from "preact";
const map = new WeakMap();
const prevDiffed = options.diffed;
options.diffed = (vnode) => {
  if (vnode._dom) map.set(vnode._dom, vnode);
  prevDiffed?.(vnode);
};
window.__THISONE_PREACT_MAP__ = map;
```

Chains any pre-existing `options.diffed` (e.g. `preact/debug`) instead of overwriting it.

`src/plugin/index.ts`'s `transformIndexHtml` adds a second `<script type="module"
src="/@id/__x00__virtual:thisone-preact-hook">` tag with `injectTo: "head-prepend"` —
**only when `hasPreact`** — ahead of the existing inline overlay-bundle tag, so the hook installs
before the app's own entry module runs. Missing an early paint or two before the hook attaches is
acceptable (matches the existing "best-effort, degrades gracefully" contract) since picking
happens on user interaction well after mount.

### Client side — `src/client/resolve-component-preact.ts` (new)

Same shape and algorithm as `resolveVueComponent`/`resolveReactComponent`:

- `resolvePreactComponent(el)`: look up `window.__THISONE_PREACT_MAP__?.get(el)`; if absent,
  return `null`.
- Walk `vnode._parent` (Preact's internal ancestor link, mirrors Vue's `.parent` / React's
  `.return`), collecting `chain` entries. Component name: `vnode.type?.displayName ??
vnode.type?.name ?? vnode.type?.__name ?? baseName(vnode.type?.__file) ?? "Anonymous"` —
  `__file`/`__name` come from the same statics injection React already gets (shared transform).
  Skip vnodes whose `type` is a string (host elements, e.g. `"div"`) when collecting the chain,
  same as React's `isComponentFiberType` filtering out non-component fiber types.
- Resolve `file` from the nearest ancestor with `__file`; degrade to `{name: chain[0], file:
null}` when none has it. 1000-iteration guard, matching the other two resolvers.

### Client side — `src/client/resolve-component.ts`

`resolveComponent(el)` dispatch order: `el.__vueParentComponent` → Vue; else `__reactFiber$*` key
→ React; else `window.__THISONE_PREACT_MAP__?.has(el)` → Preact; else `null`. Return type
unchanged, so `describeElement`, `formatElementPath`, `formatElementPathFromRoot`, overlay,
clipboard, and screenshot code need no changes.

### Dependencies

No new `dependencies` — `preact` is never imported from thisone's own package, only referenced by
specifier inside the virtual module, which Vite resolves against the _consuming_ project's
`node_modules`. If a project has `hasPreact` from a stale/leftover `package.json` entry but no
actual `preact` installed, the virtual-module import 404s in that project's dev server console —
acceptable (same class of failure as any other misconfigured optional integration) and does not
break the rest of the plugin (`transformIndexHtml`'s two tags are independent).

## Rejected alternatives

- **Bundle a static WeakMap-building shim into the existing IIFE client bundle and have it
  `import("preact")` via bare specifier.** Doesn't work — the IIFE is bundled at _thisone's_
  build time (esbuild, `dist/client.js`), inlined into the page as a plain `<script>`, with no
  module system and no access to the consuming project's dependency graph. A virtual module
  resolved through Vite's own plugin pipeline is the only way to reach the project's exact
  `preact` singleton.
- **Require users to add `preact/debug` and read its internal state.** Adds a runtime dependency
  the project may not want in dev, for no benefit over hooking `options.diffed` directly — same
  mechanism `preact/debug` itself would use.
- **Scope down to "nearest component only", skip the ancestor chain.** Once the `options.diffed`
  hook and `WeakMap` exist (required regardless, for even the nearest-component case), walking
  `vnode._parent` to the root is the same handful of lines the other two resolvers already have.
  No complexity saved by cutting scope, so full-chain parity is kept.

## Edge cases

- Preact not installed despite `hasPreact` heuristic misfiring → virtual-module script 404s in
  that project's console; rest of the plugin (Vue/React support, overlay) unaffected.
- Element outside the Preact tree, or diffed before the hook attached → `WeakMap` miss →
  `resolveComponent` returns `null`, overlay degrades to bare CSS selector, same as Vue/React.
- `options.diffed` already patched by `preact/debug` or another tool → chained, not clobbered.
- No ancestor vnode has `__file` (e.g. plain `.js` files outside the transform's scope, or a
  production-style build without dev statics) → nearest name kept, `file: null`.
- `memo`/`forwardRef` from `preact/compat` → resolved via the same statics-on-outer-binding path
  React already has (shared transform change).
- Vue, React, and Preact files coexisting in one project → each resolver only claims elements it
  recognizes; dispatch order in `resolveComponent` means a Preact app under a Vue island (or vice
  versa) still resolves correctly per-subtree.
- Production build → unaffected; plugin stays `apply: 'serve'`, virtual module and extra script
  tag are both gated behind `!isBuild` the same way the existing overlay bundle is.

## Testing

- `tests/unit/inject-src-loc-react.test.ts`: extend HOC-detection coverage for
  `preact/compat`-sourced `memo`/`forwardRef` (bare and aliased imports).
- `tests/unit/resolve-component-preact.test.ts`: `_parent`-walk with mock vnode objects — chain
  collection, host-vnode filtering, nearest-`__file` resolution, missing-map-entry → `null`,
  depth guard.
- `tests/unit/preact-hook.test.ts`: `options.diffed` chaining (pre-existing hook still called),
  `WeakMap` population on synthetic vnodes.
- `tests/unit/plugin-detect.test.ts`: `hasPreact` detection from `dependencies` vs
  `devDependencies` vs absent, malformed `package.json` → `false`.
- `examples/demo-app-preact` (new): Vite + Preact example, nested components (including one
  `memo`-wrapped from `preact/compat`), for manual and headless-Playwright verification of the
  full breadcrumb.
