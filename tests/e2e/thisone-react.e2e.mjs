#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app-react");

const port = Number(process.argv[2]);
assert.ok(
  Number.isInteger(port) && port > 0,
  "usage: thisone-react.e2e.mjs <port>",
);
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
  const page = await browser.newPage();
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
  await check(
    "no console/page errors on load (bare Vite+React, no @vitejs/plugin-react)",
    async () => {
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);
    },
  );

  const panel = page.locator("#__thisone_root >> css=.panel");
  const pathEl = page.locator("#__thisone_root >> css=.path");
  const settingsHeader = page.locator(
    "#__thisone_root >> css=.settings-header",
  );
  const pathModeRoot = page.locator(
    '#__thisone_root >> css=input[name="path-mode"][value="root"]',
  );
  const pathModeTree = page.locator(
    '#__thisone_root >> css=input[name="path-mode"][value="tree"]',
  );

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  await check("panel opens on Alt+C", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator('button:has-text("count is")').click();
  await check(
    "picking a host element inside a function component resolves name + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<button>/);
      assert.match(text ?? "", /Counter/);
      assert.match(text ?? "", /Counter\.tsx:8:\d+-8:\d+/);
    },
  );

  const badgeBox = await page.locator("span.badge").boundingBox();
  assert.ok(badgeBox, "span.badge should have a bounding box");
  await page.mouse.click(
    badgeBox.x + badgeBox.width / 2,
    badgeBox.y + badgeBox.height / 2,
  );
  await check(
    "picking a host element inside a memo()-wrapped component resolves the memo's own name (not an ancestor's), even when React unwraps the fiber's type to the inner render function",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /^<span> · MemoBadge · /);
      assert.match(text ?? "", /MemoBadge\.tsx:4:\d+-4:\d+/);
    },
  );

  await check(
    "root-mount path mode includes the memo()-wrapped component's own file in the breadcrumb",
    async () => {
      await settingsHeader.click();
      await pathModeRoot.waitFor({ state: "visible", timeout: 2000 });
      await pathModeRoot.click();
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(
        text ?? "",
        /^App \(.*App\.tsx\) › Counter \(.*Counter\.tsx\) › MemoBadge \(.*MemoBadge\.tsx\) › <span>/,
      );
      await pathModeTree.click();
      await settingsHeader.click();
    },
  );

  const headingBox = await page.locator("h1").boundingBox();
  assert.ok(headingBox, "h1 should have a bounding box");
  await page.mouse.click(
    headingBox.x + 10,
    headingBox.y + headingBox.height / 2,
  );
  await check(
    "picking a host element inside the default-exported root component resolves App + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<h1>/);
      assert.match(text ?? "", /App/);
      assert.match(text ?? "", /App\.tsx:10:\d+-10:\d+/);
    },
  );

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 2000 });
} finally {
  await browser.close();
}

await check(
  "prod build does not inject the overlay or any data-src-loc",
  async () => {
    execFileSync(
      "node",
      [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
      { cwd: demoDir, stdio: "pipe" },
    );
    const found = grepMatches(
      "__thisone\\|data-src-loc",
      resolve(demoDir, "dist"),
    );
    assert.equal(found, "");
    rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
  },
);

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
