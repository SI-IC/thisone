import { chromium } from "playwright";
const port = process.argv[2];
const b = await chromium.launch();
try {
  const c = await b.newContext({ viewport: { width: 900, height: 700 }, permissions: ["clipboard-write"] });
  const p = await c.newPage();
  await p.addInitScript(() => localStorage.setItem("thisone:pos", JSON.stringify({ x: 500, y: 96 })));
  await p.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await p.keyboard.press("Alt+KeyC");
  await p.locator("#__thisone_root >> css=.panel").waitFor();
  await p.locator("button").first().click();
  await p.locator("#__thisone_root >> css=img.shot").waitFor();
  await p.locator("#__thisone_root >> css=.path").click();
  await p.waitForTimeout(400);
  const status = await p.locator("#__thisone_root >> css=.path").locator("xpath=following-sibling::*[1]").textContent();
  console.log("STATUS:", JSON.stringify(status));
  await p.screenshot({ path: "/tmp/final.png" });
} finally { await b.close(); }
