import type { Verdict } from "./verdict.js";

/** The signed record of one verification. React-free. */
export interface AttestationRecord {
  readonly symbol: string;
  readonly path: string;
  readonly repository: string;
  readonly commit: string;
  /** Already formatted, UTC: "2026-10-04 09:41 UTC". */
  readonly timestamp: string;
  readonly verdict: Verdict;
  /** "type-directed, corpus-seeded, coverage-guided" */
  readonly inputStrategy: string;
  /** Determinism controls. Never collapsed, even when short. */
  readonly controls: readonly string[];
  /**
   * Every tolerance applied. An empty list prints as "none applied" - the row
   * itself never disappears, because that row is the difference between
   * evidence and a badge.
   */
  readonly tolerances: readonly string[];
  readonly engine: string;
  /** The CI provider's OIDC identity. The record names the signer, not QED. */
  readonly signer: string;
  readonly rekorIndex: string;
  readonly digest: string;
}

/**
 * Verification is a real action, so its outcome is real state - held by the
 * caller and passed in, never derived inside the component.
 */
export type VerificationState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "verified"; readonly checkedAt: string }
  | { readonly status: "mismatch"; readonly detail: string }
  | { readonly status: "error"; readonly detail: string };

/**
 * The whole verdict, as one line.
 *
 * Every field a reader is shown goes in. Signing only the repro line left the
 * printed input and both results free to be edited under a digest that still
 * matched - the record would have verified while saying something it never
 * found. The counterexample is JSON-encoded so a field containing the
 * separator cannot move text from one field into the next.
 */
function canonicalVerdict(verdict: AttestationRecord["verdict"]): string {
  switch (verdict.state) {
    case "EQUIVALENT":
      // The throw count is new; a record without one keeps the form it was
      // signed in. With one, the fields are JSON-encoded, so a strategy
      // ending in ":threw=5" cannot pass for a count. The two forms cannot
      // collide: the old one continues with a digit, this one with "[".
      if (verdict.threw !== undefined) {
        return `EQUIVALENT:${JSON.stringify([verdict.inputs, verdict.strategy ?? null, verdict.threw])}`;
      }
      return verdict.strategy === undefined
        ? `EQUIVALENT:${verdict.inputs}`
        : `EQUIVALENT:${verdict.inputs}:${verdict.strategy}`;
    case "DIVERGED": {
      const c = verdict.counterexample;
      return `DIVERGED:${JSON.stringify([
        c.input,
        c.base,
        c.head,
        c.repro,
        c.foundAt ? `${c.foundAt.index}/${c.foundAt.of}` : "",
        c.affects ?? "",
      ])}`;
    }
    case "ABSTAINED":
      return `ABSTAINED:${verdict.obstruction}`;
  }
}

/**
 * The signed fields, in a fixed order. Everything the record asserts goes in;
 * the digest itself does not, because it is what this produces.
 */
export function canonicalRecord(record: AttestationRecord): string {
  const verdict = canonicalVerdict(record.verdict);

  return [
    record.repository,
    record.commit,
    record.path,
    record.symbol,
    record.timestamp,
    verdict,
    record.inputStrategy,
    record.controls.join("|"),
    record.tolerances.join("|"),
    record.engine,
    record.signer,
    record.rekorIndex,
  ].join("\n");
}

/**
 * What a Sigstore signature covers: every field of the record except the two
 * the signature itself produces.
 *
 * Who signed and where it was logged are only known once signing is done -
 * the identity is in the certificate Fulcio issues, the log index in the
 * entry Rekor returns - so they cannot be inside what was signed. They are
 * checked against the verified bundle instead, and the digest covers them
 * along with everything else. DECISIONS.md D-059.
 */
export function signingPayload(record: AttestationRecord): string {
  return canonicalRecord({ ...record, signer: "", rekorIndex: "" });
}

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The record as a run's signature names it: `sha256:` of its signing payload. */
export async function signingSubject(record: AttestationRecord): Promise<string> {
  return `sha256:${await sha256Hex(signingPayload(record))}`;
}

/** The kind a signed run manifest declares, so no other JSON can pass for one. */
export const RUN_MANIFEST_KIND = "qed.run/v1";

/**
 * The text one run's signature covers: every record's subject, sorted.
 *
 * One signature per run rather than per record. Each signature costs a
 * certificate from Fulcio and an entry in Rekor's public log; a run of
 * thirty functions would have made thirty of each, for one CI job's single
 * identity.
 */
export function runManifest(subjects: readonly string[]): string {
  return JSON.stringify({ kind: RUN_MANIFEST_KIND, subjects: [...new Set(subjects)].sort() });
}

/** The subjects a manifest lists, or undefined if the text is not a manifest. */
export function manifestSubjects(text: string): readonly string[] | undefined {
  try {
    const parsed = JSON.parse(text) as { kind?: unknown; subjects?: unknown };
    if (parsed.kind !== RUN_MANIFEST_KIND || !Array.isArray(parsed.subjects)) return undefined;
    if (!parsed.subjects.every((s) => typeof s === "string")) return undefined;
    // Only the exact canonical form: a manifest is matched as signed bytes.
    const subjects: readonly string[] = parsed.subjects;
    return runManifest(subjects) === text ? subjects : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Re-derives the record's digest from its own signed fields.
 *
 * "Verify is a real action. The button re-derives the verdict from the record
 * and shows the result. An attestation nobody can check independently is
 * decoration." (components/Attestation/README.md)
 *
 * This is the whole of that check that can run in a browser: it proves the
 * record has not been altered since it was signed. Checking the signature
 * against the CI provider's OIDC identity, and the inclusion proof against
 * Rekor, needs the network the console deliberately does not have.
 */
export async function reDeriveDigest(
  record: AttestationRecord,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRecord(record));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/** What the card should show, given what came back. */
export async function verifyRecord(
  record: AttestationRecord,
  now: Date,
): Promise<VerificationState> {
  try {
    const derived = await reDeriveDigest(record);
    if (derived === record.digest) {
      const checkedAt = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
      return { status: "verified", checkedAt };
    }
    return {
      status: "mismatch",
      detail:
        `Re-derived ${derived.slice(0, 22)}… from the record's own fields, ` +
        `but it carries ${record.digest.slice(0, 22)}…. Do not rely on it.`,
    };
  } catch (error) {
    return {
      status: "error",
      detail: `The check could not run: ${String(error)}`,
    };
  }
}
