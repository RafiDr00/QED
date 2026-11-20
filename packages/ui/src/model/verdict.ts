/**
 * The verdict model. React-free on purpose: @qed/cli-render imports these
 * types, and the CLI must not pull a UI framework in.
 *
 * The design system's first load-bearing rule is "No claim without its
 * evidence" (README, "The rules that are load-bearing"). That is encoded here
 * rather than checked at render time: each state carries the evidence its own
 * state requires, and no other. An EQUIVALENT without a count does not
 * type-check - verify.ts G7 asserts exactly that.
 */

export const VERDICT_STATES = ["EQUIVALENT", "DIVERGED", "ABSTAINED"] as const;
export type VerdictState = (typeof VERDICT_STATES)[number];

/** The minimised counterexample. Four labelled lines, repro copyable as-is. */
/** A plottable value: what JSON keeps as itself. */
export type SampleValue = number | string | boolean | null;

/**
 * Inputs classified around a divergence, along the one or two fields its
 * description names, so a reader can see the region rather than only read it.
 * Capped, and drawn from the same classification the description came from.
 * DECISIONS.md D-068.
 */
export interface DivergenceSample {
  /** The field on the horizontal axis, as the description names it. */
  readonly x: string;
  /** The second field, when the description names two. */
  readonly y?: string;
  /** [x value, y value or null, 1 when the two versions disagreed there]. */
  readonly points: readonly (readonly [SampleValue, SampleValue, 0 | 1])[];
  /** Thresholds the description draws, as rules on their axis. */
  readonly rules?: readonly {
    readonly axis: "x" | "y";
    readonly operator: "is at least" | "is more than";
    readonly value: number;
  }[];
  /** Classified inputs left out because JSON cannot carry them (NaN, Infinity). */
  readonly omitted?: number;
}

export interface Counterexample {
  /** The input, formatted the way the engine printed it. */
  readonly input: string;
  readonly base: string;
  readonly head: string;
  /** A complete command - `qed repro 9f2a1c` - never a fragment. */
  readonly repro: string;
  /** "input 7 of 9,110": which generated input diverged, and out of how many. */
  readonly foundAt?: { readonly index: number; readonly of: number };
  /**
   * Where the change bites, in one clause.
   *
   * "Diverges exactly when `qty` is at least 100 and `tier` is "gold". That is
   * 6.2% of generated inputs."
   *
   * A counterexample proves a change happened; this says what it changed. The
   * design system's four labelled lines answer "can I reproduce it"; this
   * answers "do I care", which is the question a reviewer actually has.
   * DECISIONS.md D-040.
   */
  readonly affects?: string;
  /** Where it diverges, as points to plot. */
  readonly sample?: DivergenceSample;
}

/** Proven: the engine compared `inputs` generated inputs and found no difference. */
export interface EquivalentVerdict {
  readonly state: "EQUIVALENT";
  /** Never optional. A count-free EQUIVALENT is a claim, not a result. */
  readonly inputs: number;
  /** "type-directed, corpus-seeded, coverage-guided" */
  readonly strategy?: string;
  /**
   * How many of `inputs` both versions answered by throwing the same error.
   *
   * Agreeing on an error is agreement, but it is not agreement about a
   * result, and a reader weighing the count should know how much of it was
   * the error path. Absent when none threw. DECISIONS.md D-050.
   */
  readonly threw?: number;
  /**
   * How much of the function the inputs reached: branches entered at least
   * once, of the branches the function has, in the version that ships. An
   * equivalence over inputs that never took a branch says nothing about that
   * branch, and this says which lines those were. Absent when the function
   * has no branches. DECISIONS.md D-066.
   */
  readonly branches?: {
    readonly reached: number;
    readonly of: number;
    /** Lines of branches no input reached, at most eight. */
    readonly unreached?: readonly number[];
  };
}

/** Broken: the engine found a difference and minimised it. */
export interface DivergedVerdict {
  readonly state: "DIVERGED";
  readonly counterexample: Counterexample;
}

/** Open: the engine could not run, and says exactly why. */
export interface AbstainedVerdict {
  readonly state: "ABSTAINED";
  /**
   * The exact obstruction in one clause - "opens a database connection".
   * Never "could not verify" (components/Verdict/README.md).
   */
  readonly obstruction: string;
}

export type Verdict = EquivalentVerdict | DivergedVerdict | AbstainedVerdict;

export interface FunctionRun {
  /** Repository-relative file, e.g. billing/tax.go */
  readonly path: string;
  /** The symbol inside it, e.g. computeVat */
  readonly symbol: string;
  readonly verdict: Verdict;
  /**
   * The changed file this function reaches through an import, when the
   * function is in the run only for that reason. "via pricing/rate.ts".
   */
  readonly via?: string;
  /**
   * The 1-based line the function starts on in the new version, so a CI
   * annotation or a SARIF result can point at it. Absent when the new
   * version no longer exports it.
   */
  readonly line?: number;
}

export interface RunResult {
  /** The invocation, echoed at the top of the output. */
  readonly command: string;
  readonly changedFunctions: number;
  readonly verifiableFunctions: number;
  /** Wall-clock, already formatted: "2m 14s". */
  readonly duration: string;
  readonly runs: readonly FunctionRun[];
}

export interface RunSummary {
  readonly equivalent: number;
  readonly diverged: number;
  readonly abstained: number;
  /** Non-zero only on DIVERGED: abstaining must never break a build. */
  readonly exitCode: number;
}

export function summarise(result: RunResult): RunSummary {
  let equivalent = 0;
  let diverged = 0;
  let abstained = 0;
  for (const run of result.runs) {
    switch (run.verdict.state) {
      case "EQUIVALENT":
        equivalent++;
        break;
      case "DIVERGED":
        diverged++;
        break;
      case "ABSTAINED":
        abstained++;
        break;
    }
  }
  return { equivalent, diverged, abstained, exitCode: diverged > 0 ? 1 : 0 };
}

const COUNT = new Intl.NumberFormat("en-US");

/** "18,402" - the same grouping on screen, in the terminal and in the PDF. */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** "2,000 inputs", or "2,000 inputs · 160 threw" when some agreed by throwing. */
export function inputsEvidence(verdict: EquivalentVerdict): string {
  const parts = [`${formatCount(verdict.inputs)} inputs`];
  if (verdict.threw !== undefined && verdict.threw > 0) {
    parts.push(`${formatCount(verdict.threw)} threw`);
  }
  if (verdict.branches !== undefined) {
    parts.push(`${verdict.branches.reached}/${verdict.branches.of} branches`);
  }
  return parts.join(" · ");
}

/**
 * The one-line evidence that travels beside the verdict word. Total, because
 * every state owes the reader something.
 */
export function evidenceLine(verdict: Verdict): string {
  switch (verdict.state) {
    case "EQUIVALENT":
      return inputsEvidence(verdict);
    case "DIVERGED": {
      const found = verdict.counterexample.foundAt;
      return found
        ? `input ${formatCount(found.index)} of ${formatCount(found.of)}`
        : verdict.counterexample.input;
    }
    case "ABSTAINED":
      return verdict.obstruction;
  }
}

/**
 * Terminal glyphs. The design system fixes these: filled for EQUIVALENT and
 * DIVERGED, hollow for ABSTAINED (components/Terminal/README.md).
 */
export const TERMINAL_GLYPH: Readonly<Record<VerdictState, string>> = {
  EQUIVALENT: "●",
  DIVERGED: "●",
  ABSTAINED: "○",
};

/** The tombstone that closes a run. */
export const TOMBSTONE = "∎";
