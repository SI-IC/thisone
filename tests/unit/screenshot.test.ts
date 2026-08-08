// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  paddedCropRect,
  cropCanvas,
  PADDING_PX,
  MAX_CAPTURE_SCALE,
  captureElementScreenshot,
} from "../../src/client/screenshot";
import * as modernScreenshot from "modern-screenshot";

vi.mock("modern-screenshot", { spy: true });

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
    const r = paddedCropRect(rect(900, 900, 990, 990), PADDING_PX, {
      width: 1000,
      height: 1000,
    });
    expect(r.width).toBe(130);
    expect(r.height).toBe(130);
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

describe("captureElementScreenshot padding parameter", () => {
  it("uses a custom padding instead of PADDING_PX when provided", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1000;
    vi.spyOn(modernScreenshot, "domToCanvas").mockResolvedValue(canvas);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(["x"], { type: "image/png" }));
      },
    );
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 150,
      bottom: 150,
      width: 50,
      height: 50,
    } as DOMRect);

    await captureElementScreenshot(el, null, 0);

    expect(drawImage).toHaveBeenCalledWith(
      canvas,
      100,
      100,
      50,
      50,
      0,
      0,
      50,
      50,
    );
    vi.restoreAllMocks();
  });
});

describe("captureElementScreenshot render scale (boundary)", () => {
  it("caps a high devicePixelRatio at MAX_CAPTURE_SCALE and scales the crop rect", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 3000;
    const domToCanvas = vi
      .spyOn(modernScreenshot, "domToCanvas")
      .mockResolvedValue(canvas);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(["x"], { type: "image/png" }));
      },
    );
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      right: 150,
      bottom: 150,
      width: 50,
      height: 50,
    } as DOMRect);

    await captureElementScreenshot(el, null, 0);

    expect(domToCanvas).toHaveBeenCalledWith(
      document.documentElement,
      expect.objectContaining({ scale: MAX_CAPTURE_SCALE }),
    );
    expect(drawImage).toHaveBeenCalledWith(
      canvas,
      100 * MAX_CAPTURE_SCALE,
      100 * MAX_CAPTURE_SCALE,
      50 * MAX_CAPTURE_SCALE,
      50 * MAX_CAPTURE_SCALE,
      0,
      0,
      50 * MAX_CAPTURE_SCALE,
      50 * MAX_CAPTURE_SCALE,
    );
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
