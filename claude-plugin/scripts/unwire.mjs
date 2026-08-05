#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { removePlugin } from "../lib/vite-config-patch.mjs";
import {
  CONFIG_NAMES,
  PKG_NAME,
  detectPackageManager,
} from "../lib/project.mjs";

const EXEC_TIMEOUT_MS = 60_000;

function uninstallDep(dir) {
  const pm = detectPackageManager(dir);
  const cmd =
    pm === "pnpm"
      ? ["pnpm", "remove", PKG_NAME]
      : pm === "yarn"
        ? ["yarn", "remove", PKG_NAME]
        : ["npm", "uninstall", PKG_NAME];
  execFileSync(cmd[0], cmd.slice(1), {
    cwd: dir,
    stdio: "inherit",
    timeout: EXEC_TIMEOUT_MS,
  });
}

export function unwire(dir) {
  const configName = CONFIG_NAMES.find((n) => existsSync(join(dir, n)));
  if (configName) {
    const configPath = join(dir, configName);
    const source = readFileSync(configPath, "utf8");
    const { changed, result } = removePlugin(source);
    if (changed) {
      writeFileSync(configPath, result);
      console.error(
        `[claude-feedback] unwire: removed plugin from ${configName}`,
      );
    } else {
      console.error(
        `[claude-feedback] unwire: ${configName} had no claude-feedback plugin`,
      );
    }
  } else {
    console.error("[claude-feedback] unwire: no vite.config found, skip");
  }

  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return;
  }
  const wired = Boolean(
    pkg.dependencies?.[PKG_NAME] || pkg.devDependencies?.[PKG_NAME],
  );
  if (!wired) return;
  try {
    uninstallDep(dir);
    console.error("[claude-feedback] unwire: dependency removed");
  } catch (err) {
    console.error(
      `[claude-feedback] unwire: dep removal failed (${err.message})`,
    );
  }
}

function main() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    unwire(dir);
  } catch (err) {
    console.error(
      `[claude-feedback] unwire: unexpected error (${err.message})`,
    );
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
