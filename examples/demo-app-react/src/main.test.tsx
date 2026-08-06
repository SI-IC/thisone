// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

describe("main.tsx bootstrap", () => {
  it("mounts App into #app without throwing", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await expect(import("./main")).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("app")?.textContent).toContain(
      "pick-element react demo",
    );
  });
});
