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

const files: Record<
  string,
  { artifactSha256: string; pathDataSha256: string; paths: string[] }
> = {};

for (const name of readdirSync(logoDir).filter((f) => f.endsWith(".svg")).sort()) {
  const bytes = readFileSync(join(logoDir, name));
  const paths = [...bytes.toString("utf8").matchAll(/\sd="([^"]+)"/g)].map(
    (m) => m[1] ?? "",
  );
  files[name] = {
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
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
