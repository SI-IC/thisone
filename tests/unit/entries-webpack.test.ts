import { describe, it, expect } from "vitest";
import webpack from "webpack";
import thisoneWebpack from "../../src/entries/webpack";

function realCompiler(mode?: "development" | "production" | "none") {
  return webpack(mode ? { mode, entry: {} } : { entry: {} });
}

describe("thisoneWebpack", () => {
  it("registers the source-location transform loader in development mode", () => {
    const compiler = realCompiler("development");
    thisoneWebpack().apply!(compiler);
    expect(compiler.options.module.rules.length).toBeGreaterThan(0);
  });

  it("does not register the source-location transform loader in production mode", () => {
    const compiler = realCompiler("production");
    thisoneWebpack().apply!(compiler);
    expect(compiler.options.module.rules.length).toBe(0);
  });
});

describe("thisoneWebpack unknown mode", () => {
  it("registers nothing when mode is left unset (webpack builds as production)", () => {
    const compiler = realCompiler();
    thisoneWebpack().apply!(compiler);
    expect(compiler.options.module.rules.length).toBe(0);
  });

  it("registers nothing for mode:none (library/prod bundles)", () => {
    const compiler = realCompiler("none");
    thisoneWebpack().apply!(compiler);
    expect(compiler.options.module.rules.length).toBe(0);
  });

  it("honors enabled:true when mode is unset", () => {
    const compiler = realCompiler();
    thisoneWebpack({ enabled: true }).apply!(compiler);
    expect(compiler.options.module.rules.length).toBeGreaterThan(0);
  });
});

describe("thisoneWebpack enabled:false", () => {
  it("registers nothing in development when enabled is false (permission-style explicit off-switch)", () => {
    const compiler = realCompiler("development");
    thisoneWebpack({ enabled: false }).apply!(compiler);
    expect(compiler.options.module.rules.length).toBe(0);
  });
});
