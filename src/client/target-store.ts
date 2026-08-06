export type Edge = "top" | "right" | "bottom" | "left";

export interface TargetPosition {
  edge: Edge;
  offset: number;
}

const ENABLED_KEY = "pick-element:target-enabled";
const POS_KEY = "pick-element:target-pos";
const EDGES: Edge[] = ["top", "right", "bottom", "left"];

export function loadTargetEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveTargetEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
}

export function loadTargetPosition(): TargetPosition | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      EDGES.includes(parsed?.edge) &&
      typeof parsed?.offset === "number" &&
      Number.isFinite(parsed.offset)
    ) {
      return {
        edge: parsed.edge,
        offset: Math.min(1, Math.max(0, parsed.offset)),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTargetPosition(pos: TargetPosition): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {}
}
