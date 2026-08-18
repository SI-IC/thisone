// Resolve the Vue component behind a picked DOM element, plus a best-effort
// CSS-path description of the element itself. Relies on Vue 3 internals
// (`el.__vueParentComponent`, `type.__file`) and degrades to null/anonymous when
// they are absent (element outside the app, production build without `__file`).

import { baseName } from "./base-name";
import { resolveReactComponent } from "./resolve-component-react";
import { resolvePreactComponent } from "./resolve-component-preact";
import { resolveSvelteComponent } from "./resolve-component-svelte";

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

export interface ChainEntry {
  name: string;
  file: string | null;
}

export interface ComponentDescriptor {
  name: string;
  file: string | null;
  chain: ChainEntry[];
}

export type ResolvedComponent = ComponentDescriptor;

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
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  const react = resolveReactComponent(el);
  if (react) return react;
  const preact = resolvePreactComponent(el);
  if (preact) return preact;
  return resolveSvelteComponent(el);
}

function resolveVueComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  const start = (el as any).__vueParentComponent;
  if (!start) return null;

  const chain: ChainEntry[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const name = componentName(cur);
    const file = cur.type?.__file ? String(cur.type.__file) : null;
    chain.push({ name, file });
    if (!resolvedName && file) {
      resolvedName = name;
      resolvedFile = file;
    }
    cur = cur.parent;
  }

  // No `__file` anywhere (e.g. minified prod build) — keep the nearest name.
  if (!resolvedName) {
    resolvedName = chain[0]?.name ?? "Anonymous";
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
function formatSourceLoc(l: SourceLocation): string {
  return `${l.file}:${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
}

export function formatElementPath(el: Element): string {
  const d = describeElement(el);
  const c = resolveComponent(el);
  const tag = `<${d.tag}>`;
  if (!c) return `${tag} · ${d.selector}`;
  if (d.sourceLoc) {
    return `${tag} · ${c.name} · ${formatSourceLoc(d.sourceLoc)}`;
  }
  return c.file ? `${tag} · ${c.name} (${c.file})` : `${tag} · ${c.name}`;
}

function namesBackedByMultipleFiles(entries: ChainEntry[]): Set<string> {
  const filesByName = new Map<string, Set<string | null>>();
  for (const entry of entries) {
    const files = filesByName.get(entry.name) ?? new Set<string | null>();
    files.add(entry.file);
    filesByName.set(entry.name, files);
  }
  const ambiguous = new Set<string>();
  for (const [name, files] of filesByName) {
    if (files.size > 1) ambiguous.add(name);
  }
  return ambiguous;
}

function chainLabels(entries: ChainEntry[]): string[] {
  const ambiguous = namesBackedByMultipleFiles(entries);
  const labels: string[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    let count = 1;
    while (
      i + count < entries.length &&
      entries[i + count].name === entry.name &&
      entries[i + count].file === entry.file
    ) {
      count++;
    }
    const name = count > 1 ? `${entry.name} ×${count}` : entry.name;
    labels.push(
      ambiguous.has(entry.name) && entry.file
        ? `${name} (${entry.file})`
        : name,
    );
    i += count;
  }
  return labels;
}

/**
 * Formats the picked element as an edit target followed by its component chain:
 * `<tag> · file:startLine:startCol-endLine:endCol · in Root › ... › Leaf`.
 * The target file leads so the agent never has to guess which of the chain's
 * components to edit; the chain carries names only (no paths) as context.
 * Degrades to the component file without line numbers when `data-src-loc` is
 * absent, drops the file section when nothing resolves one, and falls back to
 * the same CSS-selector format as `formatElementPath` when no component resolves.
 * For slotted markup the target is the `data-src-loc` file (where the markup is
 * authored), which may differ from the nearest component's file in the chain.
 * Consecutive identical ancestors (recursive components) collapse into `Name ×N`.
 * Chain entries carry their file only when the same name is backed by more than
 * one file in the chain.
 * @param el - DOM element to format
 * @returns target-first path text with a root-to-leaf chain
 */
export function formatElementPathFromRoot(el: Element): string {
  const d = describeElement(el);
  const c = resolveComponent(el);
  const tag = `<${d.tag}>`;
  if (!c) return `${tag} · ${d.selector}`;

  const entries: ChainEntry[] =
    c.chain.length > 0 ? c.chain : [{ name: c.name, file: c.file }];
  const chain = chainLabels([...entries].reverse()).join(" › ");

  const target = d.sourceLoc ? formatSourceLoc(d.sourceLoc) : c.file;

  return target ? `${tag} · ${target} · in ${chain}` : `${tag} · in ${chain}`;
}
