#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
  repositoryName,
  repositoryRoot,
  resolveRef,
  workingCommit,
  GitError,
} from "./git.js";
import {
  buildRecord,
  formatUtc,
  writeRecords,
  DEFAULT_RECORDS_DIR,
} from "./records.js";
import { ENGINE } from "./version.js";

/**
 * `qed check`, `qed repro` and `qed verify`.
 *
 * The output is produced by @qed/cli-render, which walks the same line model
 * the terminal pane on the website walks - so what a reader sees here and what
 * they see in a screenshot cannot drift apart.
 */

const USAGE = `qed - deterministic verification

  qed check [--base <ref>] [--inputs <n>] [--tolerance float=<e>,rel=<e>]
            [--records <dir>] [--no-color]
      Verify every exported function that changed against <ref>, and write
      one record per function to <dir> (default .qed/records). A tolerance
      loosens a comparison only where one needs it, and every one applied
      is written into the record.
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

async function check(flags: Flags): Promise<number> {
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

  const startedAt = new Date();
  const started = startedAt.getTime();
  const pairs = gather(ref, cwd);
  if (pairs.length === 0) {
    process.stdout.write(
      `No verifiable file changed against ${ref}.\n`,
    );
    return 0;
  }

  const root = repositoryRoot(cwd);
  const run = runPair(pairs, {
    inputs,
    ...(tolerance ? { tolerance } : {}),
    command: echoed(ref, flags),
    // A relative import is pinned to the same revision as the module that
    // imports it, so a helper does not force the function to abstain.
    readBase: (path) => fileAt(ref, path, root),
    readHead: (path) => {
      const absolute = join(root, path);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    },
  });

  // Measured after the run: the options object above is built before any
  // function is verified, so timing it there printed the cost of reading the
  // diff as the cost of the run.
  const result = {
    ...run.result,
    duration: formatDuration(Date.now() - started),
  };

  const context = {
    repository: repositoryName(root),
    commit: workingCommit(root),
    timestamp: formatUtc(startedAt),
    engine: ENGINE,
  };
  const records = await Promise.all(
    result.runs.map((r) =>
      buildRecord(r, run.details.get(`${r.path}:${r.symbol}`), context),
    ),
  );
  const flagged = flags.named.get("records");
  const dir = flagged !== undefined ? resolve(cwd, flagged) : join(root, DEFAULT_RECORDS_DIR);
  writeRecords(dir, records);

  process.stdout.write(renderRun(result, { color }));

  // On stderr, so stdout stays exactly the output the design system specifies.
  // The digests are printed where the run's log keeps them, because a record
  // can only be checked against a digest held somewhere it is not.
  process.stderr.write(
    `${records.length} ${records.length === 1 ? "record" : "records"} written to ${relative(cwd, dir) || "."}
` +
      records.map((r) => `  ${r.digest}  ${r.path}  ${r.symbol}
`).join(""),
  );
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

async function main(): Promise<number> {
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
        return await check(flags);
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

// Exit 1 means "something diverged", and CI acts on it. A crash is not a
// divergence, so it must not borrow that code: it reports as a run that
// could not complete.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `qed could not complete the run: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}
`,
    );
    process.exitCode = 2;
  },
);
