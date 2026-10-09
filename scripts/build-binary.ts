/**
 * Wraps the bundled CLI into a single executable for this machine:
 * dist/bin/qed-<platform>-<arch>[.exe].
 *
 * Node's single-executable-application support: the bundle becomes a blob,
 * the blob is injected into a copy of this Node binary, and the copy runs the
 * bundle instead of a REPL. One file, no runtime to install - which is what
 * "One binary, no daemon" in the docs promises.
 *
 * A binary is built on the platform it is for. The release workflow runs this
 * once per platform; locally it builds the one you are on.
 *
 * Run: pnpm build:binary (bundles first)
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { inject } from "postject";

const root = process.cwd();
const bundle = join(root, "packages/cli/dist/qed.cjs");
const out = join(root, "dist/bin");

/** The name install.sh asks the release for. */
export function binaryName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `qed-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

/** The fuse Node checks to know a blob was injected. Fixed by Node itself. */
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

if (!existsSync(bundle)) {
  throw new Error("packages/cli/dist/qed.cjs is missing: run pnpm build:cli first.");
}
mkdirSync(out, { recursive: true });

const config = join(out, "sea-config.json");
const blob = join(out, "sea-prep.blob");
writeFileSync(
  config,
  JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
  }),
);
run(process.execPath, ["--experimental-sea-config", config]);

const binary = join(out, binaryName());
copyFileSync(process.execPath, binary);

const mac = process.platform === "darwin";
// macOS refuses to run a signed binary that has been modified, so the copy
// loses Node's signature before injection and gets an ad-hoc one after.
if (mac) run("codesign", ["--remove-signature", binary]);

await inject(binary, "NODE_SEA_BLOB", readFileSync(blob), {
  sentinelFuse: SEA_FUSE,
  ...(mac ? { machoSegmentName: "NODE_SEA" } : {}),
});

if (mac) run("codesign", ["--sign", "-", binary]);

// The binary has to answer before it is called built.
const help = spawnSync(binary, ["--help"], { encoding: "utf8" });
if (help.status !== 0 || !help.stdout.includes("qed check")) {
  throw new Error(
    `${binaryName()} did not run: exit ${help.status}\n${help.stderr}`,
  );
}

const mb = (statSync(binary).size / 1024 / 1024).toFixed(1);
process.stdout.write(`${relative(root, binary)}: ${mb}MB, answers --help\n`);
