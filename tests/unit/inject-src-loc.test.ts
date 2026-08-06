import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc";

const FILE = "/proj/src/components/Counter.vue";

function attrOf(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc="([^"]+)"`);
  const m = re.exec(html);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${html}`);
  return m[1];
}

describe("injectSourceLocations", () => {
  it("injects file:startLine:startCol-endLine:endCol on a single element", () => {
    const src = `<template>\n  <div>hi</div>\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:16`);
  });

  it("injects distinct locations on nested elements", () => {
    const src =
      `<template>\n` +
      `  <section>\n` +
      `    <p>x</p>\n` +
      `  </section>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "section")).toBe(`${FILE}:2:3-4:13`);
    expect(attrOf(out, "p")).toBe(`${FILE}:3:5-3:13`);
  });

  it("injects on both roots of a multi-root (fragment) template", () => {
    const src = `<template>\n  <div>a</div>\n  <span>b</span>\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:15`);
    expect(attrOf(out, "span")).toBe(`${FILE}:3:3-3:17`);
  });

  it("injects on elements inside v-if / v-for without touching the directive", () => {
    const src =
      `<template>\n` +
      `  <div v-if="ok"><b>y</b></div>\n` +
      `  <li v-for="i in items">{{ i }}</li>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:2:3-2:32`);
    expect(attrOf(out, "b")).toBe(`${FILE}:2:18-2:26`);
    expect(attrOf(out, "li")).toBe(`${FILE}:3:3-3:38`);
    expect(out).toContain('v-if="ok"');
    expect(out).toContain('v-for="i in items"');
  });

  it("skips the wrapper <template v-if> tag but injects its child element", () => {
    const src =
      `<template>\n` +
      `  <template v-if="ok">\n` +
      `    <p>z</p>\n` +
      `  </template>\n` +
      `</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "p")).toBe(`${FILE}:3:5-3:13`);
    expect(out).not.toMatch(/<template v-if="ok" data-src-loc/);
  });

  it("injects on a self-closing void element", () => {
    const src = `<template>\n  <img src="x.png" />\n</template>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "img")).toBe(`${FILE}:2:3-2:22`);
  });

  it("returns the source unchanged when there is no <template> block (empty)", () => {
    const src = `<script setup>\nconst x = 1;\n</script>\n`;
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to a vue file <<<>>>";
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });
});
