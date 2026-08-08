// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPickHintOffsetX,
  savePickHintOffsetX,
} from "../../src/client/pickhint-store";

const KEY = "thisone:pickhint-x";

describe("pickhint-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved (empty)", () => {
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("round-trips a saved offset", () => {
    savePickHintOffsetX(123.5);
    expect(loadPickHintOffsetX()).toBe(123.5);
  });

  it("returns null for malformed JSON (hostile input)", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("returns null for a non-numeric stored value (malformed-input)", () => {
    localStorage.setItem(KEY, JSON.stringify("left"));
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("returns null for a NaN-producing value (malformed-input)", () => {
    localStorage.setItem(KEY, JSON.stringify(null));
    expect(loadPickHintOffsetX()).toBeNull();
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePickHintOffsetX(10)).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and returns null when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadPickHintOffsetX()).not.toThrow();
    expect(loadPickHintOffsetX()).toBeNull();
    spy.mockRestore();
  });
});
