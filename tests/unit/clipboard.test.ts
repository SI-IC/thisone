// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, copyImage } from "../../src/client/clipboard";

function stubClipboard(impl: Partial<Clipboard>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
  });
}

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  // @ts-expect-error test-only global cleanup
  delete globalThis.ClipboardItem;
});

describe("copyText", () => {
  it("writes the text and resolves ok:true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const r = await copyText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(r).toEqual({ ok: true });
  });

  it("resolves ok:false when the browser denies permission (external-failure)", async () => {
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    expect(await copyText("hello")).toEqual({ ok: false });
  });

  it("resolves ok:false when clipboard is unavailable (insecure context / old browser)", async () => {
    stubClipboard({} as Clipboard);
    expect(await copyText("hello")).toEqual({ ok: false });
  });
});

describe("copyImage", () => {
  it("writes a ClipboardItem for the blob and resolves ok:true", async () => {
    // @ts-expect-error test-only global
    globalThis.ClipboardItem = FakeClipboardItem;
    const write = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write });
    const blob = new Blob(["x"], { type: "image/png" });

    const r = await copyImage(blob);

    expect(r).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as FakeClipboardItem;
    expect(item.data["image/png"]).toBe(blob);
  });

  it("resolves ok:false when ClipboardItem is unsupported (old browser)", async () => {
    stubClipboard({ write: vi.fn() });
    const blob = new Blob(["x"], { type: "image/png" });
    expect(await copyImage(blob)).toEqual({ ok: false });
  });

  it("resolves ok:false when the write rejects (external-failure)", async () => {
    // @ts-expect-error test-only global
    globalThis.ClipboardItem = FakeClipboardItem;
    stubClipboard({ write: vi.fn().mockRejectedValue(new Error("denied")) });
    const blob = new Blob(["x"], { type: "image/png" });
    expect(await copyImage(blob)).toEqual({ ok: false });
  });
});
