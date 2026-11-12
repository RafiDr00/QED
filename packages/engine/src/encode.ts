/**
 * A lossless encoding for the values a counterexample is made of.
 *
 * "The repro line is a complete command, copyable without editing."
 * (components/Terminal/README.md)
 *
 * `JSON.stringify` cannot keep that promise. It turns NaN and both infinities
 * into `null`, drops `undefined`, flattens `-0` to `0`, refuses BigInt
 * outright, and reduces a Date, a Map or a Set to something that no longer
 * behaves like one. A counterexample found at NaN printed
 * `--input '[null]'`, which reproduces nothing - the command looked complete
 * and silently was not.
 *
 * Everything the generator can produce round-trips through here.
 */

type Tagged = { readonly $: string; readonly v?: unknown; readonly t?: string };

/* ------------------------------------------------------------------------ */
/* Generated callbacks                                                      */
/* ------------------------------------------------------------------------ */

/**
 * A function the generator made for a function-typed parameter.
 *
 * It returns a fixed value - a fresh copy each call, so one call's caller
 * cannot mutate what the next receives - and it records every call it
 * receives. The calls are part of the outcome: a version that calls back
 * twice where the other calls once has changed what a caller sees, even if
 * both return the same thing. DECISIONS.md D-053.
 */
interface Callback {
  /** What every call returns, encoded. */
  readonly returns: unknown;
  /** The arguments of every call, in order. */
  readonly calls: unknown[][];
}

const CALLBACKS = new WeakMap<object, Callback>();

function callbackFromEncoded(returns: unknown): (...args: unknown[]) => unknown {
  const calls: unknown[][] = [];
  const fn = function (...args: unknown[]): unknown {
    calls.push(args);
    return decodeValue(returns);
  };
  const shown = JSON.stringify(returns);
  Object.defineProperty(fn, "name", {
    value: `returning ${shown === '{"$":"undefined"}' ? "undefined" : shown}`,
  });
  CALLBACKS.set(fn, { returns, calls });
  return fn;
}

/** A callback that returns `value` on every call and records each one. */
export function makeCallback(value: unknown): (...args: unknown[]) => unknown {
  return callbackFromEncoded(encodeValue(value, 0));
}

/**
 * The calls every generated callback inside `args` received, in the order
 * the callbacks appear in the arguments. Undefined when there are none, so
 * a function without callbacks has an outcome exactly as before.
 */
export function callbacksIn(args: readonly unknown[]): unknown[][][] | undefined {
  const found: unknown[][][] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (typeof value === "function") {
      const callback = CALLBACKS.get(value);
      if (callback) found.push(callback.calls);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      for (const [k, v] of value) {
        visit(k);
        visit(v);
      }
    } else if (value instanceof Set || Array.isArray(value)) {
      for (const item of value as Iterable<unknown>) visit(item);
    } else {
      for (const inner of Object.values(value)) visit(inner);
    }
  };
  args.forEach(visit);
  return found.length > 0 ? found : undefined;
}

const TYPED_ARRAYS: Readonly<Record<string, new (values: ArrayLike<unknown>) => unknown>> = {
  Int8Array: Int8Array,
  Uint8Array: Uint8Array,
  Uint8ClampedArray: Uint8ClampedArray,
  Int16Array: Int16Array,
  Uint16Array: Uint16Array,
  Int32Array: Int32Array,
  Uint32Array: Uint32Array,
  Float32Array: Float32Array,
  Float64Array: Float64Array,
  BigInt64Array: BigInt64Array,
  BigUint64Array: BigUint64Array,
};

function encodeValue(value: unknown, depth: number): unknown {
  if (depth > 12) return { $: "depth" } satisfies Tagged;

  if (value === undefined) return { $: "undefined" } satisfies Tagged;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $: "NaN" } satisfies Tagged;
    if (value === Infinity) return { $: "Infinity" } satisfies Tagged;
    if (value === -Infinity) return { $: "-Infinity" } satisfies Tagged;
    // -0 divides differently from 0, which is a difference the comparator
    // reports, so the encoding has to keep it.
    if (Object.is(value, -0)) return { $: "-0" } satisfies Tagged;
    return value;
  }
  if (typeof value === "bigint") {
    return { $: "bigint", v: value.toString() } satisfies Tagged;
  }
  if (typeof value === "function") {
    // Only the generator puts functions in arguments, and it registers each.
    const callback = CALLBACKS.get(value);
    return { $: "fn", v: callback ? callback.returns : { $: "undefined" } } satisfies Tagged;
  }
  if (value === null || typeof value !== "object") return value;

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name;
    return {
      $: "typed",
      t: name,
      v: [...(value as unknown as Iterable<unknown>)].map((item) => encodeValue(item, depth + 1)),
    } satisfies Tagged;
  }
  if (value instanceof Date) {
    return { $: "Date", v: value.getTime() } satisfies Tagged;
  }
  if (value instanceof Set) {
    return {
      $: "Set",
      v: [...value].map((item) => encodeValue(item, depth + 1)),
    } satisfies Tagged;
  }
  if (value instanceof Map) {
    return {
      $: "Map",
      v: [...value].map(([k, v]) => [
        encodeValue(k, depth + 1),
        encodeValue(v, depth + 1),
      ]),
    } satisfies Tagged;
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = encodeValue(inner, depth + 1);
  }
  // A plain object whose own key is "$" would be read back as a tag.
  return Object.hasOwn(out, "$") ? { $: "object", v: out } : out;
}

function decodeEntries(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = decodeValue(inner);
  }
  return out;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value === null || typeof value !== "object") return value;

  const tag = value as Tagged;
  switch (tag.$) {
    case "undefined":
      return undefined;
    case "NaN":
      return Number.NaN;
    case "Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "-0":
      return -0;
    case "bigint":
      return BigInt(String(tag.v));
    case "Date":
      return new Date(Number(tag.v));
    case "Set":
      return new Set((tag.v as unknown[]).map(decodeValue));
    case "Map":
      return new Map(
        (tag.v as [unknown, unknown][]).map(([k, v]) => [
          decodeValue(k),
          decodeValue(v),
        ]),
      );
    case "fn":
      return callbackFromEncoded(tag.v);
    case "typed": {
      const Typed = TYPED_ARRAYS[String(tag.t)];
      if (Typed === undefined) break;
      return new Typed((tag.v as unknown[]).map(decodeValue));
    }
    case "object":
      // Decode the entries, not the wrapper: running decodeValue on the inner
      // object would read its own "$" key as a tag again and turn an escaped
      // { $: "NaN" } back into NaN.
      return decodeEntries(tag.v as object);
    default:
      break;
  }

  return decodeEntries(value);
}

/** The argument list, as text a shell can carry and this module can read back. */
export function encodeArgs(args: readonly unknown[]): string {
  return JSON.stringify(args.map((arg) => encodeValue(arg, 0)));
}

export function decodeArgs(text: string): unknown[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
  return parsed.map(decodeValue);
}

/**
 * A fresh copy of an argument list, made through the repro encoding.
 *
 * Every call gets its own copy, so a function that mutates its input cannot
 * hand the next call a different one. Copying through the encoding rather
 * than with `structuredClone` keeps generated callbacks, which
 * `structuredClone` refuses, and means the arguments a call ran with are
 * exactly what its repro line reproduces.
 */
export function cloneArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => decodeValue(encodeValue(arg, 0)));
}
