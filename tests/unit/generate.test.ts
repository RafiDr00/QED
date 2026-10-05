import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generatorFor } from "@qed/engine";

const gen = (src: string, name = "f") => generatorFor(src, "subject.ts", name);

/** A handful of samples, so the shape of what is produced can be asserted. */
function sample(src: string, name = "f", n = 40): unknown[][] {
  const g = gen(src, name);
  if (g.kind !== "ok") throw new Error(`unsupported: ${g.obstruction}`);
  return fc.sample(g.arbitrary, { numRuns: n, seed: 1 });
}

describe("it generates from declared types", () => {
  it("primitives", () => {
    const rows = sample(`export function f(a: number, b: string, c: boolean) {}`);
    expect(rows.every((r) => r.length === 3)).toBe(true);
    expect(rows.every((r) => typeof r[0] === "number")).toBe(true);
    expect(rows.every((r) => typeof r[1] === "string")).toBe(true);
    expect(rows.every((r) => typeof r[2] === "boolean")).toBe(true);
  });

  it("reaches the numeric edges, not just the middle", () => {
    const seen = new Set(sample(`export function f(a: number) {}`, "f", 300).map((r) => r[0]));
    expect([...seen].some((v) => Number.isNaN(v as number))).toBe(true);
    expect(seen.has(0)).toBe(true);
  });

  it("a union of literals, and only those", () => {
    const rows = sample(`export function f(t: "gold" | "silver") {}`, "f", 50);
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(["gold", "silver"]));
  });

  it("arrays", () => {
    const rows = sample(`export function f(xs: number[]) {}`);
    expect(rows.every((r) => Array.isArray(r[0]))).toBe(true);
  });

  it("tuples, with their exact length", () => {
    const rows = sample(`export function f(p: [number, string]) {}`);
    expect(rows.every((r) => (r[0] as unknown[]).length === 2)).toBe(true);
  });

  it("an inline object type", () => {
    const rows = sample(`export function f(o: { qty: number; tier: string }) {}`);
    expect(rows.every((r) => typeof (r[0] as { qty: unknown }).qty === "number")).toBe(true);
  });

  it("a locally declared interface", () => {
    const src = `interface Order { qty: number; tier: "gold" | "silver" }\nexport function f(o: Order) {}`;
    const rows = sample(src);
    expect(rows.every((r) => ["gold", "silver"].includes((r[0] as { tier: string }).tier))).toBe(true);
  });

  it("a type alias, including a nested one", () => {
    const src = `type Cents = number;\ntype Line = { cents: Cents };\nexport function f(l: Line) {}`;
    const rows = sample(src);
    expect(rows.every((r) => typeof (r[0] as { cents: unknown }).cents === "number")).toBe(true);
  });

  it("an enum", () => {
    const src = `enum Tier { Gold = "gold", Silver = "silver" }\nexport function f(t: Tier) {}`;
    const rows = sample(src, "f", 40);
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(["gold", "silver"]));
  });

  it("an optional parameter, present and absent", () => {
    const rows = sample(`export function f(a: number, b?: string) {}`, "f", 120);
    expect(rows.some((r) => r[1] === undefined)).toBe(true);
    expect(rows.some((r) => typeof r[1] === "string")).toBe(true);
  });

  it("an optional property, present and absent", () => {
    const rows = sample(`export function f(o: { a: number; b?: string }) {}`, "f", 120);
    const objs = rows.map((r) => r[0] as Record<string, unknown>);
    expect(objs.some((o) => !("b" in o))).toBe(true);
    expect(objs.some((o) => "b" in o)).toBe(true);
  });

  it("an arrow function assigned to a const", () => {
    const rows = sample(`export const f = (a: number) => a * 2;`);
    expect(rows.every((r) => typeof r[0] === "number")).toBe(true);
  });

  it("a function with no parameters at all", () => {
    expect(sample(`export function f() {}`)[0]).toEqual([]);
  });
});

describe("it refuses, and names the parameter", () => {
  const cases: [string, string, string][] = [
    ["no annotation", `export function f(cfg) { return cfg; }`, "parameter `cfg` has no type annotation"],
    ["any", `export function f(cfg: any) {}`, "parameter `cfg` is `any`, so there is no shape to generate from"],
    ["unknown", `export function f(cfg: unknown) {}`, "parameter `cfg` is `any`, so there is no shape to generate from"],
    ["object", `export function f(cfg: object) {}`, "parameter `cfg` is `object`, so there is no shape to generate from"],
    ["rest", `export function f(...rest: number[]) {}`, "parameter `rest` is a rest parameter, which QED cannot generate"],
    ["an imported type", `export function f(cfg: Buffer) {}`, "parameter `cfg` is `Buffer`, which QED cannot generate"],
    ["a function type", `export function f(cb: () => void) {}`, "parameter `cb` is a type QED cannot generate"],
  ];

  for (const [label, src, obstruction] of cases) {
    it(label, () => {
      expect(gen(src)).toEqual({ kind: "unsupported", obstruction });
    });
  }

  it("says so when the function is not exported under that name", () => {
    expect(gen(`export function other(a: number) {}`, "f")).toEqual({
      kind: "unsupported",
      obstruction: "exports no function named 'f'",
    });
  });

  it("refuses a type that nests past the limit rather than hanging", () => {
    const src = `type A = { b: B }; type B = { a: A };\nexport function f(a: A) {}`;
    const g = gen(src);
    expect(g.kind).toBe("unsupported");
  });
});
