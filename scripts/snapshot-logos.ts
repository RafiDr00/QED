/**
 * Records the design system's logo files as the G4 baseline: the sha256 of the
 * file bytes as published, and the sha256 of the path data alone.
 *
 * Run once, when the logo files are taken from the design system. After that a
 * re-run that changes the file is itself the signal that the logo drifted.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const logoDir = join(root, "packages/ui/src/assets/logos");

const SOURCE =
  "https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B (Design System 'QED', version 1791100908-8a30), project/assets/Logos/";

/**
 * The sha256 the artifact itself reported for each file when they were taken.
 *
 * Without these the baseline would be hashed from the repo's own copies and
 * prove only that the repo agrees with itself. Anchored here, a copy that was
 * edited on the way in is caught the first time this script runs.
 */
const ARTIFACT_SHA256: Record<string, string> = {
  "qed-logotype.svg":
    "8e8ab17ff1015876449a67cfd18154e1a1eaf82f67c74da31025eb9144bfd097",
  "qed-mark-16.svg":
    "0a0494eb09da611c783a02310bbe42380598d4abb6c22a9eb9030419f41b819c",
  "qed-mark.svg":
    "61a7208e32ac829fecf0872a24ad55b4c43bf885c16917a66c1dbda540e5e4f8",
  "qed-wordmark.svg":
    "d62e6e547d0d648cff512df75f62e4445f6eea7d1f01eb84540b1ff129615875",
};

const files: Record<
  string,
  { artifactSha256: string; pathDataSha256: string; paths: string[] }
> = {};

for (const name of readdirSync(logoDir).filter((f) => f.endsWith(".svg")).sort()) {
  const bytes = readFileSync(join(logoDir, name));
  const paths = [...bytes.toString("utf8").matchAll(/\sd="([^"]+)"/g)].map(
    (m) => m[1] ?? "",
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected = ARTIFACT_SHA256[name];
  if (expected === undefined) {
    throw new Error(`${name}: no artifact hash on record - add it before baselining`);
  }
  if (sha256 !== expected) {
    throw new Error(
      `${name}: local copy is ${sha256}, the artifact published ${expected}`,
    );
  }

  files[name] = {
    artifactSha256: sha256,
    pathDataSha256: createHash("sha256")
      .update(paths.join("|"), "utf8")
      .digest("hex"),
    paths,
  };
}

writeFileSync(
  join(root, "design-system/logo-paths.json"),
  `${JSON.stringify({ source: SOURCE, files }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `design-system/logo-paths.json: ${Object.keys(files).length} files baselined\n`,
);
