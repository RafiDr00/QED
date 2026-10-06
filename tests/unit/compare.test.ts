import { describe, expect, it } from "vitest";

import { equals, show, EXACT } from "@qed/engine";

describe("equality", () => {
  it("ignores object key order but not array order", () => {
    expect(equals({ a: 1, b: 2 }, { b: 2, a: 1 }).equal).toBe(true);
    expect(equals([1, 2], [2, 1]).equal).toBe(false);
  });

  it("treats NaN as agreeing with NaN", () => {
    expect(equals(NaN, NaN).equal).toBe(true);
  });

  it("separates +0 from -0, because dividing by them disagrees", () => {
    expect(equals(0, -0).equal).toBe(false);
  });

  it("compares errors by name and message", () => {
    expect(equals({ name: "RangeError", message: "x" }, { name: "RangeError", message: "x" }).equal).toBe(true);
    expect(equals({ name: "RangeError", message: "x" }, { name: "TypeError", message: "x" }).equal).toBe(false);
  });

  it("says where it differed, and how", () => {
    const d = equals({ lines: [{ cents: 100 }] }, { lines: [{ cents: 101 }] }).difference;
    expect(d?.path).toBe("lines[0].cents");
    expect(d?.reason).toBe("differs by 1");
  });

  it("names a key that appeared or vanished", () => {
    expect(equals({ a: 1 }, { a: 1, b: 2 }).difference?.reason).toBe("now has 'b'");
    expect(equals({ a: 1, b: 2 }, { a: 1 }).difference?.reason).toBe("no longer has 'b'");
  });

  it("reports a changed length as a count, not a dump", () => {
    expect(equals([1, 2, 3], [1, 2]).difference?.reason).toBe("3 items became 2");
  });
});

describe("tolerance", () => {
  it("is exact by default: a float that drifted is a difference", () => {
    expect(equals(0.1 + 0.2, 0.3).equal).toBe(false);
  });

  it("applies an epsilon when one is given, and records that it did", () => {
    const c = equals(0.1 + 0.2, 0.3, { floatEpsilon: 1e-9 });
    expect(c.equal).toBe(true);
    expect(c.applied).toEqual(["float ε 1e-9"]);
  });

  it("records nothing when nothing was applied", () => {
    expect(equals(1, 1, { floatEpsilon: 1e-9 }).applied).toEqual([]);
  });

  it("will not hide a difference larger than the epsilon", () => {
    expect(equals(1, 1.1, { floatEpsilon: 1e-9 }).equal).toBe(false);
  });

  it("records comparing a Set by membership as the weakening it is", () => {
    const c = equals(new Set([1, 2]), new Set([2, 1]));
    expect(c.equal).toBe(true);
    expect(c.applied).toEqual(["unordered collection compared by membership"]);
  });
});

describe("structures", () => {
  it("compares Dates by instant", () => {
    expect(equals(new Date(5), new Date(5)).equal).toBe(true);
    expect(equals(new Date(5), new Date(6)).equal).toBe(false);
  });

  it("compares Maps by key and value", () => {
    expect(equals(new Map([["a", 1]]), new Map([["a", 1]])).equal).toBe(true);
    expect(equals(new Map([["a", 1]]), new Map([["a", 2]])).equal).toBe(false);
  });

  it("notices a type change", () => {
    expect(equals(1, "1").difference?.reason).toBe("number became string");
    expect(equals(null, {}).difference?.reason).toBe("null became object");
  });

  it("survives a cycle instead of hanging", () => {
    const a: Record<string, unknown> = { n: 1 };
    a["self"] = a;
    const b: Record<string, unknown> = { n: 1 };
    b["self"] = b;
    expect(equals(a, b, EXACT).equal).toBe(true);
  });
});

describe("show", () => {
  it("prints a value the way the terminal does", () => {
    expect(show({ qty: 100, tier: "gold" })).toBe('{ qty: 100, tier: "gold" }');
    expect(show([1, "a"])).toBe('[1, "a"]');
    expect(show(undefined)).toBe("undefined");
    expect(show(10n)).toBe("10n");
  });
});

describe("what a value is, not only what it holds", () => {
  class Money {
    constructor(public cents: number) {}
  }
  class Cash {
    constructor(public cents: number) {}
  }

  it("separates two classes with identical fields", () => {
    const c = equals(new Money(1), new Cash(1));
    expect(c.equal).toBe(false);
    expect(c.difference?.reason).toBe("a Money became a Cash");
  });

  it("accepts the same class", () => {
    expect(equals(new Money(1), new Money(1)).equal).toBe(true);
  });

  it("separates a class instance from a plain object", () => {
    expect(equals(new Money(1), { cents: 1 }).equal).toBe(false);
  });

  it("still compares plain objects by their contents", () => {
    expect(equals({ a: 1 }, { a: 1 }).equal).toBe(true);
  });

  it("handles a null-prototype object", () => {
    const bare = Object.create(null) as Record<string, number>;
    bare["a"] = 1;
    expect(equals(bare, { a: 1 }).equal).toBe(false);
    const other = Object.create(null) as Record<string, number>;
    other["a"] = 1;
    expect(equals(bare, other).equal).toBe(true);
  });
});
