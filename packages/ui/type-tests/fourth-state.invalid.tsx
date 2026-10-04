import type { Verdict } from "@qed/ui";

// Three states. Never a fourth.
// @qed-expect-error 1
export const verdict: Verdict = { state: "LIKELY_EQUIVALENT", inputs: 10 };
