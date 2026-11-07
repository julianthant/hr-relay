import { createHash } from "node:crypto";
import ts from "typescript";

export interface StaticResolution {
  readonly values: readonly string[];
  readonly resolved: boolean;
  readonly exactValue: boolean;
}



interface StaticEnvironment {
  readonly strings: ReadonlyMap<string, StaticResolution>;
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text;
  if (ts.isParenthesizedExpression(expression)) return callName(expression.expression);
  return undefined;
}

function staticResolution(node: ts.Node, environment: StaticEnvironment): StaticResolution {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return { values: [node.text], resolved: true, exactValue: true };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword) {
    return { values: [node.getText()], resolved: true, exactValue: true };
  }
  if (ts.isIdentifier(node)) {
    return environment.strings.has(node.text)
      ? environment.strings.get(node.text) ?? { values: [], resolved: false, exactValue: false }
      : { values: [], resolved: false, exactValue: false };
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node)) {
    return staticResolution(node.expression, environment);
  }
  // The environment inventory supplies no runtime-binding table, so member access remains unresolved.
  if (ts.isPropertyAccessExpression(node)) {
    return { values: [], resolved: false, exactValue: false };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticResolution(node.left, environment);
    const right = staticResolution(node.right, environment);
    return left.resolved && right.resolved && left.values.length === 1 && right.values.length === 1
      ? { values: [`${left.values[0]}${right.values[0]}`], resolved: true, exactValue: true }
      : { values: [...left.values, ...right.values], resolved: false, exactValue: false };
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    const known: string[] = [];
    for (const span of node.templateSpans) {
      const expression = staticResolution(span.expression, environment);
      known.push(...expression.values);
      if (!expression.resolved || expression.values.length !== 1) {
        return { values: known, resolved: false, exactValue: false };
      }
      value += expression.values[0] + span.literal.text;
    }
    return { values: [value], resolved: true, exactValue: true };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const parts = node.elements.map((element) => staticResolution(element, environment));
    return {
      values: parts.flatMap(({ values }) => values),
      resolved: parts.every(({ resolved }) => resolved),
      exactValue: false,
    };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const parts = node.properties.map((property): StaticResolution => {
      if (ts.isPropertyAssignment(property)) return staticResolution(property.initializer, environment);
      if (ts.isShorthandPropertyAssignment(property)) return staticResolution(property.name, environment);
      return { values: [], resolved: false, exactValue: false };
    });
    return {
      values: parts.flatMap(({ values }) => values),
      resolved: parts.every(({ resolved }) => resolved),
      exactValue: parts.every(({ resolved }) => resolved),
    };
  }
  if (ts.isCallExpression(node)) {
    const name = callName(node.expression);
    if (name === "join" && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = staticResolution(node.expression.expression, environment);
      const separator = node.arguments[0]
        ? staticResolution(node.arguments[0], environment)
        : { values: [","], resolved: true, exactValue: true };
      if (receiver.resolved && separator.resolved && separator.values.length === 1) {
        return { values: [receiver.values.join(separator.values[0])], resolved: true, exactValue: true };
      }
      return { values: [...receiver.values, ...separator.values], resolved: false, exactValue: false };
    }
    const parts = node.arguments.map((argument) => staticResolution(argument, environment));
    return { values: parts.flatMap(({ values }) => values), resolved: false, exactValue: false };
  }
  return { values: [], resolved: false, exactValue: false };
}

export function resolveStaticStringExpression(
  node: ts.Node,
  strings: ReadonlyMap<string, StaticResolution>,
): StaticResolution {
  return staticResolution(node, { strings });
}

export type EnvironmentAccessKind = "exact" | "unresolved" | "bulk";
export type EnvironmentOperation = "read" | "write" | "delete";

export interface EnvironmentAccessOccurrence {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly enclosingSymbol: string;
  readonly accessKind: EnvironmentAccessKind;
  readonly operation: EnvironmentOperation;
  readonly key?: string;
  readonly expressionFingerprint: string;
}

interface EnvironmentScope {
  readonly strings: Map<string, StaticResolution>;
  readonly processBindings: Set<string>;
  readonly globalBindings: Set<string>;
  readonly environmentBindings: Set<string>;
}

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

export const ENVIRONMENT_SOURCE_EXTENSIONS = Object.freeze(Object.keys(SCRIPT_KINDS));

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index < 0 ? "" : path.slice(index);
}

function cloneScope(scope: EnvironmentScope): EnvironmentScope {
  return {
    strings: new Map(scope.strings),
    processBindings: new Set(scope.processBindings),
    globalBindings: new Set(scope.globalBindings),
    environmentBindings: new Set(scope.environmentBindings),
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)
    || ts.isNonNullExpression(expression)) return unwrap(expression.expression);
  return expression;
}

