import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [thisone()],
});
