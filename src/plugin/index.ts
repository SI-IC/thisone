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
  let hasPreact = false;

  return {
    name: "vite-plugin-thisone",
    apply: "serve",
    enforce: "pre",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    configResolved(resolvedConfig: { root: string }) {
      try {
        const pkgPath = resolve(resolvedConfig.root, "package.json");
        if (!existsSync(pkgPath)) return;
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        hasPreact = Boolean(
          pkg?.dependencies?.preact || pkg?.devDependencies?.preact,
        );
      } catch {
        hasPreact = false;
      }
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
        const tags: {
          tag: string;
          attrs?: Record<string, string>;
          injectTo: "body" | "head-prepend";
          children: string;
        }[] = [
          {
            tag: "script",
            injectTo: "body",
            children: `window.__THISONE_CFG__=${cfgJson};\n${client}`,
          },
        ];
        if (hasPreact) {
          tags.unshift({
            tag: "script",
            attrs: { type: "module" },
            injectTo: "head-prepend",
            children: `import "virtual:thisone-preact-hook";`,
          });
        }
        return { html, tags };
      },
    },
  };
}

export default thisone;
