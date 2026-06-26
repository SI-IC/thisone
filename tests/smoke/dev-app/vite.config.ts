import { defineConfig } from "vite";
// Use the built artifact on purpose — the smoke verifies the real dist/ plugin
// (inline of dist/client.js + bridge mount), not the TS source.
import claudeFeedback from "../../../dist/index.js";

export default defineConfig({
  plugins: [claudeFeedback({ hotkey: "KeyC", consoleBufferSize: 100 })],
});
