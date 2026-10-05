import fc from "fast-check";
import ts from "typescript";

/**
 * Type-directed input generation.
 *
 * Reads the function's declared parameter types and builds a generator for
 * each. What it cannot build, it refuses by name - "parameter `cfg` has no
 * type annotation" is the design system's own example of an abstain reason,
 * and it comes from here.
 *
 * Types are read syntactically, including locally declared interfaces, type
 * aliases and enums. That resolves everything a self-contained module can
 * say, and anything imported is already an obstruction for other reasons.
 */

/**
 * Constants mined from the code under comparison, and their neighbours.
 *
 * Random draws almost never land on a boundary. Changing `qty > 100` to
 * `qty >= 100` disagrees for exactly one input out of the whole number line,
 * and 1,000 random draws will not find it. The literals in the source are
 * where the boundaries are, so they go into the generator - with their
 * neighbours, because the interesting input is usually beside the constant
 * rather than on it.
 *
 * This is the "corpus-seeded" half of what the design system describes.
 */
export interface Corpus {
  readonly numbers: readonly number[];
  readonly strings: readonly string[];
}

export const EMPTY_CORPUS: Corpus = { numbers: [], strings: [] };

/** Mines the literals out of one or more sources. */
export function mineCorpus(...sources: readonly string[]): Corpus {
  const numbers = new Set<number>();
  const strings = new Set<string>();

  for (const source of sources) {
    const file = ts.createSourceFile(
      "corpus.ts",
      source,
      ts.ScriptTarget.ES2022,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isNumericLiteral(node)) {
        const value = Number(node.text);
        if (Number.isFinite(value)) {
          numbers.add(value);
          // The boundary is usually next to the constant, not on it.
          numbers.add(value + 1);
          numbers.add(value - 1);
        }
      } else if (ts.isStringLiteral(node)) {
        strings.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return { numbers: [...numbers], strings: [...strings] };
}

export type Generation =
  | {
      readonly kind: "ok";
      readonly arbitrary: fc.Arbitrary<unknown[]>;
      /**
       * Inputs that are always tried, before any random draw.
       *
       * Leaving an edge to chance means leaving it to the seed. `n + 0`
       * disagrees with `n` only at -0, and 400 random draws under one seed
       * missed it entirely. These are run first, every time.
       */
      readonly examples: readonly unknown[][];
    }
  | { readonly kind: "unsupported"; readonly obstruction: string };

interface Scope {
  readonly aliases: Map<string, ts.TypeNode>;
  readonly interfaces: Map<string, ts.InterfaceDeclaration>;
  readonly enums: Map<string, ts.EnumDeclaration>;
  readonly corpus: Corpus;
}

class Unsupported extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

function collectScope(file: ts.SourceFile, corpus: Corpus): Scope {
  const aliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const enums = new Map<string, ts.EnumDeclaration>();

  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement.type);
    } else if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
    } else if (ts.isEnumDeclaration(statement)) {
      enums.set(statement.name.text, statement);
    }
  }
  return { aliases, interfaces, enums, corpus };
}

/** The exported function, however it was written. */
function findFunction(
  file: ts.SourceFile,
  name: string,
): ts.SignatureDeclarationBase | undefined {
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          return decl.initializer;
        }
      }
    }
  }
  return undefined;
}

/** Numbers that a money or a count routine would actually meet, plus the edges. */
const numberArbitrary = (corpus: Corpus): fc.Arbitrary<number> =>
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

