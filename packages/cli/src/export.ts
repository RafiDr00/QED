import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  recordProblem,
  runsOf,
  serialiseBundle,
  BUNDLE_KIND,
  RUN_SUMMARY_KIND,
  SIGNED_RUN_KIND,
  type AttestationRecord,
  type QedBundle,
  type RunResult,
  type RunInvocation,
  type SignedRun,
} from "@qed/ui/model";

import { RecordLookupError } from "./records.js";

/**
 * Run summaries, and the audit bundle built from a records directory.
 *
 * The console used to show a typed-in release history, a made-up Rekor index
 * and an export of files that did not exist. It now shows a bundle this
 * writes from what `qed check` really left behind. DECISIONS.md D-062.
 */

/** The run summary `qed check` writes beside its records. */
export function runSummary(
  result: RunResult,
  records: readonly AttestationRecord[],
  context: { repository: string; commit: string; timestamp: string; engine: string },
): RunInvocation {
  return {
    kind: RUN_SUMMARY_KIND,
    command: result.command,
    duration: result.duration,
    ...context,
    entries: records.map((record, i) => {
      const via = result.runs[i]?.via;
      return { digest: record.digest, ...(via !== undefined ? { via } : {}) };
    }),
  };
}

/** `run-<16 hex of the digests>.json`, so the same run writes the same file. */
export function summaryFileName(summary: RunInvocation): string {
  const id = createHash("sha256")
    .update(summary.entries.map((e) => e.digest).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `run-${id}.json`;
}

export function writeRunSummary(dir: string, summary: RunInvocation): string {
  const path = join(dir, summaryFileName(summary));
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return path;
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/**
 * Everything in a records directory, as one bundle.
 *
 * `tagsOf` names the tags pointing at a commit; it is git's to answer, and
 * the caller asks it.
 */
export function buildBundle(dir: string, tagsOf: (commit: string) => string[]): QedBundle {
  if (!existsSync(dir)) throw new RecordLookupError(`There are no records in ${dir}.`);

  const records: AttestationRecord[] = [];
  const runs: RunInvocation[] = [];
  const signatures: SignedRun[] = [];

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const value = readJson(join(dir, name)) as { kind?: unknown } | undefined;
    if (value === undefined) continue;
    if (value.kind === RUN_SUMMARY_KIND) runs.push(value as RunInvocation);
    else if (value.kind === SIGNED_RUN_KIND) signatures.push(value as SignedRun);
    else if (recordProblem(value) === undefined) records.push(value as AttestationRecord);
  }
  if (records.length === 0) throw new RecordLookupError(`There are no records in ${dir}.`);

  const commits = [...new Set(records.map((r) => r.commit))];
  const tags: Record<string, string[]> = {};
  for (const commit of commits) {
    // A run over uncommitted edits names no commit a tag could point at.
    if (commit.endsWith("+uncommitted")) continue;
    const found = tagsOf(commit);
    if (found.length > 0) tags[commit] = found;
  }

  const repository = [...new Set(records.map((r) => r.repository))].sort().join(", ");
  const bundle: QedBundle = {
    kind: BUNDLE_KIND,
    repository,
    runs: runs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    records: records.sort((a, b) =>
      a.timestamp === b.timestamp
        ? `${a.path}:${a.symbol}`.localeCompare(`${b.path}:${b.symbol}`)
        : a.timestamp < b.timestamp
          ? 1
          : -1,
    ),
    signatures,
    tags,
  };
  return bundle;
}

export interface Exported {
  readonly path: string;
  readonly digest: string;
  readonly records: number;
  readonly runs: number;
  readonly signed: number;
}

export function writeBundle(path: string, bundle: QedBundle): Exported {
  const text = serialiseBundle(bundle);
  writeFileSync(path, text, "utf8");
  return {
    path,
    digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    records: bundle.records.length,
    runs: runsOf(bundle).length,
    signed: bundle.records.filter((r) => r.signer !== "unsigned").length,
  };
}
