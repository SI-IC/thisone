// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import DemoHeader from "./DemoHeader";

describe("DemoHeader", () => {
  it('marks the "Preact" link active when active="preact"', () => {
    const container = document.createElement("div");
    render(h(DemoHeader, { active: "preact" }), container);
    expect(
      container.querySelector('a[href="/preact-demo/"]')?.className,
    ).toBe("active");
    expect(container.querySelector('a[href="/"]')?.className).toBe("");
  });

  it('marks the "Svelte" link active when active="svelte"', () => {
    const container = document.createElement("div");
    render(h(DemoHeader, { active: "svelte" }), container);
    expect(
      container.querySelector('a[href="/svelte-demo/"]')?.className,
    ).toBe("active");
    expect(
      container.querySelector('a[href="/preact-demo/"]')?.className,
    ).toBe("");
  });
});
