#!/usr/bin/env node
// Build the two artifacts that downstream phases depend on:
//   dist/index.js    — Vite plugin, ESM, platform node
//   dist/client.js   — browser overlay bundle, IIFE, inlined into dev HTML
//   dist/index.d.ts  — plugin type declarations (via tsc)
//
// NOTE: the plan named `tsup`, but `tsup` is not available in this environment's
// offline package store while `esbuild` + `typescript` are. esbuild (bundle) + tsc
// (declarations) produce the identical build contract, so the substitution is
// transparent to every later phase (`pnpm build` -> dist/{index.js,index.d.ts,client.js}).

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CLIENT_BUILD_OPTIONS,
  PLUGIN_BUNDLE_EXTERNAL,
} from "./build-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

export async function main() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // (a) Vite plugin — ESM for Node. Node builtins stay external automatically;
  await build({
    entryPoints: [resolve(root, "src/plugin/index.ts")],
    outfile: resolve(dist, "index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    sourcemap: false,
    // Do not change, because bundling @vue/compiler-sfc breaks on its optional template-engine require() calls.
    external: PLUGIN_BUNDLE_EXTERNAL,
  });

  // (b) Client overlay — single IIFE bundle inlined into dev pages.
  await build({
    entryPoints: [resolve(root, "src/client/index.ts")],
    outfile: resolve(dist, "client.js"),
    ...CLIENT_BUILD_OPTIONS,
  });

  // Do not change, because tsconfig.dts.json include=["src/plugin/index.ts"] -> tsc emits only dist/plugin/index.d.ts, which the relocation below expects
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      resolve(root, "tsconfig.dts.json"),
    ],
    { stdio: "inherit", cwd: root },
  );

  const emitted = resolve(dist, "plugin/index.d.ts");
  if (!existsSync(emitted)) {
    throw new Error("dts emit missing expected dist/plugin/index.d.ts");
  }
  renameSync(emitted, resolve(dist, "index.d.ts"));
  rmSync(resolve(dist, "plugin"), { recursive: true, force: true });

  console.log("build ok: dist/{index.js,client.js,index.d.ts}");
}

export function isMainModule(moduleUrl, argvPath) {
  if (!argvPath) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
