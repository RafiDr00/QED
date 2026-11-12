import fc from "fast-check";
import ts from "typescript";

import { makeCallback } from "./encode.js";
import type { Corpus } from "./generate.js";
import { libText, ROOT_LIB } from "./libs.js";
import type { Resolver } from "./sandbox.js";

/**
 * Inputs from what a type *is*, as the TypeScript checker resolves it.
 *
 * The first generator read types as they were written. It knew a locally
 * declared interface, but not one imported from `./types`, nor `Partial`,
 * `Pick`, `Record` with literal keys, an intersection, a branded number, or
 * `Date`. Each of those abstained, and together they are most of the
 * parameters in real business code - every function QED changed in its own
 * repository abstained on one of them.
 *
 * The checker already knows what each of those means. It runs over the
 * module and every relative import the resolver pins, at the revision being
 * compared, against the standard library and nothing else. DECISIONS.md
 * D-052.
 */

/**
 * A type the generator cannot build, with the clause a reader is shown and
 * where inside the parameter it was met.
 *
 * Without the place, a parameter whose one nested field was `unknown` read
 * as though the whole parameter were `any`.
 */
export class Unsupported extends Error {
  constructor(
    readonly detail: string,
    readonly path: readonly string[] = [],
  ) {
    super(detail);
  }

  /** The same refusal, one level further out. */
  within(segment: string): Unsupported {
    return new Unsupported(this.detail, [segment, ...this.path]);
  }

  /** "conditions[].value", or "" at the top. */
  get where(): string {
    return this.path.reduce(
      (out, segment) => (segment.startsWith("[") || out === "" ? `${out}${segment}` : `${out}.${segment}`),
      "",
    );
  }
}

/** Builds `make()`, attributing any refusal to `segment`. */
function inside<T>(segment: string, make: () => T): T {
  try {
    return make();
  } catch (error) {
    if (error instanceof Unsupported) throw error.within(segment);
    throw error;
  }
}

/* ------------------------------------------------------------------------ */
/* The program                                                              */
/* ------------------------------------------------------------------------ */

const LIB_DIR = "/__lib__";

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  allowJs: true,
  skipLibCheck: true,
  lib: [ROOT_LIB],
  types: [],
};

/**
 * Lib files, parsed once per process.
 *
 * A program reuses a SourceFile it is handed, and the binder skips one it has
 * already bound, so every program after the first costs only the user's
 * files.
 */
const libFiles = new Map<string, ts.SourceFile | undefined>();

function libSourceFile(path: string): ts.SourceFile | undefined {
  if (libFiles.has(path)) return libFiles.get(path);
  const text = libText(path.slice(LIB_DIR.length + 1));
  const file =
    text === undefined
      ? undefined
      : ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);
  libFiles.set(path, file);
  return file;
}

function extensionOf(path: string): ts.Extension {
  if (path.endsWith(".d.ts")) return ts.Extension.Dts;
  if (path.endsWith(".tsx")) return ts.Extension.Tsx;
  if (path.endsWith(".mts")) return ts.Extension.Mts;
  if (path.endsWith(".cts")) return ts.Extension.Cts;
  if (path.endsWith(".mjs")) return ts.Extension.Mjs;
  if (path.endsWith(".cjs")) return ts.Extension.Cjs;
  if (path.endsWith(".js") || path.endsWith(".jsx")) return ts.Extension.Js;
  return ts.Extension.Ts;
}

function scriptKindOf(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(m|c)?js$/.test(path)) return ts.ScriptKind.JS;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

export interface Checked {
  readonly checker: ts.TypeChecker;
  /** The module under test, as the program parsed it. */
  readonly file: ts.SourceFile;
}

/**
 * Programs already built, per resolver, by module text.
 *
 * One run asks for the same module once per exported function; building the
 * program once per module keeps that to one checker.
 */
const programs = new WeakMap<object, Map<string, Checked>>();
const unresolved = new Map<string, Checked>();
const PROGRAM_CACHE = 32;

