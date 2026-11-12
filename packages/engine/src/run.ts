import ts from "typescript";
import type { FunctionRun, RunResult } from "@qed/ui/model";

import { exportedFunctionsOf } from "./exports.js";
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
  /**
   * The changed file this one imports, when it is in the run only because
   * of that import. Its own text did not change; what it calls did.
   */
  readonly via?: string;
}

/** Exported function names, in source order, however they are exported. */
export function exportedFunctions(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  return exportedFunctionsOf(file).map((f) => f.name);
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
  // A revision does not change during a run, and every call re-runs the
  // module, so every call resolved its imports again. Unremembered, each of
  // those was a `git show` per candidate extension - minutes of process
  // spawning for one function, enough to run it past its budget.
  const files = new Map<string, string | undefined>();
  const cachedRead = (path: string): string | undefined => {
    if (!files.has(path)) files.set(path, read(path));
    return files.get(path);
  };
  const resolved = new Map<string, { readonly path: string; readonly source: string } | undefined>();

  return (specifier, fromFile) => {
    const joined = normalise(`${dirOf(fromFile)}/${specifier}`);
    if (resolved.has(joined)) return resolved.get(joined);
    let found: { readonly path: string; readonly source: string } | undefined;
    // `./verdict.js` names the file `verdict.ts` compiles to; TypeScript's
    // own resolver reads the `.ts` first, and so does this. Without it every
    // import written in the ESM style was "not pinned".
    const script = /\.(m|c)?jsx?$/.exec(joined);
    const swapped =
      script === null
        ? []
        : [`${joined.slice(0, script.index)}${script[0].replace("js", "ts")}`];
    for (const candidate of [...swapped, ...EXTENSIONS.map((e) => `${joined}${e}`)]) {
      const source = cachedRead(candidate);
      if (source !== undefined) {
        found = { path: candidate, source };
        break;
      }
    }
    resolved.set(joined, found);
    return found;
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

  // One resolver per side for the whole run, so a file is read once and the
  // type checker's program for a module is built once, not once per function.
  const resolvers = {
    ...(options.readBase ? { resolveBase: relativeResolver(options.readBase) } : {}),
    ...(options.readHead ? { resolveHead: relativeResolver(options.readHead) } : {}),
  };

  for (const module of modules) {
    const baseNames = exportedFunctions(module.base, module.path);
    const headNames = new Set(exportedFunctions(module.head, module.path));

    for (const symbol of baseNames) {
      changed++;
      const key = `${module.path}:${symbol}`;

      const via = module.via === undefined ? {} : { via: module.via };
      if (!headNames.has(symbol)) {
        runs.push({
          path: module.path,
          symbol,
          ...via,
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
          ...resolvers,
        },
      );
      details.set(key, outcome);
      runs.push({ path: module.path, symbol, ...via, verdict: outcome.verdict });
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
