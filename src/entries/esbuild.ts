import type { Plugin, PluginBuild } from "esbuild";
import {
  thisonePlugin,
  loadClientBundle,
  type ThisoneOptions,
} from "../core/plugin.js";
import { buildInjectionScript } from "../core/html-inject.js";

export type { ThisoneOptions };

export function thisoneEsbuild(options: ThisoneOptions = {}): Plugin {
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
