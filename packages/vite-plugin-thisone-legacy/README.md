# vite-plugin-thisone

Legacy name for [`@si-ic/thisone`](https://www.npmjs.com/package/@si-ic/thisone) — point at any element in your Vite dev preview and hand your AI agent its exact source location and a screenshot. New installs should use `@si-ic/thisone` (or `@si-ic/thisone/webpack`, `/rspack`, `/rollup`, `/esbuild` for other bundlers); this package re-exports `@si-ic/thisone/vite` so existing installs keep working unchanged.

```bash
npm i -D vite-plugin-thisone
```

```ts
import thisone from "vite-plugin-thisone";
```

Full documentation: https://github.com/SI-IC/thisone
