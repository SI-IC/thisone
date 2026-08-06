# React support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `vite-plugin-pick-element` the same Alt+C picker feature set for React (`.jsx`/`.tsx`) that it already has for Vue — source location on the picked DOM element, and component name/file/ancestor-chain resolution — auto-detected per file, dev-only, without depending on `@vitejs/plugin-react`.

**Architecture:** A self-contained babel-based transform mirrors the existing Vue path 1:1: inject a `data-src-loc` attribute on host JSX elements plus `__file`/`__name` statics on component declarations (including `memo`/`forwardRef`-wrapped ones), then resolve components client-side by walking the React fiber tree (`fiber.return`) the same way the existing code walks `instance.parent` for Vue. `resolveComponent()` becomes a dispatcher between the two, so the overlay/clipboard/screenshot code needs zero changes.

**Tech Stack:** TypeScript, `@babel/parser` + `@babel/traverse` + `@babel/generator` + `@babel/types` (new deps), vitest + happy-dom (unit tests), Playwright (e2e), React 19 (example app only).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-06-react-support-design.md` — read it before starting; this plan implements it verbatim except where a note below says otherwise (two corrections were found during planning and are called out explicitly).
- New deps go in `package.json` **`dependencies`** (not `devDependencies`): `@babel/parser@8.0.4`, `@babel/traverse@8.0.4`, `@babel/generator@8.0.0`, `@babel/types@8.0.4`. **Not** `@babel/core` — confirmed during planning that only `parse`/`traverse`/`generate`/`types` are used, babel's plugin/preset pipeline is never invoked.
- `@babel/traverse` and `@babel/generator`'s default export needs the `_mod.default ?? _mod` fallback pattern when imported (`import _traverse from "@babel/traverse"` yields an object whose callable is at `.default`, not `_traverse` itself) — verified empirically against the pinned versions above, both under plain Node ESM and after esbuild bundling. Use this pattern in every file that imports them.
- Plugin transform stays dev-only: `apply: 'serve'` already gates the whole plugin out of production builds; the `isBuild` check in `transform()` must keep gating the new `.tsx`/`.jsx` branch exactly like the existing `.vue` branch.
- Existing Vue behavior and tests must not change. Any edit to `src/client/resolve-component.ts` must leave every existing exported name (`resolveComponent`, `componentName`, `describeElement`, `formatElementPath`) with the same signature and Vue-path behavior — `tests/unit/resolve-component.test.ts`'s existing tests run unmodified and must stay green throughout.
- Run `pnpm exec tsc --noEmit -p tsconfig.json` after every task that adds/edits a `.ts` file — this repo has no separate lint step, `tsc --noEmit` is the type-check gate (see prior plan `docs/superpowers/plans/2026-08-06-pick-element.md:248`).
- `pnpm build` must succeed and `tests/unit/plugin-transform.test.ts` / `tests/unit/build-externals.test.mjs` (which both require `dist/` artifacts via `beforeAll`) must pass after Task 4.

---

### Task 1: Extract `baseName` into its own module

**Files:**

- Create: `src/client/base-name.ts`
- Modify: `src/client/resolve-component.ts`
- Test: `tests/unit/base-name.test.ts`

**Interfaces:**

- Produces: `export function baseName(file: string): string` — strips directory and extension, e.g. `/src/components/Counter.vue` → `Counter`. Used by both the existing Vue `componentName()` and the new React `reactComponentName()` (Task 5), so it needs its own module to avoid a circular import between `resolve-component.ts` and the new `resolve-component-react.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/base-name.test.ts
import { describe, it, expect } from "vitest";
import { baseName } from "../../src/client/base-name";

