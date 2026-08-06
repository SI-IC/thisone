import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const { execFileSync } = await import("node:child_process");
const {
  wire,
  compareTags,
  extractPinnedTag,
  isMainModule,
} = await import("../../claude-plugin/scripts/wire.mjs");

const GIT_TAGS_OUT = (tags) =>
  tags.map((t) => `deadbeef\trefs/tags/${t}`).join("\n");

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cf-wire-update-"));
  execFileSync.mockReset();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeWiredProject(depSpec) {
  writeFileSync(join(dir, "pnpm-lock.yaml"), "");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      devDependencies: { vite: "7.0.0", vue: "3.5.0", "vite-plugin-claude-feedback": depSpec },
    }),
  );
  writeFileSync(
    join(dir, "vite.config.ts"),
    'import claudeFeedback from "vite-plugin-claude-feedback";\nexport default {plugins:[claudeFeedback()]}',
  );
}

describe("compareTags", () => {
  it("compares numerically, not lexically (v0.0.9 < v0.0.10)", () => {
    expect(compareTags("v0.0.9", "v0.0.10")).toBeLessThan(0);
  });
});

describe("extractPinnedTag", () => {
  it("parses the tag out of a github: dependency spec", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    expect(extractPinnedTag(dir)).toBe("v0.0.9");
  });

  it("returns null for a non-github (plain semver) spec", () => {
    writeWiredProject("0.0.1");
    expect(extractPinnedTag(dir)).toBeNull();
  });

  it("returns null when the dependency is absent (deleted-resource)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: {} }));
    expect(extractPinnedTag(dir)).toBeNull();
  });

  it("returns null for malformed package.json (malformed-input)", () => {
    writeFileSync(join(dir, "package.json"), "{not json");
    expect(extractPinnedTag(dir)).toBeNull();
  });
});

describe("wire(dir, { update: true })", () => {
  it("does nothing (old no-op) when update is not requested (boundary: default behavior unchanged)", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    wire(dir);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("reinstalls at the latest tag when the pinned tag is outdated", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    execFileSync.mockImplementation((file, args) => {
      if (file === "git") return GIT_TAGS_OUT(["v0.0.9", "v0.0.10", "v0.0.11"]);
      return "";
    });
    const result = wire(dir, { update: true });
    expect(result.updatedFrom).toBe("v0.0.9");
    expect(result.updatedTo).toBe("v0.0.11");
    const installCall = execFileSync.mock.calls.find(([file]) => file === "pnpm");
    expect(installCall[1]).toEqual([
      "add",
      "-D",
      "github:SI-IC/vue-pick-problem-skill#v0.0.11",
    ]);
  });

  it("is a no-op (no install call) when already at the latest tag (idempotent)", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.11");
    execFileSync.mockImplementation((file) => {
      if (file === "git") return GIT_TAGS_OUT(["v0.0.10", "v0.0.11"]);
      return "";
    });
    wire(dir, { update: true });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls[0][0]).toBe("git");
  });

  it("skips the update when resolving the latest tag fails (external-failure: network)", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    execFileSync.mockImplementation(() => {
      throw new Error("ENOTFOUND github.com");
    });
    const result = wire(dir, { update: true });
    expect(result.updatedTo).toBeUndefined();
  });

  it("skips the update under CLAUDE_FEEDBACK_SKIP_INSTALL=1 (permission/opt-out edge state)", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    process.env.CLAUDE_FEEDBACK_SKIP_INSTALL = "1";
    try {
      wire(dir, { update: true });
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      delete process.env.CLAUDE_FEEDBACK_SKIP_INSTALL;
    }
  });

  it("still checks for an update when the dep is present but the config patch is missing (regression: partial-wire ignored --update)", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: {
          vite: "7.0.0",
          vue: "3.5.0",
          "vite-plugin-claude-feedback":
            "github:SI-IC/vue-pick-problem-skill#v0.0.9",
        },
      }),
    );
    writeFileSync(join(dir, "vite.config.ts"), "export default {plugins:[]}");
    execFileSync.mockImplementation((file) => {
      if (file === "git") return GIT_TAGS_OUT(["v0.0.9", "v0.0.11"]);
      return "";
    });
    const result = wire(dir, { update: true });
    expect(result.updatedFrom).toBe("v0.0.9");
    expect(result.updatedTo).toBe("v0.0.11");
    const source = readFileSync(join(dir, "vite.config.ts"), "utf8");
    expect(source).toContain("claudeFeedback");
  });

  it("does not clobber a dependency pinned to a non-github source (e.g. a local fork override)", () => {
    writeWiredProject("link:../local-fork");
    const result = wire(dir, { update: true });
    expect(execFileSync).not.toHaveBeenCalled();
    expect(result.updatedTo).toBeUndefined();
  });

  it("does not truncate a prerelease tag into a plain-semver tag (boundary: tag regex anchoring)", () => {
    writeWiredProject("github:SI-IC/vue-pick-problem-skill#v0.0.9");
    execFileSync.mockImplementation((file) => {
      if (file === "git") return GIT_TAGS_OUT(["v0.0.9", "v0.0.11", "v0.0.12-rc.1"]);
      return "";
    });
    const result = wire(dir, { update: true });
    expect(result.updatedTo).toBe("v0.0.11");
  });
});

describe("isMainModule (claude-plugin/scripts/wire.mjs)", () => {
  it("still matches when argv[1] is a symlink to the real file", () => {
    const real = join(dir, "real.mjs");
    const link = join(dir, "link.mjs");
    writeFileSync(real, "");
    symlinkSync(real, link);
    expect(isMainModule(pathToFileURL(real).href, link)).toBe(true);
  });
});
