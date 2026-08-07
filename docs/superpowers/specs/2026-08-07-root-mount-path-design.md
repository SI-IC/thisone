# Root-mount path display mode

## Problem

The overlay panel shows exactly one path format for a picked element: file-tree location
(`<tag> · ComponentName · file:line:col-line:col`), sourced from `data-src-loc` on the DOM
element plus the nearest named ancestor's `__file`. This reflects where the component is
_defined_, not where it's _mounted_. A shared/reusable component can be mounted from many
different places in the app; the file-tree path alone doesn't tell an AI agent which usage
context the picked element belongs to, or where in the render tree to look for surrounding
logic/props.

`resolveComponent`/`resolveReactComponent` already walk the full parent chain up to the root
(`chain: string[]` in `src/client/resolve-component.ts` and
`src/client/resolve-component-react.ts`) but only keep component **names**, discarding each
ancestor's `__file` except the nearest named one (`resolvedFile`).

## Goal

Add a second path display mode showing the component chain from the root component (`App`)
down to the picked element, with a per-level file — independently switchable from the
existing file-tree mode. Persist the user's chosen mode across page reloads.

## Format

Root-to-leaf breadcrumb, `Name (file)` per ancestor level joined by `›`, ending with the tag
and exact source location of the picked DOM element (same source-location data already used
by the file-tree mode):

```
App (src/App.vue) › Counter (src/components/Counter.vue) › <button> 12:3-12:45
```

Deeper mount example:

```
App (src/App.vue) › DemoHeader (src/components/DemoHeader.vue) › Counter (src/components/Counter.vue) › <button> 12:3-12:45
```

Levels without a resolvable file (anonymous component, no `__file`) render as just `Name`.

The exact same string is used for both the on-screen display and the clipboard copy — no
separate "compact UI" / "verbose copy" split.

## Approach

- **`ComponentDescriptor.chain`**: change from `string[]` to `{ name: string; file: string | null }[]`
  in both `resolve-component.ts` and `resolve-component-react.ts`. The walk loops already visit
  every ancestor and have `cur.type?.__file` (Vue) / `fileOf(type)` (React) available at each
  step — just also capture it instead of discarding it. `chain[0]` is the picked element's
  nearest component, `chain[chain.length - 1]` is the root.
- **`formatElementPathFromRoot(el)`** (new export in `resolve-component.ts`): reverses `chain`,
  joins `Name (file)` (or bare `Name` when `file` is null) with `›`, appends
  `<tag> startLine:startCol-endLine:endCol` from the same `sourceLoc` parsing already used by
  `formatElementPath`. Returns `<tag> · selector` fallback (matching the existing degrade
  path) when there's no resolvable component at all.
- **`path-mode-store.ts`** (new, modeled on `target-store.ts`): `loadPathMode(): "tree" | "root"`
  (default `"tree"`) / `savePathMode(mode)`, `localStorage` key `thisone:path-mode`, same
  try/catch-swallow pattern as the rest of the store modules.
- **`overlay.ts`**: a new toggle button next to (not inside) `.path`, styled like
  `.target-toggle` (border `#585b70`, hover `#313244`/`#89b4fa`, active state accent border +
  `rgba(137,180,250,.12)` fill). Icon is a small inline SVG in the same minimalist stroke style
  as `pinIcon`/`targetIcon` — two glyphs, one per mode (file/tree vs branch/hierarchy), matching
  whichever mode is _currently active_ (not what clicking switches to, to keep affordance
  consistent with `target-toggle`'s existing `active` class convention). `title` attribute
  describes the action: "Show path from root component" when in tree mode, "Show file-tree
  path" when in root mode.
  `renderSelection()` picks `formatElementPath` or `formatElementPathFromRoot` based on the
  current mode for both the displayed text and the click-to-copy handler; toggling re-renders
  the currently selected element's path in place (no need to re-pick).

## Rejected alternatives

- **Separate compact-UI / verbose-copy formats** — considered first, but the user explicitly
  wants the on-screen text and the copied text to be identical, so there's exactly one format
  per mode to maintain instead of two.
- **Tabs/segmented control instead of a single toggle button** — a two-state icon toggle
  matches the existing `.target-toggle` pattern already in the header and needs less horizontal
  space in the 340px panel; a tab pair would visually compete with the header's own controls.

## Edge cases

- Root component itself is picked (chain has one entry) → breadcrumb is just
  `App (src/App.vue) › <tag> line:col-line:col`, no `›` separator needed for ancestors.
- No component resolvable at all (element outside the app) → both modes fall back to the same
  `<tag> · selector` string; the toggle still switches state but output is identical either way.
- Ancestor with no `__file` (anonymous functional component, HOC wrapper) → rendered as bare
  `Name` (no parens) in the breadcrumb, chain walk continues past it to deeper ancestors as
  before.
- `localStorage` unavailable/throws (private browsing, disabled storage) → `loadPathMode`
  swallows and returns the `"tree"` default, `savePathMode` swallows silently — same behavior
  already established by `target-store.ts`.
- Switching mode while no element is selected → toggle still updates persisted state and its
  own active/tooltip visuals; `renderEmpty()` body is unaffected until a pick happens.

## Testing

- Unit tests (vitest) for `formatElementPathFromRoot()`: single-level chain (root picked
  directly), multi-level chain, ancestor without `__file`, no component resolvable (fallback
  path), React chain via `resolveReactComponent`.
- Unit tests for `path-mode-store.ts`: default value, round-trip save/load, `localStorage`
  throwing (swallow → default).
- Extend `resolveComponent`/`resolveReactComponent` existing tests to assert `chain` entries
  are now `{ name, file }` objects instead of bare strings.
