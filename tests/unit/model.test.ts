import { describe, expect, it } from "vitest";

import {
  buildRunLines,
  evidenceLine,
  formatCount,
  runLinesToText,
  summarise,
  type RunResult,
  type Verdict,
} from "@qed/ui/model";

const equivalent: Verdict = { state: "EQUIVALENT", inputs: 18402 };
const diverged: Verdict = {
  state: "DIVERGED",
  counterexample: {
    input: '{ qty: 100 }',
    base: "0.85",
    head: "0.8",
    repro: "qed repro 9f2a1c",
    foundAt: { index: 7, of: 9110 },
  },
};
const abstained: Verdict = {
  state: "ABSTAINED",
  obstruction: "opens a database connection",
};

const run = (verdicts: Verdict[]): RunResult => ({
  command: "qed check --base origin/main",
  changedFunctions: 41,
  verifiableFunctions: verdicts.length,
  duration: "2m 14s",
  runs: verdicts.map((verdict, index) => ({
    path: "billing/tax.go",
    symbol: `fn${index}`,
    verdict,
  })),
});

describe("summarise", () => {
  it("counts each state", () => {
    const summary = summarise(run([equivalent, equivalent, diverged, abstained]));
    expect(summary).toEqual({
      equivalent: 2,
      diverged: 1,
      abstained: 1,
      exitCode: 1,
    });
  });

  it("exits zero when nothing diverged, however many abstained", () => {
    expect(summarise(run([abstained, abstained, abstained])).exitCode).toBe(0);
  });

  it("exits non-zero on a single divergence", () => {
    expect(summarise(run([diverged])).exitCode).toBe(1);
  });

  it("reports zeros rather than omitting a state", () => {
    expect(summarise(run([]))).toEqual({
      equivalent: 0,
      diverged: 0,
      abstained: 0,
      exitCode: 0,
    });
  });
});

describe("evidenceLine", () => {
  it("gives every state something to show", () => {
    expect(evidenceLine(equivalent)).toBe("18,402 inputs");
    expect(evidenceLine(diverged)).toBe("input 7 of 9,110");
    expect(evidenceLine(abstained)).toBe("opens a database connection");
  });

  it("never returns an empty string", () => {
    for (const verdict of [equivalent, diverged, abstained]) {
      expect(evidenceLine(verdict).length).toBeGreaterThan(0);
    }
  });
});

describe("formatCount", () => {
  it("groups the same way everywhere", () => {
    expect(formatCount(18402)).toBe("18,402");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1000000)).toBe("1,000,000");
  });
});

describe("buildRunLines", () => {
  it("states all three counts in the summary, including zeros", () => {
    const text = runLinesToText(buildRunLines(run([equivalent])));
    expect(text).toContain("1 equivalent");
    expect(text).toContain("0 divergences");
    expect(text).toContain("0 abstained");
    expect(text).toContain("exit 0");
  });

  it("indents a counterexample under its verdict with four labelled lines", () => {
    const text = runLinesToText(buildRunLines(run([diverged])));
    for (const label of ["input", "base", "head", "repro"]) {
      expect(text).toMatch(new RegExp(`^\\s{6}${label}\\s`, "m"));
    }
    expect(text).toContain("qed repro 9f2a1c");
  });

  it("uses a filled glyph for the two decided states and a hollow one for abstain", () => {
    const text = runLinesToText(buildRunLines(run([equivalent, diverged, abstained])));
    expect(text).toContain("● EQUIVALENT");
    expect(text).toContain("● DIVERGED");
    expect(text).toContain("○ ABSTAINED");
  });

  it("closes the run with the tombstone", () => {
    expect(runLinesToText(buildRunLines(run([equivalent])))).toContain("∎");
  });

  it("aligns the columns across rows that fit", () => {
    const result: RunResult = {
      ...run([equivalent, equivalent]),
      runs: [
        { path: "a/b.go", symbol: "short", verdict: equivalent },
        { path: "billing/tax.go", symbol: "computeVat", verdict: equivalent },
      ],
    };
    const lines = runLinesToText(buildRunLines(result)).split("\n");
    const offsets = lines
      .filter((l) => l.includes("EQUIVALENT"))
      .map((l) => l.indexOf("18,402"));
    expect(new Set(offsets).size).toBe(1);
  });

  it("gives an over-long symbol its own evidence line rather than shifting every column", () => {
    const long = {
      path: "ledger/reconciliation/periodic.ts",
      symbol: "reconcileOutstandingSettlementBatches",
      verdict: equivalent,
    };
    const short = { path: "a/b.go", symbol: "short", verdict: equivalent };
    const lines = runLinesToText(
      buildRunLines({ ...run([equivalent, equivalent]), runs: [short, long] }),
    ).split("\n");

    const shortLine = lines.find((l) => l.includes("short"));
    const longLine = lines.find((l) => l.includes("reconcileOutstanding"));
    const evidenceLines = lines.filter((l) => l.includes("18,402"));

    expect(longLine).toContain("reconcileOutstandingSettlementBatches");
    expect(longLine).not.toContain("18,402");
    expect(evidenceLines).toHaveLength(2);

    const inlineOffset = shortLine?.indexOf("18,402");
    const wrappedOffset = evidenceLines
      .find((l) => !l.includes("short"))
      ?.indexOf("18,402");
    expect(wrappedOffset).toBe(inlineOffset);
  });
});
