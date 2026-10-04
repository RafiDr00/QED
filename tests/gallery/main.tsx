import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@qed/tokens/tokens.css";
import "@qed/ui/ui.css";
import "./gallery.css";

import logotypeUrl from "@qed/ui/assets/logos/qed-logotype.svg";
import {
  Attestation,
  Button,
  Card,
  FocusRing,
  Label,
  Logo,
  Table,
  TerminalOutput,
  VerdictChip,
  VerdictTable,
  type AttestationRecord,
  type FunctionRun,
  type RunResult,
} from "@qed/ui";

/**
 * The component index the Playwright evidence run shoots.
 *
 * Not part of either product: it exists so every component, and every state
 * nobody designed, is rendered somewhere a gate can look at it. Each
 * [data-shot] is one screenshot in each theme (G6), and the marks carry
 * [data-mark] so G5 can measure the cut.
 */

const RUNS: FunctionRun[] = [
  {
    path: "billing/tax.go",
    symbol: "computeVat",
    verdict: { state: "EQUIVALENT", inputs: 18402 },
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
    path: "api/handlers.go",
    symbol: "CreateOrder",
    verdict: { state: "ABSTAINED", obstruction: "opens a database connection" },
  },
];

const LONG_RUNS: FunctionRun[] = [
  {
    path: "ledger/reconciliation/periodic-settlement.ts",
    symbol: "reconcileOutstandingSettlementBatchesForPeriod",
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
    path: "infrastructure/observability/exporters/opentelemetry-collector.go",
    symbol: "NewBatchingSpanExporterWithRetryAndBackoff",
    verdict: {
      state: "ABSTAINED",
      obstruction:
        "opens a network socket to the collector endpoint during construction",
    },
  },
];

const RUN: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 41,
  verifiableFunctions: 3,
  duration: "2m 14s",
  runs: RUNS,
};

const EMPTY: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 3,
  verifiableFunctions: 0,
  duration: "11s",
  runs: [],
};

const RECORD: AttestationRecord = {
  symbol: "computeVat",
  path: "billing/tax.go",
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-10-04 09:41 UTC",
  verdict: { state: "EQUIVALENT", inputs: 18402 },
  inputStrategy: "type-directed, corpus-seeded, coverage-guided",
  controls: ["clock frozen", "rng seed 0x5f3a", "network denied", "overlay fs"],
  tolerances: ["float ε 1e-9"],
  engine: "qed 0.4.1",
  signer: "github-actions (OIDC)",
  rekorIndex: "78 440 213",
  digest: "sha256:9f2a1c84bd0e…7c31",
};

function Shot({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="gal-shot" aria-label={name}>
      <p className="gal-shot-name">
        <Label>{name.toUpperCase()}</Label>
      </p>
      <div data-shot={name} className="gal-shot-body">
        {children}
      </div>
    </section>
  );
}

