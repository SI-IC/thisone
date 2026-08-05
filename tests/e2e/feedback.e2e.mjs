#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app");
const bridgeInfoPath = resolve(demoDir, ".claude-feedback/bridge.json");

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0, "usage: feedback.e2e.mjs <port>");
const base = `http://localhost:${port}`;

function readBridgeInfo() {
  return JSON.parse(readFileSync(bridgeInfoPath, "utf8"));
}

function callApi(method, path, body) {
  return new Promise((resolvePromise, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: bodyStr
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(bodyStr),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolvePromise({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function killDevServer() {
  try {
    execFileSync("pkill", ["-f", `vite.*--port ${port}`]);
  } catch {
    return;
  }
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
  await check("no console/page errors on load", async () => {
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
  });

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  const panel = page.locator("#__claude_feedback_root >> css=.panel");
  await check("shadow root + modal present after Alt+C", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator('button:has-text("Выделить элемент")').click();
  const pickHint = page.locator("#__claude_feedback_root >> css=.pickhint");
  await pickHint.waitFor({ state: "visible", timeout: 2000 });
  await page.locator('button:has-text("count is")').click();
  const meta = page.locator("#__claude_feedback_root >> css=.meta");
  await check("picker resolves the Counter component", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
    const text = await meta.textContent();
    assert.match(text ?? "", /Counter/);
  });

  const message = "button label is confusing";
  await page.locator("#__claude_feedback_root >> css=textarea").fill(message);
  await page.locator('button:has-text("Отправить")').click();
  await check("modal closes after successful submit", async () => {
    await panel.waitFor({ state: "hidden", timeout: 2000 });
  });

  await check("submitted payload round-trips through the bridge", async () => {
    const { status, body } = await callApi(
      "GET",
      "/__claude_feedback/api/feedback?ack=1",
    );
    assert.equal(status, 200);
    const item = body.items.at(-1);
    assert.equal(item.url, base + "/");
    assert.equal(item.message, message);
    assert.equal(item.element.tag, "button");
    assert.equal(item.component.name, "Counter");
    assert.match(item.component.file ?? "", /Counter\.vue/);
    assert.ok(Array.isArray(item.console));
    assert.ok(item.console.length > 0, "console buffer should be non-empty");
  });

  await check("store snapshot reflects increment clicks", async () => {
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has-text("count is")').click();
    }
    const { status, body } = await callApi(
      "POST",
      "/__claude_feedback/api/request",
      {
        kind: "store",
        args: { store: "counter" },
      },
    );
    assert.equal(status, 200);
    assert.equal(body.data.state.count, 3);
  });

  await check("edge:empty — no pick, no text still round-trips", async () => {
    await page.keyboard.down("Alt");
    await page.keyboard.press("KeyC");
    await page.keyboard.up("Alt");
    await page.locator('button:has-text("Отправить")').click();
    await panel.waitFor({ state: "hidden", timeout: 2000 });
    const { body } = await callApi(
      "GET",
      "/__claude_feedback/api/feedback?ack=1",
    );
    const item = body.items.at(-1);
    assert.equal(item.element, null);
    assert.equal(item.component, null);
    assert.equal(item.message, "");
    assert.ok(item.console.length > 0);
  });

  await check("edge:boundary — console ring buffer caps at 200", async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 250; i++) console.log("spam", i);
    });
    await page.keyboard.down("Alt");
    await page.keyboard.press("KeyC");
    await page.keyboard.up("Alt");
    await page.locator('button:has-text("Отправить")').click();
    await panel.waitFor({ state: "hidden", timeout: 2000 });
    const { body } = await callApi(
      "GET",
      "/__claude_feedback/api/feedback?ack=1",
    );
    const item = body.items.at(-1);
    assert.equal(item.console.length, 200);
    assert.equal(item.console.at(-1).text, "spam 249");
  });

  await check(
    "edge:concurrency — two snapshot requests in flight both succeed",
    async () => {
      const [a, b] = await Promise.all([
        callApi("POST", "/__claude_feedback/api/request", {
          kind: "store",
          args: { store: "counter" },
        }),
        callApi("POST", "/__claude_feedback/api/request", {
          kind: "store",
          args: { store: "counter" },
        }),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.data.state.count, b.body.data.state.count);
    },
  );

  await check(
    "edge:malformed-input — unknown store name reports available stores",
    async () => {
      const { body } = await callApi("POST", "/__claude_feedback/api/request", {
        kind: "store",
        args: { store: "nope" },
      });
      assert.equal(body.data.error, "not_found");
      assert.deepEqual(body.data.available, ["counter"]);
    },
  );

  await check(
    "edge:deleted-resource — snapshot of a missing selector",
    async () => {
      const { body } = await callApi("POST", "/__claude_feedback/api/request", {
        kind: "component",
        args: { selector: "#gone" },
      });
      assert.equal(body.data.error, "not_found");
    },
  );

  await check(
    "edge:browser/UX — refresh re-mounts overlay and WS reconnects",
    async () => {
      await page.reload({ waitUntil: "networkidle" });
      await page.keyboard.down("Alt");
      await page.keyboard.press("KeyC");
      await page.keyboard.up("Alt");
      await panel.waitFor({ state: "visible", timeout: 2000 });
      await page.waitForTimeout(300);
      const { status, body } = await callApi(
        "POST",
        "/__claude_feedback/api/request",
        {
          kind: "store",
          args: { store: "counter" },
        },
      );
      assert.equal(status, 200);
      assert.ok(
        !body.error,
        `unexpected bridge error: ${JSON.stringify(body)}`,
      );
    },
  );
} finally {
  await browser.close();
}

await check(
  "edge:external-failure — connection refused once dev server stops",
  async () => {
    const info = readBridgeInfo();
    killDevServer();
    await new Promise((r) => setTimeout(r, 500));
    await assert.rejects(
      () => callApi("GET", "/__claude_feedback/api/feedback?ack=1"),
      /ECONNREFUSED/,
    );
    assert.equal(info.port, port);
  },
);

await check("prod build does not inject the overlay", async () => {
  execFileSync(
    "node",
    [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: demoDir,
      stdio: "pipe",
    },
  );
  const found = grepMatches("__claude_feedback", resolve(demoDir, "dist"));
  assert.equal(found, "");
  rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
});

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