function literalPropertyName(node: ts.Expression | ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function isGlobalObject(expression: ts.Expression, scope: EnvironmentScope): boolean {
  const value = unwrap(expression);
  return ts.isIdentifier(value) && scope.globalBindings.has(value.text);
}

function isProcessObject(expression: ts.Expression, scope: EnvironmentScope): boolean {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return scope.processBindings.has(value.text);
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === "process" && isGlobalObject(value.expression, scope);
  }
  return ts.isElementAccessExpression(value)
    && literalPropertyName(value.argumentExpression) === "process"
    && isGlobalObject(value.expression, scope);
}

function isEnvironmentObject(expression: ts.Expression, scope: EnvironmentScope): boolean {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return scope.environmentBindings.has(value.text);
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === "env" && isProcessObject(value.expression, scope);
  }
  return ts.isElementAccessExpression(value)
    && literalPropertyName(value.argumentExpression) === "env"
    && isProcessObject(value.expression, scope);
}

function clearBinding(name: ts.BindingName, scope: EnvironmentScope): void {
  if (ts.isIdentifier(name)) {
    scope.strings.delete(name.text);
    scope.processBindings.delete(name.text);
    scope.globalBindings.delete(name.text);
    scope.environmentBindings.delete(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) clearBinding(element.name, scope);
  }
}

function registerImport(statement: ts.ImportDeclaration, scope: EnvironmentScope): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier)
    || !["node:process", "process"].includes(statement.moduleSpecifier.text)
    || statement.importClause?.isTypeOnly) return;
  const clause = statement.importClause;
  if (clause?.name) scope.processBindings.add(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) scope.processBindings.add(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "env") scope.environmentBindings.add(element.name.text);
    }
  }
}

function registerBinding(
  name: ts.BindingName,
  initializer: ts.Expression | undefined,
  scope: EnvironmentScope,
  allowStaticStrings: boolean,
): void {
  if (!initializer) return;
  if (ts.isIdentifier(name)) {
    if (isEnvironmentObject(initializer, scope)) scope.environmentBindings.add(name.text);
    if (isProcessObject(initializer, scope)) scope.processBindings.add(name.text);
    if (isGlobalObject(initializer, scope)) scope.globalBindings.add(name.text);
    if (allowStaticStrings) {
      const resolved = resolveStaticStringExpression(initializer, scope.strings);
      if (resolved.resolved && resolved.values.length > 0) scope.strings.set(name.text, resolved);
    }
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  if (isProcessObject(initializer, scope)) {
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      if ((literalPropertyName(element.propertyName) ?? element.name.text) === "env") {
        scope.environmentBindings.add(element.name.text);
      }
    }
  }
}

function registerStatements(statements: readonly ts.Statement[], scope: EnvironmentScope): void {
  for (const statement of statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.name) clearBinding(statement.importClause.name, scope);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) clearBinding(bindings.name, scope);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) clearBinding(element.name, scope);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) clearBinding(declaration.name, scope);
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      clearBinding(statement.name, scope);
    }
  }
  for (const statement of statements) {
    if (ts.isImportDeclaration(statement)) registerImport(statement, scope);
  }
  for (let pass = 0; pass <= statements.length; pass += 1) {
    const before = scope.strings.size + scope.processBindings.size + scope.environmentBindings.size;
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        registerBinding(declaration.name, declaration.initializer, scope, isConst);
      }
    }
    if (before === scope.strings.size + scope.processBindings.size + scope.environmentBindings.size) break;
  }
}

function enclosingSymbol(node: ts.Node): string {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)
      || ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current)
      || ts.isSetAccessorDeclaration(current)) {
      if (current.name && (ts.isIdentifier(current.name) || ts.isStringLiteralLike(current.name))) return current.name.text;
    }
    if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current))
      && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      return current.parent.name.text;
    }
  }
  return "<module>";
}

function operationFor(node: ts.Node): EnvironmentOperation {
  const parent = node.parent;
  if (ts.isDeleteExpression(parent)) return "delete";
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return "write";
  if (ts.isBinaryExpression(parent) && parent.left === node && [
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ].includes(parent.operatorToken.kind)) return "write";
  return "read";
}

function fingerprint(node: ts.Node, source: ts.SourceFile): string {
  const printer = ts.createPrinter({ removeComments: true });
  const normalized = printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, "");
  return createHash("sha256").update(`${String(node.kind)}:${normalized}`).digest("hex");
}

