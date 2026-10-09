import type { Tolerance } from "@qed/engine";

/**
 * Reading the command line, strictly.
 *
 * "2 - the run could not start: a bad flag, a missing base ref, or a
 * repository it cannot read." A flag the command does not know used to be
 * dropped on the floor, so `--tolerence float=1e-9` ran an exact comparison
 * and said nothing - the reader believed one thing and got another. Every
 * flag is now declared per command, and anything else stops the run.
 */

/** The run could not start because of how it was asked. Exit 2. */
export class UsageError extends Error {
  override readonly name = "UsageError";
}

export interface CommandSpec {
  /** Flags that take a value: `--base origin/main` or `--base=origin/main`. */
  readonly named: readonly string[];
  /** Flags that stand alone. */
  readonly switches: readonly string[];
}

export const COMMANDS = {
  check: {
    named: ["base", "inputs", "tolerance", "records"],
    switches: ["no-color"],
  },
  repro: { named: ["base", "input"], switches: [] },
  verify: { named: ["digest", "records"], switches: [] },
} as const satisfies Record<string, CommandSpec>;

export type Command = keyof typeof COMMANDS;

export function isCommand(word: string): word is Command {
  return Object.hasOwn(COMMANDS, word);
}

export interface Flags {
  readonly positional: readonly string[];
  readonly named: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

/**
 * Parses the arguments after the command word against what that command
 * accepts.
 *
 * A declared value flag always takes the next token, even one starting with a
 * dash, so `--input '[-1]'` and `--base -` mean what they say.
 */
export function parseFlags(
  argv: readonly string[],
  spec: CommandSpec,
  command: string,
): Flags {
  const positional: string[] = [];
  const named = new Map<string, string>();
  const switches = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (spec.switches.includes(key)) {
      if (inline !== undefined) {
        throw new UsageError(`--${key} takes no value.`);
      }
      switches.add(key);
      continue;
    }

    if (!spec.named.includes(key)) {
      throw new UsageError(`qed ${command} has no flag --${key}.`);
    }
    if (named.has(key)) {
      throw new UsageError(`--${key} is given twice.`);
    }

    const value = inline ?? argv[++i];
    if (value === undefined || value === "") {
      throw new UsageError(`--${key} needs a value.`);
    }
    named.set(key, value);
  }

  return { positional, named, switches };
}

/** `--inputs`: how many generated inputs per function. */
export function parseInputs(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new UsageError(`--inputs must be a whole number above zero, not '${raw}'.`);
  }
  return n;
}

const TOLERANCE_KEYS = {
  /** Absolute difference between two finite numbers. */
  float: "floatEpsilon",
  /** Difference as a fraction of the larger magnitude. */
  rel: "relativeEpsilon",
} as const;

/**
 * `--tolerance float=1e-9`, `--tolerance rel=1e-12`, or both, comma-separated.
 *
 * Only a finite epsilon above zero is accepted. Zero is what no flag already
 * means, and a negative or infinite one is not a tolerance anyone intended.
 */
export function parseTolerance(raw: string | undefined): Tolerance | undefined {
  if (raw === undefined) return undefined;

  const seen = new Map<string, number>();
  for (const part of raw.split(",")) {
    const [key, value, ...rest] = part.trim().split("=");
    if (
      key === undefined ||
      value === undefined ||
      rest.length > 0 ||
      !Object.hasOwn(TOLERANCE_KEYS, key)
    ) {
      throw new UsageError(
        `--tolerance takes float=<epsilon> or rel=<epsilon>, not '${part.trim()}'.`,
      );
    }
    const epsilon = value.trim() === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new UsageError(
        `--tolerance ${key} must be a finite number above zero, not '${value}'.`,
      );
    }
    if (seen.has(key)) {
      throw new UsageError(`--tolerance gives ${key} twice.`);
    }
    seen.set(key, epsilon);
  }

  const relative = seen.get("rel");
  return {
    floatEpsilon: seen.get("float") ?? 0,
    ...(relative !== undefined ? { relativeEpsilon: relative } : {}),
  };
}
