# React support

## Problem

`vite-plugin-pick-element` (Alt+C DOM picker → component path/screenshot) only works with
Vue: `.vue`-only source-location injection (`@vue/compiler-sfc`) and component resolution
via Vue-only runtime internals (`el.__vueParentComponent`, `type.__file`). Projects using
React get no source location and `resolveComponent` always returns `null`, degrading the
overlay to a bare CSS selector.

## Goal

Same feature set for React as Vue already has, auto-detected per file (both frameworks can
coexist in one project) and dev-only (no change to build/production behavior — out of
scope, confirmed unaffected):

- Picked-element source location (`data-src-loc`, file + start/end line/column).
- Component resolution: name, defining file, and full ancestor-chain breadcrumb — parity
  with Vue's `ComponentDescriptor { name, file, chain }`.
- Must work without `@vitejs/plugin-react`/`-swc` installed — cannot rely on their
  `_debugSource`/`__source` dev injection, since that only encodes the JSX _call site_
  (where `<Counter/>` is rendered), not the component's _defining_ file — same gap
  Vue closes via SFC-compiler-injected `__file`.

## Approach

Own babel-based transform, mirroring the existing Vue path 1:1 — not a dependency on
`@vitejs/plugin-react`'s dev tooling.

### Plugin side — `src/plugin/inject-src-loc-react.ts` (new)

`injectSourceLocations(source, relFile)` for `.jsx`/`.tsx`:

- Parse with `@babel/parser` (`jsx` + `typescript` plugins).
- Walk JSX elements: for **host elements** (opening-element name is a lowercase
  `JSXIdentifier`, e.g. `<div>`), inject a `data-src-loc="relFile:startLine:startCol-
endLine:endCol"` `JSXAttribute` — same string format Vue already produces, so the
  client-side parser (`parseSourceLoc` in `resolve-component.ts`) needs no changes.
- Walk component declarations at module scope and inject static properties right after
  each declaration, mirroring what the Vue SFC compiler already does for `__file`/
  `__name` on the component options object:
  - `function Foo() {}` / `class Foo extends Component {}` with a PascalCase name →
    `Foo.__file = "relFile"; Foo.__name = "Foo";`
  - `const Foo = memo(...)` / `forwardRef(...)` / `React.memo(...)` /
    `React.forwardRef(...)` (including nested combinations, e.g.
    `memo(forwardRef(fn))`) with a PascalCase binding → statics assigned to the outer
    `Foo` binding, **not** the inner wrapped function. React stores the exact object
    returned by `memo()`/`forwardRef()` as `fiber.type`, and that object is what `Foo`
    refers to — so `fiber.type.__file` resolves directly on the client with no
    HOC-specific handling needed there. Detection is an allowlist of `memo`/
    `forwardRef` (bare or `React.`-qualified) callees, to avoid false-positives on
    unrelated PascalCase constants built from function calls (e.g.
    `const Colors = Object.freeze(...)`).
- Same safety contract as the Vue transform: parse or traversal failure → return the
  original source unmodified (`try/catch`, never break the dev server).
- Generate output with `@babel/generator`.

### Plugin side — `src/plugin/index.ts`

`transform(code, id)` routes by extension: `.vue` → existing `injectSourceLocations`,
`.jsx`/`.tsx` → new React transform, everything else untouched. Both remain gated behind
the existing `!isBuild` check — `apply: 'serve'` already keeps the whole plugin out of
production builds, this file just adds a second dev-only branch alongside the Vue one.

### Client side — `src/client/resolve-component-react.ts` (new)

- `getReactFiberKey(el)`: `Object.keys(el).find(k => k.startsWith('__reactFiber$'))` (React
  suffixes this key with a per-instance random string).
- `resolveReactComponent(el)`: same shape and algorithm as Vue's `resolveComponent` in
  `resolve-component.ts` — walk `fiber.return`, collect `chain` of names
  (`type.displayName || type.name || "Anonymous"`), resolve `file` from the closest
  ancestor whose `type.__file` is set, 1000-iteration guard, degrade to `{name: chain[0],
file: null}` when no ancestor has `__file` (unsupported setup, or a `.js`/`.ts` file
  outside the transform's scope — same production-degradation shape Vue already has).

### Client side — `src/client/resolve-component.ts`

`resolveComponent(el)` becomes a dispatcher: `el.__vueParentComponent` present → Vue path;
else a `__reactFiber$*` key present → React path (`resolveReactComponent`); else `null`.
Return type (`ComponentDescriptor`) is unchanged, so `describeElement`, `formatElementPath`,
the overlay, clipboard, and screenshot code need **no changes**.

### Dependencies

`package.json` **dependencies** (not devDependencies — the transform runs inside the
consuming project's dev server, so babel must be resolvable at runtime by the plugin):
`@babel/parser`, `@babel/traverse`, `@babel/generator`, `@babel/types`. `@babel/core` is
not needed — the transform only parses, walks, and regenerates an AST directly, never
runs babel's plugin/preset pipeline. No new dependency on `react`/`react-dom` — routing
is by file extension only.

## Rejected alternatives

- **Rely on `@vitejs/plugin-react`'s `_debugSource`/`__source` dev injection** — requires
  that plugin to be present (explicitly ruled out — bare esbuild-only JSX setups must
  work), and even when present it only gives the call-site file, not the component's
  defining file, so the `__file`/`__name` static-injection pass would still be required.
  Adding a second (hybrid) code path for marginal benefit isn't worth the added surface.

## Edge cases

- Element has no `data-src-loc` (outside the React tree, or a `.js` file outside the
  transform's scope) → `sourceLoc: null`, same as Vue.
- No `__reactFiber$*` key on the element → `resolveComponent` returns `null`, overlay
  degrades to bare CSS selector — same as Vue outside its app.
- No ancestor in the fiber chain has `__file` → nearest name kept, `file: null`.
- `memo`/`forwardRef`/nested-HOC components → resolved via statics on the outer binding
  (see Approach); no separate degraded path.
- Babel parse/traversal failure (exotic syntax) → original source returned unmodified.
- Vue and React files coexisting in the same project → routed independently by extension,
  no interaction.
- Production build → unaffected; plugin stays `apply: 'serve'`, `isBuild` guard unchanged.

## Testing

- `tests/unit/inject-src-loc-react.test.ts`: host-attribute injection, statics on
  function/class components, statics on `memo`/`forwardRef`/nested-HOC components,
  PascalCase-but-not-a-component false-positive avoidance, parse-failure passthrough.
- `tests/unit/resolve-component-react.test.ts`: fiber-walk with mock fiber objects — chain
  collection, nearest-`__file` resolution, missing-fiber-key → `null`, depth guard.
- `tests/unit/plugin-transform.test.ts`: extend routing coverage for `.tsx`/`.jsx` vs
  `.vue` vs other extensions, `isBuild` no-op.
- `examples/demo-app-react` (new): Vite + React example **without**
  `@vitejs/plugin-react`, proving the bare-JSX-setup requirement; nested components
  (including one `memo`-wrapped) for manual and headless-Playwright verification.
