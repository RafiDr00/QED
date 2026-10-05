import fc from "fast-check";
import type { Verdict } from "@qed/ui/model";

import { equals, show, EXACT, type Tolerance } from "./compare.js";
import { generatorFor, mineCorpus } from "./generate.js";
import { probePurity } from "./purity.js";
import {
  callFunction,
  loadModule,
  DEFAULT_CONTROLS,
  type CallOutcome,
  type Controls,
} from "./sandbox.js";

/**
 * One function, two versions, one verdict.
 *
 * The order is the order the design system describes: decide whether the
 * function can be run at all, generate inputs from its declared types, run
 * both versions under the same controls, compare, and minimise anything that
 * disagrees.
 *
 * Every exit from here carries its evidence, because `Verdict` has nowhere to
 * put a claim without one.
 */

export interface VerifyOptions {
  /** How many generated inputs to try before calling it equivalent. */
  readonly inputs?: number;
  readonly tolerance?: Tolerance;
  readonly controls?: Controls;
  /** Fixes the generated inputs, so a run is reproducible. */
  readonly seed?: number;
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
}

const DEFAULT_INPUTS = 1000;

/** How the CLI is asked to reproduce one case, exactly as it is printed. */
export function reproCommand(
  fileName: string,
  symbol: string,
  args: readonly unknown[],
): string {
  return `qed repro ${fileName} ${symbol} --input '${JSON.stringify(args)}'`;
}

function outcomeOf(
  source: string,
  fileName: string,
  symbol: string,
  args: readonly unknown[],
  controls: Controls,
): CallOutcome {
  const sandbox = loadModule(source, fileName, controls);
  return callFunction(sandbox, symbol, structuredClone(args));
}

/** What a reader is shown for one side of a divergence. */
function showOutcome(outcome: CallOutcome): string {
  if (outcome.kind === "threw") {
    const e = outcome.value as { name?: string; message?: string } | undefined;
    return e?.name ? `threw ${e.name}: ${e.message ?? ""}`.trim() : "threw";
  }
  return show(outcome.value);
}

export function verify(
  request: VerifyRequest,
  options: VerifyOptions = {},
): VerifyResult {
  const { fileName, symbol, base, head } = request;
  const controls = options.controls ?? DEFAULT_CONTROLS;
  const tolerance = options.tolerance ?? EXACT;
  const inputs = options.inputs ?? DEFAULT_INPUTS;

  const abstain = (obstruction: string): VerifyResult => ({
    verdict: { state: "ABSTAINED", obstruction },
    tolerancesApplied: [],
    controls,
  });

  // 1. Inputs come from the contract the existing callers rely on: the base
  //    version's declared types.
  // Seeded from the constants in both versions: the boundary a change moved
  // is almost always written down in one of them.
  const generation = generatorFor(
    base,
    fileName,
    symbol,
    mineCorpus(base, head),
  );
  if (generation.kind === "unsupported") return abstain(generation.obstruction);

  // 2. Can either version be run at all? A few samples are enough to meet a
  //    clock or a socket; the probe explains whichever it finds.
  const samples = fc.sample(generation.arbitrary, {
    numRuns: 8,
    seed: options.seed ?? 0,
  });
  // Either side being unrunnable blocks the comparison. The design system
  // wants one clause, and the obstruction is that clause.
  for (const source of [head, base]) {
    const purity = probePurity(source, fileName, symbol, samples);
    if (!purity.verifiable) return abstain(purity.obstruction);
  }

  // 3. Run both, compare, and let fast-check shrink anything that disagrees.
  const applied = new Set<string>();

  const details = fc.check(
    fc.property(generation.arbitrary, (args: unknown[]) => {
      const a = outcomeOf(base, fileName, symbol, args, controls);
      const b = outcomeOf(head, fileName, symbol, args, controls);

      if (a.kind !== b.kind) return false;
      const comparison = equals(a.value, b.value, tolerance);
      for (const t of comparison.applied) applied.add(t);
      return comparison.equal;
    }),
    {
      numRuns: inputs,
      seed: options.seed ?? 0,
      // No endOnFailure: it stops at the first failing input *without
      // shrinking*, and "the minimised counterexample" is the whole point.
      // It reported qty 498589 where the boundary it moved is 100.
      // The edges are run first, so finding them does not depend on the seed.
      // The property takes one arbitrary - the whole argument list - so each
      // example is a one-element tuple holding that list. Casting the rows
      // straight across type-checked and quietly fed fast-check the wrong
      // shape, which is why -0 was still being missed.
      examples: generation.examples.map((row): [unknown[]] => [row]),
    },
  );

  if (!details.failed) {
    return {
      verdict: {
        state: "EQUIVALENT",
        inputs: details.numRuns,
        strategy: "type-directed, seeded",
      },
      tolerancesApplied: [...applied],
      controls,
    };
  }

  // fast-check shrank the input; re-run the shrunk one so the two sides shown
  // are the minimised case rather than the first one that happened to fail.
  const minimal: unknown[] = (details.counterexample ?? [[]])[0];
  const a = outcomeOf(base, fileName, symbol, minimal, controls);
  const b = outcomeOf(head, fileName, symbol, minimal, controls);

  return {
    verdict: {
      state: "DIVERGED",
      counterexample: {
        input: show(minimal.length === 1 ? minimal[0] : minimal),
        base: showOutcome(a),
        head: showOutcome(b),
        repro: reproCommand(fileName, symbol, minimal),
        foundAt: { index: details.numRuns, of: inputs },
      },
    },
    tolerancesApplied: [...applied],
    controls,
  };
}
