// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { installConsoleTap } from "../../src/client/console-tap";

describe("installConsoleTap", () => {
  it("captures console.* into the buffer and still calls the original (tee)", () => {
    const spy = vi.spyOn(console, "log");
    const tap = installConsoleTap(10);
    console.log("hello", 42);
    const buf = tap.getBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0].level).toBe("log");
    expect(buf[0].text).toContain("hello");
    expect(typeof buf[0].ts).toBe("number");
    expect(spy).toHaveBeenCalledWith("hello", 42);
    tap.dispose();
    spy.mockRestore();
  });

  it("rings the buffer when exceeding size (boundary)", () => {
    const tap = installConsoleTap(3);
    for (let i = 0; i < 5; i++) console.log("m" + i);
    expect(tap.getBuffer().map((e) => e.text)).toEqual(["m2", "m3", "m4"]);
    tap.dispose();
  });

  it("size=0 captures nothing without crashing (boundary)", () => {
    const tap = installConsoleTap(0);
    console.log("x");
    expect(tap.getBuffer()).toEqual([]);
    tap.dispose();
  });

  it("captures window error and unhandledrejection as error entries (external-failure)", () => {
    const tap = installConsoleTap(10);
    const ee: any = new Event("error");
    ee.message = "boom";
    window.dispatchEvent(ee);
    const re: any = new Event("unhandledrejection");
    re.reason = new Error("nope");
    window.dispatchEvent(re);
    const texts = tap.getBuffer().map((e) => e.text);
    expect(texts.some((t) => t.includes("boom"))).toBe(true);
    expect(texts.some((t) => t.includes("nope"))).toBe(true);
    expect(tap.getBuffer().every((e) => e.level === "error")).toBe(true);
    tap.dispose();
  });

  it("formats a cyclic object argument without throwing (malformed-input)", () => {
    const tap = installConsoleTap(5);
    const a: any = {};
    a.self = a;
    expect(() => console.log("obj", a)).not.toThrow();
    expect(tap.getBuffer()).toHaveLength(1);
    tap.dispose();
  });

  it("dispose restores the original console and stops capturing", () => {
    const before = console.log;
    const tap = installConsoleTap(5);
    expect(console.log).not.toBe(before);
    tap.dispose();
    expect(console.log).toBe(before);
    console.log("after");
    expect(tap.getBuffer()).toEqual([]);
  });

  it("caps a single oversized log entry (boundary)", () => {
    const tap = installConsoleTap(5);
    console.log("y".repeat(20000));
    const entry = tap.getBuffer()[0];
    expect(entry.text.length).toBeLessThanOrEqual(8001);
    expect(entry.text.endsWith("…")).toBe(true);
    tap.dispose();
  });

  it("nested taps keep separate buffers and restore in LIFO (concurrency)", () => {
    const t1 = installConsoleTap(10);
    const t2 = installConsoleTap(10);
    console.log("shared");
    expect(t1.getBuffer()).toHaveLength(1);
    expect(t2.getBuffer()).toHaveLength(1);
    t2.dispose();
    console.log("after-t2");
    expect(t1.getBuffer()).toHaveLength(2);
    expect(t2.getBuffer()).toHaveLength(1);
    t1.dispose();
  });
});
