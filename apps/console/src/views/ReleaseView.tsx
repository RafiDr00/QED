import { Card, Label, Table } from "@qed/ui";

import { RELEASES, type Release } from "../fixtures.js";

/**
 * Release evidence: what each release could prove, and what it could not.
 * The abstain rate sits beside the coverage figure, never without it.
 */

/*
 * With nothing verifiable there is no rate to report. Printing "0%" would read
 * as "nothing abstained", which is the opposite of what happened.
 */
const NONE = "—";

const rate = (release: Release) =>
  release.verifiable === 0
    ? NONE
    : `${Math.round((release.abstained / release.verifiable) * 100)}%`;

const coverage = (release: Release) =>
  release.changed === 0
    ? NONE
    : `${Math.round((release.verifiable / release.changed) * 100)}%`;

export function ReleaseView() {
  const latest = RELEASES[0];

  return (
    <div className="qed-stack" data-gap="section">
      {latest ? (
        <section aria-labelledby="release-latest">
          <div className="qed-section-heading">
            <h2 id="release-latest" className="t-heading">
              {latest.tag}
            </h2>
          </div>
          <ul className="qed-grid">
            {[
              { label: "VERIFIABLE", value: coverage(latest), note: `${latest.verifiable} of ${latest.changed} changed functions` },
              { label: "ABSTAIN RATE", value: rate(latest), note: `${latest.abstained} of ${latest.verifiable} verifiable functions` },
              { label: "DIVERGENCES", value: String(latest.diverged), note: "each with a minimised counterexample" },
              { label: "ATTESTATIONS", value: String(latest.attestations), note: "signed and logged to Rekor" },
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
        <div className="qed-table-scroll" tabIndex={0} role="group" aria-label="Release history">
          <Table<Release>
            caption="Verification evidence per release"
            rows={RELEASES}
            rowKey={(release) => release.tag}
            empty="No release has been verified yet."
            columns={[
              {
                key: "tag",
                header: "RELEASE",
                rowHeader: true,
                cell: (release) => (
                  <span className="t-mono">
                    {release.tag}
                    <span className="con-sub t-mono-sm"> {release.commit}</span>
                  </span>
                ),
              },
              { key: "date", header: "DATE", cell: (release) => <span className="t-mono-sm">{release.date}</span> },
              { key: "verifiable", header: "VERIFIABLE", align: "end", cell: (release) => <span className="t-mono-sm">{release.verifiable} / {release.changed}</span> },
              { key: "equivalent", header: "EQUIVALENT", align: "end", cell: (release) => <span className="t-mono-sm">{release.equivalent}</span> },
              { key: "diverged", header: "DIVERGED", align: "end", cell: (release) => <span className="t-mono-sm">{release.diverged}</span> },
              { key: "abstained", header: "ABSTAINED", align: "end", cell: (release) => <span className="t-mono-sm">{release.abstained}</span> },
              { key: "rate", header: "ABSTAIN RATE", align: "end", cell: (release) => <span className="t-mono-sm">{rate(release)}</span> },
            ]}
          />
        </div>
        <p className="t-body-sm qed-prose con-note">
          A coverage figure without its abstain rate is not reported here, in
          the product or anywhere else.
        </p>
      </section>
    </div>
  );
}
