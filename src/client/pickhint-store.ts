const KEY = "thisone:pickhint-x";

export function loadPickHintOffsetX(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function savePickHintOffsetX(x: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(x));
  } catch {}
}
