import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_SVELTE_PORT ?? 5188);
const proxiedByDevDemoOnPort = process.env.THISONE_DEMO_PORT
  ? Number(process.env.THISONE_DEMO_PORT)
  : undefined;

export default defineConfig({
  plugins: [svelte(), thisone()],
  base: proxiedByDevDemoOnPort ? "/svelte-demo/" : "/",
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: proxiedByDevDemoOnPort
      ? { clientPort: proxiedByDevDemoOnPort, path: "svelte-demo-hmr" }
      : undefined,
  },
});
