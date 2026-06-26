#!/usr/bin/env node
// Bump the root package.json version (patch|minor|major) and sync the manifests.
// Usage: node scripts/release.mjs <patch|minor|major>
// Self-contained semver bump — no external dependency.

import { readFileSync, writeFileSync } from "node:fs";
import { PATHS, syncVersions } from "./version-sync.mjs";

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

const pkg = JSON.parse(readFileSync(PATHS.pkg, "utf8"));
const next = bump(pkg.version, level);
pkg.version = next;
writeFileSync(PATHS.pkg, JSON.stringify(pkg, null, 2) + "\n");

syncVersions();
console.log(`release: bumped to ${next} (${level})`);
