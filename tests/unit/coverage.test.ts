import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  callFunction,
  decodeArgs,
  encodeArgs,
  exportedFunctions,
  generatorFor,
  loadModule,
  verify,
  type Resolver,
} from "@qed/engine";

/**
 * The coverage corpus: code QED used to abstain on that it can now verify.
 *
 * Each case here was a function the first generator refused - an imported
 * interface, a `Partial`, a branded number, a `Date` - or a module shape it
 * could not see into. Abstaining is honest, but abstaining on the ordinary
 * shapes of business code made the tool honest about nothing.
 */

const pin =
  (files: Record<string, string>): Resolver =>
  (specifier) => {
    const path = specifier.replace(/^\.\//, "");
    for (const candidate of [path, `${path}.ts`]) {
      const source = files[candidate];
      if (source !== undefined) return { path: candidate, source };
    }
    return undefined;
  };

function sample(src: string, n = 60, resolver?: Resolver, name = "f"): unknown[][] {
  const g = generatorFor(src, "subject.ts", name, undefined, resolver);
  if (g.kind !== "ok") throw new Error(`unsupported: ${g.obstruction}`);
  return fc.sample(g.arbitrary, { numRuns: n, seed: 3 });
}

const first = (rows: unknown[][]) => rows.map((r) => r[0]);

describe("types the checker resolves", () => {
  it("an interface imported from a pinned file", () => {
    const types = `export interface Order { qty: number; tier: "gold" | "silver" }`;
    const rows = first(sample(`import type { Order } from "./types";\nexport function f(o: Order) {}`, 40, pin({ "types.ts": types })));
    expect(rows.every((o) => ["gold", "silver"].includes((o as { tier: string }).tier))).toBe(true);
  });

  it("Partial, Pick and Omit", () => {
    const decl = `interface Order { qty: number; tier: string; note: string }`;
    const partial = first(sample(`${decl}\nexport function f(o: Partial<Order>) {}`, 80));
    expect(partial.some((o) => !("qty" in (o as object)))).toBe(true);

    const picked = first(sample(`${decl}\nexport function f(o: Pick<Order, "qty">) {}`));
    expect(picked.every((o) => Object.keys(o as object).join() === "qty")).toBe(true);

    const omitted = first(sample(`${decl}\nexport function f(o: Omit<Order, "note">) {}`));
    expect(omitted.every((o) => !("note" in (o as object)))).toBe(true);
  });

  it("Record with literal keys, and with string keys", () => {
    const fixed = first(sample(`export function f(r: Record<"eur" | "usd", number>) {}`));
    expect(fixed.every((r) => Object.keys(r as object).sort().join() === "eur,usd")).toBe(true);

    const open = first(sample(`export function f(r: Record<string, number>) {}`));
    expect(open.every((r) => Object.values(r as object).every((v) => typeof v === "number"))).toBe(true);
  });

  it("an intersection of object types", () => {
    const rows = first(sample(`export function f(o: { a: number } & { b: string }) {}`));
    expect(rows.every((o) => typeof (o as { a: unknown }).a === "number" && typeof (o as { b: unknown }).b === "string")).toBe(true);
  });

  it("a branded number, as the number it is", () => {
    const rows = first(sample(`type Cents = number & { readonly __brand: "Cents" };\nexport function f(c: Cents) {}`));
    expect(rows.every((c) => typeof c === "number")).toBe(true);
  });

  it("Date, Map, Set and typed arrays", () => {
    expect(first(sample(`export function f(d: Date) {}`)).every((d) => d instanceof Date && !Number.isNaN(d.getTime()))).toBe(true);
    expect(first(sample(`export function f(m: Map<string, number>) {}`)).every((m) => m instanceof Map)).toBe(true);
    expect(first(sample(`export function f(s: ReadonlySet<number>) {}`)).every((s) => s instanceof Set)).toBe(true);
    expect(first(sample(`export function f(b: Uint8Array) {}`)).every((b) => b instanceof Uint8Array)).toBe(true);
  });

  it("readonly arrays, both spellings", () => {
    expect(first(sample(`export function f(xs: readonly number[]) {}`)).every(Array.isArray)).toBe(true);
    expect(first(sample(`export function f(xs: ReadonlyArray<string>) {}`)).every(Array.isArray)).toBe(true);
  });

  it("a template literal type", () => {
    const rows = first(sample(`export function f(id: \`inv-\${number}\`) {}`));
    expect(rows.every((id) => /^inv-/.test(id as string))).toBe(true);
  });

  it("a constrained type parameter, from its constraint", () => {
    expect(first(sample(`export function f<T extends number>(x: T) {}`)).every((x) => typeof x === "number")).toBe(true);
  });

  it("a parameter with a default, present and absent", () => {
    const rows = first(sample(`export function f(rate: number = 0.2) {}`, 120));
    expect(rows.some((r) => r === undefined)).toBe(true);
    expect(rows.some((r) => typeof r === "number")).toBe(true);
  });

  it("a callback, as a function that returns its declared type", () => {
    const [cb] = first(sample(`export function f(cb: (n: number) => string) {}`, 1)) as [(n: number) => unknown];
    expect(typeof cb).toBe("function");
    expect(typeof cb(1)).toBe("string");
  });
});

describe("module shapes", () => {
  it("finds every way a function is exported", () => {
    const src = `function a(n: number) { return n; }
const b = (n: number) => n;
export { a, b as renamed };
export default function (n: number) { return n; }
export const c = function (n: number) { return n; };`;
    expect(exportedFunctions(src, "m.ts")).toEqual(["a", "renamed", "default", "c"]);
  });

  it("verifies an export-list function by the name it is exported under", () => {
    const base = `function rate(q: number): number { return q > 10 ? 0.9 : 1; }\nexport { rate as bulkRate };`;
    const head = `function rate(q: number): number { return q >= 10 ? 0.9 : 1; }\nexport { rate as bulkRate };`;
    const r = verify({ fileName: "m.ts", symbol: "bulkRate", base, head }, { inputs: 200 });
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("verifies a default export as `default`", () => {
    const src = `export default function (n: number): number { return n * 2; }`;
    const r = verify({ fileName: "m.ts", symbol: "default", base: src, head: src }, { inputs: 100 });
    expect(r.verdict.state).toBe("EQUIVALENT");
  });

  it("verifies a function beside an import it never uses", () => {
    const src = `import { readFileSync } from "node:fs";
export function add(a: number, b: number): number { return a + b; }
export function read(p: string): string { return readFileSync(p, "utf8"); }`;
    expect(verify({ fileName: "m.ts", symbol: "add", base: src, head: src }, { inputs: 100 }).verdict.state).toBe("EQUIVALENT");
    expect(verify({ fileName: "m.ts", symbol: "read", base: src, head: src }, { inputs: 100 }).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "imports node:fs",
    });
  });

  it("verifies a function whose parameter type is imported, through the pinned file", () => {
    const types = `export interface Line { cents: number; qty: number }`;
    const base = `import type { Line } from "./types";\nexport function total(l: Line): number { return l.cents * l.qty; }`;
    const head = `import type { Line } from "./types";\nexport function total(l: Line): number { return l.qty * l.cents; }`;
    const resolver = pin({ "types.ts": types });
    const r = verify(
      { fileName: "m.ts", symbol: "total", base, head },
      { inputs: 200, resolveBase: resolver, resolveHead: resolver },
    );
    expect(r.verdict.state).toBe("EQUIVALENT");
  });
});

describe("callbacks are observed, not just called", () => {
  it("calling back a different number of times diverges", () => {
    const base = `export function each(xs: number[], cb: (x: number) => void): number { for (const x of xs) cb(x); return xs.length; }`;
    const head = `export function each(xs: number[], cb: (x: number) => void): number { for (const x of xs.slice(1)) cb(x); return xs.length; }`;
    const r = verify({ fileName: "m.ts", symbol: "each", base, head }, { inputs: 200 });
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    expect(r.verdict.counterexample.base).toContain("callbacks received");
  });

  it("the same calls in the same order agree", () => {
    const base = `export function map(xs: number[], cb: (x: number) => number): number[] { return xs.map((x) => cb(x)); }`;
    const head = `export function map(xs: number[], cb: (x: number) => number): number[] { const out: number[] = []; for (const x of xs) out.push(cb(x)); return out; }`;
    expect(verify({ fileName: "m.ts", symbol: "map", base, head }, { inputs: 200 }).verdict.state).toBe("EQUIVALENT");
  });

  it("a callback survives the repro line, and returns what it returned", () => {
    const g = generatorFor(`export function f(cb: () => number) {}`, "m.ts", "f");
    if (g.kind !== "ok") throw new Error(g.obstruction);
    const [args] = fc.sample(g.arbitrary, { numRuns: 1, seed: 5 });
    const original = (args?.[0] as () => number)();
    const [replayed] = decodeArgs(encodeArgs(args ?? [])) as [() => number];
    expect(replayed()).toEqual(original);
  });

  it("each call gets its own callbacks, so one call's log never leaks into the next", () => {
    const s = loadModule(`export function f(cb: (n: number) => void): number { cb(1); return 0; }`, "m.ts");
    const g = generatorFor(`export function f(cb: (n: number) => void) {}`, "m.ts", "f");
    if (g.kind !== "ok") throw new Error(g.obstruction);
    const [args = []] = fc.sample(g.arbitrary, { numRuns: 1, seed: 1 });
    expect(callFunction(s, "f", args).calls).toEqual([[[1]]]);
    expect(callFunction(s, "f", args).calls).toEqual([[[1]]]);
  });
});

describe("a function that never returns does not hang the run", () => {
  it("abstains when it runs past its budget", () => {
    const src = `export function f(n: number): number { if (n === 7) { while (true) {} } return n; }`;
    const started = Date.now();
    const r = verify({ fileName: "m.ts", symbol: "f", base: src, head: src }, { inputs: 200, budgetMs: 400 });
    expect(r.verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "does not finish within 400ms on the generated inputs",
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("and the engine works normally afterwards", () => {
    const src = `export function f(n: number): number { return n; }`;
    expect(verify({ fileName: "m.ts", symbol: "f", base: src, head: src }, { inputs: 50 }).verdict.state).toBe("EQUIVALENT");
  });
});

describe("a change reaches the files that import it", () => {
  const types = `export interface Line { cents: number; qty: number; tier: "gold" | "silver" }`;
  const rateBase = `import type { Line } from "./types";\nexport function rate(line: Line): number { return line.tier === "gold" && line.qty > 10 ? 0.9 : 1; }`;
  const rateHead = `import type { Line } from "./types";\nexport function rate(line: Line): number { return line.tier === "gold" && line.qty >= 10 ? 0.9 : 1; }`;
  const total = `import { rate } from "./rate";\nimport type { Line } from "./types";\nexport function total(line: Line): number { return Math.round(line.cents * line.qty * rate(line)); }`;

  it("an unchanged importer diverges through its changed helper, at the helper's boundary", () => {
    const r = verify(
      { fileName: "total.ts", symbol: "total", base: total, head: total },
      {
        inputs: 400,
        resolveBase: pin({ "types.ts": types, "rate.ts": rateBase }),
        resolveHead: pin({ "types.ts": types, "rate.ts": rateHead }),
      },
    );
    expect(r.verdict.state).toBe("DIVERGED");
    // The 10 lives in rate.ts. Mined from there, the generator offers it, and
    // the description names the boundary rather than a coincidence.
    expect(r.blastSummary).toContain("`qty` is 10");
    expect(r.blastSummary).toContain('`tier` is "gold"');
  });
});
