// On-demand snapshots answered over the WS bridge (Phase 4 wires these to
// `request{kind:'store'|'component'}`). Pinia is discovered lazily through the
// Vue devtools global hook; component state is read off `__vueParentComponent`.
// Everything degrades to a structured error rather than throwing.

import { componentName } from "./resolve-component";
import { safeStringify } from "./safe-stringify";

export type StoreSnapshot =
  | { store: string; state: any }
  | { stores: string[] }
  | { error: "not_found"; available: string[] }
  | { error: "no_pinia" };

export type ComponentSnapshot =
  | { name: string; props: any; state: any }
  | { error: "not_found" };

/** Locate the active Pinia instance via the Vue devtools global hook. */
function findPinia(): any | null {
  if (typeof window === "undefined") return null;
  const hook = (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return null;
  if (hook.pinia) return hook.pinia;

  const apps = hook.apps;
  const list: any[] = Array.isArray(apps)
    ? apps
    : apps && typeof apps[Symbol.iterator] === "function"
      ? Array.from(apps)
      : [];
  for (const entry of list) {
    const app = entry?.app ?? entry;
    const gp =
      app?.config?.globalProperties ?? app?._context?.config?.globalProperties;
    if (gp?.$pinia) return gp.$pinia;
  }

  const inst = hook.app?._instance;
  const gp2 = inst?.appContext?.config?.globalProperties;
  if (gp2?.$pinia) return gp2.$pinia;

  return null;
}

function storeMap(pinia: any): Map<string, any> {
  const s = pinia?._s;
  if (s instanceof Map) return s;
  if (s && typeof s === "object") return new Map(Object.entries(s));
  return new Map();
}

export function snapshotStore(args: { store?: string } = {}): StoreSnapshot {
  const pinia = findPinia();
  if (!pinia) return { error: "no_pinia" };

  const stores = storeMap(pinia);
  if (!args.store) return { stores: Array.from(stores.keys()) };

  const store = stores.get(args.store);
  if (!store) {
    return { error: "not_found", available: Array.from(stores.keys()) };
  }
  return { store: args.store, state: safeStringify(store.$state ?? {}) };
}

export function snapshotComponent(
  args: { selector?: string; last?: boolean } = {},
  lastEl?: Element | null,
): ComponentSnapshot {
  let el: Element | null = null;
  if (args.last) {
    el = lastEl ?? null;
  } else if (args.selector) {
    try {
      el = document.querySelector(args.selector);
    } catch {
      // Malformed selector — `querySelector` throws a SyntaxError.
      return { error: "not_found" };
    }
  }

  if (!el) return { error: "not_found" };

  const inst = (el as any).__vueParentComponent;
  if (!inst) return { error: "not_found" };

  // Composition-API setupState wins over Options-API data on a name clash —
  // setup state is the more current view for a mixed component.
  const state = { ...(inst.data ?? {}), ...(inst.setupState ?? {}) };
  return {
    name: componentName(inst),
    props: safeStringify(inst.props ?? {}),
    state: safeStringify(state),
  };
}
