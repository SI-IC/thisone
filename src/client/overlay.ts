import { resolveComponent, formatElementPath } from "./resolve-component";
import { captureElementScreenshot } from "./screenshot";
import { copyText, copyImage } from "./clipboard";
import { loadPosition, savePosition, type Position } from "./position-store";

export const HOST_ID = "__pick_element_root";

export interface Overlay {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
.panel {
  position: fixed; width: 340px; z-index: 2147483646;
  background: #1e1e2e; color: #eee; border: 1px solid #444; border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); font-size: 13px; overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; cursor: move; background: #181825; user-select: none;
}
.title { font-weight: 600; font-size: 13px; }
.close {
  cursor: pointer; border: none; background: transparent; color: #a6adc8;
  font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.close:hover { background: #313244; color: #eee; }
.body { padding: 12px; }
.hint { color: #a6adc8; }
.path {
  cursor: pointer; word-break: break-all; padding: 6px; border-radius: 6px;
  background: #11111b; border: 1px solid #45475a;
}
.path:hover { border-color: #89b4fa; }
img.shot {
  display: block; max-width: 100%; margin-top: 8px; cursor: pointer;
  border: 1px solid #45475a; border-radius: 6px;
}
.status { font-size: 11px; color: #a6b8fa; min-height: 14px; margin-top: 4px; }
.status.fail { color: #f38ba8; }
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

export function createOverlay(): Overlay {
  const doc = document;
  const win = window;
  let host: HTMLElement | null = null;
  let root: ShadowRoot;
  let panel: HTMLElement;
  let header: HTMLElement;
  let body: HTMLElement;
  let pickHint: HTMLElement;
  let box: HTMLElement;
  let tip: HTMLElement;

  let open = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let currentShotUrl: string | null = null;
  let dragOffset: { dx: number; dy: number } | null = null;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
  ): HTMLElementTagNameMap[K] {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function defaultPosition(): Position {
    return {
      x: Math.max(16, win.innerWidth - 356),
      y: Math.max(16, win.innerHeight - 200),
    };
  }

  function applyPosition(): void {
    const pos = loadPosition() ?? defaultPosition();
    panel.style.left = pos.x + "px";
    panel.style.top = pos.y + "px";
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
    header = el("div", "header");
    const title = el("span", "title");
    title.textContent = "Выберите элемент";
    const closeBtn = el("button", "close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => close());
    header.append(title, closeBtn);

    body = el("div", "body");

    panel.append(header, body);
    root.appendChild(panel);

    pickHint = el("div", "pickhint hidden");
    pickHint.textContent = "Кликни по элементу · Esc — закрыть";
    box = el("div", "box hidden");
    tip = el("div", "tip hidden");
    root.append(pickHint, box, tip);

    header.addEventListener("mousedown", onDragStart);
    win.addEventListener("beforeunload", cancelPick);
  }

  function renderEmpty(): void {
    body.innerHTML = "";
    const hint = el("div", "hint");
    hint.textContent = "Выберите элемент";
    body.appendChild(hint);
  }

  function showStatus(target: HTMLElement, ok: boolean): void {
    target.textContent = ok ? "Скопировано" : "Не удалось скопировать";
    target.classList.toggle("fail", !ok);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      target.textContent = "";
      target.classList.remove("fail");
    }, 1500);
  }

  function renderSelection(target: Element): void {
    if (currentShotUrl) {
      URL.revokeObjectURL(currentShotUrl);
      currentShotUrl = null;
    }
    body.innerHTML = "";

    const pathText = formatElementPath(target);
    const pathEl = el("div", "path");
    pathEl.textContent = pathText;
    const pathStatus = el("div", "status");
    pathEl.addEventListener("click", () => {
      void copyText(pathText).then((r) => showStatus(pathStatus, r.ok));
    });

    const imgStatus = el("div", "status");
    body.append(pathEl, pathStatus);

    captureElementScreenshot(target)
      .then((blob) => {
        const img = el("img", "shot");
        img.alt = "screenshot";
        currentShotUrl = URL.createObjectURL(blob);
        img.src = currentShotUrl;
        img.addEventListener("click", () => {
          void copyImage(blob).then((r) => showStatus(imgStatus, r.ok));
        });
        body.append(img, imgStatus);
      })
      .catch(() => {
        imgStatus.textContent = "Не удалось сделать скриншот";
        imgStatus.classList.add("fail");
        body.append(imgStatus);
      });
  }

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
    if (pathHasHost(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const t = targetUnder(ev);
    if (!t) return;
    renderSelection(t);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  }

  function startPick(): void {
    pickHint.classList.remove("hidden");
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
  }

  function cancelPick(): void {
    pickHint.classList.add("hidden");
    box.classList.add("hidden");
    tip.classList.add("hidden");
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
  }

  function onDragStart(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList?.contains("close")) return;
    const r = panel.getBoundingClientRect();
    dragOffset = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    win.addEventListener("mousemove", onDragMove);
    win.addEventListener("mouseup", onDragEnd);
  }

  function onDragMove(ev: MouseEvent): void {
    if (!dragOffset) return;
    panel.style.left = ev.clientX - dragOffset.dx + "px";
    panel.style.top = ev.clientY - dragOffset.dy + "px";
  }

  function onDragEnd(): void {
    if (!dragOffset) return;
    dragOffset = null;
    win.removeEventListener("mousemove", onDragMove);
    win.removeEventListener("mouseup", onDragEnd);
    savePosition({
      x: parseFloat(panel.style.left) || 0,
      y: parseFloat(panel.style.top) || 0,
    });
  }

  function openModal(): void {
    ensureMounted();
    if (open) return;
    open = true;
    panel.classList.remove("hidden");
    applyPosition();
    renderEmpty();
    startPick();
  }

  function close(): void {
    if (!host || !open) return;
    cancelPick();
    open = false;
    panel.classList.add("hidden");
    if (currentShotUrl) {
      URL.revokeObjectURL(currentShotUrl);
      currentShotUrl = null;
    }
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    destroy: () => {
      cancelPick();
      win.removeEventListener("beforeunload", cancelPick);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      open = false;
    },
  };
}
