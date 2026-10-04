import type { Verdict } from "@qed/ui";

// "Could not verify" is exactly what the README forbids.
// @qed-expect-error 1
export const verdict: Verdict = { state: "ABSTAINED" };
