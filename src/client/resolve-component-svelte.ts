import { baseName } from "./base-name";
import type { ChainEntry, ComponentDescriptor } from "./resolve-component";

interface SvelteDevStackEntry {
  type: string;
  file: string;
  componentTag?: string;
  parent: SvelteDevStackEntry | null;
}

interface SvelteMeta {
  loc: { file: string; line: number; column: number };
  parent: SvelteDevStackEntry | null;
}

declare global {
  interface Element {
    __svelte_meta?: SvelteMeta;
  }
}

export function resolveSvelteComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const meta = el.__svelte_meta;
  if (!meta) return null;

  const chain: ChainEntry[] = [];
  let childFile = meta.loc.file;

  let cur = meta.parent;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.type === "component") {
      const name = cur.componentTag ?? baseName(childFile);
      chain.push({ name, file: childFile });
      childFile = cur.file;
    }
    cur = cur.parent;
  }
  chain.push({ name: baseName(childFile), file: childFile });

  return { name: chain[0].name, file: chain[0].file, chain };
}
