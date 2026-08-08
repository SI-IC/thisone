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
function pathModeRadio(mode: "tree" | "root") {
  return shadow().querySelector(
    `input[name="path-mode"][value="${mode}"]`,
  ) as HTMLInputElement;
}
function settingsHeader() {
  return shadow().querySelector(".settings-header") as HTMLElement;
}
function settingsBody() {
  return shadow().querySelector(".settings-body") as HTMLElement;
}
function pickHint() {
  return shadow().querySelector(".pickhint") as HTMLElement;
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

  it("shows ThisOne as the panel title", () => {
    const o = createOverlay();
    o.open();
    expect(shadow().querySelector(".title")?.textContent).toBe("ThisOne");
    o.destroy();
  });

  it("shows the empty-state hint before anything is picked", () => {
    const o = createOverlay();
    o.open();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /select an element/i,
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
    expect(shadow().querySelector(".path-row + .status")?.textContent).toBe(
      "Copied",
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
    expect(shadow().querySelector(".path-row + .status")?.textContent).toBe(
      "Copy failed",
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
      "Copied",
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
    localStorage.setItem("thisone:pos", JSON.stringify({ x: 123, y: 45 }));
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
    expect(targetBtn().title).toBe("Right-click drag to move");
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
    const stored = JSON.parse(localStorage.getItem("thisone:target-pos")!);
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
    expect(localStorage.getItem("thisone:target-pos")).toBeNull();
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

  it("defaults to file-tree path mode selected in Settings", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(pathModeRadio("tree").checked).toBe(true);
    expect(pathModeRadio("root").checked).toBe(false);
    o.destroy();
  });

  it("selecting the root-mount radio switches the path for the same selection", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    (target as any).__vueParentComponent = {
      type: { __file: "/src/components/Counter.vue", name: "Counter" },
      parent: {
        type: { __file: "/src/App.vue", name: "App" },
        parent: null,
      },
    };
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    const before = pathEl().textContent;

    pathModeRadio("root").click();
    await tick();
    expect(pathModeRadio("root").checked).toBe(true);
    expect(pathEl().textContent).not.toBe(before);
    expect(pathEl().textContent).toMatch(/App .*Counter/);
    o.destroy();
  });

  it("path mode persists across a fresh overlay instance", async () => {
    const o1 = createOverlay();
    const target1 = document.createElement("button");
    document.body.appendChild(target1);
    o1.open();
    target1.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    pathModeRadio("root").click();
    o1.destroy();

    const o2 = createOverlay();
    const target2 = document.createElement("span");
    document.body.appendChild(target2);
    o2.open();
    target2.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(pathModeRadio("root").checked).toBe(true);
    o2.destroy();
  });

  it("no .path-mode-toggle button remains next to the path", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(shadow().querySelector(".path-mode-toggle")).toBeNull();
    o.destroy();
  });

  it("each path-mode radio has a question-mark tooltip explaining it", () => {
    const o = createOverlay();
    o.open();
    const qmarks = shadow().querySelectorAll(
      ".setting-group .radio-row .qmark",
    );
    expect(qmarks).toHaveLength(2);
    expect((qmarks[0] as HTMLElement).title.length).toBeGreaterThan(0);
    expect((qmarks[1] as HTMLElement).title.length).toBeGreaterThan(0);
    o.destroy();
  });

  it("Settings panel starts collapsed and expands on click, persisting the state", () => {
    const o = createOverlay();
    o.open();
    expect(settingsBody().classList.contains("hidden")).toBe(true);

    settingsHeader().click();
    expect(settingsBody().classList.contains("hidden")).toBe(false);
    expect(localStorage.getItem("thisone:settings-expanded")).toBe("1");
    o.destroy();

    const o2 = createOverlay();
    o2.open();
    expect(settingsBody().classList.contains("hidden")).toBe(false);
    o2.destroy();
  });

  it("the Settings panel sits between the header and the body", () => {
    const o = createOverlay();
    o.open();
    const children = Array.from(panel().children).map(
      (c) => c.className.split(" ")[0],
    );
    expect(children).toEqual(["header", "settings", "body"]);
    o.destroy();
  });

  function screenshotRadio(value: "yes" | "no") {
    return shadow().querySelector(
      `input[name="screenshot-enabled"][value="${value}"]`,
    ) as HTMLInputElement;
  }
  function paddingInput() {
    return shadow().querySelector("#thisone-padding") as HTMLInputElement;
  }
  function shotLoading() {
    return shadow().querySelector(".shot-loading") as HTMLElement;
  }
  function sectionTitles() {
    return Array.from(shadow().querySelectorAll(".section-title")).map(
      (n) => n.textContent,
    );
  }

  it("shows Path and Screenshot section titles when a screenshot is picked", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(sectionTitles()).toEqual(["Path", "Screenshot"]);
    o.destroy();
  });

  it("shows a 'Taking screenshot' loader before the image resolves", async () => {
    let resolveCapture!: (b: Blob) => void;
    vi.spyOn(screenshot, "captureElementScreenshot").mockReturnValue(
      new Promise((r) => (resolveCapture = r)),
    );
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();

    expect(shotLoading().getAttribute("aria-label")).toBe("Taking screenshot");
    expect(shadow().querySelector("img.shot")).toBeNull();

    resolveCapture(new Blob(["x"], { type: "image/png" }));
    await tick();
    expect(shadow().querySelector(".shot-loading")).toBeNull();
    expect(img().src).toBe("blob:fake");
    o.destroy();
  });

  it("screenshot defaults to enabled with padding 30", () => {
    const o = createOverlay();
    o.open();
    expect(screenshotRadio("yes").checked).toBe(true);
    expect(screenshotRadio("no").checked).toBe(false);
    expect(paddingInput().value).toBe("30");
    o.destroy();
  });

  it("selecting 'no' hides the padding row and the screenshot section on the next pick", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();

    screenshotRadio("no").click();
    expect(
      paddingInput().offsetParent === null ||
        paddingInput().closest(".padding-row.hidden"),
    ).toBeTruthy();

    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(sectionTitles()).toEqual(["Path"]);
    expect(shadow().querySelector("img.shot")).toBeNull();
    expect(shadow().querySelector(".shot-loading")).toBeNull();
    o.destroy();
  });

  it("changing the padding is used on the next screenshot capture", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();

    paddingInput().value = "50";
    paddingInput().dispatchEvent(new Event("change", { bubbles: true }));

    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(screenshot.captureElementScreenshot).toHaveBeenLastCalledWith(
      target,
      expect.anything(),
      50,
    );
    o.destroy();
  });

  it("screenshot enabled flag and padding persist across a fresh overlay instance", () => {
    const o1 = createOverlay();
    o1.open();
    screenshotRadio("no").click();
    paddingInput().value = "40";
    paddingInput().dispatchEvent(new Event("change", { bubbles: true }));
    o1.destroy();

    const o2 = createOverlay();
    o2.open();
    expect(screenshotRadio("no").checked).toBe(true);
    expect(paddingInput().value).toBe("40");
    o2.destroy();
  });

  it("switching screenshot to 'no' with a target already picked removes the Screenshot section", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(sectionTitles()).toEqual(["Path", "Screenshot"]);

    screenshotRadio("no").click();
    await tick();
    expect(sectionTitles()).toEqual(["Path"]);
    expect(shadow().querySelector("img.shot")).toBeNull();
    expect(shadow().querySelector(".shot-loading")).toBeNull();
    o.destroy();
  });

  it("changing padding with a target already picked re-captures with the new padding", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(screenshot.captureElementScreenshot).toHaveBeenLastCalledWith(
      target,
      expect.anything(),
      30,
    );

    paddingInput().value = "60";
    paddingInput().dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(screenshot.captureElementScreenshot).toHaveBeenLastCalledWith(
      target,
      expect.anything(),
      60,
    );
    o.destroy();
  });

  it("pickHint has a tooltip explaining the right-click drag", () => {
    const o = createOverlay();
    o.open();
    expect(pickHint().title.length).toBeGreaterThan(0);
    o.destroy();
  });

  it("right-click-dragging the pick hint moves it horizontally within the viewport and persists (edge:browser/UX)", () => {
    const o = createOverlay();
    o.open();
    const hint = pickHint();
    hint.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 2,
        clientX: 400,
        clientY: 12,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 700, clientY: 12 }),
    );
    window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));

    expect(hint.style.top).toBe("");
    const left = parseFloat(hint.style.left);
    expect(left).toBeGreaterThan(0);
    expect(hint.style.transform).toBe("none");
    const stored = JSON.parse(localStorage.getItem("thisone:pickhint-x")!);
    expect(stored).toBe(left);
    o.destroy();
  });

  it("edge:boundary — dragging the pick hint past the right edge clamps it inside the viewport", () => {
    const o = createOverlay();
    o.open();
    const hint = pickHint();
    hint.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 2,
        clientX: 400,
        clientY: 12,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 100000, clientY: 12 }),
    );
    window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));

    const left = parseFloat(hint.style.left);
    expect(left + hint.offsetWidth).toBeLessThanOrEqual(window.innerWidth);
    o.destroy();
  });

  it("a left-click mousedown on the pick hint does not start a drag (malformed-input guard)", () => {
    const o = createOverlay();
    o.open();
    const hint = pickHint();
    hint.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 400,
        clientY: 12,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 700, clientY: 12 }),
    );
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(localStorage.getItem("thisone:pickhint-x")).toBeNull();
    o.destroy();
  });

  it("restores a persisted pick-hint offset on open", () => {
    localStorage.setItem("thisone:pickhint-x", JSON.stringify(77));
    const o = createOverlay();
    o.open();
    expect(pickHint().style.left).toBe("77px");
    o.destroy();
  });

  it("leaves the CSS centering transform untouched when there is no persisted pick-hint offset", () => {
    const o = createOverlay();
    o.open();
    expect(pickHint().style.left).toBe("");
    expect(pickHint().style.transform).toBe("");
    o.destroy();
  });

  it("clears the CSS centering transform when a persisted pick-hint offset is restored on open", () => {
    localStorage.setItem("thisone:pickhint-x", JSON.stringify(77));
    const o = createOverlay();
    o.open();
    expect(pickHint().style.left).toBe("77px");
    expect(pickHint().style.transform).toBe("none");
    o.destroy();
  });

  it("closing and reopening the panel clears the stale selection, so changing a Settings value shows the empty hint again", async () => {
    const o = createOverlay();
    const target = document.createElement("button");
    document.body.appendChild(target);
    o.open();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await tick();
    expect(pathEl()).toBeTruthy();

    (shadow().querySelector(".close") as HTMLElement).click();
    expect(o.isOpen()).toBe(false);

    o.open();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /select an element/i,
    );

    pathModeRadio("root").click();
    await tick();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /select an element/i,
    );
    expect(pathEl()).toBeNull();

    screenshotRadio("no").click();
    await tick();
    expect(shadow().querySelector(".hint")?.textContent).toMatch(
      /select an element/i,
    );
    expect(pathEl()).toBeNull();
    o.destroy();
  });

  it("re-clamps the pick hint's horizontal position against its real (stubbed nonzero) width once startPick shows it", () => {
    const savedOffset = 900;
    localStorage.setItem("thisone:pickhint-x", JSON.stringify(savedOffset));
    Object.defineProperty(window, "innerWidth", {
      value: 1000,
      configurable: true,
    });

    const o = createOverlay();
    o.open();
    const hint = pickHint();
    Object.defineProperty(hint, "offsetWidth", {
      value: 220,
      configurable: true,
    });

    expect(parseFloat(hint.style.left)).toBe(900);

    (shadow().querySelector(".close") as HTMLElement).click();
    o.open();

    const left = parseFloat(hint.style.left);
    expect(left + 220).toBeLessThanOrEqual(1000);
    o.destroy();
  });

  it("settings-header is keyboard accessible with aria-expanded kept in sync", () => {
    const o = createOverlay();
    o.open();
    const header = settingsHeader();
    expect(header.getAttribute("role")).toBe("button");
    expect(header.tabIndex).toBe(0);
    expect(header.getAttribute("aria-expanded")).toBe("false");

    header.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(settingsBody().classList.contains("hidden")).toBe(false);
    expect(header.getAttribute("aria-expanded")).toBe("true");

    header.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(settingsBody().classList.contains("hidden")).toBe(true);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    o.destroy();
  });

  it("each .qmark tooltip has a non-empty aria-label mirroring its title", () => {
    const o = createOverlay();
    o.open();
    const qmarks = shadow().querySelectorAll(".qmark");
    expect(qmarks.length).toBeGreaterThan(0);
    qmarks.forEach((q) => {
      const el = q as HTMLElement;
      expect(el.getAttribute("aria-label")).toBe(el.title);
      expect(el.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    });
    o.destroy();
  });
});
