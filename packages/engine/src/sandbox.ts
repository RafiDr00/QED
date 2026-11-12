import { createContext, Script, type Context } from "node:vm";
import ts from "typescript";

import { callbacksIn, cloneArgs } from "./encode.js";

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

/**
 * Where a sandbox remembers that something reached outside it.
 *
 * Throwing alone was not enough. Code that wraps a denied call in
 * `try { ... } catch { return fallback }` swallowed the obstruction, both
 * versions returned the fallback, and the pair compared EQUIVALENT on a path
 * that in production reads the network or the clock. The trap is set before
 * the throw, so a caught obstruction is still an obstruction. DECISIONS.md
 * D-049.
 */
export interface Trap {
  obstruction: string | undefined;
}

/** Records the obstruction on the trap, then throws it. */
function obstruct(trap: Trap, obstruction: string): never {
  trap.obstruction ??= obstruction;
  throw new ObstructionError(obstruction);
}

/**
 * What the trap caught since it was last reset.
 *
 * Read through a call so the compiler does not narrow the field to the
 * `undefined` it was reset to: the code that sets it runs in between.
 */
function tripped(sandbox: { readonly trap: Trap }): string | undefined {
  return sandbox.trap.obstruction;
}

/** Anything that reaches outside the function is an obstruction, by name. */
function denied(trap: Trap, obstruction: string): (...args: unknown[]) => never {
  return () => obstruct(trap, obstruction);
}

/**
 * A namespace every member of which is an obstruction.
 *
 * `crypto` and `performance` are objects, not functions: denying them member
 * by member would leave every member nobody listed reading as `undefined`,
 * which both versions agree about.
 */
function deniedNamespace(
  trap: Trap,
  describe: (member: string) => string,
): object {
  return new Proxy(Object.freeze({}), {
    get: (_, member) =>
      typeof member === "symbol" ? undefined : obstruct(trap, describe(member)),
    has: () => true,
  });
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

/* ------------------------------------------------------------------------ */
/* The time budget                                                          */
/* ------------------------------------------------------------------------ */

/** The run went past its time budget. */
export class BudgetExceeded extends Error {
  constructor(readonly ms: number) {
    super(`did not finish within ${ms}ms`);
    this.name = "BudgetExceeded";
  }
}

const GUARD_KEY = Symbol.for("qed.guard");
const guardContext = createContext({});
const guardScript = new Script("globalThis[Symbol.for('qed.guard')]()");

/**
 * Runs `work` under a watchdog that stops it after `ms`.
 *
 * A function that loops forever on one generated input used to hang the
 * whole run, because a call into a context has no timeout of its own. A
 * timeout per call costs a watchdog thread per call - about 120µs, six
 * hundred times the call itself - so the budget is one watchdog around all
 * of one function's verification instead. It stops everything inside it,
 * however deeply nested, and the process carries on. DECISIONS.md D-056.
 */
export function withinBudget<T>(work: () => T, ms: number): T {
  const context = guardContext as Record<symbol, unknown>;
  context[GUARD_KEY] = work;
  try {
    return guardScript.runInContext(guardContext, { timeout: ms }) as T;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      throw new BudgetExceeded(ms);
    }
    throw error;
  } finally {
    context[GUARD_KEY] = undefined;
  }
}

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
      // A .tsx module compiles to calls into `react/jsx-runtime`, which is an
      // import like any other: refused where it is used. Left unset, the JSX
      // was emitted as-is and the module failed to parse at all.
      jsx: ts.JsxEmit.ReactJSX,
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

  let script: Script;
  try {
    script = new Script(
      `(function (module, exports, require) {
${transpiled.outputText}
})`,
      { filename: fileName },
    );
  } catch (error) {
    // Transpiling reports only TypeScript's own syntax errors; what is left
    // for V8 to reject surfaces here, and is the same kind of answer.
    const message = error instanceof Error ? error.message : String(error);
    throw new ObstructionError(`does not compile: ${message}`);
  }
  const compiled: Compiled = { script, fileName };
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
  /** Set when anything denied was reached, even if the code caught it. */
  readonly trap: Trap;
}

/** Evaluates a compiled wrapper in a context, once. */
function wrapperFor(compiled: Compiled, context: Context): Wrapper {
  return compiled.script.runInContext(context, { timeout: 5000 }) as Wrapper;
}

