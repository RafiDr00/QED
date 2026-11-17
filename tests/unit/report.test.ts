// @vitest-environment node
import { describe, expect, it } from "vitest";

import { reDeriveDigest, type AttestationRecord, type FunctionRun, type RunResult } from "@qed/ui/model";

import { annotations, upsertComment, MARKER } from "../../action/github.mjs";
import {
  jsonReport,
  markdownReport,
  sarifReport,
  COMMENT_MARKER,
  type ReportContext,
} from "../../packages/cli/src/report.js";

/**
 * The run as data, as SARIF and as a pull request comment - and what the
 * GitHub action does with them. Each must say what the terminal says, and
 * nothing it does not.
 */

const RUNS: FunctionRun[] = [
  {
    path: "pricing/rate.ts",
    symbol: "rate",
    line: 1,
    verdict: {
      state: "DIVERGED",
      counterexample: {
        input: "10",
        base: "1",
        head: "0.9",
        repro: "qed repro pricing/rate.ts rate --input '[10]'",
        affects: "Diverges exactly when the input is 10. That is 1.5% of generated inputs.",
      },
    },
  },
  {
    path: "pricing/total.ts",
    symbol: "total",
    line: 2,
    via: "pricing/rate.ts",
    verdict: { state: "EQUIVALENT", inputs: 1000 },
  },
  {
    path: "pricing/io.ts",
    symbol: "load",
    line: 3,
    verdict: { state: "ABSTAINED", obstruction: "imports node:fs" },
  },
];

const RESULT: RunResult = {
  command: "qed check --base origin/main",
  changedFunctions: 3,
  verifiableFunctions: 2,
  duration: "1.1s",
  runs: RUNS,
};

async function context(change: Partial<ReportContext> = {}): Promise<ReportContext> {
  const records: AttestationRecord[] = await Promise.all(
    RUNS.map(async (run) => {
      const record: AttestationRecord = {
        symbol: run.symbol,
        path: run.path,
        repository: "acme/ledger",
        commit: "4f2c91a",
        timestamp: "2026-11-17 09:41 UTC",
        verdict: run.verdict,
        inputStrategy: "type-directed, corpus-seeded",
        controls: [],
        tolerances: [],
        engine: "qed 0.5.0",
        signer: "unsigned",
        rekorIndex: "not logged",
        digest: "",
      };
      return { ...record, digest: await reDeriveDigest(record) };
    }),
  );
  return { result: RESULT, records, exitCode: 1, engine: "qed 0.5.0", recordsDir: ".qed/records", ...change };
}

describe("--json", () => {
  it("carries the result, the records and the counts", async () => {
    const report = jsonReport(await context()) as {
      kind: string;
      exitCode: number;
      summary: { diverged: number; equivalent: number; abstained: number };
      records: unknown[];
    };
    expect(report.kind).toBe("qed.check/v1");
    expect(report.exitCode).toBe(1);
    expect(report.summary).toMatchObject({ diverged: 1, equivalent: 1, abstained: 1 });
    expect(report.records).toHaveLength(3);
  });
});

describe("--sarif", () => {
  type Sarif = {
    version: string;
    runs: {
      tool: { driver: { name: string; rules: { id: string }[] } };
      results: {
        ruleId: string;
        level: string;
        message: { text: string };
        locations: { physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } } }[];
      }[];
    }[];
  };

  it("is SARIF 2.1.0 with a rule for each finding it can make", async () => {
    const sarif = sarifReport(await context()) as Sarif;
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.name).toBe("qed");
    expect(sarif.runs[0]?.tool.driver.rules.map((r) => r.id)).toEqual(["qed/diverged", "qed/abstained"]);
  });

  it("makes a divergence an error on the line its function starts, and an abstention a note", async () => {
    const results = (sarifReport(await context()) as Sarif).runs[0]?.results ?? [];
    expect(results.map((r) => [r.ruleId, r.level])).toEqual([
      ["qed/diverged", "error"],
      ["qed/abstained", "note"],
    ]);
    expect(results[0]?.locations[0]?.physicalLocation).toMatchObject({
      artifactLocation: { uri: "pricing/rate.ts" },
      region: { startLine: 1 },
    });
    expect(results[0]?.message.text).toContain("qed repro pricing/rate.ts rate --input '[10]'");
  });

  it("reports nothing for an equivalence: it is not a finding", async () => {
    const results = (sarifReport(await context()) as Sarif).runs[0]?.results ?? [];
    expect(results.some((r) => r.message.text.includes("total"))).toBe(false);
  });
});

