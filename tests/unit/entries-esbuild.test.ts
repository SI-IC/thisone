import { describe, it, expect, afterEach, vi } from "vitest";
import thisoneEsbuild from "../../src/entries/esbuild";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function fakeBuild() {
  return {
    initialOptions: { banner: { css: "/* keep me */" } } as any,
    onEnd: () => {},
    onLoad: () => {},
    onResolve: () => {},
    onStart: () => {},
    onDispose: () => {},
    esbuild: {},
    initialize: async () => {},
    resolve: async () => ({}) as any,
  };
}

describe("thisoneEsbuild", () => {
  it("adds no banner and no source transform when NODE_ENV is unset (fail-closed)", async () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unsetBuild = fakeBuild();
    await thisoneEsbuild().setup(unsetBuild as any);
    expect(unsetBuild.initialOptions.banner.js).toBeUndefined();
    warn.mockRestore();
  });

  it("adds no banner and no source transform when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const build = fakeBuild();
    await thisoneEsbuild().setup(build as any);
    expect(build.initialOptions.banner.js).toBeUndefined();
    expect(build.initialOptions.banner.css).toBe("/* keep me */");
  });

  it("still injects in production when enabled is set explicitly", async () => {
    process.env.NODE_ENV = "production";
    const build = fakeBuild();
    await thisoneEsbuild({ enabled: true }).setup(build as any);
    expect(build.initialOptions.banner.js).toContain("__THISONE_CFG__");
  });

  it("merges a banner.js entry containing the injected client script into build options", async () => {
    process.env.NODE_ENV = "development";
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
