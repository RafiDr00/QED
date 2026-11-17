import { Card, Label, TerminalOutput, formatCount, summarise, type BundleRun } from "@qed/ui";

/** The newest run as the engine printed it, with the counts beside it. */
export function RunView({ run }: { run: BundleRun }) {
  const summary = summarise(run.result);

  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="run-output">
        <h2 id="run-output" className="qed-visually-hidden">
          Command output
        </h2>
        <p className="t-body-sm qed-prose con-note">
          {run.repository} @ {run.commit} &middot; {run.timestamp} &middot; {run.engine}
        </p>
        <TerminalOutput result={run.result} />
        {run.summarised ? null : (
          <p className="t-body-sm qed-prose con-note">
            These records came without a summary of the run, so the command and
            how long it took are not recorded. The counts are the records&rsquo;.
          </p>
        )}
        {run.missing.length === 0 ? null : (
          <p className="t-body-sm qed-prose con-refusal" role="note">
            The run&rsquo;s summary lists {formatCount(run.missing.length)}{" "}
            {run.missing.length === 1 ? "record" : "records"} this bundle does
            not hold. The counts above are of the records it does hold.
          </p>
        )}
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
          Exit is non-zero only on DIVERGED.{" "}
          {summary.abstained === 0
            ? "Nothing abstained."
            : `${formatCount(summary.abstained)} ${summary.abstained === 1 ? "function" : "functions"} abstained, and that did not fail the build.`}
        </p>
      </section>
    </div>
  );
}
