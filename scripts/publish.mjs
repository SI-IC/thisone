#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS_DIR = resolve(ROOT, "packages/vite-plugin-thisone-legacy");
const REGISTRY = process.env.THISONE_REGISTRY ?? "https://registry.npmjs.org";
const inActions = Boolean(process.env.GITHUB_ACTIONS);
const NPM = process.env.THISONE_NPM ?? "npm";

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

function readPackage(dir) {
  const path = resolve(dir, "package.json");
  if (!existsSync(path)) fail(`missing ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(`cannot parse ${path}`);
  }
}

async function isPublished(name, version) {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}/${version}`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    return fail(`cannot reach the registry at ${url}: ${error.message}`);
  }
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  return fail(`registry answered ${response.status} for ${name}@${version}`);
}

async function publish(name, version, cwd) {
  if (await isPublished(name, version)) {
    console.log(`publish: ${name}@${version} already published, skipping`);
    return;
  }
  if (dryRun) {
    console.log(`publish: would publish ${name}@${version} from ${cwd}`);
    return;
  }
  const result = spawnSync(NPM, ["publish", "--access", "public"], {
    cwd,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) fail(`npm publish failed for ${name}@${version}`);
  console.log(`publish: published ${name}@${version}`);
}

const pkg = readPackage(ROOT);
const alias = readPackage(ALIAS_DIR);

if (inActions) {
  if (process.env.GITHUB_REF_TYPE !== "tag") {
    fail(
      `refusing to publish from ${process.env.GITHUB_REF_TYPE || "an unknown ref"} — publish runs from a v<version> tag only`,
    );
  }
  const ref = process.env.GITHUB_REF_NAME ?? "";
  if (ref !== `v${pkg.version}`) {
    fail(`tag ${ref} does not match package.json version ${pkg.version}`);
  }
}

if (alias.version !== pkg.version) {
  fail(
    `alias version ${alias.version} does not match root version ${pkg.version}`,
  );
}

const range = alias.dependencies?.["@si-ic/thisone"];
const expectedRange = `^${pkg.version.split(".")[0]}.0.0`;
if (range !== expectedRange) {
  fail(
    `alias depends on @si-ic/thisone ${range ?? "(nothing)"}, expected ${expectedRange}`,
  );
}

if (!existsSync(resolve(ROOT, "dist/index.js"))) {
  fail("dist/index.js is missing — run pnpm build before publishing");
}

await publish(pkg.name, pkg.version, ROOT);
await publish(alias.name, alias.version, ALIAS_DIR);
