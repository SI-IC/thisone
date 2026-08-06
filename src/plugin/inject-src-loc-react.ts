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

interface ReactAliases {
  hocLocalNames: Map<string, string>;
  namespaceLocalNames: Set<string>;
}

function collectReactAliases(programNode: t.Program): ReactAliases {
  const hocLocalNames = new Map<string, string>();
  const namespaceLocalNames = new Set<string>();
  for (const stmt of programNode.body) {
    if (!t.isImportDeclaration(stmt) || stmt.source.value !== "react") {
      continue;
    }
    for (const spec of stmt.specifiers) {
      if (t.isImportSpecifier(spec)) {
        const imported = t.isIdentifier(spec.imported)
          ? spec.imported.name
          : spec.imported.value;
        if (HOC_NAMES.has(imported)) {
          hocLocalNames.set(spec.local.name, imported);
        }
      } else if (t.isImportNamespaceSpecifier(spec)) {
        namespaceLocalNames.add(spec.local.name);
      }
    }
  }
  return { hocLocalNames, namespaceLocalNames };
}

function isHocCallee(node: t.Node, aliases: ReactAliases): boolean {
  if (t.isIdentifier(node)) {
    return HOC_NAMES.has(node.name) || aliases.hocLocalNames.has(node.name);
  }
  if (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object) &&
    t.isIdentifier(node.property) &&
    (node.object.name === "React" ||
      aliases.namespaceLocalNames.has(node.object.name))
  ) {
    return HOC_NAMES.has(node.property.name);
  }
  return false;
}

function containsJSX(path: import("@babel/traverse").NodePath): boolean {
  let found = false;
  path.traverse({
    "JSXElement|JSXFragment"(p: import("@babel/traverse").NodePath) {
      found = true;
      p.stop();
    },
  });
  return found;
}

function looksLikeHocFactoryName(name: string): boolean {
  return name.startsWith("with");
}

function isGenericHocCallWrappingComponent(
  callPath: import("@babel/traverse").NodePath<t.CallExpression>,
): boolean {
  const callee = callPath.node.callee;
  const calleeIsPlausibleHoc =
    t.isCallExpression(callee) ||
    (t.isIdentifier(callee) && looksLikeHocFactoryName(callee.name));
  if (!calleeIsPlausibleHoc) return false;
  return callPath.get("arguments").some((argPath) => {
    const arg = argPath.node;
    if (t.isIdentifier(arg) && isPascalCase(arg.name)) return true;
    if (
      (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) &&
      containsJSX(argPath as import("@babel/traverse").NodePath)
    ) {
      return true;
    }
    return false;
  });
}

function staticsFor(name: string, relFile: string): t.Statement[] {
  return [
    t.tryStatement(
      t.blockStatement([
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
      ]),
      t.catchClause(null, t.blockStatement([])),
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
        const aliases = collectReactAliases(programPath.node);
        const inserts: t.Statement[] = [];
        for (const stmtPath of programPath.get("body")) {
          const declPath =
            stmtPath.isExportNamedDeclaration() ||
            stmtPath.isExportDefaultDeclaration()
              ? stmtPath.get("declaration")
              : stmtPath;
          if (Array.isArray(declPath) || !declPath.node) continue;

          if (
            declPath.isFunctionDeclaration() &&
            declPath.node.id &&
            isPascalCase(declPath.node.id.name)
          ) {
            inserts.push(...staticsFor(declPath.node.id.name, relFile));
          } else if (
            declPath.isClassDeclaration() &&
            declPath.node.id &&
            isPascalCase(declPath.node.id.name)
          ) {
            inserts.push(...staticsFor(declPath.node.id.name, relFile));
          } else if (declPath.isVariableDeclaration()) {
            for (const dPath of declPath.get("declarations")) {
              const idNode = dPath.node.id;
              if (!t.isIdentifier(idNode) || !isPascalCase(idNode.name)) {
                continue;
              }
              const initPath = dPath.get("init");
              if (Array.isArray(initPath) || !initPath.node) continue;

              const isComponent =
                (initPath.isCallExpression() &&
                  (isHocCallee(initPath.node.callee, aliases) ||
                    isGenericHocCallWrappingComponent(initPath))) ||
                ((initPath.isArrowFunctionExpression() ||
                  initPath.isFunctionExpression()) &&
                  containsJSX(initPath));

              if (isComponent) {
                inserts.push(...staticsFor(idNode.name, relFile));
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
