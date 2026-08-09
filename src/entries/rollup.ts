import type { Plugin } from "rollup";
import {
  thisonePlugin,
  loadClientBundle,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneRollup(options: ThisoneOptions = {}): Plugin {
  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.rollup(options) as Plugin;

  return {
    ...base,
    name: "thisone-rollup",
    renderChunk(code: string, chunk: { isEntry: boolean }) {
      if (!chunk.isEntry) return null;
      const banner = buildInjectionScript({ hotkey }, loadClientBundle());
      return { code: `${banner}\n${code}`, map: null };
    },
  };
}

export default thisoneRollup;
