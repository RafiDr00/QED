import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bundleFromJSON, type SerializedBundle } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";
import {
  manifestSubjects,
  reDeriveDigest,
  runManifest,
  signingSubject,
  type AttestationRecord,
} from "@qed/ui/model";
import { sign } from "sigstore";

import embeddedRoot from "./sigstore/trusted-root.json" with { type: "json" };

/**
 * Signing a run with Sigstore, and checking a signature without a network.
 *
 * A record's `signer` and `rekorIndex` used to read `unsigned` and `not
 * logged`, because nothing filled them. `qed check --sign` now has the CI
 * provider's OIDC identity certified by Fulcio, signs the run with it, and
 * logs the signature in Rekor's public transparency log. `qed verify` checks
 * all of that - the certificate chain, the signature, the log's inclusion
 * proof and signed timestamp - against a trusted root shipped inside the
 * binary, so it needs no network and no trust in us. DECISIONS.md D-059.
 */

/** The run could not be signed, or a signature could not be looked for. Exit 2. */
export class SigningError extends Error {
  override readonly name = "SigningError";
}

/** A signature that does not hold up. Exit 1, like any other altered record. */
export class SignatureMismatch extends Error {
  override readonly name = "SignatureMismatch";
}

/* ------------------------------------------------------------------------ */
/* Trust                                                                    */
/* ------------------------------------------------------------------------ */

export interface TrustedRootFile {
  readonly source: string;
  /** "2026-11-12": when the root was fetched, so a reader knows its age. */
  readonly fetchedAt: string;
  readonly trustedRoot: unknown;
}

/** The Sigstore public-good trusted root this binary was built with. */
export const EMBEDDED_ROOT: TrustedRootFile = embeddedRoot;

/** A trusted root from a file, for when the embedded one has aged out. */
export function loadTrustedRoot(path: string): TrustedRootFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SigningError(`${path} could not be read as JSON: ${String(error)}`);
  }
  // Either the file this repository writes, or Sigstore's own trusted_root.json.
  const wrapped = parsed as Partial<TrustedRootFile>;
  if (wrapped.trustedRoot !== undefined) {
    return { source: path, fetchedAt: wrapped.fetchedAt ?? "unknown", trustedRoot: wrapped.trustedRoot };
  }
  return { source: path, fetchedAt: "unknown", trustedRoot: parsed };
}

/* ------------------------------------------------------------------------ */
/* Verifying                                                                */
/* ------------------------------------------------------------------------ */

/** What a verified signature establishes. */
export interface SignatureFacts {
  /** The certificate's subject: for GitHub, the workflow and ref that ran. */
  readonly identity: string;
  /** The OIDC issuer that vouched for the identity. */
  readonly issuer: string;
  /** Where Rekor logged the signature. */
  readonly logIndex: string;
  /** What a record's `signer` field carries: identity and issuer together. */
  readonly signer: string;
}

/**
 * The signer a record names. The issuer is part of it: a subject is only
 * meaningful together with who vouched for it.
 */
export const signerOf = (identity: string, issuer: string): string =>
  `${identity} (issuer ${issuer})`;

/**
 * Verifies a Sigstore bundle with no network: the Fulcio certificate chains to
 * the trusted root, the certificate was in the CT log, the signature is over
 * `payload` (or, for a DSSE bundle, over its own envelope), and Rekor's
 * inclusion proof and signed timestamp check out.
 */