export function checkedProgram(
  source: string,
  fileName: string,
  resolver?: Resolver,
): Checked {
  const cache = resolver === undefined ? unresolved : programs.get(resolver) ?? new Map<string, Checked>();
  if (resolver !== undefined) programs.set(resolver, cache);
  const key = `${fileName}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rootPath = `/${fileName.replace(/^\/+/, "")}`;
  const files = new Map<string, string>([[rootPath, source]]);

  const host: ts.CompilerHost = {
    getSourceFile: (path) => {
      if (path.startsWith(`${LIB_DIR}/`)) return libSourceFile(path);
      const text = files.get(path);
      return text === undefined
        ? undefined
        : ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, scriptKindOf(path));
    },
    getDefaultLibFileName: () => `${LIB_DIR}/${ROOT_LIB}`,
    getDefaultLibLocation: () => LIB_DIR,
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (path) =>
      files.has(path) ||
      (path.startsWith(`${LIB_DIR}/`) && libSourceFile(path) !== undefined),
    readFile: (path) =>
      files.get(path) ??
      (path.startsWith(`${LIB_DIR}/`) ? libText(path.slice(LIB_DIR.length + 1)) : undefined),
    // Relative imports resolve through the same resolver the sandbox pins
    // them with, so the checker reads each dependency at the revision the
    // function will run against. Anything else resolves to nothing, and a
    // type taken from it is reported by name.
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map((literal) => {
        const specifier = literal.text;
        if (!specifier.startsWith(".") || resolver === undefined) {
          return { resolvedModule: undefined };
        }
        const resolved = resolver(specifier, containingFile.replace(/^\/+/, ""));
        if (!resolved) return { resolvedModule: undefined };
        const path = `/${resolved.path.replace(/^\/+/, "")}`;
        files.set(path, resolved.source);
        return {
          resolvedModule: {
            resolvedFileName: path,
            extension: extensionOf(path),
            isExternalLibraryImport: false,
          },
        };
      }),
  };

  const program = ts.createProgram({ rootNames: [rootPath], options: OPTIONS, host });
  const file = program.getSourceFile(rootPath);
  if (!file) throw new Error(`the checker could not read ${fileName}`);
  const checked: Checked = { checker: program.getTypeChecker(), file };

  if (cache.size >= PROGRAM_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, checked);
  return checked;
}

/* ------------------------------------------------------------------------ */
/* Types to arbitraries                                                     */
/* ------------------------------------------------------------------------ */

export interface TypeContext {
  readonly checker: ts.TypeChecker;
  readonly corpus: Corpus;
  /** Where property types are read from. */
  readonly at: ts.Node;
  /** Object types being built right now, to see a type that contains itself. */
  readonly building?: Set<ts.Type>;
}

/**
 * How many levels of data - objects, arrays, tuples - a value may nest.
 * A union is a choice, not a level, and does not count.
 */
const MAX_DEPTH = 8;

/** Numbers that a money or a count routine would actually meet, plus the edges. */
export const numberArbitrary = (corpus: Corpus): fc.Arbitrary<number> =>
  fc.oneof(
    ...(corpus.numbers.length > 0
      ? [{ weight: 5, arbitrary: fc.constantFrom(...corpus.numbers) }]
      : []),
    { weight: 6, arbitrary: fc.integer({ min: -1_000_000, max: 1_000_000 }) },
    { weight: 3, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        0,
        -0,
        1,
        -1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.EPSILON,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ),
    },
  );

export const stringArbitrary = (corpus: Corpus): fc.Arbitrary<string> =>
  corpus.strings.length > 0
    ? fc.oneof(
        { weight: 5, arbitrary: fc.constantFrom(...corpus.strings) },
        { weight: 3, arbitrary: fc.string() },
      )
    : fc.string();

const ANY_MESSAGE = "is `any`, so there is no shape to generate from";

const isErrorType = (type: ts.Type): boolean =>
  (type.flags & ts.TypeFlags.Any) !== 0 &&
  (type as { intrinsicName?: string }).intrinsicName === "error";

const PRIMITIVE =
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.StringLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike;

/** The type with `undefined` taken out of it, for an optional member. */
function withoutUndefined(type: ts.Type): ts.Type[] {
  if (!type.isUnion()) return [type];
  return type.types.filter((t) => (t.flags & ts.TypeFlags.Undefined) === 0);
}

/**
 * Whether the type is one the standard library names: `Date`, `Map`,
 * `Promise`. A mapped type the library declares - `Partial`, `Pick`,
 * `Record` - is anonymous, and is read by its properties like any other
 * object type.
 */
function fromLib(type: ts.Type): boolean {
  const symbol = type.getSymbol();
  if (!symbol || !(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class))) {
    return false;
  }
  const declaration = symbol.declarations?.[0];
  return declaration?.getSourceFile().fileName.startsWith(`${LIB_DIR}/`) ?? false;
}

const TYPED_ARRAYS: Readonly<Record<string, () => fc.Arbitrary<unknown>>> = {
  Int8Array: () => fc.int8Array({ maxLength: 16 }),
  Uint8Array: () => fc.uint8Array({ maxLength: 16 }),
  Uint8ClampedArray: () => fc.uint8ClampedArray({ maxLength: 16 }),
  Int16Array: () => fc.int16Array({ maxLength: 16 }),
  Uint16Array: () => fc.uint16Array({ maxLength: 16 }),
  Int32Array: () => fc.int32Array({ maxLength: 16 }),
  Uint32Array: () => fc.uint32Array({ maxLength: 16 }),
  Float32Array: () => fc.float32Array({ maxLength: 16 }),
  Float64Array: () => fc.float64Array({ maxLength: 16 }),
};

/** Dates a ledger meets: 1970 to 2100, never the invalid one. */
const dateArbitrary = (): fc.Arbitrary<Date> =>
  fc.date({
    min: new Date(Date.UTC(1970, 0, 1)),
    max: new Date(Date.UTC(2100, 0, 1)),
    noInvalidDate: true,
  });

/**
 * The generator for one type.
 *
 * `written` is how the type was spelled where it was declared, so a type the
 * checker could not resolve is named the way the reader wrote it - "is
 * `Buffer`" - rather than as the `any` it degraded to.
 */
export function arbitraryForType(
  type: ts.Type,
  ctx: TypeContext,
  depth = 0,
  written?: string,
): fc.Arbitrary<unknown> {
  if (depth > MAX_DEPTH) throw new Unsupported("nests too deeply to generate");
  const { checker } = ctx;
  const flags = type.flags;
  const name = written ?? checker.typeToString(type);

  if (isErrorType(type)) {
    throw new Unsupported(`is \`${name}\`, which QED cannot generate`);
  }
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) throw new Unsupported(ANY_MESSAGE);
  if (flags & ts.TypeFlags.NonPrimitive) {
    throw new Unsupported("is `object`, so there is no shape to generate from");
  }
  if (flags & (ts.TypeFlags.Void | ts.TypeFlags.Never)) {
    throw new Unsupported("cannot hold a value");
  }
  if (flags & ts.TypeFlags.Boolean) return fc.boolean();
  if (type.isNumberLiteral()) return fc.constant(type.value);
  if (type.isStringLiteral()) return fc.constant(type.value);
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return fc.constant((type as { intrinsicName?: string }).intrinsicName === "true");
  }
  if (flags & ts.TypeFlags.BigIntLiteral) {
    const { negative, base10Value } = (type as ts.BigIntLiteralType).value;
    return fc.constant(BigInt(`${negative ? "-" : ""}${base10Value}`));
  }
  if (flags & ts.TypeFlags.Number) return numberArbitrary(ctx.corpus);
  if (flags & ts.TypeFlags.String) return stringArbitrary(ctx.corpus);
  if (flags & ts.TypeFlags.BigInt) return fc.bigInt();
  if (flags & ts.TypeFlags.Undefined) return fc.constant(undefined);
  if (flags & ts.TypeFlags.Null) return fc.constant(null);
  if (flags & ts.TypeFlags.ESSymbolLike) {
    throw new Unsupported("is a symbol, which QED cannot generate");
  }

  if (type.isUnion()) {
    return fc.oneof(...type.types.map((t) => arbitraryForType(t, ctx, depth)));
  }

  if (flags & ts.TypeFlags.TemplateLiteral) {
    const template = type as ts.TemplateLiteralType;
    const holes = template.types.map((t) => arbitraryForType(t, ctx, depth + 1));
    return fc
      .tuple(...holes)
      .map((values) =>
        template.texts.reduce(
          (out, text, i) => `${out}${text}${i < values.length ? String(values[i]) : ""}`,
          "",
        ),
      );
  }

  if (flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (!constraint || constraint.flags & ts.TypeFlags.Unknown) {
      throw new Unsupported(
        `is the type parameter \`${name}\` with no constraint, so there is no shape to generate from`,
      );
    }
    return arbitraryForType(constraint, ctx, depth + 1);
  }

  if (type.isIntersection()) {
    // `number & { readonly __brand: "Cents" }`: the brand exists only for the
    // checker, and every value of the type is a number.
    const primitive = type.types.find((t) => t.flags & PRIMITIVE);
    if (primitive) return arbitraryForType(primitive, ctx, depth + 1);
    return guardedObject(type, ctx, depth, name);
  }

  if (flags & ts.TypeFlags.Object) return guardedObject(type, ctx, depth, name);

  throw new Unsupported("is a type QED cannot generate");
}

