import { describe, expect, it } from "vitest";

import {
  callFunction,
  loadModule,
  ObstructionError,
  DEFAULT_CONTROLS,
} from "@qed/engine";

const load = (src: string) => loadModule(src, "subject.ts");

describe("the sandbox runs a function", () => {
  it("evaluates TypeScript and exports what it declares", () => {
    const s = load(`export function add(a: number, b: number): number { return a + b; }`);
    expect(callFunction(s, "add", [2, 3])).toEqual({ kind: "returned", value: 5 });
  });

  it("reports a thrown error as an outcome, not a crash", () => {
    const s = load(`export function boom(): number { throw new RangeError("nope"); }`);
    expect(callFunction(s, "boom", [])).toEqual({
      kind: "threw",
      value: { name: "RangeError", message: "nope" },
    });
  });

  it("says so when the function is not there", () => {
    const s = load(`export function a(): number { return 1; }`);
    expect(callFunction(s, "b", []).obstruction).toBe(
      "exports no function named 'b'",
    );
  });
});

describe("the controls hold", () => {
  it("freezes the clock", () => {
    const s = load(`export function now(): number { return Date.now(); }`);
    expect(callFunction(s, "now", [])).toEqual({
      kind: "returned",
      value: DEFAULT_CONTROLS.epochMs,
    });
  });

  it("freezes new Date() too", () => {
    const s = load(`export function year(): number { return new Date().getUTCFullYear(); }`);
    expect(callFunction(s, "year", [])).toEqual({ kind: "returned", value: 2026 });
  });

  it("seeds the rng, so the same seed gives the same number", () => {
    const src = `export function r(): number { return Math.random(); }`;
    const a = callFunction(load(src), "r", []);
    const b = callFunction(load(src), "r", []);
    expect(a).toEqual(b);
    expect(typeof a.value).toBe("number");
  });

  it("gives a different sequence for a different seed", () => {
    const src = `export function r(): number { return Math.random(); }`;
    const a = callFunction(loadModule(src, "s.ts", { ...DEFAULT_CONTROLS, rngSeed: 1 }), "r", []);
    const b = callFunction(loadModule(src, "s.ts", { ...DEFAULT_CONTROLS, rngSeed: 2 }), "r", []);
    expect(a.value).not.toEqual(b.value);
  });
});

describe("what it refuses, and what it says", () => {
  const cases: [string, string, string][] = [
    ["network", `export function f(): unknown { return fetch("http://x"); }`, "opens a network connection"],
    ["timers", `export function f(): unknown { return setTimeout(() => 1, 0); }`, "schedules work on a timer"],
    ["hrtime", `export function f(): unknown { return process.hrtime(); }`, "reads a high-resolution clock"],
  ];

  for (const [name, src, obstruction] of cases) {
    it(`refuses ${name}, by name`, () => {
      expect(callFunction(load(src), "f", []).obstruction).toBe(obstruction);
    });
  }

  it("refuses a module import rather than resolving it", () => {
    expect(() => load(`import { readFileSync } from "node:fs";\nexport function f(): unknown { return readFileSync("/etc/passwd"); }`))
      .toThrow(ObstructionError);
  });

  it("sees an empty environment", () => {
    const s = load(`export function f(): unknown { return process.env["HOME"]; }`);
    expect(callFunction(s, "f", [])).toEqual({ kind: "returned", value: undefined });
  });

  it("calls an async function an obstruction instead of comparing a promise", () => {
    const s = load(`export async function f(): Promise<number> { return 1; }`);
    expect(callFunction(s, "f", []).obstruction).toBe("is asynchronous");
  });

  it("reports a module that does not compile", () => {
    expect(() => load(`export function f(: number { }`)).toThrow(/does not compile/);
  });
});

describe("isolation", () => {
  it("does not let one module's globals reach another", () => {
    load(`(globalThis as any).leaked = "yes"; export function f(): number { return 1; }`);
    const s = load(`export function f(): unknown { return (globalThis as any).leaked; }`);
    expect(callFunction(s, "f", [])).toEqual({ kind: "returned", value: undefined });
  });

  it("cannot reach this process's globals", () => {
    const s = load(`export function f(): unknown { return typeof require; }`);
    expect(callFunction(s, "f", [])).toEqual({ kind: "returned", value: "function" });
    const g = load(`export function f(): unknown { return typeof (globalThis as any).process?.exit; }`);
    expect(callFunction(g, "f", [])).toEqual({ kind: "returned", value: "undefined" });
  });
});
