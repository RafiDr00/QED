// @vitest-environment node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
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

function install(from: string, into: string) {
  return spawnSync("sh", [INSTALLER], {
    encoding: "utf8",
    env: {
      ...process.env,
      QED_DOWNLOAD_BASE: pathToFileURL(from).href,
      QED_INSTALL_DIR: into,
    },
  });
}

describe.skipIf(!hasSh)("install.sh", () => {
  it("installs the binary for this machine once its checksum matches", () => {
    const into = join(scratch("qed-into-"), "bin");
    const r = install(release((hex) => `${hex}  ${NAME}\n`), into);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`installed ${into}/${INSTALLED}`);
    expect(existsSync(join(into, INSTALLED))).toBe(true);
  });

  it("reads the binary-mode form sha256sum writes", () => {
    const into = scratch("qed-into-");
    const r = install(release((hex) => `${hex} *${NAME}\n`), into);
    expect(r.status, r.stderr).toBe(0);
  });

  it("refuses a binary whose checksum does not match, and installs nothing", () => {
    const into = scratch("qed-into-");
    const r = install(release(() => `${"0".repeat(64)}  ${NAME}\n`), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("does not match the release's checksum");
    expect(existsSync(join(into, INSTALLED))).toBe(false);
  });

  it("says so when the release has no binary for this machine", () => {
    const into = scratch("qed-into-");
    const r = install(release((hex) => `${hex}  qed-plan9-mips\n`), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`the release has no ${NAME}`);
  });

  it("says so when the release cannot be reached", () => {
    const into = scratch("qed-into-");
    const r = install(join(scratch("qed-empty-"), "absent"), into);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("could not download SHA256SUMS");
  });
});
