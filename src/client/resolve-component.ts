// Resolve the Vue component behind a picked DOM element, plus a best-effort
// CSS-path description of the element itself. Relies on Vue 3 internals
// (`el.__vueParentComponent`, `type.__file`) and degrades to null/anonymous when
// they are absent (element outside the app, production build without `__file`).

export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ElementDescriptor {
  tag: string;
  classes: string[];
  text: string;
  selector: string;
  sourceLoc: SourceLocation | null;
}

export interface ComponentDescriptor {
  name: string;
  file: string | null;
  chain: string[];
}

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

const SRC_LOC_RE = /^(.+):(\d+):(\d+)-(\d+):(\d+)$/;

function parseSourceLoc(raw: string | null): SourceLocation | null {
  if (!raw) return null;
  const m = SRC_LOC_RE.exec(raw);
  if (!m) return null;
  return {
    file: m[1],
    startLine: Number(m[2]),
    startColumn: Number(m[3]),
    endLine: Number(m[4]),
    endColumn: Number(m[5]),
  };
}

export function describeElement(el: Element): ElementDescriptor {
  return {
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList ?? []),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    selector: cssPath(el),
    sourceLoc: parseSourceLoc(el.getAttribute("data-src-loc")),
  };
}

/**
 * Formats element to `<tag> · ComponentName · file:startLine:startCol-endLine:endCol`.
 * @param el - DOM element to format
 * @returns formatted path text, degrades gracefully when sourceLoc or component is unavailable
 */
export function formatElementPath(el: Element): string {
  const d = describeElement(el);
  const c = resolveComponent(el);
  const tag = `<${d.tag}>`;
  if (!c) return `${tag} · ${d.selector}`;
  if (d.sourceLoc) {
    const l = d.sourceLoc;
    return `${tag} · ${c.name} · ${l.file}:${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
  }
  return c.file ? `${tag} · ${c.name} (${c.file})` : `${tag} · ${c.name}`;
}
