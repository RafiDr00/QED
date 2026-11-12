import fc from "fast-check";
import ts from "typescript";

import { findExportedFunction } from "./exports.js";
import type { Resolver } from "./sandbox.js";
import {
  arbitraryForType,
  checkedProgram,
  notableForType,
  Unsupported,
  writtenName,
} from "./types.js";

/**
 * Type-directed input generation.
 *
 * Reads the function's declared parameter types and builds a generator for
 * each. What it cannot build, it refuses by name - "parameter `cfg` has no
 * type annotation" is the design system's own example of an abstain reason,
 * and it comes from here.
 *
 * The types themselves are resolved by the TypeScript checker; see types.ts.
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

/**
 * One parameter varied over its notable values at a time, the rest held at a
 * sample. Every edge is covered without the combinations exploding.
 */
function buildExamples(
  notables: readonly (readonly unknown[])[],
  arbitrary: fc.Arbitrary<unknown[]>,
): unknown[][] {
  const baseline = fc.sample(arbitrary, { numRuns: 1, seed: 7 })[0];
  if (!baseline) return [];

  const examples: unknown[][] = [[...baseline]];
  notables.forEach((values, index) => {
    for (const value of values) {
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
 * Types are read by the TypeScript checker over the module and the relative
 * imports `resolver` pins, so an interface imported from `./types`, a
 * `Partial<Order>` and a branded `Cents` all generate. What cannot be
 * generated is refused by name.
 *
 * An optional parameter, or one with a default, is generated as present or
 * absent, because a caller that omits it is a caller both versions have to
 * agree about.
 */
export function generatorFor(
  source: string,
  fileName: string,
  name: string,
  corpus: Corpus = EMPTY_CORPUS,
  resolver?: Resolver,
): Generation {
  const { checker, file } = checkedProgram(source, fileName, resolver);

  const declaration = findExportedFunction(file, name);
  if (!declaration) {
    return {
      kind: "unsupported",
      obstruction: `exports no function named '${name}'`,
    };
  }

  const ctx = { checker, corpus, at: declaration };
  const arbitraries: fc.Arbitrary<unknown>[] = [];
  const notables: unknown[][] = [];

  for (const parameter of declaration.parameters) {
    const parameterName = ts.isIdentifier(parameter.name)
      ? parameter.name.text
      : // A destructured parameter is named by its pattern: `{ verdict }`.
        parameter.name.getText().replace(/\s+/g, " ");

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
      const type = checker.getTypeAtLocation(parameter.type);
      const base = arbitraryForType(type, ctx, 0, writtenName(parameter.type));
      const optional = parameter.questionToken !== undefined || parameter.initializer !== undefined;
      arbitraries.push(optional ? fc.oneof(base, fc.constant(undefined)) : base);
      notables.push([
        ...notableForType(type, ctx),
        ...(optional ? [undefined] : []),
      ]);
    } catch (error) {
      if (error instanceof Unsupported) {
        const where = error.where === "" ? "" : ` at \`${error.where}\``;
        return {
          kind: "unsupported",
          obstruction: `parameter \`${parameterName}\`${where} ${error.detail}`,
        };
      }
      throw error;
    }
  }

  const arbitrary: fc.Arbitrary<unknown[]> = fc.tuple(...arbitraries);
  return {
    kind: "ok",
    arbitrary,
    examples: buildExamples(notables, arbitrary),
  };
}
