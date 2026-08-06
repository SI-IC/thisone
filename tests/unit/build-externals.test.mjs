import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_BUNDLE_EXTERNAL } from "../../scripts/build-config.mjs";
import { main as buildMain } from "../../scripts/build.mjs";

const distIndex = join(process.cwd(), "dist/index.js");

describe("scripts/build.mjs", () => {
  it("exports main() without running the build on import (side-effect guard)", () => {
    expect(typeof buildMain).toBe("function");
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
