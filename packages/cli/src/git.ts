import { spawnSync } from "node:child_process";

/**
 * The little of git the CLI needs: which files changed against a ref, and what
 * one of them looked like at that ref.
 *
 * Shelling out rather than taking a git library: this reads two things, and a
 * dependency that reimplements packfiles to do it would be the larger risk.
 */

export class GitError extends Error {}

function git(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw new GitError(`git is not available: ${result.error.message}`);
  if (result.status !== 0) {
    throw new GitError(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}

export function repositoryRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

/**
 * Fails, with exit 2, when `ref` names no commit.
 *
 * Without this a mistyped base ref read as "nothing changed" - `git show`
 * quietly found no file at a ref that does not exist - and the run printed a
 * clean result it had never computed.
 */
export function resolveRef(ref: string, cwd: string): void {
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { cwd, encoding: "utf8" },
  );
  if (result.error) throw new GitError(`git is not available: ${result.error.message}`);
  if (result.status !== 0) {
    throw new GitError(`The base ref '${ref}' names no commit in this repository.`);
  }
}

/** Files that differ from `ref`, as repository-relative paths. */
export function changedFiles(ref: string, cwd: string): string[] {
  // Three dots: what changed on this branch since it left the base, rather
  // than everything that has happened on the base since.
  const output = git(["diff", "--name-only", `${ref}...HEAD`], cwd);
  const uncommitted = git(["diff", "--name-only", ref], cwd);

  return [
    ...new Set(
      `${output}\n${uncommitted}`
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ].sort();
}

/**
 * The commit a record names, marked when the working tree has moved past it.
 *
 * `qed check` reads files from disk, so a run over uncommitted edits did not
 * run the commit HEAD names. Untracked files are left out: the records this
 * writes are untracked themselves, and a file git does not know about is not
 * in the diff either.
 */
export function workingCommit(cwd: string): string {
  const head = git(["rev-parse", "--short", "HEAD"], cwd).trim();
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], cwd).trim();
  return dirty === "" ? head : `${head}+uncommitted`;
}

/**
 * `owner/name` from the origin remote, or the directory's own name.
 *
 * Only the last two path segments are kept: a remote URL can carry a token
 * (`https://x-access-token:…@github.com/…`), and a record is meant to be
 * handed around.
 */
export function repositoryName(cwd: string): string {
  const root = repositoryRoot(cwd);
  const fallback = root.split(/[\\/]/).filter(Boolean).pop() ?? "repository";
  let url: string;
  try {
    url = git(["remote", "get-url", "origin"], cwd).trim();
  } catch {
    return fallback;
  }
  const segments = url
    .replace(/\.git$/, "")
    .split(/[/:\\]/)
    .filter((s) => s !== "" && !s.includes("@"));
  const [owner, name] = segments.slice(-2);
  return owner !== undefined && name !== undefined ? `${owner}/${name}` : fallback;
}

/** A file's contents at `ref`, or undefined when it did not exist there. */
export function fileAt(
  ref: string,
  path: string,
  cwd: string,
): string | undefined {
  const result = spawnSync("git", ["show", `${ref}:${path}`], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  return result.stdout;
}
