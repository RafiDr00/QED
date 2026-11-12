/**
 * Comparing two outcomes.
 *
 * "Print every tolerance. A float epsilon or an unordered-collection
 * comparison weakens the claim. Hiding it would make the document persuasive
 * and worthless." (components/Attestation/README.md)
 *
 * So every comparison that is not exact identity is named here, counted, and
 * handed back to be recorded on the attestation.
 *
 * ## Values come from another realm
 *
 * Every value compared here was built inside a `node:vm` context, whose `Map`,
 * `Set`, `RegExp` and `Error` are not this process's. `instanceof Map` is
 * false for every one of them. Classifying by `instanceof` sent a sandbox Map
 * down the plain-object path, where it has no enumerable keys, so any two Maps
 * compared equal and `new Set([1])` agreed with `new Set([2, 3])`. That was a
 * false EQUIVALENT on the most ordinary return types there are.
 *
 * Values are classified by brand check instead: calling this realm's
 * `Map.prototype.has` on an object succeeds exactly when the object has a
 * Map's internal slots, whichever realm made it. DECISIONS.md D-048.
 */

export interface Tolerance {
  /** Absolute difference permitted between two finite numbers. 0 = exact. */
  readonly floatEpsilon: number;
  /**
   * Difference permitted as a fraction of the larger magnitude.
   *
   * Absolute epsilon alone is the wrong tool for money: `n * 3 * 0.1` and
   * `n * 0.3` drift by about 1e-11 at n = 1, and by about 1e-5 at n = 1e6.
   * One epsilon cannot cover both, and picking the loose one would hide a
   * real difference at small magnitudes.
   */
  readonly relativeEpsilon?: number;
}

export const EXACT: Tolerance = { floatEpsilon: 0 };

export interface Difference {
  /** Where, in the shape of the value: "result.lines[2].cents". */
  readonly path: string;
  readonly base: unknown;
  readonly head: unknown;
  readonly reason: string;
}

export interface Comparison {
  readonly equal: boolean;
  readonly difference?: Difference;
  /** Tolerances that were actually applied, not merely offered. */
  readonly applied: readonly string[];
}

/**
 * How deep a comparison goes before it says so.
 *
 * A getter that builds a fresh object each time it is read - a lazily
 * computed linked list - has no cycle for `seen` to catch, and would recurse
 * until the stack gave out. Stopping is a weakening, so it is recorded.
 */
const MAX_DEPTH = 32;

const join = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : path === "" ? key : `${path}.${key}`;

/**
 * Structural equality.
 *
 * Object key order is not a difference: `{a, b}` and `{b, a}` are the same
 * value. Array order is. NaN equals NaN, because two versions that both
 * cannot compute a number agree. +0 and -0 are different, because code that
 * divides by one of them does not agree about infinity.
 */
export function equals(
  base: unknown,
  head: unknown,
  tolerance: Tolerance = EXACT,
): Comparison {
  const applied = new Set<string>();
  const difference = walk(base, head, "", tolerance, applied, new Set(), 0);
  return difference
    ? { equal: false, difference, applied: [...applied] }
    : { equal: true, applied: [...applied] };
}

/** The class a value was built from, as a name both realms agree on. */
function constructorName(value: object): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null) return "null-prototype object";
  const ctor: unknown = (prototype as { constructor?: unknown }).constructor;
  if (typeof ctor !== "function") return "object";
  return ctor.name === "" ? "anonymous class" : ctor.name;
}

/* ------------------------------------------------------------------------ */
/* Brand checks. Each succeeds on an object with the right internal slots,  */
/* from any realm, and on nothing else - a toStringTag can lie, a slot      */
/* cannot.                                                                  */
/* ------------------------------------------------------------------------ */

const branded = (check: () => unknown): boolean => {
  try {
    check();
    return true;
  } catch {
    return false;
  }
};

/** Calls this realm's built-in `method` with `self` as its receiver. */
const intrinsic =
  (method: unknown) =>
  (self: unknown): unknown =>
    Reflect.apply(method as (...args: unknown[]) => unknown, self, []);

/** A built-in getter, as a function of its receiver. */
const getter = (proto: object, name: string) =>
  intrinsic(Reflect.get(Object.getOwnPropertyDescriptor(proto, name) ?? {}, "get"));

