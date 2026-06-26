// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { createWsClient, type WsLike } from "../../src/client/ws-client";

/** A controllable fake socket matching the WsLike surface. */
class FakeWs implements WsLike {
  static last: FakeWs | null = null;
  sent: string[] = [];
  readyState = 0; // CONNECTING
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWs.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  parsedSent() {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function setup(over: Partial<Parameters<typeof createWsClient>[0]> = {}) {
  const client = createWsClient({
    url: "ws://localhost/__claude_feedback/ws",
    tabId: "tab-1",
    getConsole: () => [{ level: "log", ts: 1, text: "hello" }],
    getLastEl: () => null,
    wsFactory: (url) => new FakeWs(url),
    reconnectDelayMs: 10,
    ...over,
  });
  return { client, ws: () => FakeWs.last! };
}

describe("ws-client", () => {
  it("sends hello on open with tabId", () => {
    const { client, ws } = setup();
    ws().open();
    const hello = ws().parsedSent()[0];
    expect(hello.type).toBe("hello");
    expect(hello.tabId).toBe("tab-1");
    expect(client.isConnected()).toBe(true);
    client.close();
  });

  it("answers a console request with the redacted buffer", () => {
    const { client, ws } = setup({
      getConsole: () => [
        { level: "log", ts: 1, text: "token abcdef123456" },
        { level: "warn", ts: 2, text: "ok" },
      ],
    });
    ws().open();
    ws().deliver({
      type: "request",
      requestId: "r1",
      kind: "console",
      args: {},
    });
    const reply = ws()
      .parsedSent()
      .find((m) => m.type === "reply");
    expect(reply.requestId).toBe("r1");
    expect(reply.data.entries[0].text).toContain("[REDACTED]");
    expect(reply.data.entries).toHaveLength(2);
    client.close();
  });

  it("filters console by level when args.level is given", () => {
    const { client, ws } = setup({
      getConsole: () => [
        { level: "log", ts: 1, text: "a" },
        { level: "error", ts: 2, text: "boom" },
      ],
    });
    ws().open();
    ws().deliver({
      type: "request",
      requestId: "r2",
      kind: "console",
      args: { level: "error" },
    });
    const reply = ws()
      .parsedSent()
      .find((m) => m.type === "reply");
    expect(reply.data.entries).toHaveLength(1);
    expect(reply.data.entries[0].text).toBe("boom");
    client.close();
  });

  it("answers a store request via snapshotStore (no pinia → structured error)", () => {
    const { client, ws } = setup();
    ws().open();
    ws().deliver({
      type: "request",
      requestId: "r3",
      kind: "store",
      args: { store: "x" },
    });
    const reply = ws()
      .parsedSent()
      .find((m) => m.type === "reply");
    expect(reply.data.error).toBe("no_pinia");
    client.close();
  });

  it("ignores malformed frames and non-request messages", () => {
    const { client, ws } = setup();
    ws().open();
    const before = ws().sent.length;
    ws().onmessage?.({ data: "not json{" });
    ws().deliver({ type: "something-else" });
    expect(ws().sent.length).toBe(before);
    client.close();
  });

  it("reconnects after an unexpected close", () => {
    vi.useFakeTimers();
    const { client, ws } = setup({ reconnectDelayMs: 5 });
    const first = ws();
    first.open();
    first.close(); // server dropped us
    expect(client.isConnected()).toBe(false);
    vi.advanceTimersByTime(10);
    // a fresh socket was created by the reconnect timer
    expect(ws()).not.toBe(first);
    ws().open();
    expect(client.isConnected()).toBe(true);
    client.close();
    vi.useRealTimers();
  });

  it("does not reconnect after the user closes", () => {
    vi.useFakeTimers();
    const { client, ws } = setup({ reconnectDelayMs: 5 });
    const first = ws();
    first.open();
    client.close();
    vi.advanceTimersByTime(50);
    expect(ws()).toBe(first); // no new socket spun up
    vi.useRealTimers();
  });

  it("survives a factory that throws (schedules reconnect)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = createWsClient({
      url: "ws://x/ws",
      tabId: "t",
      getConsole: () => [],
      getLastEl: () => null,
      reconnectDelayMs: 5,
      wsFactory: () => {
        calls++;
        if (calls === 1) throw new Error("refused");
        return new FakeWs("ws://x/ws");
      },
    });
    expect(calls).toBe(1);
    vi.advanceTimersByTime(10);
    expect(calls).toBe(2);
    client.close();
    vi.useRealTimers();
  });
});
