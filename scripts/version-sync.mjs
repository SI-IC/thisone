#!/usr/bin/env node
// Single source of truth = root package.json `version`.
// Sync it into the CC-plugin manifest and the marketplace entry so the three
// never drift. Used by release.mjs and the husky pre-commit hook.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PATHS = {
  pkg: resolve(ROOT, "package.json"),
  plugin: resolve(ROOT, "claude-plugin/.claude-plugin/plugin.json"),
  marketplace: resolve(ROOT, ".claude-plugin/marketplace.json"),
};

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Preserve trailing newline + 2-space indent that the rest of the repo uses.
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function rootVersion() {
  return readJson(PATHS.pkg).version;
}

/** Write the root version into the plugin manifest + marketplace entry. */
export function syncVersions() {
  const version = rootVersion();

  const plugin = readJson(PATHS.plugin);
  plugin.version = version;
  writeJson(PATHS.plugin, plugin);

  const marketplace = readJson(PATHS.marketplace);
  const entry = (marketplace.plugins || []).find(
    (p) => p.name === "claude-feedback",
  );
  if (!entry) {
    console.error(
      'version-sync: no "claude-feedback" plugin entry in marketplace.json',
    );
    process.exit(1);
  }
  entry.version = version;
  writeJson(PATHS.marketplace, marketplace);

  return version;
}

// Run sync when invoked directly (not when imported).
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const v = syncVersions();
  console.log(`version-sync: all manifests at ${v}`);
}
