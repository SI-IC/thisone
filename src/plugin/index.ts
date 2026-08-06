// Vite plugin entry. In dev it (1) inlines the client overlay bundle into every
// page via transformIndexHtml and (2) mounts the in-process bridge (HTTP + WS) on
// the dev server, publishing `.claude-feedback/bridge.json` with the live port so
// the MCP server (Phase 5) can find it. Disabled for production builds.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin, ViteDevServer } from "vite";
import { createBridge, type Bridge } from "../server/bridge.js";
import { injectSourceLocations } from "./inject-src-loc.js";

export interface ClaudeFeedbackOptions {
  /** Hotkey code that opens the overlay together with Alt (default 'KeyC'). */
  hotkey?: string;
  /** Size of the rolling console buffer captured in the browser (default 200). */
  consoleBufferSize?: number;
  /** Snapshot request timeout in ms (default 10000). */
  requestTimeoutMs?: number;
}

const WS_PATH = "/__claude_feedback/ws";

const here = dirname(fileURLToPath(import.meta.url));

/** Locate the built client bundle whether running from dist/ or src/ (tests). */
function loadClientBundle(): string {
  const candidates = [
    resolve(here, "client.js"), // bundled: dist/index.js → dist/client.js
    resolve(here, "../../dist/client.js"), // src/plugin/index.ts → dist/client.js
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(
    "[claude-feedback] dist/client.js not found — run `pnpm build` first.",
  );
}

/** Best-effort read of this package's version for bridge.json. */
function readVersion(): string {
  const candidates = [
    resolve(here, "../package.json"), // dist/index.js → dist/../package.json
    resolve(here, "../../package.json"), // src/plugin/index.ts → repo root
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        const pkg = JSON.parse(readFileSync(c, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    } catch {
      /* ignore and try next */
    }
  }
  return "0.0.0";
}

export function claudeFeedback(options: ClaudeFeedbackOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const consoleBufferSize = options.consoleBufferSize ?? 200;
  const cfgJson = JSON.stringify({ hotkey, consoleBufferSize });

  let isBuild = false;
  let bridge: Bridge | null = null;

  return {
    name: "vite-plugin-claude-feedback",
    apply: "serve",
    enforce: "pre",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    transform(code: string, id: string) {
      if (isBuild || !id.endsWith(".vue")) return;
      return injectSourceLocations(code, id);
    },

    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        // Never inject into a production build (defense-in-depth on top of apply:'serve').
        if (isBuild) return html;
        const client = loadClientBundle();
        return {
          html,
          tags: [
            {
              tag: "script",
              injectTo: "body" as const,
              children: `window.__CLAUDE_FEEDBACK_CFG__=${cfgJson};\n${client}`,
            },
          ],
        };
      },
    },

    configureServer(server: ViteDevServer) {
      const root = server.config.root || process.cwd();
      const queueDir = resolve(root, ".claude-feedback");
      bridge = createBridge({
        queueDir,
        version: readVersion(),
        requestTimeoutMs: options.requestTimeoutMs,
      });

      // HTTP: feedback POST + localhost MCP API. Our middleware no-ops on
      // non-prefixed paths, so it is safe to mount ahead of Vite's stack.
      server.middlewares.use((req, res, next) =>
        bridge!.httpMiddleware(req, res, next),
      );

      // WS: only claim our own upgrade path; everything else (Vite HMR) is left
      // untouched. Calling bridge.handleUpgrade for foreign paths would destroy
      // the socket and break HMR, so gate before delegating.
      const onUpgrade = (
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer,
      ) => {
        const path = new URL(req.url || "", "http://localhost").pathname;
        if (path === WS_PATH) bridge!.handleUpgrade(req, socket, head);
      };

      const publish = () => {
        const addr = server.httpServer?.address();
        const port =
          addr && typeof addr === "object"
            ? addr.port
            : (server.config.server.port ?? 0);
        bridge!.writeBridgeInfo(port);
      };

      const http = server.httpServer;
      if (http) {
        http.on("upgrade", onUpgrade);
        if (http.listening) publish();
        else http.once("listening", publish);
        http.on("close", () => bridge?.close());
      }
    },

    buildEnd() {
      bridge?.close();
      bridge = null;
    },

    closeBundle() {
      bridge?.close();
      bridge = null;
    },
  };
}

export default claudeFeedback;
