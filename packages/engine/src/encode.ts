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

type Tagged = { readonly $: string; readonly v?: unknown };

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
  if (value === null || typeof value !== "object") return value;

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
