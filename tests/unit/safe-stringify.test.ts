// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { safeStringify } from "../../src/client/safe-stringify";

describe("safeStringify", () => {
  it("marks cycles as [Circular] (malformed-input)", () => {
    const a: any = { n: 1 };
    a.self = a;
    const out = safeStringify(a);
    expect(out.n).toBe(1);
    expect(out.self).toBe("[Circular]");
  });

  it("caps nesting depth with [MaxDepth] (boundary)", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = safeStringify(deep, { maxDepth: 2 });
    expect(out.a.b.c).toBe("[MaxDepth]");
  });

  it("replaces functions with [Function]", () => {
    expect(safeStringify({ f: () => {} }).f).toBe("[Function]");
  });

  it("replaces DOM nodes with [DOM:tag]", () => {
    const el = document.createElement("div");
    expect(safeStringify({ el }).el).toBe("[DOM:div]");
  });

  it("truncates long strings (boundary)", () => {
    const out = safeStringify({ s: "x".repeat(100) }, { maxLen: 10 });
    expect(out.s.endsWith("…")).toBe(true);
    expect(out.s.length).toBeLessThanOrEqual(11);
  });

  it("passes through primitives and arrays", () => {
    expect(safeStringify({ a: [1, "two", true, null] })).toEqual({
      a: [1, "two", true, null],
    });
  });

  it("handles null/undefined input (empty)", () => {
    expect(safeStringify(null)).toBeNull();
    expect(safeStringify(undefined)).toBe("[Undefined]");
  });

  it("does not flag sibling shared references as circular (concurrency)", () => {
    const shared = { v: 1 };
    const out = safeStringify({ a: shared, b: shared });
    expect(out.a).toEqual({ v: 1 });
    expect(out.b).toEqual({ v: 1 });
  });

  it("preserves NaN/Infinity as strings instead of letting JSON drop them", () => {
    const out = safeStringify({ a: NaN, b: Infinity, c: -Infinity });
    expect(out).toEqual({ a: "NaN", b: "Infinity", c: "-Infinity" });
  });

  it("serializes Date/RegExp/Error meaningfully instead of as {}", () => {
    const out = safeStringify({
      d: new Date("2020-01-02T03:04:05.000Z"),
      r: /ab+c/i,
      e: new Error("boom"),
    });
    expect(out.d).toBe("2020-01-02T03:04:05.000Z");
    expect(out.r).toBe("/ab+c/i");
    expect(out.e.message).toBe("boom");
    expect(out.e.name).toBe("Error");
  });

  it("keeps distinct Map object keys from colliding (malformed-input)", () => {
    const m = new Map<any, any>([
      [{ id: 1 }, "first"],
      [{ id: 2 }, "second"],
    ]);
    const out = safeStringify({ m });
    expect(Object.values(out.m).sort()).toEqual(["first", "second"]);
  });

  it("does not pollute the accumulator prototype via a __proto__ key (malformed-input)", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true}}');
    const out = safeStringify({ x: hostile });
    expect(({} as any).polluted).toBeUndefined();
    expect(out.x).toBeTruthy();
  });

  it("truncates with [Truncated] once the node budget is exhausted (boundary)", () => {
    const wide = { arr: Array.from({ length: 50 }, (_, i) => ({ i })) };
    const out = safeStringify(wide, { maxNodes: 10 });
    const flat = JSON.stringify(out);
    expect(flat).toContain("[Truncated]");
  });
});
