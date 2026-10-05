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
