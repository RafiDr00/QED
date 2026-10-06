import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { callFunction, loadModule } from "@qed/engine";

/**
 * The invariant the sandbox exists to hold:
 *
 *   for any pure function and any input,
 *   running it inside the sandbox gives what running it outside gives.
 *
 * This is the test that would have caught the `Math` bug on the first run.
 * `Math`'s methods are non-enumerable, so building the replacement with a
 * spread produced an empty object and every `Math.round` was "not a function"
 * - while the example-based tests passed, because both versions of the code
 * failed identically and compared equal.
 *
 * One property covers every global at once, forever.
 */

/** Expression templates over two numbers, each a real thing code does. */
const EXPRESSIONS = [
  "a + b",
  "a - b",
  "a * b",
  "a / b",
  "a % b",
  "a ** 2",
  "Math.round(a * b)",
  "Math.floor(a / (b || 1))",
  "Math.ceil(a + b)",
  "Math.abs(a - b)",
  "Math.max(a, b)",
  "Math.min(a, b)",
  "Math.trunc(a * b)",
  "Math.sign(a - b)",
  "Math.sqrt(Math.abs(a))",
  "Math.hypot(a, b)",
  "Math.log(Math.abs(a) + 1)",
  "Math.PI * a",
  "Number.isInteger(a) ? 1 : 0",
  "Number.isFinite(a * b) ? a : 0",
  "parseFloat(String(a)) + b",
  "parseInt(String(a), 10) + b",
  "Number(String(a)) * b",
  "[a, b].sort((x, y) => x - y)[0]",
  "[a, b].map((x) => x * 2).reduce((x, y) => x + y, 0)",
  "Object.keys({ a, b }).length",
  "JSON.parse(JSON.stringify({ a, b })).a",
  "String(a).length + String(b).length",
  "(a).toFixed(2)",
  "(a).toString(16)",
  "isNaN(a) ? -1 : 1",
  "Array.from({ length: 3 }, (_, i) => i * a)[2]",
  "new Date(0).getUTCFullYear() + a",
  "[...new Set([a, b, a])].length",
  "new Map([[\"k\", a]]).get(\"k\")",
  "Boolean(a) && Boolean(b) ? 1 : 0",
  "(a > b ? a : b) - Math.min(a, b)",
  "Math.round((a * 100) / 100)",
  "encodeURIComponent(String(a)).length",
] as const;

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true });
const numbers = fc.oneof(
  finite,
  fc.integer({ min: -10000, max: 10000 }),
  fc.constantFrom(0, -0, 1, -1, NaN, Infinity, -Infinity, 0.1, 1e-7),
);

describe("the sandbox agrees with the host", () => {
  it("for every expression, on every input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXPRESSIONS),
        numbers,
        numbers,
        (expression, a, b) => {
          const source = `export function f(a: number, b: number): unknown { return ${expression}; }`;

          const inside = callFunction(loadModule(source, "s.ts"), "f", [a, b]);

          // The same expression, evaluated by this realm.
          let outside: unknown;
          let threw: string | undefined;
          try {
            // The host side of the comparison has to evaluate the same source
            // text the sandbox does, so this is the one place a constructed
            // function is the point rather than a smell. The expressions are
            // the literal list above, never anything from outside this file.
            // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
            outside = Function("a", "b", `return ${expression};`)(a, b);
          } catch (error) {
            threw = error instanceof Error ? error.name : String(error);
          }

          if (threw !== undefined) {
            expect(inside.kind, `${expression} threw outside only`).toBe("threw");
            return;
          }

          expect(
            inside.obstruction,
            `${expression} was blocked inside the sandbox`,
          ).toBeUndefined();
          expect(inside.kind, `${expression} threw inside only`).toBe("returned");
          // JSON round-trip so Sets, Maps and arrays compare by value.
          expect(JSON.stringify(inside.value), expression).toBe(
            JSON.stringify(outside),
          );
        },
      ),
      { numRuns: 1500 },
    );
  });

  it("and disagrees exactly where it is supposed to: the clock and the rng", () => {
    const clock = callFunction(
      loadModule(`export function f(): number { return Date.now(); }`, "s.ts"),
      "f",
      [],
    );
    expect(clock.value).not.toBe(Date.now());

    const random = callFunction(
      loadModule(`export function f(): number { return Math.random(); }`, "s.ts"),
      "f",
      [],
    );
    const again = callFunction(
      loadModule(`export function f(): number { return Math.random(); }`, "s.ts"),
      "f",
      [],
    );
    expect(random.value).toBe(again.value);
  });
});
