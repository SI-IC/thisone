import * as gifenc from "gifenc";
import { PNG } from "pngjs";

// Не менять, потому что gifenc отдаёт API в namespace под Vite и в .default под Node
const { GIFEncoder, applyPalette, quantize } = gifenc.GIFEncoder
  ? gifenc
  : gifenc.default;

/**
 * Parses a CLI port argument.
 * @param raw - the raw argv entry
 * @returns the port as a positive integer, or null when it is not one
 */
export function parsePort(raw) {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : null;
}

/**
 * Encodes PNG frames into a single looping GIF.
 * @param pngFrames - PNG buffers, all of the same dimensions
 * @param delayMs - per-frame delay in milliseconds
 * @returns the GIF bytes
 */
export function encodeGif(pngFrames, delayMs) {
  if (pngFrames.length === 0) throw new Error("encodeGif: no frames");

  const encoder = GIFEncoder();
  for (const buf of pngFrames) {
    const { data, width, height } = PNG.sync.read(buf);
    const palette = quantize(data, 256, { format: "rgb565" });
    const index = applyPalette(data, palette, "rgb565");
    encoder.writeFrame(index, width, height, { palette, delay: delayMs });
  }
  encoder.finish();
  return encoder.bytes();
}
