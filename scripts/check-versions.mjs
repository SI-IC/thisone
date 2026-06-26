#!/usr/bin/env node
// Fail (exit 1) if the three version fields ever diverge or are missing.
// Run as `pnpm check:versions` and (implicitly) guards against drift.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  {
    label: "package.json",
    file: resolve(ROOT, "package.json"),
    pick: (j) => j.version,
  },
  {
    label: "claude-plugin/.claude-plugin/plugin.json",
    file: resolve(ROOT, "claude-plugin/.claude-plugin/plugin.json"),
    pick: (j) => j.version,
  },
  {
    label: ".claude-plugin/marketplace.json (claude-feedback)",
    file: resolve(ROOT, ".claude-plugin/marketplace.json"),
    pick: (j) =>
      (j.plugins || []).find((p) => p.name === "claude-feedback")?.version,
  },
];

const found = [];
let ok = true;

for (const s of sources) {
  let version;
  try {
    version = s.pick(JSON.parse(readFileSync(s.file, "utf8")));
  } catch (err) {
    console.error(`check-versions: cannot read ${s.label}: ${err.message}`);
    ok = false;
    continue;
  }
  if (!version) {
    console.error(`check-versions: missing version in ${s.label}`);
    ok = false;
  }
  found.push({ label: s.label, version: version ?? "(none)" });
}

const versions = new Set(found.map((f) => f.version));
if (ok && versions.size !== 1) {
  ok = false;
  console.error("check-versions: versions diverge:");
  for (const f of found) console.error(`  ${f.version}  ${f.label}`);
}

if (ok) {
  console.log(`check-versions ok: all at ${found[0].version}`);
  process.exit(0);
}
process.exit(1);
