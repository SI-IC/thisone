// Overlay bootstrap — the entry esbuild bundles into dist/client.js and the Vite
// plugin inlines into dev pages. Wires the console tap, the WS client, and the
// overlay together, and binds the Alt+C hotkey. Runs exactly once per document.

import { installConsoleTap } from "./console-tap";
import { createWsClient } from "./ws-client";
import { createOverlay, type SendResult } from "./overlay";

interface FeedbackConfig {
  hotkey?: string;
  consoleBufferSize?: number;
}

declare global {
  interface Window {
    __CLAUDE_FEEDBACK_CFG__?: FeedbackConfig;
    __claude_feedback_booted__?: boolean;
  }
}

function genTabId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/__claude_feedback/ws`;
}

function postFeedback(payload: unknown): Promise<SendResult> {
  return fetch("/__claude_feedback/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch(() => ({ ok: false, status: 0 }));
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__claude_feedback_booted__) return;
  window.__claude_feedback_booted__ = true;

  const cfg = window.__CLAUDE_FEEDBACK_CFG__ ?? {};
  const hotkey = cfg.hotkey ?? "KeyC";
  const tabId = genTabId();

  const tap = installConsoleTap(cfg.consoleBufferSize ?? 200);

  const overlay = createOverlay({
    tabId,
    getConsole: () => tap.getBuffer(),
    send: postFeedback,
  });

  createWsClient({
    url: wsUrl(),
    tabId,
    getConsole: () => tap.getBuffer(),
    getLastEl: () => overlay.lastEl(),
  });

  // Capture phase so the app can't swallow the hotkey first.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && e.code === hotkey && !e.repeat) {
        e.preventDefault();
        overlay.open();
      }
    },
    true,
  );
}

boot();
