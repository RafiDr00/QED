import { Card, Label, Table, UNSIGNED, summarise, type BundleRun } from "@qed/ui";

import type { Loaded } from "../bundle.js";

/**
 * Release evidence: what each run in the bundle could prove, and what it
 * could not. The abstain rate sits beside the coverage figure, never without
 * it, and is the same ratio the home page prints: abstained over changed.
 */

/*
 * With nothing changed there is no rate to report. Printing "0%" would read
 * as "nothing abstained", which says something that did not happen.
 */
const NONE = "—";

const percent = (part: number, whole: number) =>
  whole === 0 ? NONE : `${Math.round((part / whole) * 100)}%`;

interface Row {
  readonly run: BundleRun;
  readonly release: string;
  readonly equivalent: number;
  readonly diverged: number;
  readonly abstained: number;
  readonly signed: number;
}

function rowOf(run: BundleRun, tags: Readonly<Record<string, readonly string[]>>): Row {
  const summary = summarise(run.result);
  return {
    run,
    release: (tags[run.commit] ?? []).join(", "),
    equivalent: summary.equivalent,
    diverged: summary.diverged,
    abstained: summary.abstained,
    signed: run.records.filter((r) => r.signer !== UNSIGNED).length,
  };
}

export function ReleaseView({ loaded }: { loaded: Loaded }) {
  const rows = loaded.runs.map((run) => rowOf(run, loaded.bundle.tags));
  const latest = rows[0];

  return (
    <div className="qed-stack" data-gap="section">
      {latest ? (
        <section aria-labelledby="release-latest">
          <div className="qed-section-heading">
            <h2 id="release-latest" className="t-heading">
              {latest.release === "" ? latest.run.commit : latest.release}
            </h2>
          </div>
          <ul className="qed-grid">
            {[
              {
                label: "VERIFIABLE",
                value: percent(latest.run.result.verifiableFunctions, latest.run.result.changedFunctions),
                note: `${latest.run.result.verifiableFunctions} of ${latest.run.result.changedFunctions} changed functions`,
              },
              {
                label: "ABSTAIN RATE",
                value: percent(latest.abstained, latest.run.result.changedFunctions),
                note: `${latest.abstained} of ${latest.run.result.changedFunctions} changed functions`,
              },
              {
                label: "DIVERGENCES",
                value: String(latest.diverged),
                note: "each with a minimised counterexample",
              },
              {
                label: "SIGNED",
                value: `${latest.signed} / ${latest.run.records.length}`,
                note:
                  latest.signed === 0
                    ? "made without qed check --sign"
                    : "signed with Sigstore and logged in Rekor",
              },
            ].map((item) => (
              <li key={item.label}>
                <Card as="div">
                  <p className="t-numeral">{item.value}</p>
                  <p className="con-count-label">
                    <Label>{item.label}</Label>
                  </p>
                  <p className="t-body-sm qed-prose">{item.note}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="release-history">
        <div className="qed-section-heading">
          <h2 id="release-history" className="t-heading">
            History
          </h2>
        </div>
        <div className="qed-table-scroll" tabIndex={0} role="group" aria-label="Runs in this bundle">
          <Table<Row>
            caption="Verification evidence per run"
            rows={rows}
            rowKey={(row) => row.run.key}
            empty="This bundle holds no run."
            columns={[
              {
                key: "release",
                header: "RUN",
                rowHeader: true,
                cell: (row) => (
                  <span className="t-mono">
                    {row.release === "" ? row.run.commit : row.release}
                    {row.release === "" ? null : (
                      <span className="con-sub t-mono-sm"> {row.run.commit}</span>
                    )}
                  </span>
                ),
              },
              { key: "date", header: "WHEN", cell: (row) => <span className="t-mono-sm">{row.run.timestamp}</span> },
              {
                key: "verifiable",
                header: "VERIFIABLE",
                align: "end",
                cell: (row) => (
                  <span className="t-mono-sm">
                    {row.run.result.verifiableFunctions} / {row.run.result.changedFunctions}
                  </span>
                ),
              },
              { key: "equivalent", header: "EQUIVALENT", align: "end", cell: (row) => <span className="t-mono-sm">{row.equivalent}</span> },
              { key: "diverged", header: "DIVERGED", align: "end", cell: (row) => <span className="t-mono-sm">{row.diverged}</span> },
              { key: "abstained", header: "ABSTAINED", align: "end", cell: (row) => <span className="t-mono-sm">{row.abstained}</span> },
              {
                key: "rate",
                header: "ABSTAIN RATE",
                align: "end",
                cell: (row) => (
                  <span className="t-mono-sm">{percent(row.abstained, row.run.result.changedFunctions)}</span>
                ),
              },
              {
                key: "signed",
                header: "SIGNED",
                align: "end",
                cell: (row) => (
                  <span className="t-mono-sm">
                    {row.signed} / {row.run.records.length}
                  </span>
                ),
              },
            ]}
          />
        </div>
        <p className="t-body-sm qed-prose con-note">
          A coverage figure without its abstain rate is not reported here, in
          the product or anywhere else. Both are of changed functions, the same
          ratio the home page prints.
        </p>
      </section>
    </div>
  );
}
