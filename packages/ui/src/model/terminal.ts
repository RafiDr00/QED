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

/**
 * A terminal is 80 columns wide unless it says otherwise, and that is what
 * sizes the pane on screen too - so the verdict list, the part the design
 * system insists must not wrap, fits both.
 */
export const DEFAULT_COLUMNS = 80;

/** Columns are shrunk to fit, but never past the point of being readable. */
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

export interface LayoutOptions {
  /** Terminal width in characters. */
  readonly columns?: number;
}

export function buildRunLines(
  result: RunResult,
  options: LayoutOptions = {},
): readonly RunLine[] {
  const columns = options.columns ?? DEFAULT_COLUMNS;
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
  //
  // The columns are capped. Without a cap one 37-character symbol pushes the
  // evidence column past the pane for every other row, and "a verdict list
  // that wraps is a verdict list nobody reads" cuts both ways: the fix is not
  // to let one outlier set the layout. A row that outgrows its column keeps
  // its full name and puts its evidence on the next line, indented to the
  // column it would have started in - so the alignment holds for the rest.
  const wordWidth =
    Math.max(0, ...result.runs.map((r) => r.verdict.state.length)) + 2;
  const fixed = INDENT.length + 1 + (wordWidth + 1);
  const widestEvidence = Math.max(
    0,
    ...result.runs.map((r) => evidenceFor(r.verdict).length),
  );

  let pathWidth = Math.max(0, ...result.runs.map((r) => r.path.length)) + 2;
  let symbolWidth = Math.max(0, ...result.runs.map((r) => r.symbol.length)) + 2;

  // Shrink to fit the terminal, taking it out of the symbol column first:
  // a path locates the change, and a reader scanning a run needs that most.
  let excess = fixed + pathWidth + symbolWidth + widestEvidence - columns;
  if (excess > 0) {
    const fromSymbol = Math.min(
      excess,
      Math.max(0, symbolWidth - SYMBOL_COLUMN_MIN),
    );
    symbolWidth -= fromSymbol;
    excess -= fromSymbol;
    const fromPath = Math.min(excess, Math.max(0, pathWidth - PATH_COLUMN_MIN));
    pathWidth -= fromPath;
  }

  const evidenceColumn = fixed + pathWidth + symbolWidth;

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
      push({ text: `${" ".repeat(evidenceColumn)}${evidence}`, tone: "muted" });
    }

    if (run.verdict.state === "DIVERGED") {
      const { input, base, head, repro } = run.verdict.counterexample;
      push();
      for (const [label, value] of [
        ["input", input],
        ["base", base],
        ["head", head],
        ["repro", repro],
      ] as const) {
        push(
          { text: `${EVIDENCE_INDENT}${pad(label, 8)}`, tone: "muted" },
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
