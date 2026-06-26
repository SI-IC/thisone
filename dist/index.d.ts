import type { Plugin } from "vite";
export interface ClaudeFeedbackOptions {
    /** Hotkey code that opens the overlay together with Alt (default 'KeyC'). */
    hotkey?: string;
    /** Size of the rolling console buffer captured in the browser (default 200). */
    consoleBufferSize?: number;
    /** Snapshot request timeout in ms (default 10000). */
    requestTimeoutMs?: number;
}
export declare function claudeFeedback(options?: ClaudeFeedbackOptions): Plugin;
export default claudeFeedback;
