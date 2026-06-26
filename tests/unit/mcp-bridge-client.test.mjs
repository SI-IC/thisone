// Phase 5 — unit tests for the MCP server's thin HTTP client to the bridge.
// Pure logic: spin up a fake http server, write bridge.json, exercise callBridge.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readBridgeInfo,
  callBridge,
} from "../../claude-plugin/lib/bridge-client.mjs";

const PREFIX = "/__claude_feedback";

/** Stand up a fake bridge http server; returns {port, close, lastReq}. */
function fakeBridge(handler) {
  return new Promise((resolve) => {
    const lastReq = {};
    const server = createServer((req, res) => {
      lastReq.method = req.method;
      lastReq.url = req.url;
      lastReq.host = req.headers.host;
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastReq.body = Buffer.concat(chunks).toString("utf8");
        handler(req, res, lastReq);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => server.close(),
        lastReq,
      });
    });
  });
}

describe("bridge-client", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cf-mcp-client-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeBridgeJson(port, extra = {}) {
    mkdirSync(join(dir, ".claude-feedback"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-feedback", "bridge.json"),
      JSON.stringify({ port, pid: 1, startedAt: 1, version: "x", ...extra }),
    );
  }

  it("readBridgeInfo parses a present file and returns null when missing", () => {
    expect(readBridgeInfo(dir)).toBeNull();
    writeBridgeJson(1234);
    expect(readBridgeInfo(dir)).toMatchObject({ port: 1234 });
  });

  it("readBridgeInfo returns null on malformed JSON", () => {
    mkdirSync(join(dir, ".claude-feedback"), { recursive: true });
    writeFileSync(join(dir, ".claude-feedback", "bridge.json"), "{not json");
    expect(readBridgeInfo(dir)).toBeNull();
  });

  it("callBridge GET returns data and sets a loopback Host header", async () => {
    const fb = await fakeBridge((req, res, last) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, port: last.host }));
    });
    writeBridgeJson(fb.port);
    const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
      projectDir: dir,
    });
    expect(r.ok).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(fb.lastReq.host).toBe(`127.0.0.1:${fb.port}`);
    fb.close();
  });

  it("callBridge POST sends a JSON body", async () => {
    const fb = await fakeBridge((req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: { echoed: true } }));
    });
    writeBridgeJson(fb.port);
    const r = await callBridge(
      "POST",
      `${PREFIX}/api/request`,
      { kind: "console", args: {} },
      { projectDir: dir },
    );
    expect(r.ok).toBe(true);
    expect(JSON.parse(fb.lastReq.body)).toEqual({ kind: "console", args: {} });
    fb.close();
  });

  it("returns bridge_not_running when bridge.json is absent", async () => {
    const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
      projectDir: dir,
    });
    expect(r.error).toBe("bridge_not_running");
  });

  it("returns bridge_error on HTTP 500", async () => {
    const fb = await fakeBridge((req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    writeBridgeJson(fb.port);
    const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
      projectDir: dir,
    });
    expect(r.error).toBe("bridge_error");
    fb.close();
  });

  it("returns bridge_not_running on connection refused (stale port)", async () => {
    // Bind then immediately close so the port is almost certainly free/refused.
    const fb = await fakeBridge((req, res) => res.end("{}"));
    const deadPort = fb.port;
    fb.close();
    writeBridgeJson(deadPort);
    const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
      projectDir: dir,
    });
    expect(r.error).toBe("bridge_not_running");
  });

  it("returns bridge_error when the body is not valid JSON", async () => {
    const fb = await fakeBridge((req, res) => {
      res.statusCode = 200;
      res.end("<html>not json</html>");
    });
    writeBridgeJson(fb.port);
    const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
      projectDir: dir,
    });
    expect(r.error).toBe("bridge_error");
    fb.close();
  });
});
