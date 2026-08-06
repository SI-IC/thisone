import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  jsonResult,
  errorResult,
  bridgeErrorText,
  snapshotErrorText,
  createServer,
  isMainModule,
} from "../../claude-plugin/mcp-server.mjs";

describe("mcp-server.mjs", () => {
  it("jsonResult wraps a value as pretty-printed JSON text content", () => {
    const r = jsonResult({ a: 1 });
    expect(r.content[0].type).toBe("text");
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
  });

  it("errorResult sets isError and carries the message verbatim", () => {
    const r = errorResult("boom");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("boom");
  });

  it("bridgeErrorText gives a distinct message for bridge_not_running", () => {
    expect(bridgeErrorText("bridge_not_running")).toMatch(/dev preview/i);
    expect(bridgeErrorText("something_else")).toMatch(/bridge returned/i);
  });

  it("snapshotErrorText covers each known browser-level error code", () => {
    expect(snapshotErrorText("browser_not_connected")).toMatch(
      /no browser preview/i,
    );
    expect(snapshotErrorText("timeout")).toMatch(/didn't respond/i);
    expect(snapshotErrorText("closing")).toMatch(/shutting down/i);
    expect(snapshotErrorText("weird_code")).toContain("weird_code");
  });

  it("createServer() builds a Server without connecting a transport (importable, no side effects)", () => {
    const server = createServer();
    expect(server).toBeTruthy();
  });
});

describe("isMainModule", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cf-main-module-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when argvPath is missing (spawned with no script arg)", () => {
    expect(isMainModule("file:///x.mjs", undefined)).toBe(false);
  });

  it("matches a direct invocation (argv[1] === the real file path)", () => {
    const real = join(dir, "real.mjs");
    writeFileSync(real, "");
    expect(isMainModule(pathToFileURL(real).href, real)).toBe(true);
  });

  it("still matches when argv[1] is a symlink to the real file (regression: naive `file://${argv}` broke this)", () => {
    const real = join(dir, "real.mjs");
    const link = join(dir, "link.mjs");
    writeFileSync(real, "");
    symlinkSync(real, link);
    expect(isMainModule(pathToFileURL(real).href, link)).toBe(true);
  });

  it("returns false when the file simply doesn't exist (malformed input)", () => {
    expect(isMainModule("file:///x.mjs", join(dir, "nope.mjs"))).toBe(false);
  });
});
