import type { Compiler, WebpackPluginInstance } from "webpack";
import {
  thisonePlugin,
  detectPreact,
  buildInjectionTags,
  isEnabled,
  type ThisoneOptions,
} from "../core/plugin.js";
import { escapeAttr } from "../plugin/escape-attr.js";

export type { ThisoneOptions };

const PLUGIN_NAME = "thisone-webpack";

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

function findHtmlWebpackPluginCtor(compiler: Compiler): any {
  const instance = (compiler.options.plugins ?? []).find(
    (p: any) => p?.constructor?.name === "HtmlWebpackPlugin",
  ) as any;
  return instance?.constructor;
}

export function thisoneWebpack(
  options: ThisoneOptions = {},
): WebpackPluginInstance {
  if (options.enabled === false) return { apply() {} };

  const hotkey = options.hotkey ?? "KeyC";
  const base = thisonePlugin.webpack(options);

  return {
    apply(compiler: Compiler) {
      if (!isEnabled(options, compiler.options.mode === "development")) return;

      base.apply(compiler);

      const hasPreact = detectPreact(compiler.context);
      const HtmlWebpackPluginCtor = findHtmlWebpackPluginCtor(compiler);

      if (!HtmlWebpackPluginCtor?.getHooks) {
        compiler.hooks.done.tap(PLUGIN_NAME, () => {
          console.warn(
            "[thisone] no html-webpack-plugin detected — skipping automatic client injection.",
          );
        });
        return;
      }

      compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
        HtmlWebpackPluginCtor.getHooks(compilation).beforeEmit.tapAsync(
          PLUGIN_NAME,
          (data: { html: string }, cb: (err: null, data: unknown) => void) => {
            data.html = data.html.replace(
              "</body>",
              `${renderTags(hotkey, hasPreact)}\n</body>`,
            );
            cb(null, data);
          },
        );
      });
    },
  };
}

export default thisoneWebpack;
