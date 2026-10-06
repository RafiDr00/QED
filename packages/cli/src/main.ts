#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderRun, exitCodeFor } from "@qed/cli-render";
import {
  runPair,
  show,
  loadModule,
  callFunction,
  type ModulePair,
} from "@qed/engine";

import { changedFiles, fileAt, repositoryRoot, GitError } from "./git.js";

/**
 * `qed check` and `qed repro`.
 *
 * The output is produced by @qed/cli-render, which walks the same line model
 * the terminal pane on the website walks - so what a reader sees here and what
 * they see in a screenshot cannot drift apart.
 */

const USAGE = `qed - deterministic verification

  qed check [--base <ref>] [--inputs <n>] [--no-color]
      Verify every exported function that changed against <ref>.
      Exits non-zero only when something diverged.

  qed repro <file> <symbol> --input '<json-array>' [--base <ref>]
      Run one input through both versions and print what each returned.

  qed --help
`;

interface Flags {
  readonly positional: readonly string[];
  readonly named: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

function parse(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const named = new Map<string, string>();
  const switches = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      named.set(key, next);
      i++;
    } else {
      switches.add(key);
    }
  }
  return { positional, named, switches };
}

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
  const ref = flags.named.get("base") ?? "origin/main";
  const inputs = Number(flags.named.get("inputs") ?? 1000);
  // Colour only on a terminal: piping into a file or a ticket should give
  // plain text, which the design system says the output has to survive.
  const color =
    !flags.switches.has("no-color") && process.stdout.isTTY;
  const cwd = process.cwd();

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
    command: `qed check --base ${ref}`,
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function repro(flags: Flags): number {
  const [path, symbol] = flags.positional;
  const raw = flags.named.get("input");
  if (path === undefined || symbol === undefined || raw === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }

  const ref = flags.named.get("base") ?? "origin/main";
  const root = repositoryRoot(process.cwd());
  const base = fileAt(ref, path, root);
  const absolute = join(root, path);

  if (base === undefined || !existsSync(absolute)) {
    process.stderr.write(`${path} does not exist on both sides of ${ref}.\n`);
    return 2;
  }

  let args: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    args = parsed;
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
  const flags = parse(argv);
  const command = flags.positional[0];

  if (flags.switches.has("help") || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }

  try {
    if (command === "check") return check(flags);
    if (command === "repro") {
      return repro({ ...flags, positional: flags.positional.slice(1) });
    }
  } catch (error) {
    if (error instanceof GitError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
  return 2;
}

process.exitCode = main();
