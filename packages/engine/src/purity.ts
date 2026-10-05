import {
  callFunction,
  loadModule,
  DEFAULT_CONTROLS,
  type CallOutcome,
  type Controls,
} from "./sandbox.js";
import { equals } from "./compare.js";

/**
 * Whether a function can be compared at all, decided by running it rather
 * than by reading it.
 *
 * Static analysis would guess: a source file mentioning `Date` might never
 * reach that line. This runs the function under two different ambient
 * conditions and watches what happens. If the answer moves when only the
 * clock moved, the function reads the clock - whatever the source looks like.
 *
 * It is the mechanism behind "the exact obstruction, in one clause": the
 * reasons below are observations, not inferences.
 */

export type Purity =
  | { readonly verifiable: true }
  | { readonly verifiable: false; readonly obstruction: string };

export const VERIFIABLE: Purity = { verifiable: true };

/** Two ambients that differ in every control we own. */
const AMBIENT_A: Controls = DEFAULT_CONTROLS;
/**
 * The second ambient differs by an awkward amount on purpose.
 *
 * An offset of whole days is a multiple of 1000, so a function doing
 * `Date.now() % 1000` returns the same answer under both and looks pure. The
 * offset below shares no useful factor with a second, a minute, an hour or a
 * day.
 */
const AMBIENT_B: Controls = {
  epochMs: DEFAULT_CONTROLS.epochMs + 31_622_401_337,
  rngSeed: DEFAULT_CONTROLS.rngSeed ^ 0x2c1b,
};

function outcomeObstruction(outcome: CallOutcome): string | undefined {
  return outcome.obstruction;
}

/**
 * `probe` needs arguments that exercise the function. It is given the same
 * sample for every run, so any difference it sees comes from the ambient or
 * from the function itself - never from the input.
 */
export function probePurity(
  source: string,
  fileName: string,
  name: string,
  samples: readonly (readonly unknown[])[],
): Purity {
  if (samples.length === 0) {
    return { verifiable: false, obstruction: "no inputs could be generated for it" };
  }

  for (const args of samples) {
    // 1. Does it run at all, under controls?
    const a1 = call(source, fileName, name, args, AMBIENT_A);
    const blocked = outcomeObstruction(a1);
    if (blocked !== undefined) return { verifiable: false, obstruction: blocked };

    // 2. Same ambient, same input, twice *in one instance*: anything that
    //    moves is state the module carries between calls. Reloading between
    //    the two calls would reset that state and see nothing - which is
    //    exactly what this probe missed until a test caught it.
    const [first, second] = callTwiceInOneInstance(source, fileName, name, args);
    if (!sameOutcome(first, second)) {
      // A seeded rng also differs call to call, and "depends on a random
      // number" is worth printing where "returns a different answer" is not.
      return {
        verifiable: false,
        obstruction:
          ambientReason(source, fileName, name, args) ??
          "returns a different answer for the same input",
      };
    }

    // 3. A different clock and a different seed. Anything that moves now is
    //    read from the ambient rather than from the arguments.
    const b = call(source, fileName, name, args, AMBIENT_B);
    const blockedB = outcomeObstruction(b);
    if (blockedB !== undefined) return { verifiable: false, obstruction: blockedB };
    if (!sameOutcome(a1, b)) {
      return {
        verifiable: false,
        obstruction:
          ambientReason(source, fileName, name, args) ??
          "depends on something other than its arguments",
      };
    }

    // 4. Does it rewrite what it was handed? A function that mutates its
    //    arguments has an output we would not be comparing.
    const mutated = mutatesArguments(source, fileName, name, args);
    if (mutated) {
      return { verifiable: false, obstruction: "modifies the value it was given" };
    }
  }

  return VERIFIABLE;
}

/**
 * Narrows "depends on the ambient" to the one that moved, by changing the
 * clock and the seed one at a time. "Depends on wall-clock time" is worth
 * printing; "depends on something" is not.
 *
 * Returns undefined when neither control explains it - the caller knows
 * better than this function what the fallback should say.
 */
function ambientReason(
  source: string,
  fileName: string,
  name: string,
  args: readonly unknown[],
): string | undefined {
  const base = call(source, fileName, name, args, AMBIENT_A);

  const clockOnly = call(source, fileName, name, args, {
    ...AMBIENT_A,
    epochMs: AMBIENT_B.epochMs,
  });
  if (!sameOutcome(base, clockOnly)) return "depends on wall-clock time";

  const seedOnly = call(source, fileName, name, args, {
    ...AMBIENT_A,
    rngSeed: AMBIENT_B.rngSeed,
  });
  if (!sameOutcome(base, seedOnly)) return "depends on a random number";

  return undefined;
}

/**
 * Two calls sharing one loaded module, so module-level state survives from
 * the first to the second and can be observed.
 */
function callTwiceInOneInstance(
  source: string,
  fileName: string,
  name: string,
  args: readonly unknown[],
): [CallOutcome, CallOutcome] {
  try {
    const sandbox = loadModule(source, fileName, AMBIENT_A);
    return [
      callFunction(sandbox, name, clone(args)),
      callFunction(sandbox, name, clone(args)),
    ];
  } catch {
    // Loading already failed in step 1, which reported why.
    const empty: CallOutcome = { kind: "returned", value: undefined };
    return [empty, empty];
  }
}

function call(
  source: string,
  fileName: string,
  name: string,
  args: readonly unknown[],
  controls: Controls,
): CallOutcome {
  try {
    const sandbox = loadModule(source, fileName, controls);
    return callFunction(sandbox, name, clone(args));
  } catch (error) {
    const obstruction =
      error instanceof Error && "obstruction" in error
        ? String((error as { obstruction: unknown }).obstruction)
        : String(error);
    return { kind: "threw", value: undefined, obstruction };
  }
}

function mutatesArguments(
  source: string,
  fileName: string,
  name: string,
  args: readonly unknown[],
): boolean {
  const before = clone(args);
  const handed = clone(args);
  try {
    const sandbox = loadModule(source, fileName, AMBIENT_A);
    callFunction(sandbox, name, handed);
  } catch {
    return false;
  }
  return !equals(before, handed).equal;
}

function sameOutcome(a: CallOutcome, b: CallOutcome): boolean {
  if (a.kind !== b.kind) return false;
  return equals(a.value, b.value).equal;
}

/** Arguments are copied before every call so one run cannot taint the next. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
