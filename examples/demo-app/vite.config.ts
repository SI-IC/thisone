import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

const port = Number(process.env.THISONE_DEMO_PORT ?? 3000);
const reactPort = Number(process.env.THISONE_DEMO_REACT_PORT ?? 5185);
const reactTarget = `http://127.0.0.1:${reactPort}`;

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
    },
  },
});
