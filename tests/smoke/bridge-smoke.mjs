#!/usr/bin/env node
// Executable smoke for the Phase 2 bridge: bundles the TS bridge to a temp ESM
// file (esbuild — same toolchain as the build), stands it up on a real port,
// and exercises the full contract over real HTTP + WebSocket:
//   POST /message → GET /api/feedback?ack=1 → live requestSnapshot round-trip.
// Run: node tests/smoke/bridge-smoke.mjs  → prints "bridge-smoke ok".

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const PREFIX = "/__claude_feedback";
const work = mkdtempSync(join(tmpdir(), "cf-bridge-smoke-"));

function assert(cond, msg) {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

try {
  // 1. Bundle the bridge (ws bundled in, node platform).
  const bundle = join(work, "bridge.mjs");
  await build({
    entryPoints: ["src/server/bridge.ts"],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    // ws require()s node builtins (events/stream/...); esbuild's ESM output turns
    // those into a __require shim that throws unless a real require exists. The
    // createRequire banner is the canonical fix (Phase 4 must add the same to
    // scripts/build.mjs once the plugin bundles the bridge).
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
  });
  const { createStandaloneBridge } = await import(pathToFileURL(bundle).href);

  // 2. Stand up the bridge.
  const queueDir = join(work, ".claude-feedback");
  const sb = await createStandaloneBridge({
    queueDir,
    version: "0.0.0-smoke",
  });
  const base = `http://127.0.0.1:${sb.port}${PREFIX}`;

  // 3. POST a feedback message.
  const post = await fetch(`${base}/message`, {
    method: "POST",
    body: JSON.stringify({
      url: "http://app/x",
      message: "smoke says hi",
      element: null,
      component: null,
      console: [{ level: "log", ts: 1, text: "a" }],
      tabId: "smoke",
    }),
  });
  const posted = await post.json();
  assert(
    post.status === 200 && typeof posted.id === "string",
    "POST /message returns id",
  );

  // 4. Drain it with ack.
  const drained = await (await fetch(`${base}/api/feedback?ack=1`)).json();
  assert(drained.items.length === 1, "feedback drained one item");
  assert(
    drained.items[0].message === "smoke says hi",
    "feedback message round-trips",
  );
  const empty = await (await fetch(`${base}/api/feedback?ack=1`)).json();
  assert(empty.items.length === 0, "queue empty after ack");

  // 5. Connect a fake browser tab that replies to snapshot requests.
  const ws = new WebSocket(`ws://127.0.0.1:${sb.port}${PREFIX}/ws`);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "request") {
      ws.send(
        JSON.stringify({
          type: "reply",
          requestId: m.requestId,
          data: { ok: true, kind: m.kind },
        }),
      );
    }
  });
  ws.send(
    JSON.stringify({ type: "hello", tabId: "smoke", url: "http://app/x" }),
  );
  await new Promise((r) => setTimeout(r, 40)); // let hello register

  // 6. Live snapshot round-trip via the HTTP API (the MCP path).
  const snap = await (
    await fetch(`${base}/api/request`, {
      method: "POST",
      body: JSON.stringify({ kind: "console", args: {} }),
    })
  ).json();
  assert(
    snap.data && snap.data.ok === true && snap.data.kind === "console",
    "snapshot round-trip",
  );

  // 7. status reflects connection + port.
  const status = await (await fetch(`${base}/api/status`)).json();
  assert(status.browserConnected === true, "status: browser connected");
  assert(status.port === sb.port, "status: port published");

  ws.close();
  sb.close();
  console.log("bridge-smoke ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
