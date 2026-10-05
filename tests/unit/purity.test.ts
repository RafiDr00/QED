import { describe, expect, it } from "vitest";

import { probePurity } from "@qed/engine";

const probe = (src: string, name: string, samples: unknown[][] = [[1, 2]]) =>
  probePurity(src, "subject.ts", name, samples);

describe("a function that only reads its arguments is verifiable", () => {
  it("accepts arithmetic", () => {
    expect(probe(`export function add(a: number, b: number) { return a + b; }`, "add"))
      .toEqual({ verifiable: true });
  });

  it("accepts a function that throws, as long as it throws consistently", () => {
    expect(probe(`export function f(a: number) { if (a > 0) throw new Error("x"); return a; }`, "f"))
      .toEqual({ verifiable: true });
  });

  it("accepts reading a local constant", () => {
    expect(probe(`const RATE = 0.2;\nexport function vat(n: number) { return n * RATE; }`, "vat"))
      .toEqual({ verifiable: true });
  });
});

describe("it names the exact obstruction, by observing it", () => {
  it("catches wall-clock time", () => {
    expect(probe(`export function f(a: number) { return a + new Date().getUTCFullYear(); }`, "f"))
      .toEqual({ verifiable: false, obstruction: "depends on wall-clock time" });
  });

  it("catches Date.now", () => {
    expect(probe(`export function f(a: number) { return a + Date.now(); }`, "f"))
      .toEqual({ verifiable: false, obstruction: "depends on wall-clock time" });
  });

  it("catches a random number", () => {
    expect(probe(`export function f(a: number) { return a + Math.random(); }`, "f"))
      .toEqual({ verifiable: false, obstruction: "depends on a random number" });
  });

  it("catches state carried between calls", () => {
    expect(probe(`let n = 0;\nexport function f(a: number) { n += 1; return a + n; }`, "f"))
      .toEqual({ verifiable: false, obstruction: "returns a different answer for the same input" });
  });

  it("catches a function that rewrites what it was handed", () => {
    expect(probe(`export function f(xs: number[]) { xs.push(1); return xs.length; }`, "f", [[[1, 2]]]))
      .toEqual({ verifiable: false, obstruction: "modifies the value it was given" });
  });

  it("catches the network", () => {
    expect(probe(`export function f(a: number) { return fetch("http://x"); }`, "f"))
      .toEqual({ verifiable: false, obstruction: "opens a network connection" });
  });

  it("catches an import the function actually uses", () => {
    const src = [
      `import { readFileSync } from "node:fs";`,
      `export function f(a: number) { return readFileSync("/x").length + a; }`,
    ].join("\n");
    expect(probe(src, "f")).toEqual({
      verifiable: false,
      obstruction: "imports a module",
    });
  });

  it("does not hold an unused import against it - TypeScript elides one", () => {
    const src = [
      `import { readFileSync } from "node:fs";`,
      `export function f(a: number) { return a * 2; }`,
    ].join("\n");
    expect(probe(src, "f")).toEqual({ verifiable: true });
  });

  it("catches an async function", () => {
    expect(probe(`export async function f(a: number) { return a; }`, "f"))
      .toEqual({ verifiable: false, obstruction: "is asynchronous" });
  });

  it("says so when there is nothing to run it with", () => {
    expect(probe(`export function f(a: number) { return a; }`, "f", []))
      .toEqual({ verifiable: false, obstruction: "no inputs could be generated for it" });
  });
});

describe("the probe is empirical, not a source scan", () => {
  it("accepts a function that mentions the clock on a branch it never takes", () => {
    const src = `export function f(a: number) { if (a > 1e9) { return Date.now(); } return a * 2; }`;
    expect(probe(src, "f", [[1], [2], [3]])).toEqual({ verifiable: true });
  });

  it("rejects it once an input does reach that branch", () => {
    const src = `export function f(a: number) { if (a > 1e9) { return Date.now(); } return a * 2; }`;
    expect(probe(src, "f", [[1], [2e9]])).toEqual({
      verifiable: false,
      obstruction: "depends on wall-clock time",
    });
  });
});
