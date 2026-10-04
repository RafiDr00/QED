import type { Verdict } from "@qed/ui";

// DIVERGED with nothing to reproduce is an accusation.
// @qed-expect-error 1
export const verdict: Verdict = { state: "DIVERGED" };
