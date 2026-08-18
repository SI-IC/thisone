import { describe, it, expect, afterEach, vi } from "vitest";
import thisoneRollup from "../../src/entries/rollup";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("thisoneRollup", () => {
  it("adds a banner containing the injected client script to entry chunks only", () => {
    process.env.NODE_ENV = "development";
    const plugin = thisoneRollup() as any;
    const entryResult = plugin.renderChunk(
      "console.log('app');",
      { isEntry: true },
      {},
    );
    expect(entryResult.code).toContain("__THISONE_CFG__");
    expect(entryResult.code.endsWith("console.log('app');")).toBe(true);
  });

  it("injects neither the banner nor the source transform when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    const plugin = thisoneRollup() as any;
    expect(plugin.renderChunk).toBeUndefined();
    expect(plugin.transform).toBeUndefined();
  });

  it("still injects in production when enabled is set explicitly", () => {
    process.env.NODE_ENV = "production";
    const plugin = thisoneRollup({ enabled: true }) as any;
    const result = plugin.renderChunk(
      "console.log('app');",
      { isEntry: true },
      {},
    );
    expect(result.code).toContain("__THISONE_CFG__");
  });

  it("injects nothing when enabled is false outside production", () => {
    process.env.NODE_ENV = "development";
    const plugin = thisoneRollup({ enabled: false }) as any;
    expect(plugin.renderChunk).toBeUndefined();
  });

  it("stays off and warns when NODE_ENV is unset (boundary: bundler has no mode of its own)", () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = thisoneRollup() as any;
    expect(plugin.renderChunk).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NODE_ENV"));
    warn.mockRestore();
  });

  it("does not warn when enabled is passed explicitly with NODE_ENV unset", () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    thisoneRollup({ enabled: true });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves non-entry chunks untouched", () => {
    process.env.NODE_ENV = "development";
    const plugin = thisoneRollup() as any;
    const result = plugin.renderChunk(
      "console.log('chunk');",
      { isEntry: false },
      {},
    );
    expect(result).toBeNull();
  });
});
