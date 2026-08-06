import { parse } from "@vue/compiler-sfc";
import {
  NodeTypes,
  ElementTypes,
  type TemplateChildNode,
} from "@vue/compiler-core";

interface Insertion {
  offset: number;
  text: string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function collectInsertions(
  nodes: TemplateChildNode[],
  file: string,
  out: Insertion[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case NodeTypes.ELEMENT: {
        if (node.tagType === ElementTypes.ELEMENT) {
          const { start, end } = node.loc;
          const value = `${escapeAttr(file)}:${start.line}:${start.column}-${end.line}:${end.column}`;
          out.push({
            offset: start.offset + 1 + node.tag.length,
            text: ` data-src-loc="${value}"`,
          });
        }
        collectInsertions(node.children, file, out);
        break;
      }
      case NodeTypes.IF:
        for (const branch of node.branches) {
          collectInsertions(branch.children, file, out);
        }
        break;
      case NodeTypes.FOR:
        collectInsertions(node.children, file, out);
        break;
      default:
        break;
    }
  }
}

export function injectSourceLocations(source: string, file: string): string {
  // Не менять, потому что сбой парсинга должен молча вернуть исходник, а не уронить dev-сервер.
  let ast;
  try {
    ast = parse(source, { filename: file }).descriptor.template?.ast;
  } catch {
    return source;
  }
  if (!ast) return source;

  const insertions: Insertion[] = [];
  try {
    collectInsertions(ast.children, file, insertions);
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
