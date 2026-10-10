import { summarise, type FunctionRun, type RunResult } from "@qed/ui";

import { GENERATED_RUN } from "./run.generated.js";

/**
 * Every number on this site is a figure the product would produce. The voice
 * rule in the brand book is the hard one: short, exact, no adjectives, and the
 * abstain rate goes on the home page rather than in a footnote.
 */

/**
 * The run shown on this page is a real one.
 *
 * `pnpm generate:run` executes the engine over examples/ledger and writes
 * run.generated.ts. Nothing on this page is a number someone typed: the
 * counts, the counterexample and the obstructions below all came out of
 * running the code.
 */
export const HERO_RUN: RunResult = GENERATED_RUN;

const SUMMARY = summarise(HERO_RUN);

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
    body: "Type-directed: it reads the declared parameter types and generates from them, seeded with the constants mined out of both versions — because the boundary a change moved is usually written down in the code. Both versions then run on the same inputs under the same controls: clock frozen, rng seeded, network and timers denied, relative imports pinned to the revision being compared.",
  },
  {
    n: "03",
    title: "It compares outputs",
    body: "Return values and raised errors, compared structurally — object key order is not a difference, array order is, and every tolerance applied is recorded. A differing input is minimised before it is printed, so what you read is the smallest case that still disagrees.",
  },
  {
    n: "04",
    title: "It records what it found",
    body: "Every function gets a record: the verdict, the input count, the controls and every tolerance applied, under a digest computed from those fields. The digest is printed in the run's log, so anyone holding the record can recompute it and check it against that copy — without us, and without a network.",
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
export const ABSTAIN_RATE = Math.round(
  (SUMMARY.abstained / HERO_RUN.changedFunctions) * 100,
);

/**
 * Published limits, computed from the run above rather than written down.
 * "The abstain rate goes on the home page, not in a footnote: publishing the
 * limit is what makes the claim believable."
 */
export const MEASURES: readonly Measure[] = [
  {
    value: `${ABSTAIN_RATE}%`,
    label: "ABSTAIN RATE",
    note: `${SUMMARY.abstained} of the ${HERO_RUN.changedFunctions} functions in this run could not be verified. The limit is published because publishing it is what makes the rest believable.`,
  },
  {
    value: String(HERO_RUN.verifiableFunctions),
    label: `VERIFIABLE OF ${HERO_RUN.changedFunctions}`,
    note: "the run above. The rest read a clock, read a random number, or have no type annotation to generate inputs from.",
  },
  {
    value: HERO_RUN.duration,
    label: "THIS RUN",
    note: "on one core, every function compared against its previous version on 2,000 generated inputs.",
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
      "Records with a recomputable digest",
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
  { id: "limits", title: "What is not built yet" },
  { id: "exit-codes", title: "Exit codes" },
];

export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    id: "install",
    title: "Install",
    body: [
      "One binary, no daemon. It runs the same on a laptop and on a runner.",
      "curl -fsSL https://qed.dev/install.sh | sh",
      "The script picks the binary for your machine — Linux and macOS on x64 or arm64, Windows on x64 — checks it against the release's SHA-256 checksums, and installs nothing that does not match. QED_VERSION pins a release; QED_INSTALL_DIR changes where it goes, by default ~/.local/bin.",
    ],
  },
  {
    id: "first-run",
    title: "First run",
    body: [
      "Point it at the branch you are merging into. It reads the diff, selects the functions it can run soundly, and prints one line per function.",
      "qed check --base origin/main",
      "A divergence prints a repro line. It is a complete command: run it as printed to see what each version returned.",
      "qed repro billing/ledger.ts bulkRate --input '[{\"qty\":100,\"tier\":\"gold\"}]'",
    ],
  },
  {
    id: "controls",
    title: "Determinism controls",
    body: [
      "Both versions run under the same controls, and the record names each one. The clock is frozen, the rng is seeded, and the network and timers are denied.",
      "A relative import is pinned: each version loads the helper from its own revision, so a change to the helper shows up as part of the change. Any other import — a package, or a Node built-in — is refused rather than resolved, because a function whose behaviour depends on another module cannot be compared in isolation unless that module is pinned too.",
      "A function that escapes a control is not run twice and averaged. It abstains, and the obstruction is printed.",
    ],
  },
  {
    id: "tolerances",
    title: "Tolerances",
    body: [
      "A float epsilon or an unordered-collection comparison weakens the claim. A tolerance loosens a comparison only where one needs it, and every one applied — on an equivalence as well as a divergence — is written into the record. The command line echoed at the top of the output carries it too.",
      "qed check --tolerance float=1e-9",
      "float is an absolute difference; rel is a fraction of the larger magnitude, which is the one to use for money. Both can be given at once.",
      "qed check --tolerance float=1e-9,rel=1e-12",
    ],
  },
  {
    id: "attestations",
    title: "Attestations",
    body: [
      "Each function the run looked at produces a record in .qed/records: the verdict, the inputs, the controls, the tolerances and the engine version, under a digest computed from exactly those fields. Each digest is also printed in the run's log.",
      "Recomputing the digest proves the record has not been altered since it was written — checked against the digest you hold, from the log, because anyone can rewrite a record and recompute a digest that matches it. A digest can be shortened to 16 hex characters, as below. It does not prove who wrote it — see the limits below.",
      "qed verify --digest sha256:9f2a1c84bd0e...7c31",
    ],
  },
  {
    id: "limits",
    title: "What is not built yet",
    body: [
      "QED is honest about its own state as well as about your code. Today the engine verifies pure TypeScript and JavaScript functions in a module and the relative imports it makes — the kind of code tax, pricing and ledger rules are written in.",
      "Not yet built: signing against a CI provider's OIDC identity, logging to Rekor, resolving package imports, async functions, and coverage-guided generation. Each of those is a reason the tool abstains today rather than a claim it quietly makes. Records say so: their signer is \"unsigned\" and their Rekor index \"not logged\".",
      "The abstain rate on the home page is measured from a real run, not estimated.",
    ],
  },
  {
    id: "exit-codes",
    title: "Exit codes",
    body: [
      "0 - no function diverged. Abstentions are reported and do not fail the run.",
      "1 - at least one function diverged. The counterexample is in the output and in the record. For qed verify: the record has been altered.",
      "2 - the run could not start, or could not finish: a bad flag, a missing base ref, a repository it cannot read, or a record that cannot be found.",
    ],
  },
];
