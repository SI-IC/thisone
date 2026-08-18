import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const ALIAS_REL = "packages/vite-plugin-thisone-legacy/package.json";

let sandbox;
let registry;
let registryUrl;
let registryState;

function writeJson(relative, value) {
  const path = resolve(sandbox, relative);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function startRegistry() {
  registryState = { published: [], status: null };
  registry = createServer((req, res) => {
    if (registryState.status) {
      res.writeHead(registryState.status).end("boom");
      return;
    }
    const path = decodeURIComponent(req.url.slice(1));
    const lastSlash = path.lastIndexOf("/");
    const spec = `${path.slice(0, lastSlash)}@${path.slice(lastSlash + 1)}`;
    if (registryState.published.includes(spec)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: spec.split("@").pop() }));
      return;
    }
    res.writeHead(404).end('{"error":"version not found"}');
  });
  return new Promise((done) => {
    registry.listen(0, "127.0.0.1", () => {
      registryUrl = `http://127.0.0.1:${registry.address().port}`;
      done();
    });
  });
}

function fakeNpm({ publishFails = null } = {}) {
  const bin = resolve(sandbox, "fake-npm");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(resolve(sandbox, "calls.log"))}, args.join(" ") + " @ " + process.cwd() + "\\n");
if (args[0] === "publish" && ${JSON.stringify(publishFails)} === process.cwd()) {
  process.stderr.write("npm error code E403\\n");
  process.exit(1);
}
process.exit(0);
`,
    { mode: 0o755 },
  );
  chmodSync(bin, 0o755);
  return bin;
}

function publishCalls() {
  const path = resolve(sandbox, "calls.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("publish"));
}

function publish({ env = {}, npmBin, args = [] } = {}) {
  const child = spawn(
    process.execPath,
    [resolve(sandbox, "scripts/publish.mjs"), ...args],
    {
      cwd: sandbox,
      env: {
        ...process.env,
        GITHUB_ACTIONS: "",
        GITHUB_REF_TYPE: "",
        GITHUB_REF_NAME: "",
        THISONE_REGISTRY: registryUrl,
        THISONE_NPM: npmBin ?? fakeNpm(),
        ...env,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((done) => {
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

function publishFromTag(tag, options = {}) {
  return publish({
    ...options,
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: tag,
      ...(options.env ?? {}),
    },
  });
}

beforeEach(async () => {
  sandbox = mkdtempSync(resolve(tmpdir(), "thisone-publish-"));
  mkdirSync(resolve(sandbox, "scripts"), { recursive: true });
  mkdirSync(resolve(sandbox, "dist"), { recursive: true });
  cpSync(
    resolve(REPO, "scripts/publish.mjs"),
    resolve(sandbox, "scripts/publish.mjs"),
  );
  writeFileSync(resolve(sandbox, "dist/index.js"), "export default {};\n");
  writeJson("package.json", { name: "@si-ic/thisone", version: "3.1.1" });
  writeJson(ALIAS_REL, {
    name: "vite-plugin-thisone",
    version: "3.1.1",
    dependencies: { "@si-ic/thisone": "^3.0.0" },
  });
  await startRegistry();
});

afterEach(() => {
  registry.close();
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/publish.mjs", () => {
  it("publishes the root package before the legacy alias", async () => {
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(0);
    expect(publishCalls()).toHaveLength(2);
    expect(
      result.stdout.indexOf("published @si-ic/thisone@3.1.1"),
    ).toBeLessThan(
      result.stdout.indexOf("published vite-plugin-thisone@3.1.1"),
    );
  });

  it("publishes the alias from the alias directory, not the repo root", async () => {
    expect((await publishFromTag("v3.1.1")).status).toBe(0);
    const [root, aliasCall] = publishCalls();
    expect(root).toContain(`@ ${sandbox}`);
    expect(aliasCall).toContain(resolve(sandbox, "packages"));
  });

  it("refuses to publish when the tag does not match package.json", async () => {
    const result = await publishFromTag("v3.0.9");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match package.json version");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish from a branch ref inside Actions", async () => {
    const result = await publish({
      env: {
        GITHUB_ACTIONS: "true",
        GITHUB_REF_TYPE: "branch",
        GITHUB_REF_NAME: "main",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("publish runs from a v<version> tag only");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish inside Actions when the ref type is absent (empty)", async () => {
    const result = await publish({ env: { GITHUB_ACTIONS: "true" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("an unknown ref");
    expect(publishCalls()).toHaveLength(0);
  });

  it("skips a version already in the registry and stays green on a re-run of the same tag", async () => {
    registryState.published = [
      "@si-ic/thisone@3.1.1",
      "vite-plugin-thisone@3.1.1",
    ];
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(0);
    expect(publishCalls()).toHaveLength(0);
    expect(result.stdout).toContain("already published");
  });

  it("finishes the alias when only the root package was published before", async () => {
    registryState.published = ["@si-ic/thisone@3.1.1"];
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(0);
    expect(publishCalls()).toHaveLength(1);
    expect(result.stdout).toContain("published vite-plugin-thisone@3.1.1");
  });

  it("aborts instead of publishing blind when the registry errors out", async () => {
    registryState.status = 500;
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("registry answered 500");
    expect(publishCalls()).toHaveLength(0);
  });

  it("aborts instead of publishing blind when the registry is unreachable", async () => {
    registry.close();
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot reach the registry");
    expect(publishCalls()).toHaveLength(0);
  });

  it("fails the job when the root publish is rejected and never publishes the alias", async () => {
    const result = await publishFromTag("v3.1.1", {
      npmBin: fakeNpm({ publishFails: sandbox }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm publish failed for @si-ic/thisone");
    expect(publishCalls()).toHaveLength(1);
  });

  it("refuses to publish when the alias version drifted from the root version", async () => {
    writeJson(ALIAS_REL, {
      name: "vite-plugin-thisone",
      version: "3.1.0",
      dependencies: { "@si-ic/thisone": "^3.0.0" },
    });
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match root version");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish an alias whose dependency range misses the new major", async () => {
    writeJson(ALIAS_REL, {
      name: "vite-plugin-thisone",
      version: "3.1.1",
      dependencies: { "@si-ic/thisone": "^2.0.0" },
    });
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected ^3.0.0");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish when dist is missing", async () => {
    rmSync(resolve(sandbox, "dist"), { recursive: true, force: true });
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist/index.js is missing");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish when the alias manifest is gone", async () => {
    rmSync(resolve(sandbox, ALIAS_REL));
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing");
    expect(publishCalls()).toHaveLength(0);
  });

  it("refuses to publish when a manifest is malformed", async () => {
    writeFileSync(resolve(sandbox, ALIAS_REL), "{ not json");
    const result = await publishFromTag("v3.1.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot parse");
  });

  it("publishes nothing under --dry-run", async () => {
    const result = await publishFromTag("v3.1.1", { args: ["--dry-run"] });
    expect(result.status).toBe(0);
    expect(publishCalls()).toHaveLength(0);
    expect(result.stdout).toContain("would publish @si-ic/thisone@3.1.1");
    expect(result.stdout).toContain("would publish vite-plugin-thisone@3.1.1");
  });

  it("runs outside Actions without any ref gating, for a local dry run", async () => {
    const result = await publish({ args: ["--dry-run"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would publish @si-ic/thisone@3.1.1");
  });
});
