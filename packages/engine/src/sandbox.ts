import { createContext, Script, type Context } from "node:vm";
import ts from "typescript";

/**
 * The determinism controls, as the design system names them: "clock frozen,
 * rng seed 0x5f3a, network denied, overlay fs".
 *
 * A function runs inside a context whose ambient state we own completely.
 * Anything it reaches for that we did not put there fails loudly rather than
 * quietly producing a result that happens to match today.
 *
 * ## This is not a security boundary
 *
 * `node:vm` isolates names, not privileges. Code inside a context can reach
 * the host realm through `constructor.constructor` and similar, and Node's own
 * documentation says so. That is acceptable here because QED runs *your* code
 * on *your* machine - the same code your test suite already runs.
 *
 * It is NOT acceptable for a hosted service running somebody else's code. That
 * needs a real boundary: a separate process under seccomp, V8 isolates, or
 * WASM. This file is the wrong place to pretend otherwise.
 */

export interface Controls {
  /** The instant every `new Date()` and `Date.now()` returns. */
  readonly epochMs: number;
  /** Seeds the replacement for `Math.random`. */
  readonly rngSeed: number;
}

export const DEFAULT_CONTROLS: Controls = {
  // 2026-10-04T09:41:00Z - the timestamp the design system's own attestation
  // carries, so a record produced here reads like the one it describes.
  epochMs: Date.UTC(2026, 9, 4, 9, 41, 0),
  rngSeed: 0x5f3a,
};

/** Why a function could not be run. The text is printed verbatim to a reader. */
export class ObstructionError extends Error {
  constructor(readonly obstruction: string) {
    super(obstruction);
    this.name = "ObstructionError";
  }
}

/** mulberry32: small, fast, and identical across platforms. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `Math`, with only `random` replaced.
 *
 * Built by copying every own property rather than by spreading: `Math`'s
 * methods are all non-enumerable, so `{ ...Math }` is an empty object and
 * every `Math.round` inside the sandbox became "is not a function". Two
 * versions that both failed that way compared equal, so tests of rounding
 * passed while testing nothing at all.
 */
function seededMath(seed: number): typeof Math {
  const replacement = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(Math)) {
    const descriptor = Object.getOwnPropertyDescriptor(Math, key);
    if (!descriptor) continue;
    const value: unknown = descriptor.value;
    replacement[key] =
      typeof value === "function"
        ? (...args: unknown[]): unknown =>
            (value as (...a: unknown[]) => unknown).apply(Math, args)
        : value;
  }
  replacement["random"] = seededRandom(seed);
  return Object.freeze(replacement) as unknown as typeof Math;
}

function frozenDate(epochMs: number): DateConstructor {
  const Real = Date;
  const Frozen = function (this: unknown, ...args: unknown[]) {
    if (!(this instanceof Frozen)) return new Real(epochMs).toString();
    if (args.length === 0) return new Real(epochMs);
    return new (Real as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;

  Object.setPrototypeOf(Frozen, Real);
  Object.defineProperty(Frozen, "prototype", {
    value: Real.prototype,
    writable: false,
  });
  Frozen.now = () => epochMs;
  Frozen.parse = Real.parse;
  Frozen.UTC = Real.UTC;
  return Frozen;
}

/** Anything that reaches outside the function is an obstruction, by name. */
function denied(obstruction: string): (...args: unknown[]) => never {
  return () => {
    throw new ObstructionError(obstruction);
  };
}

/**
 * Where a relative import resolves to.
 *
 * Imports are *pinned*, not resolved from disk: the caller supplies the source
 * of each dependency at the revision being compared. Loading the same pinned
 * dependency into both sandboxes keeps the comparison honest - it still
 * isolates the change - while letting a function that calls a local helper be
 * compared at all. Refusing every import, which is what this did before, made
 * the engine abstain on most real code.
 */
export type Resolver = (
  specifier: string,
  fromFile: string,
) => { readonly path: string; readonly source: string } | undefined;

/**
 * A module compiled once, as a function of (module, exports, require).
 *
 * The wrapper is what makes re-running safe. Running a module's code at the
 * top level of a context leaves its `let` and `const` bindings in that
 * context's lexical scope, so the second run dies with "Identifier has
 * already been declared" - which is exactly what happened the first time this
 * reused a context. Inside a function those declarations are function-scoped,
 * so every call starts from nothing. It is how Node's own CommonJS loader
 * works, for the same reason.
 */
interface Compiled {
  readonly script: Script;
  readonly fileName: string;
}

type Wrapper = (
  module: { exports: Record<string, unknown> },
  exports: Record<string, unknown>,
  require: (specifier: string) => unknown,
) => void;

/** Transpiling the same text thousands of times was 45% of a run. */
const compileCache = new Map<string, Compiled>();

function compile(source: string, fileName: string): Compiled {
  const key = `${fileName}\u0000${source}`;
  const cached = compileCache.get(key);
  if (cached) return cached;

  const transpiled = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      removeComments: false,
    },
    reportDiagnostics: true,
  });

  const syntaxError = transpiled.diagnostics?.find(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxError) {
    throw new ObstructionError(
      `does not compile: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, " ")}`,
    );
  }

  const compiled: Compiled = {
    script: new Script(
      `(function (module, exports, require) {
${transpiled.outputText}
})`,
      { filename: fileName },
    ),
    fileName,
  };
  compileCache.set(key, compiled);
  return compiled;
}

