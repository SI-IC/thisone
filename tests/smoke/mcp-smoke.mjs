#!/usr/bin/env node
// Executable smoke for the Phase 5 MCP server: stands up a fake bridge (a plain
// http server answering /api/status, /api/feedback, /api/request), writes
// bridge.json into a temp project dir, then launches mcp-server.mjs as a real
// child process and drives it over a real stdio MCP client — initialize,
// tools/list, then every tool — asserting the round-trips.
// Run: node tests/smoke/mcp-smoke.mjs  → prints "mcp-smoke ok".

import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PREFIX = "/__claude_feedback";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(join(tmpdir(), "cf-mcp-smoke-"));

function assert(cond, msg) {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

/** Parse the single text content block of a tool result back into JSON. */
function resultJson(res) {
  return JSON.parse(res.content[0].text);
}

let bridge;
let client;
try {
  // 1. Fake bridge: enforces the loopback Host header like the real one, and
  //    serves canned responses for each MCP-facing route.
  const feedbackItem = {
    id: "fb_1",
    ts: 1,
    url: "http://app/x",
    message: "the button is misaligned",
    element: {
      tag: "button",
      classes: ["cta"],
      text: "Buy",
      selector: "button.cta",
    },
    component: {
      name: "BuyButton",
      file: "src/BuyButton.vue",
      chain: ["BuyButton", "App"],
    },
    console: [{ level: "warn", ts: 1, text: "deprecation" }],
    tabId: "t1",
  };
  let feedbackDrained = false;

  bridge = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const host = req.headers.host || "";
      const okHost = /^(127\.0\.0\.1|localhost|\[?::1\]?)(:\d+)?$/.test(host);
      if (!okHost) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      const u = new URL(req.url, "http://127.0.0.1");
      const send = (obj) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === `${PREFIX}/api/status`) {
        send({
          port: server.address().port,
          pid: 1,
          startedAt: 1,
          version: "smoke",
          browserConnected: true,
          tabs: ["t1"],
          queueSize: feedbackDrained ? 0 : 1,
        });
      } else if (u.pathname === `${PREFIX}/api/feedback`) {
        const items = feedbackDrained ? [] : [feedbackItem];
        if (u.searchParams.get("ack") === "1") feedbackDrained = true;
        send({ items });
      } else if (u.pathname === `${PREFIX}/api/request`) {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const { kind } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          send({ data: { kind, echoed: true } });
        });
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        port: server.address().port,
        close: () => server.close(),
      }),
    );
  });

  // 2. bridge.json in a temp project dir the MCP server will discover.
  mkdirSync(join(work, ".claude-feedback"), { recursive: true });
  writeFileSync(
    join(work, ".claude-feedback", "bridge.json"),
    JSON.stringify({
      port: bridge.port,
      pid: 1,
      startedAt: 1,
      version: "smoke",
    }),
  );

  // 3. Launch the real MCP server as a child and connect a real MCP client.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, "claude-plugin", "mcp-server.mjs")],
    env: { ...process.env, CLAUDE_PROJECT_DIR: work },
    stderr: "inherit",
  });
  client = new Client(
    { name: "mcp-smoke", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // 4. tools/list — all five tools present.
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert(
    JSON.stringify(names) ===
      JSON.stringify([
        "feedback_status",
        "get_feedback",
        "request_component_snapshot",
        "request_console",
        "request_store_snapshot",
      ]),
    "tools/list returns the five tools, got " + names.join(","),
  );

  // 5. feedback_status round-trips the bridge status.
  const status = resultJson(
    await client.callTool({ name: "feedback_status", arguments: {} }),
  );
  assert(
    status.browserConnected === true && status.port === bridge.port,
    "feedback_status reflects bridge",
  );

  // 6. get_feedback drains the queued item, then is empty (ack worked end-to-end).
  const fb1 = resultJson(
    await client.callTool({ name: "get_feedback", arguments: {} }),
  );
  assert(
    fb1.items.length === 1 &&
      fb1.items[0].message === "the button is misaligned",
    "get_feedback returns the item",
  );
  const fb2 = resultJson(
    await client.callTool({ name: "get_feedback", arguments: {} }),
  );
  assert(fb2.items.length === 0, "get_feedback empty after ack");

  // 7. snapshot tools forward kind + args and unwrap the bridge's { data }.
  const snap = resultJson(
    await client.callTool({
      name: "request_console",
      arguments: { level: "warn" },
    }),
  );
  assert(
    snap.kind === "console" && snap.echoed === true,
    "request_console round-trip",
  );
  const store = resultJson(
    await client.callTool({
      name: "request_store_snapshot",
      arguments: { store: "cart" },
    }),
  );
  assert(store.kind === "store", "request_store_snapshot round-trip");

  // 8. Bridge offline → friendly, non-throwing error result.
  bridge.close();
  bridge = null;
  const offline = await client.callTool({
    name: "feedback_status",
    arguments: {},
  });
  assert(
    offline.isError === true && /dev preview/i.test(offline.content[0].text),
    "offline bridge → friendly error result",
  );

  await client.close();
  client = null;
  console.log("mcp-smoke ok");
} finally {
  if (client) await client.close().catch(() => {});
  if (bridge) bridge.close();
  rmSync(work, { recursive: true, force: true });
}
