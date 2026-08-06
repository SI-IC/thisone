import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distIndex = join(process.cwd(), "dist/index.js");

describe("build externals (scripts/build.mjs)", () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error("run `pnpm build` before this test (needs dist/index.js)");
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
