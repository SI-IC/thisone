// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPosition, savePosition } from "../../src/client/position-store";

const KEY = "thisone:pos";

describe("position-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved (empty)", () => {
    expect(loadPosition()).toBeNull();
  });

  it("round-trips a saved position", () => {
    savePosition({ x: 42, y: 7 });
    expect(loadPosition()).toEqual({ x: 42, y: 7 });
  });

  it("returns null for malformed JSON (hostile input)", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPosition()).toBeNull();
  });

  it("returns null when x/y are missing or non-numeric (malformed)", () => {
    localStorage.setItem(KEY, JSON.stringify({ x: "42", y: 7 }));
    expect(loadPosition()).toBeNull();
  });

  it("savePosition does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePosition({ x: 1, y: 1 })).not.toThrow();
    spy.mockRestore();
  });
});