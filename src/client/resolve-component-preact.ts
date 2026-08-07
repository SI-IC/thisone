import { baseName } from "./base-name";
import type { ChainEntry, ComponentDescriptor } from "./resolve-component";

export function preactComponentName(type: any): string {
  if (type?.__name) return String(type.__name);
  if (type?.displayName) return String(type.displayName);
  if (type?.name) return String(type.name);
  if (type?.__file) return baseName(String(type.__file));
  return "Anonymous";
}

function isComponentVnodeType(type: any): boolean {
  if (typeof type !== "function") return false;
  return type !== window.__THISONE_PREACT_FRAGMENT__;
}

export function resolvePreactComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const map = window.__THISONE_PREACT_MAP__;
  if (!map) return null;
  const start = map.get(el);
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const type = cur.type;
    if (isComponentVnodeType(type)) {
      const name = preactComponentName(type);
      const file = type?.__file ? String(type.__file) : null;
      chain.push({ name, file });
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = file;
      }
    }
    cur = cur.__;
  }

  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
