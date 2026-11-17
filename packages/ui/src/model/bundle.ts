/**
 * The audit bundle: everything a set of runs produced, in one file a reader
 * can carry anywhere and open without us.
 *
 * `qed export` writes it from `.qed/records`; the console reads it with no
 * network. Every number the console shows is computed here from the records
 * themselves. A run summary contributes only what records cannot carry - the
 * command echoed and how long it took - so editing a summary cannot change a
 * count. DECISIONS.md D-062.
 *
 * React-free, because the CLI writes what the console reads.
 */
import {
  RUN_MANIFEST_KIND,
  manifestSubjects,
  signingSubject,
  type AttestationRecord,
} from "./attestation.js";
import { VERDICT_STATES, type FunctionRun, type RunResult } from "./verdict.js";

export const BUNDLE_KIND = "qed.bundle/v1";
export const RUN_SUMMARY_KIND = "qed.run-summary/v1";
export const SIGNED_RUN_KIND = "qed.signed-run/v1";

/** What an unsigned record carries where a signature's facts would go. */
export const UNSIGNED = "unsigned";
export const NOT_LOGGED = "not logged";

/** One `qed check`, as it was invoked. Written beside the records. */
export interface RunInvocation {
  readonly kind: typeof RUN_SUMMARY_KIND;
  /** The command as the output echoed it. */
  readonly command: string;
  /** Already formatted: "1.2s". */
  readonly duration: string;
  readonly repository: string;
  readonly commit: string;
  readonly timestamp: string;
  readonly engine: string;
  /** The run's records, in the order the run printed them. */
  readonly entries: readonly { readonly digest: string; readonly via?: string }[];
}

/** A Sigstore-signed run manifest, as `qed check --sign` writes it. */
export interface SignedRun {
  readonly kind: typeof SIGNED_RUN_KIND;
  /** The manifest, exactly as signed. */
  readonly payload: string;
  /** The Sigstore bundle. Checked by `qed verify`; a browser cannot. */
  readonly bundle: unknown;
}

export interface QedBundle {
  readonly kind: typeof BUNDLE_KIND;
  readonly repository: string;
  readonly runs: readonly RunInvocation[];
  readonly records: readonly AttestationRecord[];
  readonly signatures: readonly SignedRun[];
  /** Tags pointing at each commit the records name, when exported from the repository. */
  readonly tags: Readonly<Record<string, readonly string[]>>;
}

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

const isString = (v: unknown): v is string => typeof v === "string";
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

/** Why `value` is not a record, or undefined when it is one. */
export function recordProblem(value: unknown): string | undefined {
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
  if (!isStrings(r["controls"])) return "'controls' is not a list of text";
  if (!isStrings(r["tolerances"])) return "'tolerances' is not a list of text";

  const v = r["verdict"] as Record<string, unknown> | null | undefined;
  if (typeof v !== "object" || v === null) return "'verdict' is missing";
  if (!(VERDICT_STATES as readonly unknown[]).includes(v["state"])) {
    return `'verdict.state' is not one of ${VERDICT_STATES.join(", ")}`;
  }
  if (v["state"] === "EQUIVALENT" && typeof v["inputs"] !== "number") {
    return "an EQUIVALENT verdict has no input count";
  }
  if (v["state"] === "EQUIVALENT" && v["threw"] !== undefined && typeof v["threw"] !== "number") {
    return "an EQUIVALENT verdict's throw count is not a number";
  }
  if (v["state"] === "ABSTAINED" && !isString(v["obstruction"])) {
    return "an ABSTAINED verdict has no obstruction";
  }
  if (v["state"] === "DIVERGED") {
    const c = v["counterexample"] as Record<string, unknown> | null | undefined;
    if (typeof c !== "object" || c === null) return "a DIVERGED verdict has no counterexample";
    for (const key of ["input", "base", "head", "repro"]) {
      if (!isString(c[key])) return `'verdict.counterexample.${key}' is missing`;
    }
  }
  return undefined;
}

function summaryProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "it is not an object";
  const s = value as Record<string, unknown>;
  if (s["kind"] !== RUN_SUMMARY_KIND) return `its kind is not ${RUN_SUMMARY_KIND}`;
  for (const key of ["command", "duration", "repository", "commit", "timestamp", "engine"]) {
    if (!isString(s[key])) return `'${key}' is missing or not text`;
  }
  const entries = s["entries"];
  if (!Array.isArray(entries)) return "'entries' is not a list";
  for (const entry of entries as unknown[]) {
    const e = entry as Record<string, unknown> | null;
    if (typeof e !== "object" || e === null || !isString(e["digest"])) {
      return "an entry has no digest";
    }
    if (e["via"] !== undefined && !isString(e["via"])) return "an entry's 'via' is not text";
  }
  return undefined;
}

function signedRunProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "it is not an object";
  const s = value as Record<string, unknown>;
  if (s["kind"] !== SIGNED_RUN_KIND) return `its kind is not ${SIGNED_RUN_KIND}`;
  if (!isString(s["payload"])) return "it has no signed payload";
  if (typeof s["bundle"] !== "object" || s["bundle"] === null) return "it has no Sigstore bundle";
  return undefined;
}

export type ParsedBundle =
  | { readonly ok: true; readonly bundle: QedBundle }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads a bundle a reader handed over, refusing anything that is not one.
 * It is checked part by part, so the reason names the part.
 */
