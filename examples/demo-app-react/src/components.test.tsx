import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import Counter from "./Counter";
import MemoBadge from "./MemoBadge";

describe("demo-app-react components render", () => {
  it("App renders the heading and the Counter subtree", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("pick-element react demo");
    expect(html).toContain("count is 0");
  });

  it("Counter renders its button and a nested MemoBadge", () => {
    const html = renderToStaticMarkup(<Counter />);
    expect(html).toContain("count is 0");
    expect(html).toContain("badge");
  });

  it("MemoBadge renders its label prop", () => {
    const html = renderToStaticMarkup(<MemoBadge label="demo" />);
    expect(html).toContain("demo");
    expect(html).toContain('class="badge"');
  });
});
