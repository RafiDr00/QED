import type { Verdict } from "@qed/ui";

// The engine produces no confidence, and a number between 0 and 1 would
// invite the probabilistic reading the product exists to replace.
export const verdict: Verdict = {
  state: "EQUIVALENT",
  inputs: 18402,
  confidence: 0.98,
};
