import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildRunLines,
  runLinesToText,
  type RunResult,
  type Verdict,
} from "@qed/ui/model";

/**
 * The columns are the whole point of the CLI output: "Alignment is what makes
 * a long run scannable."
 *
 * A fixture-based test could not see the bug this replaces - a path longer
 * than its shrunk column came back unpadded and ran straight into the symbol,
 * shipping `periodic.tsreconcileOutstanding...` on the home page. The property
 * is stated over arbitrary lengths instead.
 */

const identifier = (min: number, max: number) =>
  fc
    .integer({ min, max })
    .chain((n) => fc.constant("x".repeat(n)));

const run = fc
  .record({
    paths: fc.array(identifier(3, 60), { minLength: 1, maxLength: 6 }),
    symbols: fc.array(identifier(3, 60), { minLength: 1, maxLength: 6 }),
    inputs: fc.integer({ min: 0, max: 100000 }),
    columns: fc.integer({ min: 40, max: 160 }),
  })
  .map((v) => {
    const n = Math.min(v.paths.length, v.symbols.length);
    const verdict: Verdict = { state: "EQUIVALENT", inputs: v.inputs };
    const result: RunResult = {
      command: "qed check --base origin/main",
      changedFunctions: n,
      verifiableFunctions: n,
      duration: "1s",
      runs: Array.from({ length: n }, (_, i) => ({
        // Distinct per row so each can be found in the output.
        path: `${v.paths[i] ?? "x"}${i}`,
        symbol: `${v.symbols[i] ?? "y"}${i}`.toUpperCase(),
        verdict,
      })),
    };
    return { result, columns: v.columns };
  });

describe("terminal layout", () => {
  it("never runs one column into the next, at any width", () => {
    fc.assert(
      fc.property(run, ({ result, columns }) => {
        const text = runLinesToText(buildRunLines(result, { columns }));
        for (const entry of result.runs) {
          const line = text
            .split("\n")
            .find((l) => l.includes(entry.path) && l.includes(entry.symbol));
          expect(line, `no line carried ${entry.path}`).toBeDefined();
          // Whatever the widths resolve to, the two are separated.
          expect(line).toMatch(
            new RegExp(`${entry.path} {2,}${entry.symbol}`),
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps the verdict word separated from the path", () => {
    fc.assert(
      fc.property(run, ({ result, columns }) => {
        const text = runLinesToText(buildRunLines(result, { columns }));
        for (const line of text.split("\n")) {
          expect(line).not.toMatch(/EQUIVALENT\S/);
          expect(line).not.toMatch(/DIVERGED\S/);
          expect(line).not.toMatch(/ABSTAINED\S/);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("aligns every row that fits its columns", () => {
    const result: RunResult = {
      command: "qed check",
      changedFunctions: 3,
      verifiableFunctions: 3,
      duration: "1s",
      runs: [
        { path: "a/b.go", symbol: "one", verdict: { state: "EQUIVALENT", inputs: 1 } },
        { path: "c/d.go", symbol: "two", verdict: { state: "EQUIVALENT", inputs: 2 } },
        { path: "e/f.go", symbol: "three", verdict: { state: "EQUIVALENT", inputs: 3 } },
      ],
    };
    const lines = runLinesToText(buildRunLines(result))
      .split("\n")
      .filter((l) => l.includes("EQUIVALENT"));
    const offsets = lines.map((l) => l.indexOf("inputs"));
    expect(new Set(offsets).size).toBe(1);
  });
});
