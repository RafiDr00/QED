import { Card, Label, TerminalOutput, summarise } from "@qed/ui";

import { CURRENT_RUN, EMPTY_RUN } from "../fixtures.js";

/** The run as the engine printed it, with the counts beside it. */
export function RunView() {
  const summary = summarise(CURRENT_RUN);

  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="run-output">
        <h2 id="run-output" className="qed-visually-hidden">
          Command output
        </h2>
        <TerminalOutput result={CURRENT_RUN} />
      </section>

      <section aria-labelledby="run-counts">
        <div className="qed-section-heading">
          <h2 id="run-counts" className="t-heading">
            Counts
          </h2>
        </div>
        <ul className="qed-grid">
          {[
            { label: "EQUIVALENT", value: summary.equivalent },
            { label: "DIVERGED", value: summary.diverged },
            { label: "ABSTAINED", value: summary.abstained },
            { label: "EXIT CODE", value: summary.exitCode },
          ].map((item) => (
            <li key={item.label}>
              <Card as="div">
                <p className="t-numeral">{item.value}</p>
                <p className="con-count-label">
                  <Label>{item.label}</Label>
                </p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="t-body-sm qed-prose con-note">
          Exit is non-zero only on DIVERGED. Two functions abstained, and that
          did not fail the build.
        </p>
      </section>

      <section aria-labelledby="run-empty">
        <div className="qed-section-heading">
          <h2 id="run-empty" className="t-heading">
            A run with nothing verifiable
          </h2>
        </div>
        <p className="t-body-sm qed-prose con-note">
          {EMPTY_RUN.changedFunctions} functions changed and none could be run
          soundly. The output still prints all three counts, including the
          zeros, and exits 0 - abstaining is not a failure.
        </p>
        <TerminalOutput result={EMPTY_RUN} banner={false} label="empty run output" />
      </section>
    </div>
  );
}
