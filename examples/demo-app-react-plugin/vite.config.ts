import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import thisone from "vite-plugin-thisone";

export default defineConfig({
  plugins: [react(), thisone()],
});
