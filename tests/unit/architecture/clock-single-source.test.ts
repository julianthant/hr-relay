import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

interface TimeScope {
  readonly dates: Set<string>;
  readonly performances: Set<string>;
  readonly processes: Set<string>;
  readonly globals: Set<string>;
  readonly dateNow: Set<string>;
  readonly performanceNow: Set<string>;
  readonly hrtime: Set<string>;
}

function clone(scope: TimeScope): TimeScope {
  return {
    dates: new Set(scope.dates), performances: new Set(scope.performances),
    processes: new Set(scope.processes), globals: new Set(scope.globals),
    dateNow: new Set(scope.dateNow), performanceNow: new Set(scope.performanceNow),
    hrtime: new Set(scope.hrtime),
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)) return unwrap(expression.expression);
  return expression;
}

function member(expression: ts.Expression, name: string): ts.Expression | undefined {
  const value = unwrap(expression);
  if (ts.isPropertyAccessExpression(value) && value.name.text === name) return value.expression;
  if (ts.isElementAccessExpression(value) && value.argumentExpression
    && (ts.isStringLiteralLike(value.argumentExpression) || ts.isNumericLiteral(value.argumentExpression))
    && value.argumentExpression.text === name) return value.expression;
  return undefined;
}

function named(expression: ts.Expression, bindings: ReadonlySet<string>): boolean {
  const value = unwrap(expression);
  return ts.isIdentifier(value) && bindings.has(value.text);
}

function globalMember(expression: ts.Expression, name: string, scope: TimeScope): boolean {
  const receiver = member(expression, name);
  return receiver !== undefined && named(receiver, scope.globals);
}

function dateObject(expression: ts.Expression, scope: TimeScope): boolean {
  return named(expression, scope.dates) || globalMember(expression, "Date", scope);
}

function performanceObject(expression: ts.Expression, scope: TimeScope): boolean {
  return named(expression, scope.performances) || globalMember(expression, "performance", scope);
}

function processObject(expression: ts.Expression, scope: TimeScope): boolean {
  return named(expression, scope.processes) || globalMember(expression, "process", scope);
}

function nowMember(expression: ts.Expression, object: (value: ts.Expression) => boolean): boolean {
  const receiver = member(expression, "now");
  return receiver !== undefined && object(receiver);
}

function hrtimeMember(expression: ts.Expression, scope: TimeScope): boolean {
  const receiver = member(expression, "hrtime");
  return receiver !== undefined && processObject(receiver, scope);
}

function hrtimeBigintMember(expression: ts.Expression, scope: TimeScope): boolean {
  const receiver = member(expression, "bigint");
  return receiver !== undefined && (named(receiver, scope.hrtime) || hrtimeMember(receiver, scope));
}

function clear(name: ts.BindingName, scope: TimeScope): void {
  if (ts.isIdentifier(name)) {
    for (const set of [scope.dates, scope.performances, scope.processes, scope.globals,
      scope.dateNow, scope.performanceNow, scope.hrtime]) set.delete(name.text);
    return;
  }
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) clear(element.name, scope);
}