describe("--markdown", () => {
  it("leads with what changed behaviour, and carries the marker the action looks for", async () => {
    const md = markdownReport(await context(), "terminal output here");
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(COMMENT_MARKER).toBe(MARKER);
    expect(md).toContain("### ∎ QED: 1 divergence · 1 equivalent · 1 abstained");
    expect(md).toContain("**1 function returns something different now.**");
    // Divergences first in the table, whatever the run order.
    const table = md.split("\n").filter((line) => line.startsWith("| ●") || line.startsWith("| ○"));
    expect(table[0]).toContain("DIVERGED");
    expect(md).toContain("qed repro pricing/rate.ts rate --input '[10]'");
    expect(md).toContain("via `pricing/rate.ts`");
  });

  it("keeps a table cell whole when the value holds a pipe or a backtick", async () => {
    const tricky: FunctionRun = {
      path: "a.ts",
      symbol: "f",
      verdict: {
        state: "DIVERGED",
        counterexample: { input: "\"a|b`c\"", base: "1", head: "2", repro: "qed repro a.ts f --input '[\"a|b`c\"]'" },
      },
    };
    const md = markdownReport(
      await context({ result: { ...RESULT, runs: [tricky] }, records: [] }),
      "",
    );
    const row = md.split("\n").find((line) => line.includes("DIVERGED |")) ?? "";
    expect(row).toContain("a\\|b");
    expect(row).toContain('``"a\\|b`c"``');
    // Three cells, then the closing pipe: no pipe in the value split a cell.
    expect(row.split(/(?<!\\)\|/).length).toBe(5);
  });

  it("says when nothing was verifiable, rather than posting an empty table", async () => {
    const md = markdownReport(
      await context({ result: { ...RESULT, changedFunctions: 0, verifiableFunctions: 0, runs: [] }, records: [], exitCode: 0 }),
      "",
    );
    expect(md).toContain("No verifiable file changed");
    expect(md).not.toContain("| Verdict |");
  });

  it("names the signer when the run was signed, and says so when it was not", async () => {
    const unsigned = markdownReport(await context(), "");
    expect(unsigned).toContain("Unsigned");
    const signed = markdownReport(
      await context({
        signed: { identity: "https://github.com/acme/ledger/.github/workflows/ci.yml@refs/pull/7/merge", issuer: "https://token.actions.githubusercontent.com", logIndex: "123", signer: "x" },
      }),
      "",
    );
    expect(signed).toContain("Signed by `https://github.com/acme/ledger/.github/workflows/ci.yml@refs/pull/7/merge`");
    expect(signed).toContain("Rekor index `123`");
  });
});

describe("the action's annotations", () => {
  it("marks a divergence as an error on its line, and an abstention as a notice", async () => {
    const lines = annotations(jsonReport(await context()) as Parameters<typeof annotations>[0]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^::error file=pricing\/rate\.ts,line=1,title=QED%3A rate diverged::/);
    expect(lines[1]).toMatch(/^::notice file=pricing\/io\.ts,line=3,/);
  });

  it("escapes what would end a workflow command early", async () => {
    const lines = annotations(jsonReport(await context()) as Parameters<typeof annotations>[0]);
    // A newline in a message would end the command; it is %0A instead.
    expect(lines[0]).toContain("%0A");
    expect(lines[0]?.includes("\n")).toBe(false);
  });
});

describe("the action's comment", () => {
  type Call = { url: string; method: string; body?: string };

  /** GitHub's issue comments API, as far as the action uses it. */
  function github(existing: { id: number; body: string }[], status = 200) {
    const calls: Call[] = [];
    const fetch = (url: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      const payload = method === "GET" ? existing : { id: 99 };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: method === "GET" ? 200 : status }));
    };
    return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
  }

  const options = { api: "https://api.github.com", repository: "acme/ledger", issue: 7, token: "t" };

  it("posts one comment when there is none", async () => {
    const api = github([{ id: 1, body: "looks good to me" }]);
    expect(await upsertComment({ ...options, body: `${MARKER}\nhello`, fetch: api.fetch })).toBe("posted a comment");
    expect(api.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(api.calls[1]?.url).toBe("https://api.github.com/repos/acme/ledger/issues/7/comments");
  });

  it("updates its own comment rather than adding another on every push", async () => {
    const api = github([{ id: 1, body: "looks good to me" }, { id: 42, body: `${MARKER}\nold` }]);
    expect(await upsertComment({ ...options, body: `${MARKER}\nnew`, fetch: api.fetch })).toBe("updated comment 42");
    expect(api.calls[1]).toMatchObject({ method: "PATCH", url: "https://api.github.com/repos/acme/ledger/issues/comments/42" });
  });

  it("reports a token that may not comment, and does not throw", async () => {
    const api = github([], 403);
    const outcome = await upsertComment({ ...options, body: "hello", fetch: api.fetch });
    expect(outcome).toContain("HTTP 403");
    expect(outcome).toContain("fork");
  });
});
