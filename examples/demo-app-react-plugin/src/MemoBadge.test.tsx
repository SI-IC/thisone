import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MemoBadge from "./MemoBadge";

describe("MemoBadge", () => {
  it("renders its label prop", () => {
    const html = renderToStaticMarkup(<MemoBadge label="demo" />);
    expect(html).toContain("demo");
    expect(html).toContain('class="badge"');
  });
});
