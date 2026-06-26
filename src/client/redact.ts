// Strip obvious secrets out of anything the browser ships to the bridge (and on
// to Claude): the captured console buffer and snapshot state. This is the Phase 4
// redactor the Phase 2/3 security reviews deferred here — defense-in-depth, not a
// guarantee. Two passes: sensitive-looking object KEYS get their value masked,
// and free-text gets JWT / bearer / `key=value` patterns masked.

import type { ConsoleEntry } from "../server/types";

const REDACTED = "[REDACTED]";

// Keys whose VALUE we mask wholesale (matched anywhere in the key name).
const SENSITIVE_KEY =
  /(pass(?:word|wd)?|secret|token|api[_-]?key|apikey|auth(?:orization)?|cookie|session|credential|private[_-]?key|access[_-]?key|client[_-]?secret)/i;

// JWT-shaped tokens (header.payload.signature, base64url).
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;

// `Bearer <token>` / `token <token>` headers embedded in text.
const BEARER = /\b(bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

// `password=...` / `api_key: "..."` style assignments embedded in text. Captures
// the key (g1) so it survives; the value is replaced.
const KV =
  /\b([\w-]*(?:password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|session|credential|access[_-]?key)[\w-]*)\s*([:=])\s*("?)([^\s",;}]+)\3/gi;

/** Mask secret-looking substrings inside a free-text string. */
export function redactString(s: string): string {
  if (typeof s !== "string" || !s) return s;
  return s
    .replace(JWT, REDACTED)
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KV, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
}

/**
 * Walk an already-JSON-safe value (post-safeStringify) and mask values whose key
 * looks sensitive; redact free text everywhere else. Depth-bounded so a pathological
 * shape can't run away (safeStringify already caps, this is a second guard).
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[key];
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redact the text of every console entry (entries are otherwise passed through). */
export function redactConsole(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.map((e) => ({ ...e, text: redactString(e.text) }));
}
