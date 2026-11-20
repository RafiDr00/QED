import ts from "typescript";

/**
 * Branch counters, compiled into the module under test.
 *
 * An EQUIVALENT used to rest on a count of inputs and nothing else: two
 * thousand inputs that all took the same path through the function are two
 * thousand times the same evidence. The engine now counts which branches the
 * inputs reached - each arm of an `if` and a `?:`, the right side of `&&`,
 * `||` and `??`, each `case`, each loop body, each `catch`, each inner
 * function - and uses that to choose inputs and to say how much of the
 * function the verdict covers. DECISIONS.md D-066.
 *
 * Counters are inserted with a TypeScript transform, not read from V8's
 * coverage. The inspector's precise coverage slows every function in the
 * process once it is on, the type checker and fast-check included, and is
 * not deterministic about what it reports for code that was never compiled.
 * A counter is one increment on a typed array the sandbox owns.
 */

/** The global the counters live in, inside the sandbox. */
export const COUNTERS = "__qed$branches";

export type BranchKind =
  | "then"
  | "else"
  | "true"
  | "false"
  | "right"
  | "case"
  | "loop"
  | "catch"
  | "function";

export interface Branch {
  readonly id: number;
  readonly kind: BranchKind;
  /** Where the branch's code starts and ends, in the original source. */
  readonly start: number;
  readonly end: number;
  /** 1-based. */
  readonly line: number;
}

/**
 * A transform that inserts a counter at every branch and records where each
 * one is. `branches` is filled as the file is transformed.
 */
