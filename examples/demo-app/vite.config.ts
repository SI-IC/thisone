import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import pickElement from "vite-plugin-pick-element";

export default defineConfig({
  plugins: [vue(), pickElement()],
});
