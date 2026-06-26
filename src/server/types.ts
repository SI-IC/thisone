// Shared contracts for the dev-server bridge + queue (Phase 2).
// Consumed by the Vite plugin entry (Phase 4) and the MCP server (Phase 5).

/** A single captured browser console line (ring-buffer entry). */
export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  ts: number;
  text: string;
}

/** Best-effort description of the picked DOM element. */
export interface ElementDescriptor {
  tag: string;
  classes: string[];
  /** Trimmed text snippet. */
  text: string;
  /** Stable-ish CSS path (nth-of-type based). */
  selector: string;
}

/** Resolved Vue component for the picked element (null outside the app). */
export interface ComponentDescriptor {
  name: string;
  /** `__file` plus best-effort line, or null when unavailable. */
  file: string | null;
  /** Component name chain from the element up to the root. */
  chain: string[];
}

/**
 * Full feedback message. The client sends everything except `id`/`ts`, which
 * the bridge assigns on append. `element`/`component` are null when the user
 * sent without picking; `console` is always present (may be empty).
 */
export interface FeedbackPayload {
  id: string;
  ts: number;
  url: string;
  message: string;
  element: ElementDescriptor | null;
  component: ComponentDescriptor | null;
  console: ConsoleEntry[];
  tabId: string;
}

export type SnapshotKind = "store" | "component" | "console";

/** A bridge->browser snapshot request pushed over the WebSocket. */
export interface SnapshotRequest {
  requestId: string;
  kind: SnapshotKind;
  args: unknown;
}

/** Discovery file written to `.claude-feedback/bridge.json`. */
export interface BridgeInfo {
  port: number;
  pid: number;
  startedAt: number;
  version: string;
}
