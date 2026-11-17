import fc from "fast-check";
import ts from "typescript";

import { reachOf, type Reach } from "./coverage.js";
import { encodeArgs } from "./encode.js";
import { findExportedFunction } from "./exports.js";
import type { Generation } from "./generate.js";
import { callFunction, type Sandbox } from "./sandbox.js";

/**
 * Coverage-guided input selection. DECISIONS.md D-066.
 *
 * Before the comparison runs, many more inputs than it will use are drawn
 * from the same type-directed generator, each is run through both versions,
 * and an input is kept when it reaches a branch - in either version - that no
 * input before it reached. The kept inputs run first in the comparison, ahead
 * of the random draws.
 *
 * Selection only. The inputs are never mutated or spliced together: a value
 * built by hand could break the declared type - one arm of a discriminated
 * union with the other's fields - and a divergence found on an input no
 * caller can construct is a false claim. Every input still comes from the
 * generator.
 */

export interface Explored {
  /** Inputs that reached a branch nothing before them did, in that order. */
  readonly kept: readonly unknown[][];
  /** How many candidates were run. */
  readonly tried: number;
}

export interface ExploreOptions {
  /** The most candidates to try. */
  readonly budget: number;
  readonly seed: number;
  /** How many rounds in a row may add nothing before the search stops. */
  readonly patience?: number;
}

const ROUND = 64;

export function explore(
  base: Sandbox,
  head: Sandbox,
  symbol: string,
  generation: Extract<Generation, { kind: "ok" }>,
  options: ExploreOptions,
): Explored {
  const seenBase = new Uint8Array(base.counts.length);
  const seenHead = new Uint8Array(head.counts.length);
  const fresh = (counts: Uint32Array, seen: Uint8Array): boolean => {
    let found = false;
    for (let i = 0; i < counts.length; i++) {
      if ((counts[i] ?? 0) > 0 && seen[i] === 0) {
        seen[i] = 1;
        found = true;
      }
    }
    return found;
  };
  const gains = (args: readonly unknown[]): boolean => {
    base.counts.fill(0);
    head.counts.fill(0);
    callFunction(base, symbol, args);
    callFunction(head, symbol, args);
    // Both sides, always: `||` would skip recording the second.
    const inBase = fresh(base.counts, seenBase);
    const inHead = fresh(head.counts, seenHead);
    return inBase || inHead;
  };

  // What the edges already reach is not news.
  for (const example of generation.examples) gains(example);

  const kept: unknown[][] = [];
  const keys = new Set(generation.examples.map((e) => encodeArgs(e)));
  const patience = options.patience ?? 4;
  let tried = 0;
  let idle = 0;
  for (let round = 0; tried < options.budget && idle < patience; round++) {
    const candidates = fc.sample(generation.arbitrary, {
      numRuns: Math.min(ROUND, options.budget - tried),
      seed: options.seed + 1 + round,
    });
    let gained = false;
    for (const candidate of candidates) {
      tried++;
      if (!gains(candidate)) continue;
      const key = encodeArgs(candidate);
      if (keys.has(key)) continue;
      keys.add(key);
      kept.push(candidate);
      gained = true;
    }
    idle = gained ? 0 : idle + 1;
  }

  base.counts.fill(0);
  head.counts.fill(0);
  return { kept, tried };
}

/** How much of `symbol`, in `source`, the counts in `sandbox` say was reached. */
export function reachIn(sandbox: Sandbox, source: string, fileName: string, symbol: string): Reach | undefined {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const declaration = findExportedFunction(file, symbol);
  if (!declaration) return undefined;
  return reachOf(sandbox.compiled.branches, sandbox.counts, declaration.getStart(file), declaration.getEnd());
}
