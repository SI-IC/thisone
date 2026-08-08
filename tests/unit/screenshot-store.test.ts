// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no localStorage
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadScreenshotEnabled,
  saveScreenshotEnabled,
  loadScreenshotPadding,
  saveScreenshotPadding,
} from "../../src/client/screenshot-store";

const PADDING_KEY = "thisone:screenshot-padding";

describe("screenshot-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults enabled to true when nothing was saved (empty)", () => {
    expect(loadScreenshotEnabled()).toBe(true);
  });

  it("round-trips the enabled flag", () => {
    saveScreenshotEnabled(false);
    expect(loadScreenshotEnabled()).toBe(false);
    saveScreenshotEnabled(true);
    expect(loadScreenshotEnabled()).toBe(true);
  });

  it("defaults padding to 30 when nothing was saved (empty)", () => {
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("round-trips a saved padding", () => {
    saveScreenshotPadding(50);
    expect(loadScreenshotPadding()).toBe(50);
  });

  it("falls back to the default for a negative padding (boundary)", () => {
    localStorage.setItem(PADDING_KEY, JSON.stringify(-5));
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("falls back to the default for a non-numeric padding (malformed-input)", () => {
    localStorage.setItem(PADDING_KEY, JSON.stringify("thirty"));
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("falls back to the default for malformed JSON (hostile input)", () => {
    localStorage.setItem(PADDING_KEY, "{not json");
    expect(loadScreenshotPadding()).toBe(30);
  });

  it("accepts zero padding (boundary)", () => {
    saveScreenshotPadding(0);
    expect(loadScreenshotPadding()).toBe(0);
  });

  it("does not throw when localStorage.setItem fails (external-failure)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveScreenshotEnabled(false)).not.toThrow();
    expect(() => saveScreenshotPadding(40)).not.toThrow();
    spy.mockRestore();
  });
});
