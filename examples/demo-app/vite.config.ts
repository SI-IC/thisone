import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import claudeFeedback from "vite-plugin-claude-feedback";

export default defineConfig({
  plugins: [vue(), claudeFeedback()],
});
