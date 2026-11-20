import { VerdictTable, formatCount, type BundleRun } from "@qed/ui";

import { DivergenceMap } from "./DivergenceMap.js";

/** Every function in the newest run, with its evidence in the third column. */
export function VerdictsView({ run }: { run: BundleRun }) {
  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="verdicts-all">
        <div className="qed-section-heading">
          <h2 id="verdicts-all" className="t-heading">
            This run
          </h2>
        </div>
        <VerdictTable
          caption={`Verdicts for ${run.repository} @ ${run.commit}, ${run.timestamp}`}
          runs={run.result.runs}
          empty={`${formatCount(run.result.changedFunctions)} functions changed. None could be run soundly, so none has a verdict.`}
        />
      </section>

      {run.result.runs.some((r) => r.verdict.state === "DIVERGED" && r.verdict.counterexample.sample) ? (
        <section aria-labelledby="verdicts-where">
          <div className="qed-section-heading">
            <h2 id="verdicts-where" className="t-heading">
              Where each divergence bites
            </h2>
          </div>
          {run.result.runs.map((r) =>
            r.verdict.state === "DIVERGED" && r.verdict.counterexample.sample ? (
              <div key={`${r.path}:${r.symbol}`}>
                <h3 className="t-mono con-map-title">
                  {r.path} {r.symbol}
                </h3>
                {r.verdict.counterexample.affects !== undefined ? (
                  <p className="t-body-sm qed-prose con-note">{r.verdict.counterexample.affects}</p>
                ) : null}
                <DivergenceMap symbol={r.symbol} sample={r.verdict.counterexample.sample} />
              </div>
            ) : null,
          )}
        </section>
      ) : null}
    </div>
  );
}
