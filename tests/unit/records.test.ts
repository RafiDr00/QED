// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verify } from "@qed/engine";
import {
  reDeriveDigest,
  verifyRecord,
  type AttestationRecord,
  type FunctionRun,
} from "@qed/ui/model";

import {
  buildRecord,
  describeControls,
  formatUtc,
  writeRecords,
  NOT_LOGGED,
  UNSIGNED,
} from "../../packages/cli/src/records.js";

const CONTEXT = {
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-10-09 15:02 UTC",
  engine: "qed 0.1.0",
};

const drifting = `export function f(on: boolean): number { return on ? 0.1 + 0.2 : 0; }`;
const exact = `export function f(on: boolean): number { return on ? 0.3 : 0; }`;

function verified(base: string, head: string, tolerance?: { floatEpsilon: number }) {
  const detail = verify(
    { fileName: "billing/tax.ts", symbol: "f", base, head },
    { inputs: 100, ...(tolerance ? { tolerance } : {}) },
  );
  const run: FunctionRun = { path: "billing/tax.ts", symbol: "f", verdict: detail.verdict };
  return { run, detail };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a record from a real run", () => {
  it("carries a digest its own fields produce", async () => {
    const { run, detail } = verified(drifting, exact, { floatEpsilon: 1e-9 });
    const record = await buildRecord(run, detail, CONTEXT);
    expect(await reDeriveDigest(record)).toBe(record.digest);
    expect(record.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("names the tolerance the verdict leaned on", async () => {
    const { run, detail } = verified(drifting, exact, { floatEpsilon: 1e-9 });
    const record = await buildRecord(run, detail, CONTEXT);
    expect(record.verdict.state).toBe("EQUIVALENT");
    expect(record.tolerances).toEqual(["float ε 1e-9"]);
  });

  it("names no tolerance on an exact run", async () => {
    const { run, detail } = verified(exact, exact);
    expect((await buildRecord(run, detail, CONTEXT)).tolerances).toEqual([]);
  });

  it("carries the counterexample of a divergence", async () => {
    const { run, detail } = verified(drifting, exact);
    const record = await buildRecord(run, detail, CONTEXT);
    expect(record.verdict.state).toBe("DIVERGED");
    if (record.verdict.state !== "DIVERGED") return;
    expect(record.verdict.counterexample.repro).toContain("qed repro billing/tax.ts f");
  });

  it("says it is unsigned and unlogged rather than leaving the fields blank", async () => {
    const { run, detail } = verified(exact, exact);
    const record = await buildRecord(run, detail, CONTEXT);
    expect(record.signer).toBe(UNSIGNED);
    expect(record.rekorIndex).toBe(NOT_LOGGED);
  });

  it("records a function that was never run with default controls and no tolerances", async () => {
    const run: FunctionRun = {
      path: "a.ts",
      symbol: "gone",
      verdict: { state: "ABSTAINED", obstruction: "is no longer exported, so there is nothing to compare" },
    };
    const record = await buildRecord(run, undefined, CONTEXT);
    expect(record.tolerances).toEqual([]);
    expect(record.controls).toContain("rng seed 0x5f3a");
    expect(await reDeriveDigest(record)).toBe(record.digest);
  });
});

describe("controls", () => {
  it("names the instant the clock was frozen at and the seed", () => {
    expect(describeControls({ epochMs: Date.UTC(2026, 9, 4, 9, 41), rngSeed: 0x5f3a })).toEqual([
      "clock frozen at 2026-10-04 09:41 UTC",
      "rng seed 0x5f3a",
      "network denied",
      "timers denied",
      "relative imports pinned, others refused",
    ]);
  });

  it("formats time the way the console does", () => {
    expect(formatUtc(new Date("2030-01-02T03:04:59Z"))).toBe("2030-01-02 03:04 UTC");
  });
});

describe("writing records", () => {
  it("writes one file per record, named by its digest, that still verifies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qed-records-"));
    dirs.push(dir);
    const a = verified(exact, exact);
    const b = verified(drifting, exact);
    const records = await Promise.all([
      buildRecord(a.run, a.detail, CONTEXT),
      buildRecord({ ...b.run, symbol: "g" }, b.detail, CONTEXT),
    ]);

    writeRecords(join(dir, "nested", "records"), records);
    const files = readdirSync(join(dir, "nested", "records")).sort();
    expect(files).toEqual(records.map((r) => `${r.digest.slice(7)}.json`).sort());

    for (const file of files) {
      const back = JSON.parse(
        readFileSync(join(dir, "nested", "records", file), "utf8"),
      ) as AttestationRecord;
      expect((await verifyRecord(back, new Date(0))).status).toBe("verified");
    }
  });
});