/**
 * An object type, refused by name when it contains itself.
 *
 * Expanding a recursive type until the depth limit built every branch of it:
 * a node with three children of its own type is 3^8 generators before the
 * limit says no. Seeing the cycle says no at once, and says why.
 */
function guardedObject(
  type: ts.Type,
  ctx: TypeContext,
  depth: number,
  name: string,
): fc.Arbitrary<unknown> {
  const building = ctx.building ?? new Set<ts.Type>();
  if (building.has(type)) {
    throw new Unsupported(`is \`${name}\`, which contains itself, and QED cannot generate it yet`);
  }
  building.add(type);
  try {
    return objectArbitrary(type, { ...ctx, building }, depth, name);
  } finally {
    building.delete(type);
  }
}

function objectArbitrary(
  type: ts.Type,
  ctx: TypeContext,
  depth: number,
  name: string,
): fc.Arbitrary<unknown> {
  const { checker } = ctx;
  const symbol = type.getSymbol();
  const symbolName = symbol?.getName() ?? name;

  if (checker.isTupleType(type)) {
    const reference = type as ts.TypeReference;
    const elements = checker.getTypeArguments(reference);
    const elementFlags = (reference.target as ts.TupleType).elementFlags;
    const parts = elements.map((element, i) => {
      const kind = elementFlags[i] ?? ts.ElementFlags.Required;
      if (kind & ts.ElementFlags.Variable) {
        throw new Unsupported("has a rest element, which QED cannot generate");
      }
      const arbitrary = inside(`[${i}]`, () => arbitraryForType(element, ctx, depth + 1));
      return kind & ts.ElementFlags.Optional ? fc.option(arbitrary, { nil: undefined }) : arbitrary;
    });
    return fc.tuple(...parts);
  }

  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (!element) throw new Unsupported("is an array of nothing QED can generate");
    return fc.array(
      inside("[]", () => arbitraryForType(element, ctx, depth + 1)),
      { maxLength: 8 },
    );
  }

  if (symbol && symbol.flags & ts.SymbolFlags.Class && !fromLib(type)) {
    throw new Unsupported(`is the class \`${symbolName}\`, which QED cannot construct`);
  }

  if (fromLib(type)) {
    const args = (type as ts.TypeReference).typeArguments ?? checker.getTypeArguments(type as ts.TypeReference);
    switch (symbolName) {
      case "Date":
        return dateArbitrary();
      case "Map":
      case "ReadonlyMap": {
        const [k, v] = args;
        if (!k || !v) break;
        return fc
          .uniqueArray(
            fc.tuple(arbitraryForType(k, ctx, depth + 1), arbitraryForType(v, ctx, depth + 1)),
            { selector: ([key]) => key, maxLength: 6 },
          )
          .map((entries) => new Map(entries));
      }
      case "Set":
      case "ReadonlySet": {
        const [item] = args;
        if (!item) break;
        return fc
          .uniqueArray(arbitraryForType(item, ctx, depth + 1), { maxLength: 8 })
          .map((items) => new Set(items));
      }
      default: {
        const typed = TYPED_ARRAYS[symbolName];
        if (typed) return typed();
      }
    }
    // Anything else from the library - a Promise, a RegExp, an Error - is
    // behaviour rather than data, and generating one would be inventing it.
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0) {
      throw new Unsupported(`is \`${symbolName}\`, which QED cannot generate`);
    }
  }

  const calls = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
  if (calls.length > 0) return callbackArbitrary(calls, ctx, depth);
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) {
    throw new Unsupported(`is a constructor, which QED cannot generate`);
  }

  const properties = checker.getPropertiesOfType(type);
  const indexes = checker.getIndexInfosOfType(type);
  if (properties.length === 0 && indexes.length === 0) {
    throw new Unsupported("is an empty object type, so there is no shape to generate from");
  }

  const shape: Record<string, fc.Arbitrary<unknown>> = {};
  const required: string[] = [];
  for (const property of properties) {
    const key = property.getName();
    if (key.startsWith("__@")) throw new Unsupported("has a symbol-keyed member");
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const declared = checker.getTypeOfSymbolAtLocation(property, ctx.at);
    const written = writtenTypeOf(property.valueDeclaration);
    const members = optional ? withoutUndefined(declared) : [declared];
    shape[key] = inside(key, () =>
      members.length === 1 && members[0]
        ? arbitraryForType(members[0], ctx, depth + 1, written)
        : fc.oneof(...members.map((m) => arbitraryForType(m, ctx, depth + 1, written))),
    );
    if (!optional) required.push(key);
  }
  const record = fc.record(shape, { requiredKeys: required });

  const stringIndex = indexes.find((info) => info.keyType.flags & ts.TypeFlags.String);
  if (indexes.some((info) => info !== stringIndex)) {
    throw new Unsupported("has an index signature QED cannot generate");
  }
  if (!stringIndex) return record;

  const extra = fc.dictionary(stringArbitrary(ctx.corpus), arbitraryForType(stringIndex.type, ctx, depth + 1), {
    maxKeys: 4,
  });
  return fc.tuple(record, extra).map(([fixed, more]) => ({ ...more, ...fixed }));
}

