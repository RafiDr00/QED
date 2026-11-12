import ts from "typescript";

import type { Resolver } from "./sandbox.js";

/**
 * The functions a module exports, however the export is written.
 *
 * `export function f`, `export const f = () => ...`, `export { f, g as h }`,
 * `export default function` and `export default f` all put a function on the
 * module's exports. Only the first two used to be seen, so a module written
 * with an export list had nothing to verify, and `export default function c`
 * was looked up as `c` - a name the module never exports - and abstained with
 * "exports no function named 'c'". DECISIONS.md D-054.
 *
 * A default export is named `default`, which is the key the compiled module
 * really puts it under.
 */

export interface ExportedFunction {
  /** The name a caller imports it by. */
  readonly name: string;
  /** Where its parameters are declared. */
  readonly declaration: ts.SignatureDeclarationBase;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

const isFunctionValue = (
  node: ts.Expression | undefined,
): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** Every top-level function in the module, exported or not, by local name. */
function localFunctions(file: ts.SourceFile): Map<string, ts.SignatureDeclarationBase> {
  const locals = new Map<string, ts.SignatureDeclarationBase>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      locals.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionValue(decl.initializer)) {
          locals.set(decl.name.text, decl.initializer);
        }
      }
    }
  }
  return locals;
}

/** Exported functions, in the order a reader meets them in the source. */
export function exportedFunctionsOf(file: ts.SourceFile): ExportedFunction[] {
  const locals = localFunctions(file);
  const out: ExportedFunction[] = [];
  const seen = new Set<string>();
  const add = (name: string, declaration: ts.SignatureDeclarationBase | undefined) => {
    if (declaration === undefined || seen.has(name)) return;
    seen.add(name);
    out.push({ name, declaration });
  };

  for (const statement of file.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(statement) && exported && statement.body) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      if (isDefault) add("default", statement);
      else if (statement.name) add(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionValue(decl.initializer)) {
          add(decl.name.text, decl.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      // `export default f` or `export default (n: number) => n`.
      const value = statement.expression;
      if (ts.isIdentifier(value)) add("default", locals.get(value.text));
      else if (isFunctionValue(value)) add("default", value);
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      // `export { a, b as c }`. A re-export from another module has a
      // specifier and is that module's function, verified where it lives.
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const local = (element.propertyName ?? element.name).text;
        add(element.name.text, locals.get(local));
      }
    }
  }
  return out;
}

/** The exported function named `name`, if the module has one. */
export function findExportedFunction(
  file: ts.SourceFile,
  name: string,
): ts.SignatureDeclarationBase | undefined {
  return exportedFunctionsOf(file).find((f) => f.name === name)?.declaration;
}

/** The module specifiers a source imports or re-exports from, without parsing it fully. */
export function importedSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
}

/**
 * The sources a module reaches through relative imports, a few levels deep.
 *
 * A boundary a change moved is usually a constant written in the code - but
 * not always in the file being verified. `total.ts` calling `rate.ts` diverges
 * at the `10` in `rate.ts`, which mining `total.ts` alone never offered the
 * generator, so the importer's divergence was found on 0.2% of inputs and
 * by luck. Constants are mined from what is pinned as well.
 */
export function dependencySources(
  source: string,
  fileName: string,
  resolver: Resolver | undefined,
  depth = 3,
): string[] {
  if (resolver === undefined) return [];
  const out: string[] = [];
  const seen = new Set<string>([fileName]);
  const visit = (text: string, from: string, level: number): void => {
    if (level > depth) return;
    for (const specifier of importedSpecifiers(text)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolver(specifier, from);
      if (!resolved || seen.has(resolved.path)) continue;
      seen.add(resolved.path);
      out.push(resolved.source);
      visit(resolved.source, resolved.path, level + 1);
    }
  };
  visit(source, fileName, 1);
  return out;
}
