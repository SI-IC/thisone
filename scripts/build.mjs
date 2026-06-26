#!/usr/bin/env node
// Build the two artifacts that downstream phases depend on:
//   dist/index.js    — Vite plugin, ESM, platform node (deps like `ws` bundled in)
//   dist/client.js   — browser overlay bundle, IIFE, inlined into dev HTML
//   dist/index.d.ts  — plugin type declarations (via tsc)
//
// NOTE: the plan named `tsup`, but `tsup` is not available in this environment's
// offline package store while `esbuild` + `typescript` are. esbuild (bundle) + tsc
// (declarations) produce the identical build contract, so the substitution is
// transparent to every later phase (`pnpm build` -> dist/{index.js,index.d.ts,client.js}).

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// (a) Vite plugin — ESM for Node. Node builtins stay external automatically;
// runtime deps (ws) get bundled so a github-install needs no toolchain.
await build({
  entryPoints: [resolve(root, "src/plugin/index.ts")],
  outfile: resolve(dist, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: false,
  // vite is a peer dependency — never bundle it.
  external: ["vite"],
});

// (b) Client overlay — single IIFE bundle inlined into dev pages.
await build({
  entryPoints: [resolve(root, "src/client/index.ts")],
  outfile: resolve(dist, "client.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2019",
  sourcemap: false,
});

// (c) Type declarations -> dist/index.d.ts
execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    resolve(root, "tsconfig.dts.json"),
  ],
  { stdio: "inherit", cwd: root },
);

console.log("build ok: dist/{index.js,client.js,index.d.ts}");
