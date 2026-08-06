// Element screenshot: render the viewport with modern-screenshot, then crop to
// the element's rect padded by PADDING_PX of real surrounding page content.
import { domToCanvas } from "modern-screenshot";

export const PADDING_PX = 30;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `rect` padded by `padding` on each side, clamped to a `bounds`-sized canvas. */
export function paddedCropRect(
  rect: DOMRect,
  padding: number,
  bounds: { width: number; height: number },
): CropRect {
  const x = Math.max(0, rect.left - padding);
  const y = Math.max(0, rect.top - padding);
  const right = Math.min(bounds.width, rect.right + padding);
  const bottom = Math.min(bounds.height, rect.bottom + padding);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

/** Crop `source` to `rect`, returning a new canvas sized exactly to `rect`. */
export function cropCanvas(
  source: HTMLCanvasElement,
  rect: CropRect,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width));
  out.height = Math.max(1, Math.round(rect.height));
  const ctx = out.getContext("2d")!;
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

/**
 * Screenshot `el` with PADDING_PX of real surrounding page content, as a PNG blob.
 * @param excludeRoot - node (e.g. the picker overlay's shadow host) to omit
 * from the render along with its descendants.
 */
export async function captureElementScreenshot(
  el: Element,
  excludeRoot?: Node | null,
): Promise<Blob> {
  const full = await domToCanvas(document.documentElement, {
    width: window.innerWidth,
    height: window.innerHeight,
    // Do not change, because restoreScrollPosition:false desyncs the canvas from getBoundingClientRect() on scroll
    features: { restoreScrollPosition: true },
    filter: excludeRoot ? (node) => node !== excludeRoot : undefined,
  });
  const rect = paddedCropRect(el.getBoundingClientRect(), PADDING_PX, {
    width: full.width,
    height: full.height,
  });
  const cropped = cropCanvas(full, rect);
  return new Promise((resolvePromise, reject) => {
    cropped.toBlob((blob) => {
      if (blob) resolvePromise(blob);
      else reject(new Error("toBlob returned null"));
    }, "image/png");
  });
}
