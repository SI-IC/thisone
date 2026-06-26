// File-backed feedback queue.
//
// Storage is an append-only JSONL log (`<dir>/queue.jsonl`) mirrored in memory:
//   - feedback items are written as their full JSON object
//   - acks are written as tombstone lines `{"__ack":"<id>"}`
// On startup the log is replayed to rebuild the in-memory state; corrupt lines
// are skipped. Reads serve the in-memory mirror, so the queue keeps working even
// if the backing file is removed at runtime (best-effort durability).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FeedbackPayload } from "./types.js";

export interface QueueOptions {
  /** Max retained items; oldest are dropped beyond this (DoS guard). Default 1000. */
  maxItems?: number;
}

export interface Queue {
  /** Append a client-sent payload; assigns `id` + `ts` and returns the full item. */
  append(p: Omit<FeedbackPayload, "id" | "ts">): FeedbackPayload;
  /** Return all unacked items, in insertion order. When `ack`, mark them acked. */
  readPending(ack: boolean): FeedbackPayload[];
  /** Number of unacked items. */
  size(): number;
}

const DEFAULT_MAX_ITEMS = 1000;

export function createQueue(dir: string, opts: QueueOptions = {}): Queue {
  const maxItems = Math.max(1, opts.maxItems ?? DEFAULT_MAX_ITEMS);
  const file = join(dir, "queue.jsonl");
  const items = new Map<string, FeedbackPayload>();
  const acked = new Set<string>();
  let counter = 0;

  // Best-effort: create the backing dir once. A failure here is non-fatal —
  // persist() degrades to in-memory only.
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only / unwritable — degrade */
  }

  // Replay the backing log into memory, skipping anything unparseable.
  if (existsSync(file)) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      content = "";
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        continue; // corrupt line — skip
      }
      if (rec && typeof rec === "object") {
        const r = rec as Record<string, unknown>;
        if (typeof r.__ack === "string") {
          acked.add(r.__ack);
        } else if (typeof r.id === "string") {
          items.set(r.id, r as unknown as FeedbackPayload);
        }
      }
    }
    counter = items.size;
    evictOverflow();
  }

  function persist(record: unknown): void {
    // Best-effort durability: a failed write must not crash the dev server.
    try {
      appendFileSync(file, JSON.stringify(record) + "\n");
    } catch {
      /* degrade to in-memory only */
    }
  }

  /** Drop oldest items so the in-memory mirror stays bounded. */
  function evictOverflow(): void {
    while (items.size > maxItems) {
      const oldest = items.keys().next().value;
      if (oldest === undefined) break;
      items.delete(oldest);
      acked.delete(oldest);
    }
  }

  function append(p: Omit<FeedbackPayload, "id" | "ts">): FeedbackPayload {
    const id = `fb_${process.hrtime.bigint().toString(36)}_${counter++}_${randomUUID().slice(0, 8)}`;
    const full: FeedbackPayload = { ...p, id, ts: Date.now() };
    items.set(id, full);
    persist(full);
    evictOverflow();
    return full;
  }

  function readPending(ack: boolean): FeedbackPayload[] {
    const pending: FeedbackPayload[] = [];
    for (const [id, p] of items) {
      if (!acked.has(id)) pending.push(p);
    }
    if (ack) {
      for (const p of pending) {
        acked.add(p.id);
        persist({ __ack: p.id });
      }
    }
    return pending;
  }

  function size(): number {
    let n = 0;
    for (const id of items.keys()) if (!acked.has(id)) n++;
    return n;
  }

  return { append, readPending, size };
}
