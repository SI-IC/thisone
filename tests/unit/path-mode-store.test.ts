// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadPathMode, savePathMode } from "../../src/client/path-mode-store";

const MODE_KEY = "thisone:path-mode";

describe("path-mode-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to tree mode when nothing was saved (empty)", () => {
    expect(loadPathMode()).toBe("tree");
  });

  it("round-trips the root mode", () => {
    savePathMode("root");
    expect(loadPathMode()).toBe("root");
  });

  it("round-trips back to tree mode", () => {
    savePathMode("root");
    savePathMode("tree");
    expect(loadPathMode()).toBe("tree");
  });

  it("falls back to tree for a malformed stored value (malformed-input)", () => {
    localStorage.setItem(MODE_KEY, "diagonal");
    expect(loadPathMode()).toBe("tree");
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => savePathMode("root")).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and defaults to tree when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadPathMode()).not.toThrow();
    expect(loadPathMode()).toBe("tree");
    spy.mockRestore();
  });
});
