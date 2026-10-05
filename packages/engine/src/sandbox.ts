import { createContext, runInContext } from "node:vm";
import ts from "typescript";

/**
 * The determinism controls, as the design system names them: "clock frozen,
 * rng seed 0x5f3a, network denied, overlay fs".
 *
 * A function is run inside a fresh context whose ambient state we own
 * completely. Anything the function reaches for that we did not put there -
 * a module, a socket, the real clock - fails loudly rather than quietly
 * producing a result that happens to match today.
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
    // Read through the descriptor: taking `Math[key]` and binding it is the
    // same thing, but detaching a method from its object first is a pattern
    // worth not writing even when it happens to be safe here.
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
  // Instances must still be real Dates: `x instanceof Date` and every method
  // on the prototype has to keep working inside the sandbox.
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

export interface Sandbox {
  /** The module's exports, as the sandbox sees them. */
  readonly exports: Record<string, unknown>;
  readonly controls: Controls;
}

/**
 * Transpiles a TypeScript or JavaScript module and evaluates it in a context
 * with the controls applied.
 *
 * `import` and `require` are denied rather than resolved. That is a real
 * limit, and it is reported as an obstruction instead of being papered over:
 * a function whose behaviour depends on another module cannot be compared in
 * isolation without that module's behaviour being pinned too.
 */
export function loadModule(
  source: string,
  fileName: string,
  controls: Controls = DEFAULT_CONTROLS,
): Sandbox {
  const transpiled = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      // Keep the shape of what the author wrote; this is not a build.
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

  const moduleShim = { exports: {} as Record<string, unknown> };
  const sandboxGlobals: Record<string, unknown> = {
    module: moduleShim,
    exports: moduleShim.exports,
    require: denied("imports a module"),
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
      // The real one would let a function read the clock sideways.
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

  const context = createContext(sandboxGlobals);
  try {
    runInContext(transpiled.outputText, context, {
      filename: fileName,
      timeout: 5000,
    });
  } catch (error) {
    if (error instanceof ObstructionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ObstructionError(`fails to load: ${message}`);
  }

  return { exports: moduleShim.exports, controls };
}

export interface CallOutcome {
  /** What the call produced, or the error it raised. */
  readonly kind: "returned" | "threw";
  readonly value: unknown;
  /** Set when the call could not be run at all. */
  readonly obstruction?: string;
}

/**
 * Calls one exported function with one set of arguments.
 *
 * A thrown error is an outcome, not a failure: two versions that throw the
 * same error for the same input agree, and two that throw differently do not.
 */
export function callFunction(
  sandbox: Sandbox,
  name: string,
  args: readonly unknown[],
): CallOutcome {
  const target = sandbox.exports[name];
  if (typeof target !== "function") {
    return {
      kind: "threw",
      value: undefined,
      obstruction: `exports no function named '${name}'`,
    };
  }

  try {
    const value = (target as (...a: readonly unknown[]) => unknown)(...args);
    if (value instanceof Promise || isThenable(value)) {
      return {
        kind: "threw",
        value: undefined,
        obstruction: "is asynchronous",
      };
    }
    return { kind: "returned", value };
  } catch (error) {
    if (error instanceof ObstructionError) {
      return { kind: "threw", value: undefined, obstruction: error.obstruction };
    }
    return { kind: "threw", value: describeError(error) };
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
 * `{ name: "Thrown", message: "RangeError: nope" }`, making two versions that
 * throw differently look like they agree on the error's name.
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