export interface Sandbox {
  readonly context: Context;
  readonly compiled: Compiled;
  readonly controls: Controls;
  readonly resolver: Resolver | undefined;
  /** Dependencies instantiated for the current instantiation. */
  readonly loaded: Map<string, Record<string, unknown>>;
  /** The module body, compiled once and called per instantiation. */
  readonly wrapper: Wrapper;
  /** Dependency bodies, compiled once each. */
  readonly wrappers: Map<string, Wrapper>;
}

/** Evaluates a compiled wrapper in a context, once. */
function wrapperFor(compiled: Compiled, context: Context): Wrapper {
  return compiled.script.runInContext(context, { timeout: 5000 }) as Wrapper;
}

function globalsFor(controls: Controls): Record<string, unknown> {
  return {
    Date: frozenDate(controls.epochMs),
    Math: seededMath(controls.rngSeed),
    fetch: denied("opens a network connection"),
    XMLHttpRequest: denied("opens a network connection"),
    WebSocket: denied("opens a network connection"),
    setTimeout: denied("schedules work on a timer"),
    setInterval: denied("schedules work on a timer"),
    setImmediate: denied("schedules work on a timer"),
    queueMicrotask: denied("schedules work on a timer"),
    process: Object.freeze({
      env: Object.freeze({}),
      argv: Object.freeze([]),
      platform: "qed",
      hrtime: denied("reads a high-resolution clock"),
    }),
    console: Object.freeze({
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      info: () => undefined,
    }),
  };
}

function requireFrom(
  sandbox: Sandbox,
  specifier: string,
  fromFile: string,
): Record<string, unknown> {
  if (!specifier.startsWith(".")) {
    throw new ObstructionError(`imports ${specifier}`);
  }

  const resolved = sandbox.resolver?.(specifier, fromFile);
  if (!resolved) {
    throw new ObstructionError(`imports ${specifier}, which is not pinned`);
  }

  const already = sandbox.loaded.get(resolved.path);
  if (already) return already;

  const exports: Record<string, unknown> = {};
  // Registered before running, so a cycle sees the partial module rather than
  // recursing until the stack gives out.
  sandbox.loaded.set(resolved.path, exports);

  let wrapper = sandbox.wrappers.get(resolved.path);
  if (!wrapper) {
    wrapper = wrapperFor(compile(resolved.source, resolved.path), sandbox.context);
    sandbox.wrappers.set(resolved.path, wrapper);
  }

  const module = { exports };
  wrapper(module, exports, (next: string) =>
    requireFrom(sandbox, next, resolved.path),
  );

  // A module that reassigns `module.exports` replaces the object registered.
  sandbox.loaded.set(resolved.path, module.exports);
  return module.exports;
}

/**
 * Prepares a module for running. Compiling and building the context happen
 * once; `instantiate` then gives a fresh module state per call.
 */
