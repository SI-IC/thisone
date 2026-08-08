import {
  resolveComponent,
  formatElementPath,
  formatElementPathFromRoot,
} from "./resolve-component";
import { captureElementScreenshot } from "./screenshot";
import { copyText, copyImage } from "./clipboard";
import { loadPosition, savePosition, type Position } from "./position-store";
import {
  loadTargetEnabled,
  saveTargetEnabled,
  loadTargetPosition,
  saveTargetPosition,
  type Edge,
  type TargetPosition,
} from "./target-store";
import { loadPathMode, savePathMode, type PathMode } from "./path-mode-store";
import { loadSettingsExpanded, saveSettingsExpanded } from "./settings-store";

export const HOST_ID = "__thisone_root";

export interface Overlay {
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
  mount(): void;
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
.actions { display: flex; align-items: center; gap: 6px; }
.close {
  cursor: pointer; border: none; background: transparent; color: #a6adc8;
  font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.close:hover { background: #313244; color: #eee; }
.target-toggle {
  cursor: pointer; border: 1px solid #585b70; background: #11111b; color: #a6adc8;
  padding: 2px 6px; border-radius: 4px; display: flex; align-items: center;
}
.target-toggle svg { transform: rotate(-45deg); }
.target-toggle:hover { background: #313244; color: #eee; border-color: #89b4fa; }
.target-toggle.active { color: #89b4fa; border-color: #89b4fa; background: rgba(137,180,250,.12); }
.target-toggle.active:hover { background: #313244; }
.body { padding: 12px; }
.settings {
  border-bottom: 1px solid #313244;
  font-size: 11px;
}
.settings-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  color: #a6adc8;
  user-select: none;
}
.settings-header:hover {
  color: #eee;
}
.settings-arrow {
  display: inline-flex;
  transition: transform 0.1s;
}
.settings-arrow.expanded {
  transform: rotate(90deg);
}
.settings-body {
  padding: 0 10px 8px;
}
.settings-body.hidden {
  display: none !important;
}
.hint { color: #a6adc8; }
.path-row { display: flex; align-items: center; gap: 6px; }
.path {
  cursor: pointer; word-break: break-all; padding: 6px; border-radius: 6px;
  background: #11111b; border: 1px solid #45475a; flex: 1; min-width: 0;
}
.path:hover { border-color: #89b4fa; }
.setting-group {
  margin-top: 8px;
}
.setting-group:first-child {
  margin-top: 0;
}
.setting-title {
  color: #cdd6f4;
  font-weight: 600;
  margin-bottom: 4px;
}
.radio-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
}
.radio-row label {
  cursor: pointer;
}
.qmark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid #585b70;
  color: #a6adc8;
  font-size: 9px;
  cursor: help;
  flex-shrink: 0;
}
img.shot {
  display: block; max-width: 100%; margin-top: 8px; cursor: pointer;
  border: 1px solid #45475a; border-radius: 6px;
}
img.shot:hover { border-color: #89b4fa; }
.target-btn {
  position: fixed; z-index: 2147483647; width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: #1e1e2e; border: 1px solid #45475a; color: #89b4fa; cursor: pointer;
}
.target-btn:hover { background: #313244; }
.target-btn.edge-right { right: 0; border-radius: 8px 0 0 8px; border-right: none; }
.target-btn.edge-left { left: 0; border-radius: 0 8px 8px 0; border-left: none; }
.target-btn.edge-top { top: 0; border-radius: 0 0 8px 8px; border-top: none; }
.target-btn.edge-bottom { bottom: 0; border-radius: 8px 8px 0 0; border-bottom: none; }
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

function pinIcon(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
}

function targetIcon(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`;
}

const EDGE_BUTTON_SIZE = 44;
const DEFAULT_TARGET_POSITION: TargetPosition = { edge: "right", offset: 0.5 };

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
  let targetToggle: HTMLElement;
  let targetBtn: HTMLElement;

  let open = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let currentShotUrl: string | null = null;
  let dragOffset: { dx: number; dy: number } | null = null;
  let targetEnabled = false;
  let pathMode: PathMode = "tree";
  let targetPosition: TargetPosition = DEFAULT_TARGET_POSITION;
  let targetDragging = false;
  let pickId = 0;
  let currentTarget: Element | null = null;

  function replaceShotUrl(url: string | null): void {
    if (currentShotUrl) URL.revokeObjectURL(currentShotUrl);
    currentShotUrl = url;
  }

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

  function clampPanelPosition(x: number, y: number): Position {
    const width = panel.getBoundingClientRect().width || panel.offsetWidth;
    const headerHeight =
      header.getBoundingClientRect().height || header.offsetHeight;
    const maxX = Math.max(0, win.innerWidth - width);
    const maxY = Math.max(0, win.innerHeight - headerHeight);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }

  function applyPosition(): void {
    const pos = loadPosition() ?? defaultPosition();
    const clamped = clampPanelPosition(pos.x, pos.y);
    panel.style.left = clamped.x + "px";
    panel.style.top = clamped.y + "px";
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
    title.textContent = "ThisOne";
    targetToggle = el("button", "target-toggle");
    targetToggle.innerHTML = pinIcon(14);
    targetToggle.title = "Show quick-access button at the screen edge";
    targetToggle.addEventListener("click", () =>
      setTargetEnabled(!targetEnabled),
    );
    const closeBtn = el("button", "close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => close());
    const actions = el("div", "actions");
    actions.append(targetToggle, closeBtn);
    header.append(title, actions);

    body = el("div", "body");

    const settings = el("div", "settings");
    const settingsHeader = el("div", "settings-header");
    const settingsArrow = el("span", "settings-arrow");
    settingsArrow.textContent = "▸";
    const settingsLabel = el("span");
    settingsLabel.textContent = "Settings";
    settingsHeader.append(settingsArrow, settingsLabel);
    const settingsBody = el("div", "settings-body");
    settings.append(settingsHeader, settingsBody);

    const settingsExpanded = loadSettingsExpanded();
    settingsBody.classList.toggle("hidden", !settingsExpanded);
    settingsArrow.classList.toggle("expanded", settingsExpanded);
    settingsHeader.addEventListener("click", () => {
      const expanded = settingsBody.classList.contains("hidden");
      settingsBody.classList.toggle("hidden", !expanded);
      settingsArrow.classList.toggle("expanded", expanded);
      saveSettingsExpanded(expanded);
    });

    const PATH_MODE_HELP: Record<PathMode, string> = {
      tree: "Show file-tree path",
      root: "Show path from root component",
    };
    const pathModeGroup = el("div", "setting-group");
    const pathModeTitle = el("div", "setting-title");
    pathModeTitle.textContent = "Path mode";
    pathModeGroup.appendChild(pathModeTitle);
    const pathModeRadios: Record<PathMode, HTMLInputElement> = {} as any;
    (["tree", "root"] as PathMode[]).forEach((mode) => {
      const row = el("div", "radio-row");
      const input = el("input");
      input.type = "radio";
      input.name = "path-mode";
      input.value = mode;
      const id = `thisone-path-mode-${mode}`;
      input.id = id;
      const label = el("label");
      label.htmlFor = id;
      label.textContent = mode === "tree" ? "File tree" : "From root component";
      const qmark = el("span", "qmark");
      qmark.textContent = "?";
      qmark.title = PATH_MODE_HELP[mode];
      input.addEventListener("change", () => {
        pathMode = mode;
        savePathMode(pathMode);
        if (currentTarget) renderSelection(currentTarget);
      });
      pathModeRadios[mode] = input;
      row.append(input, label, qmark);
      pathModeGroup.appendChild(row);
    });
    settingsBody.appendChild(pathModeGroup);

    panel.append(header, settings, body);
    root.appendChild(panel);

    pickHint = el("div", "pickhint hidden");
    pickHint.textContent = "Click an element · Esc to close";
    box = el("div", "box hidden");
    tip = el("div", "tip hidden");
    targetBtn = el("button", "target-btn hidden");
    targetBtn.innerHTML = targetIcon(20);
    targetBtn.title = "Right-click drag to move";
    root.append(pickHint, box, tip, targetBtn);

    targetEnabled = loadTargetEnabled();
    pathMode = loadPathMode();
    pathModeRadios[pathMode].checked = true;
    targetPosition = loadTargetPosition() ?? DEFAULT_TARGET_POSITION;
    targetToggle.classList.toggle("active", targetEnabled);
    targetBtn.classList.toggle("hidden", !targetEnabled);
    applyTargetButtonPosition();

    targetBtn.addEventListener("click", () => {
      if (open) close();
      else openModal();
    });
    targetBtn.addEventListener("mousedown", onTargetDragStart);
    win.addEventListener("resize", applyTargetButtonPosition);

    header.addEventListener("mousedown", onDragStart);
    win.addEventListener("beforeunload", cancelPick);
  }

  function renderEmpty(): void {
    body.innerHTML = "";
    const hint = el("div", "hint");
    hint.textContent = "Select an element";
    body.appendChild(hint);
  }

  function showStatus(target: HTMLElement, ok: boolean): void {
    target.textContent = ok ? "Copied" : "Copy failed";
    target.classList.toggle("fail", !ok);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      target.textContent = "";
      target.classList.remove("fail");
    }, 1500);
  }

  function renderSelection(target: Element): void {
    currentTarget = target;
    const myPickId = ++pickId;
    replaceShotUrl(null);
    body.innerHTML = "";

    const pathRow = el("div", "path-row");
    const pathEl = el("div", "path");
    const pathStatus = el("div", "status");

    function currentPathText(): string {
      return pathMode === "tree"
        ? formatElementPath(target)
        : formatElementPathFromRoot(target);
    }

    function renderPathText(): void {
      pathEl.textContent = currentPathText();
    }
    renderPathText();

    pathEl.addEventListener("click", () => {
      void copyText(currentPathText()).then((r) =>
        showStatus(pathStatus, r.ok),
      );
    });

    pathRow.append(pathEl);
    const imgStatus = el("div", "status");
    body.append(pathRow, pathStatus);

    captureElementScreenshot(target, host)
      .then((blob) => {
        if (myPickId !== pickId) return;
        const img = el("img", "shot");
        img.alt = "screenshot";
        const url = URL.createObjectURL(blob);
        replaceShotUrl(url);
        img.src = url;
        img.addEventListener("click", () => {
          void copyImage(blob).then((r) => showStatus(imgStatus, r.ok));
        });
        body.append(img, imgStatus);
      })
      .catch(() => {
        if (myPickId !== pickId) return;
        imgStatus.textContent = "Screenshot failed";
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
    const cls = (ev.target as HTMLElement).classList;
    if (cls?.contains("close") || cls?.contains("target-toggle")) return;
    const r = panel.getBoundingClientRect();
    dragOffset = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    win.addEventListener("mousemove", onDragMove);
    win.addEventListener("mouseup", onDragEnd);
  }

  function onDragMove(ev: MouseEvent): void {
    if (!dragOffset) return;
    const clamped = clampPanelPosition(
      ev.clientX - dragOffset.dx,
      ev.clientY - dragOffset.dy,
    );
    panel.style.left = clamped.x + "px";
    panel.style.top = clamped.y + "px";
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

  function setTargetEnabled(enabled: boolean): void {
    targetEnabled = enabled;
    saveTargetEnabled(enabled);
    targetToggle.classList.toggle("active", enabled);
    targetBtn.classList.toggle("hidden", !enabled);
  }

  function applyTargetButtonPosition(): void {
    targetBtn.classList.remove(
      "edge-top",
      "edge-right",
      "edge-bottom",
      "edge-left",
    );
    targetBtn.classList.add(`edge-${targetPosition.edge}`);
    const offset = clampOffset(targetPosition.edge, targetPosition.offset);
    const offsetPct = `${offset * 100}%`;
    const half = EDGE_BUTTON_SIZE / 2;
    targetBtn.style.left = "";
    targetBtn.style.top = "";
    if (targetPosition.edge === "top" || targetPosition.edge === "bottom") {
      targetBtn.style.left = `calc(${offsetPct} - ${half}px)`;
    } else {
      targetBtn.style.top = `calc(${offsetPct} - ${half}px)`;
    }
  }

  function clampOffset(edge: Edge, value: number): number {
    const length =
      edge === "top" || edge === "bottom" ? win.innerWidth : win.innerHeight;
    const half = EDGE_BUTTON_SIZE / 2;
    if (!(length > 0)) return Math.min(1, Math.max(0, value));
    const min = Math.min(0.5, half / length);
    const max = Math.max(0.5, 1 - half / length);
    return Math.min(max, Math.max(min, value));
  }

  function edgeFromPoint(x: number, y: number): Edge {
    const distances: Array<[Edge, number]> = [
      ["left", x],
      ["right", win.innerWidth - x],
      ["top", y],
      ["bottom", win.innerHeight - y],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  function suppressContextMenu(ev: Event): void {
    ev.preventDefault();
  }

  function onTargetDragStart(ev: MouseEvent): void {
    if (ev.button !== 2) return;
    ev.preventDefault();
    targetDragging = true;
    win.addEventListener("mousemove", onTargetDragMove);
    win.addEventListener("mouseup", onTargetDragEnd);
    win.addEventListener("contextmenu", suppressContextMenu, true);
  }

  function onTargetDragMove(ev: MouseEvent): void {
    if (!targetDragging) return;
    const edge = edgeFromPoint(ev.clientX, ev.clientY);
    const raw =
      edge === "top" || edge === "bottom"
        ? ev.clientX / win.innerWidth
        : ev.clientY / win.innerHeight;
    targetPosition = { edge, offset: clampOffset(edge, raw) };
    applyTargetButtonPosition();
  }

  function onTargetDragEnd(): void {
    if (!targetDragging) return;
    targetDragging = false;
    win.removeEventListener("mousemove", onTargetDragMove);
    win.removeEventListener("mouseup", onTargetDragEnd);
    saveTargetPosition(targetPosition);
    setTimeout(() => {
      win.removeEventListener("contextmenu", suppressContextMenu, true);
    }, 0);
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
    pickId++;
    panel.classList.add("hidden");
    replaceShotUrl(null);
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    mount: ensureMounted,
    destroy: () => {
      cancelPick();
      win.removeEventListener("beforeunload", cancelPick);
      win.removeEventListener("mousemove", onDragMove);
      win.removeEventListener("mouseup", onDragEnd);
      win.removeEventListener("mousemove", onTargetDragMove);
      win.removeEventListener("mouseup", onTargetDragEnd);
      win.removeEventListener("contextmenu", suppressContextMenu, true);
      win.removeEventListener("resize", applyTargetButtonPosition);
      dragOffset = null;
      targetDragging = false;
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      open = false;
    },
  };
}
