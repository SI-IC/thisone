#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app");

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0, "usage: thisone.e2e.mjs <port>");
const base = `http://localhost:${port}`;

const errors = [];
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${label}`))
    .catch((err) => {
      errors.push(`${label}: ${err.message}`);
      console.error(`not ok - ${label}: ${err.message}`);
    });
}

function grepMatches(pattern, dir) {
  try {
    return execFileSync("grep", ["-rl", pattern, dir], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const response = await page.goto(base, { waitUntil: "networkidle" });
  await check("demo responds 200", async () => {
    assert.equal(response.status(), 200);
  });
  await check("no console/page errors on load", async () => {
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
  });

  const panel = page.locator("#__thisone_root >> css=.panel");
  const pathEl = page.locator("#__thisone_root >> css=.path");
  const img = page.locator("#__thisone_root >> css=img.shot");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  await check("panel opens on Alt+C in pick mode", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
    await page
      .locator("#__thisone_root >> css=.pickhint")
      .waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator('button:has-text("count is")').click();
  await check(
    "picking an element shows its path with component + line numbers",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<button>/);
      assert.match(text ?? "", /Counter/);
      assert.match(text ?? "", /Counter\.vue:8:\d+-10:\d+/);
    },
  );
  await check("picking an element renders a screenshot", async () => {
    await img.waitFor({ state: "visible", timeout: 5000 });
    const src = await img.getAttribute("src");
    assert.match(src ?? "", /^blob:/);
  });

  await check(
    "edge:scrolled page — screenshot crop targets the picked element, not the top-of-document content",
    async () => {
      const spage = await context.newPage();
      try {
        await spage.goto(base, { waitUntil: "networkidle" });
        await spage.evaluate(() => {
          const spacer = document.createElement("div");
          spacer.style.height = `${window.innerHeight * 2}px`;
          spacer.style.backgroundColor = "rgb(0, 0, 220)";
          document.body.insertBefore(spacer, document.body.firstChild);

          const btn = document.querySelector("button");
          const wrap = document.createElement("div");
          wrap.style.display = "inline-block";
          wrap.style.padding = "100px";
          wrap.style.backgroundColor = "rgb(0, 200, 0)";
          btn.parentNode.insertBefore(wrap, btn);
          wrap.appendChild(btn);

          const wrapTop = wrap.getBoundingClientRect().top + window.scrollY;
          const wrapHeight = wrap.getBoundingClientRect().height;
          const target = wrapTop - window.innerHeight / 2 + wrapHeight / 2;
          window.scrollTo(0, Math.max(0, target));
        });
        await spage.keyboard.down("Alt");
        await spage.keyboard.press("KeyC");
        await spage.keyboard.up("Alt");
        await spage
          .locator("#__thisone_root >> css=.panel")
          .waitFor({ state: "visible", timeout: 2000 });
        await spage.locator('button:has-text("count is")').click();
        const simg = spage.locator("#__thisone_root >> css=img.shot");
        await simg.waitFor({ state: "visible", timeout: 5000 });
        const scrollYAtCapture = await spage.evaluate(() => window.scrollY);
        assert.ok(
          scrollYAtCapture > 0,
          "page should be scrolled at capture time",
        );
        const rgba = await simg.evaluate(async (imgEl) => {
          const resp = await fetch(imgEl.src);
          const blob = await resp.blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(bitmap, 0, 0);
          const { data } = ctx.getImageData(4, 4, 1, 1);
          return [data[0], data[1], data[2], data[3]];
        });
        assert.ok(
          rgba[3] === 255 && rgba[1] > 150 && rgba[0] < 100 && rgba[2] < 100,
          `expected opaque green wrapper pixel near the crop corner (the picked button's own padded surroundings), got rgba(${rgba.join(",")}) — a wrong/transparent pixel means the crop landed on the un-scrolled top of the document instead`,
        );
      } finally {
        await spage.close();
      }
    },
  );

  await check("clicking the path copies it to the clipboard", async () => {
    await pathEl.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /Counter\.vue:8:\d+-10:\d+/);
  });

  await check(
    "clicking the screenshot copies a PNG to the clipboard",
    async () => {
      await img.click();
      const readClipboardTypes = () =>
        page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          return items[0]?.types ?? [];
        });
      let types = await readClipboardTypes();
      const deadline = Date.now() + 3000;
      while (!types.includes("image/png") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        types = await readClipboardTypes();
      }
      assert.ok(types.includes("image/png"));
    },
  );

  await check(
    "edge:re-pick — clicking a different element while open replaces the selection",
    async () => {
      const headingBox = await page.locator("h1").boundingBox();
      assert.ok(headingBox, "h1 should have a bounding box");
      const headingLeftEdgeX = headingBox.x + 10;
      const headingMidY = headingBox.y + headingBox.height / 2;
      await page.mouse.click(headingLeftEdgeX, headingMidY);
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.doesNotMatch(text ?? "", /button/);
      assert.match(text ?? "", /<h1>/);
      assert.match(text ?? "", /App\.vue:9:/);
    },
  );

  await check("Escape closes the panel", async () => {
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout: 2000 });
  });

  let storedBefore;
  await check(
    "edge:browser/UX — dragged position persists across reopen and reload",
    async () => {
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const header = page.locator("#__thisone_root >> css=.header");
      const box = await header.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 150);
      await page.mouse.up();
      storedBefore = await page.evaluate(() =>
        localStorage.getItem("thisone:pos"),
      );
      assert.ok(storedBefore, "position should be saved to localStorage");

      await page.reload({ waitUntil: "networkidle" });
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const restoredLeft = await panel.evaluate((elm) => elm.style.left);
      const stored = JSON.parse(storedBefore);
      assert.equal(restoredLeft, `${stored.x}px`);
    },
  );

  await check(
    "edge:malformed-input — corrupt localStorage falls back to a default position",
    async () => {
      await page.evaluate(() =>
        localStorage.setItem("thisone:pos", "not json"),
      );
      await page.reload({ waitUntil: "networkidle" });
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      const left = await panel.evaluate((elm) => elm.style.left);
      assert.notEqual(left, "");
    },
  );

  await check(
    "edge:boundary — dragging the panel past the top/left edge clamps it inside the viewport",
    async () => {
      const header = page.locator("#__thisone_root >> css=.header");
      const box = await header.boundingBox();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(-500, -500);
      await page.mouse.up();
      const left = await panel.evaluate((elm) => parseFloat(elm.style.left));
      const top = await panel.evaluate((elm) => parseFloat(elm.style.top));
      assert.ok(left >= 0, `left should clamp to >= 0, got ${left}`);
      assert.ok(top >= 0, `top should clamp to >= 0, got ${top}`);
    },
  );

  await check(
    "edge:boundary — dragging the panel past the bottom edge only clamps the header, not the whole panel, off-screen",
    async () => {
      const header = page.locator("#__thisone_root >> css=.header");
      const box = await header.boundingBox();
      const viewport = page.viewportSize();
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 10, viewport.height + 500);
      await page.mouse.up();
      const top = await panel.evaluate((elm) => parseFloat(elm.style.top));
      const headerHeight = await header.evaluate((elm) => elm.offsetHeight);
      assert.ok(
        top + headerHeight <= viewport.height + 1,
        `header should stay within the viewport, got top=${top} headerHeight=${headerHeight} viewportHeight=${viewport.height}`,
      );
      await page.keyboard.press("Escape");
    },
  );

  await check(
    "hovering the screenshot highlights its border like the path text does",
    async () => {
      await page.evaluate(() => localStorage.removeItem("thisone:pos"));
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      await page.locator('button:has-text("count is")').click();
      await img.waitFor({ state: "visible", timeout: 5000 });
      const before = await img.evaluate(
        (elm) => getComputedStyle(elm).borderColor,
      );
      await img.hover();
      const after = await img.evaluate(
        (elm) => getComputedStyle(elm).borderColor,
      );
      assert.notEqual(after, before);
      await page.keyboard.press("Escape");
    },
  );

  const targetToggle = page.locator("#__thisone_root >> css=.target-toggle");
  const targetBtn = page.locator("#__thisone_root >> css=.target-btn");

  await check(
    "the edge target button is hidden until enabled via the header toggle",
    async () => {
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      await assert.rejects(
        targetBtn.waitFor({ state: "visible", timeout: 500 }),
      );
      await targetToggle.click();
      await targetBtn.waitFor({ state: "visible", timeout: 2000 });
      const title = await targetBtn.getAttribute("title");
      assert.equal(title, "Right-click drag to move");
    },
  );

  await check(
    "clicking the edge target button toggles the panel closed and open",
    async () => {
      await targetBtn.click();
      await panel.waitFor({ state: "hidden", timeout: 2000 });
      await targetBtn.click();
      await panel.waitFor({ state: "visible", timeout: 2000 });
    },
  );

  await check(
    "edge:browser/UX — right-click-dragging the target button moves it along the viewport perimeter and persists",
    async () => {
      const box = await targetBtn.boundingBox();
      const viewport = page.viewportSize();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(viewport.width / 2, 10);
      await page.mouse.up({ button: "right" });
      const stored = await page.evaluate(() =>
        localStorage.getItem("thisone:target-pos"),
      );
      assert.ok(stored, "target position should be saved to localStorage");
      const parsed = JSON.parse(stored);
      assert.equal(parsed.edge, "top");

      await page.reload({ waitUntil: "networkidle" });
      await targetBtn.waitFor({ state: "visible", timeout: 2000 });
      const classes = await targetBtn.getAttribute("class");
      assert.match(classes ?? "", /edge-top/);
    },
  );

  await check(
    "closing the panel with × keeps the edge target button visible",
    async () => {
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      await page.locator("#__thisone_root >> css=.close").click();
      await panel.waitFor({ state: "hidden", timeout: 2000 });
      await targetBtn.waitFor({ state: "visible", timeout: 2000 });
    },
  );
} finally {
  await browser.close();
}

await check("prod build does not inject the overlay", async () => {
  execFileSync(
    "node",
    [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: demoDir,
      stdio: "pipe",
    },
  );
  const found = grepMatches("__thisone", resolve(demoDir, "dist"));
  assert.equal(found, "");
  rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
});

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
