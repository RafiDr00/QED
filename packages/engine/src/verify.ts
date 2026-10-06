import fc from "fast-check";
import type { Verdict } from "@qed/ui/model";

import { equals, show, EXACT, type Tolerance } from "./compare.js";
import { generatorFor, mineCorpus } from "./generate.js";
import {
  callFunction,
  callTwice,
  loadModule,
  DEFAULT_CONTROLS,
  type CallOutcome,
  type Controls,
  type Resolver,
  type Sandbox,
} from "./sandbox.js";

/**
 * One function, two versions, one verdict.
 *
 * ## What EQUIVALENT means here
 *
 * "No divergence was found over N generated inputs, and on every one of those
 * inputs both versions were deterministic."
 *
 * The second half used to be missing. Determinism was established from eight
 * sampled inputs while the verdict was based on two thousand *plus* the edge
 * cases - so a function reading the clock on a branch only an edge case
 * reached was certified EQUIVALENT while differing in production every
 * millisecond. That was a demonstrated false positive. Determinism is now
 * checked on exactly the inputs the verdict rests on.
 */

export interface VerifyOptions {
  /** How many generated inputs to try before calling it equivalent. */
  readonly inputs?: number;
  readonly tolerance?: Tolerance;
  readonly controls?: Controls;
  /** Fixes the generated inputs, so a run is reproducible. */
  readonly seed?: number;
  /** Supplies the source of a pinned relative import, per version. */
  readonly resolveBase?: Resolver;
  readonly resolveHead?: Resolver;
}

export interface VerifyRequest {
  readonly fileName: string;
  readonly symbol: string;
  readonly base: string;
  readonly head: string;
}

export interface VerifyResult {
  readonly verdict: Verdict;
  /** Tolerances that were applied, for the attestation to print. */
  readonly tolerancesApplied: readonly string[];
  /** The controls the run used, for the attestation to print. */
  readonly controls: Controls;
  /**
   * The exact arguments that diverged.
   *
   * `counterexample.input` is a rendering for a reader; this is the value, so
   * a record can be replayed rather than retyped from a printed string.
   */
  readonly counterexampleArgs?: readonly unknown[];
}

const DEFAULT_INPUTS = 1000;

/**
 * The second ambient differs by an awkward amount on purpose.
 *
 * An offset of whole days is a multiple of 1000, so a function doing
 * `Date.now() % 1000` returns the same answer under both and looks pure.
 */
function otherAmbient(controls: Controls): Controls {
  return {
    epochMs: controls.epochMs + 31_622_401_337,
    rngSeed: controls.rngSeed ^ 0x2c1b,
  };
}

/** How the CLI is asked to reproduce one case, exactly as it is printed. */
export function reproCommand(
  fileName: string,
  symbol: string,
  args: readonly unknown[],
): string {
  return `qed repro ${fileName} ${symbol} --input '${JSON.stringify(args)}'`;
}

/** What a reader is shown for one side of a divergence. */
function showOutcome(outcome: CallOutcome): string {
  if (outcome.obstruction !== undefined) return outcome.obstruction;
  if (outcome.kind === "threw") {
    const e = outcome.value as { name?: string; message?: string } | undefined;
    return e?.name ? `threw ${e.name}: ${e.message ?? ""}`.trim() : "threw";
  }
  return show(outcome.value);
}

function sameOutcome(
  a: CallOutcome,
  b: CallOutcome,
  tolerance: Tolerance,
): boolean {
  if (a.obstruction !== undefined || b.obstruction !== undefined) {
    return a.obstruction === b.obstruction;
  }
  if (a.kind !== b.kind) return false;
  return equals(a.value, b.value, tolerance).equal;
}

/** Two versions, each under two ambients. */
interface Pair {
  readonly baseA: Sandbox;
  readonly headA: Sandbox;
  readonly baseB: Sandbox;
  readonly headB: Sandbox;
}

export type Finding =
  | { readonly kind: "agree" }
  | { readonly kind: "nondeterministic" }
  | { readonly kind: "blocked"; readonly obstruction: string }
  | {
      readonly kind: "diverged";
      readonly base: CallOutcome;
      readonly head: CallOutcome;
    };

/**
 * Everything one input can tell us.
 *
 * Determinism first: a version that answers differently under a different
 * clock has no fixed behaviour to compare, and reporting that it agrees with
 * the other side is the false claim this exists to prevent.
 */
export function examine(
  pair: Pair,
  symbol: string,
  args: readonly unknown[],
  tolerance: Tolerance,
): Finding {
  const baseA = callFunction(pair.baseA, symbol, structuredClone(args));
  if (baseA.obstruction !== undefined) {
    return { kind: "blocked", obstruction: baseA.obstruction };
  }
  const headA = callFunction(pair.headA, symbol, structuredClone(args));
  if (headA.obstruction !== undefined) {
    return { kind: "blocked", obstruction: headA.obstruction };
  }

  const baseB = callFunction(pair.baseB, symbol, structuredClone(args));
  const headB = callFunction(pair.headB, symbol, structuredClone(args));
  if (
    !sameOutcome(baseA, baseB, tolerance) ||
    !sameOutcome(headA, headB, tolerance)
  ) {
    return { kind: "nondeterministic" };
  }

  return sameOutcome(baseA, headA, tolerance)
    ? { kind: "agree" }
    : { kind: "diverged", base: baseA, head: headA };
}

