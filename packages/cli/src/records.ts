import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CONTROLS, type Controls, type VerifyResult } from "@qed/engine";
import {
  reDeriveDigest,
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
