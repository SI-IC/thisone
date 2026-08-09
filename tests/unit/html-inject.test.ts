import { describe, it, expect } from "vitest";
import { buildInjectionScript } from "../../src/core/html-inject";

describe("buildInjectionScript", () => {
  it("prefixes the client bundle with the serialized config", () => {
    const out = buildInjectionScript({ hotkey: "KeyB" }, "console.log(1);");
    expect(out).toBe(
      'window.__THISONE_CFG__={"hotkey":"KeyB"};\nconsole.log(1);',
    );
  });

  it("serializes an empty config as {}", () => {
    const out = buildInjectionScript({}, "x();");
    expect(out).toBe("window.__THISONE_CFG__={};\nx();");
  });
});
