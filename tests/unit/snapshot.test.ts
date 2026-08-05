// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { snapshotStore, snapshotComponent } from "../../src/client/snapshot";

function setupPinia(stores: Record<string, any>): void {
  const _s = new Map(Object.entries(stores));
  const pinia = { _s };
  (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
    apps: [{ app: { config: { globalProperties: { $pinia: pinia } } } }],
  };
}

beforeEach(() => {
  delete (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
});

describe("snapshotStore", () => {
  it("returns the state for a named store", () => {
    setupPinia({ counter: { $id: "counter", $state: { count: 5 } } });
    expect(snapshotStore({ store: "counter" })).toEqual({
      store: "counter",
      state: { count: 5 },
    });
  });

  it("lists store ids when no store arg is given", () => {
    setupPinia({ a: { $state: {} }, b: { $state: {} } });
    expect(snapshotStore({})).toEqual({ stores: ["a", "b"] });
  });

  it("returns not_found with available ids for an unknown store (deleted-resource)", () => {
    setupPinia({ a: { $state: {} } });
    expect(snapshotStore({ store: "nope" })).toEqual({
      error: "not_found",
      available: ["a"],
    });
  });

  it("returns no_pinia when neither the devtools hook nor a mounted app is present (external-failure)", () => {
    expect(snapshotStore({ store: "x" })).toEqual({ error: "no_pinia" });
  });

  it("falls back to __vue_app__ on the mounted root when devtools is not installed", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const pinia = { _s: new Map([["counter", { $state: { count: 7 } }]]) };
    (document.getElementById("app") as any).__vue_app__ = {
      config: { globalProperties: { $pinia: pinia } },
    };
    expect(snapshotStore({ store: "counter" })).toEqual({
      store: "counter",
      state: { count: 7 },
    });
  });

  it("does not throw on a cyclic store state (malformed-input)", () => {
    const s: any = { $state: {} };
    s.$state.self = s.$state;
    setupPinia({ c: s });
    const r = snapshotStore({ store: "c" }) as any;
    expect(r.state.self).toBe("[Circular]");
  });

  it("returns empty state for an empty store (empty)", () => {
    setupPinia({ e: { $state: {} } });
    expect(snapshotStore({ store: "e" })).toEqual({ store: "e", state: {} });
  });
});

describe("snapshotComponent", () => {
  it("reads props/state from __vueParentComponent by selector", () => {
    document.body.innerHTML = `<button id="b">x</button>`;
    const el = document.getElementById("b")!;
    (el as any).__vueParentComponent = {
      type: { name: "Counter" },
      props: { label: "x" },
      setupState: { count: 3 },
    };
    expect(snapshotComponent({ selector: "#b" })).toEqual({
      name: "Counter",
      props: { label: "x" },
      state: { count: 3 },
    });
  });

  it("uses lastEl when last:true", () => {
    const el = document.createElement("div");
    (el as any).__vueParentComponent = {
      type: { name: "Last" },
      props: {},
      setupState: { a: 1 },
    };
    expect(snapshotComponent({ last: true }, el)).toEqual({
      name: "Last",
      props: {},
      state: { a: 1 },
    });
  });

  it("returns not_found for a malformed selector (malformed-input)", () => {
    expect(snapshotComponent({ selector: ">>>bad" })).toEqual({
      error: "not_found",
    });
  });

  it("returns not_found when the selector matches nothing (deleted-resource)", () => {
    expect(snapshotComponent({ selector: "#gone" })).toEqual({
      error: "not_found",
    });
  });

  it("returns not_found for an element without a Vue instance", () => {
    document.body.innerHTML = `<span id="plain">x</span>`;
    expect(snapshotComponent({ selector: "#plain" })).toEqual({
      error: "not_found",
    });
  });

  it("returns not_found for last:true without a remembered element (empty)", () => {
    expect(snapshotComponent({ last: true })).toEqual({ error: "not_found" });
  });
});
