import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper, no type declarations
import { encodeGif, parsePort } from "../../scripts/demo-gif.mjs";

function pngFrame(
  width: number,
  height: number,
  rgb: [number, number, number],
) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("parsePort", () => {
  it("accepts a positive integer", () => {
    expect(parsePort("5187")).toBe(5187);
  });

  it("malformed-input: rejects a non-numeric argument", () => {
    expect(parsePort("@evil.tld")).toBeNull();
  });

  it("empty: rejects a missing or blank argument", () => {
    expect(parsePort(undefined)).toBeNull();
    expect(parsePort("")).toBeNull();
    expect(parsePort("   ")).toBeNull();
  });

  it("boundary: rejects zero, negatives and fractional ports", () => {
    expect(parsePort("0")).toBeNull();
    expect(parsePort("-1")).toBeNull();
    expect(parsePort("80.5")).toBeNull();
  });
});

describe("encodeGif", () => {
  it("writes a GIF89a stream from PNG frames", () => {
    const bytes = encodeGif([pngFrame(4, 3, [255, 0, 0])], 90);
    expect(Buffer.from(bytes.slice(0, 6)).toString("latin1")).toBe("GIF89a");
  });

  it("marks the animation as looping forever", () => {
    const bytes = Buffer.from(
      encodeGif([pngFrame(4, 3, [255, 0, 0]), pngFrame(4, 3, [0, 0, 255])], 90),
    );
    const at = bytes.indexOf(Buffer.from("NETSCAPE2.0"));
    expect(at).toBeGreaterThan(0);
    expect(bytes.readUInt16LE(at + 14)).toBe(0);
  });

  it("preserves the frame dimensions in the logical screen descriptor", () => {
    const bytes = Buffer.from(encodeGif([pngFrame(12, 7, [0, 255, 0])], 90));
    expect(bytes.readUInt16LE(6)).toBe(12);
    expect(bytes.readUInt16LE(8)).toBe(7);
  });

  it("empty: throws instead of writing a zero-frame gif", () => {
    expect(() => encodeGif([], 90)).toThrow(/no frames/);
  });

  it("malformed-input: propagates a decode failure for a non-PNG buffer", () => {
    expect(() => encodeGif([Buffer.from("not a png")], 90)).toThrow();
  });
});
