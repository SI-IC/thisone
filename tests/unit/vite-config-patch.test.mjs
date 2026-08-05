import { describe, it, expect } from "vitest";
import {
  addPlugin,
  removePlugin,
} from "../../claude-plugin/lib/vite-config-patch.mjs";

const SINGLE_LINE = `import vue from '@vitejs/plugin-vue';\nexport default defineConfig({plugins:[vue()]})\n`;

const MULTILINE = `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({\n  plugins: [\n    vue(),\n  ],\n});\n`;

const EMPTY_PLUGINS = `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [],\n});\n`;

const NO_PLUGINS_KEY = `import { defineConfig } from 'vite';\n\nexport default defineConfig({});\n`;

const COMMENT_BEFORE_REAL_ARRAY = `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\n// note: plugins: consider adding legacy() later\nexport default defineConfig({\n  resolve: { alias: ['@', 'src'] },\n  plugins: [vue()],\n});\n`;

const CJS_CONFIG = `const { defineConfig } = require('vite');\nconst vue = require('@vitejs/plugin-vue');\n\nmodule.exports = defineConfig({\n  plugins: [vue()],\n});\n`;

describe("addPlugin", () => {
  it("inserts the import and claudeFeedback() into a single-line array", () => {
    const { changed, result } = addPlugin(SINGLE_LINE);
    expect(changed).toBe(true);
    expect(result).toContain(
      'import { claudeFeedback } from "vite-plugin-claude-feedback";',
    );
    expect(result).toMatch(/plugins:\[claudeFeedback\(\), vue\(\)\]/);
  });

  it("is idempotent on a second call", () => {
    const first = addPlugin(SINGLE_LINE);
    const second = addPlugin(first.result);
    expect(second.changed).toBe(false);
    expect(second.result).toBe(first.result);
  });

  it("inserts into a multiline plugins array", () => {
    const { changed, result } = addPlugin(MULTILINE);
    expect(changed).toBe(true);
    expect(result).toContain("claudeFeedback()");
    expect(result).toContain("vue()");
    expect(result).toContain(
      'import { claudeFeedback } from "vite-plugin-claude-feedback";',
    );
  });

  it("handles an empty plugins array", () => {
    const { changed, result } = addPlugin(EMPTY_PLUGINS);
    expect(changed).toBe(true);
    expect(result).toMatch(/plugins:\s*\[claudeFeedback\(\)\]/);
  });

  it("adds a plugins key when none exists", () => {
    const { changed, result } = addPlugin(NO_PLUGINS_KEY);
    expect(changed).toBe(true);
    expect(result).toMatch(/plugins:\s*\[claudeFeedback\(\)\],/);
  });

  it("fails gracefully on unrecognized structure", () => {
    const weird = "const cfg = 42;\n";
    const { changed, note } = addPlugin(weird);
    expect(changed).toBe(false);
    expect(note).toBeTruthy();
  });

  it("does not hijack an unrelated array before a comment containing 'plugins:'", () => {
    const { changed, result } = addPlugin(COMMENT_BEFORE_REAL_ARRAY);
    expect(changed).toBe(true);
    expect(result).toMatch(/resolve:\s*\{\s*alias:\s*\['@',\s*'src'\]\s*\}/);
    expect(result).toMatch(/plugins:\s*\[claudeFeedback\(\),\s*vue\(\)\]/);
  });

  it("bails gracefully on a CommonJS config instead of injecting a broken import", () => {
    const { changed, result, note } = addPlugin(CJS_CONFIG);
    expect(changed).toBe(false);
    expect(result).toBe(CJS_CONFIG);
    expect(note).toMatch(/CommonJS/);
  });
});

describe("removePlugin", () => {
  it("removes both insertions from a single-line array", () => {
    const patched = addPlugin(SINGLE_LINE).result;
    const { changed, result } = removePlugin(patched);
    expect(changed).toBe(true);
    expect(result).not.toContain("claudeFeedback");
    expect(result).toMatch(/plugins:\[vue\(\)\]/);
  });

  it("removes both insertions from a multiline array", () => {
    const patched = addPlugin(MULTILINE).result;
    const { changed, result } = removePlugin(patched);
    expect(changed).toBe(true);
    expect(result).not.toContain("claudeFeedback");
    expect(result).toContain("vue()");
  });

  it("is idempotent when nothing to remove", () => {
    const { changed, result } = removePlugin(SINGLE_LINE);
    expect(changed).toBe(false);
    expect(result).toBe(SINGLE_LINE);
  });
});
