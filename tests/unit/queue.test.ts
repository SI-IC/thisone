import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQueue } from "../../src/server/queue";
import type { FeedbackPayload } from "../../src/server/types";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "cf-queue-"));
}

function samplePayload(
  over: Partial<Omit<FeedbackPayload, "id" | "ts">> = {},
): Omit<FeedbackPayload, "id" | "ts"> {
  return {
    url: "http://app/x",
    message: "hi",
    element: null,
    component: null,
    console: [],
    tabId: "tab1",
    ...over,
  };
}

describe("queue", () => {
  it("append assigns id/ts and readPending(false) returns the item", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir);
      const p = q.append(samplePayload({ message: "first" }));
      expect(p.id).toMatch(/^fb_/);
      expect(typeof p.ts).toBe("number");
      expect(p.ts).toBeGreaterThan(0);

      const pending = q.readPending(false);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(p.id);
      expect(pending[0].message).toBe("first");
      // non-acking read does not consume
      expect(q.readPending(false)).toHaveLength(1);
      expect(q.size()).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPending(true) acks the item; subsequent read is empty", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir);
      q.append(samplePayload());
      const first = q.readPending(true);
      expect(first).toHaveLength(1);
      expect(q.readPending(true)).toHaveLength(0);
      expect(q.size()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("assigns distinct ids across appends", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir);
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(q.append(samplePayload()).id);
      expect(ids.size).toBe(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is file-backed: a fresh createQueue on the same dir sees unacked items", () => {
    const dir = tmpDir();
    try {
      const q1 = createQueue(dir);
      const a = q1.append(samplePayload({ message: "a" }));
      const b = q1.append(samplePayload({ message: "b" }));

      const q2 = createQueue(dir);
      const pending = q2.readPending(false);
      expect(pending.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is file-backed: a fresh createQueue does not re-surface acked items", () => {
    const dir = tmpDir();
    try {
      const q1 = createQueue(dir);
      q1.append(samplePayload({ message: "a" }));
      q1.readPending(true); // ack

      const q2 = createQueue(dir);
      expect(q2.readPending(false)).toHaveLength(0);
      expect(q2.size()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips a corrupt JSONL line without crashing (malformed-input)", () => {
    const dir = tmpDir();
    try {
      const q1 = createQueue(dir);
      const good = q1.append(samplePayload({ message: "good" }));
      // inject a broken line directly into the backing file
      appendFileSync(join(dir, "queue.jsonl"), "this is not json\n");

      const q2 = createQueue(dir);
      const pending = q2.readPending(false);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(good.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops oldest items beyond maxItems (boundary / DoS guard)", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir, { maxItems: 3 });
      const ids = [];
      for (let i = 0; i < 5; i++)
        ids.push(q.append(samplePayload({ message: `m${i}` })).id);
      const pending = q.readPending(false);
      expect(pending).toHaveLength(3);
      // only the 3 newest survive, in order
      expect(pending.map((p) => p.message)).toEqual(["m2", "m3", "m4"]);
      expect(pending.map((p) => p.id)).toEqual(ids.slice(2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPending on an empty/missing queue returns [] (empty)", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir);
      expect(q.readPending(false)).toEqual([]);
      expect(q.size()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the in-memory mirror when queue.jsonl is deleted (deleted-resource)", () => {
    const dir = tmpDir();
    try {
      const q = createQueue(dir);
      const a = q.append(samplePayload({ message: "a" }));
      // delete the backing file between append and read
      rmSync(join(dir, "queue.jsonl"), { force: true });
      const pending = q.readPending(false);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(a.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
