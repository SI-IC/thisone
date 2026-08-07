# vite-plugin-pick-element

Pick a DOM element in a live Vue 3 + Vite dev preview and copy its **component path** (tag,
component name, source file:line:col-line:col) or a **screenshot** straight to your clipboard.
No server, no network, no external integration — everything happens in the page.

## Install

```
pnpm add -D github:SI-IC/vue-pick-problem-skill

```

(No npm-registry publish — install straight from GitHub. The built `dist/` is committed to the
repo, so no build toolchain is required on install.)

Add it to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import pickElement from "vite-plugin-pick-element";

export default defineConfig({
  plugins: [vue(), pickElement()],
});
```

`pickElement({ hotkey: "KeyC" })` — override the hotkey code that combines with **Alt** to open
the picker (default `KeyC`, i.e. **Alt+C**).

## Usage

1. Run your Vue+Vite dev server and open the preview.
2. Press **Alt+C** — a small panel opens: "Select an element".
3. Click any element on the page. The panel shows its path (tag, Vue component name, and the
   source file:line:col-line:col when resolvable) and a screenshot of the element with 30px of
   real surrounding page content padded on each side.
4. Click the path text to copy it, or the screenshot to copy the PNG — either shows "Copied"
   next to what you clicked.
5. Click a different element while the panel is open to replace the selection. Drag the panel by
   its header to reposition it — the position is remembered (`localStorage`) across reloads. The
   panel is clamped to the viewport: it can't be dragged past the top/left/right edges, and at the
   bottom only the header has to stay on-screen (the body may extend past the fold).
6. Close with the **×** button or **Escape**.
7. The icon button next to **×** toggles an edge-docked quick-access button (off by default). Once
   enabled it's always on screen, flush against a viewport edge (right side, vertically centered,
   by default) — click it to open/close the panel, right-click-drag it along the viewport perimeter
   to reposition. Both the enabled state and position are remembered across reloads.

The plugin is disabled for production builds (`vite build`) — nothing it injects ships to users.

See `docs/superpowers/specs/2026-08-06-pick-element-design.md` for the full design.

## Development

```
pnpm install
pnpm run setup-hooks  # one-time: installs the husky git hooks below
pnpm build        # -> dist/{index.js, client.js, index.d.ts}
pnpm test:run     # unit tests
bash scripts/e2e.sh   # full e2e against examples/demo-app (see tests/e2e/README.md)
```

Versioning is automatic: a husky `pre-commit` hook bumps the patch version, rebuilds `dist/`, and
stages it when `src/` changes; a `post-commit` hook tags `v<version>`. For a larger bump run
`pnpm release minor` (or `major`) before committing.

`setup-hooks` is deliberately not wired to `prepare`: this package is installed by consumers
straight from git (`dist/` is committed, no build needed), and a `prepare` script would make
their package manager install our full `devDependencies` to run it — which can recursively
trigger `pnpm install` in their workspace root.

## License

MIT
