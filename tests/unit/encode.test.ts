import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decodeArgs, encodeArgs } from "@qed/engine";

/**
 * "The repro line is a complete command, copyable without editing."
 *
 * JSON cannot keep that promise: a counterexample found at NaN printed
 * `--input '[null]'`, which reproduces nothing. Everything the generator can
 * produce has to survive the round trip.
 */
const roundTrip = (args: unknown[]): unknown[] => decodeArgs(encodeArgs(args));

describe("the values JSON loses", () => {
  it("NaN", () => {
    expect(Number.isNaN(roundTrip([NaN])[0])).toBe(true);
  });

  it("both infinities", () => {
    expect(roundTrip([Infinity, -Infinity])).toEqual([Infinity, -Infinity]);
  });

  it("negative zero, which divides differently from zero", () => {
    expect(Object.is(roundTrip([-0])[0], -0)).toBe(true);
    expect(Object.is(roundTrip([0])[0], 0)).toBe(true);
  });

  it("undefined, which JSON drops", () => {
    expect(roundTrip([undefined, 1])).toEqual([undefined, 1]);
  });

  it("BigInt, which JSON refuses outright", () => {
    expect(roundTrip([123456789012345678901234567890n])).toEqual([
      123456789012345678901234567890n,
    ]);
  });

  it("Dates, Maps and Sets, as themselves", () => {
    const [date, map, set] = roundTrip([
      new Date(1234567890),
      new Map([["k", 1]]),
      new Set([1, 2]),
    ]);
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).getTime()).toBe(1234567890);
    expect(map).toBeInstanceOf(Map);
    expect((map as Map<string, number>).get("k")).toBe(1);
    expect(set).toBeInstanceOf(Set);
    expect([...(set as Set<number>)]).toEqual([1, 2]);
  });

  it("an object whose own key is '$', which would look like a tag", () => {
    expect(roundTrip([{ $: "NaN", real: true }])).toEqual([
      { $: "NaN", real: true },
    ]);
  });

  it("nested, inside objects and arrays", () => {
    const value = { a: [NaN, -0], b: { c: undefined, d: new Set([Infinity]) } };
    const back = roundTrip([value])[0] as typeof value;
    expect(Number.isNaN(back.a[0] as number)).toBe(true);
    expect(Object.is(back.a[1], -0)).toBe(true);
    expect("c" in back.b).toBe(true);
    expect([...back.b.d]).toEqual([Infinity]);
  });
});

describe("round trip, over anything the generator can produce", () => {
  const value = fc.letrec((tie) => ({
    any: fc.oneof(
      { depthSize: "small" },
      fc.double(),
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.constantFrom(NaN, Infinity, -Infinity, -0, 0),
      fc.bigInt(),
      fc.date({ noInvalidDate: true }),
      fc.array(tie("any"), { maxLength: 4 }),
      fc.dictionary(fc.string(), tie("any"), { maxKeys: 4 }),
    ),
  })).any;

  it("returns a value that compares equal to what went in", () => {
    fc.assert(
      fc.property(fc.array(value, { maxLength: 4 }), (args) => {
        const back = roundTrip(args);
        // Re-encoding is the comparison: two values that encode identically
        // are the same value, including NaN and -0 which === disagrees about.
        expect(encodeArgs(back)).toBe(encodeArgs(args));
      }),
      { numRuns: 500 },
    );
  });
});