function fromTypeNode(
  node: ts.TypeNode,
  scope: Scope,
  depth: number,
): fc.Arbitrary<unknown> {
  if (depth > 6) throw new Unsupported("nests too deeply to generate");

  switch (node.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return numberArbitrary(scope.corpus);
    case ts.SyntaxKind.StringKeyword:
      return scope.corpus.strings.length > 0
        ? fc.oneof(
            { weight: 5, arbitrary: fc.constantFrom(...scope.corpus.strings) },
            { weight: 3, arbitrary: fc.string() },
          )
        : fc.string();
    case ts.SyntaxKind.BooleanKeyword:
      return fc.boolean();
    case ts.SyntaxKind.BigIntKeyword:
      return fc.bigInt();
    case ts.SyntaxKind.UndefinedKeyword:
      return fc.constant(undefined);
    case ts.SyntaxKind.NullKeyword:
      return fc.constant(null);
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      throw new Unsupported("is `any`, so there is no shape to generate from");
    case ts.SyntaxKind.ObjectKeyword:
      throw new Unsupported("is `object`, so there is no shape to generate from");
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.NeverKeyword:
      throw new Unsupported("cannot hold a value");
    default:
      break;
  }

  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal;
    if (ts.isStringLiteral(literal)) return fc.constant(literal.text);
    if (ts.isNumericLiteral(literal)) return fc.constant(Number(literal.text));
    if (literal.kind === ts.SyntaxKind.TrueKeyword) return fc.constant(true);
    if (literal.kind === ts.SyntaxKind.FalseKeyword) return fc.constant(false);
    if (literal.kind === ts.SyntaxKind.NullKeyword) return fc.constant(null);
    throw new Unsupported("is a literal type QED cannot generate");
  }

  if (ts.isUnionTypeNode(node)) {
    return fc.oneof(...node.types.map((t) => fromTypeNode(t, scope, depth + 1)));
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return fromTypeNode(node.type, scope, depth);
  }

  if (ts.isArrayTypeNode(node)) {
    return fc.array(fromTypeNode(node.elementType, scope, depth + 1), {
      maxLength: 8,
    });
  }

  if (ts.isTupleTypeNode(node)) {
    const parts = node.elements.map((element) =>
      fromTypeNode(
        ts.isNamedTupleMember(element) ? element.type : element,
        scope,
        depth + 1,
      ),
    );
    return fc.tuple(...parts);
  }

  if (ts.isTypeLiteralNode(node)) {
    return recordFromMembers(node.members, scope, depth);
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isIdentifier(node.typeName)
      ? node.typeName.text
      : node.typeName.right.text;

    const alias = scope.aliases.get(name);
    if (alias) return fromTypeNode(alias, scope, depth + 1);

    const iface = scope.interfaces.get(name);
    if (iface) return recordFromMembers(iface.members, scope, depth);

    const enumeration = scope.enums.get(name);
    if (enumeration) return arbitraryFromEnum(enumeration);

    const args = node.typeArguments ?? [];
    if ((name === "Array" || name === "ReadonlyArray") && args[0]) {
      return fc.array(fromTypeNode(args[0], scope, depth + 1), { maxLength: 8 });
    }
    if (name === "Readonly" && args[0]) {
      return fromTypeNode(args[0], scope, depth);
    }
    if (name === "Record" && args[0] && args[1]) {
      const keys = fromTypeNode(args[0], scope, depth + 1);
      const values = fromTypeNode(args[1], scope, depth + 1);
      return fc
        .array(fc.tuple(keys, values), { maxLength: 6 })
        .map((pairs) => Object.fromEntries(pairs.map(([k, v]) => [String(k), v])));
    }

    throw new Unsupported(`is \`${name}\`, which QED cannot generate`);
  }

  throw new Unsupported("is a type QED cannot generate");
}

function arbitraryFromEnum(
  declaration: ts.EnumDeclaration,
): fc.Arbitrary<unknown> {
  const values: unknown[] = [];
  let next = 0;
  for (const member of declaration.members) {
    if (member.initializer && ts.isStringLiteral(member.initializer)) {
      values.push(member.initializer.text);
    } else if (member.initializer && ts.isNumericLiteral(member.initializer)) {
      next = Number(member.initializer.text);
      values.push(next);
      next++;
    } else {
      values.push(next);
      next++;
    }
  }
  if (values.length === 0) throw new Unsupported("is an empty enum");
  return fc.constantFrom(...values);
}

