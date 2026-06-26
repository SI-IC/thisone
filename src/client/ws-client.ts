// Browser-side WebSocket client for the dev bridge. Announces the tab on connect
// (`hello`), answers bridge `request` frames by running the local collectors and
// replying with redacted data, and reconnects with capped backoff when the socket
// drops (dev-server restart, network blip). The WebSocket constructor is injectable
// so tests can drive it with a fake — production uses the global `WebSocket`.

import type { ConsoleEntry, SnapshotKind } from "../server/types";
import { snapshotStore, snapshotComponent } from "./snapshot";
import { redactConsole, redactDeep } from "./redact";

/** Minimal surface we use from a WebSocket (event-handler property style). */
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  readyState: number;
}

export interface WsClientOptions {
  /** ws(s):// URL of the bridge upgrade endpoint. */
  url: string;
  /** This tab's id, sent in `hello`. */
  tabId: string;
  /** Returns the current console ring buffer (for `request{kind:'console'}`). */
  getConsole: () => ConsoleEntry[];
  /** Returns the last element the user picked (for `request{kind:'component',last:true}`). */
  getLastEl: () => Element | null;
  /** Connection-state callback (overlay shows offline state). */
  onStatus?: (connected: boolean) => void;
  /** WebSocket factory (defaults to global `WebSocket`). */
  wsFactory?: (url: string) => WsLike;
  /** Base reconnect delay; backoff doubles up to a 10s cap (default 1000ms). */
  reconnectDelayMs?: number;
}

export interface WsClient {
  isConnected(): boolean;
  close(): void;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 10_000;

function defaultFactory(url: string): WsLike {
  // eslint-disable-next-line no-undef
  return new WebSocket(url) as unknown as WsLike;
}

function pageUrl(): string {
  return typeof location !== "undefined" ? location.href : "";
}

export function createWsClient(opts: WsClientOptions): WsClient {
  const {
    url,
    tabId,
    getConsole,
    getLastEl,
    onStatus,
    wsFactory = defaultFactory,
    reconnectDelayMs = 1000,
  } = opts;

  let ws: WsLike | null = null;
  let closedByUser = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function handleRequest(kind: SnapshotKind, args: unknown): unknown {
    const a = (args ?? {}) as Record<string, unknown>;
    if (kind === "console") {
      const level = typeof a.level === "string" ? a.level : undefined;
      const entries = redactConsole(getConsole());
      return {
        entries: level ? entries.filter((e) => e.level === level) : entries,
      };
    }
    if (kind === "store") {
      const r = snapshotStore({ store: a.store as string | undefined });
      return "state" in r ? { ...r, state: redactDeep(r.state) } : r;
    }
    // component
    const r = snapshotComponent(
      {
        selector: a.selector as string | undefined,
        last: a.last as boolean | undefined,
      },
      getLastEl(),
    );
    if ("error" in r) return r;
    return { ...r, props: redactDeep(r.props), state: redactDeep(r.state) };
  }

  function onMessage(raw: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || msg.type !== "request" || typeof msg.requestId !== "string") {
      return;
    }
    const requestId = msg.requestId;
    try {
      const data = handleRequest(msg.kind as SnapshotKind, msg.args);
      send({ type: "reply", requestId, data });
    } catch (e) {
      send({
        type: "reply",
        requestId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function send(obj: unknown): void {
    if (ws && ws.readyState === OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch {
        /* socket died mid-send; reconnect logic will recover */
      }
    }
  }

  function scheduleReconnect(): void {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(reconnectDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (closedByUser) return;
    let sock: WsLike;
    try {
      sock = wsFactory(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      onStatus?.(true);
      send({ type: "hello", tabId, url: pageUrl() });
    };
    sock.onmessage = (ev) => onMessage(ev?.data);
    sock.onclose = () => {
      onStatus?.(false);
      if (ws === sock) ws = null;
      scheduleReconnect();
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    };
  }

  connect();

  return {
    isConnected: () => !!ws && ws.readyState === OPEN,
    close: () => {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    },
  };
}
