import { describe, it, expect } from "vitest";
import thisoneEsbuild from "../../src/entries/esbuild";

describe("thisoneEsbuild", () => {
  it("merges a banner.js entry containing the injected client script into build options", async () => {
    const plugin = thisoneEsbuild();
    const build = {
      initialOptions: { banner: { css: "/* keep me */" } },
      onEnd: () => {},
      onLoad: () => {},
      onResolve: () => {},
      onStart: () => {},
      onDispose: () => {},
      esbuild: {},
      initialize: async () => {},
      resolve: async () => ({}) as any,
    };
    await plugin.setup(build as any);
    expect(build.initialOptions.banner.js).toContain("__THISONE_CFG__");
    expect(build.initialOptions.banner.css).toBe("/* keep me */");
  });
});
