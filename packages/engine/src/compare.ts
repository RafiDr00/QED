/**
 * Comparing two outcomes.
 *
 * "Print every tolerance. A float epsilon or an unordered-collection
 * comparison weakens the claim. Hiding it would make the document persuasive
 * and worthless." (components/Attestation/README.md)
 *
 * So every comparison that is not exact identity is named here, counted, and
 * handed back to be recorded on the attestation.
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
  const difference = walk(base, head, "", tolerance, applied, new Set());
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

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "regexp";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  return typeof value;
}

function walk(
  base: unknown,
  head: unknown,
  path: string,
  tolerance: Tolerance,
  applied: Set<string>,
  seen: Set<unknown>,
): Difference | undefined {
  if (Object.is(base, head)) return undefined;

  const baseKind = kindOf(base);
  const headKind = kindOf(head);
  if (baseKind !== headKind) {
    return { path, base, head, reason: `${baseKind} became ${headKind}` };
  }

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

  if (base instanceof Date && head instanceof Date) {
    return base.getTime() === head.getTime()
      ? undefined
      : { path, base, head, reason: "a different instant" };
  }

  if (base instanceof RegExp && head instanceof RegExp) {
    return String(base) === String(head)
      ? undefined
      : { path, base, head, reason: "a different pattern" };
  }

  if (typeof base !== "object" || base === null || head === null) {
    return { path, base, head, reason: "differs" };
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
      const d = walk(base[i], head[i], join(path, i), tolerance, applied, seen);
      if (d) return d;
    }
    return undefined;
  }

  if (base instanceof Set && head instanceof Set) {
    applied.add("unordered collection compared by membership");
    if (base.size !== head.size) {
      return { path, base: base.size, head: head.size, reason: "a different size" };
    }
    for (const item of base) {
      if (!head.has(item)) {
        return { path, base: item, head: undefined, reason: "an item is missing" };
      }
    }
    return undefined;
  }

  if (base instanceof Map && head instanceof Map) {
    if (base.size !== head.size) {
      return { path, base: base.size, head: head.size, reason: "a different size" };
    }
    for (const [key, value] of base) {
      if (!head.has(key)) {
        return { path: join(path, String(key)), base: value, head: undefined, reason: "a key is missing" };
      }
      const d = walk(value, head.get(key), join(path, String(key)), tolerance, applied, seen);
      if (d) return d;
    }
    return undefined;
  }

  // What a value is, not just what it holds. Two classes with identical
  // fields are not the same answer: a caller doing `instanceof` can tell,
  // and `structuredClone` would have flattened both to plain objects.
  const baseClass = constructorName(base);
  const headClass = constructorName(head as object);
  if (baseClass !== headClass) {
    return {
      path,
      base: baseClass,
      head: headClass,
      reason: `a ${baseClass} became a ${headClass}`,
    };
  }

  const baseKeys = Object.keys(base).sort();
  const headKeys = Object.keys(head as object).sort();
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
    const d = walk(
      (base as Record<string, unknown>)[key],
      (head as Record<string, unknown>)[key],
      join(path, key),
      tolerance,
      applied,
      seen,
    );
    if (d) return d;
  }
  return undefined;
}

/** A value, printed the way the terminal and the attestation print it. */
export function show(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Set) return `Set(${[...value].map(show).join(", ")})`;
  if (value instanceof Map) {
    return `Map(${[...value].map(([k, v]) => `${show(k)} => ${show(v)}`).join(", ")})`;
  }
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${show(v)}`);
    // Named, because two classes with identical fields are a real difference
    // and "{ cents: 0 } vs { cents: 0 }" tells a reader nothing.
    const name = constructorName(value);
    const prefix = name === "Object" ? "" : `${name} `;
    return `${prefix}{ ${entries.join(", ")} }`;
  }
  if (typeof value === "function") {
    return `[Function ${value.name === "" ? "anonymous" : value.name}]`;
  }
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return "[unprintable]";
}
