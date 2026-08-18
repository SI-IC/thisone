import { describe, it, expect } from "vitest";
import { buildInjectionScript } from "../../src/core/html-inject";

describe("buildInjectionScript", () => {
  it("prefixes the client bundle with the serialized config", () => {
    const out = buildInjectionScript({ hotkey: "KeyB" }, "console.log(1);");
    expect(out).toBe(
      'window.__THISONE_CFG__={"hotkey":"KeyB"};\nconsole.log(1);',
    );
  });

  it("escapes < so a hotkey cannot close the inline script tag (hostile input)", () => {
    const out = buildInjectionScript(
      { hotkey: "</script><script>alert(1)</script>" },
      "x();",
    );
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script>");
  });

  it("serializes an empty config as {}", () => {
    const out = buildInjectionScript({}, "x();");
    expect(out).toBe("window.__THISONE_CFG__={};\nx();");
  });
});
