// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AttestationRecord } from "@qed/ui/model";

/**
 * The CLI as a user runs it: a real repository, a real diff, the real
 * process, its real exit code. Every promise the docs make about `qed check`,
 * `qed verify` and `qed repro` is exercised here end to end.
 */

// Each case starts a real process; a check over a real diff takes seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const ROOT = process.cwd();
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const MAIN = join(ROOT, "packages/cli/src/main.ts");

interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the CLI without blocking the test worker. A synchronous spawn held the
 * worker for the whole run, and Vitest gave up waiting on it.
 */
function qed(cwd: string, ...args: string[]): Promise<Ran> {
  return qedWith(cwd, process.env, ...args);
}

function qedWith(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<Ran> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [TSX, MAIN, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", failed);
    child.on("close", (code) => {
      done({ code, stdout, stderr });
    });
  });
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** `sha256:… path symbol` lines from a check's stderr. */
function digestsOf(stderr: string): { digest: string; path: string; symbol: string }[] {
  return stderr
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0]?.startsWith("sha256:"))
    .map(([digest = "", path = "", symbol = ""]) => ({ digest, path, symbol }));
}

const ledger = (name: string) =>
  readFileSync(join(ROOT, "examples/ledger", name), "utf8");

let repo: string;
const scratch: string[] = [];

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "qed-cli-"));
  scratch.push(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "qed@example.invalid");
  git(repo, "config", "user.name", "QED test");
  git(repo, "config", "commit.gpgsign", "false");

  put(repo, "billing/ledger.ts", ledger("base.ts"));
  put(repo, "pricing/rate.ts", `export function rate(qty: number): number { return qty > 10 ? 0.9 : 1; }\n`);
  put(
    repo,
    "pricing/total.ts",
    `import { rate } from "./rate";\nexport function total(qty: number): number { return Math.round(qty * 100 * rate(qty)); }\n`,
  );
  put(repo, "money/sum.ts", `export function f(on: boolean): number { return on ? 0.1 + 0.2 : 0; }\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  // The change under review, left in the working tree.
  put(repo, "billing/ledger.ts", ledger("head.ts"));
  put(repo, "pricing/rate.ts", `export function rate(qty: number): number { return qty >= 10 ? 0.9 : 1; }\n`);
  put(repo, "money/sum.ts", `export function f(on: boolean): number { return on ? 0.3 : 0; }\n`);
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("qed check", () => {
  let run: Ran;
  beforeAll(async () => {
    run = await qed(repo, "check", "--base", "HEAD", "--inputs", "200", "--no-color");
  });

  it("exits 1 when something diverged", () => {
    expect(run.code, run.stderr).toBe(1);
    expect(run.stdout).toContain("DIVERGED");
  });

  it("verifies a function through a pinned relative import", () => {
    // The helper itself is compared, and diverges at the boundary it moved.
    expect(run.stdout).toMatch(/DIVERGED\s+pricing\/rate\.ts\s+rate/);
  });

  it("verifies the unchanged file that imports a changed one, and says why it is there", () => {
    // pricing/total.ts did not change; it is not in the diff. Its helper did,
    // so what total() returns did too.
    expect(run.stdout).toMatch(/DIVERGED\s+pricing\/total\.ts\s+total\s+via pricing\/rate\.ts/);
  });

  it("writes one record per function, and prints each digest", () => {
    const listed = digestsOf(run.stderr);
    const files = readdirSync(join(repo, ".qed/records"));
    expect(run.stderr).toMatch(/^\d+ records written to \.qed[\\/]records/);
    expect(listed.length).toBeGreaterThan(3);
    expect(files.sort()).toEqual(listed.map((l) => `${l.digest.slice(7)}.json`).sort());
  });

  it("marks the record's commit as uncommitted, because the run read the working tree", () => {
    const [first] = digestsOf(run.stderr);
    const record = JSON.parse(
      readFileSync(join(repo, ".qed/records", `${first?.digest.slice(7)}.json`), "utf8"),
    ) as AttestationRecord;
    expect(record.commit).toMatch(/^[0-9a-f]{7,}\+uncommitted$/);
    expect(record.engine).toMatch(/^qed \d+\.\d+\.\d+$/);
    expect(record.signer).toBe("unsigned");
  });

  it("names no tolerance on an exact run, and the float drift diverges", () => {
    const sum = digestsOf(run.stderr).find((l) => l.path === "money/sum.ts");
    const record = JSON.parse(
      readFileSync(join(repo, ".qed/records", `${sum?.digest.slice(7)}.json`), "utf8"),
    ) as AttestationRecord;
    expect(record.verdict.state).toBe("DIVERGED");
    expect(record.tolerances).toEqual([]);
  });
});

describe("qed check --tolerance", () => {
  it("accepts the drift, says so in the echoed command, and records it", async () => {
    const out = join(repo, "tolerant");
    const run = await qed(
      repo,
      "check",
      "--base",
      "HEAD",
      "--inputs",
      "200",
      "--tolerance",
      "float=1e-9",
      "--records",
      out,
      "--no-color",
    );
    expect(run.stdout).toContain("--tolerance float=1e-9");

    const sum = digestsOf(run.stderr).find((l) => l.path === "money/sum.ts");
    const record = JSON.parse(
      readFileSync(join(out, `${sum?.digest.slice(7)}.json`), "utf8"),
    ) as AttestationRecord;
    expect(record.verdict.state).toBe("EQUIVALENT");
    expect(record.tolerances).toEqual(["float ε 1e-9"]);
  });
});

describe("qed verify", () => {
  let listed: ReturnType<typeof digestsOf>;
  let records: string;
  beforeAll(async () => {
    records = join(repo, "verify-records");
    const run = await qed(repo, "check", "--base", "HEAD", "--inputs", "100", "--records", records);
    listed = digestsOf(run.stderr);
  });

  it("verifies every record a check wrote, by its full digest", async () => {
    for (const { digest } of listed) {
      const r = await qed(repo, "verify", "--digest", digest, "--records", records);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain(`verified  ${digest}`);
      expect(r.stdout).toContain("Unsigned: the record says who ran it nowhere it can be checked.");
    }
  });

  it("takes the elided form the docs print", async () => {
    const hex = listed[0]?.digest.slice(7) ?? "";
    const r = await qed(repo, "verify", "--digest", `sha256:${hex.slice(0, 12)}...${hex.slice(-4)}`, "--records", records);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("abbreviated");
  });

  it("says a file checked without a held digest was checked only against itself", async () => {
    const hex = listed[0]?.digest.slice(7) ?? "";
    const r = await qed(repo, "verify", join(records, `${hex}.json`));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("consistent with itself");
  });

  it("exits 1 when a record was edited after it was written", async () => {
    const entry = listed[1];
    const path = join(records, `${entry?.digest.slice(7)}.json`);
    const record = JSON.parse(readFileSync(path, "utf8")) as AttestationRecord;
    writeFileSync(path, JSON.stringify({ ...record, tolerances: ["float ε 1"] }));

    const r = await qed(repo, "verify", "--digest", entry?.digest ?? "", "--records", records);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("mismatch");
  });

  it("exits 1 when a file carries a different digest from the one held", async () => {
    const [a, b] = listed;
    const r = await qed(repo, "verify", join(records, `${a?.digest.slice(7)}.json`), "--digest", b?.digest ?? "");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("different digest from the one you hold");
  });

  it("says an unsigned record is unsigned, and fails it when a signer is required", async () => {
    const { digest } = listed[0] ?? { digest: "" };
    const plain = await qed(repo, "verify", "--digest", digest, "--records", records);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("Unsigned");

    const required = await qed(
      repo,
      "verify",
      "--digest",
      digest,
      "--records",
      records,
      "--signer",
      "https://github.com/acme/ledger/.github/workflows/ci.yml@refs/heads/main",
    );
    expect(required.code).toBe(1);
    expect(required.stdout).toContain("The record is unsigned");
  });

  it("exits 2 when no record matches", async () => {
    const r = await qed(repo, "verify", "--digest", "f".repeat(64), "--records", records);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("No record");
  });
});

describe("qed repro", () => {
  it("loads the helper a module imports, at each side's own revision", async () => {
    const r = await qed(repo, "repro", "pricing/total.ts", "total", "--input", "[10]", "--base", "HEAD");
    expect(r.code, r.stderr).toBe(0);
    // base: 10 > 10 is false, so the full rate. head: 10 >= 10, so 0.9.
    expect(r.stdout).toMatch(/^base\s+1000$/m);
    expect(r.stdout).toMatch(/^head\s+900$/m);
  });
});

describe("exit 2: the run could not start", () => {
  it.each([
    ["an unknown flag", ["check", "--tolerence", "float=1e-9"], /no flag --tolerence/],
    ["a base ref that does not exist", ["check", "--base", "no-such-ref"], /names no commit/],
    ["a malformed input count", ["check", "--inputs", "abc"], /whole number/],
    ["a malformed tolerance", ["check", "--tolerance", "float=-1"], /above zero/],
    ["an unknown command", ["frobnicate"], /Unknown command/],
    ["a digest too short to trust", ["verify", "--digest", "9f2a"], /at least 16/],
    ["no command at all", [], /qed check/],
  ])("for %s", async (_, args, message) => {
    const r = await qed(repo, ...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(message);
  });

  it("for --sign with no identity to sign with", async () => {
    // Stripped of any CI token, so the test means the same thing in CI.
    const tokens = new Set(["ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "SIGSTORE_ID_TOKEN"]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !tokens.has(key)));
    const r = await qedWith(repo, env, "check", "--base", "HEAD", "--sign");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("needs an OIDC identity");
  });

  it("outside a repository", async () => {
    const bare = mkdtempSync(join(tmpdir(), "qed-bare-"));
    scratch.push(bare);
    const r = await qed(bare, "check");
    expect(r.code).toBe(2);
  });

  it("but --help is a successful answer", async () => {
    const r = await qed(repo, "--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("qed verify --digest");
  });
});
