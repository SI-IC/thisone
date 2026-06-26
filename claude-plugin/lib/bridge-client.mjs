// Thin HTTP client from the MCP server to the dev-server bridge (Phase 5).
// No own state: it re-reads `.claude-feedback/bridge.json` on every call so a
// restarted dev server (new port) is picked up transparently. The bridge gates
// its /api/* routes on loopback + a localhost Host header, so requests go to
// 127.0.0.1 with an explicit `Host: 127.0.0.1:<port>` header.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

const REQUEST_TIMEOUT_MS = 12_000;

/** Resolve the project dir holding `.claude-feedback/` (explicit > env > cwd). */
function resolveProjectDir(projectDir) {
  return projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * Read and parse `.claude-feedback/bridge.json` under `projectDir`.
 * Returns the BridgeInfo object, or null when missing/unreadable/malformed.
 */
export function readBridgeInfo(projectDir) {
  const file = join(
    resolveProjectDir(projectDir),
    ".claude-feedback",
    "bridge.json",
  );
  try {
    const info = JSON.parse(readFileSync(file, "utf8"));
    if (!info || typeof info.port !== "number") return null;
    return info;
  } catch {
    return null;
  }
}

/**
 * Make an HTTP call to the bridge.
 *   - returns { ok: true, data } on a 2xx JSON response
 *   - { error: "bridge_not_running" } when bridge.json is absent, the port is
 *     refused/unreachable, or the request times out
 *   - { error: "bridge_error" } on a 4xx/5xx response or unparseable body
 * Browser-level failures (snapshot timeout etc.) come back as HTTP 200 with an
 * `{error}` field inside `data` — the tool layer interprets those, not here.
 *
 * @param {"GET"|"POST"} method
 * @param {string} path  full path incl. the /__claude_feedback prefix
 * @param {unknown} [body]  JSON-serializable POST body (omit for GET)
 * @param {{projectDir?:string}} [opts]
 */
export function callBridge(method, path, body, opts = {}) {
  const info = readBridgeInfo(opts.projectDir);
  if (!info) return Promise.resolve({ error: "bridge_not_running" });

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    const data =
      body !== undefined && body !== null ? JSON.stringify(body) : undefined;
    const headers = { host: `127.0.0.1:${info.port}` };
    if (data !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(data);
    }

    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: info.port,
        method,
        path,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (status < 200 || status >= 300) {
            done({ error: "bridge_error", status });
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            done({ error: "bridge_error", detail: "invalid_json" });
            return;
          }
          done({ ok: true, data: parsed });
        });
      },
    );

    req.on("error", () => done({ error: "bridge_not_running" }));
    req.on("timeout", () => {
      req.destroy();
      done({ error: "bridge_not_running" });
    });
    if (data !== undefined) req.write(data);
    req.end();
  });
}
