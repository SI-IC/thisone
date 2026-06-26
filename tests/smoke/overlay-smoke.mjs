#!/usr/bin/env node
// Executable smoke for Phase 4: runs a REAL Vite dev server (Vite is a devDep —
// no Playwright/chromium needed, which the offline store lacks) with the built
// plugin against a tiny dev-app, and verifies the end-to-end dev contract:
//   1. the served document inlines the client bundle + config,
//   2. .claude-feedback/bridge.json is published with the live dev-server port,
//   3. a feedback POST round-trips through the mounted bridge,
//   4. a snapshot request with no browser connected degrades cleanly,
//   5. a production `vite build` injects nothing.
// The browser-side overlay JS (Alt+C, shadow DOM, picker, WS replies) is covered
// by the happy-dom unit tests (overlay/ws-client). Run: node tests/smoke/overlay-smoke.mjs
//   → prints "overlay-smoke ok".

import { createServer, build } from "vite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "dev-app");
const PREFIX = "/__claude_feedback";

function assert(cond, msg) {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

let server;
try {
  if (!existsSync(join(here, "../../dist/index.js"))) {
    throw new Error(
      "run `pnpm build` first — smoke uses the built dist/ plugin",
    );
  }

  // 1. Stand up a real Vite dev server on a free port.
  server = await createServer({
    root: appRoot,
    configFile: join(appRoot, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "silent",
  });
  await server.listen();
  const addr = server.httpServer.address();
  const port = typeof addr === "object" ? addr.port : addr;
  const base = `http://127.0.0.1:${port}`;

  // 2. The served HTML inlines the client bundle + config.
  const html = await (await fetch(`${base}/index.html`)).text();
  assert(html.includes("__CLAUDE_FEEDBACK_CFG__"), "config injected into HTML");
  assert(html.includes('"hotkey":"KeyC"'), "hotkey config inlined");
  assert(html.includes("__claude_feedback_root"), "client bundle inlined");

  // 3. bridge.json published with the live dev-server port.
  const infoPath = join(appRoot, ".claude-feedback", "bridge.json");
  assert(existsSync(infoPath), "bridge.json written");
  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  assert(
    info.port === port,
    `bridge.json port matches dev server (${info.port} vs ${port})`,
  );

  // 4. Feedback POST round-trips through the mounted bridge.
  const post = await fetch(`${base}${PREFIX}/message`, {
    method: "POST",
    body: JSON.stringify({
      url: `${base}/`,
      message: "smoke feedback",
      element: {
        tag: "button",
        classes: [],
        text: "Hello",
        selector: "#hello",
      },
      component: null,
      console: [{ level: "log", ts: 1, text: "demo app booted" }],
      tabId: "smoke",
    }),
  });
  const posted = await post.json();
  assert(
    post.status === 200 && typeof posted.id === "string",
    "POST /message → id",
  );

  const drained = await (
    await fetch(`${base}${PREFIX}/api/feedback?ack=1`)
  ).json();
  assert(drained.items.length === 1, "feedback drained one item");
  assert(drained.items[0].message === "smoke feedback", "feedback round-trips");
  assert(drained.items[0].url === `${base}/`, "feedback url preserved");
  assert(drained.items[0].console.length === 1, "feedback console preserved");

  // 5. A snapshot request with no browser connected degrades cleanly.
  const snap = await (
    await fetch(`${base}${PREFIX}/api/request`, {
      method: "POST",
      body: JSON.stringify({ kind: "store", args: {} }),
    })
  ).json();
  assert(
    snap.error === "browser_not_connected",
    "snapshot degrades without browser",
  );

  await server.close();
  server = null;

  // 6. Production build injects nothing (apply:'serve' + gating).
  const outDir = join(appRoot, "dist-smoke");
  rmSync(outDir, { recursive: true, force: true });
  await build({
    root: appRoot,
    configFile: join(appRoot, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  const builtHtml = readFileSync(join(outDir, "index.html"), "utf8");
  assert(
    !builtHtml.includes("__claude_feedback"),
    "production build does NOT inject",
  );
  rmSync(outDir, { recursive: true, force: true });

  console.log("overlay-smoke ok");
} finally {
  if (server) await server.close();
  rmSync(join(appRoot, ".claude-feedback"), { recursive: true, force: true });
  rmSync(join(appRoot, "dist-smoke"), { recursive: true, force: true });
}
