// Dev-server bridge: the single owner of the feedback queue and the browser
// connection. One HTTP router + one WebSocketServer (noServer mode, upgraded on
// `/__claude_feedback/ws`). Mountable into Vite (Phase 4) via `httpMiddleware` +
// `handleUpgrade`, or run standalone (tests/smoke) via `createStandaloneBridge`.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { createQueue } from "./queue.js";
import type { BridgeInfo, SnapshotKind } from "./types.js";

const PREFIX = "/__claude_feedback";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BODY_CAP_BYTES = 5 * 1024 * 1024;
// WS frames are tiny control messages (hello/reply); cap well below ws's 100MiB
// default so a public preview client can't buffer a huge frame.
const WS_MAX_PAYLOAD = 256 * 1024;
const SNAPSHOT_KINDS: ReadonlySet<string> = new Set([
  "store",
  "component",
  "console",
]);

export interface BridgeOptions {
  /** Directory holding `queue.jsonl` and `bridge.json` (usually `.claude-feedback`). */
  queueDir: string;
  /** Plugin version recorded in `bridge.json`. */
  version: string;
  /** Snapshot request timeout (default 10000ms). */
  requestTimeoutMs?: number;
  /** Max accepted POST body size in bytes (default 5MB → 413). */
  bodyCapBytes?: number;
  /** Max retained queue items (oldest dropped beyond this — DoS guard). */
  maxQueueItems?: number;
}

export type BridgeStatus = BridgeInfo & {
  browserConnected: boolean;
  tabs: string[];
  queueSize: number;
};

export interface Bridge {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  httpMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void;
  writeBridgeInfo(port: number): void;
  requestSnapshot(kind: SnapshotKind, args: unknown): Promise<unknown>;
  status(): BridgeStatus;
  close(): void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: { code: string; error?: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Server connection id this request was routed to. */
  connId: string;
}

interface Conn {
  ws: WebSocket;
  /** Client-supplied tab id (reported in status; never used as a routing key). */
  tabId: string;
}

export function createBridge(opts: BridgeOptions): Bridge {
  const {
    queueDir,
    version,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    bodyCapBytes = DEFAULT_BODY_CAP_BYTES,
    maxQueueItems,
  } = opts;

  const startedAt = Date.now();
  const queue = createQueue(queueDir, { maxItems: maxQueueItems });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD,
  });
  // Keyed by a server-generated connection id, NOT the client-supplied tabId, so a
  // malicious/duplicate `hello` can neither evict nor impersonate an existing tab.
  const conns = new Map<string, Conn>();
  const pending = new Map<string, Pending>();
  let actualPort = 0;

  wss.on("connection", (ws: WebSocket) => {
    const connId = randomUUID();
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // malformed frame — ignore
      }
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "hello") {
        const tabId = typeof msg.tabId === "string" ? msg.tabId : randomUUID();
        conns.set(connId, { ws, tabId });
      } else if (msg.type === "reply") {
        const requestId = msg.requestId;
        if (typeof requestId !== "string") return;
        const p = pending.get(requestId);
        if (!p) return; // unknown/stale requestId — ignore
        clearTimeout(p.timer);
        pending.delete(requestId);
        if (msg.error !== undefined && msg.error !== null) {
          p.reject({ code: "snapshot_error", error: msg.error });
        } else {
          p.resolve(msg.data);
        }
      }
    });
    ws.on("close", () => {
      conns.delete(connId);
      // fail any requests that were routed to this connection
      for (const [rid, p] of pending) {
        if (p.connId === connId) {
          clearTimeout(p.timer);
          pending.delete(rid);
          p.reject({ code: "browser_not_connected" });
        }
      }
    });
    ws.on("error", (e) => {
      console.debug?.(
        "[claude-feedback] ws error:",
        e instanceof Error ? e.message : e,
      );
    });
  });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const path = new URL(req.url || "", "http://localhost").pathname;
    if (path !== `${PREFIX}/ws`) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  }

  function requestSnapshot(
    kind: SnapshotKind,
    args: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const first = conns.entries().next();
      if (first.done) {
        reject({ code: "browser_not_connected" });
        return;
      }
      const [connId, conn] = first.value;
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject({ code: "timeout" });
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timer, connId });
      try {
        conn.ws.send(
          JSON.stringify({ type: "request", requestId, kind, args }),
        );
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject({ code: "browser_not_connected" });
      }
    });
  }

  function httpMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void {
    const urlStr = req.url || "";
    if (!urlStr.startsWith(PREFIX)) {
      next();
      return;
    }
    const u = new URL(urlStr, "http://localhost");
    const path = u.pathname;
    const method = req.method || "GET";

    // The /api/* routes are MCP-only and must never be reachable across the
    // network (defense-in-depth even if Vite runs with --host, and a Host
    // allowlist blocks DNS-rebinding). Browser routes (/message, /ws) stay open
    // because they are meant to be proxied.
    if (path.startsWith(`${PREFIX}/api/`)) {
      if (
        !isLoopback(req.socket.remoteAddress) ||
        !isLocalHost(req.headers.host)
      ) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
    }

    // browser → bridge: enqueue a feedback message
    if (path === `${PREFIX}/message` && method === "POST") {
      readBody(req, bodyCapBytes)
        .then((body) => {
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(body);
          } catch {
            sendJson(res, 400, { error: "invalid_json" });
            return;
          }
          const item = queue.append({
            url: String(payload.url ?? ""),
            message: String(payload.message ?? ""),
            element: (payload.element as never) ?? null,
            component: (payload.component as never) ?? null,
            console: (payload.console as never) ?? [],
            tabId:
              typeof payload.tabId === "string" ? payload.tabId : "unknown",
          });
          sendJson(res, 200, { id: item.id });
        })
        .catch((err: { code?: string }) => {
          if (err && err.code === "body_too_large") {
            sendJson(res, 413, { error: "too_large" });
          } else {
            sendJson(res, 400, { error: "bad_request" });
          }
        });
      return;
    }

    // MCP (localhost): drain the queue
    if (path === `${PREFIX}/api/feedback` && method === "GET") {
      const ack = u.searchParams.get("ack") === "1";
      sendJson(res, 200, { items: queue.readPending(ack) });
      return;
    }

    // MCP (localhost): trigger a snapshot request to the browser
    if (path === `${PREFIX}/api/request` && method === "POST") {
      readBody(req, bodyCapBytes)
        .then((body) => {
          let parsed: { kind?: unknown; args?: unknown };
          try {
            parsed = JSON.parse(body);
          } catch {
            sendJson(res, 400, { error: "invalid_json" });
            return;
          }
          if (
            typeof parsed.kind !== "string" ||
            !SNAPSHOT_KINDS.has(parsed.kind)
          ) {
            sendJson(res, 400, { error: "invalid_kind" });
            return;
          }
          requestSnapshot(parsed.kind as SnapshotKind, parsed.args).then(
            (data) => sendJson(res, 200, { data }),
            (e: { code?: string; error?: unknown }) =>
              sendJson(res, 200, {
                error: e?.code ?? "error",
                detail: e?.error,
              }),
          );
        })
        .catch(() => sendJson(res, 400, { error: "bad_request" }));
      return;
    }

    // MCP (localhost): diagnostics
    if (path === `${PREFIX}/api/status` && method === "GET") {
      sendJson(res, 200, status());
      return;
    }

    next();
  }

  function writeBridgeInfo(port: number): void {
    actualPort = port;
    const info: BridgeInfo = { port, pid: process.pid, startedAt, version };
    try {
      mkdirSync(queueDir, { recursive: true });
      const file = join(queueDir, "bridge.json");
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(info));
      renameSync(tmp, file); // atomic publish
    } catch (e) {
      // read-only dir / no perms: discovery degrades, dev server keeps running
      console.error(
        "[claude-feedback] failed to write bridge.json:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  function status(): BridgeStatus {
    return {
      port: actualPort,
      pid: process.pid,
      startedAt,
      version,
      browserConnected: conns.size > 0,
      tabs: [...conns.values()].map((c) => c.tabId),
      queueSize: queue.size(),
    };
  }

  function close(): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject({ code: "closing" });
    }
    pending.clear();
    for (const { ws } of conns.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    try {
      wss.close();
    } catch {
      /* ignore */
    }
  }

  return {
    handleUpgrade,
    httpMiddleware,
    writeBridgeInfo,
    requestSnapshot,
    status,
    close,
  };
}

