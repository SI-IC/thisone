import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { CLIENT_BUILD_OPTIONS } from "../../scripts/build-config.mjs";

const watch = vi.fn().mockResolvedValue(undefined);
const dispose = vi.fn().mockResolvedValue(undefined);
const context = vi.fn().mockResolvedValue({ watch, dispose });

vi.mock("esbuild", () => ({ context: (...args) => context(...args) }));

const root = resolve(import.meta.dirname, "../..");

describe("scripts/build-watch.mjs", () => {
  beforeEach(() => {
    context.mockClear();
    watch.mockClear();
    dispose.mockClear();
    context.mockResolvedValue({ watch, dispose });
  });

  it("watches only the client entry point, with the same options as the production build", async () => {
    const { main } = await import("../../scripts/build-watch.mjs");
    await main();

    expect(context).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoints: [resolve(root, "src/client/index.ts")],
        outfile: resolve(root, "dist/client.js"),
        ...CLIENT_BUILD_OPTIONS,
      }),
    );
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it("propagates a startup failure instead of swallowing it (malformed/hostile entry)", async () => {
    context.mockRejectedValueOnce(new Error("boom: invalid entry point"));
    const { main } = await import("../../scripts/build-watch.mjs");

    await expect(main()).rejects.toThrow("boom: invalid entry point");
  });
});
