#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { encodeGif, parsePort } from "./demo-gif.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WIDTH = 900;
const HEIGHT = 700;
const FRAME_MS = 90;
const PANEL_POS = { x: 500, y: 96 };
const CURSOR_HOST_ID = "__thisone_demo_cursor";
const OVERLAY_HOST_ID = "__thisone_root";
const TERMINAL_HOST_ID = "__thisone_demo_terminal";
const START_POINT = { x: 70, y: 620 };
const GLIDE_STEP_MS = 25;
const MAX_GLIDE_STEPS = 400;

/**
 * Runs in the page: draws a synthetic mouse cursor, since Playwright
 * screenshots never contain the real pointer.
 * @param hostId - id for the cursor's own shadow host
 */
function installCursor(hostId) {
  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .arrow { position: fixed; left: 0; top: 0; pointer-events: none; width: 22px; height: 32px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    </style>
    <svg class="arrow" viewBox="0 0 22 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1 L1 23.5 L6.8 18.2 L10.6 26.8 L14.4 25.1 L10.6 16.8 L18.5 16.3 Z"
            fill="#11111b" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" />
    </svg>`;
  const arrow = shadow.querySelector(".arrow");

  // Не менять, потому что addInitScript выполняется на document_start, когда document.body ещё null
  if (document.body) document.body.appendChild(host);
  else
    addEventListener("DOMContentLoaded", () => document.body.appendChild(host));

  function place(x, y) {
    arrow.style.transform = `translate(${x}px, ${y}px)`;
  }
  place(-100, -100);

  addEventListener(
    "mousemove",
    (event) => place(event.clientX, event.clientY),
    true,
  );

  // Не менять, потому что captureElementScreenshot исключает из рендера только сам оверлейный хост, и курсор вне его поддерева запекается в img.shot
  window.__demoCursorReparent = (overlayHostId) => {
    const overlay = document.getElementById(overlayHostId);
    if (!overlay?.shadowRoot)
      throw new Error("cursor: overlay host has no shadow root");
    overlay.shadowRoot.appendChild(host);
  };
}

/**
 * Runs in the page: draws a hidden, bottom-anchored synthetic Claude Code
 * terminal that the outro scene slides into view and drives.
 * @param hostId - id for the terminal's own shadow host
 */
function installTerminal(hostId) {
  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:900px;pointer-events:none;" +
    "z-index:2147483646;transform:translateY(100%);" +
    "transition:transform 400ms ease-out";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .panel { font-family: ui-monospace, Menlo, monospace; background: #141413; }
      .header { padding: 14px 18px 8px; color: #c2c0b6; font-size: 13px; }
      .input {
        margin: 0 18px 16px; border: 1px solid #3a3934; border-radius: 6px;
        padding: 12px 14px; font-size: 14px; line-height: 1.6;
      }
      .prompt { color: #e8e6dc; }
      .path { color: #8a887e; }
      .status { padding: 0 18px 16px; font-size: 14px; line-height: 1.6; }
      .status.thinking { color: #d97757; }
      .status.ok { color: #e8e6dc; }
    </style>
    <div class="panel">
      <div class="header">✳ Claude Code</div>
      <div class="input"><span class="prompt">&gt; <span class="typed"></span></span><span class="path"></span></div>
      <div class="status"></div>
    </div>`;
  const typed = shadow.querySelector(".typed");
  const pathEl = shadow.querySelector(".path");
  const status = shadow.querySelector(".status");

  // Не менять, потому что addInitScript выполняется на document_start, когда document.body ещё null
  if (document.body) document.body.appendChild(host);
  else
    addEventListener("DOMContentLoaded", () => document.body.appendChild(host));

  window.__demoTerminal = {
    slideUp() {
      host.style.transform = "translateY(0)";
    },
    typeText(str) {
      return new Promise((resolve) => {
        if (str.length === 0) {
          resolve();
          return;
        }
        let i = 0;
        const step = () => {
          typed.textContent += str[i];
          i += 1;
          if (i < str.length) setTimeout(step, 45);
          else resolve();
        };
        step();
      });
    },
    appendPath(str) {
      pathEl.textContent = ` · ${str}`;
    },
    setStatus(state) {
      status.className = `status ${state}`;
      status.textContent = state === "thinking" ? "● Thinking…" : "ok";
    },
  };
}

/**
 * Eased intermediate points from `from` to `to`, `to` always last.
 * @param from - start point
 * @param to - end point
 * @param steps - number of points to emit; clamped to 1..MAX_GLIDE_STEPS
 * @returns the points to feed to `page.mouse.move`, in order
 */
export function glidePoints(from, to, steps) {
  const requested = Math.floor(Number(steps)) || 1;
  const count = Math.min(MAX_GLIDE_STEPS, Math.max(1, requested));
  const points = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    points.push({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    });
  }
  return points;
}

