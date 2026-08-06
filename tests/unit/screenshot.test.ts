// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  paddedCropRect,
  cropCanvas,
  PADDING_PX,
} from "../../src/client/screenshot";

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect;
}

describe("paddedCropRect", () => {
  it("pads a rect by PADDING_PX on each side", () => {
    const r = paddedCropRect(rect(50, 50, 120, 90), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r).toEqual({ x: 20, y: 20, width: 130, height: 100 });
  });

  it("clamps padding at the top-left bounds edge (boundary)", () => {
    const r = paddedCropRect(rect(10, 5, 60, 40), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(90);
    expect(r.height).toBe(70);
  });

  it("clamps padding at the bottom-right bounds edge (boundary)", () => {
    const r = paddedCropRect(rect(930, 930, 970, 970), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
  });

  it("returns a zero-size rect when the element itself is empty (empty)", () => {
    const r = paddedCropRect(rect(500, 500, 500, 500), 0, {
      width: 1000,
      height: 1000,
    });
    expect(r).toEqual({ x: 500, y: 500, width: 0, height: 0 });
  });
});

describe("cropCanvas", () => {
  it("draws the cropped region onto a new canvas sized to the rect", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as any);
    const source = document.createElement("canvas");

    const out = cropCanvas(source, { x: 10, y: 20, width: 100, height: 50 });

    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    expect(drawImage).toHaveBeenCalledWith(
      source,
      10,
      20,
      100,
      50,
      0,
      0,
      100,
      50,
    );
    vi.restoreAllMocks();
  });

  it("floors output size at 1px for a zero-size crop rect (empty)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as any);
    const source = document.createElement("canvas");

    const out = cropCanvas(source, { x: 0, y: 0, width: 0, height: 0 });

    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    vi.restoreAllMocks();
  });
});
