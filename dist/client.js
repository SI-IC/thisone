"use strict";
(() => {
  // src/client/base-name.ts
  function baseName(file) {
    const noQuery = file.split(/[?#]/)[0];
    const last = noQuery.split(/[\\/]/).pop() || noQuery;
    return last.replace(/\.\w+$/, "");
  }

  // src/client/resolve-component-react.ts
  var HOC_SYMBOL_TAGS = /* @__PURE__ */ new Set([
    "Symbol(react.memo)",
    "Symbol(react.forward_ref)"
  ]);
  function innerTarget(type) {
    if (type && typeof type === "object") {
      if (type.type) return type.type;
      if (type.render) return type.render;
    }
    return void 0;
  }
  function isComponentFiberType(type) {
    if (typeof type === "function") return true;
    if (type && typeof type === "object" && typeof type.$$typeof === "symbol") {
      return HOC_SYMBOL_TAGS.has(type.$$typeof.toString());
    }
    return false;
  }
  function reactComponentName(type) {
    if (type == null ? void 0 : type.displayName) return String(type.displayName);
    if (type == null ? void 0 : type.name) return String(type.name);
    if (type == null ? void 0 : type.__name) return String(type.__name);
    if (type == null ? void 0 : type.__file) return baseName(String(type.__file));
    const inner = innerTarget(type);
    if (inner) return reactComponentName(inner);
    return "Anonymous";
  }
  function fileOf(type, elementType) {
    var _a2, _b, _c, _d, _e;
    return (_e = (_c = (_b = type == null ? void 0 : type.__file) != null ? _b : (_a2 = innerTarget(type)) == null ? void 0 : _a2.__file) != null ? _c : elementType == null ? void 0 : elementType.__file) != null ? _e : (_d = innerTarget(elementType)) == null ? void 0 : _d.__file;
  }
  function getReactFiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  }
  function resolveReactComponent(el) {
    var _a2, _b;
    if (!el) return null;
    const key = getReactFiberKey(el);
    if (!key) return null;
    const start = el[key];
    if (!start) return null;
    const chain = [];
    let resolvedName = null;
    let resolvedFile = null;
    let cur = start;
    let guard = 0;
    while (cur && guard++ < 1e3) {
      const type = cur.type;
      if (isComponentFiberType(type)) {
        const name = reactComponentName(type);
        const rawFile = fileOf(type, cur.elementType);
        const file = rawFile ? String(rawFile) : null;
        chain.push({ name, file });
        if (!resolvedName && file) {
          resolvedName = name;
          resolvedFile = file;
        }
      }
      cur = cur.return;
    }
    if (!resolvedName) {
      resolvedName = (_b = (_a2 = chain[0]) == null ? void 0 : _a2.name) != null ? _b : "Anonymous";
      resolvedFile = null;
    }
    return { name: resolvedName, file: resolvedFile, chain };
  }

  // src/client/resolve-component-preact.ts
  function preactComponentName(type) {
    if (type == null ? void 0 : type.__name) return String(type.__name);
    if (type == null ? void 0 : type.displayName) return String(type.displayName);
    if (type == null ? void 0 : type.name) return String(type.name);
    if (type == null ? void 0 : type.__file) return baseName(String(type.__file));
    return "Anonymous";
  }
  function isComponentVnodeType(type) {
    if (typeof type !== "function") return false;
    return type !== window.__THISONE_PREACT_FRAGMENT__;
  }
  function resolvePreactComponent(el) {
    var _a2, _b;
    if (!el) return null;
    const map = window.__THISONE_PREACT_MAP__;
    if (!map) return null;
    const start = map.get(el);
    if (!start) return null;
    const chain = [];
    let resolvedName = null;
    let resolvedFile = null;
    let cur = start;
    let guard = 0;
    while (cur && guard++ < 1e3) {
      const type = cur.type;
      if (isComponentVnodeType(type)) {
        const name = preactComponentName(type);
        const file = (type == null ? void 0 : type.__file) ? String(type.__file) : null;
        chain.push({ name, file });
        if (!resolvedName && file) {
          resolvedName = name;
          resolvedFile = file;
        }
      }
      cur = cur.__;
    }
    if (!resolvedName) {
      resolvedName = (_b = (_a2 = chain[0]) == null ? void 0 : _a2.name) != null ? _b : "Anonymous";
      resolvedFile = null;
    }
    return { name: resolvedName, file: resolvedFile, chain };
  }

  // src/client/resolve-component-svelte.ts
  function resolveSvelteComponent(el) {
    var _a2;
    if (!el) return null;
    const meta = el.__svelte_meta;
    if (!meta) return null;
    const chain = [];
    let childFile = meta.loc.file;
    let cur = meta.parent;
    let guard = 0;
    while (cur && guard++ < 1e3) {
      if (cur.type === "component") {
        const name = (_a2 = cur.componentTag) != null ? _a2 : baseName(childFile);
        chain.push({ name, file: childFile });
        childFile = cur.file;
      }
      cur = cur.parent;
    }
    chain.push({ name: baseName(childFile), file: childFile });
    return { name: chain[0].name, file: chain[0].file, chain };
  }

  // src/client/resolve-component.ts
  function componentName(instance) {
    var _a2;
    const type = (_a2 = instance == null ? void 0 : instance.type) != null ? _a2 : {};
    if (type.name) return String(type.name);
    if (type.__name) return String(type.__name);
    if (type.__file) return baseName(String(type.__file));
    return "Anonymous";
  }
  function resolveComponent(el) {
    if (!el) return null;
    if (el.__vueParentComponent) return resolveVueComponent(el);
    const react = resolveReactComponent(el);
    if (react) return react;
    const preact = resolvePreactComponent(el);
    if (preact) return preact;
    return resolveSvelteComponent(el);
  }
  function resolveVueComponent(el) {
    var _a2, _b, _c;
    if (!el) return null;
    const start = el.__vueParentComponent;
    if (!start) return null;
    const chain = [];
    let resolvedName = null;
    let resolvedFile = null;
    let cur = start;
    let guard = 0;
    while (cur && guard++ < 1e3) {
      const name = componentName(cur);
      const file = ((_a2 = cur.type) == null ? void 0 : _a2.__file) ? String(cur.type.__file) : null;
      chain.push({ name, file });
      if (!resolvedName && file) {
        resolvedName = name;
        resolvedFile = file;
      }
      cur = cur.parent;
    }
    if (!resolvedName) {
      resolvedName = (_c = (_b = chain[0]) == null ? void 0 : _b.name) != null ? _c : "Anonymous";
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
    var _a2, _b;
    return {
      tag: el.tagName.toLowerCase(),
      classes: Array.from((_a2 = el.classList) != null ? _a2 : []),
      text: ((_b = el.textContent) != null ? _b : "").replace(/\s+/g, " ").trim().slice(0, 120),
      selector: cssPath(el),
      sourceLoc: parseSourceLoc(el.getAttribute("data-src-loc"))
    };
  }
  function formatElementPath(el) {
    const d = describeElement(el);
    const c = resolveComponent(el);
    const tag = `<${d.tag}>`;
    if (!c) return `${tag} \xB7 ${d.selector}`;
    if (d.sourceLoc) {
      const l = d.sourceLoc;
      return `${tag} \xB7 ${c.name} \xB7 ${l.file}:${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
    }
    return c.file ? `${tag} \xB7 ${c.name} (${c.file})` : `${tag} \xB7 ${c.name}`;
  }
  function collapseConsecutive(entries) {
    const labels = [];
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      let count = 1;
      while (i + count < entries.length && entries[i + count].name === entry.name && entries[i + count].file === entry.file) {
        count++;
      }
      const name = count > 1 ? `${entry.name} \xD7${count}` : entry.name;
      labels.push(entry.file ? `${name} (${entry.file})` : name);
      i += count;
    }
    return labels;
  }
  function formatElementPathFromRoot(el) {
    const d = describeElement(el);
    const c = resolveComponent(el);
    const tag = `<${d.tag}>`;
    if (!c) return `${tag} \xB7 ${d.selector}`;
    const entries = c.chain.length > 0 ? c.chain : [{ name: c.name, file: c.file }];
    const breadcrumb = collapseConsecutive([...entries].reverse()).join(" \u203A ");
    if (d.sourceLoc) {
      const l = d.sourceLoc;
      return `${breadcrumb} \u203A ${tag} ${l.startLine}:${l.startColumn}-${l.endLine}:${l.endColumn}`;
    }
    return `${breadcrumb} \u203A ${tag}`;
  }

  // node_modules/.pnpm/modern-screenshot@4.7.0/node_modules/modern-screenshot/dist/index.mjs
  var _P = "p".charCodeAt(0);
  var _H = "H".charCodeAt(0);
  var _Y = "Y".charCodeAt(0);
  var _S = "s".charCodeAt(0);
  var PREFIX = "[modern-screenshot]";
  var IN_BROWSER = typeof window !== "undefined";
  var SUPPORT_WEB_WORKER = IN_BROWSER && "Worker" in window;
  var SUPPORT_ATOB = IN_BROWSER && "atob" in window;
  var SUPPORT_BTOA = IN_BROWSER && "btoa" in window;
  var _a;
  var USER_AGENT = IN_BROWSER ? (_a = window.navigator) == null ? void 0 : _a.userAgent : "";
  var IN_CHROME = USER_AGENT.includes("Chrome");
  var IN_SAFARI = USER_AGENT.includes("AppleWebKit") && !IN_CHROME;
  var IN_FIREFOX = USER_AGENT.includes("Firefox");
  var isContext = (value) => value && "__CONTEXT__" in value;
  var isCssFontFaceRule = (rule) => rule.constructor.name === "CSSFontFaceRule";
  var isCSSImportRule = (rule) => rule.constructor.name === "CSSImportRule";
  var isLayerBlockRule = (rule) => rule.constructor.name === "CSSLayerBlockRule";
  var isElementNode = (node) => node.nodeType === 1;
  var isSVGElementNode = (node) => typeof node.className === "object";
  var isSVGImageElementNode = (node) => node.tagName === "image";
  var isSVGUseElementNode = (node) => node.tagName === "use";
  var isHTMLElementNode = (node) => isElementNode(node) && typeof node.style !== "undefined" && !isSVGElementNode(node);
  var isCommentNode = (node) => node.nodeType === 8;
  var isTextNode = (node) => node.nodeType === 3;
  var isImageElement = (node) => node.tagName === "IMG";
  var isVideoElement = (node) => node.tagName === "VIDEO";
  var isCanvasElement = (node) => node.tagName === "CANVAS";
  var isTextareaElement = (node) => node.tagName === "TEXTAREA";
  var isInputElement = (node) => node.tagName === "INPUT";
  var isStyleElement = (node) => node.tagName === "STYLE";
  var isScriptElement = (node) => node.tagName === "SCRIPT";
  var isSelectElement = (node) => node.tagName === "SELECT";
  var isSlotElement = (node) => node.tagName === "SLOT";
  var isIFrameElement = (node) => node.tagName === "IFRAME";
  var consoleWarn = (...args) => console.warn(PREFIX, ...args);
  function supportWebp(ownerDocument) {
    var _a2;
    const canvas = (_a2 = ownerDocument == null ? void 0 : ownerDocument.createElement) == null ? void 0 : _a2.call(ownerDocument, "canvas");
    if (canvas) {
      canvas.height = canvas.width = 1;
    }
    return Boolean(canvas) && "toDataURL" in canvas && Boolean(canvas.toDataURL("image/webp").includes("image/webp"));
  }
  var isDataUrl = (url) => url.startsWith("data:");
  function resolveUrl(url, baseUrl) {
    if (url.match(/^[a-z]+:\/\//i))
      return url;
    if (IN_BROWSER && url.match(/^\/\//))
      return window.location.protocol + url;
    if (url.match(/^[a-z]+:/i))
      return url;
    if (!IN_BROWSER)
      return url;
    const doc = getDocument().implementation.createHTMLDocument();
    const base = doc.createElement("base");
    const a = doc.createElement("a");
    doc.head.appendChild(base);
    doc.body.appendChild(a);
    if (baseUrl)
      base.href = baseUrl;
    a.href = url;
    return a.href;
  }
  function getDocument(target) {
    var _a2;
    return (_a2 = target && isElementNode(target) ? target == null ? void 0 : target.ownerDocument : target) != null ? _a2 : window.document;
  }
  var XMLNS = "http://www.w3.org/2000/svg";
  function createSvg(width, height, ownerDocument) {
    const svg = getDocument(ownerDocument).createElementNS(XMLNS, "svg");
    svg.setAttributeNS(null, "width", width.toString());
    svg.setAttributeNS(null, "height", height.toString());
    svg.setAttributeNS(null, "viewBox", `0 0 ${width} ${height}`);
    return svg;
  }
  function svgToDataUrl(svg, removeControlCharacter) {
    let xhtml = new XMLSerializer().serializeToString(svg);
    if (removeControlCharacter) {
      xhtml = xhtml.replace(/[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "");
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xhtml)}`;
  }
  function readBlob(blob, type) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error(`Failed read blob to ${type}`));
      if (type === "dataUrl") {
        reader.readAsDataURL(blob);
      } else if (type === "arrayBuffer") {
        reader.readAsArrayBuffer(blob);
      }
    });
  }
  var blobToDataUrl = (blob) => readBlob(blob, "dataUrl");
  function createImage(url, ownerDocument) {
    const img = getDocument(ownerDocument).createElement("img");
    img.decoding = "sync";
    img.loading = "eager";
    img.src = url;
    return img;
  }
  function loadMedia(media, options) {
    return new Promise((resolve) => {
      const { timeout, ownerDocument, onError: userOnError, onWarn } = options != null ? options : {};
      const node = typeof media === "string" ? createImage(media, getDocument(ownerDocument)) : media;
      let timer = null;
      let removeEventListeners = null;
      function onResolve() {
        resolve(node);
        timer && clearTimeout(timer);
        removeEventListeners == null ? void 0 : removeEventListeners();
      }
      if (timeout) {
        timer = setTimeout(onResolve, timeout);
      }
      if (isVideoElement(node)) {
        const currentSrc = node.currentSrc || node.src;
        if (!currentSrc) {
          if (node.poster) {
            return loadMedia(node.poster, options).then(resolve);
          }
          return onResolve();
        }
        if (node.readyState >= 2) {
          return onResolve();
        }
        const onLoadeddata = onResolve;
        const onError = (error) => {
          onWarn == null ? void 0 : onWarn(
            "Failed video load",
            currentSrc,
            error
          );
          userOnError == null ? void 0 : userOnError(error);
          onResolve();
        };
        removeEventListeners = () => {
          node.removeEventListener("loadeddata", onLoadeddata);
          node.removeEventListener("error", onError);
        };
        node.addEventListener("loadeddata", onLoadeddata, { once: true });
        node.addEventListener("error", onError, { once: true });
      } else {
        const currentSrc = isSVGImageElementNode(node) ? node.href.baseVal : node.currentSrc || node.src;
        if (!currentSrc) {
          return onResolve();
        }
        const onLoad = async () => {
          if (isImageElement(node) && "decode" in node) {
            try {
              await node.decode();
            } catch (error) {
              onWarn == null ? void 0 : onWarn(
                "Failed to decode image, trying to render anyway",
                node.dataset.originalSrc || currentSrc,
                error
              );
            }
          }
          onResolve();
        };
        const onError = (error) => {
          onWarn == null ? void 0 : onWarn(
            "Failed image load",
            node.dataset.originalSrc || currentSrc,
            error
          );
          onResolve();
        };
        if (isImageElement(node) && node.complete) {
          return onLoad();
        }
        removeEventListeners = () => {
          node.removeEventListener("load", onLoad);
          node.removeEventListener("error", onError);
        };
        node.addEventListener("load", onLoad, { once: true });
        node.addEventListener("error", onError, { once: true });
      }
    });
  }
  async function waitUntilLoad(node, options) {
    if (isHTMLElementNode(node)) {
      if (isImageElement(node) || isVideoElement(node)) {
        await loadMedia(node, options);
      } else {
        await Promise.all(
          ["img", "video"].flatMap((selectors) => {
            return Array.from(node.querySelectorAll(selectors)).map((el) => loadMedia(el, options));
          })
        );
      }
    }
  }
  var uuid = /* @__PURE__ */ (function uuid2() {
    let counter = 0;
    const random = () => `0000${(Math.random() * 36 ** 4 << 0).toString(36)}`.slice(-4);
    return () => {
      counter += 1;
      return `u${random()}${counter}`;
    };
  })();
  function splitFontFamily(fontFamily) {
    return fontFamily == null ? void 0 : fontFamily.split(",").map((val) => val.trim().replace(/"|'/g, "").toLowerCase()).filter(Boolean);
  }
  var uid = 0;
  function createLogger(debug) {
    const prefix = `${PREFIX}[#${uid}]`;
    uid++;
    return {
      // eslint-disable-next-line no-console
      time: (label) => debug && console.time(`${prefix} ${label}`),
      // eslint-disable-next-line no-console
      timeEnd: (label) => debug && console.timeEnd(`${prefix} ${label}`),
      warn: (...args) => debug && consoleWarn(...args)
    };
  }
  function getDefaultRequestInit(bypassingCache) {
    return {
      cache: bypassingCache ? "no-cache" : "force-cache"
    };
  }
  async function orCreateContext(node, options) {
    return isContext(node) ? node : createContext(node, { ...options, autoDestruct: true });
  }
  async function createContext(node, options) {
    var _a2, _b, _c, _d, _e;
    const { scale = 1, workerUrl, workerNumber = 1 } = options || {};
    const debug = Boolean(options == null ? void 0 : options.debug);
    const features = (_a2 = options == null ? void 0 : options.features) != null ? _a2 : true;
    const ownerDocument = (_b = node.ownerDocument) != null ? _b : IN_BROWSER ? window.document : void 0;
    const ownerWindow = (_d = (_c = node.ownerDocument) == null ? void 0 : _c.defaultView) != null ? _d : IN_BROWSER ? window : void 0;
    const requests = /* @__PURE__ */ new Map();
    const context = {
      // Options
      width: 0,
      height: 0,
      quality: 1,
      type: "image/png",
      scale,
      backgroundColor: null,
      style: null,
      filter: null,
      maximumCanvasSize: 0,
      timeout: 3e4,
      progress: null,
      debug,
      fetch: {
        requestInit: getDefaultRequestInit((_e = options == null ? void 0 : options.fetch) == null ? void 0 : _e.bypassingCache),
        placeholderImage: "data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        bypassingCache: false,
        ...options == null ? void 0 : options.fetch
      },
      fetchFn: null,
      font: {},
      drawImageInterval: 100,
      workerUrl: null,
      workerNumber,
      onCloneEachNode: null,
      onCloneNode: null,
      onEmbedNode: null,
      onCreateForeignObjectSvg: null,
      includeStyleProperties: null,
      autoDestruct: false,
      ...options,
      // InternalContext
      __CONTEXT__: true,
      log: createLogger(debug),
      node,
      ownerDocument,
      ownerWindow,
      dpi: scale === 1 ? null : 96 * scale,
      svgStyleElement: createStyleElement(ownerDocument),
      svgDefsElement: ownerDocument == null ? void 0 : ownerDocument.createElementNS(XMLNS, "defs"),
      svgStyles: /* @__PURE__ */ new Map(),
      defaultComputedStyles: /* @__PURE__ */ new Map(),
      workers: [
        ...Array.from({
          length: SUPPORT_WEB_WORKER && workerUrl && workerNumber ? workerNumber : 0
        })
      ].map(() => {
        try {
          const worker = new Worker(workerUrl);
          worker.onmessage = async (event) => {
            var _a3, _b2, _c2, _d2;
            const { url, result } = event.data;
            if (result) {
              (_b2 = (_a3 = requests.get(url)) == null ? void 0 : _a3.resolve) == null ? void 0 : _b2.call(_a3, result);
            } else {
              (_d2 = (_c2 = requests.get(url)) == null ? void 0 : _c2.reject) == null ? void 0 : _d2.call(_c2, new Error(`Error receiving message from worker: ${url}`));
            }
          };
          worker.onmessageerror = (event) => {
            var _a3, _b2;
            const { url } = event.data;
            (_b2 = (_a3 = requests.get(url)) == null ? void 0 : _a3.reject) == null ? void 0 : _b2.call(_a3, new Error(`Error receiving message from worker: ${url}`));
          };
          return worker;
        } catch (error) {
          context.log.warn("Failed to new Worker", error);
          return null;
        }
      }).filter(Boolean),
      fontFamilies: /* @__PURE__ */ new Map(),
      fontCssTexts: /* @__PURE__ */ new Map(),
      acceptOfImage: `${[
        supportWebp(ownerDocument) && "image/webp",
        "image/svg+xml",
        "image/*",
        "*/*"
      ].filter(Boolean).join(",")};q=0.8`,
      requests,
      drawImageCount: 0,
      tasks: [],
      features,
      isEnable: (key) => {
        var _a3, _b2;
        if (key === "restoreScrollPosition") {
          return typeof features === "boolean" ? false : (_a3 = features[key]) != null ? _a3 : false;
        }
        if (typeof features === "boolean") {
          return features;
        }
        return (_b2 = features[key]) != null ? _b2 : true;
      },
      shadowRoots: []
    };
    context.log.time("wait until load");
    await waitUntilLoad(node, { timeout: context.timeout, onWarn: context.log.warn });
    context.log.timeEnd("wait until load");
    const { width, height } = resolveBoundingBox(node, context);
    context.width = width;
    context.height = height;
    return context;
  }
  function createStyleElement(ownerDocument) {
    if (!ownerDocument)
      return void 0;
    const style = ownerDocument.createElement("style");
    const cssText = style.ownerDocument.createTextNode(`
.______background-clip--text {
  background-clip: text;
  -webkit-background-clip: text;
}
`);
    style.appendChild(cssText);
    return style;
  }
  function resolveBoundingBox(node, context) {
    let { width, height } = context;
    if (isElementNode(node) && (!width || !height)) {
      const box = node.getBoundingClientRect();
      width = width || box.width || Number(node.getAttribute("width")) || 0;
      height = height || box.height || Number(node.getAttribute("height")) || 0;
    }
    return { width, height };
  }
  async function imageToCanvas(image, context) {
    const {
      log,
      timeout,
      drawImageCount,
      drawImageInterval
    } = context;
    log.time("image to canvas");
    const loaded = await loadMedia(image, { timeout, onWarn: context.log.warn });
    const { canvas, context2d } = createCanvas(image.ownerDocument, context);
    const drawImage = () => {
      try {
        context2d == null ? void 0 : context2d.drawImage(loaded, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        context.log.warn("Failed to drawImage", error);
      }
    };
    drawImage();
    if (context.isEnable("fixSvgXmlDecode")) {
      for (let i = 0; i < drawImageCount; i++) {
        await new Promise((resolve) => {
          setTimeout(() => {
            context2d == null ? void 0 : context2d.clearRect(0, 0, canvas.width, canvas.height);
            drawImage();
            resolve();
          }, i + drawImageInterval);
        });
      }
    }
    context.drawImageCount = 0;
    log.timeEnd("image to canvas");
    return canvas;
  }
  function createCanvas(ownerDocument, context) {
    const { width, height, scale, backgroundColor, maximumCanvasSize: max } = context;
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (max) {
      if (canvas.width > max || canvas.height > max) {
        if (canvas.width > max && canvas.height > max) {
          if (canvas.width > canvas.height) {
            canvas.height *= max / canvas.width;
            canvas.width = max;
          } else {
            canvas.width *= max / canvas.height;
            canvas.height = max;
          }
        } else if (canvas.width > max) {
          canvas.height *= max / canvas.width;
          canvas.width = max;
        } else {
          canvas.width *= max / canvas.height;
          canvas.height = max;
        }
      }
    }
    const context2d = canvas.getContext("2d");
    if (context2d && backgroundColor) {
      context2d.fillStyle = backgroundColor;
      context2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    return { canvas, context2d };
  }
  function cloneCanvas(canvas, context) {
    if (canvas.ownerDocument) {
      try {
        const dataURL = canvas.toDataURL();
        if (dataURL !== "data:,") {
          return createImage(dataURL, canvas.ownerDocument);
        }
      } catch (error) {
        context.log.warn("Failed to clone canvas", error);
      }
    }
    const cloned = canvas.cloneNode(false);
    const ctx = canvas.getContext("2d");
    const clonedCtx = cloned.getContext("2d");
    try {
      if (ctx && clonedCtx) {
        clonedCtx.putImageData(
          ctx.getImageData(0, 0, canvas.width, canvas.height),
          0,
          0
        );
      }
      return cloned;
    } catch (error) {
      context.log.warn("Failed to clone canvas", error);
    }
    return cloned;
  }
  function cloneIframe(iframe, context) {
    var _a2;
    try {
      if ((_a2 = iframe == null ? void 0 : iframe.contentDocument) == null ? void 0 : _a2.documentElement) {
        return cloneNode(iframe.contentDocument.documentElement, context);
      }
    } catch (error) {
      context.log.warn("Failed to clone iframe", error);
    }
    return iframe.cloneNode(false);
  }
  function cloneImage(image) {
    const cloned = image.cloneNode(false);
    if (image.currentSrc && image.currentSrc !== image.src) {
      cloned.src = image.currentSrc;
      cloned.srcset = "";
    }
    if (cloned.loading === "lazy") {
      cloned.loading = "eager";
    }
    return cloned;
  }
  async function cloneVideo(video, context) {
    if (video.ownerDocument && !video.currentSrc && video.poster) {
      return createImage(video.poster, video.ownerDocument);
    }
    const cloned = video.cloneNode(false);
    cloned.crossOrigin = "anonymous";
    if (video.currentSrc && video.currentSrc !== video.src) {
      cloned.src = video.currentSrc;
    }
    const ownerDocument = cloned.ownerDocument;
    if (ownerDocument) {
      let canPlay = true;
      await loadMedia(cloned, { onError: () => canPlay = false, onWarn: context.log.warn });
      if (!canPlay) {
        if (video.poster) {
          return createImage(video.poster, video.ownerDocument);
        }
        return cloned;
      }
      cloned.currentTime = video.currentTime;
      await new Promise((resolve) => {
        cloned.addEventListener("seeked", resolve, { once: true });
      });
      const canvas = ownerDocument.createElement("canvas");
      canvas.width = video.offsetWidth;
      canvas.height = video.offsetHeight;
      try {
        const ctx = canvas.getContext("2d");
        if (ctx)
          ctx.drawImage(cloned, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        context.log.warn("Failed to clone video", error);
        if (video.poster) {
          return createImage(video.poster, video.ownerDocument);
        }
        return cloned;
      }
      return cloneCanvas(canvas, context);
    }
    return cloned;
  }
  function cloneElement(node, context) {
    if (isCanvasElement(node)) {
      return cloneCanvas(node, context);
    }
    if (isIFrameElement(node)) {
      return cloneIframe(node, context);
    }
    if (isImageElement(node)) {
      return cloneImage(node);
    }
    if (isVideoElement(node)) {
      return cloneVideo(node, context);
    }
    return node.cloneNode(false);
  }
  function getSandBox(context) {
    let sandbox = context.sandbox;
    if (!sandbox) {
      const { ownerDocument } = context;
      try {
        if (ownerDocument) {
          sandbox = ownerDocument.createElement("iframe");
          sandbox.id = `__SANDBOX__${uuid()}`;
          sandbox.width = "0";
          sandbox.height = "0";
          sandbox.style.visibility = "hidden";
          sandbox.style.position = "fixed";
          ownerDocument.body.appendChild(sandbox);
          sandbox.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>';
          context.sandbox = sandbox;
        }
      } catch (error) {
        context.log.warn("Failed to getSandBox", error);
      }
    }
    return sandbox;
  }
  var ignoredStyles = [
    "width",
    "height",
    "-webkit-text-fill-color"
  ];
  var includedAttributes = [
    "stroke",
    "fill"
  ];
  function getDefaultStyle(node, pseudoElement, context) {
    const { defaultComputedStyles } = context;
    const nodeName = node.nodeName.toLowerCase();
    const isSvgNode = isSVGElementNode(node) && nodeName !== "svg";
    const attributes = isSvgNode ? includedAttributes.map((name) => [name, node.getAttribute(name)]).filter(([, value]) => value !== null) : [];
    const key = [
      isSvgNode && "svg",
      nodeName,
      attributes.map((name, value) => `${name}=${value}`).join(","),
      pseudoElement
    ].filter(Boolean).join(":");
    if (defaultComputedStyles.has(key))
      return defaultComputedStyles.get(key);
    const sandbox = getSandBox(context);
    const sandboxWindow = sandbox == null ? void 0 : sandbox.contentWindow;
    if (!sandboxWindow)
      return /* @__PURE__ */ new Map();
    const sandboxDocument = sandboxWindow == null ? void 0 : sandboxWindow.document;
    let root;
    let el;
    if (isSvgNode) {
      root = sandboxDocument.createElementNS(XMLNS, "svg");
      el = root.ownerDocument.createElementNS(root.namespaceURI, nodeName);
      attributes.forEach(([name, value]) => {
        el.setAttributeNS(null, name, value);
      });
      root.appendChild(el);
    } else {
      root = el = sandboxDocument.createElement(nodeName);
    }
    el.textContent = " ";
    sandboxDocument.body.appendChild(root);
    const computedStyle = sandboxWindow.getComputedStyle(el, pseudoElement);
    const styles = /* @__PURE__ */ new Map();
    for (let len = computedStyle.length, i = 0; i < len; i++) {
      const name = computedStyle.item(i);
      if (ignoredStyles.includes(name))
        continue;
      styles.set(name, computedStyle.getPropertyValue(name));
    }
    sandboxDocument.body.removeChild(root);
    defaultComputedStyles.set(key, styles);
    return styles;
  }
  function getDiffStyle(style, defaultStyle, includeStyleProperties) {
    var _a2;
    const diffStyle = /* @__PURE__ */ new Map();
    const prefixs = [];
    const prefixTree = /* @__PURE__ */ new Map();
    if (includeStyleProperties) {
      for (const name of includeStyleProperties) {
        applyTo(name);
      }
    } else {
      for (let len = style.length, i = 0; i < len; i++) {
        const name = style.item(i);
        applyTo(name);
      }
    }
    for (let len = prefixs.length, i = 0; i < len; i++) {
      (_a2 = prefixTree.get(prefixs[i])) == null ? void 0 : _a2.forEach((value, name) => diffStyle.set(name, value));
    }
    function applyTo(name) {
      const value = style.getPropertyValue(name);
      const priority = style.getPropertyPriority(name);
      const subIndex = name.lastIndexOf("-");
      const prefix = subIndex > -1 ? name.substring(0, subIndex) : void 0;
      if (prefix) {
        let map = prefixTree.get(prefix);
        if (!map) {
          map = /* @__PURE__ */ new Map();
          prefixTree.set(prefix, map);
        }
        map.set(name, [value, priority]);
      }
      if (defaultStyle.get(name) === value && !priority)
        return;
      if (prefix) {
        prefixs.push(prefix);
      } else {
        diffStyle.set(name, [value, priority]);
      }
    }
    return diffStyle;
  }
  function copyCssStyles(node, cloned, isRoot, context) {
    var _a2, _b, _c, _d;
    const { ownerWindow, includeStyleProperties, currentParentNodeStyle } = context;
    const clonedStyle = cloned.style;
    const computedStyle = ownerWindow.getComputedStyle(node);
    const defaultStyle = getDefaultStyle(node, null, context);
    currentParentNodeStyle == null ? void 0 : currentParentNodeStyle.forEach((_, key) => {
      defaultStyle.delete(key);
    });
    const style = getDiffStyle(computedStyle, defaultStyle, includeStyleProperties);
    style.delete("transition-property");
    style.delete("all");
    style.delete("d");
    style.delete("content");
    if (isRoot) {
      style.delete("position");
      style.delete("margin-top");
      style.delete("margin-right");
      style.delete("margin-bottom");
      style.delete("margin-left");
      style.delete("margin-block-start");
      style.delete("margin-block-end");
      style.delete("margin-inline-start");
      style.delete("margin-inline-end");
      style.set("box-sizing", ["border-box", ""]);
    }
    if (((_a2 = style.get("background-clip")) == null ? void 0 : _a2[0]) === "text") {
      cloned.classList.add("______background-clip--text");
    }
    if (IN_CHROME) {
      if (!style.has("font-kerning"))
        style.set("font-kerning", ["normal", ""]);
      if ((((_b = style.get("overflow-x")) == null ? void 0 : _b[0]) === "hidden" || ((_c = style.get("overflow-y")) == null ? void 0 : _c[0]) === "hidden") && ((_d = style.get("text-overflow")) == null ? void 0 : _d[0]) === "ellipsis" && node.scrollWidth === node.clientWidth) {
        style.set("text-overflow", ["clip", ""]);
      }
    }
    for (let len = clonedStyle.length, i = 0; i < len; i++) {
      clonedStyle.removeProperty(clonedStyle.item(i));
    }
    style.forEach(([value, priority], name) => {
      clonedStyle.setProperty(name, value, priority);
    });
    return style;
  }
  function copyInputValue(node, cloned) {
    if (isTextareaElement(node) || isInputElement(node) || isSelectElement(node)) {
      cloned.setAttribute("value", node.value);
    }
  }
  var pseudoClasses = [
    "::before",
    "::after"
    // '::placeholder', TODO
  ];
  var scrollbarPseudoClasses = [
    "::-webkit-scrollbar",
    "::-webkit-scrollbar-button",
    // '::-webkit-scrollbar:horizontal', TODO
    "::-webkit-scrollbar-thumb",
    "::-webkit-scrollbar-track",
    "::-webkit-scrollbar-track-piece",
    // '::-webkit-scrollbar:vertical', TODO
    "::-webkit-scrollbar-corner",
    "::-webkit-resizer"
  ];
  function copyPseudoClass(node, cloned, copyScrollbar, context, addWordToFontFamilies) {
    const { ownerWindow, svgStyleElement, svgStyles, currentNodeStyle } = context;
    if (!svgStyleElement || !ownerWindow)
      return;
    function copyBy(pseudoClass) {
      var _a2;
      const computedStyle = ownerWindow.getComputedStyle(node, pseudoClass);
      let content = computedStyle.getPropertyValue("content");
      if (!content || content === "none")
        return;
      addWordToFontFamilies == null ? void 0 : addWordToFontFamilies(content);
      content = content.replace(/(')|(")|(counter\(.+\))/g, "");
      const klasses = [uuid()];
      const defaultStyle = getDefaultStyle(node, pseudoClass, context);
      currentNodeStyle == null ? void 0 : currentNodeStyle.forEach((_, key) => {
        defaultStyle.delete(key);
      });
      const style = getDiffStyle(computedStyle, defaultStyle, context.includeStyleProperties);
      style.delete("content");
      style.delete("-webkit-locale");
      if (((_a2 = style.get("background-clip")) == null ? void 0 : _a2[0]) === "text") {
        cloned.classList.add("______background-clip--text");
      }
      const cloneStyle = [
        `content: '${content}';`
      ];
      style.forEach(([value, priority], name) => {
        cloneStyle.push(`${name}: ${value}${priority ? " !important" : ""};`);
      });
      if (cloneStyle.length === 1)
        return;
      try {
        cloned.className = [cloned.className, ...klasses].join(" ");
      } catch (err) {
        context.log.warn("Failed to copyPseudoClass", err);
        return;
      }
      const cssText = cloneStyle.join("\n  ");
      let allClasses = svgStyles.get(cssText);
      if (!allClasses) {
        allClasses = [];
        svgStyles.set(cssText, allClasses);
      }
      allClasses.push(`.${klasses[0]}${pseudoClass}`);
    }
    pseudoClasses.forEach(copyBy);
    if (copyScrollbar)
      scrollbarPseudoClasses.forEach(copyBy);
  }
  var excludeParentNodes = /* @__PURE__ */ new Set([
    "symbol"
    // test/fixtures/svg.symbol.html
  ]);
  async function appendChildNode(node, cloned, child, context, addWordToFontFamilies) {
    if (isElementNode(child) && (isStyleElement(child) || isScriptElement(child)))
      return;
    if (context.filter && !context.filter(child))
      return;
    if (excludeParentNodes.has(cloned.nodeName) || excludeParentNodes.has(child.nodeName)) {
      context.currentParentNodeStyle = void 0;
    } else {
      context.currentParentNodeStyle = context.currentNodeStyle;
    }
    const childCloned = await cloneNode(child, context, false, addWordToFontFamilies);
    if (context.isEnable("restoreScrollPosition")) {
      restoreScrollPosition(node, childCloned);
    }
    cloned.appendChild(childCloned);
  }
  async function cloneChildNodes(node, cloned, context, addWordToFontFamilies) {
    var _a2;
    let firstChild = node.firstChild;
    if (isElementNode(node)) {
      if (node.shadowRoot) {
        firstChild = (_a2 = node.shadowRoot) == null ? void 0 : _a2.firstChild;
        context.shadowRoots.push(node.shadowRoot);
      }
    }
    for (let child = firstChild; child; child = child.nextSibling) {
      if (isCommentNode(child))
        continue;
      if (isElementNode(child) && isSlotElement(child) && typeof child.assignedNodes === "function") {
        const nodes = child.assignedNodes();
        for (let i = 0; i < nodes.length; i++) {
          await appendChildNode(node, cloned, nodes[i], context, addWordToFontFamilies);
        }
      } else {
        await appendChildNode(node, cloned, child, context, addWordToFontFamilies);
      }
    }
  }
  function restoreScrollPosition(node, chlidCloned) {
    if (!isHTMLElementNode(node) || !isHTMLElementNode(chlidCloned))
      return;
    const { scrollTop, scrollLeft } = node;
    if (!scrollTop && !scrollLeft) {
      return;
    }
    const { transform } = chlidCloned.style;
    const matrix = new DOMMatrix(transform);
    const { a, b, c, d } = matrix;
    matrix.a = 1;
    matrix.b = 0;
    matrix.c = 0;
    matrix.d = 1;
    matrix.translateSelf(-scrollLeft, -scrollTop);
    matrix.a = a;
    matrix.b = b;
    matrix.c = c;
    matrix.d = d;
    chlidCloned.style.transform = matrix.toString();
  }
  function applyCssStyleWithOptions(cloned, context) {
    const { backgroundColor, width, height, style: styles } = context;
    const clonedStyle = cloned.style;
    if (backgroundColor)
      clonedStyle.setProperty("background-color", backgroundColor, "important");
    if (width)
      clonedStyle.setProperty("width", `${width}px`, "important");
    if (height)
      clonedStyle.setProperty("height", `${height}px`, "important");
    if (styles) {
      for (const name in styles) clonedStyle[name] = styles[name];
    }
  }
  var NORMAL_ATTRIBUTE_RE = /^[\w-:]+$/;
  async function cloneNode(node, context, isRoot = false, addWordToFontFamilies) {
    var _a2, _b, _c, _d;
    const { ownerDocument, ownerWindow, fontFamilies, onCloneEachNode } = context;
    if (ownerDocument && isTextNode(node)) {
      if (addWordToFontFamilies && /\S/.test(node.data)) {
        addWordToFontFamilies(node.data);
      }
      return ownerDocument.createTextNode(node.data);
    }
    if (ownerDocument && ownerWindow && isElementNode(node) && (isHTMLElementNode(node) || isSVGElementNode(node))) {
      const cloned2 = await cloneElement(node, context);
      if (context.isEnable("removeAbnormalAttributes")) {
        const names = cloned2.getAttributeNames();
        for (let len = names.length, i = 0; i < len; i++) {
          const name = names[i];
          if (!NORMAL_ATTRIBUTE_RE.test(name)) {
            cloned2.removeAttribute(name);
          }
        }
      }
      const style = context.currentNodeStyle = copyCssStyles(node, cloned2, isRoot, context);
      if (isRoot)
        applyCssStyleWithOptions(cloned2, context);
      let copyScrollbar = false;
      if (context.isEnable("copyScrollbar")) {
        const overflow = [
          (_a2 = style.get("overflow-x")) == null ? void 0 : _a2[0],
          (_b = style.get("overflow-y")) == null ? void 0 : _b[0]
        ];
        copyScrollbar = overflow.includes("scroll") || (overflow.includes("auto") || overflow.includes("overlay")) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth);
      }
      const textTransform = (_c = style.get("text-transform")) == null ? void 0 : _c[0];
      const families = splitFontFamily((_d = style.get("font-family")) == null ? void 0 : _d[0]);
      const addWordToFontFamilies2 = families ? (word) => {
        if (textTransform === "uppercase") {
          word = word.toUpperCase();
        } else if (textTransform === "lowercase") {
          word = word.toLowerCase();
        } else if (textTransform === "capitalize") {
          word = word[0].toUpperCase() + word.substring(1);
        }
        families.forEach((family) => {
          let fontFamily = fontFamilies.get(family);
          if (!fontFamily) {
            fontFamilies.set(family, fontFamily = /* @__PURE__ */ new Set());
          }
          word.split("").forEach((text) => fontFamily.add(text));
        });
      } : void 0;
      copyPseudoClass(
        node,
        cloned2,
        copyScrollbar,
        context,
        addWordToFontFamilies2
      );
      copyInputValue(node, cloned2);
      if (!isVideoElement(node)) {
        await cloneChildNodes(
          node,
          cloned2,
          context,
          addWordToFontFamilies2
        );
      }
      await (onCloneEachNode == null ? void 0 : onCloneEachNode(cloned2));
      return cloned2;
    }
    const cloned = node.cloneNode(false);
    await cloneChildNodes(node, cloned, context);
    await (onCloneEachNode == null ? void 0 : onCloneEachNode(cloned));
    return cloned;
  }
  function destroyContext(context) {
    context.ownerDocument = void 0;
    context.ownerWindow = void 0;
    context.svgStyleElement = void 0;
    context.svgDefsElement = void 0;
    context.svgStyles.clear();
    context.defaultComputedStyles.clear();
    if (context.sandbox) {
      try {
        context.sandbox.remove();
      } catch (err) {
        context.log.warn("Failed to destroyContext", err);
      }
      context.sandbox = void 0;
    }
    context.workers = [];
    context.fontFamilies.clear();
    context.fontCssTexts.clear();
    context.requests.clear();
    context.tasks = [];
    context.shadowRoots = [];
  }
  function baseFetch(options) {
    const { url, timeout, responseType, ...requestInit } = options;
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : void 0;
    return fetch(url, { signal: controller.signal, ...requestInit }).then((response) => {
      if (!response.ok) {
        throw new Error("Failed fetch, not 2xx response", { cause: response });
      }
      switch (responseType) {
        case "arrayBuffer":
          return response.arrayBuffer();
        case "dataUrl":
          return response.blob().then(blobToDataUrl);
        case "text":
        default:
          return response.text();
      }
    }).finally(() => clearTimeout(timer));
  }
  function contextFetch(context, options) {
    const { url: rawUrl, requestType = "text", responseType = "text", imageDom } = options;
    let url = rawUrl;
    const {
      timeout,
      acceptOfImage,
      requests,
      fetchFn,
      fetch: {
        requestInit,
        bypassingCache,
        placeholderImage
      },
      font,
      workers,
      fontFamilies
    } = context;
    if (requestType === "image" && (IN_SAFARI || IN_FIREFOX)) {
      context.drawImageCount++;
    }
    let request = requests.get(rawUrl);
    if (!request) {
      if (bypassingCache) {
        if (bypassingCache instanceof RegExp && bypassingCache.test(url)) {
          url += (/\?/.test(url) ? "&" : "?") + (/* @__PURE__ */ new Date()).getTime();
        }
      }
      const canFontMinify = requestType.startsWith("font") && font && font.minify;
      const fontTexts = /* @__PURE__ */ new Set();
      if (canFontMinify) {
        const families = requestType.split(";")[1].split(",");
        families.forEach((family) => {
          if (!fontFamilies.has(family))
            return;
          fontFamilies.get(family).forEach((text) => fontTexts.add(text));
        });
      }
      const needFontMinify = canFontMinify && fontTexts.size;
      const baseFetchOptions = {
        url,
        timeout,
        responseType: needFontMinify ? "arrayBuffer" : responseType,
        headers: requestType === "image" ? { accept: acceptOfImage } : void 0,
        ...requestInit
      };
      request = {
        type: requestType,
        resolve: void 0,
        reject: void 0,
        response: null
      };
      request.response = (async () => {
        if (fetchFn && requestType === "image") {
          const result = await fetchFn(rawUrl);
          if (result)
            return result;
        }
        if (!IN_SAFARI && rawUrl.startsWith("http") && workers.length) {
          return new Promise((resolve, reject) => {
            const worker = workers[requests.size & workers.length - 1];
            worker.postMessage({ rawUrl, ...baseFetchOptions });
            request.resolve = resolve;
            request.reject = reject;
          });
        }
        return baseFetch(baseFetchOptions);
      })().catch((error) => {
        requests.delete(rawUrl);
        if (requestType === "image" && placeholderImage) {
          context.log.warn("Failed to fetch image base64, trying to use placeholder image", url);
          return typeof placeholderImage === "string" ? placeholderImage : placeholderImage(imageDom);
        }
        throw error;
      });
      requests.set(rawUrl, request);
    }
    return request.response;
  }
  async function replaceCssUrlToDataUrl(cssText, baseUrl, context, isImage) {
    if (!hasCssUrl(cssText))
      return cssText;
    for (const [rawUrl, url] of parseCssUrls(cssText, baseUrl)) {
      try {
        const dataUrl = await contextFetch(
          context,
          {
            url,
            requestType: isImage ? "image" : "text",
            responseType: "dataUrl"
          }
        );
        cssText = cssText.replace(toRE(rawUrl), `$1${dataUrl}$3`);
      } catch (error) {
        context.log.warn("Failed to fetch css data url", rawUrl, error);
      }
    }
    return cssText;
  }
  function hasCssUrl(cssText) {
    return /url\((['"]?)([^'"]+?)\1\)/.test(cssText);
  }
  var URL_RE = /url\((['"]?)([^'"]+?)\1\)/g;
  function parseCssUrls(cssText, baseUrl) {
    const result = [];
    cssText.replace(URL_RE, (raw, quotation, url) => {
      result.push([url, resolveUrl(url, baseUrl)]);
      return raw;
    });
    return result.filter(([url]) => !isDataUrl(url));
  }
  function toRE(url) {
    const escaped = url.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
    return new RegExp(`(url\\(['"]?)(${escaped})(['"]?\\))`, "g");
  }
  var properties = [
    "background-image",
    "border-image-source",
    "-webkit-border-image",
    "-webkit-mask-image",
    "list-style-image"
  ];
  function embedCssStyleImage(style, context) {
    return properties.map((property) => {
      const value = style.getPropertyValue(property);
      if (!value || value === "none") {
        return null;
      }
      if (IN_SAFARI || IN_FIREFOX) {
        context.drawImageCount++;
      }
      return replaceCssUrlToDataUrl(value, null, context, true).then((newValue) => {
        if (!newValue || value === newValue)
          return;
        style.setProperty(
          property,
          newValue,
          style.getPropertyPriority(property)
        );
      });
    }).filter(Boolean);
  }
  function embedImageElement(cloned, context) {
    if (isImageElement(cloned)) {
      const originalSrc = cloned.currentSrc || cloned.src;
      if (!isDataUrl(originalSrc)) {
        return [
          contextFetch(context, {
            url: originalSrc,
            imageDom: cloned,
            requestType: "image",
            responseType: "dataUrl"
          }).then((url) => {
            if (!url)
              return;
            cloned.srcset = "";
            cloned.dataset.originalSrc = originalSrc;
            cloned.src = url || "";
          })
        ];
      }
      if (IN_SAFARI || IN_FIREFOX) {
        context.drawImageCount++;
      }
    } else if (isSVGElementNode(cloned) && !isDataUrl(cloned.href.baseVal)) {
      const originalSrc = cloned.href.baseVal;
      return [
        contextFetch(context, {
          url: originalSrc,
          imageDom: cloned,
          requestType: "image",
          responseType: "dataUrl"
        }).then((url) => {
          if (!url)
            return;
          cloned.dataset.originalSrc = originalSrc;
          cloned.href.baseVal = url || "";
        })
      ];
    }
    return [];
  }
  function embedSvgUse(cloned, context) {
    var _a2;
    const { ownerDocument, svgDefsElement } = context;
    const href = (_a2 = cloned.getAttribute("href")) != null ? _a2 : cloned.getAttribute("xlink:href");
    if (!href)
      return [];
    const [svgUrl, id] = href.split("#");
    if (id) {
      const query = `#${id}`;
      const definition = context.shadowRoots.reduce(
        (res, root) => {
          return res != null ? res : root.querySelector(`svg ${query}`);
        },
        ownerDocument == null ? void 0 : ownerDocument.querySelector(`svg ${query}`)
      );
      if (svgUrl) {
        cloned.setAttribute("href", query);
      }
      if (svgDefsElement == null ? void 0 : svgDefsElement.querySelector(query))
        return [];
      if (definition) {
        svgDefsElement == null ? void 0 : svgDefsElement.appendChild(definition.cloneNode(true));
        return [];
      } else if (svgUrl) {
        return [
          contextFetch(context, {
            url: svgUrl,
            responseType: "text"
          }).then((svgData) => {
            svgDefsElement == null ? void 0 : svgDefsElement.insertAdjacentHTML("beforeend", svgData);
          })
        ];
      }
    }
    return [];
  }
  function embedNode(cloned, context) {
    const { tasks } = context;
    if (isElementNode(cloned)) {
      if (isImageElement(cloned) || isSVGImageElementNode(cloned)) {
        tasks.push(...embedImageElement(cloned, context));
      }
      if (isSVGUseElementNode(cloned)) {
        tasks.push(...embedSvgUse(cloned, context));
      }
    }
    if (isHTMLElementNode(cloned)) {
      tasks.push(...embedCssStyleImage(cloned.style, context));
    }
    cloned.childNodes.forEach((child) => {
      embedNode(child, context);
    });
  }
  async function embedWebFont(clone, context) {
    const {
      ownerDocument,
      svgStyleElement,
      fontFamilies,
      fontCssTexts,
      tasks,
      font
    } = context;
    if (!ownerDocument || !svgStyleElement || !fontFamilies.size) {
      return;
    }
    if (font && font.cssText) {
      const cssText = filterPreferredFormat(font.cssText, context);
      svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText}
`));
    } else {
      const styleSheets = Array.from(ownerDocument.styleSheets).filter((styleSheet) => {
        try {
          return "cssRules" in styleSheet && Boolean(styleSheet.cssRules.length);
        } catch (error) {
          context.log.warn(`Error while reading CSS rules from ${styleSheet.href}`, error);
          return false;
        }
      });
      const tempDoc = ownerDocument.implementation.createHTMLDocument("");
      const tempStyleEl = tempDoc.createElement("style");
      tempDoc.head.appendChild(tempStyleEl);
      const tempStyleSheet = tempStyleEl.sheet;
      await Promise.all(
        styleSheets.flatMap((styleSheet) => {
          return Array.from(styleSheet.cssRules).map(async (cssRule) => {
            if (isCSSImportRule(cssRule)) {
              const baseUrl = cssRule.href;
              let cssText = "";
              try {
                cssText = await contextFetch(context, {
                  url: baseUrl,
                  requestType: "text",
                  responseType: "text"
                });
              } catch (error) {
                context.log.warn(`Error fetch remote css import from ${baseUrl}`, error);
              }
              const replacedCssText = cssText.replace(
                URL_RE,
                (raw, quotation, url) => raw.replace(url, resolveUrl(url, baseUrl))
              );
              for (const rule of parseCss(replacedCssText)) {
                try {
                  tempStyleSheet.insertRule(rule, tempStyleSheet.cssRules.length);
                } catch (error) {
                  context.log.warn("Error inserting rule from remote css import", { rule, error });
                }
              }
            }
          });
        })
      );
      if (tempStyleSheet.cssRules.length)
        styleSheets.push(tempStyleSheet);
      const cssRules = [];
      styleSheets.forEach((sheet) => {
        unwrapCssLayers(sheet.cssRules, cssRules);
      });
      cssRules.filter((cssRule) => {
        var _a2;
        return isCssFontFaceRule(cssRule) && hasCssUrl(cssRule.style.getPropertyValue("src")) && ((_a2 = splitFontFamily(cssRule.style.getPropertyValue("font-family"))) == null ? void 0 : _a2.some((val) => fontFamilies.has(val)));
      }).forEach((value) => {
        const rule = value;
        const cssText = fontCssTexts.get(rule.cssText);
        if (cssText) {
          svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText}
`));
        } else {
          tasks.push(
            replaceCssUrlToDataUrl(
              rule.cssText,
              rule.parentStyleSheet ? rule.parentStyleSheet.href : null,
              context
            ).then((cssText2) => {
              cssText2 = filterPreferredFormat(cssText2, context);
              fontCssTexts.set(rule.cssText, cssText2);
              svgStyleElement.appendChild(ownerDocument.createTextNode(`${cssText2}
`));
            })
          );
        }
      });
    }
  }
  var COMMENTS_RE = /(\/\*[\s\S]*?\*\/)/g;
  var KEYFRAMES_RE = /((@.*?keyframes [\s\S]*?){([\s\S]*?}\s*?)})/gi;
  function parseCss(source) {
    if (source == null)
      return [];
    const result = [];
    let cssText = source.replace(COMMENTS_RE, "");
    while (true) {
      const matches = KEYFRAMES_RE.exec(cssText);
      if (!matches)
        break;
      result.push(matches[0]);
    }
    cssText = cssText.replace(KEYFRAMES_RE, "");
    const IMPORT_RE = /@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi;
    const UNIFIED_RE = new RegExp(
      // eslint-disable-next-line
      "((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})",
      "gi"
    );
    while (true) {
      let matches = IMPORT_RE.exec(cssText);
      if (!matches) {
        matches = UNIFIED_RE.exec(cssText);
        if (!matches) {
          break;
        } else {
          IMPORT_RE.lastIndex = UNIFIED_RE.lastIndex;
        }
      } else {
        UNIFIED_RE.lastIndex = IMPORT_RE.lastIndex;
      }
      result.push(matches[0]);
    }
    return result;
  }
  var URL_WITH_FORMAT_RE = /url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g;
  var FONT_SRC_RE = /src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;
  function filterPreferredFormat(str, context) {
    const { font } = context;
    const preferredFormat = font ? font == null ? void 0 : font.preferredFormat : void 0;
    return preferredFormat ? str.replace(FONT_SRC_RE, (match) => {
      while (true) {
        const [src, , format] = URL_WITH_FORMAT_RE.exec(match) || [];
        if (!format)
          return "";
        if (format === preferredFormat)
          return `src: ${src};`;
      }
    }) : str;
  }
  function unwrapCssLayers(rules, out = []) {
    for (const rule of Array.from(rules)) {
      if (isLayerBlockRule(rule)) {
        out.push(...unwrapCssLayers(rule.cssRules));
      } else if ("cssRules" in rule) {
        unwrapCssLayers(rule.cssRules, out);
      } else {
        out.push(rule);
      }
    }
    return out;
  }
  var SVG_EXTERNAL_RESOURCE_REGEX = /\bx?link:?href\s*=\s*["'](?!data:)[^"']+["']/i;
  function svgHasExternalResources(svg) {
    return SVG_EXTERNAL_RESOURCE_REGEX.test(svg.innerHTML);
  }
  async function domToForeignObjectSvg(node, options) {
    const context = await orCreateContext(node, options);
    if (isElementNode(context.node) && isSVGElementNode(context.node) && !svgHasExternalResources(context.node))
      return context.node;
    const {
      ownerDocument,
      log,
      tasks,
      svgStyleElement,
      svgDefsElement,
      svgStyles,
      font,
      progress,
      autoDestruct,
      onCloneNode,
      onEmbedNode,
      onCreateForeignObjectSvg
    } = context;
    log.time("clone node");
    const clone = await cloneNode(context.node, context, true);
    if (svgStyleElement && ownerDocument) {
      let allCssText = "";
      svgStyles.forEach((klasses, cssText) => {
        allCssText += `${klasses.join(",\n")} {
  ${cssText}
}
`;
      });
      svgStyleElement.appendChild(ownerDocument.createTextNode(allCssText));
    }
    log.timeEnd("clone node");
    await (onCloneNode == null ? void 0 : onCloneNode(clone));
    if (font !== false && isElementNode(clone)) {
      log.time("embed web font");
      await embedWebFont(clone, context);
      log.timeEnd("embed web font");
    }
    log.time("embed node");
    embedNode(clone, context);
    const count = tasks.length;
    let current = 0;
    const runTask = async () => {
      while (true) {
        const task = tasks.pop();
        if (!task)
          break;
        try {
          await task;
        } catch (error) {
          context.log.warn("Failed to run task", error);
        }
        progress == null ? void 0 : progress(++current, count);
      }
    };
    progress == null ? void 0 : progress(current, count);
    await Promise.all([...Array.from({ length: 4 })].map(runTask));
    log.timeEnd("embed node");
    await (onEmbedNode == null ? void 0 : onEmbedNode(clone));
    const svg = createForeignObjectSvg(clone, context);
    svgDefsElement && svg.insertBefore(svgDefsElement, svg.children[0]);
    svgStyleElement && svg.insertBefore(svgStyleElement, svg.children[0]);
    autoDestruct && destroyContext(context);
    await (onCreateForeignObjectSvg == null ? void 0 : onCreateForeignObjectSvg(svg));
    return svg;
  }
  function createForeignObjectSvg(clone, context) {
    const { width, height } = context;
    const svg = createSvg(width, height, clone.ownerDocument);
    const foreignObject = svg.ownerDocument.createElementNS(svg.namespaceURI, "foreignObject");
    foreignObject.setAttributeNS(null, "x", "0%");
    foreignObject.setAttributeNS(null, "y", "0%");
    foreignObject.setAttributeNS(null, "width", "100%");
    foreignObject.setAttributeNS(null, "height", "100%");
    foreignObject.append(clone);
    svg.appendChild(foreignObject);
    return svg;
  }
  async function domToCanvas(node, options) {
    var _a2;
    const context = await orCreateContext(node, options);
    const svg = await domToForeignObjectSvg(context);
    const dataUrl = svgToDataUrl(svg, context.isEnable("removeControlCharacter"));
    if (!context.autoDestruct) {
      context.svgStyleElement = createStyleElement(context.ownerDocument);
      context.svgDefsElement = (_a2 = context.ownerDocument) == null ? void 0 : _a2.createElementNS(XMLNS, "defs");
      context.svgStyles.clear();
    }
    const image = createImage(dataUrl, svg.ownerDocument);
    return await imageToCanvas(image, context);
  }

  // src/client/screenshot.ts
  var PADDING_PX = 30;
  function paddedCropRect(rect, padding, bounds) {
    const x = Math.max(0, rect.left - padding);
    const y = Math.max(0, rect.top - padding);
    const right = Math.min(bounds.width, rect.right + padding);
    const bottom = Math.min(bounds.height, rect.bottom + padding);
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    };
  }
  function cropCanvas(source, rect) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.width));
    out.height = Math.max(1, Math.round(rect.height));
    const ctx = out.getContext("2d");
    ctx.drawImage(
      source,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      out.width,
      out.height
    );
    return out;
  }
  async function captureElementScreenshot(el, excludeRoot, padding = PADDING_PX) {
    const full = await domToCanvas(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      // Do not change, because restoreScrollPosition:false desyncs the canvas from getBoundingClientRect() on scroll
      features: { restoreScrollPosition: true },
      filter: excludeRoot ? (node) => node !== excludeRoot : void 0
    });
    const rect = paddedCropRect(el.getBoundingClientRect(), padding, {
      width: full.width,
      height: full.height
    });
    const cropped = cropCanvas(full, rect);
    return new Promise((resolvePromise, reject) => {
      cropped.toBlob((blob) => {
        if (blob) resolvePromise(blob);
        else reject(new Error("toBlob returned null"));
      }, "image/png");
    });
  }

  // src/client/clipboard.ts
  async function copyText(text) {
    var _a2;
    if (!((_a2 = navigator.clipboard) == null ? void 0 : _a2.writeText)) return { ok: false };
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
  async function copyImage(blob) {
    var _a2;
    if (typeof ClipboardItem === "undefined" || !((_a2 = navigator.clipboard) == null ? void 0 : _a2.write)) {
      return { ok: false };
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // src/client/position-store.ts
  var KEY = "thisone:pos";
  function loadPosition() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof (parsed == null ? void 0 : parsed.x) === "number" && typeof (parsed == null ? void 0 : parsed.y) === "number") {
        return { x: parsed.x, y: parsed.y };
      }
      return null;
    } catch {
      return null;
    }
  }
  function savePosition(pos) {
    try {
      localStorage.setItem(KEY, JSON.stringify(pos));
    } catch {
    }
  }

  // src/client/target-store.ts
  var ENABLED_KEY = "thisone:target-enabled";
  var POS_KEY = "thisone:target-pos";
  var EDGES = ["top", "right", "bottom", "left"];
  function loadTargetEnabled() {
    try {
      return localStorage.getItem(ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  }
  function saveTargetEnabled(enabled) {
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
    } catch {
    }
  }
  function loadTargetPosition() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (EDGES.includes(parsed == null ? void 0 : parsed.edge) && typeof (parsed == null ? void 0 : parsed.offset) === "number" && Number.isFinite(parsed.offset)) {
        return {
          edge: parsed.edge,
          offset: Math.min(1, Math.max(0, parsed.offset))
        };
      }
      return null;
    } catch {
      return null;
    }
  }
  function saveTargetPosition(pos) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
    }
  }

  // src/client/path-mode-store.ts
  var MODE_KEY = "thisone:path-mode";
  function loadPathMode() {
    try {
      return localStorage.getItem(MODE_KEY) === "root" ? "root" : "tree";
    } catch {
      return "tree";
    }
  }
  function savePathMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
    }
  }

  // src/client/settings-store.ts
  var KEY2 = "thisone:settings-expanded";
  function loadSettingsExpanded() {
    try {
      return localStorage.getItem(KEY2) === "1";
    } catch {
      return false;
    }
  }
  function saveSettingsExpanded(expanded) {
    try {
      localStorage.setItem(KEY2, expanded ? "1" : "0");
    } catch {
    }
  }

  // src/client/screenshot-store.ts
  var ENABLED_KEY2 = "thisone:screenshot-enabled";
  var PADDING_KEY = "thisone:screenshot-padding";
  var DEFAULT_PADDING = 30;
  function loadScreenshotEnabled() {
    try {
      const raw = localStorage.getItem(ENABLED_KEY2);
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  }
  function saveScreenshotEnabled(enabled) {
    try {
      localStorage.setItem(ENABLED_KEY2, enabled ? "1" : "0");
    } catch {
    }
  }
  function loadScreenshotPadding() {
    try {
      const raw = localStorage.getItem(PADDING_KEY);
      if (raw === null) return DEFAULT_PADDING;
      const parsed = JSON.parse(raw);
      return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PADDING;
    } catch {
      return DEFAULT_PADDING;
    }
  }
  function saveScreenshotPadding(padding) {
    try {
      localStorage.setItem(PADDING_KEY, JSON.stringify(padding));
    } catch {
    }
  }

  // src/client/overlay.ts
  var HOST_ID = "__thisone_root";
  var STYLE = `
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
.section-title {
  color: #cdd6f4;
  font-weight: 600;
  margin-bottom: 4px;
}
.section-title:not(:first-child) {
  margin-top: 10px;
}
.padding-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px 18px;
}
.padding-row.hidden {
  display: none !important;
}
.padding-row input {
  width: 60px;
  background: #11111b;
  border: 1px solid #45475a;
  color: #eee;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
}
.shot-loading {
  color: #a6adc8;
  margin-top: 8px;
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
  function pinIcon(size) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
  }
  function targetIcon(size) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`;
  }
  var EDGE_BUTTON_SIZE = 44;
  var DEFAULT_TARGET_POSITION = { edge: "right", offset: 0.5 };
  function createOverlay() {
    const doc = document;
    const win = window;
    let host = null;
    let root;
    let panel;
    let header;
    let body;
    let pickHint;
    let box;
    let tip;
    let targetToggle;
    let targetBtn;
    let open = false;
    let statusTimer = null;
    let currentShotUrl = null;
    let dragOffset = null;
    let targetEnabled = false;
    let pathMode = "tree";
    let targetPosition = DEFAULT_TARGET_POSITION;
    let targetDragging = false;
    let pickId = 0;
    let currentTarget = null;
    let screenshotEnabled = true;
    let screenshotPadding = 30;
    function replaceShotUrl(url) {
      if (currentShotUrl) URL.revokeObjectURL(currentShotUrl);
      currentShotUrl = url;
    }
    function el(tag, cls) {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      return n;
    }
    function defaultPosition() {
      return {
        x: Math.max(16, win.innerWidth - 356),
        y: Math.max(16, win.innerHeight - 200)
      };
    }
    function clampPanelPosition(x, y) {
      const width = panel.getBoundingClientRect().width || panel.offsetWidth;
      const headerHeight = header.getBoundingClientRect().height || header.offsetHeight;
      const maxX = Math.max(0, win.innerWidth - width);
      const maxY = Math.max(0, win.innerHeight - headerHeight);
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY)
      };
    }
    function applyPosition() {
      var _a2;
      const pos = (_a2 = loadPosition()) != null ? _a2 : defaultPosition();
      const clamped = clampPanelPosition(pos.x, pos.y);
      panel.style.left = clamped.x + "px";
      panel.style.top = clamped.y + "px";
    }
    function ensureMounted() {
      var _a2;
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
      targetToggle.addEventListener(
        "click",
        () => setTargetEnabled(!targetEnabled)
      );
      const closeBtn = el("button", "close");
      closeBtn.textContent = "\xD7";
      closeBtn.addEventListener("click", () => close());
      const actions = el("div", "actions");
      actions.append(targetToggle, closeBtn);
      header.append(title, actions);
      body = el("div", "body");
      const settings = el("div", "settings");
      const settingsHeader = el("div", "settings-header");
      const settingsArrow = el("span", "settings-arrow");
      settingsArrow.textContent = "\u25B8";
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
      const PATH_MODE_HELP = {
        tree: "Show file-tree path",
        root: "Show path from root component"
      };
      const pathModeGroup = el("div", "setting-group");
      const pathModeTitle = el("div", "setting-title");
      pathModeTitle.textContent = "Path mode";
      pathModeGroup.appendChild(pathModeTitle);
      const pathModeRadios = {};
      ["tree", "root"].forEach((mode) => {
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
      const screenshotGroup = el("div", "setting-group");
      const screenshotTitle = el("div", "setting-title");
      screenshotTitle.textContent = "Show element screenshot";
      screenshotGroup.appendChild(screenshotTitle);
      const screenshotRadios = {};
      const paddingRow = el("div", "padding-row");
      const paddingInput = el("input");
      ["yes", "no"].forEach((value) => {
        const row = el("div", "radio-row");
        const input = el("input");
        input.type = "radio";
        input.name = "screenshot-enabled";
        input.value = value;
        const id = `thisone-screenshot-${value}`;
        input.id = id;
        const label = el("label");
        label.htmlFor = id;
        label.textContent = value === "yes" ? "Yes" : "No";
        input.addEventListener("change", () => {
          screenshotEnabled = value === "yes";
          saveScreenshotEnabled(screenshotEnabled);
          paddingRow.classList.toggle("hidden", !screenshotEnabled);
          if (currentTarget) renderSelection(currentTarget);
        });
        screenshotRadios[value] = input;
        row.append(input, label);
        screenshotGroup.appendChild(row);
      });
      const paddingLabel = el("label");
      paddingLabel.htmlFor = "thisone-padding";
      paddingLabel.textContent = "Padding, px";
      paddingInput.type = "number";
      paddingInput.id = "thisone-padding";
      paddingInput.min = "0";
      paddingInput.value = String(loadScreenshotPadding());
      paddingInput.addEventListener("change", () => {
        const parsed = Number(paddingInput.value);
        screenshotPadding = Number.isFinite(parsed) && parsed >= 0 ? parsed : screenshotPadding;
        paddingInput.value = String(screenshotPadding);
        saveScreenshotPadding(screenshotPadding);
        if (currentTarget) renderSelection(currentTarget);
      });
      paddingRow.append(paddingLabel, paddingInput);
      screenshotGroup.appendChild(paddingRow);
      settingsBody.appendChild(screenshotGroup);
      screenshotEnabled = loadScreenshotEnabled();
      screenshotPadding = loadScreenshotPadding();
      screenshotRadios[screenshotEnabled ? "yes" : "no"].checked = true;
      paddingRow.classList.toggle("hidden", !screenshotEnabled);
      panel.append(header, settings, body);
      root.appendChild(panel);
      pickHint = el("div", "pickhint hidden");
      pickHint.textContent = "Click an element \xB7 Esc to close";
      box = el("div", "box hidden");
      tip = el("div", "tip hidden");
      targetBtn = el("button", "target-btn hidden");
      targetBtn.innerHTML = targetIcon(20);
      targetBtn.title = "Right-click drag to move";
      root.append(pickHint, box, tip, targetBtn);
      targetEnabled = loadTargetEnabled();
      pathMode = loadPathMode();
      pathModeRadios[pathMode].checked = true;
      targetPosition = (_a2 = loadTargetPosition()) != null ? _a2 : DEFAULT_TARGET_POSITION;
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
    function renderEmpty() {
      body.innerHTML = "";
      const hint = el("div", "hint");
      hint.textContent = "Select an element";
      body.appendChild(hint);
    }
    function showStatus(target, ok) {
      target.textContent = ok ? "Copied" : "Copy failed";
      target.classList.toggle("fail", !ok);
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        target.textContent = "";
        target.classList.remove("fail");
      }, 1500);
    }
    function renderSelection(target) {
      currentTarget = target;
      const myPickId = ++pickId;
      replaceShotUrl(null);
      body.innerHTML = "";
      const pathRow = el("div", "path-row");
      const pathEl = el("div", "path");
      const pathStatus = el("div", "status");
      function currentPathText() {
        return pathMode === "tree" ? formatElementPath(target) : formatElementPathFromRoot(target);
      }
      function renderPathText() {
        pathEl.textContent = currentPathText();
      }
      renderPathText();
      pathEl.addEventListener("click", () => {
        void copyText(currentPathText()).then(
          (r) => showStatus(pathStatus, r.ok)
        );
      });
      pathRow.append(pathEl);
      const pathTitle = el("div", "section-title");
      pathTitle.textContent = "Path";
      body.append(pathTitle, pathRow, pathStatus);
      if (!screenshotEnabled) return;
      const shotTitle = el("div", "section-title");
      shotTitle.textContent = "Screenshot";
      const loading = el("div", "shot-loading");
      loading.textContent = "\u0414\u0435\u043B\u0430\u0435\u043C \u0441\u043A\u0440\u0438\u043D\u0448\u043E\u0442";
      const imgStatus = el("div", "status");
      body.append(shotTitle, loading);
      captureElementScreenshot(target, host, screenshotPadding).then((blob) => {
        if (myPickId !== pickId) return;
        loading.remove();
        const img = el("img", "shot");
        img.alt = "screenshot";
        const url = URL.createObjectURL(blob);
        replaceShotUrl(url);
        img.src = url;
        img.addEventListener("click", () => {
          void copyImage(blob).then((r) => showStatus(imgStatus, r.ok));
        });
        body.append(img, imgStatus);
      }).catch(() => {
        if (myPickId !== pickId) return;
        loading.remove();
        imgStatus.textContent = "Screenshot failed";
        imgStatus.classList.add("fail");
        body.append(imgStatus);
      });
    }
    function pathHasHost(ev) {
      var _a2, _b;
      const path = (_b = (_a2 = ev.composedPath) == null ? void 0 : _a2.call(ev)) != null ? _b : [];
      return host ? path.includes(host) : false;
    }
    function targetUnder(ev) {
      var _a2, _b;
      const path = (_b = (_a2 = ev.composedPath) == null ? void 0 : _a2.call(ev)) != null ? _b : [];
      for (const t of path) {
        if (t instanceof Element && t !== host) return t;
      }
      return ev.target instanceof Element ? ev.target : null;
    }
    function onMove(ev) {
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
      if (pathHasHost(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const t = targetUnder(ev);
      if (!t) return;
      renderSelection(t);
    }
    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      }
    }
    function startPick() {
      pickHint.classList.remove("hidden");
      doc.addEventListener("mousemove", onMove, true);
      doc.addEventListener("click", onClick, true);
      doc.addEventListener("keydown", onKey, true);
    }
    function cancelPick() {
      pickHint.classList.add("hidden");
      box.classList.add("hidden");
      tip.classList.add("hidden");
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
    }
    function onDragStart(ev) {
      const cls = ev.target.classList;
      if ((cls == null ? void 0 : cls.contains("close")) || (cls == null ? void 0 : cls.contains("target-toggle"))) return;
      const r = panel.getBoundingClientRect();
      dragOffset = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      win.addEventListener("mousemove", onDragMove);
      win.addEventListener("mouseup", onDragEnd);
    }
    function onDragMove(ev) {
      if (!dragOffset) return;
      const clamped = clampPanelPosition(
        ev.clientX - dragOffset.dx,
        ev.clientY - dragOffset.dy
      );
      panel.style.left = clamped.x + "px";
      panel.style.top = clamped.y + "px";
    }
    function onDragEnd() {
      if (!dragOffset) return;
      dragOffset = null;
      win.removeEventListener("mousemove", onDragMove);
      win.removeEventListener("mouseup", onDragEnd);
      savePosition({
        x: parseFloat(panel.style.left) || 0,
        y: parseFloat(panel.style.top) || 0
      });
    }
    function setTargetEnabled(enabled) {
      targetEnabled = enabled;
      saveTargetEnabled(enabled);
      targetToggle.classList.toggle("active", enabled);
      targetBtn.classList.toggle("hidden", !enabled);
    }
    function applyTargetButtonPosition() {
      targetBtn.classList.remove(
        "edge-top",
        "edge-right",
        "edge-bottom",
        "edge-left"
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
    function clampOffset(edge, value) {
      const length = edge === "top" || edge === "bottom" ? win.innerWidth : win.innerHeight;
      const half = EDGE_BUTTON_SIZE / 2;
      if (!(length > 0)) return Math.min(1, Math.max(0, value));
      const min = Math.min(0.5, half / length);
      const max = Math.max(0.5, 1 - half / length);
      return Math.min(max, Math.max(min, value));
    }
    function edgeFromPoint(x, y) {
      const distances = [
        ["left", x],
        ["right", win.innerWidth - x],
        ["top", y],
        ["bottom", win.innerHeight - y]
      ];
      distances.sort((a, b) => a[1] - b[1]);
      return distances[0][0];
    }
    function suppressContextMenu(ev) {
      ev.preventDefault();
    }
    function onTargetDragStart(ev) {
      if (ev.button !== 2) return;
      ev.preventDefault();
      targetDragging = true;
      win.addEventListener("mousemove", onTargetDragMove);
      win.addEventListener("mouseup", onTargetDragEnd);
      win.addEventListener("contextmenu", suppressContextMenu, true);
    }
    function onTargetDragMove(ev) {
      if (!targetDragging) return;
      const edge = edgeFromPoint(ev.clientX, ev.clientY);
      const raw = edge === "top" || edge === "bottom" ? ev.clientX / win.innerWidth : ev.clientY / win.innerHeight;
      targetPosition = { edge, offset: clampOffset(edge, raw) };
      applyTargetButtonPosition();
    }
    function onTargetDragEnd() {
      if (!targetDragging) return;
      targetDragging = false;
      win.removeEventListener("mousemove", onTargetDragMove);
      win.removeEventListener("mouseup", onTargetDragEnd);
      saveTargetPosition(targetPosition);
      setTimeout(() => {
        win.removeEventListener("contextmenu", suppressContextMenu, true);
      }, 0);
    }
    function openModal() {
      ensureMounted();
      if (open) return;
      open = true;
      panel.classList.remove("hidden");
      applyPosition();
      renderEmpty();
      startPick();
    }
    function close() {
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
      }
    };
  }

  // src/client/index.ts
  function boot() {
    var _a2, _b;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (window.__thisone_booted__) return;
    window.__thisone_booted__ = true;
    const cfg = (_a2 = window.__THISONE_CFG__) != null ? _a2 : {};
    const hotkey = (_b = cfg.hotkey) != null ? _b : "KeyC";
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
      true
    );
  }
  boot();
})();
