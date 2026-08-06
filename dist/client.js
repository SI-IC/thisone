"use strict";
(() => {
  // src/client/safe-stringify.ts
  function isDomNode(v) {
    return typeof v === "object" && v !== null && typeof v.nodeType === "number" && typeof v.nodeName === "string";
  }
  function isPrimitiveKey(k) {
    const t = typeof k;
    return t === "string" || t === "number" || t === "boolean" || t === "bigint";
  }
  function safeStringify(value, opts = {}) {
    var _a, _b, _c;
    const maxDepth = (_a = opts.maxDepth) != null ? _a : 6;
    const maxLen = (_b = opts.maxLen) != null ? _b : 5e3;
    let budget = (_c = opts.maxNodes) != null ? _c : 5e4;
    const ancestors = /* @__PURE__ */ new Set();
    function walk(v, depth) {
      var _a2;
      if (--budget < 0) return "[Truncated]";
      if (v === null) return null;
      const t = typeof v;
      if (t === "undefined") return "[Undefined]";
      if (t === "string") return v.length > maxLen ? v.slice(0, maxLen) + "\u2026" : v;
      if (t === "number") return Number.isFinite(v) ? v : String(v);
      if (t === "boolean") return v;
      if (t === "bigint") return v.toString() + "n";
      if (t === "symbol") return "[Symbol]";
      if (t === "function") return "[Function]";
      if (isDomNode(v)) return "[DOM:" + String(v.nodeName).toLowerCase() + "]";
      if (v instanceof Date) return v.toISOString();
      if (v instanceof RegExp) return String(v);
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: (_a2 = v.stack) != null ? _a2 : null };
      }
      if (depth > maxDepth) return "[MaxDepth]";
      if (ancestors.has(v)) return "[Circular]";
      ancestors.add(v);
      try {
        if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
        if (v instanceof Map) {
          const o = {};
          let i = 0;
          for (const [k, val] of v) {
            const key = isPrimitiveKey(k) ? String(k) : `[key#${i}]`;
            assign(o, key, walk(val, depth + 1));
            i++;
          }
          return o;
        }
        if (v instanceof Set) {
          return Array.from(v).map((item) => walk(item, depth + 1));
        }
        const out = {};
        for (const k of Object.keys(v)) {
          try {
            assign(out, k, walk(v[k], depth + 1));
          } catch {
            assign(out, k, "[Unserializable]");
          }
        }
        return out;
      } finally {
        ancestors.delete(v);
      }
    }
    return walk(value, 0);
  }
  function assign(target, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      target[key] = value;
    }
  }

  // src/client/console-tap.ts
  var LEVELS = ["log", "info", "warn", "error", "debug"];
  var MAX_TEXT = 8e3;
  function formatArg(a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack || a.message || String(a);
    try {
      return JSON.stringify(safeStringify(a));
    } catch {
      return String(a);
    }
  }
  function installConsoleTap(size = 200) {
    var _a;
    const buf = [];
    function push(level, text) {
      if (size <= 0) return;
      const capped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\u2026" : text;
      buf.push({ level, ts: Date.now(), text: capped });
      if (buf.length > size) buf.splice(0, buf.length - size);
    }
    const originals = {};
    for (const lvl of LEVELS) {
      const prev = (_a = console[lvl]) != null ? _a : (() => {
      });
      originals[lvl] = prev;
      console[lvl] = (...args) => {
        try {
          push(lvl, args.map(formatArg).join(" "));
        } catch {
        }
        return prev.apply(console, args);
      };
    }
    const onError = (e) => {
      push("error", String((e == null ? void 0 : e.message) || (e == null ? void 0 : e.error) || "error"));
    };
    const onRejection = (e) => {
      const reason = e == null ? void 0 : e.reason;
      const text = reason instanceof Error ? reason.stack || reason.message : formatArg(reason);
      push("error", "Unhandled rejection: " + text);
    };
    const hasWindow = typeof window !== "undefined";
    if (hasWindow) {
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
    }
    let disposed = false;
    return {
      getBuffer: () => buf.slice(),
      // NOTE: dispose() restores whatever was installed at install time, so stacked
      // taps must be disposed in LIFO order; out-of-order dispose silently re-hangs
      // a removed wrapper. The overlay uses a single session-lifetime tap.
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const lvl of LEVELS) console[lvl] = originals[lvl];
        if (hasWindow) {
          window.removeEventListener("error", onError);
          window.removeEventListener("unhandledrejection", onRejection);
        }
      }
    };
  }

  // src/client/resolve-component.ts
  function baseName(file) {
    const noQuery = file.split(/[?#]/)[0];
    const last = noQuery.split(/[\\/]/).pop() || noQuery;
    return last.replace(/\.\w+$/, "");
  }
  function componentName(instance) {
    var _a;
    const type = (_a = instance == null ? void 0 : instance.type) != null ? _a : {};
    if (type.name) return String(type.name);
    if (type.__name) return String(type.__name);
    if (type.__file) return baseName(String(type.__file));
    return "Anonymous";
  }
  function resolveComponent(el) {
    var _a, _b;
    if (!el) return null;
    const start = el.__vueParentComponent;
    if (!start) return null;
    const chain = [];
    let resolvedName = null;
    let resolvedFile = null;
    let cur = start;
    let guard = 0;
    while (cur && guard++ < 1e3) {
      chain.push(componentName(cur));
      const file = (_a = cur.type) == null ? void 0 : _a.__file;
      if (!resolvedName && file) {
        resolvedName = componentName(cur);
        resolvedFile = String(file);
      }
      cur = cur.parent;
    }
    if (!resolvedName) {
      resolvedName = (_b = chain[0]) != null ? _b : "Anonymous";
      resolvedFile = null;
    }
    return { name: resolvedName, file: resolvedFile, chain };
  }
  function cssPath(el) {
    const parts = [];
    let cur = el;
    let guard = 0;
    while (cur && cur.nodeType === 1 && guard++ < 1e3) {
      if (cur.id) {
        parts.unshift("#" + cur.id);
        break;
      }
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.tagName === cur.tagName
        );
        if (sameTag.length > 1) {
          seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }
  var SRC_LOC_RE = /^(.+):(\d+):(\d+)-(\d+):(\d+)$/;
  function parseSourceLoc(raw) {
    if (!raw) return null;
    const m = SRC_LOC_RE.exec(raw);
    if (!m) return null;
    return {
      file: m[1],
      startLine: Number(m[2]),
      startColumn: Number(m[3]),
      endLine: Number(m[4]),
      endColumn: Number(m[5])
    };
  }
  function describeElement(el) {
    var _a, _b;
    return {
      tag: el.tagName.toLowerCase(),
      classes: Array.from((_a = el.classList) != null ? _a : []),
      text: ((_b = el.textContent) != null ? _b : "").replace(/\s+/g, " ").trim().slice(0, 120),
      selector: cssPath(el),
      sourceLoc: parseSourceLoc(el.getAttribute("data-src-loc"))
    };
  }

  // src/client/snapshot.ts
  var DOM_SCAN_BUDGET = 2e4;
  function findPiniaViaHook() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (typeof window === "undefined") return null;
    const hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return null;
    if (hook.pinia) return hook.pinia;
    const apps = hook.apps;
    const list = Array.isArray(apps) ? apps : apps && typeof apps[Symbol.iterator] === "function" ? Array.from(apps) : [];
    for (const entry of list) {
      const app = (_a = entry == null ? void 0 : entry.app) != null ? _a : entry;
      const gp = (_e = (_b = app == null ? void 0 : app.config) == null ? void 0 : _b.globalProperties) != null ? _e : (_d = (_c = app == null ? void 0 : app._context) == null ? void 0 : _c.config) == null ? void 0 : _d.globalProperties;
      if (gp == null ? void 0 : gp.$pinia) return gp.$pinia;
    }
    const inst = (_f = hook.app) == null ? void 0 : _f._instance;
    const gp2 = (_h = (_g = inst == null ? void 0 : inst.appContext) == null ? void 0 : _g.config) == null ? void 0 : _h.globalProperties;
    if (gp2 == null ? void 0 : gp2.$pinia) return gp2.$pinia;
    return null;
  }
  function findPiniaViaMountedRoot() {
    var _a;
    if (typeof document === "undefined") return null;
    const nodes = document.querySelectorAll("*");
    const limit = Math.min(nodes.length, DOM_SCAN_BUDGET);
    for (let i = 0; i < limit; i++) {
      const app = nodes[i].__vue_app__;
      const gp = (_a = app == null ? void 0 : app.config) == null ? void 0 : _a.globalProperties;
      if (gp == null ? void 0 : gp.$pinia) return gp.$pinia;
    }
    return null;
  }
  function findPinia() {
    var _a;
    return (_a = findPiniaViaHook()) != null ? _a : findPiniaViaMountedRoot();
  }
  function storeMap(pinia) {
    const s = pinia == null ? void 0 : pinia._s;
    if (s instanceof Map) return s;
    if (s && typeof s === "object") return new Map(Object.entries(s));
    return /* @__PURE__ */ new Map();
  }
  function snapshotStore(args = {}) {
    var _a;
    const pinia = findPinia();
    if (!pinia) return { error: "no_pinia" };
    const stores = storeMap(pinia);
    if (!args.store) return { stores: Array.from(stores.keys()) };
    const store = stores.get(args.store);
    if (!store) {
      return { error: "not_found", available: Array.from(stores.keys()) };
    }
    return { store: args.store, state: safeStringify((_a = store.$state) != null ? _a : {}) };
  }
  function snapshotComponent(args = {}, lastEl) {
    var _a, _b, _c;
    let el = null;
    if (args.last) {
      el = lastEl != null ? lastEl : null;
    } else if (args.selector) {
      try {
        el = document.querySelector(args.selector);
      } catch {
        return { error: "not_found" };
      }
    }
    if (!el) return { error: "not_found" };
    const inst = el.__vueParentComponent;
    if (!inst) return { error: "not_found" };
    const state = { ...(_a = inst.data) != null ? _a : {}, ...(_b = inst.setupState) != null ? _b : {} };
    return {
      name: componentName(inst),
      props: safeStringify((_c = inst.props) != null ? _c : {}),
      state: safeStringify(state)
    };
  }

  // src/client/redact.ts
  var REDACTED = "[REDACTED]";
  var SENSITIVE_KEY = /(pass(?:word|wd)?|secret|token|api[_-]?key|apikey|auth(?:orization)?|cookie|session|credential|private[_-]?key|access[_-]?key|client[_-]?secret)/i;
  var JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
  var BEARER = /\b(bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
  var KV = /\b([\w-]*(?:password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|session|credential|access[_-]?key)[\w-]*)\s*([:=])\s*("?)([^\s",;}]+)\3/gi;
  function redactString(s) {
    if (typeof s !== "string" || !s) return s;
    return s.replace(JWT, REDACTED).replace(BEARER, (_m, scheme) => `${scheme} ${REDACTED}`).replace(KV, (_m, key, sep) => `${key}${sep}${REDACTED}`);
  }
  function redactDeep(value, depth = 0) {
    if (depth > 12) return value;
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) {
      return value.map((v) => redactDeep(v, depth + 1));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) {
        const v = value[key];
        out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(v, depth + 1);
      }
      return out;
    }
    return value;
  }
  function redactConsole(entries) {
    return entries.map((e) => ({ ...e, text: redactString(e.text) }));
  }

  // src/client/ws-client.ts
  var OPEN = 1;
  var MAX_BACKOFF_MS = 1e4;
  function defaultFactory(url) {
    return new WebSocket(url);
  }
  function pageUrl() {
    return typeof location !== "undefined" ? location.href : "";
  }
  function createWsClient(opts) {
    const {
      url,
      tabId,
      getConsole,
      getLastEl,
      onStatus,
      wsFactory = defaultFactory,
      reconnectDelayMs = 1e3
    } = opts;
    let ws = null;
    let closedByUser = false;
    let attempt = 0;
    let reconnectTimer = null;
    function handleRequest(kind, args) {
      const a = args != null ? args : {};
      if (kind === "console") {
        const level = typeof a.level === "string" ? a.level : void 0;
        const entries = redactConsole(getConsole());
        return {
          entries: level ? entries.filter((e) => e.level === level) : entries
        };
      }
      if (kind === "store") {
        const r2 = snapshotStore({ store: a.store });
        return "state" in r2 ? { ...r2, state: redactDeep(r2.state) } : r2;
      }
      const r = snapshotComponent(
        {
          selector: a.selector,
          last: a.last
        },
        getLastEl()
      );
      if ("error" in r) return r;
      return { ...r, props: redactDeep(r.props), state: redactDeep(r.state) };
    }
    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || msg.type !== "request" || typeof msg.requestId !== "string") {
        return;
      }
      const requestId = msg.requestId;
      try {
        const data = handleRequest(msg.kind, msg.args);
        send({ type: "reply", requestId, data });
      } catch (e) {
        send({
          type: "reply",
          requestId,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
    function send(obj) {
      if (ws && ws.readyState === OPEN) {
        try {
          ws.send(JSON.stringify(obj));
        } catch {
        }
      }
    }
    function scheduleReconnect() {
      if (closedByUser || reconnectTimer) return;
      const delay = Math.min(reconnectDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
      attempt++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }
    function connect() {
      if (closedByUser) return;
      let sock;
      try {
        sock = wsFactory(url);
      } catch {
        scheduleReconnect();
        return;
      }
      ws = sock;
      sock.onopen = () => {
        attempt = 0;
        onStatus == null ? void 0 : onStatus(true);
        send({ type: "hello", tabId, url: pageUrl() });
      };
      sock.onmessage = (ev) => onMessage(ev == null ? void 0 : ev.data);
      sock.onclose = () => {
        onStatus == null ? void 0 : onStatus(false);
        if (ws === sock) ws = null;
        scheduleReconnect();
      };
      sock.onerror = () => {
        try {
          sock.close();
        } catch {
        }
      };
    }
    connect();
    return {
      isConnected: () => !!ws && ws.readyState === OPEN,
      close: () => {
        closedByUser = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (ws) {
          try {
            ws.close();
          } catch {
          }
          ws = null;
        }
      }
    };
  }

  // src/client/overlay.ts
  var HOST_ID = "__claude_feedback_root";
  var STYLE = `
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
  function createOverlay(deps) {
    const doc = document;
    const win = window;
    let host = null;
    let root;
    let panel;
    let textarea;
    let metaEl;
    let errEl;
    let sendBtn;
    let pickHint;
    let box;
    let tip;
    let open = false;
    let picking = false;
    let submitting = false;
    let selectedEl = null;
    function el(tag, cls) {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      return n;
    }
    function ensureMounted() {
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
      textarea.placeholder = "\u0427\u0442\u043E \u0443\u043B\u0443\u0447\u0448\u0438\u0442\u044C / \u0447\u0442\u043E \u043D\u0435 \u0442\u0430\u043A?";
      metaEl = el("div", "meta");
      metaEl.textContent = "\u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D";
      const row1 = el("div", "row");
      const pickBtn = el("button");
      pickBtn.textContent = "\u0412\u044B\u0434\u0435\u043B\u0438\u0442\u044C \u044D\u043B\u0435\u043C\u0435\u043D\u0442";
      pickBtn.addEventListener("click", () => startPick());
      row1.appendChild(pickBtn);
      const row2 = el("div", "row");
      sendBtn = el("button", "primary");
      sendBtn.textContent = "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C";
      sendBtn.addEventListener("click", () => void submit());
      const cancelBtn = el("button");
      cancelBtn.textContent = "\u041E\u0442\u043C\u0435\u043D\u0430";
      cancelBtn.addEventListener("click", () => close());
      row2.appendChild(sendBtn);
      row2.appendChild(cancelBtn);
      errEl = el("div", "err");
      panel.append(title, textarea, metaEl, row1, row2, errEl);
      root.appendChild(panel);
      pickHint = el("div", "pickhint hidden");
      pickHint.textContent = "\u041A\u043B\u0438\u043A\u043D\u0438 \u043F\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0443 \xB7 Esc \u2014 \u043E\u0442\u043C\u0435\u043D\u0430";
      box = el("div", "box hidden");
      tip = el("div", "tip hidden");
      root.append(pickHint, box, tip);
      win.addEventListener("visibilitychange", onVisibility);
      win.addEventListener("beforeunload", cancelPick);
    }
    function setMeta() {
      if (!selectedEl) {
        metaEl.textContent = "\u042D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D";
        return;
      }
      const d = describeElement(selectedEl);
      const c = resolveComponent(selectedEl);
      metaEl.textContent = c ? `<${d.tag}> \xB7 ${c.name}${c.file ? " (" + c.file + ")" : ""}` : `<${d.tag}> \xB7 ${d.selector}`;
    }
    function showError(msg) {
      errEl.textContent = msg;
    }
    function openModal() {
      ensureMounted();
      if (open) return;
      open = true;
      errEl.textContent = "";
      panel.classList.remove("hidden");
      setMeta();
      textarea.focus();
    }
    function close() {
      if (!host) return;
      cancelPick();
      open = false;
      panel.classList.add("hidden");
    }
    function pathHasHost(ev) {
      var _a, _b;
      const path = (_b = (_a = ev.composedPath) == null ? void 0 : _a.call(ev)) != null ? _b : [];
      return host ? path.includes(host) : false;
    }
    function targetUnder(ev) {
      var _a, _b;
      const path = (_b = (_a = ev.composedPath) == null ? void 0 : _a.call(ev)) != null ? _b : [];
      for (const t of path) {
        if (t instanceof Element && t !== host) return t;
      }
      return ev.target instanceof Element ? ev.target : null;
    }
    function onMove(ev) {
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
    function onClick(ev) {
      var _a;
      if (!picking) return;
      if (pathHasHost(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const t = targetUnder(ev);
      selectedEl = t;
      (_a = deps.onPick) == null ? void 0 : _a.call(deps, t);
      cancelPick();
      openModalAfterPick();
    }
    function onKey(ev) {
      if (picking && ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancelPick();
        openModalAfterPick();
      }
    }
    function onVisibility() {
      if (doc.visibilityState === "hidden") cancelPick();
    }
    function openModalAfterPick() {
      open = false;
      openModal();
    }
    function startPick() {
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
    function cancelPick() {
      if (!picking) return;
      picking = false;
      if (pickHint) pickHint.classList.add("hidden");
      if (box) box.classList.add("hidden");
      if (tip) tip.classList.add("hidden");
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
    }
    async function submit() {
      var _a;
      if (submitting) return;
      submitting = true;
      sendBtn.disabled = true;
      showError("");
      const payload = {
        url: typeof location !== "undefined" ? location.href : "",
        message: textarea.value,
        element: selectedEl ? describeElement(selectedEl) : null,
        component: selectedEl ? resolveComponent(selectedEl) : null,
        console: redactConsole(deps.getConsole()),
        tabId: deps.tabId
      };
      try {
        const res = await deps.send(payload);
        if (res.ok) {
          textarea.value = "";
          selectedEl = null;
          (_a = deps.onPick) == null ? void 0 : _a.call(deps, null);
          close();
        } else if (res.status === 413) {
          showError("\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u2014 \u0441\u043E\u043A\u0440\u0430\u0442\u0438 \u0438 \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0441\u043D\u043E\u0432\u0430.");
        } else {
          showError("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u2014 dev bridge \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D?");
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
      }
    };
  }

  // src/client/index.ts
  function genTabId() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
      }
    } catch {
    }
    return "tab_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/__claude_feedback/ws`;
  }
  function postFeedback(payload) {
    return fetch("/__claude_feedback/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((r) => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false, status: 0 }));
  }
  function boot() {
    var _a, _b, _c;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (window.__claude_feedback_booted__) return;
    window.__claude_feedback_booted__ = true;
    const cfg = (_a = window.__CLAUDE_FEEDBACK_CFG__) != null ? _a : {};
    const hotkey = (_b = cfg.hotkey) != null ? _b : "KeyC";
    const tabId = genTabId();
    const tap = installConsoleTap((_c = cfg.consoleBufferSize) != null ? _c : 200);
    const overlay = createOverlay({
      tabId,
      getConsole: () => tap.getBuffer(),
      send: postFeedback
    });
    createWsClient({
      url: wsUrl(),
      tabId,
      getConsole: () => tap.getBuffer(),
      getLastEl: () => overlay.lastEl()
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.altKey && e.code === hotkey && !e.repeat) {
          e.preventDefault();
          overlay.open();
        }
      },
      true
    );
  }
  boot();
})();
