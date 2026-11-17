// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseBundle,
  reDeriveDigest,
  runManifest,
  runsOf,
  serialiseBundle,
  signedRunFor,
  signingSubject,
  BUNDLE_KIND,
  RUN_SUMMARY_KIND,
  SIGNED_RUN_KIND,
  type AttestationRecord,
  type QedBundle,
  type RunInvocation,
} from "@qed/ui/model";

import { buildBundle, runSummary, writeBundle, writeRunSummary } from "../../packages/cli/src/export.js";
import { writeRecords, UNSIGNED, NOT_LOGGED } from "../../packages/cli/src/records.js";

/**
 * The audit bundle: what the console reads, and what `qed export` writes.
 *
 * The console's numbers used to be typed in. They now come from here, so
 * this is where it is proved that they come from the records - and that a
 * summary, which nothing signs, cannot change them.
 */

async function record(symbol: string, change: Partial<AttestationRecord> = {}): Promise<AttestationRecord> {
  const base: AttestationRecord = {
    symbol,
    path: "billing/ledger.ts",
    repository: "acme/ledger",
    commit: "4f2c91a",
    timestamp: "2026-11-17 09:41 UTC",
    verdict: { state: "EQUIVALENT", inputs: 1000, strategy: "type-directed, corpus-seeded" },
    inputStrategy: "type-directed, corpus-seeded",
    controls: ["clock frozen at 2026-10-04 09:41 UTC"],
    tolerances: [],
    engine: "qed 0.4.0",
    signer: UNSIGNED,
    rekorIndex: NOT_LOGGED,
    digest: "",
    ...change,
  };
  return { ...base, digest: await reDeriveDigest(base) };
}

function bundleOf(
  records: AttestationRecord[],
  runs: RunInvocation[] = [],
  extra: Partial<QedBundle> = {},
): QedBundle {
  return {
    kind: BUNDLE_KIND,
    repository: "acme/ledger",
    runs,
    records,
    signatures: [],
    tags: {},
    ...extra,
  };
}

const summaryOf = (records: AttestationRecord[], change: Partial<RunInvocation> = {}): RunInvocation => ({
  kind: RUN_SUMMARY_KIND,
  command: "qed check --base origin/main",
  duration: "1.2s",
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-11-17 09:41 UTC",
  engine: "qed 0.4.0",
  entries: records.map((r) => ({ digest: r.digest })),
  ...change,
});

