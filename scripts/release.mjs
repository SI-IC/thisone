#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = resolve(ROOT, "package.json");

const LEVELS = new Set(["patch", "minor", "major"]);
const level = process.argv[2];

if (!LEVELS.has(level)) {
  console.error(`release: unknown bump "${level ?? ""}"`);
  console.error("usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) {
    console.error(`release: cannot parse version "${version}"`);
    process.exit(1);
  }
  let [major, minor, patch] = m.slice(1).map(Number);
  if (kind === "major") ((major += 1), (minor = 0), (patch = 0));
  else if (kind === "minor") ((minor += 1), (patch = 0));
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

const ALIAS_PATH = resolve(
  ROOT,
  "packages/vite-plugin-thisone-legacy/package.json",
);

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const alias = JSON.parse(readFileSync(ALIAS_PATH, "utf8"));

if (!alias.dependencies?.["@si-ic/thisone"]) {
  console.error(
    "release: legacy alias package declares no @si-ic/thisone dependency",
  );
  process.exit(1);
}

const next = bump(pkg.version, level);
pkg.version = next;
alias.version = next;
alias.dependencies["@si-ic/thisone"] = `^${next.split(".")[0]}.0.0`;

writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(ALIAS_PATH, JSON.stringify(alias, null, 2) + "\n");

console.log(`release: bumped to ${next} (${level})`);