function recordFromMembers(
  members: readonly ts.TypeElement[],
  scope: Scope,
  depth: number,
): fc.Arbitrary<unknown> {
  const shape: Record<string, fc.Arbitrary<unknown>> = {};
  const required: string[] = [];

  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type) {
      throw new Unsupported("has a member QED cannot generate");
    }
    const key = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteral(member.name)
        ? member.name.text
        : undefined;
    if (key === undefined) throw new Unsupported("has a computed property name");

    shape[key] = fromTypeNode(member.type, scope, depth + 1);
    if (!member.questionToken) required.push(key);
  }

  return fc.record(shape, { requiredKeys: required });
}

/** Values worth trying for certain, by type. */
function notableFor(node: ts.TypeNode, scope: Scope): unknown[] {
  switch (node.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return [
        0,
        -0,
        1,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER,
        ...scope.corpus.numbers.slice(0, 24),
      ];
    case ts.SyntaxKind.StringKeyword:
      return ["", " ", ...scope.corpus.strings.slice(0, 16)];
    case ts.SyntaxKind.BooleanKeyword:
      return [true, false];
    default:
      break;
  }
  if (ts.isArrayTypeNode(node)) return [[]];
  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((t) => notableFor(t, scope)).slice(0, 24);
  }
  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal;
    if (ts.isStringLiteral(literal)) return [literal.text];
    if (ts.isNumericLiteral(literal)) return [Number(literal.text)];
  }
  return [];
}

/**
 * One parameter varied over its notable values at a time, the rest held at a
 * sample. Every edge is covered without the combinations exploding.
 */
function buildExamples(
  parameters: readonly ts.ParameterDeclaration[],
  arbitrary: fc.Arbitrary<unknown[]>,
  scope: Scope,
): unknown[][] {
  const baseline = fc.sample(arbitrary, { numRuns: 1, seed: 7 })[0];
  if (!baseline) return [];

  const examples: unknown[][] = [[...baseline]];
  parameters.forEach((parameter, index) => {
    if (!parameter.type) return;
    for (const value of notableFor(parameter.type, scope)) {
      const row = [...baseline];
      row[index] = value;
      examples.push(row);
    }
  });
  return examples.slice(0, 400);
}

/**
 * Builds the generator for one function's whole argument list.
 *
 * An optional parameter is generated as present or absent, because a caller
 * that omits it is a caller both versions have to agree about.
 */
export function generatorFor(
  source: string,
  fileName: string,
  name: string,
  corpus: Corpus = EMPTY_CORPUS,
): Generation {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );

  const declaration = findFunction(file, name);
  if (!declaration) {
    return {
      kind: "unsupported",
      obstruction: `exports no function named '${name}'`,
    };
  }

  const parameters = [...declaration.parameters];
  const arbitraries: fc.Arbitrary<unknown>[] = [];

  for (const parameter of parameters) {
    const parameterName = ts.isIdentifier(parameter.name)
      ? parameter.name.text
      : "a parameter";

    if (parameter.dotDotDotToken) {
      return {
        kind: "unsupported",
        obstruction: `parameter \`${parameterName}\` is a rest parameter, which QED cannot generate`,
      };
    }
    if (!parameter.type) {
      return {
        kind: "unsupported",
        obstruction: `parameter \`${parameterName}\` has no type annotation`,
      };
    }

    try {
      const base = fromTypeNode(parameter.type, collectScope(file, corpus), 0);
      arbitraries.push(
        parameter.questionToken
          ? fc.oneof(base, fc.constant(undefined))
          : base,
      );
    } catch (error) {
      if (error instanceof Unsupported) {
        return {
          kind: "unsupported",
          obstruction: `parameter \`${parameterName}\` ${error.detail}`,
        };
      }
      throw error;
    }
  }

  const arbitrary: fc.Arbitrary<unknown[]> = fc.tuple(...arbitraries);
  const scope = collectScope(file, corpus);
  return {
    kind: "ok",
    arbitrary,
    examples: buildExamples(parameters, arbitrary, scope),
  };
}