describe("reading a bundle", () => {
  it("accepts what it writes", async () => {
    const records = [await record("a"), await record("b")];
    const parsed = parseBundle(serialiseBundle(bundleOf(records, [summaryOf(records)])));
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["not JSON", "{", "It is not JSON."],
    ["another kind of file", JSON.stringify({ kind: "something/else" }), "its kind is not qed.bundle/v1"],
    ["no records", JSON.stringify({ kind: BUNDLE_KIND, repository: "r", runs: [], records: [], signatures: [], tags: {} }), "It holds no records."],
  ])("refuses %s, and says why", (_, text, reason) => {
    const parsed = parseBundle(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toContain(reason);
  });

  it("names the part that is malformed", async () => {
    const broken = { ...(await record("a")), verdict: { state: "EQUIVALENT" } };
    const parsed = parseBundle(JSON.stringify(bundleOf([broken as AttestationRecord])));
    expect(parsed).toEqual({
      ok: false,
      problem: "Record 1 is malformed: an EQUIVALENT verdict has no input count.",
    });
  });
});

describe("runs, from records", () => {
  it("orders a run's records as its summary printed them", async () => {
    const [a, b] = [await record("a"), await record("b")];
    const [run] = runsOf(bundleOf([a, b], [summaryOf([b, a])]));
    expect(run?.records.map((r) => r.symbol)).toEqual(["b", "a"]);
    expect(run?.result.command).toBe("qed check --base origin/main");
    expect(run?.summarised).toBe(true);
  });

  it("counts from the records, whatever a summary claims", async () => {
    const records = [
      await record("a"),
      await record("b", { verdict: { state: "ABSTAINED", obstruction: "imports node:fs" } }),
    ];
    // A summary is not signed. Inflating the command or listing a record that
    // is not there changes no count.
    const inflated = summaryOf(records, {
      command: "qed check --inputs 1000000",
      entries: [...records.map((r) => ({ digest: r.digest })), { digest: "sha256:not-here" }],
    });
    const [run] = runsOf(bundleOf(records, [inflated]));
    expect(run?.result.changedFunctions).toBe(2);
    expect(run?.result.verifiableFunctions).toBe(1);
    expect(run?.missing).toEqual(["sha256:not-here"]);
  });

  it("groups records no summary lists by commit and time, and says so", async () => {
    const old = await record("a", { commit: "0ac77e5", timestamp: "2026-11-10 09:00 UTC" });
    const recent = await record("b");
    const runs = runsOf(bundleOf([old, recent], [summaryOf([recent])]));
    expect(runs.map((r) => r.commit)).toEqual(["4f2c91a", "0ac77e5"]);
    expect(runs[1]?.summarised).toBe(false);
    expect(runs[1]?.result.duration).toBe("not recorded");
  });

  it("carries the importer's reason through to the run", async () => {
    const records = [await record("total")];
    const summary = summaryOf(records, { entries: [{ digest: records[0]?.digest ?? "", via: "pricing/rate.ts" }] });
    const [run] = runsOf(bundleOf(records, [summary]));
    expect(run?.result.runs[0]?.via).toBe("pricing/rate.ts");
  });
});

describe("what a browser can check of a signature", () => {
  it("finds the signed run that lists a record exactly as it reads", async () => {
    const signed = await record("a", { signer: "https://github.com/acme/ledger/.github/workflows/ci.yml@refs/heads/main (issuer x)", rekorIndex: "42" });
    const signatures = [{ kind: SIGNED_RUN_KIND, payload: runManifest([await signingSubject(signed)]), bundle: {} }] as const;
    expect(await signedRunFor(signed, signatures)).toBeDefined();

    const edited = await record("a", { signer: signed.signer, rekorIndex: "42", tolerances: ["float ε 1"] });
    expect(await signedRunFor(edited, signatures)).toBeUndefined();
  });
});

describe("qed export, from a records directory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("gathers records, summaries, signatures and tags, and a bundle that reads back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qed-export-"));
    dirs.push(dir);
    const records = [await record("a"), await record("b")];
    writeRecords(dir, records);
    const result = {
      command: "qed check --base origin/main",
      changedFunctions: 2,
      verifiableFunctions: 2,
      duration: "1.2s",
      runs: records.map((r) => ({ path: r.path, symbol: r.symbol, verdict: r.verdict })),
    };
    writeRunSummary(dir, runSummary(result, records, {
      repository: "acme/ledger",
      commit: "4f2c91a",
      timestamp: "2026-11-17 09:41 UTC",
      engine: "qed 0.4.0",
    }));
    writeFileSync(join(dir, "notes.json"), JSON.stringify({ unrelated: true }));

    const bundle = buildBundle(dir, (commit) => (commit === "4f2c91a" ? ["v0.4.0"] : []));
    expect(bundle.records).toHaveLength(2);
    expect(bundle.runs).toHaveLength(1);
    expect(bundle.tags).toEqual({ "4f2c91a": ["v0.4.0"] });

    const out = join(dir, "bundle.json");
    const written = writeBundle(out, bundle);
    const text = readFileSync(out, "utf8");
    expect(written.digest).toBe(`sha256:${createHash("sha256").update(text).digest("hex")}`);
    expect(parseBundle(text).ok).toBe(true);
    expect(written).toMatchObject({ records: 2, runs: 1, signed: 0 });
  });

  it("names no tag for a run over uncommitted edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qed-export-"));
    dirs.push(dir);
    writeRecords(dir, [await record("a", { commit: "4f2c91a+uncommitted" })]);
    const asked: string[] = [];
    buildBundle(dir, (commit) => {
      asked.push(commit);
      return ["v1"];
    });
    expect(asked).toEqual([]);
  });
});
