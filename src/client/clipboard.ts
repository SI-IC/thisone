export interface CopyResult {
  ok: boolean;
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!navigator.clipboard?.writeText) return { ok: false };
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function copyImage(blob: Blob): Promise<CopyResult> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return { ok: false };
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
