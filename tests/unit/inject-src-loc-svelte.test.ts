import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc-svelte";

const FILE = "/proj/src/components/Counter.svelte";

function attrOf(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc="([^"]+)"`);
  const m = re.exec(html);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${html}`);
  return m[1];
}

describe("injectSourceLocations (Svelte)", () => {
  it("injects file:startLine:startCol-endLine:endCol on a single element", () => {
    const src = `<div>hi</div>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:1:1-1:14`);
  });

  it("injects distinct locations on nested elements", () => {
    const src = `<section>\n  <p>x</p>\n</section>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "section")).toBe(`${FILE}:1:1-3:11`);
    expect(attrOf(out, "p")).toBe(`${FILE}:2:3-2:11`);
  });

  it("injects on multiple root-level elements (Svelte templates have no single-root requirement)", () => {
    const src = `<div>a</div>\n<span>b</span>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "div")).toBe(`${FILE}:1:1-1:13`);
    expect(attrOf(out, "span")).toBe(`${FILE}:2:1-2:15`);
  });

  it("injects on elements inside {#if} and {#each} blocks without touching the block syntax", () => {
    const src =
      `<div>\n` +
      `  {#if ok}<b>y</b>{/if}\n` +
      `  {#each items as i}<li>{i}</li>{/each}\n` +
      `</div>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "b")).toBe(`${FILE}:2:11-2:19`);
    expect(attrOf(out, "li")).toBe(`${FILE}:3:21-3:33`);
    expect(out).toContain("{#if ok}");
    expect(out).toContain("{#each items as i}");
  });

  it("skips custom component tags but still injects their slotted element children", () => {
    const src = `<MyButton><span>x</span></MyButton>\n`;
    const out = injectSourceLocations(src, FILE);
    expect(out).not.toMatch(/<MyButton[^>]*data-src-loc/);
    expect(attrOf(out, "span")).toBe(`${FILE}:1:11-1:25`);
  });

  it("injects on a self-closing void element", () => {
    const src = `<img src="x.png" />\n`;
    const out = injectSourceLocations(src, FILE);
    expect(attrOf(out, "img")).toBe(`${FILE}:1:1-1:20`);
  });

  it("returns the source unchanged when there are no elements (script-only file, empty)", () => {
    const src = `<script>\n  let x = 1;\n</script>\n`;
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to a svelte file <<<>>>";
    expect(injectSourceLocations(src, FILE)).toBe(src);
  });

  it("HTML-escapes special characters in the file path (hostile input)", () => {
    const src = `<div>hi</div>\n`;
    const hostileFile = `/tmp/x.svelte" data-evil="1"><img src=x onerror=alert(1)>`;
    const out = injectSourceLocations(src, hostileFile);
    expect(out).toContain(
      'data-src-loc="/tmp/x.svelte&quot; data-evil=&quot;1&quot;&gt;&lt;img src=x onerror=alert(1)&gt;:1:1-1:14"',
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });
});
