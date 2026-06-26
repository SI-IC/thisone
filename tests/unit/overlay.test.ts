// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOverlay,
  HOST_ID,
  type SendResult,
} from "../../src/client/overlay";
import type { ConsoleEntry } from "../../src/server/types";

const tick = () => new Promise((r) => setTimeout(r, 0));

function shadow() {
  const host = document.getElementById(HOST_ID)!;
  return host.shadowRoot!;
}
function panel() {
  return shadow().querySelector(".panel") as HTMLElement;
}
function textarea() {
  return shadow().querySelector("textarea") as HTMLTextAreaElement;
}
function sendButton() {
  return shadow().querySelector("button.primary") as HTMLButtonElement;
}
function errText() {
  return (shadow().querySelector(".err") as HTMLElement).textContent;
}

describe("overlay", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function make(
    send: (p: any) => Promise<SendResult>,
    getConsole: () => ConsoleEntry[] = () => [],
  ) {
    return createOverlay({ tabId: "tab-9", getConsole, send });
  }

  it("mounts a shadow-rooted modal on open and is idempotent", () => {
    const o = make(async () => ({ ok: true }));
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    expect(shadow()).toBeTruthy();
    expect(panel().classList.contains("hidden")).toBe(false);
    expect(o.isOpen()).toBe(true);

    o.open(); // second Alt+C — must not create a second host
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    o.destroy();
  });

  it("assembles a payload with redacted console and ships it on submit", async () => {
    const send = vi.fn(async (_p: any) => ({ ok: true }) as SendResult);
    const o = make(send, () => [
      { level: "log", ts: 1, text: "token abcdef123456" },
    ]);
    o.open();
    textarea().value = "please fix the header";
    sendButton().click();
    await tick();

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.message).toBe("please fix the header");
    expect(payload.element).toBeNull();
    expect(payload.component).toBeNull();
    expect(payload.tabId).toBe("tab-9");
    expect(payload.console[0].text).toContain("[REDACTED]");
    // success closes the modal and clears the textarea
    expect(o.isOpen()).toBe(false);
    o.destroy();
  });

  it("shows a size error on 413 and keeps the modal open", async () => {
    const o = make(async () => ({ ok: false, status: 413 }));
    o.open();
    textarea().value = "x";
    sendButton().click();
    await tick();
    expect(errText()).toMatch(/большой контекст/i);
    expect(o.isOpen()).toBe(true);
    o.destroy();
  });

  it("shows an offline error when send rejects", async () => {
    const o = make(async () => {
      throw new Error("network");
    });
    o.open();
    sendButton().click();
    await tick();
    expect(errText()).toMatch(/offline/i);
    o.destroy();
  });

  it("blocks a double submit until the first settles", async () => {
    let resolve!: (v: SendResult) => void;
    const send = vi.fn(() => new Promise<SendResult>((r) => (resolve = r)));
    const o = make(send as any);
    o.open();
    sendButton().click();
    sendButton().click(); // second click while in-flight
    expect(send).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await tick();
    o.destroy();
  });

  it("picks an element: selects it, reports it, reopens the modal", () => {
    const onPick = vi.fn();
    const o = createOverlay({
      tabId: "t",
      getConsole: () => [],
      send: async () => ({ ok: true }),
      onPick,
    });
    const target = document.createElement("button");
    target.textContent = "Click me";
    document.body.appendChild(target);

    o.open();
    o.startPick();
    expect(o.isPicking()).toBe(true);
    expect(panel().classList.contains("hidden")).toBe(true);

    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );

    expect(o.isPicking()).toBe(false);
    expect(o.lastEl()).toBe(target);
    expect(onPick).toHaveBeenCalledWith(target);
    expect(o.isOpen()).toBe(true);
    expect(panel().classList.contains("hidden")).toBe(false);
    o.destroy();
  });

  it("cancels picking on Escape and reopens the modal", () => {
    const o = make(async () => ({ ok: true }));
    o.open();
    o.startPick();
    expect(o.isPicking()).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(o.isPicking()).toBe(false);
    expect(o.isOpen()).toBe(true);
    o.destroy();
  });

  it("ignores picker clicks on its own UI (composedPath includes host)", () => {
    const o = make(async () => ({ ok: true }));
    o.open();
    o.startPick();
    // clicking the send button (inside the shadow host) must not select it
    sendButton().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    expect(o.isPicking()).toBe(true);
    expect(o.lastEl()).toBeNull();
    o.destroy();
  });

  it("destroy removes the host from the document", () => {
    const o = make(async () => ({ ok: true }));
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    o.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });
});
