#!/usr/bin/env node
import { context } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_BUILD_OPTIONS } from "./build-config.mjs";
import { isMainModule } from "./build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

export async function main() {
  mkdirSync(dist, { recursive: true });
  const ctx = await context({
    entryPoints: [resolve(root, "src/client/index.ts")],
    outfile: resolve(dist, "client.js"),
    logLevel: "info",
    ...CLIENT_BUILD_OPTIONS,
  });
  await ctx.watch();
  console.log("watching src/client — dist/client.js rebuilds on change");
  return ctx;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const ctx = await main();
  const shutdown = () => ctx.dispose().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
