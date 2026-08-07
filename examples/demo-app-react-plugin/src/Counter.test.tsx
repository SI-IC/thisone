import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Counter from "./Counter";

describe("Counter", () => {
  it("renders its button and a nested MemoBadge", () => {
    const html = renderToStaticMarkup(<Counter />);
    expect(html).toContain("count is 0");
    expect(html).toContain("badge");
  });
});
