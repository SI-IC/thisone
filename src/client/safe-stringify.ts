// JSON-safe serializer for store/component snapshots and console arguments.
// Walks an arbitrary value into a structure that JSON.stringify can never choke
// on: cycles, over-deep nesting, runaway breadth, functions, symbols, DOM nodes
// and oversized strings are all collapsed to short placeholders. Sibling shared
// references are NOT flagged as cyclic — only a true ancestor reappearance is
// `[Circular]` — so a global node budget (not just depth) bounds DAG blow-up.

export interface SafeStringifyOpts {
  /** Max object/array nesting before children collapse to `[MaxDepth]`. */
  maxDepth?: number;
  /** Max string length before truncation with an ellipsis. */
  maxLen?: number;
  /** Hard cap on total nodes walked — bounds wide/DAG-shaped DoS input. */
  maxNodes?: number;
}

function isDomNode(v: any): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.nodeType === "number" &&
    typeof v.nodeName === "string"
  );
}

function isPrimitiveKey(k: unknown): boolean {
  const t = typeof k;
  return t === "string" || t === "number" || t === "boolean" || t === "bigint";
}

export function safeStringify(value: any, opts: SafeStringifyOpts = {}): any {
  const maxDepth = opts.maxDepth ?? 6;
  const maxLen = opts.maxLen ?? 5000;
  let budget = opts.maxNodes ?? 50000;
  // Ancestor set for cycle detection — added on entry, removed on exit, so two
  // siblings pointing at the same object are not mistaken for a cycle. A Set
  // keeps membership O(1) instead of O(depth) per node.
  const ancestors = new Set<any>();

  function walk(v: any, depth: number): any {
    if (--budget < 0) return "[Truncated]";

    if (v === null) return null;
    const t = typeof v;
    if (t === "undefined") return "[Undefined]";
    if (t === "string") return v.length > maxLen ? v.slice(0, maxLen) + "…" : v;
    if (t === "number") return Number.isFinite(v) ? v : String(v); // NaN/±Inf
    if (t === "boolean") return v;
    if (t === "bigint") return v.toString() + "n";
    if (t === "symbol") return "[Symbol]";
    if (t === "function") return "[Function]";
    if (isDomNode(v)) return "[DOM:" + String(v.nodeName).toLowerCase() + "]";
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack ?? null };
    }

    if (depth > maxDepth) return "[MaxDepth]";
    if (ancestors.has(v)) return "[Circular]";

    ancestors.add(v);
    try {
      if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
      if (v instanceof Map) {
        const o: Record<string, any> = {};
        let i = 0;
        for (const [k, val] of v) {
          // Object keys all stringify to "[object Object]" and collide, so fall
          // back to a unique synthetic key while keeping primitive keys readable.
          const key = isPrimitiveKey(k) ? String(k) : `[key#${i}]`;
          assign(o, key, walk(val, depth + 1));
          i++;
        }
        return o;
      }
      if (v instanceof Set) {
        return Array.from(v).map((item) => walk(item, depth + 1));
      }
      const out: Record<string, any> = {};
      for (const k of Object.keys(v)) {
        try {
          assign(out, k, walk(v[k], depth + 1));
        } catch {
          // A throwing getter must not sink the whole snapshot.
          assign(out, k, "[Unserializable]");
        }
      }
      return out;
    } finally {
      ancestors.delete(v);
    }
  }

  return walk(value, 0);
}

// Assign without letting an own `__proto__` key mutate the accumulator's
// prototype (contained prototype-pollution hardening).
function assign(target: Record<string, any>, key: string, value: any): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    target[key] = value;
  }
}