export function verifyOffline(
  bundle: SerializedBundle,
  payload: Buffer | undefined,
  root: TrustedRootFile = EMBEDDED_ROOT,
): SignatureFacts {
  let parsed: ReturnType<typeof bundleFromJSON>;
  try {
    parsed = bundleFromJSON(bundle);
  } catch (error) {
    throw new SignatureMismatch(`the signature bundle is malformed: ${messageOf(error)}`);
  }

  let trust: ReturnType<typeof toTrustMaterial>;
  try {
    trust = toTrustMaterial(TrustedRoot.fromJSON(root.trustedRoot));
  } catch (error) {
    throw new SigningError(`the trusted root from ${root.source} is unusable: ${messageOf(error)}`);
  }

  const verifier = new Verifier(trust, { tlogThreshold: 1, ctlogThreshold: 1 });
  let identity: string | undefined;
  let issuer: string | undefined;
  try {
    const signer = verifier.verify(toSignedEntity(parsed, payload));
    identity = signer.identity?.subjectAlternativeName;
    issuer = signer.identity?.extensions?.issuer;
  } catch (error) {
    throw new SignatureMismatch(
      `the signature does not verify against the Sigstore trusted root fetched ${root.fetchedAt}: ${messageOf(error)}`,
    );
  }
  if (identity === undefined || issuer === undefined) {
    throw new SignatureMismatch("the signing certificate names no identity or no issuer");
  }

  const logIndex = parsed.verificationMaterial.tlogEntries[0]?.logIndex;
  if (logIndex === undefined) throw new SignatureMismatch("the signature was never logged in Rekor");
  return { identity, issuer, logIndex, signer: signerOf(identity, issuer) };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/* ------------------------------------------------------------------------ */
/* Signing                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Whether this process has an identity Fulcio will certify: a GitHub Actions
 * job with `id-token: write`, or a token handed over in SIGSTORE_ID_TOKEN.
 */
export function oidcAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(env["SIGSTORE_ID_TOKEN"]) ||
    (Boolean(env["ACTIONS_ID_TOKEN_REQUEST_URL"]) && Boolean(env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]))
  );
}

export interface Signed {
  readonly bundle: SerializedBundle;
  readonly facts: SignatureFacts;
}

/**
 * Signs `payload` with the ambient OIDC identity and logs it in Rekor.
 *
 * What comes back is verified offline against the root this binary ships,
 * before anything is written that claims it - a signature this binary could
 * not later check is a signature it should not hand out.
 */
export async function signWithSigstore(payload: string): Promise<Signed> {
  let bundle: SerializedBundle;
  try {
    bundle = await sign(Buffer.from(payload, "utf8"));
  } catch (error) {
    throw new SigningError(`signing with Sigstore failed: ${messageOf(error)}`);
  }
  try {
    return { bundle, facts: verifyOffline(bundle, Buffer.from(payload, "utf8")) };
  } catch (error) {
    throw new SigningError(
      `Sigstore signed the run, but the signature does not verify against the trusted root this qed ships ` +
        `(fetched ${EMBEDDED_ROOT.fetchedAt}): ${messageOf(error)}. Run pnpm refresh:trusted-root and rebuild.`,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Runs                                                                     */
/* ------------------------------------------------------------------------ */

/** What `<dir>/run-<id>.sigstore.json` holds: the signed text and its bundle. */
export interface SignedRunFile {
  readonly kind: "qed.signed-run/v1";
  /** The manifest, exactly as signed. */
  readonly payload: string;
  readonly bundle: SerializedBundle;
}

export interface Sealed {
  readonly records: AttestationRecord[];
  readonly run: SignedRunFile;
  readonly facts: SignatureFacts;
}

/**
 * Signs a run and fills each record's `signer` and `rekorIndex` from the
 * signature, then re-derives each digest so it covers them.
 *
 * `signer` is how a test substitutes for Fulcio and Rekor.
 */
export async function sealRecords(
  records: readonly AttestationRecord[],
  signer: (payload: string) => Promise<Signed> = signWithSigstore,
): Promise<Sealed> {
  const payload = runManifest(await Promise.all(records.map(signingSubject)));
  const { bundle, facts } = await signer(payload);
  const sealed = await Promise.all(
    records.map(async (record) => {
      const filled = { ...record, signer: facts.signer, rekorIndex: facts.logIndex, digest: "" };
      return { ...filled, digest: await reDeriveDigest(filled) };
    }),
  );
  return { records: sealed, run: { kind: "qed.signed-run/v1", payload, bundle }, facts };
}

/** `run-<16 hex of the payload's sha256>.sigstore.json`. */
export function runFileName(payload: string): string {
  return `run-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}.sigstore.json`;
}

export function writeSignedRun(dir: string, run: SignedRunFile): string {
  const path = join(dir, runFileName(run.payload));
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return path;
}

function readSignedRun(path: string): SignedRunFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SignedRunFile>;
    if (parsed.kind !== "qed.signed-run/v1" || typeof parsed.payload !== "string" || !parsed.bundle) {
      return undefined;
    }
    return parsed as SignedRunFile;
  } catch {
    return undefined;
  }
}

/** Every signed run in `dirs`. */
export function signedRunsIn(
  dirs: readonly string[],
): { readonly path: string; readonly run: SignedRunFile }[] {
  const out: { path: string; run: SignedRunFile }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".sigstore.json")) continue;
      const path = join(dir, name);
      const run = readSignedRun(path);
      if (run) out.push({ path, run });
    }
  }
  return out;
}