export interface StandaloneBridge {
  bridge: Bridge;
  server: Server;
  port: number;
  close(): void;
}

/**
 * Stand up a bridge on its own HTTP server bound to a free localhost port.
 * Returns a promise because the bound port is only known after `listen`.
 */
export function createStandaloneBridge(
  opts: BridgeOptions,
): Promise<StandaloneBridge> {
  const bridge = createBridge(opts);
  const server = createServer((req, res) =>
    bridge.httpMiddleware(req, res, () => {
      res.statusCode = 404;
      res.end("not found");
    }),
  );
  server.on("upgrade", (req, socket, head) =>
    bridge.handleUpgrade(req, socket, head),
  );

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      // Mirror real Vite usage: publish the port (and discovery file) once bound,
      // so status().port and bridge.json are populated like in production.
      bridge.writeBridgeInfo(port);
      resolve({
        bridge,
        server,
        port,
        close() {
          bridge.close();
          server.close();
        },
      });
    });
  });
}

/** True for IPv4/IPv6 loopback peer addresses (incl. IPv4-mapped IPv6). */
function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("127.")
  );
}

/** True when the Host header points at localhost (blocks DNS-rebinding). */
function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function readBody(req: IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > cap) {
        aborted = true;
        reject({ code: "body_too_large" });
        req.resume(); // drain-discard the rest without buffering or killing the socket
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (e) => {
      if (!aborted) reject(e);
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, obj: unknown): void {
  let body: string;
  try {
    body = JSON.stringify(obj);
  } catch {
    body = '{"error":"serialization_failed"}';
    statusCode = 500;
  }
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(body);
}
