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

function collectInsertions(
  nodes: TemplateChildNode[],
  file: string,
  out: Insertion[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case NodeTypes.ELEMENT: {
        if (node.tagType !== ElementTypes.TEMPLATE) {
          const { start, end } = node.loc;
          const value = `${file}:${start.line}:${start.column}-${end.line}:${end.column}`;
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

  insertions.sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const ins of insertions) {
    result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
  }
  return result;
}
