import { VerdictTable, formatCount, type BundleRun } from "@qed/ui";

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
    </div>
  );
}
