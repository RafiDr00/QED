#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { renderRun, exitCodeFor } from "@qed/cli-render";
import { verifyRecord, type AttestationRecord } from "@qed/ui/model";
import {
  decodeArgs,
  relativeResolver,
  runPair,
  show,
  loadModule,
  callFunction,
  DEFAULT_CONTROLS,
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
  findRecord,
  formatUtc,
  loadRecord,
  matchesDigest,
  parseDigestQuery,
  writeRecords,
  DEFAULT_RECORDS_DIR,
  RecordLookupError,
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

  qed verify --digest <sha256> [--records <dir>]
  qed verify <record.json> [--digest <sha256>]
      Re-derive a record's digest from its own fields and compare it with the
      digest you hold. The digest may be abbreviated: 9f2a1c84bd0e...7c31.
      Exits 1 when the record has been altered.

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
    ...readers(ref, root),
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
    `${records.length} ${records.length === 1 ? "record" : "records"} written to ${shown(cwd, dir)}
` +
      records.map((r) => `  ${r.digest}  ${r.path}  ${r.symbol}
`).join(""),
  );
  return exitCodeFor(result);
}

/**
 * A directory as a reader should see it: relative to where they are when it
 * is beneath them, absolute otherwise.
 *
 * git reports the repository root by its real path. The working directory
 * can be the same place by another name - a Windows 8.3 short name, macOS's
 * /var for /private/var - and relative() between the two climbed out to the
 * drive root and back.
 */
function shown(cwd: string, dir: string): string {
  let here = cwd;
  try {
    here = realpathSync.native(cwd);
  } catch {
    // Keep the name we were given.
  }
  const path = relative(here, dir);
  if (path === "") return ".";
  return path.startsWith("..") || isAbsolute(path) ? dir : path;
}

/**
 * Each side's view of the repository.
 *
 * A relative import is pinned to the same revision as the module that imports
 * it, so a helper does not force the function to abstain. `check` and `repro`
 * share this, because a repro that loaded its module differently from the
 * check that printed it would not reproduce anything.
 */
function readers(ref: string, root: string) {
  return {
    readBase: (path: string) => fileAt(ref, path, root),
    readHead: (path: string) => {
      const absolute = join(root, path);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
    },
  };
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
  const { readBase, readHead } = readers(ref, root);
  for (const [label, source, read] of [
    ["base", base, readBase],
    ["head", head, readHead],
  ] as const) {
    const outcome = callFunction(
      loadModule(source, path, DEFAULT_CONTROLS, relativeResolver(read)),
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

/**
 * `qed verify`: the console's Verify button, on the command line.
 *
 * "Recomputing the digest proves the record has not been altered since it was
 * written." Only against a digest held somewhere the record is not - anyone
 * can rewrite a record and recompute a digest that matches it. So a digest
 * given on the command line has to be the one the record carries, and a file
 * checked without one is reported as checked against itself, and no more.
 */
async function verifyCommand(flags: Flags): Promise<number> {
  const [file, extra] = flags.positional;
  const raw = flags.named.get("digest");
  if (extra !== undefined) {
    throw new UsageError(`qed verify takes one record, not '${extra}'.`);
  }
  if (file === undefined && raw === undefined) {
    throw new UsageError("qed verify needs --digest, a record file, or both.");
  }
  const query = raw !== undefined ? parseDigestQuery(raw) : undefined;
  const cwd = process.cwd();

  let record: AttestationRecord;
  if (file !== undefined) {
    if (!existsSync(resolve(cwd, file))) {
      throw new RecordLookupError(`${file} does not exist.`);
    }
    record = loadRecord(resolve(cwd, file));
  } else if (query !== undefined) {
    const flagged = flags.named.get("records");
    let dir: string;
    if (flagged !== undefined) {
      dir = resolve(cwd, flagged);
    } else {
      // Records live at the repository root; outside one, look here.
      try {
        dir = join(repositoryRoot(cwd), DEFAULT_RECORDS_DIR);
      } catch {
        dir = join(cwd, DEFAULT_RECORDS_DIR);
      }
    }
    record = findRecord(dir, query).record;
  } else {
    throw new UsageError("qed verify needs --digest, a record file, or both.");
  }

  const out = (line: string) => process.stdout.write(`${line}
`);
  const subject = `  ${record.path}  ${record.symbol}  ${record.verdict.state}`;

  if (query !== undefined && !matchesDigest(record.digest, query)) {
    out(`mismatch  ${record.digest}`);
    out(subject);
    out(`  The record carries a different digest from the one you hold (${raw}).`);
    out("  Do not rely on it.");
    return 1;
  }

  const state = await verifyRecord(record, new Date());
  switch (state.status) {
    case "verified":
      out(`verified  ${record.digest}`);
      out(subject);
      out(`  Re-derived from the record's own fields at ${state.checkedAt}.`);
      if (query === undefined) {
        out("  Checked against the digest the file carries, which proves only that");
        out("  it is consistent with itself. Pass --digest with the one from the");
        out("  run's log to check it against a copy the file cannot rewrite.");
      } else if (!query.complete) {
        out("  Matched on an abbreviated digest; the full one above is what was checked.");
      }
      out(`  Not checked: who signed it (${record.signer}) and Rekor inclusion`);
      out(`  (${record.rekorIndex}). Both need a network this check does not use.`);
      return 0;
    case "mismatch":
      out(`mismatch  ${record.digest}`);
      out(subject);
      out(`  ${state.detail}`);
      return 1;
    case "error":
    case "idle":
    case "checking":
      process.stderr.write(
        `${"detail" in state ? state.detail : "The check did not run."}
`,
      );
      return 2;
  }
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
        return await verifyCommand(flags);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}

${USAGE}`);
      return 2;
    }
    if (error instanceof RecordLookupError) {
      process.stderr.write(`${error.message}
`);
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
