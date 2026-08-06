#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { addPlugin } from "../lib/vite-config-patch.mjs";
import {
  CONFIG_NAMES,
  PKG_NAME,
  detectPackageManager,
} from "../lib/project.mjs";

const REPO = "SI-IC/vue-pick-problem-skill";
const GITHUB_SPEC_PREFIX = `github:${REPO}#`;
const EXEC_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 300_000;

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

export function compareTags(a, b) {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function readDepSpec(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const spec = deps[PKG_NAME];
  return typeof spec === "string" ? spec : null;
}

export function extractPinnedTag(dir) {
  const spec = readDepSpec(dir);
  if (!spec) return null;
  const m = /#(v\d+\.\d+\.\d+)$/.exec(spec);
  return m ? m[1] : null;
}

function resolveLatestTag() {
  try {
    const out = execFileSync(
      "git",
      ["ls-remote", "--tags", "--refs", `https://github.com/${REPO}`],
      { encoding: "utf8", timeout: EXEC_TIMEOUT_MS },
    );
    const tags = [
      ...out.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)(?=\r?\n|\t|$)/g),
    ].map((m) => m[1]);
    if (!tags.length) return null;
    return tags.sort(compareTags).at(-1);
  } catch {
    return null;
  }
}

function installDep(dir, tag, timeout = EXEC_TIMEOUT_MS) {
  const pm = detectPackageManager(dir);
  const spec = `${GITHUB_SPEC_PREFIX}${tag}`;
  const cmd =
    pm === "pnpm"
      ? ["pnpm", "add", "-D", spec]
      : pm === "yarn"
        ? ["yarn", "add", "-D", spec]
        : ["npm", "install", "-D", spec];
  execFileSync(cmd[0], cmd.slice(1), {
    cwd: dir,
    stdio: "inherit",
    timeout,
  });
}

function updatePinnedTag(dir, info) {
  const skipInstall = process.env.CLAUDE_FEEDBACK_SKIP_INSTALL === "1";
  if (skipInstall) {
    console.error(
      "[claude-feedback] wire: update skipped (CLAUDE_FEEDBACK_SKIP_INSTALL=1)",
    );
    return info;
  }
  const spec = readDepSpec(dir);
  if (spec && !spec.startsWith(GITHUB_SPEC_PREFIX)) {
    console.error(
      `[claude-feedback] wire: dependency is pinned to a non-standard source (${spec}), skipping automatic update`,
    );
    return info;
  }
  const latest = resolveLatestTag();
  if (!latest) {
    console.error(
      "[claude-feedback] wire: could not resolve latest tag (network?), skipping update",
    );
    return info;
  }
  const current = extractPinnedTag(dir);
  if (current === latest) {
    console.error(`[claude-feedback] wire: already up to date (${latest})`);
    return info;
  }
  try {
    installDep(dir, latest, INSTALL_TIMEOUT_MS);
  } catch (err) {
    console.error(
      `[claude-feedback] wire: update failed (${err.message}) — package.json may have been partially modified, check \`git diff package.json\``,
    );
    return info;
  }
  console.error(
    `[claude-feedback] wire: updated ${current ?? "unknown"} -> ${latest} — restart your dev server to pick it up`,
  );
  return { ...info, updatedFrom: current, updatedTo: latest };
}

export function wire(dir, opts = {}) {
  const info = inspectProject(dir);
  if (info.reason) {
    console.error(`[claude-feedback] wire: skip (${info.reason})`);
    return info;
  }
  if (info.wired) {
    if (!opts.update) {
      console.error("[claude-feedback] wire: already wired, no-op");
      return info;
    }
    return updatePinnedTag(dir, info);
  }

  const skipInstall = process.env.CLAUDE_FEEDBACK_SKIP_INSTALL === "1";
  let result = info;
  if (info.depWired) {
    if (opts.update && !skipInstall) {
      result = updatePinnedTag(dir, info);
    }
  } else if (!skipInstall) {
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
    const { changed, result: patchedSource, note } = addPlugin(source);
    if (!changed) {
      console.error(
        `[claude-feedback] wire: could not patch ${info.configName} automatically${note ? ` (${note})` : ""} — add manually: import { claudeFeedback } from "vite-plugin-claude-feedback"; and claudeFeedback() in plugins[]`,
      );
      return result;
    }
    try {
      writeFileSync(info.configPath, patchedSource);
    } catch (err) {
      console.error(
        `[claude-feedback] wire: could not write ${info.configName} (${err.message})`,
      );
      return result;
    }
  }

  console.error("[claude-feedback] wire: done");
  return result;
}

function main() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const update = process.argv.includes("--update");
  try {
    wire(dir, { update });
  } catch (err) {
    console.error(`[claude-feedback] wire: unexpected error (${err.message})`);
  }
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
  main();
}
