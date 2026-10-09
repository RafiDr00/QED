import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONTROLS, type Controls, type VerifyResult } from "@qed/engine";
import {
  reDeriveDigest,
  VERDICT_STATES,
  type AttestationRecord,
  type FunctionRun,
} from "@qed/ui/model";

/**
 * The record `qed check` leaves behind for every function it looked at.
 *
 * "Each verified function produces a record: the verdict, the inputs, the
 * controls, the tolerances and the engine version, under a digest computed
 * from exactly those fields." The digest is the one the console's Verify
 * button re-derives - `reDeriveDigest` from @qed/ui/model - so a record
 * written here and a record checked there cannot disagree about what was
 * signed.
 *
 * Built here rather than in the engine because a record needs a clock and a
 * repository, and the engine deliberately reads neither.
 */

/** Where records go unless --records says otherwise, from the repo root. */
export const DEFAULT_RECORDS_DIR = ".qed/records";

/**
 * Signing against a CI provider's OIDC identity and logging to Rekor are not
 * built. The record says so in the fields that would carry them, rather than
 * leaving them blank for a reader to fill in.
 */
export const UNSIGNED = "unsigned";
export const NOT_LOGGED = "not logged";

const DEFAULT_STRATEGY = "type-directed, corpus-seeded";

/** What every record from one run shares. */
export interface RecordContext {
  readonly repository: string;
  readonly commit: string;
  /** Already formatted, UTC: "2026-10-04 09:41 UTC". */
  readonly timestamp: string;
  readonly engine: string;
}

/** "2026-10-04 09:41 UTC", the format records and the console use. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The controls the sandbox actually imposed, by name.
 *
 * Each is a fact about `packages/engine/src/sandbox.ts`, not a description of
 * what a sandbox ought to do: the clock reads one instant, `Math.random` is
 * seeded, `fetch` and its relatives throw, timers throw, and a relative import
 * is loaded from the same revision as its importer while any other import is
 * refused.
 */
export function describeControls(controls: Controls): string[] {
  return [
    `clock frozen at ${formatUtc(new Date(controls.epochMs))}`,
    `rng seed 0x${controls.rngSeed.toString(16)}`,
    "network denied",
    "timers denied",
    "relative imports pinned, others refused",
  ];
}

/**
 * One function's record.
 *
 * `detail` is absent only for a function the head no longer exports, which
 * was never run: it gets the default controls and no tolerances, because none
 * were applied.
 */
export async function buildRecord(
  run: FunctionRun,
  detail: VerifyResult | undefined,
  context: RecordContext,
): Promise<AttestationRecord> {
  const unsigned: AttestationRecord = {
    symbol: run.symbol,
    path: run.path,
    repository: context.repository,
    commit: context.commit,
    timestamp: context.timestamp,
    verdict: run.verdict,
    inputStrategy:
      run.verdict.state === "EQUIVALENT" && run.verdict.strategy !== undefined
        ? run.verdict.strategy
        : DEFAULT_STRATEGY,
    controls: describeControls(detail?.controls ?? DEFAULT_CONTROLS),
    tolerances: [...(detail?.tolerancesApplied ?? [])],
    engine: context.engine,
    signer: UNSIGNED,
    rekorIndex: NOT_LOGGED,
    digest: "",
  };
  return { ...unsigned, digest: await reDeriveDigest(unsigned) };
}

/** `sha256:<hex>` to `<hex>`. */
export function hexOf(digest: string): string {
  return digest.replace(/^sha256:/, "");
}

/**
 * Writes each record as `<dir>/<hex>.json` and returns the paths.
 *
 * Named by digest, so writing the same record twice is the same file, and two
 * runs never overwrite each other's evidence.
 */
export function writeRecords(
  dir: string,
  records: readonly AttestationRecord[],
): string[] {
  mkdirSync(dir, { recursive: true });
  return records.map((record) => {
    const path = join(dir, `${hexOf(record.digest)}.json`);
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return path;
  });
}

/** A record that cannot be found, or is not a record. Exit 2. */
export class RecordLookupError extends Error {
  override readonly name = "RecordLookupError";
}

/** The part of a digest someone is holding: all of it, or its two ends. */
export interface DigestQuery {
  readonly prefix: string;
  readonly suffix: string;
  /** True when the whole digest was given, not an abbreviation of it. */
  readonly complete: boolean;
}

/**
 * The fewest hex characters a held digest may be abbreviated to: 64 bits.
 *
 * Anyone can rewrite a record and recompute its digest, so an abbreviation is
 * only as strong as the work it takes to forge a rewrite that matches it. A
 * one-character prefix takes sixteen tries. Sixteen characters - exactly the
 * `9f2a1c84bd0e...7c31` form the docs print - takes about 2^64.
 */
