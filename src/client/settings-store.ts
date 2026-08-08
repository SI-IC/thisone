const KEY = "thisone:settings-expanded";

export function loadSettingsExpanded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSettingsExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(KEY, expanded ? "1" : "0");
  } catch {}
}
