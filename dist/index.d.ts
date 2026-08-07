import type { Plugin } from "vite";
export interface ThisoneOptions {
    hotkey?: string;
}
export declare function thisone(options?: ThisoneOptions): Plugin;
export default thisone;
