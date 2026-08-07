import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DemoHeader from "./DemoHeader";

describe("DemoHeader", () => {
  it('marks the "React" link active when active="react"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="react" />);
    expect(html).toMatch(/<a href="\/react-demo\/" class="active">React<\/a>/);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
  });

  it('marks the "Vue" link active when active="vue"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="vue" />);
    expect(html).toMatch(/<a href="\/" class="active">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(/<a href="\/preact-demo\/">Preact<\/a>/);
  });

  it('marks the "Preact" link active when active="preact"', () => {
    const html = renderToStaticMarkup(<DemoHeader active="preact" />);
    expect(html).toMatch(/<a href="\/">Vue<\/a>/);
    expect(html).toMatch(/<a href="\/react-demo\/">React<\/a>/);
    expect(html).toMatch(
      /<a href="\/preact-demo\/" class="active">Preact<\/a>/,
    );
  });
});
