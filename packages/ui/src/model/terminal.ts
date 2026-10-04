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

const TONE_BY_STATE = {
  EQUIVALENT: "proof",
  DIVERGED: "break",
  ABSTAINED: "open",
} as const satisfies Record<Verdict["state"], Tone>;

const pad = (text: string, width: number) => text.padEnd(width, " ");

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
  const pathWidth = Math.max(0, ...result.runs.map((r) => r.path.length)) + 2;
  const symbolWidth = Math.max(0, ...result.runs.map((r) => r.symbol.length)) + 2;

  for (const run of result.runs) {
    const tone = TONE_BY_STATE[run.verdict.state];
    const glyph = TERMINAL_GLYPH[run.verdict.state];
    const evidence = evidenceFor(run.verdict);
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
        text: evidence === "" ? run.symbol : pad(run.symbol, symbolWidth),
        tone: "ink",
      },
    ];
    if (evidence !== "") segments.push({ text: evidence, tone: "muted" });
    lines.push({ segments });

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

  return lines;
}

/** The plain-text form, with no colour at all. */
export function runLinesToText(lines: readonly RunLine[]): string {
  return lines
    .map((line) => line.segments.map((s) => s.text).join("").trimEnd())
    .join("\n");
}
