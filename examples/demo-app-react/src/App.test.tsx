import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";

describe("App", () => {
  it("renders the heading and the Counter subtree", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("thisone react demo");
    expect(html).toContain("count is 0");
  });
});
