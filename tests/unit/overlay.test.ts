// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOverlay, HOST_ID } from "../../src/client/overlay";
import * as screenshot from "../../src/client/screenshot";
import * as clipboard from "../../src/client/clipboard";

function shadow() {
  return document.getElementById(HOST_ID)!.shadowRoot!;
}
function panel() {
  return shadow().querySelector(".panel") as HTMLElement;
}
function pathEl() {
  return shadow().querySelector(".path") as HTMLElement;
}
function img() {
  return shadow().querySelector("img.shot") as HTMLImageElement;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.spyOn(screenshot, "captureElementScreenshot").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("overlay", () => {
  it("mounts a shadow-rooted panel on open and is idempotent", () => {
    const o = createOverlay();
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    expect(panel().classList.contains("hidden")).toBe(false);
    expect(o.isOpen()).toBe(true);

    o.open();
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    o.destroy();
  });

  it("shows the empty-state hint before anything is picked", () => {
    const o = createOverlay();
    o.open();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /выберите элемент/i,
    );
    o.destroy();
  });

  it("picking an element renders its path and screenshot", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    target.textContent = "Click me";
    document.body.appendChild(target);

    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(pathEl().textContent).toMatch(/<button>/);
    expect(img().src).toBe("blob:fake");
    o.destroy();
  });

  it("clicking a different element while open replaces the selection", async () => {
    const o = createOverlay();
    const a = document.createElement("button");
    const b = document.createElement("span");
    document.body.append(a, b);

    o.open();
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await tick();
    expect(pathEl().textContent).toMatch(/<button>/);

    b.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await tick();
    expect(pathEl().textContent).toMatch(/<span>/);
    o.destroy();
  });

  it("clicking the path copies it and shows a success status", async () => {
    vi.spyOn(clipboard, "copyText").mockResolvedValue({ ok: true });
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    pathEl().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(shadow().querySelector(".path + .status")?.textContent).toBe(
      "Скопировано",
    );
    o.destroy();
  });

  it("shows a failure status when copying the path fails", async () => {
    vi.spyOn(clipboard, "copyText").mockResolvedValue({ ok: false });
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    pathEl().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(shadow().querySelector(".path + .status")?.textContent).toBe(
      "Не удалось скопировать",
    );
    o.destroy();
  });

  it("clicking the image copies it and shows a success status", async () => {
    vi.spyOn(clipboard, "copyImage").mockResolvedValue({ ok: true });
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    img().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(shadow().querySelector("img.shot + .status")?.textContent).toBe(
      "Скопировано",
    );
    o.destroy();
  });

  it("shows a screenshot-failure message when capture rejects", async () => {
    vi.spyOn(screenshot, "captureElementScreenshot").mockRejectedValue(
      new Error("boom"),
    );
    const o = createOverlay();
    const target = document.createElement("div");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(shadow().querySelector("img.shot")).toBeNull();
    expect(pathEl().textContent).toMatch(/<div>/);
    o.destroy();
  });

  it("ignores picker clicks on its own panel (composedPath includes host)", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    const before = pathEl().textContent;

    panel().dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(pathEl().textContent).toBe(before);
    o.destroy();
  });

  it("closes on Escape", () => {
    const o = createOverlay();
    o.open();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(o.isOpen()).toBe(false);
    o.destroy();
  });

  it("closes on the × button", () => {
    const o = createOverlay();
    o.open();
    (shadow().querySelector(".close") as HTMLElement).click();
    expect(o.isOpen()).toBe(false);
    o.destroy();
  });

  it("restores a persisted position on open", () => {
    localStorage.setItem("pick-element:pos", JSON.stringify({ x: 123, y: 45 }));
    const o = createOverlay();
    o.open();
    expect(panel().style.left).toBe("123px");
    expect(panel().style.top).toBe("45px");
    o.destroy();
  });

  it("falls back to a default position when nothing is persisted (empty)", () => {
    const o = createOverlay();
    o.open();
    expect(panel().style.left).not.toBe("");
    expect(panel().style.top).not.toBe("");
    o.destroy();
  });

  it("destroy removes the host from the document", () => {
    const o = createOverlay();
    o.open();
    expect(document.getElementById(HOST_ID)).toBeTruthy();
    o.destroy();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });
});
