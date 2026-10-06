import ts from "typescript";
import type { FunctionRun, RunResult } from "@qed/ui/model";

import type { Resolver } from "./sandbox.js";
import { verify, type VerifyOptions, type VerifyResult } from "./verify.js";

/**
 * A whole run: every exported function the two versions share, verified, in
 * the shape the CLI renderer and the console already consume.
 */

export interface ModulePair {
  /** Repository-relative, as it is printed. */
  readonly path: string;
  readonly base: string;
  readonly head: string;
}

/** Exported function names, in source order. */
export function exportedFunctions(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const names: string[] = [];

  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );

  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      exported(statement)
    ) {
      names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          names.push(decl.name.text);
        }
      }
    }
  }
  return names;
}

export interface RunOptions extends VerifyOptions {
  /** Echoed at the top of the output. */
  readonly command?: string;
  /** Already formatted, because the engine does not read a clock. */
  readonly duration?: string;
  /** Reads a repository-relative file at the base revision. */
  readonly readBase?: (path: string) => string | undefined;
  /** Reads a repository-relative file as it is now. */
  readonly readHead?: (path: string) => string | undefined;
}

/** The extensions a relative import may omit, in the order Node tries them. */
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** Collapses "a/b/../c" and "./c" the way a module specifier means them. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Turns a file reader into a resolver that pins relative imports.
 *
 * The dependency is read at the same revision as the module importing it, so
 * both sides of the comparison see a consistent tree - and a dependency that
 * itself changed shows up as part of the change rather than being hidden.
 */
export function relativeResolver(
  read: (path: string) => string | undefined,
): Resolver {
  return (specifier, fromFile) => {
    const joined = normalise(`${dirOf(fromFile)}/${specifier}`);
    for (const extension of EXTENSIONS) {
      const candidate = `${joined}${extension}`;
      const source = read(candidate);
      if (source !== undefined) return { path: candidate, source };
    }
    return undefined;
  };
}

export interface EngineRun {
  readonly result: RunResult;
  /** Per function, what verify recorded - for the attestations. */
  readonly details: ReadonlyMap<string, VerifyResult>;
}

/**
 * Verifies every function the two versions share.
 *
 * A function that only one side exports is a change of surface rather than of
 * behaviour, and is reported as such rather than silently skipped.
 */
export function runPair(
  modules: readonly ModulePair[],
  options: RunOptions = {},
): EngineRun {
  const runs: FunctionRun[] = [];
  const details = new Map<string, VerifyResult>();
  let changed = 0;

  for (const module of modules) {
    const baseNames = exportedFunctions(module.base, module.path);
    const headNames = new Set(exportedFunctions(module.head, module.path));

    for (const symbol of baseNames) {
      changed++;
      const key = `${module.path}:${symbol}`;

      if (!headNames.has(symbol)) {
        runs.push({
          path: module.path,
          symbol,
          verdict: {
            state: "ABSTAINED",
            obstruction: "is no longer exported, so there is nothing to compare",
          },
        });
        continue;
      }

      const outcome = verify(
        {
          fileName: module.path,
          symbol,
          base: module.base,
          head: module.head,
        },
        {
          ...options,
          ...(options.readBase
            ? { resolveBase: relativeResolver(options.readBase) }
            : {}),
          ...(options.readHead
            ? { resolveHead: relativeResolver(options.readHead) }
            : {}),
        },
      );
      details.set(key, outcome);
      runs.push({ path: module.path, symbol, verdict: outcome.verdict });
    }
  }

  const verifiable = runs.filter(
    (run) => run.verdict.state !== "ABSTAINED",
  ).length;

  return {
    result: {
      command: options.command ?? "qed check",
      changedFunctions: changed,
      verifiableFunctions: verifiable,
      duration: options.duration ?? "0s",
      runs,
    },
    details,
  };
}
