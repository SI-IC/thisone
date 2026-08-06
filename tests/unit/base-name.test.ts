import { describe, it, expect } from "vitest";
import { baseName } from "../../src/client/base-name";

describe("baseName", () => {
  it("strips directory and extension", () => {
    expect(baseName("/src/components/Counter.vue")).toBe("Counter");
  });

  it("strips a query string (Vite sub-request id)", () => {
    expect(baseName("/src/Counter.vue?vue&type=script")).toBe("Counter");
  });

  it("strips a hash fragment", () => {
    expect(baseName("/src/Counter.vue#foo")).toBe("Counter");
  });

  it("handles a bare filename with no directory", () => {
    expect(baseName("Counter.tsx")).toBe("Counter");
  });

  it("handles windows-style backslash separators", () => {
    expect(baseName("C:\\proj\\src\\Counter.tsx")).toBe("Counter");
  });
});
