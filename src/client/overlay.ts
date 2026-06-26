// The feedback overlay: a Shadow-DOM modal (textarea + actions) plus an element
// picker (hover-highlight + component tooltip, click to select, Esc to cancel).
// Native DOM only — no Vue — so it can't conflict with the host app's framework
// or styles. The overlay assembles the FeedbackPayload (url + element + component
// + redacted console) and hands it to the injected `send` callback.

import { resolveComponent, describeElement } from "./resolve-component";
import { redactConsole } from "./redact";
import type {
  ConsoleEntry,
  ElementDescriptor,
  ComponentDescriptor,
} from "../server/types";

export const HOST_ID = "__claude_feedback_root";

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface OverlayDeps {
  /** This tab's id, stamped onto every payload. */
  tabId: string;
  /** Current console ring buffer (redacted before send). */
  getConsole: () => ConsoleEntry[];
  /** Ship the assembled payload to the bridge. */
  send: (payload: {
    url: string;
    message: string;
    element: ElementDescriptor | null;
    component: ComponentDescriptor | null;
    console: ConsoleEntry[];
    tabId: string;
  }) => Promise<SendResult>;
  /** Notified whenever the picked element changes (index.ts tracks last-el). */
  onPick?: (el: Element | null) => void;
}

export interface Overlay {
  open(): void;
  close(): void;
  isOpen(): boolean;
  isPicking(): boolean;
  startPick(): void;
  cancelPick(): void;
  lastEl(): Element | null;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
.panel {
  position: fixed; right: 16px; bottom: 16px; width: 340px; z-index: 2147483646;
  background: #1e1e2e; color: #eee; border: 1px solid #444; border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); padding: 14px; font-size: 13px;
}
.title { font-weight: 600; margin: 0 0 8px; font-size: 13px; }
textarea {
  width: 100%; height: 84px; resize: vertical; background: #11111b; color: #eee;
  border: 1px solid #45475a; border-radius: 6px; padding: 8px; font-size: 13px;
}
.meta { margin: 8px 0; color: #a6adc8; font-size: 12px; min-height: 16px; word-break: break-all; }
.row { display: flex; gap: 8px; margin-top: 8px; }
button {
  flex: 1; cursor: pointer; border: 1px solid #585b70; background: #313244;
  color: #eee; border-radius: 6px; padding: 7px 8px; font-size: 12px;
}
button.primary { background: #89b4fa; color: #11111b; border-color: #89b4fa; font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
.err { color: #f38ba8; font-size: 12px; margin-top: 6px; min-height: 14px; }
.hidden { display: none !important; }
.pickhint {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
  background: #89b4fa; color: #11111b; padding: 6px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
}
.box {
  position: fixed; z-index: 2147483645; pointer-events: none;
  border: 2px solid #89b4fa; background: rgba(137,180,250,.12); border-radius: 3px;
}
.tip {
  position: fixed; z-index: 2147483647; pointer-events: none;
  background: #11111b; color: #89b4fa; border: 1px solid #89b4fa;
  padding: 2px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap;
}
`;

export function createOverlay(deps: OverlayDeps): Overlay {
  const doc = document;
  const win = window;
  let host: HTMLElement | null = null;
  let root: ShadowRoot;
  let panel: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let metaEl: HTMLElement;
  let errEl: HTMLElement;
  let sendBtn: HTMLButtonElement;
  let pickHint: HTMLElement;
  let box: HTMLElement;
  let tip: HTMLElement;

  let open = false;
  let picking = false;
  let submitting = false;
  let selectedEl: Element | null = null;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
  ): HTMLElementTagNameMap[K] {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function ensureMounted(): void {
    if (host) return;
    host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement("div");
      host.id = HOST_ID;
      doc.body.appendChild(host);
    }
    root = host.attachShadow({ mode: "open" });

    const style = doc.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    panel = el("div", "panel hidden");
    const title = el("p", "title");
    title.textContent = "Claude feedback";
    textarea = el("textarea");
    textarea.placeholder = "Что улучшить / что не так?";
    metaEl = el("div", "meta");
    metaEl.textContent = "Элемент не выбран";

    const row1 = el("div", "row");
    const pickBtn = el("button");
    pickBtn.textContent = "Выделить элемент";
    pickBtn.addEventListener("click", () => startPick());
    row1.appendChild(pickBtn);

    const row2 = el("div", "row");
    sendBtn = el("button", "primary");
    sendBtn.textContent = "Отправить";
    sendBtn.addEventListener("click", () => void submit());
    const cancelBtn = el("button");
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => close());
    row2.appendChild(sendBtn);
    row2.appendChild(cancelBtn);

    errEl = el("div", "err");

    panel.append(title, textarea, metaEl, row1, row2, errEl);
    root.appendChild(panel);

    pickHint = el("div", "pickhint hidden");
    pickHint.textContent = "Кликни по элементу · Esc — отмена";
    box = el("div", "box hidden");
    tip = el("div", "tip hidden");
    root.append(pickHint, box, tip);

    win.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("beforeunload", cancelPick);
  }

  function setMeta(): void {
    if (!selectedEl) {
      metaEl.textContent = "Элемент не выбран";
      return;
    }
    const d = describeElement(selectedEl);
    const c = resolveComponent(selectedEl);
    metaEl.textContent = c
      ? `<${d.tag}> · ${c.name}${c.file ? " (" + c.file + ")" : ""}`
      : `<${d.tag}> · ${d.selector}`;
  }

  function showError(msg: string): void {
    errEl.textContent = msg;
  }

  function openModal(): void {
    ensureMounted();
    if (open) return; // Alt+C while open is a no-op (never spawn a second modal)
    open = true;
    errEl.textContent = "";
    panel.classList.remove("hidden");
    setMeta();
    textarea.focus();
  }

  function close(): void {
    if (!host) return;
    cancelPick();
    open = false;
    panel.classList.add("hidden");
  }

  // ---- element picker ------------------------------------------------------

  function pathHasHost(ev: Event): boolean {
    const path = (ev.composedPath?.() ?? []) as EventTarget[];
    return host ? path.includes(host) : false;
  }

  function targetUnder(ev: MouseEvent): Element | null {
    const path = (ev.composedPath?.() ?? []) as EventTarget[];
    for (const t of path) {
      if (t instanceof Element && t !== host) return t;
    }
    return ev.target instanceof Element ? ev.target : null;
  }

  function onMove(ev: MouseEvent): void {
    if (!picking) return;
    if (pathHasHost(ev)) {
      box.classList.add("hidden");
      tip.classList.add("hidden");
      return;
    }
    const t = targetUnder(ev);
    if (!t) return;
    const r = t.getBoundingClientRect();
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.classList.remove("hidden");
    const c = resolveComponent(t);
    tip.textContent = c ? c.name : t.tagName.toLowerCase();
    tip.style.left = r.left + "px";
    tip.style.top = Math.max(0, r.top - 20) + "px";
    tip.classList.remove("hidden");
  }

  function onClick(ev: MouseEvent): void {
    if (!picking) return;
    if (pathHasHost(ev)) return; // clicks on our own UI are ignored
    ev.preventDefault();
    ev.stopPropagation();
    const t = targetUnder(ev);
    selectedEl = t;
    deps.onPick?.(t);
    cancelPick();
    openModalAfterPick();
  }

  function onKey(ev: KeyboardEvent): void {
    if (picking && ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      cancelPick();
      openModalAfterPick();
    }
  }

  function onVisibility(): void {
    if (doc.visibilityState === "hidden") cancelPick();
  }

  function openModalAfterPick(): void {
    open = false; // force openModal to re-show (it no-ops when already open)
    openModal();
  }

  function startPick(): void {
    ensureMounted();
    if (picking) return;
    picking = true;
    open = false;
    panel.classList.add("hidden");
    pickHint.classList.remove("hidden");
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
  }

  function cancelPick(): void {
    if (!picking) return;
    picking = false;
    if (pickHint) pickHint.classList.add("hidden");
    if (box) box.classList.add("hidden");
    if (tip) tip.classList.add("hidden");
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
  }

  // ---- submit --------------------------------------------------------------

  async function submit(): Promise<void> {
    if (submitting) return; // block double-click until the POST settles
    submitting = true;
    sendBtn.disabled = true;
    showError("");
    const payload = {
      url: typeof location !== "undefined" ? location.href : "",
      message: textarea.value,
      element: selectedEl ? describeElement(selectedEl) : null,
      component: selectedEl ? resolveComponent(selectedEl) : null,
      console: redactConsole(deps.getConsole()),
      tabId: deps.tabId,
    };
    try {
      const res = await deps.send(payload);
      if (res.ok) {
        textarea.value = "";
        selectedEl = null;
        deps.onPick?.(null);
        close();
      } else if (res.status === 413) {
        showError("Слишком большой контекст — сократи и попробуй снова.");
      } else {
        showError("Не удалось отправить — dev bridge недоступен?");
      }
    } catch {
      showError("Dev bridge offline.");
    } finally {
      submitting = false;
      sendBtn.disabled = false;
    }
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    isPicking: () => picking,
    startPick,
    cancelPick,
    lastEl: () => selectedEl,
    destroy: () => {
      cancelPick();
      win.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("beforeunload", cancelPick);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      open = false;
    },
  };
}
