export const PLUGIN_BUNDLE_EXTERNAL = [
  "vite",
  "webpack",
  "unplugin",
  "@vue/compiler-sfc",
  "@vue/compiler-core",
  "svelte",
];

export const CLIENT_BUILD_OPTIONS = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2019",
  sourcemap: false,
};
