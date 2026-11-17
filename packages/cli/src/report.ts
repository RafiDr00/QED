import {
  evidenceLine,
  formatCount,
  summarise,
  TERMINAL_GLYPH,
  type AttestationRecord,
  type FunctionRun,
  type RunResult,
} from "@qed/ui/model";

import type { SignatureFacts } from "./signing.js";

/**
 * The run, for machines and for pull requests.
 *
 * The terminal output is for a person reading a log. A CI system needs the
 * same run as data (`--json`), GitHub code scanning needs it as SARIF
 * (`--sarif`), and a reviewer needs it where they already are, on the pull
 * request (`--markdown`). All three are built from the same result and the
 * same records, so none of them can say something the others do not.
 * DECISIONS.md D-064.
 */

const INFORMATION_URI = "https://rafidr00.github.io/QED/";
const HELP_URI = "https://rafidr00.github.io/QED/docs/";

export interface ReportContext {
  readonly result: RunResult;
  /** One per run, in the same order. */
  readonly records: readonly AttestationRecord[];
  readonly exitCode: number;
  /** "qed 0.5.0". */
  readonly engine: string;
  /** Where the records were written, as the reader should see it. */
  readonly recordsDir: string;
  readonly signed?: SignatureFacts;
  /** A link to the CI run, when there is one. */
  readonly runUrl?: string;
}

/* ------------------------------------------------------------------ JSON */

export function jsonReport(ctx: ReportContext): unknown {
  return {
    kind: "qed.check/v1",
    engine: ctx.engine,
    exitCode: ctx.exitCode,
    summary: summarise(ctx.result),
    result: ctx.result,
    records: ctx.records,
    recordsDir: ctx.recordsDir,
    ...(ctx.signed
      ? {
          signed: {
            identity: ctx.signed.identity,
            issuer: ctx.signed.issuer,
            rekorIndex: ctx.signed.logIndex,
          },
        }
      : {}),
  };
}

/* ----------------------------------------------------------------- SARIF */

const RULES = [
  {
    id: "qed/diverged",
    name: "Diverged",
    shortDescription: { text: "The changed function returns something different for an input." },
    fullDescription: {
      text:
        "QED ran the old and new versions of this function on the same generated inputs and found one " +
        "where they disagree. The message carries the minimised input, both results and the command " +
        "that reproduces it. A change that was meant is still a change a reviewer should see.",
    },
    helpUri: HELP_URI,
    defaultConfiguration: { level: "error" },
  },
  {
    id: "qed/abstained",
    name: "Abstained",
    shortDescription: { text: "QED could not verify this function, and says why." },
    fullDescription: {
      text:
        "The function could not be run soundly - it reads the clock, a random number or an import, or " +
        "its parameters cannot be generated - so QED made no claim about it. Abstaining never fails a build.",
    },
    helpUri: HELP_URI,
    defaultConfiguration: { level: "note" },
  },
] as const;

function sarifMessage(run: FunctionRun): string {
  switch (run.verdict.state) {
    case "DIVERGED": {
      const c = run.verdict.counterexample;
      return [
        `${run.symbol} diverged. On input ${c.input} the base returned ${c.base} and the head returned ${c.head}.`,
        ...(c.affects !== undefined ? [c.affects] : []),
        ...(run.via !== undefined ? [`This file did not change; ${run.via}, which it imports, did.`] : []),
        `Reproduce it: ${c.repro}`,
      ].join(" ");
    }
    case "ABSTAINED":
      return `${run.symbol} was not verified: it ${run.verdict.obstruction}.`;
    case "EQUIVALENT":
      return `${run.symbol} is equivalent on ${evidenceLine(run.verdict)}.`;
  }
}

/**
 * SARIF 2.1.0, as GitHub code scanning reads it. A divergence is an error on
 * the line the function starts on; an abstention is a note there. An
 * equivalence is not a finding, so it is not reported.
 */
export function sarifReport(ctx: ReportContext): unknown {
  const results = ctx.result.runs.flatMap((run, i) => {
    if (run.verdict.state === "EQUIVALENT") return [];
    const record = ctx.records[i];
    const diverged = run.verdict.state === "DIVERGED";
    return [
      {
        ruleId: diverged ? "qed/diverged" : "qed/abstained",
        ruleIndex: diverged ? 0 : 1,
        level: diverged ? "error" : "note",
        message: { text: sarifMessage(run) },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: run.path, uriBaseId: "%SRCROOT%" },
              ...(run.line !== undefined ? { region: { startLine: run.line } } : {}),
            },
            logicalLocations: [{ name: run.symbol, kind: "function" }],
          },
        ],
        // Stable across runs for the same function and finding, so code
        // scanning tracks one alert rather than opening a new one each push.
        partialFingerprints: { "qedFunction/v1": `${run.path}:${run.symbol}:${run.verdict.state}` },
        properties: {
          verdict: run.verdict.state,
          ...(record ? { digest: record.digest } : {}),
          ...(run.via !== undefined ? { via: run.via } : {}),
        },
      },
    ];
  });

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "qed",
            semanticVersion: ctx.engine.replace(/^qed /, ""),
            informationUri: INFORMATION_URI,
            rules: RULES,
          },
        },
        invocations: [{ commandLine: ctx.result.command, executionSuccessful: true }],
        results,
      },
    ],
  };
}

