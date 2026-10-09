#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderRun, exitCodeFor } from "@qed/cli-render";
import {
  decodeArgs,
  runPair,
  show,
  loadModule,
  callFunction,
  type ModulePair,
} from "@qed/engine";

import {
  COMMANDS,
  isCommand,
  parseFlags,
  parseInputs,
  parseTolerance,
  UsageError,
  type Flags,
} from "./args.js";
import {
  changedFiles,
  fileAt,
  repositoryRoot,
  resolveRef,
  GitError,
} from "./git.js";

/**
 * `qed check` and `qed repro`.
 *
 * The output is produced by @qed/cli-render, which walks the same line model
 * the terminal pane on the website walks - so what a reader sees here and what
 * they see in a screenshot cannot drift apart.
 */

const USAGE = `qed - deterministic verification

  qed check [--base <ref>] [--inputs <n>] [--tolerance float=<e>,rel=<e>]
            [--no-color]
      Verify every exported function that changed against <ref>.
      A tolerance loosens a comparison only where one needs it.
      Exits 1 only when something diverged; 2 when the run could not start.

  qed repro <file> <symbol> --input '<json-array>' [--base <ref>]
      Run one input through both versions and print what each returned.

  qed --help
`;

/** Only files the engine can read at all. */
const VERIFIABLE_EXTENSION = /\.(ts|js|mts|mjs)$/;
const IGNORED = /(\.d\.ts|\.test\.|\.spec\.|node_modules|\/dist\/)/;

function gather(ref: string, cwd: string): ModulePair[] {
  const root = repositoryRoot(cwd);
  const pairs: ModulePair[] = [];

  for (const path of changedFiles(ref, root)) {
    if (!VERIFIABLE_EXTENSION.test(path) || IGNORED.test(path)) continue;

    const base = fileAt(ref, path, root);
    if (base === undefined) continue; // Added on this branch: nothing to compare.

    const absolute = join(root, path);
    if (!existsSync(absolute)) continue; // Deleted: likewise.

    pairs.push({ path, base, head: readFileSync(absolute, "utf8") });
  }
  return pairs;
}

function check(flags: Flags): number {
  if (flags.positional.length > 0) {
    throw new UsageError(`qed check takes no file or symbol: '${flags.positional[0]}'.`);
  }
  const ref = flags.named.get("base") ?? "origin/main";
  const inputs = parseInputs(flags.named.get("inputs"), 1000);
  const tolerance = parseTolerance(flags.named.get("tolerance"));
  // Colour only on a terminal: piping into a file or a ticket should give
  // plain text, which the design system says the output has to survive.
  const color =
    !flags.switches.has("no-color") && process.stdout.isTTY;
  const cwd = process.cwd();
  resolveRef(ref, repositoryRoot(cwd));

  const started = Date.now();
  const pairs = gather(ref, cwd);
  if (pairs.length === 0) {
    process.stdout.write(
      `No verifiable file changed against ${ref}.\n`,
    );
    return 0;
  }

  const root = repositoryRoot(cwd);
  const { result } = runPair(pairs, {
    inputs,
    ...(tolerance ? { tolerance } : {}),
    command: echoed(ref, flags),
    duration: formatDuration(Date.now() - started),
    // A relative import is pinned to the same revision as the module that
    // imports it, so a helper does not force the function to abstain.
    readBase: (path) => fileAt(ref, path, root),
    readHead: (path) => {
      const absolute = join(root, path);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    },
  });

  process.stdout.write(renderRun(result, { color }));
  return exitCodeFor(result);
}

/**
 * The command as the output echoes it: every flag that changes the result.
 * A run made under a tolerance that printed as a plain `qed check` would hide
 * the one thing that weakened it.
 */
function echoed(ref: string, flags: Flags): string {
  const parts = ["qed check", `--base ${ref}`];
  for (const key of ["inputs", "tolerance"] as const) {
    const value = flags.named.get(key);
    if (value !== undefined) parts.push(`--${key} ${value}`);
  }
  return parts.join(" ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function repro(flags: Flags): number {
  const [path, symbol, extra] = flags.positional;
  const raw = flags.named.get("input");
  if (path === undefined || symbol === undefined || raw === undefined) {
    throw new UsageError("qed repro needs a file, a symbol and --input.");
  }
  if (extra !== undefined) {
    throw new UsageError(`qed repro takes one file and one symbol, not '${extra}'.`);
  }

  const ref = flags.named.get("base") ?? "origin/main";
  const root = repositoryRoot(process.cwd());
  resolveRef(ref, root);
  const base = fileAt(ref, path, root);
  const absolute = join(root, path);

  if (base === undefined || !existsSync(absolute)) {
    process.stderr.write(`${path} does not exist on both sides of ${ref}.\n`);
    return 2;
  }

  let args: unknown[];
  try {
    // The same encoding `qed check` printed, so NaN, -0, Infinity, BigInt,
    // Dates, Maps and Sets come back as themselves rather than as null.
    args = decodeArgs(raw);
  } catch {
    process.stderr.write(`--input must be a JSON array of arguments.\n`);
    return 2;
  }

  const head = readFileSync(absolute, "utf8");
  for (const [label, source] of [
    ["base", base],
    ["head", head],
  ] as const) {
    const outcome = callFunction(
      loadModule(source, path),
      symbol,
      structuredClone(args),
    );
    const printed =
      outcome.obstruction !== undefined
        ? outcome.obstruction
        : outcome.kind === "threw"
          ? `threw ${show(outcome.value)}`
          : show(outcome.value);
    process.stdout.write(`${label.padEnd(6)}${printed}\n`);
  }
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }

  try {
    if (!isCommand(command)) {
      throw new UsageError(`Unknown command '${command}'.`);
    }
    const flags = parseFlags(rest, COMMANDS[command], command);
    switch (command) {
      case "check":
        return check(flags);
      case "repro":
        return repro(flags);
      case "verify":
        throw new UsageError("qed verify is not available yet.");
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}

${USAGE}`);
      return 2;
    }
    if (error instanceof GitError) {
      process.stderr.write(`${error.message}
`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = main();
