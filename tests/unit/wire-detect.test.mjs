import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectProject } from "../../claude-plugin/scripts/wire.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cf-wire-detect-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePkg(deps) {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ devDependencies: deps }),
  );
}

describe("inspectProject", () => {
  it("reports not_node_project when package.json is missing", () => {
    expect(inspectProject(dir)).toEqual({ reason: "not_node_project" });
  });

  it("reports not_vite when vite is absent", () => {
    writePkg({ vue: "3.5.0" });
    expect(inspectProject(dir).reason).toBe("not_vite");
  });

  it("reports not_vue when vue is absent", () => {
    writePkg({ vite: "7.0.0" });
    expect(inspectProject(dir).reason).toBe("not_vue");
  });

  it("reports no_vite_config when no config file exists", () => {
    writePkg({ vite: "7.0.0", vue: "3.5.0" });
    expect(inspectProject(dir).reason).toBe("no_vite_config");
  });

  it("detects vue+vite present and wired:false before wiring", () => {
    writePkg({ vite: "7.0.0", vue: "3.5.0" });
    writeFileSync(
      join(dir, "vite.config.ts"),
      "export default defineConfig({plugins:[vue()]})",
    );
    const info = inspectProject(dir);
    expect(info.hasVite).toBe(true);
    expect(info.hasVue).toBe(true);
    expect(info.wired).toBe(false);
  });

  it("detects wired:true once dep and config are both patched", () => {
    writePkg({
      vite: "7.0.0",
      vue: "3.5.0",
      "vite-plugin-claude-feedback": "0.0.1",
    });
    writeFileSync(
      join(dir, "vite.config.ts"),
      'import { claudeFeedback } from "vite-plugin-claude-feedback";\nexport default defineConfig({plugins:[claudeFeedback(), vue()]})',
    );
    expect(inspectProject(dir).wired).toBe(true);
  });
});
