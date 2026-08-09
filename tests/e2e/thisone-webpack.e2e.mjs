import { chromium } from "playwright";

const port = process.argv[2];
if (!port) throw new Error("usage: thisone-webpack.e2e.mjs <port>");

const browser = await chromium.launch();
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
await page.goto(`http://localhost:${port}/`);

await page.keyboard.down("Alt");
await page.keyboard.press("KeyC");
await page.keyboard.up("Alt");

const pathEl = page.locator("#__thisone_root >> css=.path");

await page.click("#target-button");
await pathEl.waitFor({ state: "visible", timeout: 2000 });
await pathEl.click();

const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
if (!clipboardText.includes("main.jsx")) {
  throw new Error(
    `expected clipboard to reference main.jsx, got: ${clipboardText}`,
  );
}

await browser.close();
console.log("ok - webpack e2e: Alt+C click copies source location");
