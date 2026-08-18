import { Compilation, sources } from "@rspack/core";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  isEnabled,
  type ThisoneOptions,
} from "../core/plugin.js";
import { escapeAttr } from "../plugin/escape-attr.js";

export type { ThisoneOptions };

const PLUGIN_NAME = "thisone-rspack";

function renderTags(hotkey: string, hasPreact: boolean): string {
  return buildInjectionTags(hotkey, hasPreact)
    .map((t) => {
      const attrs = t.attrs
        ? " " +
          Object.entries(t.attrs)
            .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
            .join(" ")
        : "";
      return `<${t.tag}${attrs}>${t.children}</${t.tag}>`;
    })
    .join("\n");
}

export function thisoneRspack(
  options: ThisoneOptions = {},
): RspackPluginInstance {
  if (options.enabled === false) return { apply() {} };

  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.rspack(options);

  return {
    apply(compiler: Compiler) {
      if (!isEnabled(options, compiler.options.mode === "development")) return;

      base.apply(compiler);

      const hasPreact = detectPreact(compiler.context);

      compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_NAME,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT,
          },
          (assets: Record<string, sources.Source>) => {
            for (const [name, asset] of Object.entries(assets)) {
              if (!name.endsWith(".html")) continue;
              const html = asset.source().toString();
              if (!html.includes("</body>")) continue;
              const injected = html.replace(
                "</body>",
                `${renderTags(hotkey, hasPreact)}\n</body>`,
              );
              compilation.updateAsset(name, new sources.RawSource(injected));
            }
          },
        );
      });
    },
  };
}

export default thisoneRspack;
