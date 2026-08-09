export interface ThisoneOptions {
    hotkey?: string;
}
export declare function loadClientBundle(): string;
export declare function detectPreact(root: string): boolean;
export interface InjectionTag {
    tag: string;
    attrs?: Record<string, string>;
    injectTo: "body" | "head-prepend";
    children: string;
}
export declare function buildInjectionTags(hotkey: string, hasPreact: boolean): InjectionTag[];
export declare const thisonePlugin: import("unplugin").UnpluginInstance<ThisoneOptions | undefined, boolean>;
