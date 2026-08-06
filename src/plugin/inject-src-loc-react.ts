import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
const generate: typeof _generate = (_generate as any).default ?? _generate;

export function injectSourceLocations(source: string, relFile: string): string {
  // Не менять, потому что ошибка парсинга должна тихо вернуть исходник, а не уронить dev-сервер.
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return source;
  }

  let changed = false;
  try {
    traverse(ast, {
      JSXElement(path) {
        const opening = path.node.openingElement;
        const name = opening.name;
        if (!t.isJSXIdentifier(name)) return;
        if (!/^[a-z]/.test(name.name)) return;
        const loc = path.node.loc;
        if (!loc) return;
        const value = `${relFile}:${loc.start.line}:${loc.start.column + 1}-${loc.end.line}:${loc.end.column + 1}`;
        opening.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier("data-src-loc"),
            t.jsxExpressionContainer(t.stringLiteral(value)),
          ),
        );
        changed = true;
      },
    });
  } catch {
    return source;
  }

  if (!changed) return source;

  try {
    return generate(ast, {}, source).code;
  } catch {
    return source;
  }
}
