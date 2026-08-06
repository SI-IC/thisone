// src/plugin/index.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/plugin/inject-src-loc.ts
import { parse } from "@vue/compiler-sfc";
import {
  NodeTypes,
  ElementTypes
} from "@vue/compiler-core";
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function collectInsertions(nodes, file, out) {
  for (const node of nodes) {
    switch (node.type) {
      case NodeTypes.ELEMENT: {
        if (node.tagType === ElementTypes.ELEMENT) {
          const { start, end } = node.loc;
          const value = `${escapeAttr(file)}:${start.line}:${start.column}-${end.line}:${end.column}`;
          out.push({
            offset: start.offset + 1 + node.tag.length,
            text: ` data-src-loc="${value}"`
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
function injectSourceLocations(source, file) {
  let ast;
  try {
    ast = parse(source, { filename: file }).descriptor.template?.ast;
  } catch {
    return source;
  }
  if (!ast) return source;
  const insertions = [];
  try {
    collectInsertions(ast.children, file, insertions);
  } catch {
    return source;
  }
  if (insertions.length === 0) return source;
  insertions.sort((a, b) => a.offset - b.offset);
  const parts = [];
  let cursor = 0;
  for (const ins of insertions) {
    parts.push(source.slice(cursor, ins.offset), ins.text);
    cursor = ins.offset;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

// src/plugin/index.ts
var here = dirname(fileURLToPath(import.meta.url));
function loadClientBundle() {
  const candidates = [
    resolve(here, "client.js"),
    resolve(here, "../../dist/client.js")
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf8");
  }
  throw new Error(
    "[pick-element] dist/client.js not found \u2014 run `pnpm build` first."
  );
}
function pickElement(options = {}) {
  const hotkey = options.hotkey ?? "KeyC";
  const cfgJson = JSON.stringify({ hotkey });
  let isBuild = false;
  return {
    name: "vite-plugin-pick-element",
    apply: "serve",
    enforce: "pre",
    config(_config, env) {
      isBuild = env.command === "build";
    },
    transform(code, id) {
      if (isBuild || !id.endsWith(".vue")) return;
      return injectSourceLocations(code, id);
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (isBuild) return html;
        const client = loadClientBundle();
        return {
          html,
          tags: [
            {
              tag: "script",
              injectTo: "body",
              children: `window.__PICK_ELEMENT_CFG__=${cfgJson};
${client}`
            }
          ]
        };
      }
    }
  };
}
var index_default = pickElement;
export {
  index_default as default,
  pickElement
};
