#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { encodeGif, parsePort } from "./demo-gif.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = parsePort(process.argv[2]);
if (port === null) {
  console.error("usage: record-demo.mjs <port>");
  process.exit(1);
}

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

const out = resolve(root, "docs/demo.gif");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodeGif(frames, FRAME_MS));
console.log(`record-demo: wrote ${out} (${frames.length} frames)`);
