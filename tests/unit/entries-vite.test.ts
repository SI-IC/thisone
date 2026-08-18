import { describe, it, expect } from "vitest";
import thisone from "../../src/entries/vite";

describe("thisone (vite)", () => {
  it("returns an inert plugin when enabled is false", () => {
    const plugin = thisone({ enabled: false }) as any;
    expect(plugin.name).toBe("vite-plugin-thisone");
    expect(plugin.transform).toBeUndefined();
    expect(plugin.transformIndexHtml).toBeUndefined();
  });

  it("wires transform and html injection by default", () => {
    const plugin = thisone() as any;
    expect(plugin.transform).toBeTypeOf("function");
    expect(plugin.transformIndexHtml).toBeDefined();
  });

  it("keeps apply:'serve' — the only thing keeping the overlay out of vite build", () => {
    expect((thisone() as any).apply).toBe("serve");
    expect((thisone({ enabled: false }) as any).apply).toBe("serve");
  });
});
