# Svelte support

## Problem

The overlay picker resolves the clicked element's owning component for Vue (`el.__vueParentComponent`),
React (`el.__reactFiber$*`, via a custom `__file`/`__name` statics transform), and Preact
(`options.diffed` runtime hook) by reading or building a back-reference from the DOM node to the
framework's internal component representation. Svelte projects get nothing today — `.svelte` files
never pass through any of thisone's transforms, so `resolveComponent` always falls through to `null`
and `data-src-loc` is never injected.

## Goal

Same feature set as Vue/React/Preact, auto-detected by file extension, dev-only, zero overhead for
projects that don't use Svelte:

- Picked-element source location: `data-src-loc="file:startLine:startCol-endLine:endCol"`, same
  format and consumers (`describeElement`, `formatElementPath`, `formatElementPathFromRoot`) as Vue.
- Component resolution: name, defining file, and full ancestor-chain breadcrumb — parity with
  `ComponentDescriptor { name, file, chain }`.

Scope: **Svelte 5 only** (runes/`mount()`, current stable since 2024-10-19). No Svelte 4
(`svelte/internal` class-component runtime, different internal representation entirely) —
Svelte 4 is legacy and out of scope for this change.

## Approach

### Why no runtime hook is required (unlike Preact)

Confirmed by reading `svelte`'s own source (`5.56.8`, installed and inspected directly — not
guessed) and by an empirical probe: a minimal Vite + Svelte 5 app, opened headless, with a nested
`App.svelte` → `Counter.svelte`, produced this on the `<button>` element:

```json
{
  "loc": { "file": "src/Counter.svelte", "line": 4, "column": 0 },
  "parentChain": {
    "type": "component",
    "file": "src/App.svelte",
    "componentTag": "Counter",
    "parent": null
  }
}
```

Svelte's compiler, in dev mode, already instruments every element and every component
instantiation itself (`assign_location` in `svelte/internal/client/dev/elements.js`, `dev_stack` /
`add_svelte_meta` in `svelte/internal/client/context.js`) — the same mechanism the official Svelte
Inspector (`@sveltejs/vite-plugin-svelte-inspector`) reads. This is architecturally like Vue (the
framework itself exposes a DOM→internals back-reference) rather than Preact (which exposes nothing
and required patching `options.diffed` to build one). No virtual module, no WeakMap, no hook
patching needed.

`__svelte_meta.loc` is a **start point only** (line/column, no end) — insufficient on its own for
the existing `file:startLine:startCol-endLine:endCol` display format, so the source-location half
still needs a small plugin-side transform (see below), the same way Vue needs one despite Vue also
being a "framework exposes its own internals" case.

