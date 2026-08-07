# thisone — rebrand & positioning design

Date: 2026-08-07

## Goal

Rename `vite-plugin-pick-element` to a brandable, framework-agnostic name, publish it to the npm
registry, and rewrite the README as a landing page. Positioning: **the fastest way to tell an AI
agent what to change and where** — you point at a rendered element, the plugin hands the agent the
source location and a picture of it.

## Positioning statement

> Your agent can't see your screen. `thisone` makes the word "this" mean something: press Alt+C,
> click the element, and paste the exact `file:line:col` plus a screenshot into your agent's chat.

## Naming

| Surface        | Before                                       | After                                                              |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| npm package    | `vite-plugin-pick-element` (never published) | `vite-plugin-thisone` (published, public)                          |
| npm brand root | —                                            | `thisone` — placeholder `0.0.1`, README points at the vite package |
| GitHub repo    | `SI-IC/vue-pick-problem-skill`               | `SI-IC/thisone`                                                    |
| Plugin export  | `pickElement()`                              | `thisone()`                                                        |
| Options type   | `PickElementOptions`                         | `ThisoneOptions`                                                   |
| Version        | 0.4.2                                        | 1.0.0                                                              |

Rationale for the brand root: the user intends to grow beyond Vite (webpack / Nuxt / Astro entry
points later). A `vite-plugin-*`-only name would have to be re-branded at that point, which is more
expensive than reserving the root now. `pinpoint` — the first choice — is taken on npm; `thisone`
is free and carries the same pointing metaphor with a more human tone.

Rejected alternatives: `contextpick` / `agentpoint` (keyword-dense but generic, ages with the "AI
agent" trend); `vite-plugin-point-to-code` (clear but nailed to the Vite prefix, and the `pointcode`
root is taken); `fingerpoint` (one letter from `fingerprint`).

## Migration

None. The package was only ever installed in the author's own projects; the author updates the
import by hand. No migration section in the README, no compatibility alias for `pickElement`, no
deprecated stub published under the old name (it never existed on npm — a stub there would only add
noise under the name being abandoned).

GitHub's permanent redirect from the old repo name keeps any existing `github:SI-IC/…` install
specifier resolving, so nothing breaks at install time; only the import specifier changes.

## README structure

English, top to bottom, ordered pain → payoff → install → detail:

1. **H1 + tagline + badges** — `# thisone`, _Point at it. Your AI agent gets the file, the line, and
   the pixels._ Badges: npm version, MIT, `dev-only · zero runtime · no network`.
2. **Demo GIF, above the fold** — Alt+C → click → panel with path and screenshot. Recorded with the
   project's existing Playwright setup against `examples/demo-app`.
3. **The problem** — 3–4 concrete lines: you see a pixel, the agent sees text, there is no shared
   pointing gesture, so "the third card is 2px off" costs several wrong-file round trips.
4. **The fix** — Alt+C, click, Ctrl+V, plus a code block with the real clipboard payload:
   `<button> · CheckoutCard · src/components/CheckoutCard.vue:42:5-48:12`.
5. **Quickstart** — `npm i -D vite-plugin-thisone` and a three-line config, Vue and React variants.
6. **What lands on your clipboard** — the format broken down part by part, how it degrades when the
   source location can't be resolved, and the PNG screenshot with 30px of real surrounding page.
7. **Options** — table: `hotkey`, defaults, the docked quick-access button.
8. **Works with** — Vue 3, React, Vite 5/6/7; stripped entirely from production builds.
9. **Why not just X?** — honest comparison with `locatorjs`, `click-to-component`,
   `vite-plugin-vue-inspector`: those teleport _you_ into an editor; this one packages context _for
   an agent_ — path plus image, one gesture, no IDE integration.
10. **Privacy** — one line: no server, no network, no telemetry.
11. **Development / Contributing / License** — short, at the bottom.

## Discovery work beyond the README

- `keywords` in package.json: `ai`, `agent`, `llm`, `context`, `devtools`, `vue`, `react`,
  `inspector`, `vite-plugin`.
- GitHub repo topics mirroring those keywords.
- PR to `awesome-vite`.

## Scope of the code change

Mechanical rename across `src/`, `tests/`, `scripts/`, `examples/`, `docs/`, `package.json`, plus a
rebuilt `dist/`, version 1.0.0, and the `v1.0.0` tag. Behaviour is unchanged — no feature work is in
scope. The existing unit and e2e suites must stay green; e2e scripts reference the old identifiers
and are renamed with everything else.

npm publication requires `npm publish --access public` from an authenticated account; the `files`
field already ships `dist` and `src`.

## Out of scope

Non-Vite entry points (webpack/Nuxt/Astro). The brand root is reserved now, built later.
