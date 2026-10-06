import fc from "fast-check";

import { show, type Tolerance } from "./compare.js";
import type { Generation } from "./generate.js";
import { examine, type Finding } from "./verify.js";

/**
 * Where a change bites, not merely that it does.
 *
 * `DIVERGED` tells a reader that something moved. Almost every diff is meant
 * to move something, so on its own that is a question rather than an answer.
 * This takes the inputs already generated, sorts them into the ones where the
 * two versions agree and the ones where they do not, and looks for the
 * simplest description of the second set:
 *
 *   Diverges when `tier` is "gold" and `qty` is at least 100.
 *   Agrees on the other 97.9% of generated inputs.
 *
 * The candidate thresholds are the constants mined out of the two versions,
 * because the boundary a change moved is nearly always written down in it.
 */

export interface Condition {
  /** Where in the argument list, rendered the way a reader would write it. */
  readonly path: string;
  readonly operator: "is" | "is at least" | "is more than" | "is not";
  readonly value: unknown;
}

export interface BlastRadius {
  /** Inputs classified while measuring. */
  readonly sampled: number;
  readonly diverging: number;
  /** The conditions every diverging input met, and no agreeing one did. */
  readonly conditions: readonly Condition[];
  /** True when the conditions describe the diverging set exactly. */
  readonly exact: boolean;
}

/** One leaf of an argument list, addressed the way a reader would say it. */
interface Leaf {
  readonly path: string;
  readonly value: unknown;
}

function leaves(args: readonly unknown[], depth = 0): Leaf[] {
  const out: Leaf[] = [];
  const walk = (value: unknown, path: string, level: number): void => {
    if (level > 3) return;
    if (value === null || typeof value !== "object") {
      out.push({ path, value });
      return;
    }
    if (Array.isArray(value)) {
      out.push({ path: `${path}.length`, value: value.length });
      return;
    }
    for (const [key, inner] of Object.entries(value)) {
      walk(inner, path === "" ? key : `${path}.${key}`, level + 1);
    }
  };

  args.forEach((arg, index) => {
    walk(arg, args.length === 1 ? "" : `arg${index}`, depth);
  });
  return out;
}

const matches = (condition: Condition, value: unknown): boolean => {
  switch (condition.operator) {
    case "is":
      return Object.is(value, condition.value);
    case "is not":
      return !Object.is(value, condition.value);
    case "is at least":
      return typeof value === "number" && value >= Number(condition.value);
    case "is more than":
      return typeof value === "number" && value > Number(condition.value);
  }
};

/** Conditions worth testing, drawn from what the diverging inputs look like. */
function candidates(
  diverging: readonly Leaf[][],
  corpus: readonly number[],
): Condition[] {
  const out: Condition[] = [];
  const seen = new Set<string>();
  const add = (condition: Condition) => {
    const key = `${condition.path}|${condition.operator}|${show(condition.value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(condition);
  };

  const first = diverging[0] ?? [];
  for (const leaf of first) {
    // Equality against the value this input happened to have.
    add({ path: leaf.path, operator: "is", value: leaf.value });

    if (typeof leaf.value === "number") {
      for (const threshold of corpus) {
        add({ path: leaf.path, operator: "is at least", value: threshold });
        add({ path: leaf.path, operator: "is more than", value: threshold });
      }
    }
  }
  return out;
}

const valueAt = (row: readonly Leaf[], path: string): unknown =>
  row.find((leaf) => leaf.path === path)?.value;

/**
 * Finds the smallest set of conditions that every diverging input meets and
 * no agreeing input does.
 *
 * Greedy rather than exhaustive: take the condition that excludes the most
 * agreeing inputs while still covering every diverging one, then repeat. Two
 * or three conditions describe nearly every real change, and a greedy search
 * over them is instant where an exhaustive one is not.
 */
function describe(
  diverging: readonly Leaf[][],
  agreeing: readonly Leaf[][],
  corpus: readonly number[],
): { conditions: Condition[]; exact: boolean } {
  const conditions: Condition[] = [];
  let remaining = [...agreeing];
  const pool = candidates(diverging, corpus);

  for (let round = 0; round < 3 && remaining.length > 0; round++) {
    let best: { condition: Condition; survivors: Leaf[][] } | undefined;

    for (const condition of pool) {
      // It must hold for every diverging input, or it is not a description.
      const holdsThroughout = diverging.every((row) =>
        matches(condition, valueAt(row, condition.path)),
      );
      if (!holdsThroughout) continue;

      const survivors = remaining.filter((row) =>
        matches(condition, valueAt(row, condition.path)),
      );
      if (!best || survivors.length < best.survivors.length) {
        best = { condition, survivors };
      }
    }

    if (!best || best.survivors.length === remaining.length) break;
    conditions.push(best.condition);
    remaining = best.survivors;
  }

  return { conditions, exact: remaining.length === 0 };
}

export interface BlastOptions {
  readonly sample?: number;
  readonly seed?: number;
}

/**
 * Classifies inputs around a known divergence and describes the region.
 *
 * Only called once a counterexample exists, so the cost lands on the runs
 * where a reader has a question to answer.
 */
export function blastRadius(
  pair: Parameters<typeof examine>[0],
  symbol: string,
  generation: Extract<Generation, { kind: "ok" }>,
  tolerance: Tolerance,
  corpus: readonly number[],
  options: BlastOptions = {},
): BlastRadius | undefined {
  const sample = options.sample ?? 400;
  const rows = [
    ...generation.examples,
    ...fc.sample(generation.arbitrary, {
      numRuns: sample,
      seed: options.seed ?? 0,
    }),
  ];

  const diverging: Leaf[][] = [];
  const agreeing: Leaf[][] = [];

  for (const args of rows) {
    let finding: Finding;
    try {
      finding = examine(pair, symbol, args, tolerance);
    } catch {
      continue;
    }
    if (finding.kind === "diverged") diverging.push(leaves(args));
    else if (finding.kind === "agree") agreeing.push(leaves(args));
  }

  const classified = diverging.length + agreeing.length;
  if (diverging.length === 0 || classified === 0) return undefined;

  const { conditions, exact } = describe(diverging, agreeing, corpus);
  return {
    sampled: classified,
    diverging: diverging.length,
    conditions,
    exact,
  };
}

/** The sentence a reader sees. */
export function describeBlast(radius: BlastRadius): string {
  const share = ((radius.diverging / radius.sampled) * 100).toFixed(1);

  if (radius.conditions.length === 0) {
    return `Diverges on ${share}% of generated inputs; no single condition describes them.`;
  }

  const clauses = radius.conditions.map(
    (condition) =>
      `${condition.path === "" ? "the input" : `\`${condition.path}\``} ${condition.operator} ${show(condition.value)}`,
  );
  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;

  return radius.exact
    ? `Diverges exactly when ${joined}. That is ${share}% of generated inputs.`
    : `Diverges when ${joined}, and on ${share}% of generated inputs in all.`;
}
