import type { Plugin } from "rollup";
import {
  thisonePlugin,
  loadClientBundle,
  isEnabled,
  nodeEnvSaysDev,
  warnWhenModeUnknown,
  callBaseHook,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneRollup(options: ThisoneOptions = {}): Plugin {
  if (options.enabled === false) return { name: "thisone-rollup" };

  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.rollup(options) as Plugin & Record<string, any>;

  let warned = false;

  const activeIn = (ctx: any): boolean =>
    isEnabled(options, nodeEnvSaysDev(ctx?.meta?.watchMode === true));

  const callBase = (hook: string, ctx: any, args: unknown[]) =>
    callBaseHook(base, hook, ctx, args);

  return {
    name: "thisone-rollup",
    enforce: base.enforce,

    buildStart(this: any, buildOptions: any) {
      const active = activeIn(this);
      if (!warned) {
        warned = true;
        warnWhenModeUnknown(options, active);
      }
      if (!active) return null;
      return callBase("buildStart", this, [buildOptions]);
    },

    transform(this: any, code: string, id: string) {
      if (!activeIn(this)) return null;
      return callBase("transform", this, [code, id]);
    },

    resolveId(this: any, id: string, importer: any, resolveOptions: any) {
      if (!activeIn(this)) return null;
      return callBase("resolveId", this, [id, importer, resolveOptions]);
    },

    load(this: any, id: string) {
      if (!activeIn(this)) return null;
      return callBase("load", this, [id]);
    },

    renderChunk(this: any, code: string, chunk: { isEntry: boolean }) {
      if (!activeIn(this) || !chunk.isEntry) return null;
      const banner = buildInjectionScript({ hotkey }, loadClientBundle());
      return { code: `${banner}\n${code}`, map: null };
    },
  } as Plugin;
}

export default thisoneRollup;
