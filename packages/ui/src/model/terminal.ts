/**
 * One layout for the CLI output, shared by the terminal pane on screen and by
 * @qed/cli-render's ANSI string. Both walk the same lines, so the screenshot
 * in a README and the text in a CI log cannot drift apart.
 *
 * React-free on purpose.
 */
import {
  formatCount,
  summarise,
  TERMINAL_GLYPH,
  TOMBSTONE,
  type RunResult,
  type Verdict,
} from "./verdict.js";

/** Which token paints a segment. The two renderers map it their own way. */
export type Tone = "ink" | "muted" | "proof" | "break" | "open";

export interface Segment {
  readonly text: string;
  readonly tone: Tone;
  readonly bold?: boolean;
  /**
   * A verdict glyph. Neither family ships U+25CF/U+25CB, so the browser
   * borrows them from a fallback whose advance width differs; the pane gives
   * this segment a fixed 1ch box so the columns still line up. In a terminal
   * the cell grid does that job already.
   */
  readonly glyph?: boolean;
}

export interface RunLine {
  readonly segments: readonly Segment[];
}

const INDENT = "  ";
const EVIDENCE_INDENT = "      ";
const GAP = "  ";

/** A column never narrows past the point of being readable. */
const PATH_COLUMN_MIN = 16;
const SYMBOL_COLUMN_MIN = 16;

const TONE_BY_STATE = {
  EQUIVALENT: "proof",
  DIVERGED: "break",
  ABSTAINED: "open",
} as const satisfies Record<Verdict["state"], Tone>;

/**
 * Columns are separated by at least this much, always. `padEnd` alone does
 * not: a value longer than its column comes back unpadded and runs straight
 * into the next one, which shipped a path and a symbol fused together.
 */
const COLUMN_GAP = 2;

const pad = (text: string, width: number) =>
  text.padEnd(Math.max(width, text.length + COLUMN_GAP), " ");

function evidenceFor(verdict: Verdict): string {
  switch (verdict.state) {
    case "EQUIVALENT":
      return `${formatCount(verdict.inputs)} inputs`;
    case "DIVERGED":
      return "";
    case "ABSTAINED":
      return verdict.obstruction;
  }
}

const plural = (n: number, one: string, many: string) =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * The banner. Once per invocation, never per line
 * (components/Terminal/README.md).
 */
export function bannerSegments(): readonly Segment[] {
  return [
    { text: TOMBSTONE, tone: "proof", glyph: true },
    { text: " QED · DETERMINISTIC VERIFICATION", tone: "muted" },
  ];
}

export function buildRunLines(result: RunResult): readonly RunLine[] {
  const lines: RunLine[] = [];
  const push = (...segments: Segment[]) => lines.push({ segments });

  push({ text: "$", tone: "muted" }, { text: ` ${result.command}`, tone: "ink" });
  push();
  push({
    text:
      `${INDENT}${formatCount(result.changedFunctions)} functions changed · ` +
      `${formatCount(result.verifiableFunctions)} verifiable · ${result.duration}`,
    tone: "muted",
  });
  push();

  // Three fixed columns, measured from the run itself; evidence ragged right.
  const wordWidth =
    Math.max(0, ...result.runs.map((r) => r.verdict.state.length)) + 2;

  // A column is as wide as the values that are actually in it, except for an
  // outlier: one 37-character symbol among ten short ones should not set the
  // layout for all of them. The ninetieth percentile keeps the common case
  // inline and lets the outlier wrap its evidence onto its own line.
  //
  // Clamping to a fixed minimum instead made *every* row wrap as soon as one
  // long path appeared, which is worse than a long line.
  const percentile = (values: readonly number[], fraction: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.floor(fraction * (sorted.length - 1)),
    );
    return sorted[index] ?? 0;
  };

  const pathWidth =
    Math.max(
      PATH_COLUMN_MIN,
      percentile(result.runs.map((r) => r.path.length), 0.9),
    ) + 2;
  const symbolWidth =
    Math.max(
      SYMBOL_COLUMN_MIN,
      percentile(result.runs.map((r) => r.symbol.length), 0.9),
    ) + 2;

  for (const run of result.runs) {
    const tone = TONE_BY_STATE[run.verdict.state];
    const glyph = TERMINAL_GLYPH[run.verdict.state];
    const evidence = evidenceFor(run.verdict);
    const overflows =
      run.path.length + 2 > pathWidth || run.symbol.length + 2 > symbolWidth;

    const segments: Segment[] = [
      { text: INDENT, tone: "ink" },
      { text: glyph, tone, bold: true, glyph: true },
      {
        text: pad(` ${run.verdict.state}`, wordWidth + 1),
        tone,
        bold: true,
      },
      { text: pad(run.path, pathWidth), tone: "ink" },
      {
        text:
          evidence === "" || overflows
            ? run.symbol
            : pad(run.symbol, symbolWidth),
        tone: "ink",
      },
    ];
    if (evidence !== "" && !overflows) {
      segments.push({ text: evidence, tone: "muted" });
    }
    lines.push({ segments });

    if (evidence !== "" && overflows) {
      // Indented like a counterexample, not to the evidence column: that
      // column is computed from the clamped widths, and this row is wider
      // than them by definition - so aligning to it lines the text up under
      // nothing.
      push({ text: `${EVIDENCE_INDENT}${evidence}`, tone: "muted" });
    }

    if (run.verdict.state === "DIVERGED") {
      const { input, base, head, repro } = run.verdict.counterexample;
      push();
      const affects = run.verdict.counterexample.affects;
      const labelled: readonly (readonly [string, string])[] = [
        ["input", input],
        ["base", base],
        ["head", head],
        ["repro", repro],
        ...(affects === undefined
          ? []
          : [["affects", affects] as readonly [string, string]]),
      ];
      // Sized to the longest label present, so the values line up whether or
      // not the fifth line is there.
      const labelWidth =
        Math.max(...labelled.map(([label]) => label.length)) + COLUMN_GAP;

      for (const [label, value] of labelled) {
        push(
          { text: `${EVIDENCE_INDENT}${pad(label, labelWidth)}`, tone: "muted" },
          { text: value, tone: "ink" },
        );
      }
      push();
    }
  }

  push();
  const summary = summarise(result);
  push(
    {
      // All three counts, always, including zeros: hiding the abstains is what
      // would make the output less believable, not more.
      text:
        `${INDENT}${plural(summary.equivalent, "equivalent", "equivalent")} · ` +
        `${plural(summary.diverged, "divergence", "divergences")} · ` +
        `${plural(summary.abstained, "abstained", "abstained")} · ` +
        `exit ${summary.exitCode}`,
      tone: "muted",
    },
    { text: GAP, tone: "muted" },
    { text: TOMBSTONE, tone: "proof", glyph: true },
  );

  // A run with nothing in it pushed a blank after the header and another
  // before the summary, which reads as a gap where the rows should be.
  return lines.filter(
    (line, i) =>
      line.segments.length > 0 || (lines[i - 1]?.segments.length ?? 1) > 0,
  );
}

/** The plain-text form, with no colour at all. */
export function runLinesToText(lines: readonly RunLine[]): string {
  return lines
    .map((line) => line.segments.map((s) => s.text).join("").trimEnd())
    .join("\n");
}
