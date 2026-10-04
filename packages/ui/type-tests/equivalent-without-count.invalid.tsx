import type { Verdict } from "@qed/ui";

// EQUIVALENT with no input count is a claim, not a result.
// @qed-expect-error 1
export const verdict: Verdict = { state: "EQUIVALENT" };
