import type { Plugin } from "vite";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  type ThisoneOptions,
} from "../core/plugin.js";

export type { ThisoneOptions };

export function thisone(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  let isBuild = false;
  let hasPreact = false;

  const base = thisonePlugin.vite(options) as Plugin & Record<string, any>;

  return {
    ...base,
    name: "vite-plugin-thisone",
    apply: "serve",

    config(_config, env) {
      isBuild = env.command === "build";
    },

    configResolved(resolvedConfig: { root: string }) {
      hasPreact = detectPreact(resolvedConfig.root);
    },

    transform(code: string, id: string) {
      if (isBuild) return;
      const raw = base.transform;
      const handler = typeof raw === "function" ? raw : raw?.handler;
      return handler?.call(this, code, id);
    },

    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        if (isBuild) return html;
        return { html, tags: buildInjectionTags(hotkey, hasPreact) };
      },
    },
  } as Plugin;
}

export default thisone;
