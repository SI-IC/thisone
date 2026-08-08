const ENABLED_KEY = "thisone:screenshot-enabled";
const PADDING_KEY = "thisone:screenshot-padding";
const DEFAULT_PADDING = 30;

export function loadScreenshotEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function saveScreenshotEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {}
}

export function loadScreenshotPadding(): number {
  try {
    const raw = localStorage.getItem(PADDING_KEY);
    if (raw === null) return DEFAULT_PADDING;
    const parsed = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_PADDING;
  } catch {
    return DEFAULT_PADDING;
  }
}

export function saveScreenshotPadding(padding: number): void {
  try {
    localStorage.setItem(PADDING_KEY, JSON.stringify(padding));
  } catch {}
}
