import { describe, it, expect } from "vitest";
import {
  redactString,
  redactDeep,
  redactConsole,
} from "../../src/client/redact";
import type { ConsoleEntry } from "../../src/server/types";

describe("redactString", () => {
  it("masks JWT-shaped tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4";
    expect(redactString(`auth header ${jwt} end`)).toBe(
      "auth header [REDACTED] end",
    );
  });

  it("masks bearer/token schemes", () => {
    const out = redactString("Authorization: Bearer abcdef123456");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("abcdef123456");
    // plain bearer (no sensitive key prefix) keeps the scheme word
    expect(redactString("sent Bearer abcdef123456 now")).toBe(
      "sent Bearer [REDACTED] now",
    );
  });

  it("masks key=value secret assignments, keeping the key", () => {
    expect(redactString("password=hunter2hunter")).toBe("password=[REDACTED]");
    expect(redactString('api_key: "sk-livesecretvalue"')).toContain("api_key:");
    expect(redactString('api_key: "sk-livesecretvalue"')).toContain(
      "[REDACTED]",
    );
  });

  it("leaves benign text untouched", () => {
    expect(redactString("just a normal log line")).toBe(
      "just a normal log line",
    );
  });

  it("is a no-op on non-strings / empty", () => {
    expect(redactString("")).toBe("");
    // @ts-expect-error intentional misuse
    expect(redactString(undefined)).toBe(undefined);
  });
});

describe("redactDeep", () => {
  it("masks values under sensitive keys, recurses otherwise", () => {
    const out = redactDeep({
      user: "alice",
      password: "secret",
      nested: { apiKey: "k", token: "t", count: 3 },
      list: [{ secret: "x" }, "plain"],
    }) as Record<string, any>;
    expect(out.user).toBe("alice");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.token).toBe("[REDACTED]");
    expect(out.nested.count).toBe(3);
    expect(out.list[0].secret).toBe("[REDACTED]");
    expect(out.list[1]).toBe("plain");
  });

  it("redacts free text in string values", () => {
    const out = redactDeep({ msg: "password=topsecretvalue" }) as any;
    expect(out.msg).toBe("password=[REDACTED]");
  });

  it("passes through primitives and is depth-bounded", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(null)).toBe(null);
    // deep but finite — must not throw
    let deep: any = "x";
    for (let i = 0; i < 30; i++) deep = { child: deep };
    expect(() => redactDeep(deep)).not.toThrow();
  });
});

describe("redactConsole", () => {
  it("redacts entry text, preserves level/ts", () => {
    const entries: ConsoleEntry[] = [
      { level: "log", ts: 1, text: "token abcdef123456" },
      { level: "warn", ts: 2, text: "all good" },
    ];
    const out = redactConsole(entries);
    expect(out[0].text).toContain("[REDACTED]");
    expect(out[0].level).toBe("log");
    expect(out[0].ts).toBe(1);
    expect(out[1].text).toBe("all good");
  });
});
