#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { addPlugin } from "../lib/vite-config-patch.mjs";
import {
  CONFIG_NAMES,
  PKG_NAME,
  detectPackageManager,
} from "../lib/project.mjs";

const REPO = "SI-IC/vue-pick-problem-skill";
const EXEC_TIMEOUT_MS = 60_000;

export function inspectProject(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return { reason: "not_node_project" };

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return { reason: "bad_package_json" };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasVite = Boolean(deps.vite);
  const hasVue = Boolean(deps.vue);
  if (!hasVite) return { reason: "not_vite", hasVite, hasVue };
  if (!hasVue) return { reason: "not_vue", hasVite, hasVue };

  const configName = CONFIG_NAMES.find((n) => existsSync(join(dir, n)));
  if (!configName) return { reason: "no_vite_config", hasVite, hasVue };

  const configPath = join(dir, configName);
  const source = readFileSync(configPath, "utf8");
  const depWired = Boolean(deps[PKG_NAME]);
  const configWired = source.includes(PKG_NAME);

  return {
    hasVite: true,
    hasVue: true,
    configName,
    configPath,
    depWired,
    configWired,
    wired: depWired && configWired,
  };
}

function compareTags(a, b) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function resolveLatestTag() {
  try {
    const out = execFileSync(
      "git",
      ["ls-remote", "--tags", "--refs", `https://github.com/${REPO}`],
      { encoding: "utf8", timeout: EXEC_TIMEOUT_MS },
    );
    const tags = [...out.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)/g)].map(
      (m) => m[1],
    );
    if (!tags.length) return null;
    return tags.sort(compareTags).at(-1);
  } catch {
    return null;
  }
}

function installDep(dir, tag) {
  const pm = detectPackageManager(dir);
  const spec = `github:${REPO}#${tag}`;
  const cmd =
    pm === "pnpm"
      ? ["pnpm", "add", "-D", spec]
      : pm === "yarn"
        ? ["yarn", "add", "-D", spec]
        : ["npm", "install", "-D", spec];
  execFileSync(cmd[0], cmd.slice(1), {
    cwd: dir,
    stdio: "inherit",
    timeout: EXEC_TIMEOUT_MS,
  });
}

export function wire(dir) {
  const info = inspectProject(dir);
  if (info.reason) {
    console.error(`[claude-feedback] wire: skip (${info.reason})`);
    return info;
  }
  if (info.wired) {
    console.error("[claude-feedback] wire: already wired, no-op");
    return info;
  }

  const skipInstall = process.env.CLAUDE_FEEDBACK_SKIP_INSTALL === "1";
  if (!info.depWired && !skipInstall) {
    const tag = resolveLatestTag();
    if (!tag) {
      console.error(
        "[claude-feedback] wire: could not resolve latest tag (network?), skipping install",
      );
      return info;
    }
    try {
      installDep(dir, tag);
    } catch (err) {
      console.error(`[claude-feedback] wire: install failed (${err.message})`);
      return info;
    }
  }

  if (!info.configWired) {
    const source = readFileSync(info.configPath, "utf8");
    const { changed, result, note } = addPlugin(source);
    if (!changed) {
      console.error(
        `[claude-feedback] wire: could not patch ${info.configName} automatically${note ? ` (${note})` : ""} — add manually: import { claudeFeedback } from "vite-plugin-claude-feedback"; and claudeFeedback() in plugins[]`,
      );
      return info;
    }
    try {
      writeFileSync(info.configPath, result);
    } catch (err) {
      console.error(
        `[claude-feedback] wire: could not write ${info.configName} (${err.message})`,
      );
      return info;
    }
  }

  console.error("[claude-feedback] wire: done");
  return info;
}

function main() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    wire(dir);
  } catch (err) {
    console.error(`[claude-feedback] wire: unexpected error (${err.message})`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
