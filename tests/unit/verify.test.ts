import { describe, expect, it } from "vitest";

import { verify } from "@qed/engine";

const run = (base: string, head: string, symbol = "f", options = {}) =>
  verify({ fileName: "subject.ts", symbol, base, head }, { inputs: 400, ...options });

describe("EQUIVALENT", () => {
  it("accepts a refactor that preserves behaviour, and counts the inputs", () => {
    const r = run(
      `export function f(a: number, b: number): number { return a + b; }`,
      `export function f(a: number, b: number): number { return b + a; }`,
    );
    expect(r.verdict.state).toBe("EQUIVALENT");
    if (r.verdict.state !== "EQUIVALENT") return;
    expect(r.verdict.inputs).toBe(400);
  });

  it("accepts an identical pair", () => {
    const src = `export function f(n: number): number { return Math.abs(n); }`;
    expect(run(src, src).verdict.state).toBe("EQUIVALENT");
  });

  it("accepts a rewrite of a real tax rule", () => {
    const base = `
      export function f(cents: number, rate: number): number {
        return Math.round(cents * rate);
      }`;
    const head = `
      export function f(cents: number, rate: number): number {
        const raw = cents * rate;
        return Math.round(raw);
      }`;
    expect(run(base, head).verdict.state).toBe("EQUIVALENT");
  });

  it("agrees when both sides throw the same error", () => {
    const base = `export function f(n: number): number { if (n < 0) throw new RangeError("negative"); return n; }`;
    const head = `export function f(n: number): number { if (n < 0) { throw new RangeError("negative"); } return n; }`;
    expect(run(base, head).verdict.state).toBe("EQUIVALENT");
  });
});

describe("DIVERGED", () => {
  it("finds a changed rounding rule and minimises the input", () => {
    const base = `export function f(n: number): number { return Math.round(n); }`;
    const head = `export function f(n: number): number { return Math.floor(n); }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    const c = r.verdict.counterexample;
    expect(c.base).not.toBe(c.head);
    expect(c.foundAt?.of).toBe(400);
    // A complete command, copyable without editing.
    expect(c.repro).toMatch(/^qed repro subject\.ts f --input '/);
  });

  it("notices one side throwing where the other returns", () => {
    const base = `export function f(n: number): number { return n; }`;
    const head = `export function f(n: number): number { if (n === 0) throw new Error("zero"); return n; }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    expect(r.verdict.counterexample.head).toContain("threw Error: zero");
  });

  it("notices a different error from the same input", () => {
    const base = `export function f(n: number): number { throw new RangeError("a"); }`;
    const head = `export function f(n: number): number { throw new TypeError("a"); }`;
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });

  it("notices a changed object shape", () => {
    const base = `export function f(n: number): object { return { total: n }; }`;
    const head = `export function f(n: number): object { return { total: n, currency: "EUR" }; }`;
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });
});

describe("tolerance is applied only when asked, and always recorded", () => {
  const base = `export function f(n: number): number { return n * 3 * 0.1; }`;
  const head = `export function f(n: number): number { return n * 0.3; }`;

  it("diverges on float drift by default", () => {
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });

  it("accepts it under a relative epsilon once the result is rounded", () => {
    const r = run(
      `export function f(n: number): number { return Math.round(n * 3 * 0.1 * 100) / 100; }`,
      `export function f(n: number): number { return Math.round(n * 0.3 * 100) / 100; }`,
      "f",
      { tolerance: { floatEpsilon: 0, relativeEpsilon: 1e-9 } },
    );
    expect(r.verdict.state).toBe("EQUIVALENT");
  });

  it("still diverges at subnormal magnitudes, and that is correct", () => {
    // At 1e-323 the two expressions differ by a fifth, because a subnormal
    // has almost no precision left. A relative epsilon of 1e-9 should not
    // hide that, and does not.
    const r = run(base, head, "f", {
      tolerance: { floatEpsilon: 0, relativeEpsilon: 1e-9 },
    });
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    expect(Math.abs(Number(r.verdict.counterexample.input))).toBeLessThan(1e-300);
  });

  it("an absolute epsilon does not cover drift that scales with magnitude", () => {
    const r = run(base, head, "f", { tolerance: { floatEpsilon: 1e-9 } });
    expect(r.verdict.state).toBe("DIVERGED");
  });
});

describe("ABSTAINED carries the obstruction, never a guess", () => {
  const cases: [string, string, string][] = [
    [
      "an unannotated parameter",
      `export function f(cfg) { return cfg; }`,
      "parameter `cfg` has no type annotation",
    ],
    [
      "the clock",
      `export function f(n: number): number { return n + Date.now(); }`,
      "depends on wall-clock time",
    ],
    [
      "a database connection, as an import",
      `import { connect } from "node:net";\nexport function f(n: number): number { return connect(n).readyState.length; }`,
      "imports a module",
    ],
    [
      "an async function",
      `export async function f(n: number): Promise<number> { return n; }`,
      "is asynchronous",
    ],
  ];

  for (const [label, src, obstruction] of cases) {
    it(label, () => {
      const r = run(src, src);
      expect(r.verdict).toEqual({ state: "ABSTAINED", obstruction });
    });
  }

  it("abstains on the head reading the clock, even though the base is clean", () => {
    const base = `export function f(n: number): number { return n * 2; }`;
    const head = `export function f(n: number): number { return n * 2 + (Date.now() % 1000); }`;
    expect(run(base, head).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "depends on wall-clock time",
    });
  });
});

describe("the strictness is deliberate, and it is documented here", () => {
  it("catches `n + 0`, which turns -0 into +0", () => {
    const base = `export function f(n: number): number { return n; }`;
    const head = `export function f(n: number): number { return n + 0; }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    // Found because the generator offers -0 deliberately. 1/-0 is -Infinity
    // and 1/0 is Infinity, so code downstream can tell these apart.
    expect(r.verdict.counterexample.input).toBe("0");
    expect(r.verdict.counterexample.base).toBe("0");
  });
});

describe("corpus seeding finds boundaries random draws do not", () => {
  it("finds the one input where > became >=", () => {
    const base = `export function f(qty: number): number { return qty > 100 ? 2 : 1; }`;
    const head = `export function f(qty: number): number { return qty >= 100 ? 2 : 1; }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    if (r.verdict.state !== "DIVERGED") return;
    expect(r.verdict.counterexample.input).toBe("100");
  });

  it("finds a changed string constant", () => {
    const base = `export function f(t: string): number { return t === "gold" ? 2 : 1; }`;
    const head = `export function f(t: string): number { return t === "silver" ? 2 : 1; }`;
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });
});

describe("a run is reproducible", () => {
  it("gives the same verdict and the same counterexample twice", () => {
    const base = `export function f(n: number): number { return Math.round(n); }`;
    const head = `export function f(n: number): number { return Math.floor(n); }`;
    expect(run(base, head)).toEqual(run(base, head));
  });
});
