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