export const MIN_DIGEST_CHARS = 16;

/**
 * Reads `sha256:<hex>`, a hex prefix, or the elided `9f2a1c84bd0e...7c31`
 * form a digest is printed in when it is too long for the line.
 */
export function parseDigestQuery(raw: string): DigestQuery {
  const body = raw.trim().toLowerCase().replace(/^sha256:/, "");
  const [prefix = "", suffix = "", ...rest] = body.split(/\.{3}|…/);
  if (
    rest.length > 0 ||
    !/^[0-9a-f]*$/.test(prefix) ||
    !/^[0-9a-f]*$/.test(suffix) ||
    prefix.length + suffix.length > 64
  ) {
    throw new RecordLookupError(
      `'${raw}' is not a sha256 digest, a prefix of one, or one elided with '...'.`,
    );
  }
  if (prefix.length + suffix.length < MIN_DIGEST_CHARS) {
    throw new RecordLookupError(
      `'${raw}' is too short to check against: give at least ${MIN_DIGEST_CHARS} hex characters of the digest.`,
    );
  }
  return { prefix, suffix, complete: prefix.length === 64 };
}

export function matchesDigest(digest: string, query: DigestQuery): boolean {
  const hex = hexOf(digest);
  return (
    hex.length >= query.prefix.length + query.suffix.length &&
    hex.startsWith(query.prefix) &&
    hex.endsWith(query.suffix)
  );
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isString);

/** Why `value` is not a record, or undefined when it is one. */
function malformed(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "it is not an object";
  const r = value as Record<string, unknown>;
  for (const key of [
    "symbol",
    "path",
    "repository",
    "commit",
    "timestamp",
    "inputStrategy",
    "engine",
    "signer",
    "rekorIndex",
    "digest",
  ]) {
    if (!isString(r[key])) return `'${key}' is missing or not text`;
  }
  if (!isStrings(r.controls)) return "'controls' is not a list of text";
  if (!isStrings(r.tolerances)) return "'tolerances' is not a list of text";

  const v = r.verdict as Record<string, unknown> | null | undefined;
  if (typeof v !== "object" || v === null) return "'verdict' is missing";
  if (!(VERDICT_STATES as readonly unknown[]).includes(v.state)) {
    return `'verdict.state' is not one of ${VERDICT_STATES.join(", ")}`;
  }
  if (v.state === "EQUIVALENT" && typeof v.inputs !== "number") {
    return "an EQUIVALENT verdict has no input count";
  }
  if (v.state === "ABSTAINED" && !isString(v.obstruction)) {
    return "an ABSTAINED verdict has no obstruction";
  }
  if (v.state === "DIVERGED") {
    const c = v.counterexample as Record<string, unknown> | null | undefined;
    if (typeof c !== "object" || c === null) {
      return "a DIVERGED verdict has no counterexample";
    }
    for (const key of ["input", "base", "head", "repro"]) {
      if (!isString(c[key])) return `'verdict.counterexample.${key}' is missing`;
    }
  }
  return undefined;
}

/** Reads one record file, refusing anything that is not a whole record. */
export function loadRecord(path: string): AttestationRecord {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new RecordLookupError(
      `${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const reason = malformed(value);
  if (reason !== undefined) {
    throw new RecordLookupError(`${path} is not a QED record: ${reason}.`);
  }
  return value as AttestationRecord;
}

/**
 * The one record in `dir` whose digest matches.
 *
 * Matched on the digest the record carries, not on its file name. A file name
 * is only an index: a record rewritten with a fresh, self-consistent digest
 * keeps its old name, and matching on the name would hand it over as the
 * record the reader asked for.
 */
export function findRecord(
  dir: string,
  query: DigestQuery,
): { readonly path: string; readonly record: AttestationRecord } {
  if (!existsSync(dir)) {
    throw new RecordLookupError(`There are no records in ${dir}.`);
  }

  const found: { path: string; record: AttestationRecord }[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let record: AttestationRecord;
    try {
      record = loadRecord(path);
    } catch {
      continue; // Not a record, so not a candidate.
    }
    if (matchesDigest(record.digest, query)) found.push({ path, record });
  }

  const [only, ...others] = found;
  if (only === undefined) {
    throw new RecordLookupError(`No record in ${dir} carries that digest.`);
  }
  if (others.length > 0) {
    throw new RecordLookupError(
      `${found.length} records match; give more of the digest:\n` +
        found
          .map((f) => `  ${f.record.digest}  ${f.record.path}  ${f.record.symbol}`)
          .join("\n"),
    );
  }
  return only;
}
