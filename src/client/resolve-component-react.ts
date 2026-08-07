import { baseName } from "./base-name";
import type { ChainEntry, ComponentDescriptor } from "./resolve-component";

const HOC_SYMBOL_TAGS = new Set([
  "Symbol(react.memo)",
  "Symbol(react.forward_ref)",
]);

function innerTarget(type: any): any {
  if (type && typeof type === "object") {
    if (type.type) return type.type;
    if (type.render) return type.render;
  }
  return undefined;
}

function isComponentFiberType(type: any): boolean {
  if (typeof type === "function") return true;
  if (type && typeof type === "object" && typeof type.$$typeof === "symbol") {
    return HOC_SYMBOL_TAGS.has(type.$$typeof.toString());
  }
  return false;
}

export function reactComponentName(type: any): string {
  if (type?.displayName) return String(type.displayName);
  if (type?.name) return String(type.name);
  if (type?.__name) return String(type.__name);
  if (type?.__file) return baseName(String(type.__file));
  const inner = innerTarget(type);
  if (inner) return reactComponentName(inner);
  return "Anonymous";
}

function fileOf(type: any, elementType?: any): string | undefined {
  return (
    type?.__file ??
    innerTarget(type)?.__file ??
    elementType?.__file ??
    innerTarget(elementType)?.__file
  );
}

export function getReactFiberKey(el: Element): string | undefined {
  return Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
}

export function resolveReactComponent(
  el: Element | null,
): ComponentDescriptor | null {
  if (!el) return null;
  const key = getReactFiberKey(el);
  if (!key) return null;
  const start = (el as any)[key];
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const type = cur.type;
    if (isComponentFiberType(type)) {
      const name = reactComponentName(type);
      const rawFile = fileOf(type, cur.elementType);
      const file = rawFile ? String(rawFile) : null;
      chain.push({ name, file });
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = file;
      }
    }
    cur = cur.return;
  }

  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