const regexpSource = getter(RegExp.prototype, "source");
const bufferLength = getter(ArrayBuffer.prototype, "byteLength");

/** Wrapper objects: `new Number(1)`, `Object("a")` and the like. */
const UNBOX: readonly (readonly [string, (self: unknown) => unknown])[] = [
  ["[object Number]", intrinsic(Reflect.get(Number.prototype, "valueOf"))],
  ["[object String]", intrinsic(Reflect.get(String.prototype, "valueOf"))],
  ["[object Boolean]", intrinsic(Reflect.get(Boolean.prototype, "valueOf"))],
  ["[object BigInt]", intrinsic(Reflect.get(BigInt.prototype, "valueOf"))],
  ["[object Symbol]", intrinsic(Reflect.get(Symbol.prototype, "valueOf"))],
];

type Kind =
  | "null"
  | "array"
  | "date"
  | "regexp"
  | "map"
  | "set"
  | "error"
  | "bytes"
  | "boxed"
  | "object"
  | "undefined"
  | "number"
  | "string"
  | "boolean"
  | "bigint"
  | "symbol"
  | "function";

/**
 * What a value is, decided without `instanceof`.
 *
 * The toStringTag is only a cheap filter: it decides which brand check to
 * try, and the brand check decides.
 */
function kindOf(value: unknown): Kind {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return "array";

  const tag = Object.prototype.toString.call(value);
  switch (tag) {
    case "[object Map]":
      if (branded(() => Map.prototype.has.call(value, undefined))) return "map";
      break;
    case "[object Set]":
      if (branded(() => Set.prototype.has.call(value, undefined))) return "set";
      break;
    case "[object Date]":
      if (branded(() => Date.prototype.getTime.call(value))) return "date";
      break;
    case "[object RegExp]":
      if (branded(() => regexpSource(value))) return "regexp";
      break;
    case "[object Error]":
      return "error";
    case "[object ArrayBuffer]":
      if (branded(() => bufferLength(value))) return "bytes";
      break;
    case "[object DataView]":
      if (ArrayBuffer.isView(value)) return "bytes";
      break;
    default:
      if (UNBOX.some(([t, read]) => t === tag && branded(() => read(value)))) {
        return "boxed";
      }
  }
  return "object";
}

function unbox(value: object): unknown {
  const tag = Object.prototype.toString.call(value);
  const entry = UNBOX.find(([t]) => t === tag);
  return entry ? entry[1](value) : undefined;
}

/** The raw bytes of an ArrayBuffer or a DataView, read through this realm. */
function bytesOf(value: object): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value as ArrayBuffer);
}

const mapEntries = (value: object): [unknown, unknown][] => [
  ...(Map.prototype.entries.call(value) as IterableIterator<[unknown, unknown]>),
];
const setValues = (value: object): unknown[] => [
  ...(Set.prototype.values.call(value) as IterableIterator<unknown>),
];

/** SameValueZero: what `Map#has` and `Set#has` use for a primitive. */
const sameValueZero = (a: unknown, b: unknown): boolean =>
  a === b || (a !== a && b !== b);

const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

/**
 * The source text of each user-written class a value was built from.
 *
 * Native constructors print as `function X() { [native code] }`, so a value
 * whose chain holds only built-ins yields nothing here.
 */
