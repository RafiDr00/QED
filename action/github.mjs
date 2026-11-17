#!/usr/bin/env node
/**
 * What the QED action does on GitHub once `qed check` has written its report:
 * annotate the changed lines, and keep one comment on the pull request up to
 * date.
 *
 * Plain JavaScript with no dependencies, because a composite action runs it
 * with whatever Node the runner has and nothing installed.
 *
 *   node github.mjs annotate <report.json>
 *   node github.mjs comment <comment.md>
 *     needs GITHUB_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, PR_NUMBER
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Finds the comment this action wrote before, so it is updated, not repeated. */
export const MARKER = "<!-- qed-check -->";

/** A workflow command's message: %, CR and LF escaped as GitHub requires. */
const escapeData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** A workflow command's property: the message escapes, plus : and ,. */
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * One workflow command per finding: `::error` on the line a divergence
 * starts on, `::notice` where a function was not verified. GitHub draws them
 * on the pull request's diff, with no code scanning set up.
 *
 * @param {{ result: { runs: Array<{ path: string, symbol: string, line?: number, via?: string,
 *   verdict: { state: string, obstruction?: string,
 *   counterexample?: { input: string, base: string, head: string, repro: string, affects?: string } } }> } }} report
 * @returns {string[]}
 */
export function annotations(report) {
  const out = [];
  for (const run of report.result.runs) {
    const { verdict } = run;
    if (verdict.state === "EQUIVALENT") continue;
    const properties = [`file=${escapeProperty(run.path)}`];
    if (run.line !== undefined) properties.push(`line=${run.line}`);
    if (verdict.state === "DIVERGED" && verdict.counterexample) {
      const c = verdict.counterexample;
      properties.push(`title=${escapeProperty(`QED: ${run.symbol} diverged`)}`);
      const message = [
        `On input ${c.input} the base returned ${c.base} and the head returned ${c.head}.`,
        ...(c.affects ? [c.affects] : []),
        ...(run.via ? [`This file did not change; ${run.via}, which it imports, did.`] : []),
        `Reproduce: ${c.repro}`,
      ].join("\n");
      out.push(`::error ${properties.join(",")}::${escapeData(message)}`);
    } else if (verdict.state === "ABSTAINED") {
      properties.push(`title=${escapeProperty(`QED: ${run.symbol} not verified`)}`);
      out.push(`::notice ${properties.join(",")}::${escapeData(`It ${verdict.obstruction ?? "could not be run"}.`)}`);
    }
  }
  return out;
}

/**
 * Creates the comment, or updates the one this action wrote before.
 *
 * Returns what happened, for the log. A token that may not comment - a pull
 * request from a fork gets a read-only one - is reported, not thrown: a
 * missing comment must not fail the check it describes.
 *
 * @param {{ api: string, repository: string, issue: number, token: string, body: string,
 *   fetch?: typeof globalThis.fetch }} options
 * @returns {Promise<string>}
 */
export async function upsertComment({ api, repository, issue, token, body, fetch = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const base = `${api}/repos/${repository}/issues`;
  const content = body.includes(MARKER) ? body : `${MARKER}\n${body}`;

  let existing;
  for (let page = 1; page <= 10 && existing === undefined; page++) {
    const response = await fetch(`${base}/${issue}/comments?per_page=100&page=${page}`, { headers });
    if (!response.ok) return `could not read the pull request's comments (HTTP ${response.status})`;
    const comments = await response.json();
    existing = comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER));
    if (comments.length < 100) break;
  }

  const response = existing
    ? await fetch(`${base}/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body: content }) })
    : await fetch(`${base}/${issue}/comments`, { method: "POST", headers, body: JSON.stringify({ body: content }) });
  if (!response.ok) {
    return `could not ${existing ? "update" : "post"} the comment (HTTP ${response.status}); ` +
      "a pull request from a fork gets a token that cannot comment";
  }
  return existing ? `updated comment ${existing.id}` : "posted a comment";
}

async function main(argv, env) {
  const [command, file] = argv;
  if (command === "annotate" && file) {
    for (const line of annotations(JSON.parse(readFileSync(file, "utf8")))) process.stdout.write(`${line}\n`);
    return 0;
  }
  if (command === "comment" && file) {
    const issue = Number(env.PR_NUMBER);
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !Number.isInteger(issue) || issue <= 0) {
      process.stdout.write("qed: not a pull request with a token, so no comment\n");
      return 0;
    }
    const outcome = await upsertComment({
      api: env.GITHUB_API_URL ?? "https://api.github.com",
      repository: env.GITHUB_REPOSITORY,
      issue,
      token: env.GITHUB_TOKEN,
      body: readFileSync(file, "utf8"),
    });
    process.stdout.write(`qed: ${outcome}\n`);
    return 0;
  }
  process.stderr.write("usage: github.mjs annotate <report.json> | comment <comment.md>\n");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stdout.write(`::warning::qed could not reach GitHub: ${escapeData(error?.message ?? error)}\n`);
    },
  );
}
