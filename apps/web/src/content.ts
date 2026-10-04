import type { FunctionRun, RunResult } from "@qed/ui";

/**
 * Every number on this site is a figure the product would produce. The voice
 * rule in the brand book is the hard one: short, exact, no adjectives, and the
 * abstain rate goes on the home page rather than in a footnote.
 */

export const HERO_RUN: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 41,
  verifiableFunctions: 7,
  duration: "2m 14s",
  runs: [
    {
      path: "billing/tax.go",
      symbol: "computeVat",
      verdict: { state: "EQUIVALENT", inputs: 18402 },
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
            '{ batches: [{ id: "b-0041", cents: 19999, currency: "EUR" }], cutoff: "2026-09-30T23:59:59Z" }',
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

export const VERDICT_EXAMPLES: readonly FunctionRun[] = HERO_RUN.runs;

export interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

export const STEPS: readonly Step[] = [
  {
    n: "01",
    title: "It reads the diff",
    body: "Every function the change touches, and the version it replaces. Nothing else is examined, so a large pull request is not a large run.",
  },
  {
    n: "02",
    title: "It generates inputs",
    body: "Type-directed, seeded from your own corpus, then guided by coverage. Both versions run on the same inputs under the same controls: clock frozen, seeded rng, network denied, overlay filesystem.",
  },
  {
    n: "03",
    title: "It compares outputs",
    body: "Return values, raised errors, and writes to anything the harness can observe. A single differing input ends the run for that function and is minimised before it is printed.",
  },
  {
    n: "04",
    title: "It signs what it found",
    body: "The record carries the inputs, the controls, every tolerance applied and the CI provider's OIDC identity. It is logged to Rekor, and anyone can re-derive it without us.",
  },
];

export interface VerdictNote {
  readonly state: string;
  readonly title: string;
  readonly body: string;
}

export const VERDICT_NOTES: readonly VerdictNote[] = [
  {
    state: "EQUIVALENT",
    title: "Equivalent, with a count",
    body: "The two versions agreed on every generated input. The count is printed because a count-free claim is not a result.",
  },
  {
    state: "DIVERGED",
    title: "Diverged, with the input",
    body: "One input separated them. It is minimised, printed in full, and reproducible with a single command.",
  },
  {
    state: "ABSTAINED",
    title: "Abstained, with the reason",
    body: "The function could not be run soundly. The exact obstruction is printed, in one clause. Abstaining never breaks a build.",
  },
];

export interface Measure {
  readonly value: string;
  readonly label: string;
  readonly note: string;
}

/** Published limits. The abstain rate is on the home page on purpose. */
export const MEASURES: readonly Measure[] = [
  {
    value: "29%",
    label: "ABSTAIN RATE",
    note: "2 of the 7 verifiable functions in this run. The limit is published because publishing it is what makes the rest believable.",
  },
  {
    value: "7",
    label: "VERIFIABLE OF 41",
    note: "the run above, on a service repository. The other 34 functions touch a database, a clock or a network socket.",
  },
  {
    value: "2m 14s",
    label: "MEDIAN RUN",
    note: "on a 4-core runner, cold cache, for a pull request of that size.",
  },
];

export interface Tier {
  readonly name: string;
  readonly price: string;
  readonly unit: string;
  readonly summary: string;
  readonly includes: readonly string[];
  readonly primary?: boolean;
}

export const TIERS: readonly Tier[] = [
  {
    name: "Open",
    price: "$0",
    unit: "public repositories",
    summary: "The whole engine. Runs on your CI, signs to the public log.",
    includes: [
      "All three verdicts",
      "Signed attestations, Rekor-logged",
      "GitHub and GitLab CI",
      "Community support",
    ],
  },
  {
    name: "Team",
    price: "$40",
    unit: "per developer, per month",
    summary: "Private repositories, retained records, and the console.",
    includes: [
      "Everything in Open",
      "Private repositories",
      "12 months of retained records",
      "Release evidence dashboard",
      "Email support, one business day",
    ],
    primary: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    unit: "annual, per organisation",
    summary: "The audit bundle, and the controls an assessor asks for.",
    includes: [
      "Everything in Team",
      "Audit export, PDF and JSON",
      "7 years of retained records",
      "SSO and SCIM",
      "Self-hosted runners",
    ],
  },
];

export interface DocsSection {
  readonly id: string;
  readonly title: string;
  readonly body: readonly string[];
}

export const DOCS_NAV: readonly { id: string; title: string }[] = [
  { id: "install", title: "Install" },
  { id: "first-run", title: "First run" },
  { id: "controls", title: "Determinism controls" },
  { id: "tolerances", title: "Tolerances" },
  { id: "attestations", title: "Attestations" },
  { id: "exit-codes", title: "Exit codes" },
];

export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    id: "install",
    title: "Install",
    body: [
      "One binary, no daemon. It runs the same on a laptop and on a runner.",
      "curl -fsSL https://qed.dev/install.sh | sh",
    ],
  },
  {
    id: "first-run",
    title: "First run",
    body: [
      "Point it at the branch you are merging into. It reads the diff, selects the functions it can run soundly, and prints one line per function.",
      "qed check --base origin/main",
    ],
  },
  {
    id: "controls",
    title: "Determinism controls",
    body: [
      "Both versions run under the same controls, and the record names each one. The clock is frozen, the rng is seeded, the network is denied, and the filesystem is an overlay discarded after the run.",
      "A function that escapes a control is not run twice and averaged. It abstains, and the obstruction is printed.",
    ],
  },
  {
    id: "tolerances",
    title: "Tolerances",
    body: [
      "A float epsilon or an unordered-collection comparison weakens the claim, so every tolerance applied is printed in the attestation.",
      "qed check --tolerance float=1e-9",
    ],
  },
  {
    id: "attestations",
    title: "Attestations",
    body: [
      "Each verified function produces a signed record: the verdict, the inputs, the controls, the tolerances, the engine version and the CI provider's OIDC identity.",
      "The record says who could have produced it. It never says that QED vouched for itself.",
      "qed verify --digest sha256:9f2a1c84bd0e...7c31",
    ],
  },
  {
    id: "exit-codes",
    title: "Exit codes",
    body: [
      "0 - no function diverged. Abstentions are reported and do not fail the run.",
      "1 - at least one function diverged. The counterexample is in the output and in the record.",
      "2 - the run could not start: a bad flag, a missing base ref, or a repository it cannot read.",
    ],
  },
];
