// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  manifestSubjects,
  reDeriveDigest,
  runManifest,
  signingPayload,
  signingSubject,
  verifyRecord,
  type AttestationRecord,
} from "@qed/ui/model";

import { UNSIGNED, NOT_LOGGED } from "../../packages/cli/src/records.js";
import {
  checkSignature,
  sealRecords,
  signerOf,
  verifyOffline,
  writeSignedRun,
  EMBEDDED_ROOT,
  SignatureMismatch,
  type SignatureFacts,
  type Signed,
} from "../../packages/cli/src/signing.js";

/**
 * Signing, checked two ways.
 *
 * Against Sigstore itself: a real bundle - npm's provenance for the
 * `sigstore` package, signed by its release workflow and logged in Rekor -
 * verified offline against the trusted root QED ships. That proves the
 * certificate chain, the transparency log proof and the signature checks run
 * with no network, and fail when anything is touched.
 *
 * Against a stand-in for Fulcio and Rekor: what binds a record to a
 * signature. Real signing needs a CI identity, so the end-to-end run lives
 * in .github/workflows/sigstore.yml.
 */

const fixture = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/sigstore/npm-sigstore-5.0.1.provenance.json"), "utf8"),
  ) as Record<string, unknown>;

type Bundle = Parameters<typeof verifyOffline>[0];

describe("a real Sigstore bundle, verified offline", () => {
  it("names the workflow that signed it, its issuer and its Rekor entry", () => {
    const facts = verifyOffline(fixture() as unknown as Bundle, undefined);
    expect(facts.identity).toBe(
      "https://github.com/sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main",
    );
    expect(facts.issuer).toBe("https://token.actions.githubusercontent.com");
    expect(facts.logIndex).toBe("3692194993");
  });

  it("rejects it when what was signed is changed", () => {
    const bundle = fixture() as { dsseEnvelope: { payload: string } };
    const body = Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8");
    bundle.dsseEnvelope.payload = Buffer.from(body.replace("sigstore", "sigstorf")).toString("base64");
    expect(() => verifyOffline(bundle as unknown as Bundle, undefined)).toThrow(SignatureMismatch);
  });

  it("rejects it when the log entry is changed", () => {
    const bundle = fixture() as {
      verificationMaterial: { tlogEntries: { integratedTime: string }[] };
    };
    const entry = bundle.verificationMaterial.tlogEntries[0];
    if (entry) entry.integratedTime = String(Number(entry.integratedTime) + 1);
    expect(() => verifyOffline(bundle as unknown as Bundle, undefined)).toThrow(SignatureMismatch);
  });

  it("rejects it against a trusted root that does not vouch for the signer", () => {
    const empty = {
      ...EMBEDDED_ROOT,
      trustedRoot: { ...(EMBEDDED_ROOT.trustedRoot as object), certificateAuthorities: [] },
    };
    expect(() => verifyOffline(fixture() as unknown as Bundle, undefined, empty)).toThrow(
      SignatureMismatch,
    );
  });
});

const RECORD: AttestationRecord = {
  symbol: "bulkRate",
  path: "billing/ledger.ts",
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-11-12 09:41 UTC",
  verdict: { state: "EQUIVALENT", inputs: 1000, strategy: "type-directed, corpus-seeded" },
  inputStrategy: "type-directed, corpus-seeded",
  controls: ["clock frozen at 2026-10-04 09:41 UTC"],
  tolerances: [],
  engine: "qed 0.2.0",
  signer: UNSIGNED,
  rekorIndex: NOT_LOGGED,
  digest: "",
};

const IDENTITY = "https://github.com/acme/ledger/.github/workflows/ci.yml@refs/heads/main";
const ISSUER = "https://token.actions.githubusercontent.com";
const FACTS: SignatureFacts = {
  identity: IDENTITY,
  issuer: ISSUER,
  logIndex: "123456",
  signer: signerOf(IDENTITY, ISSUER),
};

/** Fulcio and Rekor, as far as a record can tell. */
const standIn = (): Promise<Signed> => Promise.resolve({ bundle: {} as Signed["bundle"], facts: FACTS });
const verifyStandIn = (): SignatureFacts => FACTS;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function sealedRun(): Promise<{ dir: string; records: AttestationRecord[] }> {
  const dir = mkdtempSync(join(tmpdir(), "qed-signed-"));
  dirs.push(dir);
  const second = { ...RECORD, symbol: "applyDiscount" };
  const unsigned = await Promise.all(
    [RECORD, second].map(async (r) => ({ ...r, digest: await reDeriveDigest(r) })),
  );
  const sealed = await sealRecords(unsigned, standIn);
  writeSignedRun(dir, sealed.run);
  return { dir, records: sealed.records };
}

