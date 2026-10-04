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
