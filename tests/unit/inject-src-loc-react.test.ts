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

describe("injectSourceLocations (React) — component statics", () => {
  it("attaches __file/__name to a function declaration component", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).toContain('Foo.__name = "Foo";');
  });

  it("attaches __file/__name to a default-exported function component", () => {
    const src = `export default function App() {\n  return <h1>hi</h1>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/App.tsx");
    expect(out).toContain('App.__file = "/proj/App.tsx";');
    expect(out).toContain('App.__name = "App";');
  });

  it("attaches __file/__name to a named-exported function component", () => {
    const src = `export function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches __file/__name to a class component", () => {
    const src =
      `class Foo extends Component {\n` +
      `  render() {\n` +
      `    return <div>hi</div>;\n` +
      `  }\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).toContain('Foo.__name = "Foo";');
  });

  it("attaches statics to the outer binding of a memo()-wrapped component", () => {
    const src = `const Foo = memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).not.toContain("Inner.__file");
  });

  it("attaches statics to the outer binding of a nested memo(forwardRef(...)) component", () => {
    const src =
      `const Foo = memo(forwardRef((props, ref) => {\n` +
      `  return <div>hi</div>;\n` +
      `}));\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("recognizes React.memo / React.forwardRef qualified callees", () => {
    const src = `const Foo = React.memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches statics to a named export const memo() component", () => {
    const src = `export const Foo = memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("does not attach statics to a PascalCase constant that isn't a memo/forwardRef call (false-positive avoidance)", () => {
    const src =
      `const Colors = Object.freeze({ a: 1 });\n` +
      `function lower() {\n` +
      `  return <div>hi</div>;\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("Colors.__file");
  });

  it("does not attach statics to a lowercase-named function even though it renders JSX", () => {
    const src = `function lower() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("lower.__file");
  });
});

describe("injectSourceLocations (React) — bare arrow/function-expression components", () => {
  it("attaches statics to a bare arrow-function component with a concise JSX body", () => {
    const src = `const Foo = () => <div>hi</div>;\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).toContain('Foo.__name = "Foo";');
  });

  it("attaches statics to a bare arrow-function component with a block body", () => {
    const src = `const Foo = () => {\n  return <div>hi</div>;\n};\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches statics to a bare function-expression component", () => {
    const src = `const Foo = function () {\n  return <div>hi</div>;\n};\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("does not attach statics to a bare arrow function that returns non-JSX", () => {
    const src = `const Foo = () => 42;\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).not.toContain("Foo.__file");
  });

  it("does not attach statics to a PascalCase const built from a plain Array.map call", () => {
    const src =
      `const items = ["a", "b"];\n` +
      `const List = items.map((x) => <li key={x}>{x}</li>);\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("List.__file");
  });
});

describe("injectSourceLocations (React) — third-party / aliased HOCs", () => {
  it("attaches statics to a component wrapped by an unrecognized curried HOC (connect(mapState)(Bar))", () => {
    const src =
      `function Bar() {\n  return <div>hi</div>;\n}\n` +
      `const Foo = connect(mapState)(Bar);\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches statics to a component wrapped by a simple third-party HOC (withRouter(Bar))", () => {
    const src =
      `function Bar() {\n  return <div>hi</div>;\n}\n` +
      `const Foo = withRouter(Bar);\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("recognizes an aliased react import (import { memo as m } from 'react')", () => {
    const src =
      `import { memo as m } from "react";\n` +
      `const Foo = m(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).not.toContain("Inner.__file");
  });

  it("recognizes a namespace react import (import * as React from 'react'; React.memo(...))", () => {
    const src =
      `import * as ReactNS from "react";\n` +
      `const Foo = ReactNS.memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("does not attach statics to an unrelated single-call Identifier callee with a PascalCase argument (deepFreeze(SomeSchema))", () => {
    const src = `const Config = deepFreeze(SomeSchema);\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("Config.__file");
  });

  it("wraps injected statics in try/catch so a wrong match can't throw on a frozen/non-extensible target", () => {
    const src = `const Foo = withRouter(Bar);\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toMatch(/try\s*\{[\s\S]*Foo\.__file[\s\S]*\}\s*catch/);
  });
});
