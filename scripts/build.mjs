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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_BUNDLE_EXTERNAL } from "./build-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

export async function main() {
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
    // Не менять, потому что бандлинг @vue/compiler-sfc падает на его опциональных template-engine require().
    external: PLUGIN_BUNDLE_EXTERNAL,
    // The plugin now bundles the bridge, which bundles `ws`. ws require()s node
    // builtins; esbuild's ESM output routes those through a __require shim that
    // throws ("Dynamic require of events") unless a real `require` exists. Define
    // one via createRequire so the shim picks it up (Phase 2 journal grabli).
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
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

  // (c) Type declarations. The plugin now imports from ../server, so the dts
  // program spans src/{plugin,server}; rootDir is "src" and tsc mirrors the tree
  // under dist/. Relocate the one file we ship (dist/plugin/index.d.ts) to
  // dist/index.d.ts and drop the rest — the public type surface references no
  // server types, so the relocated declaration stays self-contained.
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
  for (const dir of ["plugin", "server", "client"]) {
    rmSync(resolve(dist, dir), { recursive: true, force: true });
  }

  await build({
    entryPoints: [resolve(root, "claude-plugin/mcp-server.mjs")],
    outfile: resolve(root, "claude-plugin/mcp-server.bundled.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    sourcemap: false,
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
  });
  if (
    readFileSync(resolve(root, "claude-plugin/mcp-server.bundled.mjs"), "utf8")
      .split("\n")
      .some((l) => /^import .*["']@modelcontextprotocol\/sdk/.test(l))
  ) {
    throw new Error(
      "mcp-server.bundled.mjs still imports @modelcontextprotocol/sdk as a bare specifier — bundling failed",
    );
  }

  console.log(
    "build ok: dist/{index.js,client.js,index.d.ts}, claude-plugin/mcp-server.bundled.mjs",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