export type SignatureCheck =
  | { readonly status: "unsigned" }
  | { readonly status: "verified"; readonly facts: SignatureFacts; readonly path: string }
  | { readonly status: "missing"; readonly searched: readonly string[] }
  | { readonly status: "mismatch"; readonly detail: string };

export interface CheckOptions {
  /** What an unsigned record's `signer` reads. */
  readonly unsigned: string;
  /** The identity a reader requires, exactly: `--signer`. */
  readonly expectedIdentity?: string;
  readonly root?: TrustedRootFile;
  /** Substituted in tests; the real one is offline. */
  readonly verify?: typeof verifyOffline;
}

/**
 * Checks a record's signature: that a signed run lists this exact record,
 * that the run's signature verifies, and that the record names the identity
 * and the log entry the signature really has.
 *
 * Each of those catches a different forgery. A record edited after signing is
 * no longer listed. A bundle copied from another run lists other records. A
 * record that rewrites `signer` to someone more trusted no longer matches
 * the certificate.
 */
export async function checkSignature(
  record: AttestationRecord,
  dirs: readonly string[],
  options: CheckOptions,
): Promise<SignatureCheck> {
  if (record.signer === options.unsigned) {
    return options.expectedIdentity === undefined
      ? { status: "unsigned" }
      : { status: "mismatch", detail: `The record is unsigned; you required ${options.expectedIdentity}.` };
  }

  const runs = signedRunsIn(dirs);
  // Nothing to check against is a check that could not run. Signed runs that
  // do not list this record are an answer: it is not the record they signed.
  if (runs.length === 0) return { status: "missing", searched: dirs };
  const subject = await signingSubject(record);
  const found = runs.find(({ run }) => manifestSubjects(run.payload)?.includes(subject));
  if (!found) {
    return {
      status: "mismatch",
      detail:
        "No signed run lists this record as it now reads: it was changed after it was signed, " +
        "or it was never signed by the run it claims.",
    };
  }

  let facts: SignatureFacts;
  try {
    facts = (options.verify ?? verifyOffline)(
      found.run.bundle,
      Buffer.from(found.run.payload, "utf8"),
      options.root ?? EMBEDDED_ROOT,
    );
  } catch (error) {
    if (error instanceof SignatureMismatch) return { status: "mismatch", detail: error.message };
    throw error;
  }

  if (facts.signer !== record.signer) {
    return {
      status: "mismatch",
      detail: `The record names ${record.signer} as its signer, but the signature is ${facts.signer}.`,
    };
  }
  if (facts.logIndex !== record.rekorIndex) {
    return {
      status: "mismatch",
      detail: `The record names Rekor index ${record.rekorIndex}, but the signature was logged at ${facts.logIndex}.`,
    };
  }
  if (options.expectedIdentity !== undefined && facts.identity !== options.expectedIdentity) {
    return {
      status: "mismatch",
      detail: `Signed by ${facts.identity}, not by ${options.expectedIdentity} as you required.`,
    };
  }
  return { status: "verified", facts, path: found.path };
}
