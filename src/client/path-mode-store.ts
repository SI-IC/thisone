export type PathMode = "tree" | "root";

const MODE_KEY = "thisone:path-mode";

export function loadPathMode(): PathMode {
  try {
    return localStorage.getItem(MODE_KEY) === "root" ? "root" : "tree";
  } catch {
    return "tree";
  }
}

export function savePathMode(mode: PathMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
}
