# claude-feedback

Send **element-anchored feedback** from a live Vue 3 + Vite dev preview straight to Claude Code. Press **Alt+C** in the preview, optionally pick an element, type what you want changed, and send. Along with your message Claude receives the page URL, a descriptor of the picked element, its **Vue component** (name + `__file:line` + parent chain), and the recent **browser console**. On request Claude can also pull a snapshot of a Pinia store or component state.

Two cooperating artifacts live in this one public repo (`https://github.com/SI-IC/vue-pick-problem-skill`):

- **Vite plugin** `vite-plugin-claude-feedback` (repo root) — injects the client overlay into dev pages and runs an in-process **bridge** (HTTP + WebSocket). Installed straight from GitHub, no npm-registry publish.
- **Claude Code plugin** `claude-feedback` (`claude-plugin/`) — a stdio **MCP server**, a **SessionStart** hook that auto-wires the Vite plugin into your project, a skill, and the `/feedback*` commands. Shipped via the Claude Code marketplace.

## Installation

### Marketplace install

```
/plugin marketplace add SI-IC/vue-pick-problem-skill
/plugin install claude-feedback@vue-pick-problem-skill
```

### Conveyor install

Add `claude-feedback` via the plugin library (`/plugins`); per-project override, then it installs on container start.

### What happens automatically

On the **next session start** after enabling, the plugin's SessionStart hook runs `wire.mjs`, which idempotently:

1. Detects the project (`vue` + `vite` in `package.json` / `vite.config.*`). No-op with a logged note otherwise.
2. If not already wired, installs the Vite plugin from GitHub at its latest tag (falls back across `pnpm` / `npm` / `yarn` by lockfile).
3. Patches `vite.config` to add `import claudeFeedback from 'vite-plugin-claude-feedback'` and `claudeFeedback()` into `plugins: []`.
4. If already wired, a fast no-op (no network).

The one-time install cost happens only on the first session after enable; later starts are cheap no-ops.

### Manual fallbacks

- `/feedback:setup` — runs the same `wire.mjs` on demand (re-runs, or when the hook was skipped).
- `/feedback:remove` — unwires: reverts the `vite.config` patch and removes the dependency. (Auto-remove is intentionally not done.)

## Usage

1. Run your Vue+Vite dev server and open the preview.
2. Press **Alt+C** to open the feedback overlay.
3. Optionally click **Pick element** and select the element you mean.
4. Type your feedback and **Send**.
5. In Claude Code, the `claude-feedback` skill pulls queued feedback with the `get_feedback` MCP tool and can request store/component/console snapshots.

See `docs/superpowers/specs/2026-06-26-vite-plugin-claude-feedback-design.md` for the full design, the context payload shape, and the MCP tool list.

## Development

```
pnpm install
pnpm build        # -> dist/{index.js, client.js, index.d.ts}
pnpm test:run     # unit tests
pnpm check:versions
```

Versioning is automatic: a husky `pre-commit` hook bumps the patch version, syncs it across the package, the CC-plugin manifest, and the marketplace entry, rebuilds `dist/`, and stages it; a `post-commit` hook tags `v<version>`. For a larger bump run `pnpm release minor` (or `major`) before committing. The built `dist/` is committed on purpose so a GitHub install needs no build toolchain.

## License

MIT
