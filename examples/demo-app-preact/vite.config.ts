import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_PREACT_PORT ?? 5186);
const proxiedByDevDemoOnPort = process.env.THISONE_DEMO_PORT
  ? Number(process.env.THISONE_DEMO_PORT)
  : undefined;

export default defineConfig({
  plugins: [thisone()],
  base: proxiedByDevDemoOnPort ? "/preact-demo/" : "/",
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: proxiedByDevDemoOnPort ? { path: "preact-demo-hmr" } : undefined,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