function Gallery() {
  return (
    <main className="gal">
      <h1 className="t-display-sm gal-title">Component index</h1>

      <Shot name="Logo">
        <div className="gal-row">
          <Logo variant="lockup" size="lg" />
          <Logo variant="wordmark" size="md" decorative />
        </div>
      </Shot>

      {/*
        The design system's own logotype file, drawn at the size where its
        baked-in smoothed mark is the correct one. The composed lockup beside
        it must be pixel-identical: composing it is what lets the small mark be
        used lower down, and it must not have moved anything.
      */}
      <section className="gal-shot" aria-label="Lockup fidelity">
        <p className="gal-shot-name">
          <Label>LOCKUP VS THE SHIPPED FILE</Label>
        </p>
        <div className="gal-row">
          <span data-lockup-composed>
            <Logo variant="lockup" size="xl" decorative />
          </span>
          <img data-lockup-file src={logotypeUrl} alt="" className="gal-logotype-file" />
        </div>
      </section>

      <Shot name="LogoMarks">
        <div className="gal-row gal-marks">
          {(
            [
              ["xs", 16],
              ["sm", 24],
              ["md", 32],
              ["lg", 48],
            ] as const
          ).map(([size, px]) => (
            <span key={size} data-mark={px} className="gal-mark">
              <Logo variant="mark" size={size} decorative />
            </span>
          ))}
        </div>
      </Shot>

      <Shot name="Button">
        <div className="gal-row">
          <Button variant="primary">Verify independently</Button>
          <Button variant="secondary">Copy manifest digest</Button>
          <Button variant="quiet">Paper</Button>
          <Button variant="primary" disabled>
            Verifying&hellip;
          </Button>
        </div>
      </Shot>

      <Shot name="Card">
        <Card as="div">
          <p className="t-numeral">18,402</p>
          <p className="gal-gap">
            <Label>GENERATED INPUTS</Label>
          </p>
          <p className="t-body-sm qed-prose">
            Type-directed, corpus-seeded, coverage-guided. The count is printed
            because a count-free claim is not a result.
          </p>
        </Card>
      </Shot>

      <Shot name="Label">
        <div className="gal-row">
          <Label>SIGNED ATTESTATION</Label>
          <Label tone="ink">VERDICT</Label>
          <Label tone="proof">EQUIVALENT</Label>
        </div>
      </Shot>

      <Shot name="FocusRing">
        <FocusRing as="div">
          <a href="#focus-ring-demo">A link inside a composite</a>
        </FocusRing>
      </Shot>

      <Shot name="Table">
        <Table
          caption="Files in the audit export"
          captionVisible
          rows={[
            { file: "attestations.json", size: "48 KB" },
            { file: "counterexamples.json", size: "6 KB" },
          ]}
          rowKey={(row) => row.file}
          columns={[
            {
              key: "file",
              header: "FILE",
              rowHeader: true,
              cell: (row) => <span className="t-mono">{row.file}</span>,
            },
            {
              key: "size",
              header: "SIZE",
              align: "end",
              cell: (row) => <span className="t-mono-sm">{row.size}</span>,
            },
          ]}
        />
      </Shot>

      <Shot name="TableEmpty">
        <Table
          caption="An export with nothing in it"
          captionVisible
          rows={[] as { file: string }[]}
          rowKey={(row) => row.file}
          empty="Nothing to export from this release."
          columns={[
            { key: "file", header: "FILE", rowHeader: true, cell: (row) => row.file },
          ]}
        />
      </Shot>

      <Shot name="VerdictChip">
        <div className="gal-row" data-glyphs>
          {RUNS.map((run) => (
            <span key={run.symbol} data-glyph={run.verdict.state}>
              <VerdictChip verdict={run.verdict} />
            </span>
          ))}
        </div>
      </Shot>

      <Shot name="VerdictTable">
        <VerdictTable caption="One run, three verdicts" captionVisible runs={RUNS} />
      </Shot>

      <Shot name="VerdictTableLongStrings">
        <VerdictTable
          caption="Long paths and long symbols"
          captionVisible
          runs={LONG_RUNS}
        />
      </Shot>

      <Shot name="VerdictTableEmpty">
        <VerdictTable caption="A run that verified nothing" captionVisible runs={[]} />
      </Shot>

      <Shot name="Attestation">
        <Attestation record={RECORD} onVerify={() => undefined} />
      </Shot>

      <Shot name="AttestationChecking">
        <Attestation
          record={RECORD}
          onVerify={() => undefined}
          verification={{ status: "checking" }}
        />
      </Shot>

      <Shot name="AttestationVerified">
        <Attestation
          record={RECORD}
          onVerify={() => undefined}
          verification={{ status: "verified", checkedAt: "2026-10-04 09:42 UTC" }}
        />
      </Shot>

      <Shot name="AttestationMismatch">
        <Attestation
          record={RECORD}
          onVerify={() => undefined}
          verification={{
            status: "mismatch",
            detail:
              "Re-derivation produced a different digest. Do not rely on this record.",
          }}
        />
      </Shot>

      <Shot name="AttestationNoTolerance">
        <Attestation record={{ ...RECORD, tolerances: [], controls: [] }} />
      </Shot>

      <Shot name="TerminalOutput">
        <TerminalOutput result={RUN} />
      </Shot>

      <Shot name="TerminalOutputEmpty">
        <TerminalOutput result={EMPTY} label="empty run output" />
      </Shot>

      <Shot name="GlyphsLarge">
        {/* Rendered large so the greyscale comparison in G10 is not a
            measurement of antialiasing. */}
        <div className="gal-row gal-glyphs-large" data-glyphs-large>
          {RUNS.map((run) => (
            <span key={run.symbol} data-glyph-large={run.verdict.state}>
              <VerdictChip verdict={run.verdict} evidence={false} bare />
            </span>
          ))}
        </div>
      </Shot>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");

createRoot(container).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
