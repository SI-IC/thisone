import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc-react";

function srcLocOf(code: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc=\\{"([^"]+)"\\}`);
  const m = re.exec(code);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${code}`);
  return m[1];
}

describe("injectSourceLocations (React)", () => {
  it("injects file:startLine:startCol-endLine:endCol on a host element", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "div")).toBe("/proj/Foo.tsx:2:10-2:23");
  });

  it("injects distinct locations on nested host elements", () => {
    const src =
      `function Foo() {\n` +
      `  return (\n` +
      `    <section>\n` +
      `      <p>x</p>\n` +
      `    </section>\n` +
      `  );\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "section")).toBe("/proj/Foo.tsx:3:5-5:15");
    expect(srcLocOf(out, "p")).toBe("/proj/Foo.tsx:4:7-4:15");
  });

  it("skips a custom component tag but still injects its host children", () => {
    const src = `function App() {\n  return <MyButton><span>x</span></MyButton>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/App.tsx");
    expect(out).not.toMatch(/<MyButton[^>]*data-src-loc/);
    expect(srcLocOf(out, "span")).toBe("/proj/App.tsx:2:20-2:34");
  });

  it("injects on a self-closing host element", () => {
    const src = `function Foo() {\n  return <img src="x.png" />;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "img")).toBe("/proj/Foo.tsx:2:10-2:29");
  });

  it("returns the source unchanged when there is no JSX (empty)", () => {
    const src = `export const x = 1;\n`;
    expect(injectSourceLocations(src, "/proj/x.tsx")).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to valid tsx <<<>>>";
    expect(injectSourceLocations(src, "/proj/x.tsx")).toBe(src);
  });

  it("safely escapes a hostile file path as a JS string literal", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const hostile = '/tmp/x.tsx" onerror=alert(1)';
    const out = injectSourceLocations(src, hostile);
    expect(out).toContain(
      'data-src-loc={"/tmp/x.tsx\\" onerror=alert(1):2:10-2:23"}',
    );
  });
});
