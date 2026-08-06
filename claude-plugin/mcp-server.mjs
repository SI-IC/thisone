#!/usr/bin/env node
// Phase 5 — stdio MCP server for the claude-feedback plugin.
//
// A thin, stateless front-end over the dev-server bridge: every tool re-reads
// `.claude-feedback/bridge.json` (via bridge-client) and forwards to the bridge's
// localhost /api/* routes. No caching, no own state — a restarted dev server
// (new port) is picked up on the next call. Bridge unreachable → a friendly,
// non-throwing tool result telling Claude to ask the user to start the preview.
//
// Run by Claude Code as: node ${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs (Phase 6 wires
// this into plugin.json mcpServers).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Deliberately the low-level `Server` (not the higher-level `McpServer`): McpServer
// describes tool inputs with zod raw shapes, but zod is only a transitive dep of the
// SDK and is not resolvable from this file under pnpm's nested node_modules. `Server`
// lets us declare plain JSON-Schema inputSchemas and parse args ourselves — exactly
// the "advanced use case" its deprecation note points at — with zero extra deps.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callBridge } from "./lib/bridge-client.mjs";

const PREFIX = "/__claude_feedback";
const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, ".claude-plugin", "plugin.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const TOOLS = [
  {
    name: "get_feedback",
    description:
      "Drain and return all pending element-anchored feedback messages the user sent from the Vue+Vite dev preview (Alt+C). Each item has: url, message, element (tag/classes/selector/sourceLoc — start/end line+column of the tag in its .vue file, when resolvable), component (Vue name + __file + parent chain), and recent browser console. Acknowledges (removes) the items it returns, so call once and process the whole batch.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "request_store_snapshot",
    description:
      "Ask the live browser preview for a snapshot of a Pinia store's state. Omit `store` to list available store ids first. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        store: {
          type: "string",
          description:
            "Pinia store id to snapshot; omit to list available ids.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "request_component_snapshot",
    description:
      "Ask the live browser preview for a snapshot (props + state) of a Vue component. Pass a CSS `selector`, or `last: true` to use the element the user most recently picked. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the target element.",
        },
        last: {
          type: "boolean",
          description: "Use the last element the user picked.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "request_console",
    description:
      "Ask the live browser preview for its current console ring-buffer, optionally filtered by `level`. Requires the preview tab to be open.",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["log", "info", "warn", "error", "debug"],
          description: "Only return entries at this level.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "feedback_status",
    description:
      "Report the dev-server bridge status: whether the preview browser is connected, open tabs, queued feedback count, port and version. Use this to check the tooling is live before asking the user to retry.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
];

/** Wrap a value as a successful MCP text result (pretty-printed JSON). */
function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Wrap a human-readable message as an error MCP result (never throws). */
function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

/** Friendly text for a bridge-client transport error code. */
function bridgeErrorText(error) {
  if (error === "bridge_not_running") {
    return "The Vue+Vite dev preview (with the claude-feedback plugin) doesn't appear to be running — no live bridge was found at .claude-feedback/bridge.json. Ask the user to start the dev server (and open the preview in the browser), then retry.";
  }
  return "The dev-server bridge returned an error. Ask the user to confirm the dev preview is healthy, then retry.";
}

/** Friendly text for a browser-level snapshot failure returned inside data. */
function snapshotErrorText(code) {
  switch (code) {
    case "browser_not_connected":
      return "No browser preview tab is connected to the dev server. Ask the user to open the app's dev preview in the browser, then retry.";
    case "timeout":
      return "The browser preview didn't respond in time. Make sure the preview tab is open and focused, then retry.";
    case "closing":
      return "The dev server is shutting down. Ask the user to keep the dev preview running, then retry.";
    default:
      return `The browser preview reported an error (${code}). Ask the user to confirm the preview is open, then retry.`;
  }
}

/** Forward a snapshot request and interpret both transport- and browser-level errors. */
async function snapshot(kind, args, projectDir) {
  const r = await callBridge(
    "POST",
    `${PREFIX}/api/request`,
    { kind, args },
    { projectDir },
  );
  if (r.error) return errorResult(bridgeErrorText(r.error));
  // /api/request replies 200 with either { data } (success) or { error, detail }.
  const payload = r.data ?? {};
  if (payload.error) return errorResult(snapshotErrorText(payload.error));
  return jsonResult(payload.data);
}

async function dispatch(name, args) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  switch (name) {
    case "get_feedback": {
      const r = await callBridge(
        "GET",
        `${PREFIX}/api/feedback?ack=1`,
        undefined,
        { projectDir },
      );
      if (r.error) return errorResult(bridgeErrorText(r.error));
      const items = r.data?.items ?? [];
      if (items.length === 0) {
        return jsonResult({
          items: [],
          note: "No pending feedback. Ask the user to send some from the preview (Alt+C).",
        });
      }
      return jsonResult({ items });
    }
    case "request_store_snapshot":
      return snapshot("store", { store: args.store }, projectDir);
    case "request_component_snapshot":
      return snapshot(
        "component",
        { selector: args.selector, last: args.last },
        projectDir,
      );
    case "request_console":
      return snapshot("console", { level: args.level }, projectDir);
    case "feedback_status": {
      const r = await callBridge("GET", `${PREFIX}/api/status`, undefined, {
        projectDir,
      });
      if (r.error) return errorResult(bridgeErrorText(r.error));
      return jsonResult(r.data);
    }
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "claude-feedback", version: readVersion() },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    return await dispatch(name, args ?? {});
  } catch (e) {
    // Last-resort guard: a tool must never throw out of the MCP layer.
    return errorResult(
      `Internal error handling ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
});

await server.connect(new StdioServerTransport());
