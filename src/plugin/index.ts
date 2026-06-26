import type { Plugin } from "vite";

export interface ClaudeFeedbackOptions {
  /** Hotkey code that opens the overlay (default 'KeyC' with Alt). */
  hotkey?: string;
  /** Size of the rolling console buffer captured in the browser. */
  consoleBufferSize?: number;
}

/**
 * Vite plugin that injects the Claude feedback overlay into dev pages and mounts
 * the in-process bridge (HTTP + WebSocket). Phase 1 ships a stub so the build
 * pipeline is exercised end-to-end; the real implementation lands in Phase 4.
 */
export function claudeFeedback(_options: ClaudeFeedbackOptions = {}): Plugin {
  return {
    name: "vite-plugin-claude-feedback",
    apply: "serve",
  };
}

export default claudeFeedback;
