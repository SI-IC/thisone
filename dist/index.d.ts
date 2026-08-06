import type { Plugin } from "vite";
export interface PickElementOptions {
    hotkey?: string;
}
export declare function pickElement(options?: PickElementOptions): Plugin;
export default pickElement;
