/**
 * Compiles packages/ui/type-tests one file at a time.
 *
 * `*.invalid.tsx` must fail. `*.valid.tsx` must pass. Writes the result to
 * .verify/type-tests.json for gate G7, which is how "EQUIVALENT without a
 * count must not compile" becomes a machine-checked claim rather than a
 * comment.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "packages/ui/type-tests");
const outDir = join(root, ".verify");

const TSC_FLAGS = [
  "--noEmit",
  "--strict",
  "--noUncheckedIndexedAccess",
  "--exactOptionalPropertyTypes",
  "--target",
  "ES2022",
  "--module",
  "ESNext",
  "--moduleResolution",
  "bundler",
  "--jsx",
  "react-jsx",
  "--skipLibCheck",
  "--types",
  "node",
];

interface Outcome {
  file: string;
  errors: number;
  messages: string[];
  /** Resolution failures, which never count as a type error. */
  infrastructure: string[];
}

const INFRASTRUCTURE_CODES = ["TS6053", "TS2307", "TS5083", "TS18003"];

/** Invoked without a shell: this repository's path contains a space. */
const TSC_BIN = join(root, "node_modules/typescript/bin/tsc");

function compile(file: string): Outcome {
  const result = spawnSync(
    process.execPath,
    [TSC_BIN, ...TSC_FLAGS, join(dir, file)],
    { cwd: root, encoding: "utf8" },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const all = output
    .split(/\r?\n/)
    .filter((line) => /error TS\d+/.test(line) && line.includes(file));

  // A missing file or an unresolved import also "fails to compile", and would
  // make every negative test pass for no reason at all. Only real type errors
  // count; anything else is a broken harness and fails the run.
  const infrastructure = all.filter((line) =>
    INFRASTRUCTURE_CODES.some((code) => line.includes(code)),
  );
  const messages = all.filter((line) => !infrastructure.includes(line));
  return { file, errors: messages.length, messages, infrastructure };
}

function main(): void {
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  let broken = 0;
  const invalid: { file: string; expectedErrors: number; actualErrors: number }[] =
    [];
  const valid: { file: string; errors: number }[] = [];

  for (const file of files.sort()) {
    const outcome = compile(file);

    if (outcome.infrastructure.length > 0) {
      broken++;
      process.stdout.write(`SETUP BROKEN  ${file}\n`);
      for (const line of outcome.infrastructure) {
        process.stdout.write(`    ${line}\n`);
      }
    }

    if (file.endsWith(".invalid.tsx")) {
      invalid.push({ file, expectedErrors: 1, actualErrors: outcome.errors });
      const code = /error (TS\d+)/.exec(outcome.messages[0] ?? "")?.[1] ?? "none";
      process.stdout.write(
        `${outcome.errors > 0 ? "rejected" : "ACCEPTED (bad)"}  ${file}  ${code}\n`,
      );
    } else {
      valid.push({ file, errors: outcome.errors });
      process.stdout.write(
        `${outcome.errors === 0 ? "compiled" : "FAILED (bad)"}  ${file}\n`,
      );
      for (const message of outcome.messages) process.stdout.write(`    ${message}\n`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "type-tests.json"),
    `${JSON.stringify({ invalid, valid }, null, 2)}\n`,
    "utf8",
  );

  const bad =
    invalid.filter((t) => t.actualErrors === 0).length +
    valid.filter((t) => t.errors > 0).length +
    broken;
  process.stdout.write(
    `\n${invalid.length} negative, ${valid.length} positive, ${bad} wrong\n`,
  );
  if (bad > 0) process.exit(1);
}

main();
