import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
const generate: typeof _generate = (_generate as any).default ?? _generate;

const HOC_NAMES = new Set(["memo", "forwardRef"]);

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isHocCallee(node: t.Node): boolean {
  if (t.isIdentifier(node)) return HOC_NAMES.has(node.name);
  if (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object, { name: "React" }) &&
    t.isIdentifier(node.property)
  ) {
    return HOC_NAMES.has(node.property.name);
  }
  return false;
}

function staticsFor(name: string, relFile: string): t.ExpressionStatement[] {
  return [
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier(name), t.identifier("__file")),
        t.stringLiteral(relFile),
      ),
    ),
    t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier(name), t.identifier("__name")),
        t.stringLiteral(name),
      ),
    ),
  ];
}

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

      Program(programPath) {
        const inserts: t.ExpressionStatement[] = [];
        for (const stmt of programPath.node.body) {
          const decl =
            t.isExportNamedDeclaration(stmt) ||
            t.isExportDefaultDeclaration(stmt)
              ? stmt.declaration
              : stmt;
          if (!decl) continue;

          if (
            t.isFunctionDeclaration(decl) &&
            decl.id &&
            isPascalCase(decl.id.name)
          ) {
            inserts.push(...staticsFor(decl.id.name, relFile));
          } else if (
            t.isClassDeclaration(decl) &&
            decl.id &&
            isPascalCase(decl.id.name)
          ) {
            inserts.push(...staticsFor(decl.id.name, relFile));
          } else if (t.isVariableDeclaration(decl)) {
            for (const d of decl.declarations) {
              if (!t.isIdentifier(d.id) || !isPascalCase(d.id.name)) continue;
              if (t.isCallExpression(d.init) && isHocCallee(d.init.callee)) {
                inserts.push(...staticsFor(d.id.name, relFile));
              }
            }
          }
        }
        if (inserts.length > 0) {
          programPath.node.body.push(...inserts);
          changed = true;
        }
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
