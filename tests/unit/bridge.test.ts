import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import WebSocket from "ws";
import { createStandaloneBridge } from "../../src/server/bridge";

/** Raw HTTP GET with custom headers (fetch/undici forbids overriding Host). */
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const PREFIX = "/__claude_feedback";

type Standalone = Awaited<ReturnType<typeof createStandaloneBridge>>;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function start(
  opts: Partial<Parameters<typeof createStandaloneBridge>[0]> = {},
): Promise<Standalone & { dir: string; base: string; wsUrl: string }> {
  const dir = mkdtempSync(join(tmpdir(), "cf-bridge-"));
  const queueDir = join(dir, ".claude-feedback");
  const sb = await createStandaloneBridge({
    queueDir,
    version: "9.9.9",
    ...opts,
  });
  const base = `http://127.0.0.1:${sb.port}${PREFIX}`;
  const wsUrl = `ws://127.0.0.1:${sb.port}${PREFIX}/ws`;
  cleanups.push(() => {
    sb.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...sb, dir, base, wsUrl };
}

function samplePayload(over: Record<string, unknown> = {}) {
  return {
    url: "http://app/x",
    message: "hi",
    element: null,
    component: null,
    console: [{ level: "log", ts: 1, text: "a" }],
    tabId: "tab1",
    ...over,
  };
}

/** Connect a fake browser tab; optionally auto-reply to snapshot requests. */
async function connectTab(
  sb: { wsUrl: string; base: string },
  tabId: string,
  onRequest?: (msg: any, ws: WebSocket) => void,
): Promise<WebSocket> {
  const ws = new WebSocket(sb.wsUrl);
  await new Promise<void>((res, rej) => {
    ws.on("open", () => res());
    ws.on("error", rej);
  });
  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "request" && onRequest) onRequest(msg, ws);
  });
  ws.send(JSON.stringify({ type: "hello", tabId, url: "http://app/x" }));
  // poll status until the tab is registered (no flaky fixed sleep)
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(`${sb.base}/api/status`)).json();
    if (s.tabs.includes(tabId)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return ws;
}

