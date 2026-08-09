import { describe, it, expect } from "vitest";
import thisoneRollup from "../../src/entries/rollup";

describe("thisoneRollup", () => {
  it("adds a banner containing the injected client script to entry chunks only", () => {
    const plugin = thisoneRollup() as any;
    const entryResult = plugin.renderChunk(
      "console.log('app');",
      { isEntry: true },
      {},
    );
    expect(entryResult.code).toContain("__THISONE_CFG__");
    expect(entryResult.code.endsWith("console.log('app');")).toBe(true);
  });

  it("leaves non-entry chunks untouched", () => {
    const plugin = thisoneRollup() as any;
    const result = plugin.renderChunk(
      "console.log('chunk');",
      { isEntry: false },
      {},
    );
    expect(result).toBeNull();
  });
});
