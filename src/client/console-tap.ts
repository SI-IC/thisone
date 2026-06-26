// Tee the browser console (and uncaught errors / rejections) into a fixed-size
// ring buffer that the overlay attaches to feedback payloads. Originals are
// always called, so the app's own logging is untouched. dispose() restores
// exactly what was there at install time, so nested taps unwind LIFO-correctly.

import type { ConsoleEntry } from "../server/types";
import { safeStringify } from "./safe-stringify";

export interface ConsoleTap {
  getBuffer(): ConsoleEntry[];
  dispose(): void;
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type Level = (typeof LEVELS)[number];

/** Per-entry text cap — one `console.log(hugeString)` must not balloon memory
 * or the payload shipped to the bridge/LLM. The string and Error branches of
 * formatArg bypass safeStringify's own cap, so the ceiling is enforced here. */
const MAX_TEXT = 8000;

function formatArg(a: any): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || a.message || String(a);
  try {
    return JSON.stringify(safeStringify(a));
  } catch {
    return String(a);
  }
}

export function installConsoleTap(size = 200): ConsoleTap {
  const buf: ConsoleEntry[] = [];

  function push(level: ConsoleEntry["level"], text: string): void {
    if (size <= 0) return;
    const capped =
      text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text;
    buf.push({ level, ts: Date.now(), text: capped });
    if (buf.length > size) buf.splice(0, buf.length - size);
  }

  // Capture whatever is currently installed so dispose() restores it (not the
  // pristine native console), letting taps stack and unwind independently.
  const originals = {} as Record<Level, (...args: any[]) => void>;
  for (const lvl of LEVELS) {
    const prev = (console[lvl] as (...args: any[]) => void) ?? (() => {});
    originals[lvl] = prev;
    console[lvl] = (...args: any[]) => {
      try {
        push(lvl, args.map(formatArg).join(" "));
      } catch {
        // Never let the tap break the app's logging.
      }
      return prev.apply(console, args);
    };
  }

  const onError = (e: any): void => {
    // `||` not `??`: an ErrorEvent with an empty message should fall through to
    // the underlying error object rather than record a blank entry.
    push("error", String(e?.message || e?.error || "error"));
  };
  const onRejection = (e: any): void => {
    const reason = e?.reason;
    const text =
      reason instanceof Error
        ? reason.stack || reason.message
        : formatArg(reason);
    push("error", "Unhandled rejection: " + text);
  };

  const hasWindow = typeof window !== "undefined";
  if (hasWindow) {
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
  }

  let disposed = false;
  return {
    getBuffer: () => buf.slice(),
    // NOTE: dispose() restores whatever was installed at install time, so stacked
    // taps must be disposed in LIFO order; out-of-order dispose silently re-hangs
    // a removed wrapper. The overlay uses a single session-lifetime tap.
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const lvl of LEVELS) console[lvl] = originals[lvl];
      if (hasWindow) {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
      }
    },
  };
}
