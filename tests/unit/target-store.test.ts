// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadTargetEnabled,
  saveTargetEnabled,
  loadTargetPosition,
  saveTargetPosition,
} from "../../src/client/target-store";

const POS_KEY = "thisone:target-pos";

describe("target-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults enabled to false when nothing was saved (empty)", () => {
    expect(loadTargetEnabled()).toBe(false);
  });

  it("round-trips the enabled flag", () => {
    saveTargetEnabled(true);
    expect(loadTargetEnabled()).toBe(true);
    saveTargetEnabled(false);
    expect(loadTargetEnabled()).toBe(false);
  });

  it("returns null for target position when nothing was saved (empty)", () => {
    expect(loadTargetPosition()).toBeNull();
  });

  it("round-trips a saved target position", () => {
    saveTargetPosition({ edge: "left", offset: 0.25 });
    expect(loadTargetPosition()).toEqual({ edge: "left", offset: 0.25 });
  });

  it("returns null for malformed JSON (hostile input)", () => {
    localStorage.setItem(POS_KEY, "{not json");
    expect(loadTargetPosition()).toBeNull();
  });

  it("returns null for an unknown edge value (malformed)", () => {
    localStorage.setItem(
      POS_KEY,
      JSON.stringify({ edge: "diagonal", offset: 0.5 }),
    );
    expect(loadTargetPosition()).toBeNull();
  });

  it("clamps an out-of-range offset to [0,1] (boundary)", () => {
    localStorage.setItem(POS_KEY, JSON.stringify({ edge: "top", offset: 5 }));
    expect(loadTargetPosition()).toEqual({ edge: "top", offset: 1 });
    localStorage.setItem(POS_KEY, JSON.stringify({ edge: "top", offset: -5 }));
    expect(loadTargetPosition()).toEqual({ edge: "top", offset: 0 });
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveTargetEnabled(true)).not.toThrow();
    expect(() =>
      saveTargetPosition({ edge: "bottom", offset: 0.5 }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
