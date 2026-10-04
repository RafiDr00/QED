import { describe, expect, it } from "vitest";

import { exitCodeFor, renderRun } from "@qed/cli-render";
import { rawColor } from "@qed/tokens";
import { buildRunLines, runLinesToText, type RunResult } from "@qed/ui/model";

const RUN: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 41,
  verifiableFunctions: 6,
  duration: "2m 14s",
  runs: [
    {
      path: "billing/tax.go",
      symbol: "computeVat",
      verdict: { state: "EQUIVALENT", inputs: 18402 },
    },
    {
      path: "orders/pricing.ts",
      symbol: "bulkRate",
      verdict: {
        state: "DIVERGED",
        counterexample: {
          input: '{ qty: 100, tier: "gold" }',
          base: "0.85",
          head: "0.8",
          repro: "qed repro 9f2a1c",
        },
      },
    },
    {
      path: "api/handlers.go",
      symbol: "CreateOrder",
      verdict: {
        state: "ABSTAINED",
        obstruction: "opens a database connection",
      },
    },
  ],
};

// eslint-disable-next-line no-control-regex -- removing the escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

describe("renderRun", () => {
  it("is deterministic", () => {
    expect(renderRun(RUN)).toBe(renderRun(RUN));
  });

  it("without colour is exactly the text the pane shows", () => {
    const plain = renderRun(RUN, { color: false, banner: false }).trimEnd();
    expect(plain).toBe(runLinesToText(buildRunLines(RUN)).trimEnd());
  });

  it("colour adds nothing but escapes", () => {
    const coloured = stripAnsi(renderRun(RUN, { banner: false }));
    const plain = renderRun(RUN, { color: false, banner: false });
    expect(coloured).toBe(plain);
  });

  it("paints the verdicts with the palette's own values", () => {
    const out = renderRun(RUN);
    const proof = rawColor["proof"]?.["void"] ?? "";
    const [r, g, b] = [
      parseInt(proof.slice(1, 3), 16),
      parseInt(proof.slice(3, 5), 16),
      parseInt(proof.slice(5, 7), 16),
    ];
    expect(out).toContain(`\u001b[38;2;${r};${g};${b}m`);
  });

  it("carries the glyphs the design system fixed", () => {
    const plain = renderRun(RUN, { color: false });
    expect(plain).toContain("● EQUIVALENT");
    expect(plain).toContain("● DIVERGED");
    expect(plain).toContain("○ ABSTAINED");
    expect(plain).toContain("∎");
  });

  it("prints the banner once, not per line", () => {
    const plain = renderRun(RUN, { color: false });
    const occurrences = plain.split("DETERMINISTIC VERIFICATION").length - 1;
    expect(occurrences).toBe(1);
  });

  it("omits the banner when asked", () => {
    expect(renderRun(RUN, { color: false, banner: false })).not.toContain(
      "DETERMINISTIC VERIFICATION",
    );
  });

  it("paints Paper from the Paper palette", () => {
    const paper = rawColor["proof"]?.["paper"] ?? "";
    const r = parseInt(paper.slice(1, 3), 16);
    expect(renderRun(RUN, { theme: "paper" })).toContain(`\u001b[38;2;${r};`);
  });
});

describe("exitCodeFor", () => {
  it("is 1 when something diverged", () => {
    expect(exitCodeFor(RUN)).toBe(1);
  });

  it("is 0 when only abstentions remain", () => {
    expect(
      exitCodeFor({ ...RUN, runs: RUN.runs.filter((r) => r.verdict.state !== "DIVERGED") }),
    ).toBe(0);
  });
});
