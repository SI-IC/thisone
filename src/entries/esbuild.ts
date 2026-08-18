import type { Plugin, PluginBuild } from "esbuild";
import {
  thisonePlugin,
  loadClientBundle,
  isEnabled,
  warnWhenModeUnknown,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneEsbuild(options: ThisoneOptions = {}): Plugin {
  warnWhenModeUnknown(options);
  if (!isEnabled(options, process.env.NODE_ENV === "development")) {
    return { name: "thisone-esbuild", setup() {} };
  }

  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.esbuild(options);

  return {
    name: "thisone-esbuild",
    setup(build: PluginBuild) {
      base.setup(build);
      const banner = buildInjectionScript({ hotkey }, loadClientBundle());
      build.initialOptions.banner = {
        ...build.initialOptions.banner,
        js: `${build.initialOptions.banner?.js ?? ""}\n${banner}`,
      };
    },
  };
}

export default thisoneEsbuild;