const check = (record: AttestationRecord, dir: string, expectedIdentity?: string) =>
  checkSignature(record, [dir], {
    unsigned: UNSIGNED,
    verify: verifyStandIn,
    ...(expectedIdentity !== undefined ? { expectedIdentity } : {}),
  });

describe("what a signature binds", () => {
  it("covers every field but the two it produces", () => {
    const signed = { ...RECORD, signer: "someone", rekorIndex: "9" };
    expect(signingPayload(signed)).toBe(signingPayload(RECORD));
    expect(signingPayload({ ...RECORD, tolerances: ["float ε 1"] })).not.toBe(signingPayload(RECORD));
  });

  it("lists each record of the run once, in one canonical order", async () => {
    const a = await signingSubject(RECORD);
    const b = await signingSubject({ ...RECORD, symbol: "other" });
    expect(runManifest([b, a, a])).toBe(runManifest([a, b]));
    expect(manifestSubjects(runManifest([a, b]))).toEqual([a, b].sort());
    // Only the exact signed text is a manifest: re-serialised, it is not.
    expect(manifestSubjects(JSON.stringify(JSON.parse(runManifest([a, b])), null, 1))).toBeUndefined();
  });

  it("fills the signer and log index from the signature, under a digest that covers them", async () => {
    const { records } = await sealedRun();
    for (const record of records) {
      expect(record.signer).toBe(FACTS.signer);
      expect(record.rekorIndex).toBe("123456");
      expect((await verifyRecord(record, new Date())).status).toBe("verified");
    }
  });

  it("verifies a sealed record", async () => {
    const { dir, records } = await sealedRun();
    const result = await check(records[0] as AttestationRecord, dir);
    expect(result.status).toBe("verified");
  });

  it("requires the identity a reader names, exactly", async () => {
    const { dir, records } = await sealedRun();
    const record = records[0] as AttestationRecord;
    expect((await check(record, dir, IDENTITY)).status).toBe("verified");
    expect(await check(record, dir, "https://github.com/acme/ledger/.github/workflows/other.yml@refs/heads/main"))
      .toMatchObject({ status: "mismatch" });
  });
});

describe("forgeries a signature catches, even with a recomputed digest", () => {
  const forge = async (record: AttestationRecord, change: Partial<AttestationRecord>) => {
    const edited = { ...record, ...change, digest: "" };
    return { ...edited, digest: await reDeriveDigest(edited) };
  };

  it("a result edited after signing", async () => {
    const { dir, records } = await sealedRun();
    const forged = await forge(records[0] as AttestationRecord, { tolerances: ["float ε 1"] });
    expect(await check(forged, dir)).toMatchObject({ status: "mismatch" });
  });

  it("a signer rewritten to someone more trusted", async () => {
    const { dir, records } = await sealedRun();
    const forged = await forge(records[0] as AttestationRecord, {
      signer: signerOf("https://github.com/acme/ledger/.github/workflows/release.yml@refs/tags/v9", ISSUER),
    });
    expect(await check(forged, dir)).toMatchObject({ status: "mismatch" });
  });

  it("a log index pointing somewhere else", async () => {
    const { dir, records } = await sealedRun();
    const forged = await forge(records[0] as AttestationRecord, { rekorIndex: "1" });
    expect(await check(forged, dir)).toMatchObject({ status: "mismatch" });
  });

  it("a signature that does not verify", async () => {
    const { dir, records } = await sealedRun();
    const result = await checkSignature(records[0] as AttestationRecord, [dir], {
      unsigned: UNSIGNED,
      verify: () => {
        throw new SignatureMismatch("the signature does not verify");
      },
    });
    expect(result).toEqual({ status: "mismatch", detail: "the signature does not verify" });
  });

  it("an unsigned record, when a signer is required", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qed-unsigned-"));
    dirs.push(dir);
    expect(await check(RECORD, dir, IDENTITY)).toMatchObject({ status: "mismatch" });
    expect(await check(RECORD, dir)).toEqual({ status: "unsigned" });
  });

  it("a record claiming a signer, with no signed run anywhere to check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qed-nosig-"));
    dirs.push(dir);
    const claimed = await forge(RECORD, { signer: FACTS.signer, rekorIndex: "123456" });
    expect(await check(claimed, dir)).toMatchObject({ status: "missing" });
  });
});
