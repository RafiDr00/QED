import { VerdictTable } from "@qed/ui";

import { EMPTY_RUN, VERDICT_ROWS } from "../fixtures.js";

/** Every function in the run, with its evidence in the third column. */
export function VerdictsView() {
  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="verdicts-all">
        <div className="qed-section-heading">
          <h2 id="verdicts-all" className="t-heading">
            This run
          </h2>
        </div>
        <VerdictTable caption="Verdicts for this run" runs={VERDICT_ROWS} />
      </section>

      <section aria-labelledby="verdicts-empty">
        <div className="qed-section-heading">
          <h2 id="verdicts-empty" className="t-heading">
            Nothing verifiable
          </h2>
        </div>
        <VerdictTable caption="A run with no verifiable function" runs={EMPTY_RUN.runs} />
      </section>
    </div>
  );
}
