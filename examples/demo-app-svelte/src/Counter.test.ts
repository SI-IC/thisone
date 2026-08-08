// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect } from "vitest";
import { mount, unmount } from "svelte";
import Counter from "./Counter.svelte";

describe("Counter", () => {
  it("starts at 0 and increments on click (boundary: repeated clicks)", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = mount(Counter, { target });
    const btn = target.querySelector("#counter-btn") as HTMLButtonElement;
    expect(btn.textContent).toContain("count is 0");

    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toContain("count is 1");

    btn.click();
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.textContent).toContain("count is 3");

    unmount(instance);
  });
});