function userClassesOf(value: object): string[] {
  const sources: string[] = [];
  let proto: unknown = Object.getPrototypeOf(value);
  while (proto !== null && typeof proto === "object") {
    const ctor: unknown = (proto as { constructor?: unknown }).constructor;
    if (typeof ctor === "function") {
      const text = Function.prototype.toString.call(ctor);
      if (text.startsWith("class")) sources.push(text);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return sources;
}

/**
 * Getters a class declares, by name, from the value's prototype chain.
 *
 * Only user-written classes are read. A built-in's prototype getters - a
 * typed array's `buffer`, say - describe how a value is stored, not what it
 * is, and comparing them would report two equal arrays as different.
 */
function classGetters(value: object): string[] {
  const names = new Set<string>();
  let proto: unknown = Object.getPrototypeOf(value);
  while (proto !== null && typeof proto === "object") {
    const ctor: unknown = (proto as { constructor?: unknown }).constructor;
    const user =
      typeof ctor === "function" &&
      Function.prototype.toString.call(ctor).startsWith("class");
    if (user) {
      for (const [name, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(proto),
      )) {
        if (name !== "constructor" && typeof descriptor.get === "function") {
          names.add(name);
        }
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names].sort();
}

/**
 * Reads a property the way a caller would, keeping a throw as an outcome.
 * A getter that throws on one side and returns on the other is a difference.
 */
function read(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch (error) {
    const e = error as { name?: unknown; message?: unknown } | null;
    return {
      threw: typeof e?.name === "string" ? e.name : "Thrown",
      message: typeof e?.message === "string" ? e.message : String(error),
    };
  }
}

/** Enumerable symbol-keyed properties, keyed by description. */
function symbolEntries(value: object): [string, unknown][] {
  return Object.getOwnPropertySymbols(value)
    .filter((s) => Object.prototype.propertyIsEnumerable.call(value, s))
    .map((s): [string, unknown] => [Symbol.prototype.toString.call(s), read(value, s)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * True when one of the value's classes declares a `#private` member.
 *
 * Private fields cannot be read from outside the class, by design of the
 * language - so a comparison of such a value is a comparison of what it
 * exposes. That is a weakening, and it is recorded. A `#` inside a string in
 * the class body also matches; that over-reports a weakening, which is the
 * safe direction.
 */
const hasPrivateState = (value: object): boolean =>
  userClassesOf(value).some((source) => /#[A-Za-z_$]/.test(source));

function walk(
  base: unknown,
  head: unknown,
  path: string,
  tolerance: Tolerance,
  applied: Set<string>,
  seen: Set<unknown>,
  depth: number,
): Difference | undefined {
  if (Object.is(base, head)) return undefined;
  if (depth > MAX_DEPTH) {
    applied.add(`compared to a depth of ${MAX_DEPTH}`);
    return undefined;
  }

  const baseKind = kindOf(base);
  const headKind = kindOf(head);
  if (baseKind !== headKind) {
    return { path, base, head, reason: `${baseKind} became ${headKind}` };
  }

  const next = (b: unknown, h: unknown, at: string) =>
    walk(b, h, at, tolerance, applied, seen, depth + 1);

  if (typeof base === "number" && typeof head === "number") {
    if (Number.isNaN(base) && Number.isNaN(head)) return undefined;
    // Signed zero, before the subtraction below makes them look identical:
    // 1/0 is Infinity and 1/-0 is -Infinity, so code downstream can tell.
    if (base === 0 && head === 0 && !Object.is(base, head)) {
      return {
        path,
        base,
        head,
        reason: `${Object.is(base, -0) ? "-0 became 0" : "0 became -0"} (they divide differently)`,
      };
    }
    if (Number.isFinite(base) && Number.isFinite(head)) {
      const delta = Math.abs(base - head);
      if (delta === 0) return undefined;
      if (tolerance.floatEpsilon > 0 && delta <= tolerance.floatEpsilon) {
        applied.add(`float ε ${tolerance.floatEpsilon}`);
        return undefined;
      }
      const relative = tolerance.relativeEpsilon ?? 0;
      if (relative > 0) {
        const scale = Math.max(Math.abs(base), Math.abs(head));
        if (delta <= relative * scale) {
          applied.add(`float ε ${relative} relative`);
          return undefined;
        }
      }
      return { path, base, head, reason: `differs by ${delta}` };
    }
    return { path, base, head, reason: "differs" };
  }

  if (!isObjectLike(base) || !isObjectLike(head) || typeof base === "function") {
    return { path, base, head, reason: "differs" };
  }

  switch (baseKind) {
    case "date":
      return Date.prototype.getTime.call(base) === Date.prototype.getTime.call(head) ||
        (Number.isNaN(Date.prototype.getTime.call(base)) &&
          Number.isNaN(Date.prototype.getTime.call(head)))
        ? undefined
        : { path, base, head, reason: "a different instant" };

    case "regexp":
      return RegExp.prototype.toString.call(base) === RegExp.prototype.toString.call(head)
        ? undefined
        : { path, base, head, reason: "a different pattern" };

    case "boxed":
      return next(unbox(base), unbox(head), path);

    case "bytes": {
      const baseClass = constructorName(base);
      const headClass = constructorName(head);
      if (baseClass !== headClass) {
        return { path, base: baseClass, head: headClass, reason: `a ${baseClass} became a ${headClass}` };
      }
      const a = bytesOf(base);
      const b = bytesOf(head);
      if (a.length !== b.length) {
        return { path, base: a.length, head: b.length, reason: `${a.length} bytes became ${b.length}` };
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          return { path: join(path, i), base: a[i], head: b[i], reason: "a different byte" };
        }
      }
      return undefined;
    }

    default:
      break;
  }

  // Cycles: a value already being compared along this path cannot disagree
  // with itself without the difference showing up somewhere shallower.
  if (seen.has(base)) return undefined;
  seen.add(base);

  if (Array.isArray(base) && Array.isArray(head)) {
    if (base.length !== head.length) {
      return {
        path,
        base: base.length,
        head: head.length,
        reason: `${base.length} items became ${head.length}`,
      };
    }
    for (let i = 0; i < base.length; i++) {
      const d = next(base[i], head[i], join(path, i));
      if (d) return d;
    }
    return undefined;
  }

  if (baseKind === "set") return compareSets(base, head, path, tolerance, applied, depth);
  if (baseKind === "map") return compareMaps(base, head, path, tolerance, applied, seen, depth);

  // An error's name and message are not enumerable, so the key comparison
  // below never saw them: two returned errors with different messages agreed.
  if (baseKind === "error") {
    for (const key of ["name", "message"] as const) {
      const d = next(String(read(base, key)), String(read(head, key)), join(path, key));
      if (d) return d;
    }
  }

  // What a value is, not just what it holds. Two classes with identical
  // fields are not the same answer: a caller doing `instanceof` can tell,
  // and `structuredClone` would have flattened both to plain objects.
  const baseClass = constructorName(base);
  const headClass = constructorName(head);
  if (baseClass !== headClass) {
    return {
      path,
      base: baseClass,
      head: headClass,
      reason: `a ${baseClass} became a ${headClass}`,
    };
  }

  const baseKeys = Object.keys(base).sort();
  const headKeys = Object.keys(head).sort();
  if (baseKeys.join("\u0000") !== headKeys.join("\u0000")) {
    const missing = baseKeys.filter((k) => !headKeys.includes(k));
    const added = headKeys.filter((k) => !baseKeys.includes(k));
    return {
      path,
      base: baseKeys,
      head: headKeys,
      reason:
        missing.length > 0
          ? `no longer has '${missing[0] ?? ""}'`
          : `now has '${added[0] ?? ""}'`,
    };
  }

  for (const key of baseKeys) {
    const d = next(read(base, key), read(head, key), join(path, key));
    if (d) return d;
  }

  // Symbol-keyed properties. Each version's symbols are its own - `Symbol("k")`
  // in one sandbox is not the one in the other - so they pair by description.
  const baseSymbols = symbolEntries(base);
  const headSymbols = symbolEntries(head);
  const baseNames = baseSymbols.map(([name]) => name);
  const headNames = headSymbols.map(([name]) => name);
  if (baseNames.join("\u0000") !== headNames.join("\u0000")) {
    return { path, base: baseNames, head: headNames, reason: "a different set of symbol keys" };
  }
  for (let i = 0; i < baseSymbols.length; i++) {
    const [name, value] = baseSymbols[i] ?? ["", undefined];
    const d = next(value, headSymbols[i]?.[1], join(path, `[${name}]`));
    if (d) return d;
  }

  // What a class exposes through getters is part of what it is. Without this
  // a class keeping its state behind `get cents()` compared as an empty
  // object, so doubling the state it reported agreed with the original.
  for (const name of classGetters(base)) {
    if (baseKeys.includes(name)) continue;
    const d = next(read(base, name), read(head, name), join(path, name));
    if (d) return d;
  }

  if (hasPrivateState(base) || hasPrivateState(head)) {
    applied.add(`private fields of ${baseClass} not compared`);
  }
  return undefined;
}

function compareSets(
  base: object,
  head: object,
  path: string,
  tolerance: Tolerance,
  applied: Set<string>,
  depth: number,
): Difference | undefined {
  applied.add("unordered collection compared by membership");
  const baseItems = setValues(base);
  const headItems = setValues(head);
  if (baseItems.length !== headItems.length) {
    return {
      path,
      base: baseItems.length,
      head: headItems.length,
      reason: "a different size",
    };
  }

  const unmatched = [...headItems];
  for (const item of baseItems) {
    const index = matchIndex(item, unmatched, tolerance, applied, depth);
    if (index === -1) {
      return { path, base: item, head: undefined, reason: "an item is missing" };
    }
    unmatched.splice(index, 1);
  }
  return undefined;
}

function compareMaps(
  base: object,
  head: object,
  path: string,
  tolerance: Tolerance,
  applied: Set<string>,
  seen: Set<unknown>,
  depth: number,
): Difference | undefined {
  const baseEntries = mapEntries(base);
  const headEntries = mapEntries(head);
  if (baseEntries.length !== headEntries.length) {
    return {
      path,
      base: baseEntries.length,
      head: headEntries.length,
      reason: "a different size",
    };
  }

  const unmatched = [...headEntries];
  for (const [key, value] of baseEntries) {
    const index = matchIndex(
      key,
      unmatched.map(([k]) => k),
      tolerance,
      applied,
      depth,
    );
    const at = join(path, isObjectLike(key) ? show(key) : String(key));
    if (index === -1) {
      return { path: at, base: value, head: undefined, reason: "a key is missing" };
    }
    const [, other] = unmatched[index] ?? [undefined, undefined];
    unmatched.splice(index, 1);
    const d = walk(value, other, at, tolerance, applied, seen, depth + 1);
    if (d) return d;
  }
  return undefined;
}

/**
 * Where in `candidates` an equal of `item` is, or -1.
 *
 * A primitive matches the way `has` would. An object cannot: the two versions
 * built their objects separately, so no object from one is ever identical to
 * one from the other, and identity would report every object-keyed Map as
 * different. Objects match by structure, and that is recorded.
 */
function matchIndex(
  item: unknown,
  candidates: readonly unknown[],
  tolerance: Tolerance,
  applied: Set<string>,
  depth: number,
): number {
  if (!isObjectLike(item)) {
    return candidates.findIndex((c) => sameValueZero(item, c));
  }
  for (let i = 0; i < candidates.length; i++) {
    const trial = new Set<string>();
    if (walk(item, candidates[i], "", tolerance, trial, new Set(), depth + 1) === undefined) {
      for (const t of trial) applied.add(t);
      applied.add("collection members matched by structure");
      return i;
    }
  }
  return -1;
}

/** A value, printed the way the terminal and the attestation print it. */
export function show(value: unknown): string {
  return showAt(value, 0);
}

function showAt(value: unknown, depth: number): string {
  if (depth > 8) return "…";
  const inner = (v: unknown) => showAt(v, depth + 1);

  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") {
    return `[Function ${value.name === "" ? "anonymous" : value.name}]`;
  }
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (typeof value !== "object") return "[unprintable]";

  switch (kindOf(value)) {
    case "set":
      return `Set(${setValues(value).map(inner).join(", ")})`;
    case "map":
      return `Map(${mapEntries(value)
        .map(([k, v]) => `${inner(k)} => ${inner(v)}`)
        .join(", ")})`;
    case "date": {
      const time = Date.prototype.getTime.call(value);
      return Number.isNaN(time)
        ? "Date(Invalid)"
        : `Date(${new Date(time).toISOString()})`;
    }
    case "regexp":
      return RegExp.prototype.toString.call(value);
    case "error":
      return `${String(read(value, "name"))}(${JSON.stringify(String(read(value, "message")))})`;
    case "boxed":
      return `${constructorName(value)}(${inner(unbox(value))})`;
    case "bytes":
      return `${constructorName(value)}(${bytesOf(value).length} bytes)`;
    default:
      break;
  }

  if (Array.isArray(value)) return `[${value.map(inner).join(", ")}]`;
  const entries = Object.keys(value).map((k) => `${k}: ${inner(read(value, k))}`);
  // Named, because two classes with identical fields are a real difference
  // and "{ cents: 0 } vs { cents: 0 }" tells a reader nothing.
  const name = constructorName(value);
  const prefix = name === "Object" ? "" : `${name} `;
  for (const getter of classGetters(value)) {
    if (!entries.some((e) => e.startsWith(`${getter}: `))) {
      entries.push(`${getter}: ${inner(read(value, getter))}`);
    }
  }
  return `${prefix}{ ${entries.join(", ")} }`;
}
