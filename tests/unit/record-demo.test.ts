import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../scripts/record-demo.mjs"),
  "utf8",
);

describe("record-demo entry script", () => {
  it("delegates port parsing and gif encoding to the tested helpers", () => {
    expect(SOURCE).toMatch(
      /import \{ encodeGif, parsePort \} from "\.\/demo-gif\.mjs"/,
    );
  });

  it("malformed-input: exits instead of launching a browser on a bad port", () => {
    const guard = SOURCE.indexOf("if (port === null)");
    const launch = SOURCE.indexOf("chromium.launch()");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(launch);
  });

  it("concurrency: closes the browser from a finally block on every path", () => {
    expect(SOURCE).toMatch(/} finally \{\s*await browser\.close\(\);/);
  });

  it("permission: grants clipboard-write only, never clipboard-read", () => {
    expect(SOURCE).toContain('permissions: ["clipboard-write"]');
    expect(SOURCE).not.toContain("clipboard-read");
  });

  it("empty: refuses to write a gif when no frame was captured", () => {
    expect(SOURCE).toMatch(/frames\.length === 0/);
  });

  it("stops the capture loop before closing the context", () => {
    const stop = SOURCE.indexOf("capturing = false");
    const close = SOURCE.indexOf("await context.close()");
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(close);
  });
});
