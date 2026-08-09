import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const LEGACY_PKG_DIR = "packages/vite-plugin-thisone-legacy";

function readJson(relative: string) {
  return JSON.parse(readFileSync(resolve(ROOT, relative), "utf8"));
}

describe("vite-plugin-thisone legacy alias package", () => {
  it("re-exports the plugin as its default export", async () => {
    const mod =
      await import("../../packages/vite-plugin-thisone-legacy/index.js");
    expect(typeof mod.default).toBe("function");
    expect(mod.default().name).toBe("vite-plugin-thisone");
  });

  it("re-exports the named thisone export", async () => {
    const mod: Record<string, unknown> =
      await import("../../packages/vite-plugin-thisone-legacy/index.js");
    expect(typeof mod.thisone).toBe("function");
  });

  it("declares a dependency range that admits the current plugin version", () => {
    const plugin = readJson("package.json");
    const alias = readJson(`${LEGACY_PKG_DIR}/package.json`);
    const range = alias.dependencies["@si-ic/thisone"];
    const [major] = plugin.version.split(".");
    expect(range).toBe(`^${major}.0.0`);
  });

  it("boundary: ships every file its exports map points at", () => {
    const alias = readJson(`${LEGACY_PKG_DIR}/package.json`);
    for (const file of ["index.js", "index.d.ts", "README.md"]) {
      expect(alias.files).toContain(file);
    }
  });

  it("points npm at its own subdirectory in the repository", () => {
    const alias = readJson(`${LEGACY_PKG_DIR}/package.json`);
    expect(alias.repository.directory).toBe(LEGACY_PKG_DIR);
  });
});
