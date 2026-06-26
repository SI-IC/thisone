// Resolve the Vue component behind a picked DOM element, plus a best-effort
// CSS-path description of the element itself. Relies on Vue 3 internals
// (`el.__vueParentComponent`, `type.__file`) and degrades to null/anonymous when
// they are absent (element outside the app, production build without `__file`).

import type { ComponentDescriptor, ElementDescriptor } from "../server/types";

export type ResolvedComponent = ComponentDescriptor;

/** Strip directory and extension: `/src/components/Counter.vue` -> `Counter`. */
function baseName(file: string): string {
  const noQuery = file.split(/[?#]/)[0];
  const last = noQuery.split(/[\\/]/).pop() || noQuery;
  return last.replace(/\.\w+$/, "");
}

/** Best name for a Vue ComponentInternalInstance: name -> __name -> file base. */
export function componentName(instance: any): string {
  const type = instance?.type ?? {};
  if (type.name) return String(type.name);
  if (type.__name) return String(type.__name);
  if (type.__file) return baseName(String(type.__file));
  return "Anonymous";
}

export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  const start = (el as any).__vueParentComponent;
  if (!start) return null;

  const chain: string[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    chain.push(componentName(cur));
    const file = cur.type?.__file;
    if (!resolvedName && file) {
      resolvedName = componentName(cur);
      resolvedFile = String(file);
    }
    cur = cur.parent;
  }

  // No `__file` anywhere (e.g. minified prod build) — keep the nearest name.
  if (!resolvedName) {
    resolvedName = chain[0] ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}

/** Stable-ish CSS path using nth-of-type, short-circuiting on the nearest id. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let guard = 0;
  while (cur && cur.nodeType === 1 && guard++ < 1000) {
    if (cur.id) {
      parts.unshift("#" + cur.id);
      break;
    }
    let seg = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === cur!.tagName,
      );
      if (sameTag.length > 1) {
        seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(seg);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

export function describeElement(el: Element): ElementDescriptor {
  return {
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList ?? []),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    selector: cssPath(el),
  };
}
