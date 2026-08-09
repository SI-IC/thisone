import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUnplugin } from "unplugin";
import { injectSourceLocations as injectVueSourceLocations } from "../plugin/inject-src-loc.js";
import { injectSourceLocations as injectReactSourceLocations } from "../plugin/inject-src-loc-react.js";
import { injectSourceLocations as injectSvelteSourceLocations } from "../plugin/inject-src-loc-svelte.js";
import {
  PREACT_HOOK_VIRTUAL_ID,
  PREACT_HOOK_RESOLVED_ID,
  PREACT_HOOK_SOURCE,
} from "../plugin/preact-hook.js";
import { buildInjectionScript } from "./html-inject.js";

export interface ThisoneOptions {
  hotkey?: string;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadClientBundle(): string {
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

function transformSource(code: string, id: string): string | undefined {
  if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
  if (id.endsWith(".svelte")) return injectSvelteSourceLocations(code, id);
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    return injectReactSourceLocations(code, id);
  }
  return undefined;
}

export function detectPreact(root: string): boolean {
  try {
    const pkgPath = resolve(root, "package.json");
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg?.dependencies?.preact || pkg?.devDependencies?.preact);
  } catch {
    return false;
  }
}

export interface InjectionTag {
  tag: string;
  attrs?: Record<string, string>;
  injectTo: "body" | "head-prepend";
  children: string;
}

export function buildInjectionTags(
  hotkey: string,
  hasPreact: boolean,
): InjectionTag[] {
  const tags: InjectionTag[] = [
    {
      tag: "script",
      injectTo: "body",
      children: buildInjectionScript({ hotkey }, loadClientBundle()),
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
  return tags;
}

export const thisonePlugin = createUnplugin<ThisoneOptions | undefined>(
  (options = {}) => {
    return {
      name: "thisone",
      enforce: "pre",

      transformInclude(id) {
        return (
          id.endsWith(".vue") ||
          id.endsWith(".svelte") ||
          id.endsWith(".tsx") ||
          id.endsWith(".jsx")
        );
      },

      transform(code, id) {
        return transformSource(code, id);
      },

      resolveId(id) {
        if (id === PREACT_HOOK_VIRTUAL_ID) return PREACT_HOOK_RESOLVED_ID;
      },

      load(id) {
        if (id === PREACT_HOOK_RESOLVED_ID) return PREACT_HOOK_SOURCE;
      },
    };
  },
);
