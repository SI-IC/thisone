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

  function drag(
    handle: HTMLElement,
    from: [number, number],
    to: [number, number],
  ) {
    handle.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: from[0],
        clientY: from[1],
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: to[0], clientY: to[1] }),
    );
    window.dispatchEvent(new MouseEvent("mouseup"));
  }

  it("mount() shows the enabled edge target button without opening the panel", () => {
    const o1 = createOverlay();
    o1.open();
    (shadow().querySelector(".target-toggle") as HTMLElement).click();
    o1.destroy();

    const o2 = createOverlay();
    o2.mount();
    expect(o2.isOpen()).toBe(false);
    expect(panel().classList.contains("hidden")).toBe(true);
    expect(
      (shadow().querySelector(".target-btn") as HTMLElement).classList.contains(
        "hidden",
      ),
    ).toBe(false);
    o2.destroy();
  });

  it("edge:boundary — dragging the panel past the top-left clamps it to (0,0)", () => {
    const o = createOverlay();
    o.open();
    const header = shadow().querySelector(".header") as HTMLElement;
    drag(header, [20, 20], [-500, -500]);
    expect(parseFloat(panel().style.left)).toBe(0);
    expect(parseFloat(panel().style.top)).toBe(0);
    o.destroy();
  });

  it("edge:boundary — dragging the panel past the bottom only clamps the header inside the viewport", () => {
    const o = createOverlay();
    o.open();
    const header = shadow().querySelector(".header") as HTMLElement;
    drag(header, [20, 20], [20, 5000]);
    const headerHeight = header.offsetHeight;
    const top = parseFloat(panel().style.top);
    expect(top + headerHeight).toBeLessThanOrEqual(window.innerHeight);
    o.destroy();
  });

  function targetToggle() {
    return shadow().querySelector(".target-toggle") as HTMLElement;
  }
  function targetBtn() {
    return shadow().querySelector(".target-btn") as HTMLElement;
  }

  it("the edge target button is hidden until the header toggle enables it", () => {
    const o = createOverlay();
    o.open();
    expect(targetBtn().classList.contains("hidden")).toBe(true);
    targetToggle().click();
    expect(targetBtn().classList.contains("hidden")).toBe(false);
    expect(targetToggle().classList.contains("active")).toBe(true);
    expect(targetBtn().title).toBe("ПКМ для перемещения");
    o.destroy();
  });

  it("enabling the target button persists across a fresh overlay instance", () => {
    const o1 = createOverlay();
    o1.open();
    targetToggle().click();
    o1.destroy();

    const o2 = createOverlay();
    o2.open();
    expect(targetBtn().classList.contains("hidden")).toBe(false);
    o2.destroy();
  });

  it("clicking the edge target button toggles the panel closed and open", () => {
    const o = createOverlay();
    o.open();
    targetToggle().click();
    targetBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(o.isOpen()).toBe(false);
    targetBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(o.isOpen()).toBe(true);
    o.destroy();
  });

  it("closing the panel with × keeps the enabled edge target button visible", () => {
    const o = createOverlay();
    o.open();
    targetToggle().click();
    (shadow().querySelector(".close") as HTMLElement).click();
    expect(o.isOpen()).toBe(false);
    expect(targetBtn().classList.contains("hidden")).toBe(false);
    o.destroy();
  });

  it("right-click-dragging the target button moves it along the viewport perimeter and persists (edge:browser/UX)", () => {
    const o = createOverlay();
    o.open();
    targetToggle().click();
    const btn = targetBtn();
    btn.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 2,
        clientX: 1024,
        clientY: 384,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 512, clientY: 0 }),
    );
    window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));
    expect(btn.classList.contains("edge-top")).toBe(true);
    const stored = JSON.parse(localStorage.getItem("pick-element:target-pos")!);
    expect(stored.edge).toBe("top");
    o.destroy();
  });

  it("a left-click mousedown on the target button does not start a right-drag reposition (malformed-input guard)", () => {
    const o = createOverlay();
    o.open();
    targetToggle().click();
    const btn = targetBtn();
    btn.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 1024,
        clientY: 384,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 512, clientY: 0 }),
    );
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(localStorage.getItem("pick-element:target-pos")).toBeNull();
    o.destroy();
  });

  it("mousedown on the header target toggle does not start dragging the panel", () => {
    const o = createOverlay();
    o.open();
    const before = panel().style.left;
    drag(targetToggle(), [20, 20], [200, 200]);
    expect(panel().style.left).toBe(before);
    o.destroy();
  });
});