function occurrence(
  path: string,
  node: ts.Node,
  source: ts.SourceFile,
  accessKind: EnvironmentAccessKind,
  operation: EnvironmentOperation,
  key?: string,
): EnvironmentAccessOccurrence {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    path,
    line: position.line + 1,
    column: position.character + 1,
    enclosingSymbol: enclosingSymbol(node),
    accessKind,
    operation,
    ...(key === undefined ? {} : { key }),
    expressionFingerprint: fingerprint(node, source),
  };
}

function isAliasInitializer(node: ts.Expression, scope: EnvironmentScope): boolean {
  const parent = node.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.initializer === node) {
    return ts.isIdentifier(parent.name) && isEnvironmentObject(node, scope);
  }
  return false;
}

function isEnvironmentReceiver(node: ts.Expression, scope: EnvironmentScope): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === node && isEnvironmentObject(node, scope);
}

function isDeclarationBinding(node: ts.Expression): boolean {
  const parent = node.parent;
  return (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || ts.isImportSpecifier(parent)
    || (ts.isNamespaceImport(parent) && parent.name === node)
    || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.propertyName === node);
}

function scanDestructure(
  path: string,
  node: ts.VariableDeclaration | ts.ParameterDeclaration,
  source: ts.SourceFile,
  scope: EnvironmentScope,
  output: EnvironmentAccessOccurrence[],
): void {
  if (!node.initializer || !ts.isObjectBindingPattern(node.name) || !isEnvironmentObject(node.initializer, scope)) return;
  for (const element of node.name.elements) {
    if (element.dotDotDotToken) {
      output.push(occurrence(path, element, source, "bulk", "read"));
      continue;
    }
    const key = literalPropertyName(element.propertyName) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
    if (key === undefined) output.push(occurrence(path, element, source, "unresolved", "read"));
    else output.push(occurrence(path, element, source, "exact", "read", key));
  }
}

/** Lexically scoped, per-occurrence environment access inventory. */
export function inventoryEnvironmentAccesses(path: string, content: string): readonly EnvironmentAccessOccurrence[] {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KINDS[extension(path)] ?? ts.ScriptKind.TS,
  );
  const output: EnvironmentAccessOccurrence[] = [];

  function visit(node: ts.Node, scope: EnvironmentScope): void {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      const child = cloneScope(scope);
      registerStatements(node.statements, child);
      for (const statement of node.statements) visit(statement, child);
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const child = cloneScope(scope);
      for (const parameter of node.parameters) clearBinding(parameter.name, child);
      for (const parameter of node.parameters) {
        if (parameter.initializer) visit(parameter.initializer, child);
        registerBinding(parameter.name, parameter.initializer, child, false);
        scanDestructure(path, parameter, source, child, output);
      }
      if (node.body) visit(node.body, child);
      return;
    }
    if (ts.isCatchClause(node)) {
      const child = cloneScope(scope);
      if (node.variableDeclaration) clearBinding(node.variableDeclaration.name, child);
      visit(node.block, child);
      return;
    }

    if (ts.isVariableDeclaration(node)) scanDestructure(path, node, source, scope, output);

    if (ts.isPropertyAccessExpression(node) && isEnvironmentObject(node.expression, scope)) {
      output.push(occurrence(path, node, source, "exact", operationFor(node), node.name.text));
      return;
    }
    if (ts.isElementAccessExpression(node) && isEnvironmentObject(node.expression, scope)) {
      const argument = node.argumentExpression;
      const resolved = argument && resolveStaticStringExpression(argument, scope.strings);
      if (resolved?.resolved && resolved.exactValue && resolved.values.length === 1) {
        output.push(occurrence(path, node, source, "exact", operationFor(node), resolved.values[0]));
      } else {
        output.push(occurrence(path, node, source, "unresolved", operationFor(node)));
      }
      return;
    }

    if (ts.isExpression(node) && isEnvironmentObject(node, scope)) {
      const parent = node.parent;
      const destructureInitializer = (ts.isVariableDeclaration(parent) || ts.isParameter(parent))
        && parent.initializer === node && ts.isObjectBindingPattern(parent.name);
      if (!isDeclarationBinding(node) && !isEnvironmentReceiver(node, scope)
        && !isAliasInitializer(node, scope) && !destructureInitializer) {
        output.push(occurrence(path, node, source, "bulk", operationFor(node)));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  }

  visit(source, {
    strings: new Map(),
    processBindings: new Set(["process"]),
    globalBindings: new Set(["globalThis"]),
    environmentBindings: new Set(),
  });
  return output;
}
