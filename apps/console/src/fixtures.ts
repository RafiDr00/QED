import type { AttestationRecord, FunctionRun, RunResult } from "@qed/ui";

/**
 * Typed fixtures. The console never talks to a network: every figure here is
 * shaped exactly as the engine would emit it, so the shell can be built and
 * reviewed against real-looking evidence.
 *
 * Deliberately awkward cases are included rather than kept out of sight: a
 * 44-character symbol, a counterexample with a long payload, a release with a
 * high abstain rate, and a run with nothing verifiable in it.
 */

export const CURRENT_RUN: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 41,
  verifiableFunctions: 7,
  duration: "2m 14s",
  runs: [
    {
      path: "billing/tax.go",
      symbol: "computeVat",
      verdict: {
        state: "EQUIVALENT",
        inputs: 18402,
        strategy: "type-directed, corpus-seeded, coverage-guided",
      },
    },
    {
      path: "billing/tax.go",
      symbol: "roundHalfEven",
      verdict: { state: "EQUIVALENT", inputs: 9110 },
    },
    {
      path: "orders/pricing.ts",
      symbol: "applyDiscount",
      verdict: { state: "EQUIVALENT", inputs: 12884 },
    },
    {
      path: "orders/pricing.ts",
      symbol: "bulkRate",
      verdict: {
        state: "DIVERGED",
        counterexample: {
          input: '{ qty: 100, tier: "gold" }',
          base: "0.85",
          head: "0.8",
          repro: "qed repro 9f2a1c",
          foundAt: { index: 7, of: 9110 },
        },
      },
    },
    {
      path: "ledger/reconciliation/periodic.ts",
      symbol: "reconcileOutstandingSettlementBatches",
      verdict: {
        state: "DIVERGED",
        counterexample: {
          input:
            '{ batches: [{ id: "b-0041", cents: 199_99, currency: "EUR" }], cutoff: "2026-09-30T23:59:59Z" }',
          base: "19999",
          head: "19998",
          repro: "qed repro 4c81de",
          foundAt: { index: 2143, of: 7500 },
        },
      },
    },
    {
      path: "api/handlers.go",
      symbol: "CreateOrder",
      verdict: {
        state: "ABSTAINED",
        obstruction: "opens a database connection",
      },
    },
    {
      path: "api/handlers.go",
      symbol: "webhookRetry",
      verdict: {
        state: "ABSTAINED",
        obstruction: "depends on wall-clock time",
      },
    },
  ],
};

/** A run where nothing could be verified. The empty state is a real state. */
export const EMPTY_RUN: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 3,
  verifiableFunctions: 0,
  duration: "11s",
  runs: [],
};

export const ATTESTATION: AttestationRecord = {
  symbol: "computeVat",
  path: "billing/tax.go",
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-10-04 09:41 UTC",
  verdict: {
    state: "EQUIVALENT",
    inputs: 18402,
    strategy: "type-directed, corpus-seeded, coverage-guided",
  },
  inputStrategy: "type-directed, corpus-seeded, coverage-guided",
  controls: [
    "clock frozen",
    "rng seed 0x5f3a",
    "network denied",
    "overlay fs",
  ],
  tolerances: ["float ε 1e-9"],
  engine: "qed 0.4.1",
  signer: "github-actions (OIDC)",
  rekorIndex: "78 440 213",
  digest: "sha256:9f2a1c84bd0e…7c31",
};

/** A second record, with no tolerance applied: the row still prints. */
export const ATTESTATION_STRICT: AttestationRecord = {
  ...ATTESTATION,
  symbol: "roundHalfEven",
  verdict: { state: "EQUIVALENT", inputs: 9110 },
  inputStrategy: "type-directed, corpus-seeded",
  tolerances: [],
  rekorIndex: "78 440 214",
  digest: "sha256:3b7e0d21aa54…1f08",
};

export interface Release {
  readonly tag: string;
  readonly date: string;
  readonly commit: string;
  readonly changed: number;
  readonly verifiable: number;
  readonly equivalent: number;
  readonly diverged: number;
  readonly abstained: number;
  readonly attestations: number;
}

export const RELEASES: readonly Release[] = [
  {
    tag: "v2.14.0",
    date: "2026-10-04",
    commit: "4f2c91a",
    changed: 41,
    verifiable: 7,
    equivalent: 3,
    diverged: 2,
    abstained: 2,
    attestations: 3,
  },
  {
    tag: "v2.13.2",
    date: "2026-09-27",
    commit: "b81d004",
    changed: 12,
    verifiable: 6,
    equivalent: 6,
    diverged: 0,
    abstained: 0,
    attestations: 6,
  },
  {
    tag: "v2.13.1",
    date: "2026-09-20",
    commit: "0ac77e5",
    changed: 58,
    verifiable: 9,
    equivalent: 7,
    diverged: 0,
    abstained: 2,
    attestations: 7,
  },
  {
    tag: "v2.13.0",
    date: "2026-09-13",
    commit: "7d2aa19",
    changed: 96,
    verifiable: 11,
    equivalent: 9,
    diverged: 1,
    abstained: 1,
    attestations: 9,
  },
];

export interface ExportRow {
  readonly file: string;
  readonly kind: string;
  readonly size: string;
  readonly digest: string;
}

export const EXPORT_CONTENTS: readonly ExportRow[] = [
  {
    file: "attestations.json",
    kind: "Signed records, one per verified function",
    size: "48 KB",
    digest: "sha256:1d77a0…",
  },
  {
    file: "attestations.pdf",
    kind: "The same records, filed",
    size: "210 KB",
    digest: "sha256:c40b19…",
  },
  {
    file: "counterexamples.json",
    kind: "Every minimised input that diverged",
    size: "6 KB",
    digest: "sha256:9f2a1c…",
  },
  {
    file: "abstentions.json",
    kind: "Every function not run, and why",
    size: "3 KB",
    digest: "sha256:55ee82…",
  },
  {
    file: "rekor-proofs.json",
    kind: "Inclusion proofs for the public log",
    size: "18 KB",
    digest: "sha256:aa1420…",
  },
];

export const VERDICT_ROWS: readonly FunctionRun[] = CURRENT_RUN.runs;