export function instrument(branches: Branch[]): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (file) => {
    const { factory } = context;

    const add = (kind: BranchKind, node: ts.Node): number => {
      const start = node.getStart(file);
      branches.push({
        id: branches.length,
        kind,
        start,
        end: node.getEnd(),
        line: file.getLineAndCharacterOfPosition(start).line + 1,
      });
      return branches.length - 1;
    };

    const counter = (id: number): ts.Expression =>
      factory.createPostfixIncrement(
        factory.createElementAccessExpression(
          factory.createIdentifier(COUNTERS),
          factory.createNumericLiteral(id),
        ),
      );
    const counted = (id: number, statement: ts.Statement | undefined): ts.Block => {
      const statements = statement === undefined ? [] : ts.isBlock(statement) ? [...statement.statements] : [statement];
      return factory.createBlock([factory.createExpressionStatement(counter(id)), ...statements], true);
    };
    /** `(counter, expression)`: counts, then evaluates to the same value. */
    const countedExpression = (id: number, expression: ts.Expression): ts.Expression =>
      factory.createParenthesizedExpression(factory.createComma(counter(id), expression));

    /**
     * A function body with its counter after any directive prologue: putting
     * a statement before "use strict" would quietly turn strict mode off.
     */
    const countedBody = (id: number, body: ts.Block): ts.Block => {
      const statements = [...body.statements];
      let prologue = 0;
      while (
        prologue < statements.length &&
        ts.isExpressionStatement(statements[prologue] as ts.Statement) &&
        ts.isStringLiteral((statements[prologue] as ts.ExpressionStatement).expression)
      ) {
        prologue++;
      }
      statements.splice(prologue, 0, factory.createExpressionStatement(counter(id)));
      return factory.updateBlock(body, statements);
    };

    const visit = (node: ts.Node): ts.Node => {
      // Ids are assigned before the children are visited, so they run in
      // source order, which keeps reports stable.
      if (ts.isIfStatement(node)) {
        const thenId = add("then", node.thenStatement);
        const elseId = add("else", node.elseStatement ?? node);
        const visited = ts.visitEachChild(node, visit, context);
        return factory.updateIfStatement(
          visited,
          visited.expression,
          counted(thenId, visited.thenStatement),
          counted(elseId, visited.elseStatement),
        );
      }
      if (ts.isConditionalExpression(node)) {
        const trueId = add("true", node.whenTrue);
        const falseId = add("false", node.whenFalse);
        const visited = ts.visitEachChild(node, visit, context);
        return factory.updateConditionalExpression(
          visited,
          visited.condition,
          visited.questionToken,
          countedExpression(trueId, visited.whenTrue),
          visited.colonToken,
          countedExpression(falseId, visited.whenFalse),
        );
      }
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        const id = add("right", node.right);
        const visited = ts.visitEachChild(node, visit, context);
        return factory.updateBinaryExpression(
          visited,
          visited.left,
          visited.operatorToken,
          countedExpression(id, visited.right),
        );
      }
      if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        const id = add("case", node);
        const visited = ts.visitEachChild(node, visit, context);
        const statements = [factory.createExpressionStatement(counter(id)), ...visited.statements];
        return ts.isCaseClause(visited)
          ? factory.updateCaseClause(visited, visited.expression, statements)
          : factory.updateDefaultClause(visited, statements);
      }
      if (ts.isIterationStatement(node, false)) {
        const id = add("loop", node.statement);
        const visited = ts.visitEachChild<ts.IterationStatement>(node, visit, context);
        const body = counted(id, visited.statement);
        if (ts.isForStatement(visited)) {
          return factory.updateForStatement(visited, visited.initializer, visited.condition, visited.incrementor, body);
        }
        if (ts.isForOfStatement(visited)) {
          return factory.updateForOfStatement(visited, visited.awaitModifier, visited.initializer, visited.expression, body);
        }
        if (ts.isForInStatement(visited)) {
          return factory.updateForInStatement(visited, visited.initializer, visited.expression, body);
        }
        if (ts.isWhileStatement(visited)) {
          return factory.updateWhileStatement(visited, visited.expression, body);
        }
        if (ts.isDoStatement(visited)) {
          return factory.updateDoStatement(visited, body, visited.expression);
        }
        return visited;
      }
      if (ts.isCatchClause(node)) {
        const id = add("catch", node.block);
        const visited = ts.visitEachChild(node, visit, context);
        return factory.updateCatchClause(visited, visited.variableDeclaration, countedBody(id, visited.block));
      }
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node)) &&
        node.body !== undefined
      ) {
        const id = add("function", node.body);
        const visited = ts.visitEachChild(node, visit, context);
        const body = countedBody(id, visited.body as ts.Block);
        if (ts.isFunctionDeclaration(visited)) {
          return factory.updateFunctionDeclaration(
            visited, visited.modifiers, visited.asteriskToken, visited.name,
            visited.typeParameters, visited.parameters, visited.type, body,
          );
        }
        if (ts.isFunctionExpression(visited)) {
          return factory.updateFunctionExpression(
            visited, visited.modifiers, visited.asteriskToken, visited.name,
            visited.typeParameters, visited.parameters, visited.type, body,
          );
        }
        if (ts.isMethodDeclaration(visited)) {
          return factory.updateMethodDeclaration(
            visited, visited.modifiers, visited.asteriskToken, visited.name, visited.questionToken,
            visited.typeParameters, visited.parameters, visited.type, body,
          );
        }
        if (ts.isGetAccessorDeclaration(visited)) {
          return factory.updateGetAccessorDeclaration(
            visited, visited.modifiers, visited.name, visited.parameters, visited.type, body,
          );
        }
        return factory.updateSetAccessorDeclaration(
          visited, visited.modifiers, visited.name, visited.parameters, body,
        );
      }
      if (ts.isArrowFunction(node)) {
        const id = add("function", node.body);
        const visited = ts.visitEachChild(node, visit, context);
        const body = ts.isBlock(visited.body)
          ? countedBody(id, visited.body)
          : countedExpression(id, visited.body);
        return factory.updateArrowFunction(
          visited, visited.modifiers, visited.typeParameters, visited.parameters,
          visited.type, visited.equalsGreaterThanToken, body,
        );
      }
      // Constructors are left alone: a statement ahead of `super()` changes
      // how TypeScript emits parameter properties.
      return ts.visitEachChild(node, visit, context);
    };

    return ts.visitNode(file, visit) as ts.SourceFile;
  };
}

/** What the inputs reached of one function, in the version that ships. */
export interface Reach {
  readonly reached: number;
  readonly of: number;
  /** Lines of the branches never reached, ascending, at most eight. */
  readonly unreached: readonly number[];
}

/**
 * The branches inside `[start, end)` - one function - and how many were hit.
 * The function's own entry is not a branch: it is reached whenever the
 * function is called at all.
 */
export function reachOf(
  branches: readonly Branch[],
  counts: ArrayLike<number>,
  start: number,
  end: number,
): Reach {
  const inside = branches.filter((b) => b.start >= start && b.end <= end);
  // The outermost function body in the span is the function's own.
  const own = inside
    .filter((b) => b.kind === "function")
    .sort((a, b) => a.start - b.start || b.end - a.end)[0];
  const counted = inside.filter((b) => b !== own);
  const unreached = counted.filter((b) => (counts[b.id] ?? 0) === 0);
  return {
    reached: counted.length - unreached.length,
    of: counted.length,
    unreached: [...new Set(unreached.map((b) => b.line))].sort((a, b) => a - b).slice(0, 8),
  };
}