/**
 * A function-typed parameter: a callback that returns a generated value and
 * records the calls it receives.
 */
function callbackArbitrary(
  signatures: readonly ts.Signature[],
  ctx: TypeContext,
  depth: number,
): fc.Arbitrary<unknown> {
  const [signature] = signatures;
  if (!signature || signatures.length > 1) {
    throw new Unsupported("is an overloaded function type, which QED cannot generate");
  }
  if (signature.getTypeParameters()?.length) {
    throw new Unsupported("is a generic function type, which QED cannot generate");
  }
  const returns = ctx.checker.getReturnTypeOfSignature(signature);
  if (returns.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) {
    return fc.constant(undefined).map((value) => makeCallback(value));
  }
  return arbitraryForType(returns, ctx, depth + 1).map((value) => makeCallback(value));
}

/** How a member's type was spelled, for naming one the checker lost. */
function writtenTypeOf(declaration: ts.Declaration | undefined): string | undefined {
  if (!declaration) return undefined;
  const node = (declaration as { type?: ts.TypeNode }).type;
  return node ? writtenName(node) : undefined;
}

/** `Buffer` for `Buffer`, `Order` for `Order<T>`, the text for anything else. */
export function writtenName(node: ts.TypeNode): string {
  if (ts.isTypeReferenceNode(node)) {
    return ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
  }
  return node.getText();
}

