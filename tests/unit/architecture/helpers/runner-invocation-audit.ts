import { dirname, join, normalize as normalizePath } from "node:path";
import ts from "typescript";

export interface RunnerSource {
  readonly path: string;
  readonly content: string;
}

const BOOTSTRAP = "scripts/secure-env-bootstrap.ts";
const SECRET_OWNER = "src/domain/secrets.ts";
const RUNNERS = [
  { module: "src/cli.ts", exportName: "runCli" },
  {
    module: "scripts/smoke-test-target-person-secrets.ts",
    exportName: "runTestTargetPersonSecretsSmoke",
  },
] as const;
type RunnerName = typeof RUNNERS[number]["exportName"];
type Origin = `module:${string}` | `runner:${RunnerName}` | "admission";

function normalized(path: string): string {
  return normalizePath(path).replaceAll("\\", "/");
}

function resolvedModule(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const raw = normalized(join(dirname(from), specifier));
  return raw.replace(/\.(?:js|mjs|cjs)$/u, ".ts");
}

function sourceFile(source: RunnerSource): ts.SourceFile {
  return ts.createSourceFile(
    source.path,
    source.content,
    ts.ScriptTarget.Latest,
    true,
    source.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function stringArgument(node: ts.CallExpression): string | undefined {
  const [argument] = node.arguments;
  return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function importModule(expression: ts.Expression, path: string): string | undefined {
  if (!ts.isCallExpression(expression)
    || expression.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const specifier = stringArgument(expression);
  return specifier === undefined ? undefined : resolvedModule(path, specifier);
}

function unwrapped(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)) return unwrapped(expression.expression);
  return expression;
}

function propertyText(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.argumentExpression !== undefined
    && ts.isStringLiteralLike(expression.argumentExpression)
    ? expression.argumentExpression.text
    : undefined;
}

function runnerFor(module: string, exportName: string): RunnerName | undefined {
  return RUNNERS.find((candidate) => candidate.module === module
    && candidate.exportName === exportName)?.exportName;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * Prove the secure bootstrap is the sole production invoker of both admitted
 * runners. This follows AST import provenance and local aliases; text that only
 * resembles a call has no symbol origin and is ignored.
 */
export function auditSoleRunnerInvocation(
  sources: readonly RunnerSource[],
): readonly string[] {
  const violations: string[] = [];

  for (const sourceInput of sources) {
    const path = normalized(sourceInput.path);
    const source = sourceFile({ ...sourceInput, path });
    const origins = new Map<string, ReadonlySet<Origin>>();
    const runnerImports: ts.Node[] = [];
    const reexports: ts.Node[] = [];

    const addOrigins = (name: string, added: Iterable<Origin>): boolean => {
      const current = new Set(origins.get(name) ?? []);
      const size = current.size;
      for (const origin of added) current.add(origin);
      origins.set(name, current);
      return current.size !== size;
    };

    for (const runner of RUNNERS) {
      if (path === runner.module) addOrigins(runner.exportName, [`runner:${runner.exportName}`]);
    }

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
        && ts.isStringLiteral(statement.moduleSpecifier)) {
        const module = resolvedModule(path, statement.moduleSpecifier.text);
        if (module === undefined) continue;
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (module === SECRET_OWNER && bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly
              && (element.propertyName?.text ?? element.name.text) === "admitLocalEnvironmentFile") {
              addOrigins(element.name.text, ["admission"]);
            }
          }
        }
        if (!RUNNERS.some((runner) => runner.module === module)) continue;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          addOrigins(bindings.name.text, [`module:${module}`]);
          runnerImports.push(statement);
        } else if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const imported = element.propertyName?.text ?? element.name.text;
            const runner = runnerFor(module, imported);
            if (runner !== undefined) {
              addOrigins(element.name.text, [`runner:${runner}`]);
              runnerImports.push(element);
            }
          }
        }
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
        && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
        const module = resolvedModule(path, statement.moduleSpecifier.text);
        if (module === undefined || !RUNNERS.some((runner) => runner.module === module)) continue;
        const clause = statement.exportClause;
        if (clause === undefined || ts.isNamespaceExport(clause)) {
          reexports.push(statement);
        } else {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            const exported = element.propertyName?.text ?? element.name.text;
            if (runnerFor(module, exported) !== undefined) reexports.push(element);
          }
        }
      }
    }

    const expressionOrigins = (raw: ts.Expression): ReadonlySet<Origin> => {
      const expression = unwrapped(raw);
      if (ts.isIdentifier(expression)) return origins.get(expression.text) ?? new Set();
      const imported = importModule(expression, path);
      if (imported !== undefined) return new Set<Origin>([`module:${imported}`]);
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const receiver = expressionOrigins(expression.expression);
        const property = propertyText(expression);
        const output = new Set<Origin>();
        for (const origin of receiver) {
          if (origin.startsWith("module:") && property !== undefined) {
            const runner = runnerFor(origin.slice("module:".length), property);
            if (runner !== undefined) output.add(`runner:${runner}`);
          } else if (origin.startsWith("runner:")
            && (property === "call" || property === "apply" || property === "bind")) {
            output.add(origin);
          }
        }
        return output;
      }
      if (ts.isBinaryExpression(expression)) {
        return new Set([...expressionOrigins(expression.left), ...expressionOrigins(expression.right)]);
      }
      if (ts.isConditionalExpression(expression)) {
        return new Set([
          ...expressionOrigins(expression.whenTrue),
          ...expressionOrigins(expression.whenFalse),
        ]);
      }
      if (ts.isCallExpression(expression)) {
        const callee = expressionOrigins(expression.expression);
        return new Set([...callee].filter((origin) => origin.startsWith("runner:")));
      }
      return new Set();
    };

    let changed = true;
    while (changed) {
      changed = false;
      const visitBindings = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
          if (ts.isIdentifier(node.name)) {
            changed = addOrigins(node.name.text, expressionOrigins(node.initializer)) || changed;
          } else if (ts.isObjectBindingPattern(node.name)) {
            const receiver = expressionOrigins(node.initializer);
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const property = element.propertyName !== undefined
                && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
                ? element.propertyName.text
                : element.name.text;
              const selected = new Set<Origin>();
              for (const origin of receiver) {
                if (!origin.startsWith("module:")) continue;
                const runner = runnerFor(origin.slice("module:".length), property);
                if (runner !== undefined) selected.add(`runner:${runner}`);
              }
              changed = addOrigins(element.name.text, selected) || changed;
            }
          }
        }
        if (ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(node.left)) {
          changed = addOrigins(node.left.text, expressionOrigins(node.right)) || changed;
        }
        ts.forEachChild(node, visitBindings);
      };
      visitBindings(source);
    }

    const invocations: { runner: RunnerName; node: ts.CallExpression }[] = [];
    const dynamicImports: { runner: RunnerName; node: ts.Node }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const receiver = unwrapped(node.expression);
        const module = importModule(receiver, path);
        const property = propertyText(node);
        if (module !== undefined && property !== undefined) {
          const runner = runnerFor(module, property);
          if (runner !== undefined) dynamicImports.push({ runner, node });
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
        for (const origin of expressionOrigins(node.expression)) {
          if (!origin.startsWith("runner:")) continue;
          invocations.push({ runner: origin.slice("runner:".length) as RunnerName, node });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    if (path !== BOOTSTRAP) {
      for (const node of [...runnerImports, ...reexports, ...dynamicImports.map(({ node }) => node)]) {
        violations.push(
          `${path}:${String(lineOf(source, node))}: admitted runner is reachable outside ${BOOTSTRAP}`,
        );
      }
      for (const invocation of invocations) {
        violations.push(
          `${path}:${String(lineOf(source, invocation.node))}: ${invocation.runner} is invoked outside ${BOOTSTRAP}`,
        );
      }
      continue;
    }

    const pathCalls: ts.CallExpression[] = [];
    const admissionCalls: ts.CallExpression[] = [];
    const visitBootstrap = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)
          && node.expression.text === "repositoryEnvironmentFilePath") pathCalls.push(node);
        if ([...expressionOrigins(node.expression)].includes("admission")) admissionCalls.push(node);
      }
      ts.forEachChild(node, visitBootstrap);
    };
    visitBootstrap(source);
    if (pathCalls.length !== 1 || admissionCalls.length !== 1) {
      violations.push(
        `${path}: secure environment admission must have one repository-path call and one canonical admission call`,
      );
    }
    const admissionPosition = admissionCalls[0]?.getStart(source);
    for (const runner of RUNNERS) {
      const imports = dynamicImports.filter((entry) => entry.runner === runner.exportName);
      const calls = invocations.filter((entry) => entry.runner === runner.exportName);
      if (imports.length !== 1 || calls.length !== 1) {
        violations.push(
          `${path}: ${runner.exportName} must have one canonical dynamic import and one direct invocation`,
        );
        continue;
      }
      if (admissionPosition === undefined
        || admissionPosition >= imports[0]!.node.getStart(source)
        || admissionPosition >= calls[0]!.node.getStart(source)) {
        violations.push(`${path}: environment admission must precede ${runner.exportName}`);
      }
    }
  }

  return violations;
}
