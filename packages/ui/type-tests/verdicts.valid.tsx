import { VerdictChip, type Verdict } from "@qed/ui";

export const equivalent: Verdict = { state: "EQUIVALENT", inputs: 18402 };

export const diverged: Verdict = {
  state: "DIVERGED",
  counterexample: {
    input: '{ qty: 100, tier: "gold" }',
    base: "0.85",
    head: "0.8",
    repro: "qed repro 9f2a1c",
  },
};

export const abstained: Verdict = {
  state: "ABSTAINED",
  obstruction: "opens a database connection",
};

export const chips = (
  <>
    <VerdictChip verdict={equivalent} />
    <VerdictChip verdict={diverged} />
    <VerdictChip verdict={abstained} bare />
  </>
);
