import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_REACT_PORT ?? 5185);
const proxiedByDevDemoOnPort = process.env.THISONE_DEMO_PORT
  ? Number(process.env.THISONE_DEMO_PORT)
  : undefined;

export default defineConfig({
  plugins: [thisone()],
  base: proxiedByDevDemoOnPort ? "/react-demo/" : "/",
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: proxiedByDevDemoOnPort
      ? { clientPort: proxiedByDevDemoOnPort, path: "react-demo-hmr" }
      : undefined,
  },
});
