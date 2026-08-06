# Source location for picked element

## Problem

The overlay picker already resolves the Vue component chain (`ComponentDescriptor`) and a
best-effort CSS description of the picked DOM element (`ElementDescriptor`), but neither
carries where the element's tag actually lives in the `.vue` source file. `ComponentDescriptor.file`
is just the component's `__file` path with no line info — the field comment even says
"`__file` plus best-effort line, or null when unavailable" but no line was ever wired up.
Feedback payloads sent to Claude therefore point at a file, not a location inside it.

## Goal

Add start/end source location (line + column) for the specific DOM element the user picked
(any element inside a component's template, not just the component root) to the feedback
payload sent through the bridge to the MCP server.

## Approach

Own lightweight pre-transform inside the existing Vite plugin — not a third-party package.

- New pure module `src/plugin/inject-src-loc.ts`: `injectSourceLocations(source, relFile)`.
  Parses the `<template>` block with `@vue/compiler-dom`'s `parse()` (read-only AST access,
  the compiler itself is never invoked), walks every element node, and splices a
  `data-src-loc="relFile:startLine:startCol-endLine:endCol"` attribute into the raw source
  text of each element's opening tag. Insertions are collected as `(offset, text)` pairs and
  applied in descending-offset order (plain string splicing — no MagicString/sourcemap; all
  edits are same-line insertions and never shift other elements' line numbers).
- `startLine`/`endLine` cover the **whole element** (opening tag through matching closing
  tag), from `node.loc.start` / `node.loc.end` in the compiler-dom AST — not just the first
  line of a multi-line opening tag. This matches "open the file around this block" intent.
- Wired into `src/plugin/index.ts` as a new `transform(code, id)` hook with `enforce: 'pre'`,
  scoped to `id.endsWith('.vue')`. Runs before `@vitejs/plugin-vue`'s own transform on the
  same id, so the injected attribute is compiled by Vue's normal template compiler like any
  other static attribute and shows up in the real DOM. The plugin is already `apply: 'serve'`
  (dev-only), so this never reaches a production build.
- `describeElement()` in `src/client/resolve-component.ts` reads
  `el.getAttribute('data-src-loc')` and parses it into a structured value.
- `ElementDescriptor` (`src/server/types.ts`) gains:
  ```ts
  sourceLoc: {
    file: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  } | null;
  ```
- `overlay.ts` payload assembly and `claude-plugin/mcp-server.mjs` tool description are
  updated to surface the new field.

## Rejected alternatives

- **`vite-plugin-vue-inspector`** — solves the same problem, but ships its own
  click-to-open-editor overlay UI (conflicts with this project's own Alt+C overlay) and its
  attribute format is an internal implementation detail, not a documented API — unsafe to
  depend on for parsing.
- **Source-map tracing of the compiled render function** — no direct runtime link between a
  vnode and a position in the generated render code without extra instrumentation; mapping
  granularity would land on statements, not individual elements.

## Edge cases

- Element has no `data-src-loc` attribute (outside the Vue app, `v-html`-injected, or the
  `<html>`/`<body>` root) → `sourceLoc: null`.
- `<template v-if>` / `<template #slot>` wrapper tags render no DOM node — attribute is not
  injected on them, but their child elements still get their own.
- `v-for`-repeated elements all share the same source location (expected — the template is
  static text, instances are runtime).
- Malformed/unclosed template → `@vue/compiler-dom` parse wrapped in try/catch; on failure the
  original source is returned unmodified so the dev server never breaks.
- SVG and void elements (`img`, `br`, `input`) are parsed by `compiler-dom` the same as any
  other element — no special-casing needed.

## Testing

- Unit tests (vitest) for `injectSourceLocations()`: multi-line templates, nested elements,
  self-closing/void elements, multiple template roots, `v-if`/`v-for` template wrappers,
  malformed template (parse failure → passthrough).
- Extend existing `describeElement()`/`resolve-component` tests with a case parsing the
  `data-src-loc` attribute into `sourceLoc`.
