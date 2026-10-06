/**
 * `pnpm verify` - the definition of done.
 *
 * Ten gates, machine-checked. Each lives in its own file under gates/ with the
 * reasoning for its exemptions beside it; this file only decides what to run
 * and reports what came back.
 *
 * Flags:
 *   --no-run        evaluate gates against existing build + evidence
 *   --only=G1,G4    run a subset
 */
import { spawnSync } from "node:child_process";

import type { Gate, GateResult } from "./gates/kit.ts";
import { gate as g1 } from "./gates/g1-contrast.ts";
import { gate as g2 } from "./gates/g2-purity.ts";
import { gate as g3 } from "./gates/g3-grid.ts";
import { gate as g4 } from "./gates/g4-logo.ts";
import { gate as g5 } from "./gates/g5-optics.ts";
import { gate as g6 } from "./gates/g6-parity.ts";
import { gate as g7 } from "./gates/g7-verdicts.ts";
import { gate as g8 } from "./gates/g8-a11y.ts";
import { gate as g9 } from "./gates/g9-budget.ts";
import { gate as g10 } from "./gates/g10-print.ts";

const root = process.cwd();

const args = process.argv.slice(2);
const noRun = args.includes("--no-run");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()))
  : null;

const fail = (failures: string[]): GateResult => ({
  ok: false,
  notes: [],
  failures,
});

const gates: Gate[] = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10];

function run(label: string, command: string, commandArgs: string[]): boolean {
  process.stdout.write(`\n  -> ${label}: ${command} ${commandArgs.join(" ")}\n`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: root,
  });
  return result.status === 0;
}

function main(): void {
  const started = Date.now();
  process.stdout.write("QED verify\n==========\n");

  const prerequisiteFailures: string[] = [];
  if (!noRun && !only) {
    const steps: [string, string, string[]][] = [
      ["build", "pnpm", ["build"]],
      ["typecheck", "pnpm", ["typecheck"]],
      ["lint", "pnpm", ["lint"]],
      ["unit tests", "pnpm", ["test"]],
      ["type tests", "pnpm", ["exec", "tsx", "scripts/type-tests.ts"]],
      ["e2e + evidence", "pnpm", ["e2e"]],
    ];
    for (const [label, cmd, cmdArgs] of steps) {
      if (!run(label, cmd, cmdArgs)) {
        prerequisiteFailures.push(label);
        if (label === "build") break;
      }
    }
  }

  process.stdout.write("\nGates\n-----\n");
  const results: { gate: Gate; result: GateResult }[] = [];
  for (const gate of gates) {
    if (only && !only.has(gate.id)) continue;
    let result: GateResult;
    try {
      result = gate.run();
    } catch (error) {
      result = fail([`${gate.id} threw: ${String(error)}`]);
    }
    results.push({ gate, result });
    process.stdout.write(
      `${result.ok ? "PASS" : "FAIL"}  ${gate.id}  ${gate.title}\n`,
    );
    for (const note of result.notes) process.stdout.write(`        . ${note}\n`);
    for (const f of result.failures) process.stdout.write(`        X ${f}\n`);
  }

  const failed = results.filter((r) => !r.result.ok);
  const seconds = Math.round((Date.now() - started) / 1000);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} gates passed in ${seconds}s\n`,
  );
  if (prerequisiteFailures.length > 0) {
    process.stdout.write(`failed steps: ${prerequisiteFailures.join(", ")}\n`);
  }
  if (failed.length > 0 || prerequisiteFailures.length > 0) {
    process.stdout.write("\nverify: FAILED\n");
    process.exit(1);
  }
  process.stdout.write("\nverify: OK\n");
}

main();
