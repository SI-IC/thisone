import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations
import {
  centerOf,
  glidePoints,
  isDirectRun,
  recordDemo,
} from "../../scripts/record-demo.mjs";

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

describe("glidePoints", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 50 };

  it("ends exactly on the target so the cursor never drifts", () => {
    expect(glidePoints(from, to, 10).at(-1)).toEqual(to);
  });

  it("emits one point per step and advances monotonically", () => {
    const points = glidePoints(from, to, 8);
    expect(points).toHaveLength(8);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
    }
  });

  it("boundary: clamps zero, negative and fractional steps to a single hop", () => {
    expect(glidePoints(from, to, 0)).toEqual([to]);
    expect(glidePoints(from, to, -5)).toEqual([to]);
    expect(glidePoints(from, to, 0.9)).toEqual([to]);
  });

  it("malformed-input: falls back to a single hop for a non-numeric step count", () => {
    expect(glidePoints(from, to, "many")).toEqual([to]);
    expect(glidePoints(from, to, undefined)).toEqual([to]);
  });

  it("boundary: caps an unbounded step count instead of looping forever", () => {
    expect(glidePoints(from, to, Infinity)).toHaveLength(400);
    expect(glidePoints(from, to, 1e9)).toHaveLength(400);
  });

  it("empty: yields a stationary point when from and to coincide", () => {
    expect(glidePoints(to, to, 3)).toEqual([to, to, to]);
  });
});

describe("centerOf", () => {
  it("returns the middle of the locator's box", async () => {
    const locator = {
      boundingBox: async () => ({ x: 10, y: 20, width: 40, height: 10 }),
    };
    expect(await centerOf(locator, "demo button")).toEqual({ x: 30, y: 25 });
  });

  it("deleted-resource: names the selector when the element has no box", async () => {
    const locator = { boundingBox: async () => null };
    await expect(centerOf(locator, ".path")).rejects.toThrow(
      /\.path has no layout box/,
    );
  });

  it("boundary: handles a zero-sized box without producing NaN", async () => {
    const locator = {
      boundingBox: async () => ({ x: 5, y: 7, width: 0, height: 0 }),
    };
    expect(await centerOf(locator, "collapsed")).toEqual({ x: 5, y: 7 });
  });
});

describe("synthetic cursor", () => {
  it("draws its own pointer, because Playwright screenshots omit the real one", () => {
    expect(SOURCE).toContain("addInitScript(installCursor, CURSOR_HOST_ID)");
    expect(SOURCE).toMatch(/class="arrow"/);
  });

  it("uses a host id distinct from the overlay's, so attachShadow cannot collide", () => {
    expect(SOURCE).toContain('CURSOR_HOST_ID = "__thisone_demo_cursor"');
    expect(SOURCE).not.toMatch(/CURSOR_HOST_ID = "__thisone_root"/);
  });

  it("deleted-resource: reparenting fails loudly when the overlay host is gone", () => {
    expect(SOURCE).toContain(
      'throw new Error("cursor: overlay host has no shadow root")',
    );
  });

  it("moves the cursor under the overlay host so it stays out of img.shot", () => {
    expect(SOURCE).toContain("overlay.shadowRoot.appendChild(host)");
    expect(SOURCE).toContain("__demoCursorReparent");
  });

  it("empty: defers mounting, because addInitScript runs before document.body exists", () => {
    expect(SOURCE).toContain(
      "if (document.body) document.body.appendChild(host)",
    );
    expect(SOURCE).toContain('addEventListener("DOMContentLoaded"');
  });

  it("concurrency: re-reads the box after the glide, in case the layout moved", () => {
    expect(SOURCE).toMatch(
      /await locator\.waitFor\(\);[\s\S]*const now = await centerOf\(locator, label\);[\s\S]*mouse\.down\(\)/,
    );
  });

  it("draws no click-pulse effect, only the arrow — a synthetic circle at the click point read as a stray artifact on the recording", () => {
    expect(SOURCE).not.toMatch(/\.pulse\b/);
    expect(SOURCE).not.toContain("mousedown");
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

  it("hides the examples demo-hub nav before capturing, so it never leaks into the gif", () => {
    expect(SOURCE).toContain(".demo-header { display: none !important; }");
  });

  it("dumps sampled frames to /tmp only behind THISONE_DEMO_DEBUG_FRAMES", () => {
    expect(SOURCE).toContain("process.env.THISONE_DEMO_DEBUG_FRAMES");
    expect(SOURCE).toContain("/tmp/demo-frame-");
  });
});

describe("record-demo scenes", () => {
  it("runs every scene in order inside the capture loop's try block", () => {
    expect(SOURCE).toMatch(
      /const SCENES = \[scenePickAndScreenshot, sceneCopyPath\];/,
    );
    expect(SOURCE).toMatch(/for \(const scene of SCENES\) \{/);
  });

  it("names the failing scene when one throws, so a future scene's bug isn't a mystery stack trace", () => {
    expect(SOURCE).toContain('scene "${scene.name}" failed');
  });
});