function registerBinding(name: ts.BindingName, initializer: ts.Expression | undefined, scope: TimeScope): void {
  if (!initializer) return;
  if (ts.isIdentifier(name)) {
    if (dateObject(initializer, scope)) scope.dates.add(name.text);
    if (performanceObject(initializer, scope)) scope.performances.add(name.text);
    if (processObject(initializer, scope)) scope.processes.add(name.text);
    if (nowMember(initializer, (value) => dateObject(value, scope)) || named(initializer, scope.dateNow)) scope.dateNow.add(name.text);
    if (nowMember(initializer, (value) => performanceObject(value, scope)) || named(initializer, scope.performanceNow)) scope.performanceNow.add(name.text);
    if (hrtimeMember(initializer, scope) || hrtimeBigintMember(initializer, scope) || named(initializer, scope.hrtime)) scope.hrtime.add(name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  for (const element of name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const key = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
      ? element.propertyName.text : element.name.text;
    if (key === "now" && dateObject(initializer, scope)) scope.dateNow.add(element.name.text);
    if (key === "now" && performanceObject(initializer, scope)) scope.performanceNow.add(element.name.text);
    if (key === "hrtime" && processObject(initializer, scope)) scope.hrtime.add(element.name.text);
  }
}

function prepare(statements: readonly ts.Statement[], scope: TimeScope): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) clear(declaration.name, scope);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) clear(statement.name, scope);
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (statement.importClause.name) clear(statement.importClause.name, scope);
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) clear(bindings.name, scope);
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) clear(item.name, scope);
  }
  for (const statement of statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if ((module === "node:process" || module === "process") && clause?.name) scope.processes.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (module === "node:process" || module === "process") scope.processes.add(bindings.name.text);
      if (module === "node:perf_hooks") scope.performances.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      const imported = item.propertyName?.text ?? item.name.text;
      if (module === "node:perf_hooks" && imported === "performance") scope.performances.add(item.name.text);
      if ((module === "node:process" || module === "process") && imported === "hrtime") scope.hrtime.add(item.name.text);
    }
  }
  for (let pass = 0; pass <= statements.length; pass += 1) {
    const before = [...scope.dates, ...scope.performances, ...scope.processes, ...scope.dateNow, ...scope.performanceNow, ...scope.hrtime].length;
    for (const statement of statements) if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) registerBinding(declaration.name, declaration.initializer, scope);
    }
    const after = [...scope.dates, ...scope.performances, ...scope.processes, ...scope.dateNow, ...scope.performanceNow, ...scope.hrtime].length;
    if (before === after) break;
  }
}

export function findDirectTimeReads(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node, scope: TimeScope): void {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      const child = clone(scope); prepare(node.statements, child);
      for (const statement of node.statements) visit(statement, child);
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const child = clone(scope);
      for (const parameter of node.parameters) clear(parameter.name, child);
      for (const parameter of node.parameters) registerBinding(parameter.name, parameter.initializer, child);
      if (node.body) visit(node.body, child);
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const directDate = dateObject(expression, scope) && (!ts.isNewExpression(node) || (node.arguments?.length ?? 0) === 0);
      const wall = named(expression, scope.dateNow) || nowMember(expression, (value) => dateObject(value, scope));
      const performance = named(expression, scope.performanceNow) || nowMember(expression, (value) => performanceObject(value, scope));
      const highResolution = named(expression, scope.hrtime) || hrtimeMember(expression, scope) || hrtimeBigintMember(expression, scope);
      if (directDate || wall || performance || highResolution) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path}:${position.line + 1}:${position.character + 1}`);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  }
  visit(source, {
    dates: new Set(["Date"]), performances: new Set(["performance"]), processes: new Set(["process"]),
    globals: new Set(["globalThis"]), dateNow: new Set(), performanceNow: new Set(), hrtime: new Set(),
  });
  return violations;
}

describe("clock single source", () => {
  it("allows direct wall and monotonic time reads only in the clock adapter", () => {
    const violations = gitVisibleFiles(["src"])
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && path !== "src/domain/clock.ts")
      .flatMap((path) => findDirectTimeReads(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });

  it("detects global, aliased, destructured, and imported time reads", () => {
    const fixture = [
      'import { performance as perf } from "node:perf_hooks";',
      'import proc, { hrtime as highRes } from "node:process";',
      "const D = globalThis.Date; const { now: wall } = D;",
      "const p = perf; const { now: mono } = p;",
      "const processAlias = proc; const { hrtime: h } = processAlias;",
      "new D(); wall(); mono(); highRes.bigint(); h();",
      "globalThis.Date.now(); globalThis.performance.now(); globalThis.process.hrtime.bigint();",
    ].join("\n");
    assert.equal(findDirectTimeReads("fixture.ts", fixture).length, 8);
  });

  it("ignores shadowed names and deterministic Date construction", () => {
    assert.deepEqual(findDirectTimeReads("fixture.ts", [
      "function f(Date: { now(): number }) { return Date.now(); }",
      "function g(process: unknown, performance: unknown) { return [process, performance]; }",
      "const fixed = new Date('2026-01-01T00:00:00Z');",
      "const text = 'Date.now()'; // performance.now()",
    ].join("\n")), []);
  });
});
