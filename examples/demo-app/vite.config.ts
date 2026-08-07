import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_PORT ?? 3000);
const reactPort = Number(process.env.THISONE_DEMO_REACT_PORT ?? 5185);
const reactTarget = `http://127.0.0.1:${reactPort}`;
const preactPort = Number(process.env.THISONE_DEMO_PREACT_PORT ?? 5186);
const preactTarget = `http://127.0.0.1:${preactPort}`;

export default defineConfig({
  plugins: [vue(), thisone()],
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: ["vue-pick-problem-skill.e.conveyor.echelon.business"],
    proxy: {
      "/react-demo": {
        target: reactTarget,
        changeOrigin: true,
        ws: true,
      },
      "/preact-demo": {
        target: preactTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