describe("bridge", () => {
  it("POST /message enqueues and returns {id}; GET /api/feedback?ack=1 drains", async () => {
    const sb = await start();
    const r = await fetch(`${sb.base}/message`, {
      method: "POST",
      body: JSON.stringify(samplePayload({ message: "from browser" })),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: string };
    expect(body.id).toMatch(/^fb_/);

    const s1 = await (await fetch(`${sb.base}/api/status`)).json();
    expect(s1.queueSize).toBe(1);

    const f1 = (await (
      await fetch(`${sb.base}/api/feedback?ack=1`)
    ).json()) as {
      items: any[];
    };
    expect(f1.items).toHaveLength(1);
    expect(f1.items[0].message).toBe("from browser");

    const f2 = (await (
      await fetch(`${sb.base}/api/feedback?ack=1`)
    ).json()) as {
      items: any[];
    };
    expect(f2.items).toHaveLength(0);
  });

  it("requestSnapshot rejects browser_not_connected when no tab (external-failure)", async () => {
    const sb = await start();
    await expect(sb.bridge.requestSnapshot("store", {})).rejects.toMatchObject({
      code: "browser_not_connected",
    });
  });

  it("requestSnapshot resolves with the tab's reply data", async () => {
    const sb = await start();
    const ws = await connectTab(sb, "tab1", (msg, w) => {
      w.send(
        JSON.stringify({
          type: "reply",
          requestId: msg.requestId,
          data: { ok: true, kind: msg.kind },
        }),
      );
    });
    cleanups.push(() => ws.close());
    const data = await sb.bridge.requestSnapshot("console", { level: "error" });
    expect(data).toEqual({ ok: true, kind: "console" });
  });

  it("requestSnapshot rejects timeout when the tab stays silent", async () => {
    const sb = await start({ requestTimeoutMs: 50 });
    const ws = await connectTab(sb, "tab1"); // no reply handler
    cleanups.push(() => ws.close());
    await expect(sb.bridge.requestSnapshot("store", {})).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("runs two concurrent snapshot requests independently (concurrency)", async () => {
    const sb = await start();
    const ws = await connectTab(sb, "tab1", (msg, w) => {
      // echo the kind back keyed by requestId, with a tiny stagger
      setTimeout(
        () =>
          w.send(
            JSON.stringify({
              type: "reply",
              requestId: msg.requestId,
              data: { kind: msg.kind },
            }),
          ),
        msg.kind === "store" ? 20 : 5,
      );
    });
    cleanups.push(() => ws.close());
    const [a, b] = await Promise.all([
      sb.bridge.requestSnapshot("store", {}),
      sb.bridge.requestSnapshot("component", {}),
    ]);
    expect(a).toEqual({ kind: "store" });
    expect(b).toEqual({ kind: "component" });
  });

  it("ignores a reply with an unknown requestId without crashing (malformed-input)", async () => {
    const sb = await start({ requestTimeoutMs: 80 });
    const ws = await connectTab(sb, "tab1", (msg, w) => {
      // first send a bogus reply, then the real one
      w.send(
        JSON.stringify({ type: "reply", requestId: "nope", data: { x: 1 } }),
      );
      w.send(
        JSON.stringify({
          type: "reply",
          requestId: msg.requestId,
          data: { real: true },
        }),
      );
    });
    cleanups.push(() => ws.close());
    const data = await sb.bridge.requestSnapshot("store", {});
    expect(data).toEqual({ real: true });
  });

  it("rejects pending requests when the tab disconnects (external-failure)", async () => {
    const sb = await start({ requestTimeoutMs: 5000 });
    const ws = await connectTab(sb, "tab1"); // never replies
    const p = sb.bridge.requestSnapshot("store", {});
    // close the socket while the request is pending
    await new Promise((r) => setTimeout(r, 20));
    ws.close();
    await expect(p).rejects.toMatchObject({ code: "browser_not_connected" });
  });

  it("returns 400 on malformed JSON to /message (malformed-input)", async () => {
    const sb = await start();
    const r = await fetch(`${sb.base}/message`, {
      method: "POST",
      body: "{not json",
    });
    expect(r.status).toBe(400);
  });

  it("accepts a body at the cap and rejects one byte over with 413 (boundary)", async () => {
    const cap = 256;
    const sb = await start({ bodyCapBytes: cap });
    // build a JSON payload whose serialized length is exactly `cap`
    const base = samplePayload({ message: "" });
    const baseLen = JSON.stringify({ ...base, message: "" }).length;
    const pad = cap - baseLen;
    const atCap = JSON.stringify({ ...base, message: "x".repeat(pad) });
    expect(atCap.length).toBe(cap);
    const rOk = await fetch(`${sb.base}/message`, {
      method: "POST",
      body: atCap,
    });
    expect(rOk.status).toBe(200);

    const over = JSON.stringify({ ...base, message: "y".repeat(pad + 1) });
    expect(over.length).toBe(cap + 1);
    const rBig = await fetch(`${sb.base}/message`, {
      method: "POST",
      body: over,
    });
    expect(rBig.status).toBe(413);
  });

  it("POST /api/request returns {data} on success and {error} without a browser", async () => {
    const sb = await start();
    // no browser → structured error, still HTTP 200 (bridge worked)
    const rErr = await fetch(`${sb.base}/api/request`, {
      method: "POST",
      body: JSON.stringify({ kind: "console", args: {} }),
    });
    expect(rErr.status).toBe(200);
    expect((await rErr.json()).error).toBe("browser_not_connected");

    const ws = await connectTab(sb, "tab1", (msg, w) => {
      w.send(
        JSON.stringify({
          type: "reply",
          requestId: msg.requestId,
          data: { lines: 3 },
        }),
      );
    });
    cleanups.push(() => ws.close());
    const rOk = await fetch(`${sb.base}/api/request`, {
      method: "POST",
      body: JSON.stringify({ kind: "console", args: {} }),
    });
    expect((await rOk.json()).data).toEqual({ lines: 3 });
  });

  it("writeBridgeInfo writes discovery JSON atomically", async () => {
    const sb = await start();
    sb.bridge.writeBridgeInfo(sb.port);
    const info = JSON.parse(
      readFileSync(join(sb.dir, ".claude-feedback", "bridge.json"), "utf8"),
    );
    expect(info.port).toBe(sb.port);
    expect(info.version).toBe("9.9.9");
    expect(typeof info.pid).toBe("number");
    expect(typeof info.startedAt).toBe("number");
  });

  it("writeBridgeInfo to an unwritable dir does not throw (permission)", async () => {
    // make queueDir resolve under a regular file so mkdir/write fails
    const dir = mkdtempSync(join(tmpdir(), "cf-perm-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "i am a file");
    const queueDir = join(blocker, "nested"); // parent is a file → ENOTDIR
    const sb = await createStandaloneBridge({ queueDir, version: "1.0.0" });
    cleanups.push(() => sb.close());
    expect(() => sb.bridge.writeBridgeInfo(sb.port)).not.toThrow();
    // bridge still serves status despite failed discovery write
    const s = await (
      await fetch(`http://127.0.0.1:${sb.port}${PREFIX}/api/status`)
    ).json();
    expect(s.version).toBe("1.0.0");
  });

  it("status reports connected tabs and queue size", async () => {
    const sb = await start();
    const ws = await connectTab(sb, "tabA");
    cleanups.push(() => ws.close());
    await fetch(`${sb.base}/message`, {
      method: "POST",
      body: JSON.stringify(samplePayload()),
    });
    const s = await (await fetch(`${sb.base}/api/status`)).json();
    expect(s.browserConnected).toBe(true);
    expect(s.tabs).toContain("tabA");
    expect(s.queueSize).toBe(1);
    expect(s.port).toBe(sb.port);
  });

  it("rejects /api/* with a non-localhost Host header (DNS-rebinding guard)", async () => {
    const sb = await start();
    // loopback peer (rawGet connects to 127.0.0.1) but a spoofed Host → 403
    const bad = await rawGet(sb.port, `${PREFIX}/api/status`, {
      Host: "evil.example.com",
    });
    expect(bad.status).toBe(403);
    // legitimate localhost Host still works
    const ok = await rawGet(sb.port, `${PREFIX}/api/status`, {
      Host: `127.0.0.1:${sb.port}`,
    });
    expect(ok.status).toBe(200);
  });

  it("rejects an unknown snapshot kind with 400 (malformed-input)", async () => {
    const sb = await start();
    const r = await fetch(`${sb.base}/api/request`, {
      method: "POST",
      body: JSON.stringify({ kind: "evil", args: {} }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_kind");
  });

  it("does not let a duplicate tabId evict an existing connection (concurrency)", async () => {
    const sb = await start();
    const ws1 = await connectTab(sb, "dup");
    const ws2 = await connectTab(sb, "dup");
    cleanups.push(() => {
      ws1.close();
      ws2.close();
    });
    // both connections are tracked despite sharing a tabId
    const s1 = await (await fetch(`${sb.base}/api/status`)).json();
    expect(s1.tabs.filter((t: string) => t === "dup")).toHaveLength(2);

    // closing one leaves the other connected (no ABA destruction)
    ws1.close();
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(`${sb.base}/api/status`)).json();
      if (s.tabs.length === 1) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const s2 = await (await fetch(`${sb.base}/api/status`)).json();
    expect(s2.browserConnected).toBe(true);
    expect(s2.tabs).toEqual(["dup"]);
  });

  it("close() rejects in-flight snapshot requests (external-failure)", async () => {
    const sb = await start({ requestTimeoutMs: 5000 });
    const ws = await connectTab(sb, "tab1"); // never replies
    cleanups.push(() => ws.close());
    const p = sb.bridge.requestSnapshot("store", {});
    sb.bridge.close();
    await expect(p).rejects.toMatchObject({ code: "closing" });
  });
});
