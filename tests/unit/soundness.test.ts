import { describe, expect, it } from "vitest";

import { callFunction, equals, loadModule, show, verify } from "@qed/engine";

/**
 * The soundness corpus.
 *
 * Every case here was, at some point, a pair of functions that behave
 * differently and that QED certified EQUIVALENT - or a pair it abstained on
 * for the wrong reason. Each asserts the verdict and the reason exactly, so a
 * regression has to explain itself. Add to it every time a false claim is
 * found; never delete from it.
 */

const run = (base: string, head: string, symbol = "f") =>
  verify({ fileName: "subject.ts", symbol, base, head }, { inputs: 200 });

const fn = (body: string, returns = "unknown", params = "n: number") =>
  `export function f(${params}): ${returns} { ${body} }`;

describe("values built in the sandbox compare by what they hold", () => {
  // The sandbox's Map is not this process's Map, so `instanceof` was false and
  // every Map, Set and RegExp compared as an empty object.
  it("a Set with different members diverges", () => {
    const r = run(fn("return new Set([1]);"), fn("return new Set([2, 3]);"));
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("a Map with a different value diverges", () => {
    const r = run(fn('return new Map([["a", 1]]);'), fn('return new Map([["a", 2]]);'));
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("a RegExp with a different pattern diverges", () => {
    expect(run(fn("return /a/;"), fn("return /b/g;")).verdict.state).toBe("DIVERGED");
  });

  it("equal collections still agree, and the weakening is recorded", () => {
    const r = run(fn("return new Set([n, 1]);"), fn("return new Set([1, n]);"));
    expect(r.verdict.state).toBe("EQUIVALENT");
    expect(r.tolerancesApplied).toContain("unordered collection compared by membership");
  });

  it("a Map keyed by objects matches its keys by structure", () => {
    const same = fn("return new Map([[{ id: 1 }, n]]);");
    const r = run(same, same);
    expect(r.verdict.state).toBe("EQUIVALENT");
    expect(r.tolerancesApplied).toContain("collection members matched by structure");

    const changed = fn("return new Map([[{ id: 2 }, n]]);");
    expect(run(same, changed).verdict.state).toBe("DIVERGED");
  });

  it("prints a sandbox Map with its contents, not as an empty object", () => {
    const s = loadModule(`export function f(): unknown { return new Map([["a", 1]]); }`, "s.ts");
    expect(show(callFunction(s, "f", []).value)).toBe('Map("a" => 1)');
  });

  it("an ArrayBuffer with different bytes diverges", () => {
    const r = run(
      fn("return new Uint8Array([1]).buffer;"),
      fn("return new Uint8Array([2]).buffer;"),
    );
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("a boxed number with a different value diverges", () => {
    expect(run(fn("return new Number(1);"), fn("return new Number(2);")).verdict.state).toBe(
      "DIVERGED",
    );
  });
});

describe("what a value hides is compared, or the record says it was not", () => {
  it("a returned Error with a different message diverges", () => {
    const r = run(fn('return new Error("a");'), fn('return new Error("b");'));
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("a class whose getter reports doubled state diverges", () => {
    const base = `class M { #c: number; constructor(c: number) { this.#c = c; } get cents() { return this.#c; } }
${fn("return new M(n);")}`;
    const head = `class M { #c: number; constructor(c: number) { this.#c = c * 2; } get cents() { return this.#c; } }
${fn("return new M(n);")}`;
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });

  it("private state no getter exposes is named as not compared", () => {
    const base = `class M { #c: number; constructor(c: number) { this.#c = c; } }
${fn("return new M(n);")}`;
    const head = `class M { #c: number; constructor(c: number) { this.#c = c * 2; } }
${fn("return new M(n);")}`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("EQUIVALENT");
    expect(r.tolerancesApplied).toContain("private fields of M not compared");
  });

  it("a symbol-keyed property that changed diverges", () => {
    const r = run(
      `const k = Symbol("k");\n${fn("return { [k]: n };")}`,
      `const k = Symbol("k");\n${fn("return { [k]: n + 1 };")}`,
    );
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("a comparison that runs out of depth says so", () => {
    const deep = (n: number): unknown => (n === 0 ? 1 : { next: deep(n - 1) });
    const c = equals(deep(40), deep(40));
    expect(c.equal).toBe(true);
    expect(c.applied).toContain("compared to a depth of 32");
  });
});

describe("the sandbox's gaps are obstructions, not agreements", () => {
  it("crypto.randomUUID abstains as a random number", () => {
    const r = run(
      fn('return crypto.randomUUID() + s;', "string", "s: string"),
      fn('return crypto.randomUUID() + s + "x";', "string", "s: string"),
    );
    expect(r.verdict).toEqual({ state: "ABSTAINED", obstruction: "reads a random number" });
  });

  it("performance.now abstains as a clock", () => {
    const src = fn("return performance.now() + n;", "number");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "reads a high-resolution clock",
    });
  });

  it("a global the sandbox does not provide is named", () => {
    const src = fn("return Buffer.from(s).length;", "number", "s: string");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "reaches for `Buffer`, which the sandbox does not provide",
    });
  });

  it("a denied call the code catches is still an obstruction", () => {
    const src = fn('try { fetch("http://x"); } catch { return 0; } return n;', "number");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "opens a network connection",
    });
  });

  it("a typo is a bug, not a gap: one side's ReferenceError diverges", () => {
    const r = run(fn("return n;", "number"), fn("return nn;", "number"));
    expect(r.verdict.state).toBe("DIVERGED");
  });

  it("the deterministic web globals are there", () => {
    const base = fn("return new TextEncoder().encode(s).length;", "number", "s: string");
    const head = fn("return new TextEncoder().encode(s + \"!\").length;", "number", "s: string");
    expect(run(base, base).verdict.state).toBe("EQUIVALENT");
    expect(run(base, head).verdict.state).toBe("DIVERGED");
  });
});

describe("agreement has to be about something", () => {
  it("throwing the same error on every input compares nothing, and abstains", () => {
    const src = fn('throw new TypeError("nope");', "number");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "throws TypeError on every generated input, so no result was compared",
    });
  });

  it("an equivalence that partly rests on errors counts them", () => {
    const src = fn('if (n < 0) throw new RangeError("negative"); return n;', "number");
    const r = run(src, src);
    expect(r.verdict.state).toBe("EQUIVALENT");
    if (r.verdict.state !== "EQUIVALENT") return;
    expect(r.verdict.threw).toBeGreaterThan(0);
    expect(r.verdict.threw).toBeLessThan(r.verdict.inputs);
  });

  it("an equivalence with no errors carries no throw count", () => {
    const src = fn("return n;", "number");
    const r = run(src, src);
    expect(r.verdict).toEqual({
      state: "EQUIVALENT",
      inputs: 200,
      strategy: "type-directed, corpus-seeded",
    });
  });
});

describe("what cannot be compared says so, with the right reason", () => {
  it("a returned function abstains as a function, not as nondeterminism", () => {
    const src = fn("return (x: number) => x + n;");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "returns a function, which cannot be compared",
    });
  });

  it("a function inside the result is located", () => {
    const src = fn("return { total: n, compute: () => n };");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "returns a function at `compute`, which cannot be compared",
    });
  });

  it("a WeakMap's contents cannot be read", () => {
    const src = fn("return { cache: new WeakMap() };");
    expect(run(src, src).verdict).toEqual({
      state: "ABSTAINED",
      obstruction: "returns a WeakMap at `cache`, whose contents cannot be read",
    });
  });
});

describe("where a change bites is never invented", () => {
  it("a value no code names is not offered as the condition", () => {
    // Diverges on a sliver of inputs no constant describes. The description
    // used to name whatever value the one diverging draw happened to have.
    const base = fn("return n;", "number");
    const head = fn("return Math.sin(n) > 0.9999 ? 0 : n;", "number");
    const r = verify({ fileName: "subject.ts", symbol: "f", base, head }, { inputs: 2000 });
    expect(r.verdict.state).toBe("DIVERGED");
    for (const condition of r.blast?.conditions ?? []) {
      if (condition.operator === "is" && typeof condition.value === "number") {
        expect([0, 1, -1, 0.9999]).toContain(condition.value);
      }
    }
    expect(r.blastSummary ?? "").not.toMatch(/exactly when the input is -?\d{3,}/);
  });
});
