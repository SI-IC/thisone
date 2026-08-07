const KEY = "thisone:pos";

export interface Position {
  x: number;
  y: number;
}

export function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePosition(pos: Position): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pos));
  } catch {}
}
