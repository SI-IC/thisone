import type { Plugin } from "rollup";
import {
  thisonePlugin,
  loadClientBundle,
  isEnabled,
  warnWhenModeUnknown,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneRollup(options: ThisoneOptions = {}): Plugin {
  warnWhenModeUnknown(options);
  if (!isEnabled(options, process.env.NODE_ENV === "development")) {
    return { name: "thisone-rollup" };
  }

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
