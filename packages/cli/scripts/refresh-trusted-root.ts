/**
 * Fetches the Sigstore public-good trusted root and writes it into the CLI.
 *
 * `qed verify` checks a signed record without a network: the Fulcio
 * certificate chain, the Rekor inclusion proof and the signed entry timestamp
 * are all checked against this file. It is fetched through Sigstore's TUF
 * client, which verifies it from the root of trust embedded in @sigstore/tuf,
 * so a tampered mirror cannot hand us a different one.
 *
 * Keys rotate rarely. A record signed after a rotation this file does not
 * know about fails to verify with a message saying so; re-run this and
 * rebuild. `qed verify --trusted-root <file>` takes a newer one without a
 * rebuild.
 *
 * Run: pnpm refresh:trusted-root
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TrustedRoot } from "@sigstore/protobuf-specs";
import { getTrustedRoot } from "@sigstore/tuf";

// Lives in packages/cli so the @sigstore packages resolve from here.
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/sigstore/trusted-root.json");

const cache = mkdtempSync(join(tmpdir(), "qed-tuf-"));
try {
  const trusted = await getTrustedRoot({ cachePath: cache });
  const file = {
    source: "https://tuf-repo-cdn.sigstore.dev (Sigstore public-good, via TUF)",
    fetchedAt: new Date().toISOString().slice(0, 10),
    trustedRoot: TrustedRoot.toJSON(trusted),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(
    `packages/cli/src/sigstore/trusted-root.json: ${trusted.certificateAuthorities.length} CAs, ` +
      `${trusted.tlogs.length} transparency logs, fetched ${file.fetchedAt}\n`,
  );
} finally {
  rmSync(cache, { recursive: true, force: true });
}
