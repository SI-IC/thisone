import { createOverlay } from "./overlay";

interface PickElementConfig {
  hotkey?: string;
}

declare global {
  interface Window {
    __PICK_ELEMENT_CFG__?: PickElementConfig;
    __pick_element_booted__?: boolean;
  }
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__pick_element_booted__) return;
  window.__pick_element_booted__ = true;

  const cfg = window.__PICK_ELEMENT_CFG__ ?? {};
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
