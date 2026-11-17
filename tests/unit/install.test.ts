// @vitest-environment node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * apps/web/public/install.sh, run for real against a release served from a
 * local directory.
 *
 * The "binary" is a copy of the Node executable running this test: a real
 * program for this platform that answers --help, which is all the installer
 * asks of it before installing.
 */

vi.setConfig({ testTimeout: 60_000 });

const INSTALLER = join(process.cwd(), "apps/web/public/install.sh");
const hasSh = spawnSync("sh", ["-c", "command -v curl"]).status === 0;

const NAME = `qed-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
const INSTALLED = process.platform === "win32" ? "qed.exe" : "qed";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A release directory holding the binary and a SHA256SUMS for it. */
function release(sums: (hex: string) => string): string {
  const dir = scratch("qed-release-");
  copyFileSync(process.execPath, join(dir, NAME));
  const hex = createHash("sha256").update(readFileSync(join(dir, NAME))).digest("hex");
  writeFileSync(join(dir, "SHA256SUMS"), sums(hex));
  return dir;
}

/**
 * Runs the installer. Unless a test says otherwise there is no cosign, so a
 * runner that happens to have one installed means the same as one that does
 * not.
 */
function install(
  from: string,
  into: string,
  env: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done, failed) => {
    const child = spawn("sh", [INSTALLER], {
      env: {
        ...process.env,
        QED_COSIGN: join(from, "no-cosign-here"),
        QED_DOWNLOAD_BASE: pathToFileURL(from).href,
        QED_INSTALL_DIR: into,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", failed);
    child.on("close", (status) => {
      done({ status, stdout, stderr });
    });
  });
}

/**
 * A stand-in for cosign that exits as told and writes down how it was called,
 * so the test can see what the installer asked it to require.
 */
function fakeCosign(exitCode: number): { path: string; calls: () => string } {
  const dir = scratch("qed-cosign-");
  const path = join(dir, "cosign");
  const log = join(dir, "calls");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${log}"\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return { path, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

/** A release that also carries a signature for its SHA256SUMS. */
function signedRelease(): string {
  const dir = release((hex) => `${hex}  ${NAME}\n`);
  writeFileSync(join(dir, "SHA256SUMS.sigstore.json"), "{}");
  return dir;
}

describe.skipIf(!hasSh)("install.sh", () => {
  it("installs the binary for this machine once its checksum matches", async () => {
    const into = join(scratch("qed-into-"), "bin");
    const r = await install(release((hex) => `${hex}  ${NAME}\n`), into);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`installed ${into}/${INSTALLED}`);
    expect(existsSync(join(into, INSTALLED))).toBe(true);
  });

  it("reads the binary-mode form sha256sum writes", async () => {
    const into = scratch("qed-into-");
    const r = await install(release((hex) => `${hex} *${NAME}\n`), into);
    expect(r.status, r.stderr).toBe(0);
  });

  it("refuses a binary whose checksum does not match, and installs nothing", async () => {
    const into = scratch("qed-into-");
    const r = await install(release(() => `${"0".repeat(64)}  ${NAME}\n`), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("does not match the release's checksum");
    expect(existsSync(join(into, INSTALLED))).toBe(false);
  });

  it("says so when the release has no binary for this machine", async () => {
    const into = scratch("qed-into-");
    const r = await install(release((hex) => `${hex}  qed-plan9-mips\n`), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`the release has no ${NAME}`);
  });

  it("says the signature was not checked when there is no cosign", async () => {
    const into = scratch("qed-into-");
    const r = await install(signedRelease(), into);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("signature not checked");
  });

  it("checks the signature with cosign, requiring this repository's release workflow", async () => {
    const into = scratch("qed-into-");
    const cosign = fakeCosign(0);
    const r = await install(signedRelease(), into, { QED_COSIGN: cosign.path });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("signature checked with cosign");
    const calls = cosign.calls();
    expect(calls).toContain("verify-blob");
    expect(calls).toContain("--certificate-identity-regexp");
    expect(calls).toContain("RafiDr00/QED/\\.github/workflows/release\\.yml@refs/tags/v");
    expect(calls).toContain("https://token.actions.githubusercontent.com");
  });

  it("installs nothing when cosign rejects the signature", async () => {
    const into = scratch("qed-into-");
    const r = await install(signedRelease(), into, { QED_COSIGN: fakeCosign(1).path });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("is not signed by");
    expect(existsSync(join(into, INSTALLED))).toBe(false);
  });

  it("installs an unsigned older release, and says it was unsigned", async () => {
    const into = scratch("qed-into-");
    const r = await install(release((hex) => `${hex}  ${NAME}\n`), into, { QED_COSIGN: fakeCosign(0).path });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("predates signing");
  });

  it("refuses to install unchecked when a signature is required", async () => {
    const into = scratch("qed-into-");
    const noCosign = await install(signedRelease(), into, { QED_REQUIRE_SIGNATURE: "1" });
    expect(noCosign.status).not.toBe(0);
    expect(noCosign.stderr).toContain("there is no cosign");

    const unsigned = await install(release((hex) => `${hex}  ${NAME}\n`), into, {
      QED_REQUIRE_SIGNATURE: "1",
      QED_COSIGN: fakeCosign(0).path,
    });
    expect(unsigned.status).not.toBe(0);
    expect(unsigned.stderr).toContain("has no SHA256SUMS signature");
    expect(existsSync(join(into, INSTALLED))).toBe(false);
  });

  it("says so when the release cannot be reached", async () => {
    const into = scratch("qed-into-");
    const r = await install(join(scratch("qed-empty-"), "absent"), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("could not download SHA256SUMS");
  });
});
