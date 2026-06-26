// Glue tests for the Vite plugin entry. transformIndexHtml injection + build-mode
// gating, plus a configureServer smoke against a real http.Server (the bridge is
// mounted, a feedback POST round-trips, and bridge.json lands with the live port).
// Requires `pnpm build` first — the plugin inlines the real dist/client.js.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import claudeFeedback from "../../src/plugin/index";

type AnyPlugin = ReturnType<typeof claudeFeedback> & Record<string, any>;

function callConfig(plugin: AnyPlugin, command: "serve" | "build") {
  const hook = plugin.config as any;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  fn?.call(plugin, {}, { command, mode: command });
}

function callTransform(plugin: AnyPlugin, html: string) {
  const t = plugin.transformIndexHtml as any;
  const handler = typeof t === "function" ? t : t.handler;
  return handler.call(plugin, html, {
    path: "/index.html",
    filename: "index.html",
  });
}

describe("plugin transformIndexHtml", () => {
  beforeAll(() => {
    if (!existsSync(join(process.cwd(), "dist/client.js"))) {
      throw new Error(
        "run `pnpm build` before this test (needs dist/client.js)",
      );
    }
  });

  it("injects the inlined client + config in serve mode", () => {
    const plugin = claudeFeedback({
      hotkey: "KeyB",
      consoleBufferSize: 50,
    }) as AnyPlugin;
    callConfig(plugin, "serve");
    const res = callTransform(plugin, "<html><body></body></html>") as {
      tags: { tag: string; children: string; injectTo: string }[];
    };
    expect(res.tags).toHaveLength(1);
    const tag = res.tags[0];
    expect(tag.tag).toBe("script");
    expect(tag.injectTo).toBe("body");
    expect(tag.children).toContain("__CLAUDE_FEEDBACK_CFG__");
    expect(tag.children).toContain('"hotkey":"KeyB"');
    expect(tag.children).toContain('"consoleBufferSize":50');
    // the real client bundle is inlined
    expect(tag.children).toContain("__claude_feedback_root");
  });

  it("does NOT inject in build mode (gating)", () => {
    const plugin = claudeFeedback() as AnyPlugin;
    callConfig(plugin, "build");
    const html = "<html><body></body></html>";
    const res = callTransform(plugin, html);
    expect(res).toBe(html);
  });

  it("declares apply:'serve'", () => {
    expect((claudeFeedback() as AnyPlugin).apply).toBe("serve");
  });
});

describe("plugin configureServer", () => {
  let server: Server | null = null;
  let work: string;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("mounts the bridge, round-trips feedback, writes bridge.json", async () => {
    work = mkdtempSync(join(tmpdir(), "cf-plugin-"));
    const plugin = claudeFeedback() as AnyPlugin;

    const middlewares: Array<(req: any, res: any, next: () => void) => void> =
      [];
    server = createServer((req, res) => {
      let i = 0;
      const next = () => {
        const mw = middlewares[i++];
        if (mw) mw(req, res, next);
        else {
          res.statusCode = 404;
          res.end("nf");
        }
      };
      next();
    });

    const fakeViteServer = {
      config: { root: work, server: { port: 0 } },
      middlewares: { use: (fn: any) => middlewares.push(fn) },
      httpServer: server,
    };

    (plugin.configureServer as any)(fakeViteServer);

    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server!.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;
    const base = `http://127.0.0.1:${port}/__claude_feedback`;

    // bridge.json published with the live port
    const infoPath = join(work, ".claude-feedback", "bridge.json");
    // listening fired synchronously above; give the once('listening') a tick
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(infoPath)).toBe(true);
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    expect(info.port).toBe(port);

    // POST a feedback message → 200 {id}
    const post = await fetch(`${base}/message`, {
      method: "POST",
      body: JSON.stringify({
        url: "http://app/x",
        message: "from plugin test",
        element: null,
        component: null,
        console: [],
        tabId: "t",
      }),
    });
    expect(post.status).toBe(200);

    // drain it (loopback + localhost Host gate satisfied)
    const drained = await (await fetch(`${base}/api/feedback?ack=1`)).json();
    expect(drained.items).toHaveLength(1);
    expect(drained.items[0].message).toBe("from plugin test");

    (plugin.buildEnd as any)?.();
  });
});