export function parseBundle(text: string): ParsedBundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: "It is not JSON." };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, problem: "It is not a QED bundle." };
  }
  const b = value as Record<string, unknown>;
  if (b["kind"] !== BUNDLE_KIND) {
    return { ok: false, problem: `It is not a QED bundle: its kind is not ${BUNDLE_KIND}.` };
  }
  if (!isString(b["repository"])) return { ok: false, problem: "It names no repository." };

  const parts: [string, unknown, (v: unknown) => string | undefined][] = [
    ["record", b["records"], recordProblem],
    ["run summary", b["runs"], summaryProblem],
    ["signed run", b["signatures"], signedRunProblem],
  ];
  for (const [name, list, problemOf] of parts) {
    if (!Array.isArray(list)) return { ok: false, problem: `Its ${name}s are not a list.` };
    for (const [i, item] of (list as unknown[]).entries()) {
      const problem = problemOf(item);
      if (problem !== undefined) {
        return { ok: false, problem: `${capitalised(name)} ${i + 1} is malformed: ${problem}.` };
      }
    }
  }
  const tags = b["tags"];
  if (typeof tags !== "object" || tags === null || !Object.values(tags).every(isStrings)) {
    return { ok: false, problem: "Its tags are not a map of commit to tag names." };
  }
  if ((b["records"] as unknown[]).length === 0) {
    return { ok: false, problem: "It holds no records." };
  }
  return { ok: true, bundle: value as QedBundle };
}

const capitalised = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/* ------------------------------------------------------------------------ */
/* Runs                                                                     */
/* ------------------------------------------------------------------------ */

/** One run, as the console shows it. */
export interface BundleRun {
  readonly key: string;
  readonly repository: string;
  readonly commit: string;
  readonly timestamp: string;
  readonly engine: string;
  /** In the order the run printed them. */
  readonly records: readonly AttestationRecord[];
  /** What the terminal pane and the tables render. Counts from `records`. */
  readonly result: RunResult;
  /** Present only when the run carried a summary of how it was invoked. */
  readonly summarised: boolean;
  /** Digests a summary listed that no record in the bundle carries. */
  readonly missing: readonly string[];
}

function resultOf(
  records: readonly AttestationRecord[],
  command: string,
  duration: string,
  via: ReadonlyMap<string, string>,
): RunResult {
  const runs: FunctionRun[] = records.map((record) => {
    const v = via.get(record.digest);
    return {
      path: record.path,
      symbol: record.symbol,
      verdict: record.verdict,
      ...(v !== undefined ? { via: v } : {}),
    };
  });
  return {
    command,
    changedFunctions: records.length,
    verifiableFunctions: records.filter((r) => r.verdict.state !== "ABSTAINED").length,
    duration,
    runs,
  };
}

/**
 * The runs in a bundle, newest first.
 *
 * A summary orders and labels a run's records. Records no summary lists -
 * written by an older qed, or exported without their summary - are grouped
 * by the commit and time they name, and say they were.
 */
export function runsOf(bundle: QedBundle): BundleRun[] {
  const byDigest = new Map(bundle.records.map((r) => [r.digest, r]));
  const claimed = new Set<string>();
  const out: BundleRun[] = [];

  for (const summary of bundle.runs) {
    const records: AttestationRecord[] = [];
    const missing: string[] = [];
    const via = new Map<string, string>();
    for (const entry of summary.entries) {
      const record = byDigest.get(entry.digest);
      if (!record) {
        missing.push(entry.digest);
        continue;
      }
      claimed.add(entry.digest);
      records.push(record);
      if (entry.via !== undefined) via.set(entry.digest, entry.via);
    }
    if (records.length === 0) continue;
    out.push({
      key: `${summary.commit}|${summary.timestamp}|${summary.command}`,
      repository: summary.repository,
      commit: summary.commit,
      timestamp: summary.timestamp,
      engine: summary.engine,
      records,
      result: resultOf(records, summary.command, summary.duration, via),
      summarised: true,
      missing,
    });
  }

  const loose = new Map<string, AttestationRecord[]>();
  for (const record of bundle.records) {
    if (claimed.has(record.digest)) continue;
    const key = `${record.commit}|${record.timestamp}`;
    loose.set(key, [...(loose.get(key) ?? []), record]);
  }
  for (const [key, records] of loose) {
    const first = records[0];
    if (!first) continue;
    out.push({
      key,
      repository: first.repository,
      commit: first.commit,
      timestamp: first.timestamp,
      engine: first.engine,
      records,
      result: resultOf(records, "qed check", "not recorded", new Map()),
      summarised: false,
      missing: [],
    });
  }

  return out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

/* ------------------------------------------------------------------------ */
/* Signatures, as far as a browser can check them                           */
/* ------------------------------------------------------------------------ */

/**
 * The signed run in the bundle that lists this record exactly as it reads,
 * if there is one.
 *
 * This is the part of signature checking a browser can do: that the record
 * is the one a signed manifest names. The certificate chain and Rekor's
 * inclusion proof need `qed verify`.
 */
export async function signedRunFor(
  record: AttestationRecord,
  signatures: readonly SignedRun[],
): Promise<SignedRun | undefined> {
  const subject = await signingSubject(record);
  return signatures.find((run) => manifestSubjects(run.payload)?.includes(subject));
}

/** Re-exported so a reader of the bundle model finds the manifest kind here too. */
export { RUN_MANIFEST_KIND };

/** `sha256:<hex>` of a text, as the console prints a file's digest. */
export async function sha256Of(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The bundle as `qed export` writes it, so a digest of it is reproducible. */
export function serialiseBundle(bundle: QedBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
