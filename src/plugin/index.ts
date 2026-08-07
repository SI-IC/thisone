import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { injectSourceLocations as injectVueSourceLocations } from "./inject-src-loc.js";
import { injectSourceLocations as injectReactSourceLocations } from "./inject-src-loc-react.js";

export interface ThisoneOptions {
  hotkey?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

function loadClientBundle(): string {
  const candidates = [
    resolve(here, "client.js"),
    resolve(here, "../../dist/client.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(
    "[thisone] dist/client.js not found — run `pnpm build` first.",
  );
}

export function thisone(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const cfgJson = JSON.stringify({ hotkey });

  let isBuild = false;

  return {
    name: "vite-plugin-thisone",
    apply: "serve",
    enforce: "pre",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    transform(code: string, id: string) {
      if (isBuild) return;
      if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
      if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
        return injectReactSourceLocations(code, id);
      }
      return;
    },

    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        if (isBuild) return html;
        const client = loadClientBundle();
        return {
          html,
          tags: [
            {
              tag: "script",
              injectTo: "body" as const,
              children: `window.__THISONE_CFG__=${cfgJson};\n${client}`,
            },
          ],
        };
      },
    },
  };
}

export default thisone;