function globalsFor(controls: Controls, trap: Trap): Record<string, unknown> {
  return {
    Date: frozenDate(controls.epochMs),
    Math: seededMath(controls.rngSeed),
    fetch: denied(trap, "opens a network connection"),
    XMLHttpRequest: denied(trap, "opens a network connection"),
    WebSocket: denied(trap, "opens a network connection"),
    setTimeout: denied(trap, "schedules work on a timer"),
    setInterval: denied(trap, "schedules work on a timer"),
    setImmediate: denied(trap, "schedules work on a timer"),
    queueMicrotask: denied(trap, "schedules work on a timer"),
    crypto: deniedNamespace(trap, (member) =>
      member === "randomUUID" || member === "getRandomValues"
        ? "reads a random number"
        : `uses crypto.${member}, which the sandbox does not provide`,
    ),
    performance: deniedNamespace(trap, () => "reads a high-resolution clock"),
    // Deterministic functions pure code legitimately calls. Leaving them out
    // made both versions throw the same ReferenceError, which compared equal.
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    structuredClone,
    atob,
    btoa,
    process: Object.freeze({
      env: Object.freeze({}),
      argv: Object.freeze([]),
      platform: "qed",
      hrtime: denied(trap, "reads a high-resolution clock"),
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

/**
 * An import that is refused when it is used, not when it is loaded.
 *
 * Refusing at load meant one `import { readFileSync } from "node:fs"` made
 * every function in the file abstain - including the ones that never touch
 * it. The compiled module reads an import's members only where the code uses
 * them, so a stand-in that throws on any use refuses exactly the functions
 * that reach for it, with the same words as before. DECISIONS.md D-055.
 */
function deferredImport(sandbox: Sandbox, obstruction: string): unknown {
  const refuse = (): never => obstruct(sandbox.trap, obstruction);
  return new Proxy(function () {}, {
    // Read by module interop helpers and by anything probing for a promise;
    // answering "nothing here" lets the module load.
    get: (_, key) =>
      typeof key === "symbol" || key === "__esModule" || key === "then"
        ? undefined
        : refuse(),
    apply: refuse,
    construct: refuse,
    has: refuse,
    ownKeys: refuse,
    set: refuse,
    defineProperty: refuse,
    deleteProperty: refuse,
    getOwnPropertyDescriptor: refuse,
    getPrototypeOf: refuse,
    setPrototypeOf: refuse,
  });
}

function requireFrom(
  sandbox: Sandbox,
  specifier: string,
  fromFile: string,
): unknown {
  if (!specifier.startsWith(".")) {
    return deferredImport(sandbox, `imports ${specifier}`);
  }

  const resolved = sandbox.resolver?.(specifier, fromFile);
  if (!resolved) {
    return deferredImport(sandbox, `imports ${specifier}, which is not pinned`);
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
  const trap: Trap = { obstruction: undefined };
  const context = createContext(globalsFor(controls, trap));
  const sandbox: Sandbox = {
    context,
    compiled,
    controls,
    resolver,
    loaded: new Map(),
    wrapper: wrapperFor(compiled, context),
    wrappers: new Map(),
    trap,
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
  sandbox.trap.obstruction = undefined;

  try {
    sandbox.wrapper(module, module.exports, (specifier: string) =>
      requireFrom(sandbox, specifier, sandbox.compiled.fileName),
    );
  } catch (error) {
    if (error instanceof ObstructionError) throw error;
    const missing = missingGlobal(error);
    if (missing !== undefined) throw new ObstructionError(missing);
    const message = error instanceof Error ? error.message : String(error);
    throw new ObstructionError(`fails to load: ${message}`);
  }
  // The module body caught a denied call and carried on.
  const caught = tripped(sandbox);
  if (caught !== undefined) throw new ObstructionError(caught);
  return module.exports;
}

export interface CallOutcome {
  /** What the call produced, or the error it raised. */
  readonly kind: "returned" | "threw";
  readonly value: unknown;
  /** Set when the call could not be run at all. */
  readonly obstruction?: string;
  /**
   * Per generated callback in the arguments, the arguments of each call it
   * received. Absent when the arguments held no callback.
   */
  readonly calls?: readonly unknown[][][];
}

/** Invokes on a fresh copy of the arguments and notes what callbacks saw. */
function invokeObserved(
  sandbox: Sandbox,
  target: unknown,
  args: readonly unknown[],
  name: string,
): CallOutcome {
  const copy = cloneArgs(args);
  const outcome = invoke(sandbox, target, copy, name);
  const calls = callbacksIn(copy);
  return calls === undefined || outcome.obstruction !== undefined
    ? outcome
    : { ...outcome, calls };
}

/**
 * Names a JavaScript host provides that this sandbox does not.
 *
 * Anything this process has as a global, plus the browser's. Reaching for one
 * is an environment the function expects and the sandbox lacks - an
 * obstruction - whereas a `ReferenceError` for a name no host defines is a
 * bug in the code, and a version that has one where the other does not has
 * diverged.
 */
const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "self",
  "Deno",
  "Bun",
]);

/**
 * The obstruction a `ReferenceError` stands for, when it is the sandbox's
 * gap rather than the code's bug.
 *
 * Without this, a function calling `crypto.randomUUID()` - or anything else
 * the sandbox did not provide - threw the same ReferenceError on both sides,
 * for every input, and was certified EQUIVALENT with a count. DECISIONS.md
 * D-049.
 */
export function missingGlobal(error: unknown): string | undefined {
  const described = describeError(error);
  if (described.name !== "ReferenceError") return undefined;
  const name = /^(\S+) is not defined$/.exec(described.message)?.[1];
  if (name === undefined) return undefined;
  if (!(name in globalThis) && !BROWSER_GLOBALS.has(name)) return undefined;
  return `reaches for \`${name}\`, which the sandbox does not provide`;
}

/**
 * Why a returned value cannot be compared, if it cannot.
 *
 * A function, a promise or a weak collection carries behaviour or contents
 * that no comparison can reach. Two closures built by two loads of the same
 * code are never identical, so a function returned from both sides used to
 * abstain as "returns a different answer for the same input" - a false
 * reason - and one nested in an object diverged against itself.
 */
export function incomparable(value: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (v: unknown, path: string, depth: number): string | undefined => {
    const at = path === "" ? "" : ` at \`${path}\``;
    if (typeof v === "function") return `returns a function${at}, which cannot be compared`;
    if (typeof v !== "object" || v === null || depth > 12 || seen.has(v)) return undefined;
    seen.add(v);

    const tag = Object.prototype.toString.call(v);
    if (tag === "[object Promise]" || isThenable(v)) {
      silence(v);
      return `returns a promise${at}, which cannot be compared`;
    }
    if (tag === "[object WeakMap]" || tag === "[object WeakSet]" || tag === "[object WeakRef]") {
      return `returns a ${tag.slice(8, -1)}${at}, whose contents cannot be read`;
    }

    const join = (key: string | number) =>
      typeof key === "number" ? `${path}[${key}]` : path === "" ? key : `${path}.${key}`;

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const found = visit(v[i], join(i), depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    if (tag === "[object Map]" || tag === "[object Set]") {
      let i = 0;
      try {
        for (const entry of v as Iterable<unknown>) {
          const found = visit(entry, join(i++), depth + 1);
          if (found) return found;
        }
      } catch {
        // Not iterable after all; the comparison will say what it is.
      }
      return undefined;
    }
    for (const key of Object.keys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const found = visit(descriptor.value, join(key), depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(value, "", 0);
}

function invoke(
  sandbox: Sandbox,
  target: unknown,
  args: readonly unknown[],
  name: string,
): CallOutcome {
  const blocked = (obstruction: string): CallOutcome => ({
    kind: "threw",
    value: undefined,
    obstruction,
  });
  if (typeof target !== "function") {
    return blocked(`exports no function named '${name}'`);
  }

  sandbox.trap.obstruction = undefined;
  let outcome: CallOutcome;
  try {
    const value = (target as (...a: readonly unknown[]) => unknown)(...args);
    if (isThenable(value)) {
      silence(value);
      return blocked("is asynchronous");
    }
    outcome = { kind: "returned", value };
  } catch (error) {
    if (error instanceof ObstructionError) return blocked(error.obstruction);
    const missing = missingGlobal(error);
    if (missing !== undefined) return blocked(missing);
    outcome = { kind: "threw", value: describeError(error) };
  }

  // It reached something denied and caught it: still an obstruction.
  const caught = tripped(sandbox);
  if (caught !== undefined) return blocked(caught);

  if (outcome.kind === "returned") {
    const reason = incomparable(outcome.value);
    if (reason !== undefined) return blocked(reason);
  }
  return outcome;
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
  return invokeObserved(sandbox, exports[name], args, name);
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
    invokeObserved(sandbox, target, args, name),
    invokeObserved(sandbox, target, args, name),
  ];
}

/**
 * Marks a promise the engine will not await as handled.
 *
 * An async function that rejects - often because it reached something denied
 * - left a rejected promise nobody handled, and Node ends the process on one.
 * The verdict already says "is asynchronous"; the rejection is not news.
 * Only a real promise is touched: a hand-written `then` is user code, and
 * calling it would run that code outside any control.
 */
function silence(value: unknown): void {
  if (Object.prototype.toString.call(value) !== "[object Promise]") return;
  try {
    const then: unknown = Reflect.get(Promise.prototype, "then");
    void Reflect.apply(then as (...args: unknown[]) => unknown, value, [undefined, () => undefined]);
  } catch {
    // Not a promise after all.
  }
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
