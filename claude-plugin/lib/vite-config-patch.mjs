const IMPORT_SPEC = "vite-plugin-claude-feedback";
const IMPORT_LINE = `import { claudeFeedback } from "${IMPORT_SPEC}";`;
const CALL = "claudeFeedback()";

function maskCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") {
        out += " ";
        j++;
      }
      i = j;
    } else if (c === "/" && c2 === "*") {
      let j = i + 2;
      out += "  ";
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) {
        out += source[j] === "\n" ? "\n" : " ";
        j++;
      }
      if (j < n) {
        out += "  ";
        j += 2;
      }
      i = j;
    } else if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      out += " ";
      while (j < n && source[j] !== quote) {
        if (source[j] === "\\" && j + 1 < n) {
          out += "  ";
          j += 2;
          continue;
        }
        out += source[j] === "\n" ? "\n" : " ";
        j++;
      }
      if (j < n) {
        out += " ";
        j++;
      }
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findBraceRange(masked, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) return { openIdx: fromIdx, closeIdx: i };
    }
  }
  return null;
}

function findConfigObjectRange(masked) {
  const re = /(defineConfig\s*\(\s*\{|export\s+default\s*\{)/;
  const m = re.exec(masked);
  if (!m) return null;
  return findBraceRange(masked, m.index + m[0].length - 1);
}

function findPluginsArrayRange(masked, searchStart, searchEnd) {
  const keyRe = /plugins\s*:\s*/g;
  keyRe.lastIndex = searchStart;
  let keyMatch;
  while ((keyMatch = keyRe.exec(masked))) {
    if (keyMatch.index >= searchEnd) return null;
    const openIdx = masked.indexOf("[", keyMatch.index + keyMatch[0].length);
    if (openIdx === -1 || openIdx > searchEnd) continue;
    let depth = 0;
    for (let i = openIdx; i < masked.length; i++) {
      if (masked[i] === "[") depth++;
      else if (masked[i] === "]") {
        depth--;
        if (depth === 0) return { openIdx, closeIdx: i };
      }
    }
    return null;
  }
  return null;
}

function isCommonJs(masked) {
  return /\bmodule\.exports\b/.test(masked) && !/^\s*import\b/m.test(masked);
}

function insertImportLine(source) {
  const importRe = /^import .*;\s*$/gm;
  let lastMatch = null;
  let m;
  while ((m = importRe.exec(source))) lastMatch = m;
  if (lastMatch) {
    const at = lastMatch.index + lastMatch[0].length;
    return source.slice(0, at) + "\n" + IMPORT_LINE + source.slice(at);
  }
  return IMPORT_LINE + "\n" + source;
}

export function addPlugin(source) {
  if (source.includes(IMPORT_SPEC)) {
    return { changed: false, result: source };
  }

  const masked = maskCommentsAndStrings(source);

  if (isCommonJs(masked)) {
    return {
      changed: false,
      result: source,
      note: 'CommonJS config (module.exports) is not auto-patchable — add manually: const { claudeFeedback } = require("vite-plugin-claude-feedback"); and claudeFeedback() in plugins[]',
    };
  }

  const configRange = findConfigObjectRange(masked);
  const searchStart = configRange ? configRange.openIdx : 0;
  const searchEnd = configRange ? configRange.closeIdx : masked.length;
  const range = findPluginsArrayRange(masked, searchStart, searchEnd);

  let patched;
  if (range) {
    const inner = source.slice(range.openIdx + 1, range.closeIdx);
    const trimmed = inner.trim();
    let newInner;
    if (trimmed === "") {
      newInner = CALL;
    } else if (inner.includes("\n")) {
      const indentMatch = /\n([ \t]*)\S/.exec(inner);
      const indent = indentMatch ? indentMatch[1] : "  ";
      newInner = `\n${indent}${CALL},` + inner;
    } else {
      newInner = `${CALL}, ${trimmed}`;
    }
    patched =
      source.slice(0, range.openIdx + 1) +
      newInner +
      source.slice(range.closeIdx);
  } else if (configRange) {
    patched =
      source.slice(0, configRange.openIdx + 1) +
      `\n  plugins: [${CALL}],` +
      source.slice(configRange.openIdx + 1);
  } else {
    return {
      changed: false,
      result: source,
      note: "no defineConfig/export default object found",
    };
  }

  return { changed: true, result: insertImportLine(patched) };
}

export function removePlugin(source) {
  if (!source.includes(IMPORT_SPEC)) {
    return { changed: false, result: source };
  }
  let result = source.replace(
    /^import\s*\{\s*claudeFeedback\s*\}\s*from\s*["']vite-plugin-claude-feedback["'];\s*\n?/m,
    "",
  );
  result = result.replace(/[ \t]*\n?[ \t]*claudeFeedback\(\),?[ \t]*/, "");
  return { changed: true, result };
}