/* ------------------------------------------------------------------------ */
/* Notable values                                                           */
/* ------------------------------------------------------------------------ */

/** Values worth trying for certain, by type. Never throws. */
export function notableForType(type: ts.Type, ctx: TypeContext, depth = 0): unknown[] {
  if (depth > 3) return [];
  const flags = type.flags;
  const { corpus } = ctx;

  if (flags & ts.TypeFlags.Boolean) return [true, false];
  if (type.isNumberLiteral() || type.isStringLiteral()) return [type.value];
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return [(type as { intrinsicName?: string }).intrinsicName === "true"];
  }
  if (flags & ts.TypeFlags.Number) {
    return [
      0,
      -0,
      1,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      ...corpus.numbers.slice(0, 24),
    ];
  }
  if (flags & ts.TypeFlags.String) return ["", " ", ...corpus.strings.slice(0, 16)];
  if (flags & ts.TypeFlags.Undefined) return [undefined];
  if (type.isUnion()) {
    return type.types.flatMap((t) => notableForType(t, ctx, depth + 1)).slice(0, 24);
  }
  if (type.isIntersection()) {
    const primitive = type.types.find((t) => t.flags & PRIMITIVE);
    return primitive ? notableForType(primitive, ctx, depth + 1) : [];
  }
  if (flags & ts.TypeFlags.TypeParameter) {
    const constraint = ctx.checker.getBaseConstraintOfType(type);
    return constraint ? notableForType(constraint, ctx, depth + 1) : [];
  }
  if (flags & ts.TypeFlags.Object) {
    if (ctx.checker.isArrayType(type)) return [[]];
    if (fromLib(type) && type.getSymbol()?.getName() === "Date") return [new Date(0)];
  }
  return [];
}