export function loadModule(
  source: string,
  fileName: string,
  controls: Controls = DEFAULT_CONTROLS,
  resolver?: Resolver,
): Sandbox {
  const compiled = compile(source, fileName);
  const context = createContext(globalsFor(controls));
  const sandbox: Sandbox = {
    context,
    compiled,
    controls,
    resolver,
    loaded: new Map(),
    wrapper: wrapperFor(compiled, context),
    wrappers: new Map(),
  };

  // Prove it loads before anyone asks for a function out of it.
  instantiate(sandbox);
  return sandbox;
}

/**
 * Calls the module body again, which resets everything it declared.
 *
 * Calling the compiled wrapper costs a fraction of a microsecond where
 * building a fresh context costs about 260, and it gives the same isolation:
 * a counter declared with `let` is back at its initial value, because the
 * declaration is function-scoped rather than left in the context. Both claims
 * are covered by tests.
 */
export function instantiate(sandbox: Sandbox): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  sandbox.loaded.clear();

  try {
    sandbox.wrapper(module, module.exports, (specifier: string) =>
      requireFrom(sandbox, specifier, sandbox.compiled.fileName),
    );
  } catch (error) {
    if (error instanceof ObstructionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ObstructionError(`fails to load: ${message}`);
  }
  return module.exports;
}

export interface CallOutcome {
  /** What the call produced, or the error it raised. */
  readonly kind: "returned" | "threw";
  readonly value: unknown;
  /** Set when the call could not be run at all. */
  readonly obstruction?: string;
}

function invoke(
  target: unknown,
  args: readonly unknown[],
  name: string,
): CallOutcome {
  if (typeof target !== "function") {
    return {
      kind: "threw",
      value: undefined,
      obstruction: `exports no function named '${name}'`,
    };
  }
  try {
    const value = (target as (...a: readonly unknown[]) => unknown)(...args);
    if (isThenable(value)) {
      return { kind: "threw", value: undefined, obstruction: "is asynchronous" };
    }
    return { kind: "returned", value };
  } catch (error) {
    if (error instanceof ObstructionError) {
      return { kind: "threw", value: undefined, obstruction: error.obstruction };
    }
    return { kind: "threw", value: describeError(error) };
  }
}

/**
 * Calls one exported function on a module state no previous call has touched.
 *
 * A thrown error is an outcome, not a failure: two versions that throw the
 * same error for the same input agree, and two that throw differently do not.
 */
export function callFunction(
  sandbox: Sandbox,
  name: string,
  args: readonly unknown[],
): CallOutcome {
  let exports: Record<string, unknown>;
  try {
    exports = instantiate(sandbox);
  } catch (error) {
    if (error instanceof ObstructionError) {
      return { kind: "threw", value: undefined, obstruction: error.obstruction };
    }
    throw error;
  }
  return invoke(exports[name], args, name);
}

/**
 * Calls twice on one module state, to see whether anything is carried over.
 * A module-level counter shows up here and nowhere else.
 */
export function callTwice(
  sandbox: Sandbox,
  name: string,
  args: readonly unknown[],
): [CallOutcome, CallOutcome] {
  let exports: Record<string, unknown>;
  try {
    exports = instantiate(sandbox);
  } catch (error) {
    if (error instanceof ObstructionError) {
      const blocked: CallOutcome = {
        kind: "threw",
        value: undefined,
        obstruction: error.obstruction,
      };
      return [blocked, blocked];
    }
    throw error;
  }

  const target = exports[name];
  return [
    invoke(target, structuredClone(args), name),
    invoke(target, structuredClone(args), name),
  ];
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Errors compare by name and message; stacks differ between runs by design.
 *
 * Detected by shape rather than with `instanceof`. An error thrown inside the
 * sandbox is built from *its* realm's `Error`, so `instanceof Error` is false
 * out here - and every thrown error would have been recorded as the useless
 * `{ name: "Thrown", message: "RangeError: nope" }`.
 */
export function describeError(error: unknown): { name: string; message: string } {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const e = error as { name: string; message: string };
    return { name: e.name, message: e.message };
  }
  return { name: "Thrown", message: String(error) };
}
