import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PLUGIN_BUNDLE_EXTERNAL } from "../../scripts/build-config.mjs";
import { main as buildMain, isMainModule } from "../../scripts/build.mjs";

const distIndex = join(process.cwd(), "dist/index.js");

describe("scripts/build.mjs", () => {
  it("exports main() without running the build on import (side-effect guard)", () => {
    expect(typeof buildMain).toBe("function");
  });
});

describe("isMainModule (scripts/build.mjs)", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cf-build-main-module-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when argvPath is missing (spawned with no script arg)", () => {
    expect(isMainModule("file:///x.mjs", undefined)).toBe(false);
  });

  it("matches a direct invocation (argv[1] === the real file path)", () => {
    const real = join(dir, "real.mjs");
    writeFileSync(real, "");
    expect(isMainModule(pathToFileURL(real).href, real)).toBe(true);
  });

  it("still matches when argv[1] is a symlink to the real file", () => {
    const real = join(dir, "real.mjs");
    const link = join(dir, "link.mjs");
    writeFileSync(real, "");
    symlinkSync(real, link);
    expect(isMainModule(pathToFileURL(real).href, link)).toBe(true);
  });
});

describe("build config (scripts/build-config.mjs)", () => {
  it("keeps @vue/compiler-sfc and @vue/compiler-core external, alongside vite", () => {
    expect(PLUGIN_BUNDLE_EXTERNAL).toEqual(
      expect.arrayContaining([
        "vite",
        "@vue/compiler-sfc",
        "@vue/compiler-core",
      ]),
    );
  });
});

describe("build externals (scripts/build.mjs)", () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(
        "run `pnpm build` before this test (needs dist/index.js)",
      );
    }
  });

  it("keeps @vue/compiler-sfc and @vue/compiler-core as external imports, not bundled", () => {
    const code = readFileSync(distIndex, "utf8");
    expect(code).toMatch(/from\s+["']@vue\/compiler-sfc["']/);
    expect(code).toMatch(/from\s+["']@vue\/compiler-core["']/);
  });

  it("does not inline compiler-sfc's optional template-engine requires", () => {
    const code = readFileSync(distIndex, "utf8");
    expect(code).not.toMatch(/require\(\s*["']pug["']\s*\)/);
    expect(code).not.toMatch(/require\(\s*["']atpl["']\s*\)/);
  });
});
