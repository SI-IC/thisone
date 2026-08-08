// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSettingsExpanded,
  saveSettingsExpanded,
} from "../../src/client/settings-store";

describe("settings-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to collapsed when nothing was saved (empty)", () => {
    expect(loadSettingsExpanded()).toBe(false);
  });

  it("round-trips the expanded flag", () => {
    saveSettingsExpanded(true);
    expect(loadSettingsExpanded()).toBe(true);
    saveSettingsExpanded(false);
    expect(loadSettingsExpanded()).toBe(false);
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveSettingsExpanded(true)).not.toThrow();
    spy.mockRestore();
  });

  it("does not throw and defaults to collapsed when localStorage.getItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadSettingsExpanded()).not.toThrow();
    expect(loadSettingsExpanded()).toBe(false);
    spy.mockRestore();
  });
});