/* -------------------------------------------------------------- Markdown */

/** The marker a CI step finds its own comment by, to update rather than add. */
export const COMMENT_MARKER = "<!-- qed-check -->";

/** A code span that survives any backticks inside it, and a table cell's pipes. */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`.replace(/\|/g, "\\|");
}

/** Text for a table cell: pipes escaped, newlines flattened. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const MAX_ROWS = 100;
const MAX_OUTPUT = 30_000;

/** Divergences first: they are what a reviewer has to look at. Otherwise run order. */
function ordered(runs: readonly FunctionRun[]): FunctionRun[] {
  const rank = { DIVERGED: 0, ABSTAINED: 1, EQUIVALENT: 2 } as const;
  return runs
    .map((run, i) => ({ run, i }))
    .sort((a, b) => rank[a.run.verdict.state] - rank[b.run.verdict.state] || a.i - b.i)
    .map(({ run }) => run);
}

function evidenceCell(run: FunctionRun): string {
  switch (run.verdict.state) {
    case "DIVERGED": {
      const c = run.verdict.counterexample;
      return `${code(c.input)} → base ${code(c.base)}, head ${code(c.head)}`;
    }
    case "EQUIVALENT":
      return cell(evidenceLine(run.verdict));
    case "ABSTAINED":
      return cell(run.verdict.obstruction);
  }
}

/**
 * The pull request comment: what changed behaviour first, then everything
 * else, then the terminal output as the CI log printed it.
 *
 * `plain` is the uncoloured terminal output, which the comment reproduces
 * rather than re-describes.
 */
export function markdownReport(ctx: ReportContext, plain: string): string {
  const summary = summarise(ctx.result);
  const { result } = ctx;
  const counts =
    `${formatCount(summary.diverged)} ${summary.diverged === 1 ? "divergence" : "divergences"} · ` +
    `${formatCount(summary.equivalent)} equivalent · ${formatCount(summary.abstained)} abstained`;

  const lines: string[] = [COMMENT_MARKER, `### ∎ QED: ${counts}`, ""];
  lines.push(
    `${code(result.command)} · ${formatCount(result.changedFunctions)} functions changed · ` +
      `${formatCount(result.verifiableFunctions)} verifiable · ${result.duration} · exit ${ctx.exitCode}`,
    "",
  );

  if (summary.diverged > 0) {
    lines.push(
      `**${formatCount(summary.diverged)} ${summary.diverged === 1 ? "function returns" : "functions return"} something different now.** ` +
        "If that was meant, this is the evidence for the review. If not, the input below reproduces it.",
      "",
    );
  } else if (result.runs.length > 0) {
    lines.push("No function returns anything different on the inputs tried.", "");
  } else {
    lines.push("No verifiable file changed, so there was nothing to compare.", "");
  }

  const rows = ordered(result.runs);
  if (rows.length > 0) {
    lines.push("| Verdict | Function | Evidence |", "| --- | --- | --- |");
    for (const run of rows.slice(0, MAX_ROWS)) {
      const where = `${code(run.path)} ${code(run.symbol)}${run.via !== undefined ? ` via ${code(run.via)}` : ""}`;
      lines.push(`| ${TERMINAL_GLYPH[run.verdict.state]} ${run.verdict.state} | ${where} | ${evidenceCell(run)} |`);
    }
    if (rows.length > MAX_ROWS) {
      lines.push("", `…and ${formatCount(rows.length - MAX_ROWS)} more, in the records and the terminal output below.`);
    }
    lines.push("");
  }

  for (const run of rows) {
    if (run.verdict.state !== "DIVERGED") continue;
    const c = run.verdict.counterexample;
    lines.push(
      `<details><summary>Reproduce <code>${run.symbol}</code></summary>`,
      "",
      "```sh",
      c.repro,
      "```",
      "",
      ...(c.affects !== undefined ? [c.affects, ""] : []),
      "</details>",
      "",
    );
  }

  if (ctx.signed) {
    lines.push(
      `Signed by ${code(ctx.signed.identity)} and logged at Rekor index ${code(ctx.signed.logIndex)}. ` +
        `Check any record offline with ${code("qed verify --digest <digest> --signer <identity>")}.`,
    );
  } else {
    lines.push(`Unsigned: run with ${code("qed check --sign")} in CI to sign the records.`);
  }
  lines.push(
    "",
    `${formatCount(ctx.records.length)} ${ctx.records.length === 1 ? "record" : "records"} written to ${code(ctx.recordsDir)}` +
      (ctx.runUrl !== undefined ? ` · [run log](${ctx.runUrl})` : "") +
      ".",
    "",
  );

  const output = plain.length > MAX_OUTPUT ? `${plain.slice(0, MAX_OUTPUT)}\n… (truncated; the full output is in the run log)` : plain;
  lines.push("<details><summary>Terminal output</summary>", "", "```text", output.trimEnd(), "```", "", "</details>", "");
  return lines.join("\n");
}
