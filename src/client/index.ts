import { createOverlay } from "./overlay";

interface ThisoneConfig {
  hotkey?: string;
}

declare global {
  interface Window {
    __THISONE_CFG__?: ThisoneConfig;
    __thisone_booted__?: boolean;
  }
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__thisone_booted__) return;
  window.__thisone_booted__ = true;

  const cfg = window.__THISONE_CFG__ ?? {};
  const hotkey = cfg.hotkey ?? "KeyC";
  const overlay = createOverlay();
  overlay.mount();

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && e.code === hotkey && !e.repeat) {
        e.preventDefault();
        overlay.open();
      }
    },
    true,
  );
}

boot();
