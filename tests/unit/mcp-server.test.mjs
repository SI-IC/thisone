import { describe, it, expect } from "vitest";
import {
  jsonResult,
  errorResult,
  bridgeErrorText,
  snapshotErrorText,
  createServer,
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