export function verify(
  request: VerifyRequest,
  options: VerifyOptions = {},
): VerifyResult {
  const { fileName, symbol, base, head } = request;
  const controls = options.controls ?? DEFAULT_CONTROLS;
  const other = otherAmbient(controls);
  const tolerance = options.tolerance ?? EXACT;
  const inputs = options.inputs ?? DEFAULT_INPUTS;

  const abstain = (obstruction: string): VerifyResult => ({
    verdict: { state: "ABSTAINED", obstruction },
    tolerancesApplied: [],
    controls,
  });

  // Inputs come from the contract existing callers rely on: the base version's
  // declared types, seeded with the constants written in either version.
  const generation = generatorFor(base, fileName, symbol, mineCorpus(base, head));
  if (generation.kind === "unsupported") return abstain(generation.obstruction);

  let pair: Pair;
  try {
    pair = {
      baseA: loadModule(base, fileName, controls, options.resolveBase),
      headA: loadModule(head, fileName, controls, options.resolveHead),
      baseB: loadModule(base, fileName, other, options.resolveBase),
      headB: loadModule(head, fileName, other, options.resolveHead),
    };
  } catch (error) {
    return abstain(
      error instanceof Error && "obstruction" in error
        ? String((error as { obstruction: unknown }).obstruction)
        : String(error),
    );
  }

  /** Which control explains a difference, for one input. */
  const narrow = (args: readonly unknown[]): string => {
    for (const [reason, changed] of [
      ["depends on wall-clock time", { ...controls, epochMs: other.epochMs }],
      ["depends on a random number", { ...controls, rngSeed: other.rngSeed }],
    ] as const) {
      for (const [source, resolve] of [
        [base, options.resolveBase],
        [head, options.resolveHead],
      ] as const) {
        const reference = callFunction(
          loadModule(source, fileName, controls, resolve),
          symbol,
          structuredClone(args),
        );
        const moved = callFunction(
          loadModule(source, fileName, changed, resolve),
          symbol,
          structuredClone(args),
        );
        if (!sameOutcome(reference, moved, tolerance)) return reason;
      }
    }
    return "depends on something other than its arguments";
  };

  // State carried between calls is a property of the module rather than of one
  // input, so it is checked over the edges and a sample, twice per instance.
  const stateSamples = [
    ...generation.examples.slice(0, 24),
    ...fc.sample(generation.arbitrary, { numRuns: 8, seed: options.seed ?? 0 }),
  ];
  for (const sandbox of [pair.baseA, pair.headA]) {
    for (const args of stateSamples) {
      const [first, second] = callTwice(sandbox, symbol, args);
      if (first.obstruction !== undefined) return abstain(first.obstruction);
      if (!sameOutcome(first, second, tolerance)) {
        return abstain("returns a different answer for the same input");
      }
    }
  }

  const applied = new Set<string>();
  let blocked: string | undefined;
  let nondeterministic: string | undefined;

  const details = fc.check(
    fc.property(generation.arbitrary, (args: unknown[]) => {
      const finding = examine(pair, symbol, args, tolerance);
      switch (finding.kind) {
        case "blocked":
          blocked ??= finding.obstruction;
          return false;
        case "nondeterministic":
          nondeterministic ??= narrow(args);
          return false;
        case "diverged": {
          const comparison = equals(
            finding.base.value,
            finding.head.value,
            tolerance,
          );
          for (const t of comparison.applied) applied.add(t);
          return false;
        }
        case "agree":
          return true;
      }
    }),
    {
      numRuns: inputs,
      seed: options.seed ?? 0,
      // The edges run first, so finding them does not depend on the seed. The
      // property takes one arbitrary - the whole argument list - so each
      // example is a one-element tuple holding that list.
      examples: generation.examples.map((row): [unknown[]] => [row]),
    },
  );

  // A function that cannot be run, or cannot be pinned down, has no verdict to
  // give however the comparison turned out.
  if (blocked !== undefined) return abstain(blocked);
  if (nondeterministic !== undefined) return abstain(nondeterministic);

  if (!details.failed) {
    return {
      verdict: {
        state: "EQUIVALENT",
        inputs: details.numRuns,
        strategy: "type-directed, corpus-seeded",
      },
      tolerancesApplied: [...applied],
      controls,
    };
  }

  // fast-check shrank the input; re-run the shrunk one so the sides shown are
  // the minimised case rather than the first one that happened to fail.
  const minimal: unknown[] = (details.counterexample ?? [[]])[0];
  const finding = examine(pair, symbol, minimal, tolerance);
  if (finding.kind === "blocked") return abstain(finding.obstruction);
  if (finding.kind === "nondeterministic") return abstain(narrow(minimal));
  if (finding.kind === "agree") {
    // Shrinking landed on an input that agrees, which means the disagreement
    // was not a property of the input alone. Saying EQUIVALENT here would be
    // the false claim again.
    return abstain("could not be pinned to a single input");
  }

  return {
    verdict: {
      state: "DIVERGED",
      counterexample: {
        input: show(minimal.length === 1 ? minimal[0] : minimal),
        base: showOutcome(finding.base),
        head: showOutcome(finding.head),
        repro: reproCommand(fileName, symbol, minimal),
        foundAt: { index: details.numRuns, of: inputs },
      },
    },
    tolerancesApplied: [...applied],
    controls,
    counterexampleArgs: minimal,
  };
}
