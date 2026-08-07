declare global {
  interface Window {
    __THISONE_PREACT_MAP__?: WeakMap<Element, any>;
  }
}

export const PREACT_HOOK_VIRTUAL_ID = "virtual:thisone-preact-hook";
export const PREACT_HOOK_RESOLVED_ID = "\0" + PREACT_HOOK_VIRTUAL_ID;

export const PREACT_HOOK_SOURCE = `
import { options } from "preact";
var map = new WeakMap();
var prevDiffed = options.diffed;
options.diffed = function (vnode) {
  if (vnode && vnode._dom) map.set(vnode._dom, vnode);
  if (prevDiffed) prevDiffed(vnode);
};
window.__THISONE_PREACT_MAP__ = map;
`;
