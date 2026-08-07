import { parse } from "svelte/compiler";
import { escapeAttr } from "./escape-attr.js";

interface Insertion {
  offset: number;
  text: string;
}

interface SvelteNode {
  type: string;
  start: number;
  end: number;
  name?: string;
  fragment?: { nodes: SvelteNode[] };
  consequent?: { nodes: SvelteNode[] };
  alternate?: { nodes: SvelteNode[] } | null;
  body?: { nodes: SvelteNode[] };
  fallback?: { nodes: SvelteNode[] } | null;
  pending?: { nodes: SvelteNode[] } | null;
  then?: { nodes: SvelteNode[] } | null;
  catch?: { nodes: SvelteNode[] } | null;
}

function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function collectInsertions(
  nodes: SvelteNode[],
  source: string,
  file: string,
  out: Insertion[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "RegularElement": {
        const start = offsetToLineColumn(source, node.start);
        const end = offsetToLineColumn(source, node.end);
        const value = `${escapeAttr(file)}:${start.line}:${start.column}-${end.line}:${end.column}`;
        out.push({
          offset: node.start + 1 + (node.name?.length ?? 0),
          text: ` data-src-loc="${value}"`,
        });
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      }
      case "IfBlock":
        if (node.consequent)
          collectInsertions(node.consequent.nodes, source, file, out);
        if (node.alternate)
          collectInsertions(node.alternate.nodes, source, file, out);
        break;
      case "EachBlock":
        if (node.body) collectInsertions(node.body.nodes, source, file, out);
        if (node.fallback)
          collectInsertions(node.fallback.nodes, source, file, out);
        break;
      case "AwaitBlock":
        if (node.pending)
          collectInsertions(node.pending.nodes, source, file, out);
        if (node.then) collectInsertions(node.then.nodes, source, file, out);
        if (node.catch) collectInsertions(node.catch.nodes, source, file, out);
        break;
      case "KeyBlock":
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      case "SnippetBlock":
        if (node.body) collectInsertions(node.body.nodes, source, file, out);
        break;
      case "Component":
      case "SvelteComponent":
      case "SvelteSelf":
      case "SvelteElement":
      case "SlotElement":
      case "SvelteBoundary":
      case "SvelteWindow":
      case "SvelteBody":
      case "SvelteHead":
        if (node.fragment)
          collectInsertions(node.fragment.nodes, source, file, out);
        break;
      default:
        break;
    }
  }
}

export function injectSourceLocations(source: string, file: string): string {
  // Do not change, because a parse failure must silently return the source instead of crashing the dev server.
  let ast;
  try {
    ast = parse(source, { filename: file, modern: true }) as unknown as {
      fragment?: { nodes: SvelteNode[] };
    };
  } catch {
    return source;
  }
  if (!ast?.fragment?.nodes) return source;

  const insertions: Insertion[] = [];
  try {
    collectInsertions(ast.fragment.nodes, source, file, insertions);
  } catch {
    return source;
  }
  if (insertions.length === 0) return source;

  insertions.sort((a, b) => a.offset - b.offset);
  const parts: string[] = [];
  let cursor = 0;
  for (const ins of insertions) {
    parts.push(source.slice(cursor, ins.offset), ins.text);
    cursor = ins.offset;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
