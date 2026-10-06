import { fail, pass, readEvidence, type Gate } from "./kit.ts";

// ========================================================= G7 verdict integrity

interface TypeTestEvidence {
  invalid: { file: string; expectedErrors: number; actualErrors: number }[];
  valid: { file: string; errors: number }[];
}

export const gate: Gate = {
  id: "G7",
  title: "Verdict integrity - evidence-free verdicts cannot be constructed",
  run() {
    const evidence = readEvidence("type-tests.json") as TypeTestEvidence | null;
    if (!evidence) {
      return fail(["no .verify/type-tests.json - run scripts/type-tests.ts"]);
    }
    const failures: string[] = [];
    const notes: string[] = [];

    for (const t of evidence.invalid) {
      if (t.actualErrors < t.expectedErrors) {
        failures.push(
          `${t.file}: ${t.actualErrors} type errors, expected at least ${t.expectedErrors} - it must not type-check`,
        );
      } else {
        notes.push(`${t.file}: rejected by the compiler (${t.actualErrors} errors)`);
      }
    }
    for (const t of evidence.valid) {
      if (t.errors > 0) {
        failures.push(`${t.file}: a legal verdict failed to type-check (${t.errors} errors)`);
      }
    }
    if (evidence.invalid.length === 0) {
      failures.push("no negative type tests found - G7 would be vacuous");
    }
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