`el.__svelte_meta.parent`'s chain entries have `type: 'component' | 'if' | 'each' | 'await' | 'key'
| 'render'` (confirmed via `grep` over the real `add_svelte_meta(...)` call sites in
`svelte@5.56.8`'s compiler source, not guessed) — only `'component'` entries are chain-relevant, the
rest (control-flow blocks) are skipped, same idea as Vue/React/Preact skipping non-component
fiber/vnode types.

### Plugin side — new `src/plugin/inject-src-loc-svelte.ts`

Mirrors `inject-src-loc.ts` (Vue): parse the `.svelte` source with `svelte/compiler`'s `parse()`,
walk the template's element nodes, insert `data-src-loc="file:startLine:startCol-endLine:endCol"`
into each element's opening tag using the node's `start`/`end` offsets. Parse failure → return
source unchanged (same silent-degrade contract as the Vue transform). Exact AST shape (Svelte 5's
`parse()` fragment/node structure) to be confirmed against the installed `svelte` version during
implementation — walking pattern (recurse into children, branches, block bodies) mirrors
`inject-src-loc.ts`'s `NodeTypes.ELEMENT`/`IF`/`FOR` handling.

### Plugin side — wiring

`src/plugin/index.ts`'s `transform()`: add `if (id.endsWith(".svelte")) return
injectSvelteSourceLocations(code, id);`, alongside the existing `.vue`/`.tsx`/`.jsx` branches.
**No detection flag needed** (no `hasSvelte`, unlike `hasPreact`) — matched purely by file
extension, same as `.vue`. `enforce: 'pre'` (already set) ensures this runs before
`@sveltejs/vite-plugin-svelte`'s own compilation of the `.svelte` source into JS.

### Client side — new `src/client/resolve-component-svelte.ts`

`resolveSvelteComponent(el)`:

- Read `el.__svelte_meta`; absent → `null` (element outside any Svelte-compiled tree, or hook never
  attached because the file predates the dev-mode instrumentation — e.g. production build, though
  the plugin never runs there anyway).
- `childFile` starts as `el.__svelte_meta.loc.file` (innermost component's own file — this file
  _is_ the nearest component's defining file, since `loc.file` is set to whichever `.svelte` file's
  markup directly contains the element).
- Walk `cur = el.__svelte_meta.parent`:
  - `cur.type === 'component'`: push `{ name: cur.componentTag ?? baseName(childFile), file:
childFile }`, then `childFile = cur.file` (the _caller's_ file — becomes "the file" for the
    next-level-up chain entry), `cur = cur.parent`.
  - any other `type` (`if`/`each`/`await`/`key`/`render`): skip, `cur = cur.parent`, `childFile`
    unchanged (still within the same component's file).
- After the loop (`cur` is `null`, root reached): push a final `{ name: baseName(childFile), file:
childFile }` — the outermost mounted component has no `componentTag` (nothing instantiated it via
  a tag), so its name falls back to its file's basename, same fallback convention as the other three
  resolvers.
- 1000-iteration guard, matching the other three resolvers.
- `resolvedName`/`resolvedFile` = `chain[0]` (nearest) — unlike Vue's resolver, every chain entry
  here always carries a non-null `file`, so no "first entry with a file" search is needed.

### Client side — `src/client/resolve-component.ts`

`resolveComponent(el)` dispatch order gains a fourth branch, tried last: `resolveVueComponent` →
`resolveReactComponent` → `resolvePreactComponent` → `resolveSvelteComponent`. Return type
unchanged; `describeElement`/`formatElementPath`/`formatElementPathFromRoot`/overlay/clipboard/
screenshot code needs zero changes — `data-src-loc` already flows into `describeElement` for any
element regardless of which framework injected it.

### Dependencies

New real `dependencies` entry: `svelte` (pinned to latest stable, `5.56.8` confirmed via `npm view
svelte version` during brainstorming) — needed for `svelte/compiler`'s `parse()`, the same category
as `@vue/compiler-sfc`/`@vue/compiler-core` (already real dependencies): parsing `.svelte` syntax
never requires the consuming project to actually run Svelte, so this is safe to add unconditionally
regardless of which framework a given project uses.

## Rejected alternatives

- **Preact-style runtime hook** (virtual module patching Svelte's dev instrumentation, building a
  side `WeakMap`). Rejected — Svelte already attaches everything needed directly to the DOM element
  itself (`__svelte_meta`); reimplementing that via a hook would just duplicate work the framework
  does for free, for no benefit.
- **Skip the plugin-side transform, synthesize `data-src-loc` purely from `__svelte_meta.loc`**
  (start position only, `endLine`/`endColumn` = start). Rejected — degrades the displayed source
  range to a misleading zero-width span (`12:3-12:3` instead of the element's real extent),
  breaking parity with Vue/React/Preact's displayed text. The extra transform is a small, well-
  precedented piece of work (mirrors `inject-src-loc.ts` almost exactly).
- **Support Svelte 4 too.** Rejected per explicit scope decision — Svelte 4 released over two years
  before Svelte 5 (2024-10-19) and uses an entirely different (class-based) component runtime with
  no `__svelte_meta`/`dev_stack` equivalent; would need a second, unrelated resolution strategy for
  a framework version in decline. Out of scope; revisit only if requested.

## Edge cases

- Element outside any Svelte-compiled tree, or `.svelte` file that predates the dev-mode
  instrumentation attaching → `el.__svelte_meta` absent → `resolveComponent` returns `null`,
  overlay degrades to bare CSS selector, same as the other three frameworks.
- Element inside an `{#if}`/`{#each}`/`{#await}`/`{#key}` block, or a `{@render}` snippet — those
  `dev_stack` frames are skipped (not `type: 'component'`), chain walk continues past them without
  losing the surrounding component's file context.
- Root/top-level mounted component (`mount(App, {...})` in `main.ts`) — no `componentTag` available
  since nothing instantiated it via a tag in another `.svelte` file's markup; falls back to
  `baseName(file)`.
- Recursive components (a component that renders itself) — each recursive instantiation is its own
  `dev_stack` frame with its own `componentTag`/`file`, so the chain naturally shows the repeated
  name at each depth; `formatElementPathFromRoot`'s existing `collapseConsecutive` already handles
  collapsing these into `Name ×N (file)` with zero changes needed there.
- `.svelte` parse failure in the plugin-side transform (malformed template, exotic syntax the
  installed `svelte/compiler` version doesn't support) → return source unchanged, same silent-
  degrade contract as `inject-src-loc.ts`; rest of the plugin (Vue/React/Preact support, overlay)
  unaffected.
- Vue, React, Preact, and Svelte files coexisting in one project → each resolver only claims
  elements it recognizes; dispatch order in `resolveComponent` means each framework's subtree
  resolves correctly regardless of what else is mounted alongside it.
- Production build → unaffected; plugin stays `apply: 'serve'`, the `isBuild` gate in `transform()`
  already covers the new `.svelte` branch since it's inside the same early-return.

## Testing

- `tests/unit/inject-src-loc-svelte.test.ts`: element `data-src-loc` injection — plain elements,
  nested elements, elements inside `{#if}`/`{#each}` blocks, malformed source → unchanged passthrough.
- `tests/unit/resolve-component-svelte.test.ts`: `__svelte_meta.parent` walk with mock meta objects
  — chain collection, non-`'component'` frame skipping, root fallback (no `componentTag`),
  missing-`__svelte_meta` → `null`, depth guard.
- `tests/unit/resolve-component.test.ts`: dispatcher gains a Svelte-branch `describe` block, mirroring
  the existing Preact-dispatch tests (dispatch to Svelte only when Vue/React/Preact markers are
  absent; Vue/React/Preact take precedence when multiple are present on the same element).
- `examples/demo-app-svelte` (new): Vite + `@sveltejs/vite-plugin-svelte` + Svelte 5 example,
  nested components, wired into `scripts/dev-demo.sh` under `/svelte-demo/` (mirrors
  `examples/demo-app-preact`'s `dev-demo.sh` wiring), for manual and headless-Playwright
  verification of the full breadcrumb.
