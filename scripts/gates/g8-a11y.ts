import { fail, pass, readEvidence, type Gate } from "./kit.ts";

// ======================================================================= G8 a11y

interface AxeEvidence {
  runs: {
    route: string;
    theme: string;
    violations: { id: string; impact: string; nodes: number; help: string }[];
  }[];
}

export const gate: Gate = {
  id: "G8",
  title: "a11y - axe-core reports zero violations on every route, both themes",
  run() {
    const evidence = readEvidence("axe.json") as AxeEvidence | null;
    if (!evidence) return fail(["no .verify/axe.json from the e2e run"]);
    const failures: string[] = [];
    for (const run of evidence.runs) {
      for (const v of run.violations) {
        failures.push(
          `${run.route} (${run.theme}): ${v.id} [${v.impact}] on ${v.nodes} node(s) - ${v.help}`,
        );
      }
    }
    const notes = [`${evidence.runs.length} route/theme combinations scanned`];
    if (evidence.runs.length === 0) failures.push("no routes scanned");
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
