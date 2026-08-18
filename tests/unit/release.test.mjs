import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const ALIAS_REL = "packages/vite-plugin-thisone-legacy/package.json";

let sandbox;

function readJson(relative) {
  return JSON.parse(readFileSync(resolve(sandbox, relative), "utf8"));
}

function writeJson(relative, value) {
  const path = resolve(sandbox, relative);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function release(level) {
  return spawnSync(
    process.execPath,
    [resolve(sandbox, "scripts/release.mjs"), ...(level ? [level] : [])],
    { encoding: "utf8" },
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(resolve(tmpdir(), "thisone-release-"));
  mkdirSync(resolve(sandbox, "scripts"), { recursive: true });
  cpSync(
    resolve(REPO, "scripts/release.mjs"),
    resolve(sandbox, "scripts/release.mjs"),
  );
  writeJson("package.json", { name: "@si-ic/thisone", version: "2.4.3" });
  writeJson(ALIAS_REL, {
    name: "vite-plugin-thisone",
    version: "2.4.3",
    dependencies: { "@si-ic/thisone": "^2.0.0" },
  });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/release.mjs", () => {
  it("bumps the root version and syncs the legacy alias version and range on major", () => {
    const result = release("major");
    expect(result.status).toBe(0);
    expect(readJson("package.json").version).toBe("3.0.0");
    const alias = readJson(ALIAS_REL);
    expect(alias.version).toBe("3.0.0");
    expect(alias.dependencies["@si-ic/thisone"]).toBe("^3.0.0");
  });

  it("keeps the alias range on a minor bump inside the same major", () => {
    expect(release("minor").status).toBe(0);
    expect(readJson("package.json").version).toBe("2.5.0");
    const alias = readJson(ALIAS_REL);
    expect(alias.version).toBe("2.5.0");
    expect(alias.dependencies["@si-ic/thisone"]).toBe("^2.0.0");
  });

  it("bumps the patch component only on patch", () => {
    expect(release("patch").status).toBe(0);
    expect(readJson("package.json").version).toBe("2.4.4");
    expect(readJson(ALIAS_REL).version).toBe("2.4.4");
  });

  it("rejects an unknown bump level and writes nothing (malformed input)", () => {
    const result = release("hotfix");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown bump");
    expect(readJson("package.json").version).toBe("2.4.3");
    expect(readJson(ALIAS_REL).version).toBe("2.4.3");
  });

  it("rejects a missing bump level (empty)", () => {
    expect(release().status).toBe(1);
    expect(readJson("package.json").version).toBe("2.4.3");
  });

  it("rejects an unparsable version and writes nothing", () => {
    writeJson("package.json", { name: "@si-ic/thisone", version: "nightly" });
    const result = release("patch");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot parse version");
    expect(readJson(ALIAS_REL).version).toBe("2.4.3");
  });

  it("leaves the root package.json untouched when the alias file is missing (deleted resource)", () => {
    rmSync(resolve(sandbox, ALIAS_REL));
    const result = release("minor");
    expect(result.status).not.toBe(0);
    expect(readJson("package.json").version).toBe("2.4.3");
  });

  it("leaves the root package.json untouched when the alias declares no dependency", () => {
    writeJson(ALIAS_REL, { name: "vite-plugin-thisone", version: "2.4.3" });
    const result = release("minor");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no @si-ic/thisone dependency");
    expect(readJson("package.json").version).toBe("2.4.3");
  });
});
