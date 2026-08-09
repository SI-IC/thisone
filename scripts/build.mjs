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

const ENTRIES = [
  { name: "vite", outName: "index", external: [] },
  { name: "webpack", outName: "webpack", external: [] },
  { name: "rspack", outName: "rspack", external: ["@rspack/core"] },
  { name: "rollup", outName: "rollup", external: ["rollup"] },
  { name: "esbuild", outName: "esbuild", external: ["esbuild"] },
];

export async function main() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  for (const entry of ENTRIES) {
    await build({
      entryPoints: [resolve(root, `src/entries/${entry.name}.ts`)],
      outfile: resolve(dist, `${entry.outName}.js`),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node18",
      sourcemap: false,
      // Do not change, because bundling @vue/compiler-sfc breaks on its optional template-engine require() calls.
      external: [...PLUGIN_BUNDLE_EXTERNAL, ...entry.external],
    });
  }

  await build({
    entryPoints: [resolve(root, "src/client/index.ts")],
    outfile: resolve(dist, "client.js"),
    ...CLIENT_BUILD_OPTIONS,
  });

  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      resolve(root, "tsconfig.dts.json"),
    ],
    { stdio: "inherit", cwd: root },
  );

  for (const entry of ENTRIES) {
    const emitted = resolve(dist, `entries/${entry.name}.d.ts`);
    if (!existsSync(emitted)) {
      throw new Error(
        `dts emit missing expected dist/entries/${entry.name}.d.ts`,
      );
    }
    renameSync(emitted, resolve(dist, `${entry.outName}.d.ts`));
  }
  rmSync(resolve(dist, "entries"), { recursive: true, force: true });
  rmSync(resolve(dist, "core"), { recursive: true, force: true });
  rmSync(resolve(dist, "plugin"), { recursive: true, force: true });

  console.log(
    "build ok: dist/{" +
      ENTRIES.map((e) => `${e.outName}.js`).join(",") +
      ",client.js}",
  );
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