/**
 * Centre of a locator's box, as mouse coordinates.
 * @param locator - a visible Playwright locator
 * @param label - selector name used in the failure message
 */
export async function centerOf(locator, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`record-demo: ${label} has no layout box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Opens the picker, selects the demo button, and waits for its screenshot to render.
 * @param ctx - shared page/glideTo/clickAt from recordDemo
 */
async function scenePickAndScreenshot(ctx) {
  const { page, clickAt } = ctx;
  await page.waitForTimeout(700);
  await page.keyboard.press("Alt+KeyC");
  await page.locator("#__thisone_root >> css=.panel").waitFor();
  await page.evaluate((id) => window.__demoCursorReparent(id), OVERLAY_HOST_ID);
  await page.waitForTimeout(500);

  await clickAt(
    page.locator('button:has-text("count is")'),
    "demo button",
    750,
    700,
  );

  await page.locator("#__thisone_root >> css=img.shot").waitFor();
  await page.waitForTimeout(700);
}

/**
 * Clicks the path text to copy it, as the second half of the pick-and-copy demo.
 * @param ctx - shared page/glideTo/clickAt from recordDemo
 */
async function sceneCopyPath(ctx) {
  const { page, clickAt } = ctx;
  await clickAt(
    page.locator("#__thisone_root >> css=.path"),
    ".path",
    700,
    400,
  );
  await page.waitForTimeout(1500);
}

const SCENES = [scenePickAndScreenshot, sceneCopyPath];

/**
 * Drives the Vue demo app through a pick-and-copy run and writes docs/demo.gif.
 * @param rawPort - port the demo dev server listens on
 * @returns path of the written gif
 */
export async function recordDemo(rawPort) {
  const port = parsePort(rawPort);
  if (port === null) throw new Error("usage: record-demo.mjs <port>");

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
    await page.addInitScript(installCursor, CURSOR_HOST_ID);
    await page.addInitScript(installTerminal, TERMINAL_HOST_ID);
    // Не менять, потому что addStyleTag не переживает vite's HMR full-reload, addInitScript переживает
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = ".demo-header { display: none !important; }";
      const append = () => document.head.appendChild(style);
      if (document.head) append();
      else addEventListener("DOMContentLoaded", append);
    });
    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    let cursor = START_POINT;
    async function glideTo(to, durationMs) {
      const steps = Math.max(1, Math.round(durationMs / GLIDE_STEP_MS));
      for (const point of glidePoints(cursor, to, steps)) {
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(GLIDE_STEP_MS);
      }
      cursor = to;
    }

    async function clickAt(locator, label, glideMs, settleMs) {
      await locator.waitFor();
      await glideTo(await centerOf(locator, label), glideMs);
      await page.waitForTimeout(settleMs);
      const now = await centerOf(locator, label);
      await page.mouse.move(now.x, now.y);
      cursor = now;
      await page.mouse.down();
      await page.mouse.up();
    }

    await page.mouse.move(START_POINT.x, START_POINT.y);

    capturing = true;
    const loop = captureLoop(page);

    const ctx = { page, glideTo, clickAt };
    try {
      for (const scene of SCENES) {
        try {
          await scene(ctx);
        } catch (error) {
          throw new Error(`record-demo: scene "${scene.name}" failed`, {
            cause: error,
          });
        }
      }
    } finally {
      capturing = false;
      await loop;
    }
    await context.close();
  } finally {
    await browser.close();
  }

  if (frames.length === 0) throw new Error("record-demo: no frames captured");

  if (process.env.THISONE_DEMO_DEBUG_FRAMES) {
    const n = frames.length;
    const indices = new Set([
      0,
      Math.floor(n / 4),
      Math.floor(n / 2),
      Math.floor((3 * n) / 4),
      n - 1,
    ]);
    for (const i of indices) {
      writeFileSync(`/tmp/demo-frame-${i}.png`, frames[i]);
    }
  }

  const out = resolve(root, "docs/demo.gif");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodeGif(frames, FRAME_MS));
  console.log(`record-demo: wrote ${out} (${frames.length} frames)`);
  return out;
}

export function isDirectRun(argv1) {
  return Boolean(argv1) && import.meta.url === pathToFileURL(argv1).href;
}

if (isDirectRun(process.argv[1])) {
  try {
    await recordDemo(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
