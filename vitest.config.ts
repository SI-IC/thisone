import { compile } from "svelte/compiler";
import { defineConfig } from "vitest/config";

function svelteTestTransform() {
  return {
    name: "svelte-test-transform",
    transform(code: string, id: string) {
      if (!id.endsWith(".svelte")) return;
      const { js } = compile(code, {
        filename: id,
        generate: "client",
        dev: true,
      });
      return { code: js.code, map: js.map };
    },
  };
}

function preactJsxImportSource() {
  return {
    name: "preact-jsx-import-source",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.includes("/demo-app-preact/") || !/\.tsx$/.test(id)) return;
      return { code: `/** @jsxImportSource preact */\n${code}`, map: null };
    },
  };
}

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  plugins: [svelteTestTransform(), preactJsxImportSource()],
  resolve: {
    conditions: ["browser"],
    alias: {
      "vite-plugin-thisone": new URL("src/plugin/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/.claude/**",
      "**/.pnpm-store/**",
    ],
  },
});
