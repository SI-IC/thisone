import { describe, it, expect } from "vitest";
import { escapeAttr } from "../../src/plugin/escape-attr";

describe("escapeAttr", () => {
  it('escapes &, <, >, and " for safe use inside a double-quoted HTML attribute', () => {
    expect(escapeAttr(`&<>"`)).toBe("&amp;&lt;&gt;&quot;");
  });

  it("escapes & first so it does not double-escape the entities it just produced", () => {
    expect(escapeAttr('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("returns an empty string unchanged (empty input)", () => {
    expect(escapeAttr("")).toBe("");
  });

  it("returns plain paths with no special characters unchanged (boundary: no-op)", () => {
    expect(escapeAttr("/proj/src/Widget.vue")).toBe("/proj/src/Widget.vue");
  });
});
