#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function assert(cond, msg) {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

const work = mkdtempSync(join(tmpdir(), "cf-wire-smoke-"));
try {
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "demo",
      devDependencies: { vite: "7.0.0", vue: "3.5.0" },
    }),
  );
  const originalConfig =
    "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({\n  plugins: [vue()],\n});\n";
  writeFileSync(join(work, "vite.config.ts"), originalConfig);

  execFileSync(
    process.execPath,
    [join(repoRoot, "claude-plugin", "scripts", "wire.mjs")],
    {
      cwd: work,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: work,
        CLAUDE_FEEDBACK_SKIP_INSTALL: "1",
      },
      stdio: "inherit",
    },
  );

  const patched = readFileSync(join(work, "vite.config.ts"), "utf8");
  assert(
    patched.includes("claudeFeedback"),
    "wire.mjs patched vite.config.ts with claudeFeedback",
  );
  assert(
    patched.includes('from "vite-plugin-claude-feedback"'),
    "wire.mjs added the import line",
  );

  execFileSync(
    process.execPath,
    [join(repoRoot, "claude-plugin", "scripts", "unwire.mjs")],
    {
      cwd: work,
      env: { ...process.env, CLAUDE_PROJECT_DIR: work },
      stdio: "inherit",
    },
  );

  const restored = readFileSync(join(work, "vite.config.ts"), "utf8");
  assert(
    !restored.includes("claudeFeedback"),
    "unwire.mjs removed claudeFeedback from vite.config.ts",
  );
  assert(restored.includes("vue()"), "unwire.mjs preserved the vue() plugin");

  const manifest = JSON.parse(
    readFileSync(
      join(repoRoot, "claude-plugin/.claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  assert(manifest.mcpServers?.["claude-feedback"], "manifest has mcpServers");
  assert(manifest.hooks?.SessionStart, "manifest has SessionStart hook");

  const bundled = readFileSync(
    join(repoRoot, "claude-plugin/mcp-server.bundled.mjs"),
    "utf8",
  );
  assert(
    !bundled
      .split("\n")
      .some((l) => /^import .*["']@modelcontextprotocol\/sdk/.test(l)),
    "mcp-server.bundled.mjs has no bare @modelcontextprotocol/sdk import",
  );
  execFileSync(process.execPath, [
    "--check",
    join(repoRoot, "claude-plugin/mcp-server.bundled.mjs"),
  ]);

  mkdirSync(join(work, "no-vite"), { recursive: true });
  writeFileSync(join(work, "no-vite", "package.json"), JSON.stringify({}));
  execFileSync(
    process.execPath,
    [join(repoRoot, "claude-plugin", "scripts", "wire.mjs")],
    {
      cwd: join(work, "no-vite"),
      env: { ...process.env, CLAUDE_PROJECT_DIR: join(work, "no-vite") },
      stdio: "pipe",
    },
  );

  console.log("wire-smoke ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
