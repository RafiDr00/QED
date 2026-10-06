import { describe, expect, it } from "vitest";

import { verify, DEFAULT_CONTROLS, type Resolver } from "@qed/engine";

const run = (base: string, head: string, options = {}) =>
  verify({ fileName: "s.ts", symbol: "f", base, head }, { inputs: 600, ...options });

/**
 * The regression this file exists for.
 *
 * Determinism used to be established from eight sampled inputs while the
 * verdict was based on two thousand plus the edge cases. A function reading
 * the clock on a branch only an edge case reached was certified EQUIVALENT
 * while differing in production every millisecond.
 */
describe("determinism is checked on the inputs the verdict rests on", () => {
  const frozen = DEFAULT_CONTROLS.epochMs % 7;

  it("abstains when the clock is read only for a non-finite input", () => {
    const base = `export function f(n: number): number {
      if (!Number.isFinite(n)) return Date.now() % 7;
      return n * 2;
    }`;
    // Returns exactly what the FROZEN clock produces, so the two agree under
    // the controls and disagree everywhere else.
    const head = `export function f(n: number): number {
      if (!Number.isFinite(n)) return ${frozen};
      return n * 2;
    }`;
    expect(run(base, head).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "depends on wall-clock time",
    });
  });

  it("abstains when the clock is read only for a very large input", () => {
    const base = `export function f(n: number): number {
      if (n >= 9007199254740991) return Date.now() % 7;
      return n * 2;
    }`;
    const head = `export function f(n: number): number {
      if (n >= 9007199254740991) return ${frozen};
      return n * 2;
    }`;
    expect(run(base, head).verdict.state).toBe("ABSTAINED");
  });

  // `Math.random() * 1` floors to 0 under every seed, so a function using it
  // really is deterministic. The multiplier has to be large enough for the
  // seed to show.
  it("abstains when the rng is read only on a rare branch", () => {
    const base = `export function f(n: number): number {
      if (Number.isNaN(n)) return Math.floor(Math.random() * 1000);
      return n * 2;
    }`;
    const head = `export function f(n: number): number {
      if (Number.isNaN(n)) return 0;
      return n * 2;
    }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("ABSTAINED");
  });

  it("still accepts a function that is genuinely pure", () => {
    const base = `export function f(n: number): number { return n * 2; }`;
    const head = `export function f(n: number): number { return n + n; }`;
    expect(run(base, head).verdict.state).toBe("EQUIVALENT");
  });

  it("still finds a real divergence", () => {
    const base = `export function f(n: number): number { return Math.round(n); }`;
    const head = `export function f(n: number): number { return Math.floor(n); }`;
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });
});

describe("imports are pinned, not refused", () => {
  const pin = (files: Record<string, string>): Resolver => (specifier) => {
    const path = specifier.replace(/^\.\//, "");
    const source = files[path];
    return source === undefined ? undefined : { path, source };
  };

  const rates = `export const VAT = 0.2;
export function round(n: number): number { return Math.round(n); }`;

  it("compares a function that calls a local helper", () => {
    const base = `import { VAT, round } from "./rates";
export function f(cents: number): number { return round(cents * VAT); }`;
    const head = `import { VAT, round } from "./rates";
export function f(cents: number): number { return round(VAT * cents); }`;

    const r = verify(
      { fileName: "tax.ts", symbol: "f", base, head },
      {
        inputs: 400,
        resolveBase: pin({ rates }),
        resolveHead: pin({ rates }),
      },
    );
    expect(r.verdict.state).toBe("EQUIVALENT");
  });

  it("sees a divergence that lives in the dependency", () => {
    const headRates = `export const VAT = 0.25;
export function round(n: number): number { return Math.round(n); }`;
    const module = `import { VAT, round } from "./rates";
export function f(cents: number): number { return round(cents * VAT); }`;

    const r = verify(
      { fileName: "tax.ts", symbol: "f", base: module, head: module },
      {
        inputs: 400,
        resolveBase: pin({ rates }),
        resolveHead: pin({ rates: headRates }),
      },
    );
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("abstains, naming the import, when it is not pinned", () => {
    const base = `import { VAT } from "./rates";
export function f(cents: number): number { return cents * VAT; }`;
    const r = verify(
      { fileName: "tax.ts", symbol: "f", base, head: base },
      { inputs: 50 },
    );
    expect(r.verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "imports ./rates, which is not pinned",
    });
  });

  it("still refuses a package, by name", () => {
    const base = `import { readFileSync } from "node:fs";
export function f(n: number): number { return readFileSync("/x").length + n; }`;
    const r = verify(
      { fileName: "t.ts", symbol: "f", base, head: base },
      { inputs: 50, resolveBase: pin({}), resolveHead: pin({}) },
    );
    expect(r.verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "imports node:fs",
    });
  });

  it("survives a cycle between two pinned modules", () => {
    const a = `import { b } from "./b";
export function f(n: number): number { return n + b(n); }
export function a(n: number): number { return n; }`;
    const b = `import { a } from "./a";
export function b(n: number): number { return a(0); }`;

    const r = verify(
      { fileName: "a.ts", symbol: "f", base: a, head: a },
      {
        inputs: 100,
        resolveBase: pin({ a, b }),
        resolveHead: pin({ a, b }),
      },
    );
    expect(["EQUIVALENT", "ABSTAINED"]).toContain(r.verdict.state);
  });
});
