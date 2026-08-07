// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_ID } from "../../src/client/overlay";

function panel(): Element | null {
  return (
    document.getElementById(HOST_ID)?.shadowRoot?.querySelector(".panel") ??
    null
  );
}

function pressAlt(code: string): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { altKey: true, code, bubbles: true }),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).__thisone_booted__;
  delete (window as unknown as Record<string, unknown>).__THISONE_CFG__;
  vi.resetModules();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("index boot", () => {
  it("mounts the overlay host on load without opening the panel (empty)", async () => {
    await import("../../src/client/index");
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    expect(panel()?.classList.contains("hidden")).toBe(true);
  });

  it("Alt+C opens the panel by default", async () => {
    await import("../../src/client/index");
    pressAlt("KeyC");
    expect(panel()?.classList.contains("hidden")).toBe(false);
  });

  it("honors a custom hotkey from window.__THISONE_CFG__ (malformed-input guard: default key stays inert)", async () => {
    (window as unknown as Record<string, unknown>).__THISONE_CFG__ = {
      hotkey: "KeyX",
    };
    await import("../../src/client/index");
    pressAlt("KeyC");
    expect(panel()?.classList.contains("hidden")).toBe(true);
    pressAlt("KeyX");
    expect(panel()?.classList.contains("hidden")).toBe(false);
  });

  it("re-importing after boot is a no-op (concurrency: idempotent double-boot guard)", async () => {
    await import("../../src/client/index");
    const before = document.querySelectorAll(`#${HOST_ID}`).length;
    vi.resetModules();
    await import("../../src/client/index");
    const after = document.querySelectorAll(`#${HOST_ID}`).length;
    expect(after).toBe(before);
  });
});
