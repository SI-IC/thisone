import { describe, it, expect, afterEach, vi } from "vitest";
import thisoneRollup from "../../src/entries/rollup";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function ctx(watchMode: boolean) {
  return { meta: { watchMode } };
}

async function started(plugin: any, watchMode: boolean) {
  await plugin.buildStart?.call(ctx(watchMode), {});
  return plugin;
}

function renderEntry(plugin: any, watchMode = false) {
  return plugin.renderChunk.call(
    ctx(watchMode),
    "console.log('app');",
    { isEntry: true },
    {},
  );
}

describe("thisoneRollup", () => {
  it("adds a banner containing the injected client script to entry chunks only", async () => {
    process.env.NODE_ENV = "development";
    const plugin = await started(thisoneRollup() as any, false);
    const entryResult = renderEntry(plugin);
    expect(entryResult.code).toContain("__THISONE_CFG__");
    expect(entryResult.code.endsWith("console.log('app');")).toBe(true);
  });

  it("injects nothing when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const plugin = await started(thisoneRollup() as any, false);
    expect(renderEntry(plugin)).toBeNull();
    expect(
      plugin.transform.call(ctx(false), "<div/>", "/src/App.jsx"),
    ).toBeNull();
  });

  it("injects in watch mode when NODE_ENV is unset (rollup -c -w), warning that it is on", async () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await started(thisoneRollup() as any, true);
    expect(renderEntry(plugin, true).code).toContain("__THISONE_CFG__");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("watch mode"));
    warn.mockRestore();
  });

  it("stays off and warns for a one-shot build with NODE_ENV unset (boundary)", async () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await started(thisoneRollup() as any, false);
    expect(renderEntry(plugin)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("staying off"));
    warn.mockRestore();
  });

  it("warns once across watch rebuilds, not on every rebuild", async () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = thisoneRollup() as any;
    await started(plugin, true);
    await started(plugin, true);
    await started(plugin, true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps watch mode off when NODE_ENV explicitly says production", async () => {
    process.env.NODE_ENV = "production";
    const plugin = await started(thisoneRollup() as any, true);
    expect(renderEntry(plugin, true)).toBeNull();
  });

  it("concurrency: a dev build through the same instance does not enable a production chunk", async () => {
    const plugin = thisoneRollup() as any;
    process.env.NODE_ENV = "production";
    await started(plugin, false);
    process.env.NODE_ENV = "development";
    await started(plugin, false);
    process.env.NODE_ENV = "production";
    expect(renderEntry(plugin)).toBeNull();
  });

  it("gates the preact virtual module hooks too", () => {
    process.env.NODE_ENV = "production";
    const plugin = thisoneRollup() as any;
    expect(
      plugin.resolveId.call(ctx(false), "virtual:thisone-preact-hook"),
    ).toBeNull();
    expect(
      plugin.load.call(ctx(false), "\0virtual:thisone-preact-hook"),
    ).toBeNull();
  });

  it("still injects in production when enabled is set explicitly", async () => {
    process.env.NODE_ENV = "production";
    const plugin = await started(
      thisoneRollup({ enabled: true }) as any,
      false,
    );
    expect(renderEntry(plugin).code).toContain("__THISONE_CFG__");
  });

  it("returns an inert plugin when enabled is false outside production", () => {
    process.env.NODE_ENV = "development";
    const plugin = thisoneRollup({ enabled: false }) as any;
    expect(plugin.renderChunk).toBeUndefined();
    expect(plugin.transform).toBeUndefined();
  });

  it("does not warn when enabled is passed explicitly with NODE_ENV unset", async () => {
    delete process.env.NODE_ENV;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await started(thisoneRollup({ enabled: true }) as any, false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves non-entry chunks untouched", async () => {
    process.env.NODE_ENV = "development";
    const plugin = await started(thisoneRollup() as any, false);
    const result = plugin.renderChunk.call(
      ctx(false),
      "console.log('chunk');",
      { isEntry: false },
      {},
    );
    expect(result).toBeNull();
  });
});
