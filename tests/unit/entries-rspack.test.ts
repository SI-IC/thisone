import { describe, it, expect, vi } from "vitest";
import { rspack } from "@rspack/core";
import thisoneRspack from "../../src/entries/rspack";

const PLUGIN_NAME = "thisone-rspack";

function realCompiler(mode: "development" | "production") {
  return rspack({ mode, entry: {} });
}

function fakeCompilation() {
  const processAssetsTap = vi.fn();
  return {
    hooks: { processAssets: { tap: processAssetsTap } },
    updateAsset: vi.fn(),
    __processAssetsTap: processAssetsTap,
  };
}

describe("thisoneRspack", () => {
  it("registers a compilation hook in development mode", () => {
    const compiler = realCompiler("development");
    thisoneRspack().apply(compiler);
    const tap = compiler.hooks.compilation.taps.find(
      (t) => t.name === PLUGIN_NAME,
    );
    expect(tap).toBeDefined();
  });

  it("does not register injection hooks in production mode", () => {
    const compiler = realCompiler("production");
    thisoneRspack().apply(compiler);
    const tap = compiler.hooks.compilation.taps.find(
      (t) => t.name === PLUGIN_NAME,
    );
    expect(tap).toBeUndefined();
  });

  it("registers a processAssets hook on the compilation", () => {
    const compiler = realCompiler("development");
    thisoneRspack().apply(compiler);
    const tap = compiler.hooks.compilation.taps.find(
      (t) => t.name === PLUGIN_NAME,
    )!;
    const compilation = fakeCompilation();
    (tap.fn as (c: unknown) => void)(compilation);
    expect(compilation.__processAssetsTap).toHaveBeenCalled();
  });

  it("injects the script into .html assets containing </body> and skips other assets", () => {
    const compiler = realCompiler("development");
    thisoneRspack({ hotkey: "KeyB" }).apply(compiler);
    const compilationTap = compiler.hooks.compilation.taps.find(
      (t) => t.name === PLUGIN_NAME,
    )!;
    const compilation = fakeCompilation();
    (compilationTap.fn as (c: unknown) => void)(compilation);

    const [, processAssetsHandler] = compilation.__processAssetsTap.mock
      .calls[0] as [unknown, (assets: any) => void];
    processAssetsHandler({
      "index.html": { source: () => "<html><body></body></html>" },
      "main.js": { source: () => "console.log(1);" },
    });

    expect(compilation.updateAsset).toHaveBeenCalledTimes(1);
    const [name, source] = compilation.updateAsset.mock.calls[0];
    expect(name).toBe("index.html");
    expect(source.source()).toContain("__THISONE_CFG__");
    expect(source.source()).toContain('"hotkey":"KeyB"');
  });
});
