import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { runPair, type ModulePair } from "../../packages/engine/src/index.ts";
import { fail, pass, rel, root, verifyDir, walk, type Gate } from "./kit.ts";

// ============================================================== G11 dogfood

/**
 * Every exported function in QED's own packages, verified against itself.
 *
 * Two claims, both about the engine rather than about any diff:
 *
 * - **Nothing diverges from itself.** A function compared with its own source
 *   cannot differ. A DIVERGED here means the engine reported a difference that
 *   does not exist - nondeterminism leaking past the controls, or a comparison
 *   that cannot tell a value from itself. That is the one result the gate
 *   never tolerates.
 * - **The reach does not shrink.** The count of functions QED can verify in
 *   its own code is a floor. Raising it is the point of the engine work;
 *   lowering it has to be done here, on purpose, with the reason beside it.
 *
 * What the gate does not catch: a false EQUIVALENT between two *different*
 * versions. Self-comparison cannot see one. That is what
 * tests/unit/soundness.test.ts is for.
 */

/** Functions QED verified in its own packages when this floor was last set. */
const VERIFIED_FLOOR = 18;

/** Inputs per function. Enough to exercise determinism, cheap enough to run every time. */
const INPUTS = 100;

const read = (path: string): string | undefined => {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
};

export const gate: Gate = {
  id: "G11",
  title: "Dogfood - QED verifies its own packages, and nothing diverges from itself",
  run() {
    const files = walk(join(root, "packages"), (path) => {
      const ext = extname(path);
      return (
        (ext === ".ts" || ext === ".tsx") &&
        !path.endsWith(".d.ts") &&
        /[\\/]src[\\/]/.test(path) &&
        !/[\\/]generated[\\/]/.test(path)
      );
    }).map(rel);

    const modules: ModulePair[] = files.map((path) => {
      const text = read(path) ?? "";
      return { path, base: text, head: text };
    });

    const started = Date.now();
    const { result } = runPair(modules, {
      inputs: INPUTS,
      readBase: read,
      readHead: read,
      budgetMs: 10_000,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const counts = { EQUIVALENT: 0, DIVERGED: 0, ABSTAINED: 0 };
    const reasons = new Map<string, number>();
    const failures: string[] = [];
    for (const run of result.runs) {
      counts[run.verdict.state]++;
      if (run.verdict.state === "ABSTAINED") {
        reasons.set(run.verdict.obstruction, (reasons.get(run.verdict.obstruction) ?? 0) + 1);
      }
      if (run.verdict.state === "DIVERGED") {
        const c = run.verdict.counterexample;
        failures.push(
          `${run.path} ${run.symbol} diverged from itself: input ${c.input}, base ${c.base}, head ${c.head}`,
        );
      }
    }

    if (counts.EQUIVALENT < VERIFIED_FLOOR) {
      failures.push(
        `verified ${counts.EQUIVALENT} functions, below the floor of ${VERIFIED_FLOOR}. ` +
          `Something the engine could verify, it no longer can.`,
      );
    }

    const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
    mkdirSync(verifyDir, { recursive: true });
    writeFileSync(
      join(verifyDir, "dogfood.json"),
      `${JSON.stringify(
        {
          files: files.length,
          functions: result.runs.length,
          ...counts,
          floor: VERIFIED_FLOOR,
          inputs: INPUTS,
          seconds: Number(seconds),
          abstainReasons: Object.fromEntries(topReasons),
          runs: result.runs.map((r) => ({ path: r.path, symbol: r.symbol, verdict: r.verdict })),
        },
        null,
        2,
      )}\n`,
    );

    const notes = [
      `${counts.EQUIVALENT} of ${result.runs.length} functions in ${files.length} files verified against themselves in ${seconds}s (floor ${VERIFIED_FLOOR})`,
      `${counts.ABSTAINED} abstained; most common: ${topReasons
        .slice(0, 3)
        .map(([reason, n]) => `${reason} (${n})`)
        .join("; ")}`,
    ];
    if (counts.EQUIVALENT > VERIFIED_FLOOR) {
      notes.push(`the floor can be raised to ${counts.EQUIVALENT}`);
    }
    return failures.length > 0 ? fail(failures, notes) : pass(notes);
  },
};
