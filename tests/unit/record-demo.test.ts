import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations
import { isDirectRun, recordDemo } from "../../scripts/record-demo.mjs";

const SOURCE = readFileSync(
  resolve(__dirname, "../../scripts/record-demo.mjs"),
  "utf8",
);

describe("recordDemo", () => {
  it("malformed-input: rejects a non-numeric port without launching a browser", async () => {
    await expect(recordDemo("@evil.tld")).rejects.toThrow(/usage/);
  });

  it("empty: rejects a missing port", async () => {
    await expect(recordDemo(undefined)).rejects.toThrow(/usage/);
  });

  it("boundary: rejects zero and negative ports", async () => {
    await expect(recordDemo("0")).rejects.toThrow(/usage/);
    await expect(recordDemo("-1")).rejects.toThrow(/usage/);
  });
});

describe("isDirectRun", () => {
  it("is false when the module is imported rather than executed", () => {
    expect(isDirectRun(process.argv[1])).toBe(false);
  });

  it("empty: is false when argv carries no entry path", () => {
    expect(isDirectRun(undefined)).toBe(false);
    expect(isDirectRun("")).toBe(false);
  });

  it("is true for its own path", () => {
    expect(
      isDirectRun(resolve(__dirname, "../../scripts/record-demo.mjs")),
    ).toBe(true);
  });
});

describe("record-demo browser lifecycle", () => {
  it("concurrency: closes the browser from a finally block on every path", () => {
    expect(SOURCE).toMatch(/} finally \{\s*await browser\.close\(\);/);
  });

  it("permission: grants clipboard-write only, never clipboard-read", () => {
    expect(SOURCE).toContain('permissions: ["clipboard-write"]');
    expect(SOURCE).not.toContain("clipboard-read");
  });
});
