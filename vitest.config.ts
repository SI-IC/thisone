import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
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
