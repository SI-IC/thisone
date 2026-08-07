#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: record-demo.mjs <port>");
  process.exit(1);
}

const { GIFEncoder, applyPalette, quantize } = gifenc;

const WIDTH = 900;
const HEIGHT = 700;
const FRAME_MS = 90;
const PANEL_POS = { x: 500, y: 96 };

const frames = [];
let capturing = false;

async function captureLoop(page) {
  while (capturing) {
    const started = Date.now();
    try {
      frames.push(await page.screenshot({ type: "png" }));
    } catch {
      break;
    }
    const rest = FRAME_MS - (Date.now() - started);
    if (rest > 0) await page.waitForTimeout(rest);
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    permissions: ["clipboard-write"],
  });
  const page = await context.newPage();
  await page.addInitScript((pos) => {
    localStorage.setItem("thisone:pos", JSON.stringify(pos));
  }, PANEL_POS);
  await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  capturing = true;
  const loop = captureLoop(page);

  try {
    await page.waitForTimeout(700);
    await page.keyboard.press("Alt+KeyC");
    await page.locator("#__thisone_root >> css=.panel").waitFor();
    await page.waitForTimeout(700);

    const target = page.locator("button").first();
    await target.hover();
    await page.waitForTimeout(600);
    await target.click();

    await page.locator("#__thisone_root >> css=img.shot").waitFor();
    await page.waitForTimeout(900);
    await page.locator("#__thisone_root >> css=.path").click();
    await page.waitForTimeout(1500);
  } finally {
    capturing = false;
    await loop;
  }
  await context.close();
} finally {
  await browser.close();
}

if (frames.length === 0) {
  console.error("record-demo: no frames captured");
  process.exit(1);
}

const encoder = GIFEncoder();
for (const buf of frames) {
  const { data, width, height } = PNG.sync.read(buf);
  const palette = quantize(data, 256, { format: "rgb565" });
  const index = applyPalette(data, palette, "rgb565");
  encoder.writeFrame(index, width, height, {
    palette,
    delay: FRAME_MS,
  });
}
encoder.finish();

const out = resolve(root, "docs/demo.gif");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encoder.bytes());
console.log(`record-demo: wrote ${out} (${frames.length} frames)`);