describe("baseName", () => {
  it("strips directory and extension", () => {
    expect(baseName("/src/components/Counter.vue")).toBe("Counter");
  });

  it("strips a query string (Vite sub-request id)", () => {
    expect(baseName("/src/Counter.vue?vue&type=script")).toBe("Counter");
  });

  it("strips a hash fragment", () => {
    expect(baseName("/src/Counter.vue#foo")).toBe("Counter");
  });

  it("handles a bare filename with no directory", () => {
    expect(baseName("Counter.tsx")).toBe("Counter");
  });

  it("handles windows-style backslash separators", () => {
    expect(baseName("C:\\proj\\src\\Counter.tsx")).toBe("Counter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/base-name.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/base-name'`

- [ ] **Step 3: Create `base-name.ts` and update `resolve-component.ts` to use it**

```ts
// src/client/base-name.ts
/** Strip directory and extension: `/src/components/Counter.vue` -> `Counter`. */
export function baseName(file: string): string {
  const noQuery = file.split(/[?#]/)[0];
  const last = noQuery.split(/[\\/]/).pop() || noQuery;
  return last.replace(/\.\w+$/, "");
}
```

In `src/client/resolve-component.ts`:

1. Delete the local `function baseName(file: string): string { ... }` definition.
2. Add `import { baseName } from "./base-name";` near the top of the file.

Everything else in `resolve-component.ts` (including `componentName()`, which calls `baseName()`) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/base-name.test.ts tests/unit/resolve-component.test.ts`
Expected: PASS, both files — the existing `resolve-component.test.ts` suite must still be fully green (regression check).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/client/base-name.ts src/client/resolve-component.ts tests/unit/base-name.test.ts
git commit -m "refactor(client): extract baseName into its own module"
```

---

### Task 2: React source-location injection — host elements

**Files:**

- Create: `src/plugin/inject-src-loc-react.ts`
- Test: `tests/unit/inject-src-loc-react.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `export function injectSourceLocations(source: string, relFile: string): string` — same name and signature as the existing Vue one in `src/plugin/inject-src-loc.ts` (different module, so no name clash). Task 4 imports both under aliases.

- [ ] **Step 1: Add babel dependencies**

```bash
pnpm add @babel/parser@8.0.4 @babel/traverse@8.0.4 @babel/generator@8.0.0 @babel/types@8.0.4
```

Verify `package.json`'s `dependencies` block now includes all four (not `devDependencies`).

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/inject-src-loc-react.test.ts
import { describe, it, expect } from "vitest";
import { injectSourceLocations } from "../../src/plugin/inject-src-loc-react";

function srcLocOf(code: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*data-src-loc=\\{"([^"]+)"\\}`);
  const m = re.exec(code);
  if (!m) throw new Error(`no data-src-loc on <${tag}> in: ${code}`);
  return m[1];
}

describe("injectSourceLocations (React)", () => {
  it("injects file:startLine:startCol-endLine:endCol on a host element", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "div")).toBe("/proj/Foo.tsx:2:10-2:23");
  });

  it("injects distinct locations on nested host elements", () => {
    const src =
      `function Foo() {\n` +
      `  return (\n` +
      `    <section>\n` +
      `      <p>x</p>\n` +
      `    </section>\n` +
      `  );\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "section")).toBe("/proj/Foo.tsx:3:5-5:15");
    expect(srcLocOf(out, "p")).toBe("/proj/Foo.tsx:4:7-4:13");
  });

  it("skips a custom component tag but still injects its host children", () => {
    const src = `function App() {\n  return <MyButton><span>x</span></MyButton>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/App.tsx");
    expect(out).not.toMatch(/<MyButton[^>]*data-src-loc/);
    expect(srcLocOf(out, "span")).toBe("/proj/App.tsx:2:20-2:34");
  });

  it("injects on a self-closing host element", () => {
    const src = `function Foo() {\n  return <img src="x.png" />;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(srcLocOf(out, "img")).toBe("/proj/Foo.tsx:2:10-2:29");
  });

  it("returns the source unchanged when there is no JSX (empty)", () => {
    const src = `export const x = 1;\n`;
    expect(injectSourceLocations(src, "/proj/x.tsx")).toBe(src);
  });

  it("returns the source unchanged for garbage input (malformed/hostile)", () => {
    const src = "\0\0not even close to valid tsx <<<>>>";
    expect(injectSourceLocations(src, "/proj/x.tsx")).toBe(src);
  });

  it("safely escapes a hostile file path as a JS string literal", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const hostile = '/tmp/x.tsx" onerror=alert(1)';
    const out = injectSourceLocations(src, hostile);
    expect(out).toContain(
      'data-src-loc={"/tmp/x.tsx\\" onerror=alert(1):2:10-2:23"}',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: FAIL — `Cannot find module '../../src/plugin/inject-src-loc-react'`

- [ ] **Step 4: Implement host-element injection**

```ts
// src/plugin/inject-src-loc-react.ts
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

const traverse: typeof _traverse = (_traverse as any).default ?? _traverse;
const generate: typeof _generate = (_generate as any).default ?? _generate;

export function injectSourceLocations(source: string, relFile: string): string {
  // Do not change, because a parse failure must silently return the source instead of crashing the dev server.
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return source;
  }

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
      },
    });
  } catch {
    return source;
  }

  try {
    return generate(ast, {}, source).code;
  } catch {
    return source;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: PASS, all 7 cases.

- [ ] **Step 6: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add package.json pnpm-lock.yaml src/plugin/inject-src-loc-react.ts tests/unit/inject-src-loc-react.test.ts
git commit -m "feat(plugin): inject data-src-loc on host JSX elements"
```

---

### Task 3: React source-location injection — component statics (`__file`/`__name`, incl. memo/forwardRef)

**Files:**

- Modify: `src/plugin/inject-src-loc-react.ts`
- Modify: `tests/unit/inject-src-loc-react.test.ts`

**Interfaces:**

- No signature change to `injectSourceLocations` — same function, extended behavior.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/inject-src-loc-react.test.ts` (new `describe` block):

```ts
describe("injectSourceLocations (React) — component statics", () => {
  it("attaches __file/__name to a function declaration component", () => {
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).toContain('Foo.__name = "Foo";');
  });

  it("attaches __file/__name to a default-exported function component", () => {
    const src = `export default function App() {\n  return <h1>hi</h1>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/App.tsx");
    expect(out).toContain('App.__file = "/proj/App.tsx";');
    expect(out).toContain('App.__name = "App";');
  });

  it("attaches __file/__name to a named-exported function component", () => {
    const src = `export function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches __file/__name to a class component", () => {
    const src =
      `class Foo extends Component {\n` +
      `  render() {\n` +
      `    return <div>hi</div>;\n` +
      `  }\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).toContain('Foo.__name = "Foo";');
  });

  it("attaches statics to the outer binding of a memo()-wrapped component", () => {
    const src = `const Foo = memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
    expect(out).not.toContain("Inner.__file");
  });

  it("attaches statics to the outer binding of a nested memo(forwardRef(...)) component", () => {
    const src =
      `const Foo = memo(forwardRef((props, ref) => {\n` +
      `  return <div>hi</div>;\n` +
      `}));\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("recognizes React.memo / React.forwardRef qualified callees", () => {
    const src = `const Foo = React.memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("attaches statics to a named export const memo() component", () => {
    const src = `export const Foo = memo(function Inner() {\n  return <div>hi</div>;\n});\n`;
    const out = injectSourceLocations(src, "/proj/Foo.tsx");
    expect(out).toContain('Foo.__file = "/proj/Foo.tsx";');
  });

  it("does not attach statics to a PascalCase constant that isn't a memo/forwardRef call (false-positive avoidance)", () => {
    const src =
      `const Colors = Object.freeze({ a: 1 });\n` +
      `function lower() {\n` +
      `  return <div>hi</div>;\n` +
      `}\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("Colors.__file");
  });

  it("does not attach statics to a lowercase-named function even though it renders JSX", () => {
    const src = `function lower() {\n  return <div>hi</div>;\n}\n`;
    const out = injectSourceLocations(src, "/proj/x.tsx");
    expect(out).not.toContain("lower.__file");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: the 10 new cases FAIL (no statics attached yet); the 7 cases from Task 2 still PASS.

- [ ] **Step 3: Implement component-statics injection**

Replace the full contents of `src/plugin/inject-src-loc-react.ts`:

```ts
// src/plugin/inject-src-loc-react.ts
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
  // Do not change, because a parse failure must silently return the source instead of crashing the dev server.
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return source;
  }

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
        programPath.node.body.push(...inserts);
      },
    });
  } catch {
    return source;
  }

  try {
    return generate(ast, {}, source).code;
  } catch {
    return source;
  }
}
```

Note: `decl` above is typed as `t.Declaration | t.Expression | null | undefined` after unwrapping `ExportDefaultDeclaration` (its `.declaration` can be a bare expression, e.g. `export default memo(Inner)`); the `isFunctionDeclaration`/`isClassDeclaration`/`isVariableDeclaration` guards correctly narrow and skip non-declaration cases (anonymous default-exported expressions get no statics — there's no name to attach them to; see Task 5's note on the `type.type`/`type.render` client-side fallback for that case).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/inject-src-loc-react.test.ts`
Expected: PASS, all 17 cases (7 from Task 2 + 10 new).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/plugin/inject-src-loc-react.ts tests/unit/inject-src-loc-react.test.ts
git commit -m "feat(plugin): attach __file/__name statics to React components"
```

---

### Task 4: Wire `.tsx`/`.jsx` routing into the plugin

**Files:**

- Modify: `src/plugin/index.ts`
- Modify: `tests/unit/plugin-transform.test.ts`

**Interfaces:**

- Consumes: `injectSourceLocations` from both `./inject-src-loc.js` (Vue, existing) and `./inject-src-loc-react.js` (Task 3), imported under distinct local names.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/plugin-transform.test.ts` (new `describe` block; also add the React import at the top alongside the existing Vue one):

```ts
// add near the top, alongside the existing Vue import:
import { injectSourceLocations as injectReactSourceLocations } from "../../src/plugin/inject-src-loc-react";
```

```ts
describe("plugin transform (.tsx/.jsx source location)", () => {
  it("injects data-src-loc into .tsx source in serve mode", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `function Foo() {\n  return <div>hi</div>;\n}\n`;
    const out = callTransform2(plugin, src, "/proj/src/Foo.tsx");
    expect(out).toBe(injectReactSourceLocations(src, "/proj/src/Foo.tsx"));
    expect(out).toContain('data-src-loc={"/proj/src/Foo.tsx:2:10-2:23"}');
  });

  it("injects data-src-loc into .jsx source in serve mode", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "serve");
    const src = `function Foo() {\n  return <span>hi</span>;\n}\n`;
    const out = callTransform2(plugin, src, "/proj/src/Foo.jsx");
    expect(out).toContain('data-src-loc={"/proj/src/Foo.jsx:2:10-2:25"}');
  });

  it("does NOT transform .tsx in build mode (gating)", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "build");
    const src = `function Foo() { return <div>hi</div>; }`;
    expect(callTransform2(plugin, src, "/proj/src/Foo.tsx")).toBeUndefined();
  });

  it("ignores non-.tsx/.jsx/.vue ids", () => {
    const plugin = pickElement() as AnyPlugin;
    callConfig(plugin, "serve");
    expect(
      callTransform2(plugin, "export const x = 1;", "/proj/src/util.ts"),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: the 4 new cases FAIL (`.tsx`/`.jsx` not routed yet); existing `.vue` cases still PASS.

- [ ] **Step 3: Wire routing in `src/plugin/index.ts`**

Change the import line:

```ts
import { injectSourceLocations } from "./inject-src-loc.js";
```

to:

```ts
import { injectSourceLocations as injectVueSourceLocations } from "./inject-src-loc.js";
import { injectSourceLocations as injectReactSourceLocations } from "./inject-src-loc-react.js";
```

Change the `transform` hook body from:

```ts
transform(code: string, id: string) {
  if (isBuild || !id.endsWith(".vue")) return;
  return injectSourceLocations(code, id);
},
```

to:

```ts
transform(code: string, id: string) {
  if (isBuild) return;
  if (id.endsWith(".vue")) return injectVueSourceLocations(code, id);
  if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
    return injectReactSourceLocations(code, id);
  }
  return;
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugin-transform.test.ts`
Expected: PASS, all cases (existing `.vue` ones plus the 4 new `.tsx`/`.jsx` ones).

- [ ] **Step 5: Full unit suite, build, type-check**

```bash
pnpm build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
```

Expected: build succeeds (`dist/{index.js,client.js,index.d.ts}`); no type errors; full unit suite green, including `tests/unit/build-externals.test.mjs` (confirms bundling the new babel deps didn't reintroduce a dynamic-`require` problem the way `@vue/compiler-sfc` had — that test only asserts the Vue externals, but a broken bundle would fail `plugin-transform.test.ts`'s `beforeAll` instead).

- [ ] **Step 6: Commit**

```bash
git add src/plugin/index.ts tests/unit/plugin-transform.test.ts
git commit -m "feat(plugin): route .tsx/.jsx through the React source-location transform"
```

---

### Task 5: React component resolution (fiber walk)

**Files:**

- Create: `src/client/resolve-component-react.ts`
- Test: `tests/unit/resolve-component-react.test.ts`

**Interfaces:**

- Consumes: `baseName` from `./base-name` (Task 1); `type ComponentDescriptor` from `./resolve-component` (type-only import — no runtime circularity, see note below).
- Produces:
  - `export function getReactFiberKey(el: Element): string | undefined`
  - `export function reactComponentName(type: any): string`
  - `export function resolveReactComponent(el: Element | null): ComponentDescriptor | null`

  Task 6 imports `resolveReactComponent` into the dispatcher in `resolve-component.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/resolve-component-react.test.ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  getReactFiberKey,
  reactComponentName,
  resolveReactComponent,
} from "../../src/client/resolve-component-react";

function fiber(type: any, ret: any = null): any {
  return { type, return: ret };
}

describe("getReactFiberKey", () => {
  it("finds a key starting with __reactFiber$", () => {
    const el = document.createElement("div");
    (el as any).__reactFiber$abc123 = {};
    expect(getReactFiberKey(el)).toBe("__reactFiber$abc123");
  });

  it("returns undefined when no such key exists", () => {
    expect(getReactFiberKey(document.createElement("div"))).toBeUndefined();
  });
});

describe("reactComponentName", () => {
  it("prefers displayName over name", () => {
    const type: any = function Foo() {};
    type.displayName = "CustomName";
    expect(reactComponentName(type)).toBe("CustomName");
  });

  it("falls back to the function's own name", () => {
    function Bar() {}
    expect(reactComponentName(Bar)).toBe("Bar");
  });

  it("falls back to __name when name/displayName are absent", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__name = "Baz";
    expect(reactComponentName(type)).toBe("Baz");
  });

  it("derives the name from __file's basename as a last resort", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    type.__file = "/src/components/Widget.tsx";
    expect(reactComponentName(type)).toBe("Widget");
  });

  it("falls back to the inner memo() target's name when the wrapper has none", () => {
    function Inner() {}
    const wrapper: any = { $$typeof: Symbol.for("react.memo"), type: Inner };
    expect(reactComponentName(wrapper)).toBe("Inner");
  });

  it("returns Anonymous when nothing is available", () => {
    const type: any = () => null;
    Object.defineProperty(type, "name", { value: "" });
    expect(reactComponentName(type)).toBe("Anonymous");
  });
});

describe("resolveReactComponent", () => {
  it("resolves name/file/chain by walking fiber.return", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    function Counter() {}
    (Counter as any).__file = "/src/components/Counter.tsx";

    const root = fiber(App);
    const counterFiber = fiber(Counter, root);
    const hostFiber = fiber("button", counterFiber);
    const el = document.createElement("button");
    (el as any).__reactFiber$k1 = hostFiber;

    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/components/Counter.tsx");
    expect(r.chain).toEqual(["Counter", "App"]);
  });

  it("returns null for an element with no react fiber key (outside the React tree)", () => {
    expect(resolveReactComponent(document.createElement("div"))).toBeNull();
  });

  it("returns null for null input (empty)", () => {
    expect(resolveReactComponent(null)).toBeNull();
  });

  it("skips host (string-typed) fibers in the chain", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    const el = document.createElement("span");
    (el as any).__reactFiber$k2 = fiber("span", fiber(Counter));
    const r = resolveReactComponent(el)!;
    expect(r.chain).toEqual(["Counter"]);
  });

  it("includes a memo-wrapped component via its $$typeof tag and reads its statics", () => {
    const memoType: any = {
      $$typeof: Symbol.for("react.memo"),
      displayName: "MemoBadge",
      __file: "/src/MemoBadge.tsx",
    };
    const el = document.createElement("span");
    (el as any).__reactFiber$k3 = fiber(memoType);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("MemoBadge");
    expect(r.file).toBe("/src/MemoBadge.tsx");
  });

  it("includes a forwardRef-wrapped component via its $$typeof tag", () => {
    const fwdType: any = {
      $$typeof: Symbol.for("react.forward_ref"),
      __file: "/src/Input.tsx",
      __name: "Input",
    };
    const el = document.createElement("input");
    (el as any).__reactFiber$k4 = fiber(fwdType);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Input");
    expect(r.file).toBe("/src/Input.tsx");
  });

  it("falls back to the inner target's __file when an anonymous memo() wrapper has none of its own", () => {
    function Inner() {}
    (Inner as any).__file = "/src/Inner.tsx";
    const wrapper: any = { $$typeof: Symbol.for("react.memo"), type: Inner };
    const el = document.createElement("span");
    (el as any).__reactFiber$k9 = fiber(wrapper);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Inner");
    expect(r.file).toBe("/src/Inner.tsx");
  });

  it("excludes non-component symbol-tagged fibers (e.g. a context provider) from the chain", () => {
    function App() {}
    (App as any).__file = "/src/App.tsx";
    const providerType: any = { $$typeof: Symbol.for("react.provider") };
    const el = document.createElement("span");
    (el as any).__reactFiber$k5 = fiber(providerType, fiber(App));
    const r = resolveReactComponent(el)!;
    expect(r.chain).toEqual(["App"]);
  });

  it("falls back to nearest name and file:null when no ancestor has __file", () => {
    function Widget() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$k6 = fiber(Widget);
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBeNull();
    expect(r.chain).toEqual(["Widget"]);
  });

  it("skips ancestors without __file up to the first that has one", () => {
    function Counter() {}
    (Counter as any).__file = "/src/Counter.tsx";
    function Inline() {}
    const el = document.createElement("span");
    (el as any).__reactFiber$k7 = fiber(Inline, fiber(Counter));
    const r = resolveReactComponent(el)!;
    expect(r.name).toBe("Counter");
    expect(r.file).toBe("/src/Counter.tsx");
    expect(r.chain).toEqual(["Inline", "Counter"]);
  });

  it("stops walking after 1000 ancestors (guard against cyclic/pathological fiber chains)", () => {
    let f: any = null;
    for (let i = 0; i < 1005; i++) {
      const Comp = () => null;
      f = fiber(Comp, f);
    }
    const el = document.createElement("span");
    (el as any).__reactFiber$k8 = f;
    const r = resolveReactComponent(el)!;
    expect(r.chain.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component-react.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/resolve-component-react'`

- [ ] **Step 3: Implement `resolve-component-react.ts`**

```ts
// src/client/resolve-component-react.ts
// Resolve the React component behind a picked DOM element by walking the fiber
// tree (`el.__reactFiber$*`, `fiber.return`) — the React-side counterpart to
// resolve-component.ts's Vue instance-tree walk. Degrades to null/Anonymous when
// fiber internals or our own injected `__file`/`__name` statics are absent
// (element outside the app, or a component the plugin's transform never touched).
import { baseName } from "./base-name";
import type { ComponentDescriptor } from "./resolve-component";

const HOC_SYMBOL_TAGS = new Set([
  "Symbol(react.memo)",
  "Symbol(react.forward_ref)",
]);

/** The component a memo()/forwardRef() wrapper delegates to, if any. */
function innerTarget(type: any): any {
  if (type && typeof type === "object") {
    if (type.type) return type.type; // memo(Inner)
    if (type.render) return type.render; // forwardRef((props, ref) => ...)
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

function fileOf(type: any): string | undefined {
  return type?.__file ?? innerTarget(type)?.__file;
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

  const chain: string[] = [];
  let resolvedName: string | null = null;
  let resolvedFile: string | null = null;

  let cur: any = start;
  let guard = 0;
  while (cur && guard++ < 1000) {
    const type = cur.type;
    if (isComponentFiberType(type)) {
      const name = reactComponentName(type);
      chain.push(name);
      const file = fileOf(type);
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = String(file);
      }
    }
    cur = cur.return;
  }

  if (!resolvedName) {
    resolvedName = chain[0] ?? "Anonymous";
    resolvedFile = null;
  }

  return { name: resolvedName, file: resolvedFile, chain };
}
```

`import type { ComponentDescriptor } from "./resolve-component"` is erased at compile time (`verbatimModuleSyntax` in `tsconfig.json` requires the explicit `type` keyword) — `resolve-component.ts` importing `resolveReactComponent` from this file in Task 6 does not create a runtime circular import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component-react.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors. `ComponentDescriptor` is already exported from `resolve-component.ts` in its current (pre-Task-6) state, so this type import resolves immediately — no ordering dependency on Task 6.

```bash
git add src/client/resolve-component-react.ts tests/unit/resolve-component-react.test.ts
git commit -m "feat(client): resolve React components by walking the fiber tree"
```

---

### Task 6: `resolveComponent` dispatcher (Vue ↔ React)

**Files:**

- Modify: `src/client/resolve-component.ts`
- Modify: `tests/unit/resolve-component.test.ts`

**Interfaces:**

- `ComponentDescriptor` (existing `export interface { name: string; file: string | null; chain: string[]; }`) is already exported and untouched by this task — Task 5's type import into it works with no ordering dependency.
- `resolveComponent(el: Element | null): ResolvedComponent | null` keeps its exact existing signature; internal Vue logic is renamed to a private `resolveVueComponent`, called by the new dispatcher body.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/resolve-component.test.ts` (new `describe` block):

```ts
describe("resolveComponent dispatcher", () => {
  it("returns null for an element outside both the Vue and React trees", () => {
    expect(resolveComponent(document.createElement("i"))).toBeNull();
  });

  it("dispatches to the React resolver when a react fiber key is present (no __vueParentComponent)", () => {
    function Widget() {}
    (Widget as any).__file = "/src/Widget.tsx";
    const el = document.createElement("span");
    (el as any).__reactFiber$test1 = { type: Widget, return: null };
    const r = resolveComponent(el)!;
    expect(r.name).toBe("Widget");
    expect(r.file).toBe("/src/Widget.tsx");
  });

  it("prefers the Vue resolver when both markers are present (Vue-marker check comes first)", () => {
    const el = document.createElement("span");
    (el as any).__vueParentComponent = {
      type: { name: "VueWidget" },
      parent: null,
    };
    (el as any).__reactFiber$test2 = {
      type: function ReactWidget() {},
      return: null,
    };
    const r = resolveComponent(el)!;
    expect(r.name).toBe("VueWidget");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: the 3 new cases FAIL (no React dispatch yet — `resolveComponent` currently only understands `__vueParentComponent` and returns `null` for the React-fiber case too, so the first "returns null" case actually already passes; the two dispatch cases fail). All pre-existing tests in this file still PASS untouched.

- [ ] **Step 3: Turn `resolveComponent` into a dispatcher**

In `src/client/resolve-component.ts`:

1. Add the import: `import { resolveReactComponent } from "./resolve-component-react";`
2. Rename the existing `export function resolveComponent(el: Element | null): ResolvedComponent | null { ... }` to `function resolveVueComponent(el: Element | null): ResolvedComponent | null { ... }` (drop `export`, keep the body byte-for-byte identical).
3. Add a new exported dispatcher in its place:

```ts
export function resolveComponent(el: Element | null): ResolvedComponent | null {
  if (!el) return null;
  if ((el as any).__vueParentComponent) return resolveVueComponent(el);
  return resolveReactComponent(el);
}
```

Nothing else in the file changes — `describeElement`, `formatElementPath`, `componentName`, all type exports stay as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/resolve-component.test.ts`
Expected: PASS, all cases — every pre-existing Vue test plus the 3 new dispatcher tests.

- [ ] **Step 5: Full check, type-check, commit**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
```

Expected: no type errors; full unit suite green; build succeeds.

```bash
git add src/client/resolve-component.ts tests/unit/resolve-component.test.ts
git commit -m "feat(client): dispatch resolveComponent between Vue and React resolvers"
```

---

### Task 7: React example app (`examples/demo-app-react`)

**Files:**

- Create: `examples/demo-app-react/package.json`
- Create: `examples/demo-app-react/vite.config.ts`
- Create: `examples/demo-app-react/index.html`
- Create: `examples/demo-app-react/src/main.tsx`
- Create: `examples/demo-app-react/src/App.tsx`
- Create: `examples/demo-app-react/src/Counter.tsx`
- Create: `examples/demo-app-react/src/MemoBadge.tsx`

**Interfaces:**

- Consumes: the root package via `"vite-plugin-pick-element": "link:../.."` (same pattern as `examples/demo-app`, a real filesystem symlink — pnpm's `file:` protocol copies a snapshot instead and would go stale after a root `pnpm build`; see `tests/e2e/README.md`'s existing note on this for the Vue demo app).
- Produces: a running app whose DOM structure Task 8's e2e test drives directly (exact line numbers below are load-bearing for that task's assertions — do not reformat these files afterward without updating Task 8's regexes).

- [ ] **Step 1: Create the example app files**

```json
// examples/demo-app-react/package.json
{
  "name": "pick-element-demo-app-react",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "vite": "8.2.1",
    "vite-plugin-pick-element": "link:../.."
  }
}
```

```ts
// examples/demo-app-react/vite.config.ts
import { defineConfig } from "vite";
import pickElement from "vite-plugin-pick-element";

export default defineConfig({
  plugins: [pickElement()],
});
```

Deliberately no `@vitejs/plugin-react` — this example exists to prove the bare-JSX-setup requirement from the design spec.

```html
<!-- examples/demo-app-react/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>pick-element react demo</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// examples/demo-app-react/src/main.tsx
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("app")!).render(<App />);
```

```tsx
// examples/demo-app-react/src/App.tsx
import Counter from "./Counter";

export default function App() {
  return (
    <main>
      <h1>pick-element react demo</h1>
      <Counter />
    </main>
  );
}
```

```tsx
// examples/demo-app-react/src/Counter.tsx
import { useState } from "react";
import MemoBadge from "./MemoBadge";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>count is {count}</button>
      <MemoBadge label="demo" />
    </div>
  );
}
```

```tsx
// examples/demo-app-react/src/MemoBadge.tsx
import { memo } from "react";

const MemoBadge = memo(function MemoBadge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
});

export default MemoBadge;
```

- [ ] **Step 2: Install and build**

```bash
pnpm build
cd examples/demo-app-react
pnpm install
```

Verify `node_modules/vite-plugin-pick-element` is a symlink (`ls -la node_modules/vite-plugin-pick-element` shows `->` pointing at `../../..`), matching the `link:` protocol requirement noted above.

- [ ] **Step 3: Build-sanity check**

```bash
pnpm build
```

Expected: succeeds, produces `dist/index.html` + `dist/assets/*.js`.

```bash
grep -rl "__pick_element\|data-src-loc" dist || echo "clean (expected)"
```

Expected: `clean (expected)` — the prod build must not contain any trace of the picker (same guarantee as the Vue demo app; confirms `apply: 'serve'` and the `isBuild` gate from Task 4 hold for the React path too).

```bash
rm -rf dist
cd ../..
```

- [ ] **Step 4: Commit**

```bash
git add examples/demo-app-react/package.json examples/demo-app-react/pnpm-lock.yaml \
  examples/demo-app-react/vite.config.ts examples/demo-app-react/index.html \
  examples/demo-app-react/src
git commit -m "test(examples): add a bare Vite+React demo app for the picker"
```

(`examples/demo-app-react/node_modules/` is already covered by the repo-root `.gitignore`'s unanchored `node_modules/` pattern — no new ignore entry needed.)

---

### Task 8: React e2e (Playwright) + harness script

**Files:**

- Create: `tests/e2e/pick-element-react.e2e.mjs`
- Create: `scripts/e2e-react.sh`
- Modify: `tests/e2e/README.md`

**Interfaces:**

- Consumes: `examples/demo-app-react` (Task 7), the built `dist/` (Task 4/6's `pnpm build` output).
- This is the plan's **reproduce-before-done** proof for the whole feature — it is the only step that exercises the real browser + real React runtime end-to-end, which is what the unit tests (mocked fibers, string-diffed transform output) cannot cover.

- [ ] **Step 1: Write `tests/e2e/pick-element-react.e2e.mjs`**

Focused on what's React-specific — panel mechanics (drag, clipboard, screenshot, hotkey) are already fully covered framework-agnostically by `tests/e2e/pick-element.e2e.mjs` against the Vue demo app, so this script does not repeat them.

```js
#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../../examples/demo-app-react");

const port = Number(process.argv[2]);
assert.ok(
  Number.isInteger(port) && port > 0,
  "usage: pick-element-react.e2e.mjs <port>",
);
const base = `http://localhost:${port}`;

const errors = [];
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${label}`))
    .catch((err) => {
      errors.push(`${label}: ${err.message}`);
      console.error(`not ok - ${label}: ${err.message}`);
    });
}

function grepMatches(pattern, dir) {
  try {
    return execFileSync("grep", ["-rl", pattern, dir], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const response = await page.goto(base, { waitUntil: "networkidle" });
  await check("demo responds 200", async () => {
    assert.equal(response.status(), 200);
  });
  await check(
    "no console/page errors on load (bare Vite+React, no @vitejs/plugin-react)",
    async () => {
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);
    },
  );

  const panel = page.locator("#__pick_element_root >> css=.panel");
  const pathEl = page.locator("#__pick_element_root >> css=.path");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyC");
  await page.keyboard.up("Alt");
  await check("panel opens on Alt+C", async () => {
    await panel.waitFor({ state: "visible", timeout: 2000 });
  });

  await page.locator('button:has-text("count is")').click();
  await check(
    "picking a host element inside a function component resolves name + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<button>/);
      assert.match(text ?? "", /Counter/);
      assert.match(text ?? "", /Counter\.tsx:8:\d+-8:\d+/);
    },
  );

  await page.locator("span.badge").click();
  await check(
    "picking a host element inside a memo()-wrapped component resolves the memo's name + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<span>/);
      assert.match(text ?? "", /MemoBadge/);
      assert.match(text ?? "", /MemoBadge\.tsx:4:\d+-4:\d+/);
    },
  );

  await page.locator("h1").click();
  await check(
    "picking a host element inside the default-exported root component resolves App + file:line",
    async () => {
      await pathEl.waitFor({ state: "visible", timeout: 2000 });
      const text = await pathEl.textContent();
      assert.match(text ?? "", /<h1>/);
      assert.match(text ?? "", /App/);
      assert.match(text ?? "", /App\.tsx:6:\d+-6:\d+/);
    },
  );

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 2000 });
} finally {
  await browser.close();
}

await check(
  "prod build does not inject the overlay or any data-src-loc",
  async () => {
    execFileSync(
      "node",
      [resolve(demoDir, "node_modules/vite/bin/vite.js"), "build"],
      { cwd: demoDir, stdio: "pipe" },
    );
    const found = grepMatches(
      "__pick_element\\|data-src-loc",
      resolve(demoDir, "dist"),
    );
    assert.equal(found, "");
    rmSync(resolve(demoDir, "dist"), { recursive: true, force: true });
  },
);

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed`);
  process.exit(1);
}

console.log("e2e ok");
```

- [ ] **Step 2: Write `scripts/e2e-react.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo="$root/examples/demo-app-react"
port="${PICK_ELEMENT_E2E_REACT_PORT:-5184}"

cd "$root"
pnpm build

cd "$demo"
node_modules/.bin/vite --port "$port" --strictPort >/tmp/pick-element-e2e-react-dev.log 2>&1 &
dev_pid=$!

cleanup() {
  kill "$dev_pid" 2>/dev/null || true
  wait "$dev_pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -sf "http://localhost:$port/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "demo dev server did not become ready on port $port" >&2
  cat /tmp/pick-element-e2e-react-dev.log >&2
  exit 1
fi

cd "$root"
node tests/e2e/pick-element-react.e2e.mjs "$port"
```

```bash
chmod +x scripts/e2e-react.sh
```

- [ ] **Step 3: Update `tests/e2e/README.md`**

Add a new section after the existing content:

```markdown
## React harness

`pick-element-react.e2e.mjs` covers what's specific to the React path against a **bare**
Vite+React app (`examples/demo-app-react/`, deliberately without `@vitejs/plugin-react`):
source-location + component-name resolution for a plain function component, a
`memo()`-wrapped component, and the default-exported root component, plus the same prod-build
exclusion check as the Vue harness. Panel mechanics (drag, clipboard, screenshot, hotkey) are
framework-agnostic and already fully covered by `pick-element.e2e.mjs` against the Vue demo
app — this script doesn't repeat them.

Run:
```

bash scripts/e2e-react.sh

```

Same `link:../..` wiring note as the Vue demo app applies to `examples/demo-app-react`.
```

- [ ] **Step 4: Run the e2e suite**

```bash
npx playwright install chromium
```

(first time only, if not already installed — skip if `tests/e2e/pick-element.e2e.mjs` already runs successfully in this environment)

```bash
bash scripts/e2e-react.sh
```

Expected: every `ok - ...` line prints, final line `e2e ok`, exit code 0.

- [ ] **Step 5: Regression-check the existing Vue e2e still passes**

```bash
bash scripts/e2e.sh
```

Expected: `e2e ok` — confirms Task 4's routing change and Task 6's dispatcher didn't regress the Vue path.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pick-element-react.e2e.mjs scripts/e2e-react.sh tests/e2e/README.md
git commit -m "test(e2e): add React picker flow against a bare Vite+React app"
```

---

## Final verification (after Task 8)

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm build
bash scripts/e2e.sh
bash scripts/e2e-react.sh
```

Expected: all five commands succeed. This is the full gate — type-check, unit suite (Vue + React + dispatcher + build-externals), build, and both e2e harnesses green.
