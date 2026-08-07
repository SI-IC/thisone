// Do not change, because without @vitest-environment happy-dom this file runs in a node environment with no window/document
import { describe, it, expect } from "vitest";

describe("main.ts bootstrap", () => {
  it("mounts App into #app without throwing", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await expect(import("./main")).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("app")?.textContent).toContain(
      "thisone svelte demo",
    );
  });
});
