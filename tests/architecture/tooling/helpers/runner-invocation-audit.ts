import { dirname, join, normalize as normalizePath } from "node:path";
import ts from "typescript";

export interface RunnerSource {
  readonly path: string;
  readonly content: string;
}

export type PackageScripts = Readonly<Record<string, string>>;

const BOOTSTRAP = "src/backend/app/bootstrap/secure-env-bootstrap.ts";
const BOOTSTRAP_WRAPPER = "scripts/dev/secure-env-bootstrap.ts";
const SECRET_OWNER = "src/models/config/secrets.ts";
const RUNNERS = [
  { module: "src/cli.ts", exportName: "runCli" },
  {
    module: "scripts/verify/test-target-document-number.ts",
    exportName: "runTestTargetDocumentNumberSmoke",
  },
] as const;
type RunnerName = typeof RUNNERS[number]["exportName"];
type Origin = `module:${string}` | `runner:${RunnerName}` | "admission" | "runtime-admission";

const LOCAL_SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const MAX_EXTERNAL_SOURCE_CLOSURE_FILES = 256;
const MAX_EXTERNAL_SOURCE_CLOSURE_CHARACTERS = 4 * 1024 * 1024;

function normalized(path: string): string {
  return normalizePath(path).replaceAll("\\", "/");
}

function packageScriptTokens(scriptName: string, command: string): readonly string[] {
  if (command.trim() === "") {
    throw new Error(`package script ${JSON.stringify(scriptName)} is empty; executable source declarations must be explicit`);
  }
  if (/['"`$\\]/u.test(command)) {
    throw new Error(`package script ${JSON.stringify(scriptName)} uses shell syntax the runner audit cannot statically resolve: ${command}`);
  }
  if (/[;&|<>()\r\n]/u.test(command)) {
    throw new Error(`package script ${JSON.stringify(scriptName)} contains an executable shell chain the runner audit refuses: ${command}`);
  }
  return command.trim().split(/\s+/u);
}

function isViteExecutableToken(token: string): boolean {
  return normalized(token).split("/").at(-1) === "vite";
}

function declaredViteConfigPath(scriptName: string, command: string): string | undefined {
  if (!command.trim().split(/\s+/u).some(isViteExecutableToken)) return undefined;
  const tokens = packageScriptTokens(scriptName, command);
  const viteIndexes = tokens.reduce<number[]>((indexes, token, index) => {
    if (isViteExecutableToken(token)) indexes.push(index);
    return indexes;
  }, []);
  if (viteIndexes.length !== 1) {
    throw new Error(`package script ${JSON.stringify(scriptName)} must declare exactly one direct static vite executable`);
  }
  const [viteIndex] = viteIndexes;
  if (viteIndex !== 0) {
    throw new Error(`package script ${JSON.stringify(scriptName)} invokes vite indirectly; the runner audit requires a direct static vite command`);
  }

  const configIndexes = tokens.reduce<number[]>((indexes, token, index) => {
    if (token === "--config") indexes.push(index);
    return indexes;
  }, []);
  if (configIndexes.length !== 1) {
    throw new Error(`package script ${JSON.stringify(scriptName)} must declare exactly one --config TypeScript module for runner admission auditing`);
  }
  const config = tokens[configIndexes[0] + 1];
  if (config === undefined || config.startsWith("-") || !/\.[cm]?[jt]sx?$/u.test(config)) {
    throw new Error(`package script ${JSON.stringify(scriptName)} has an unresolved --config source path`);
  }
  const path = normalized(config);
  if (path.startsWith("/") || path === ".." || path.startsWith("../")) {
    throw new Error(`package script ${JSON.stringify(scriptName)} declares config outside the repository: ${config}`);
  }
  return path;
}

function isRepoRelative(path: string): boolean {
  return path !== ".." && !path.startsWith("../") && !path.startsWith("/");
}

function missingSource(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return code === "ENOENT" || error.message === "ENOENT";
}

function localSourceCandidates(importer: string, specifier: string): readonly string[] {
  const raw = normalized(join(dirname(importer), specifier));
  if (!isRepoRelative(raw)) {
    throw new Error(`${importer} imports outside the repository through ${JSON.stringify(specifier)}`);
  }
  if (/[?#]/u.test(raw)) {
    throw new Error(`${importer} has unresolved local import ${JSON.stringify(specifier)}; query/hash source modifiers are not statically admitted`);
  }

  const matchedExtension = LOCAL_SOURCE_EXTENSIONS.find((extension) => raw.endsWith(extension));
  if (matchedExtension !== undefined) {
    const sourceMapped = matchedExtension === ".js" ? `${raw.slice(0, -3)}.ts`
      : matchedExtension === ".jsx" ? `${raw.slice(0, -4)}.tsx`
        : matchedExtension === ".mjs" ? `${raw.slice(0, -4)}.mts`
          : matchedExtension === ".cjs" ? `${raw.slice(0, -4)}.cts`
            : undefined;
    return sourceMapped === undefined ? [raw] : [sourceMapped, raw];
  }
  if (/\.[^/]+$/u.test(raw)) {
    throw new Error(`${importer} has unresolved local import ${JSON.stringify(specifier)}; only executable source modules are admitted`);
  }
  return [
    ...LOCAL_SOURCE_EXTENSIONS.map((extension) => `${raw}${extension}`),
    ...LOCAL_SOURCE_EXTENSIONS.map((extension) => `${raw}/index${extension}`),
  ];
}

function staticLocalSpecifiers(source: RunnerSource): readonly string[] {
  const parsed = sourceFile(source);
  const specifiers = new Set<string>();
  const add = (moduleSpecifier: ts.Expression): void => {
    if (!ts.isStringLiteralLike(moduleSpecifier)) return;
    const specifier = moduleSpecifier.text;
    if (specifier.startsWith(".") || specifier.startsWith("/")) specifiers.add(specifier);
  };
  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      add(statement.moduleSpecifier);
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      const hasRuntimeExport = !statement.isTypeOnly
        && (statement.exportClause === undefined
          || ts.isNamespaceExport(statement.exportClause)
          || statement.exportClause.elements.some((element) => !element.isTypeOnly));
      if (hasRuntimeExport) add(statement.moduleSpecifier);
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)) {
      const specifier = statement.moduleReference.expression;
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
        throw new Error(`${source.path} has an unresolved import-equals require; executable closure must be static`);
      }
      add(specifier);
    }
  }

  const visitDynamicImports = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier !== undefined) add(specifier);
    }
    if ((source.path.endsWith(".cts") || source.path.endsWith(".cjs"))
      && ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "require") {
      const [specifier] = node.arguments;
      if (node.arguments.length !== 1 || specifier === undefined
        || !ts.isStringLiteralLike(specifier)) {
        throw new Error(`${source.path} has an unresolved CommonJS require; executable closure must be static`);
      }
      add(specifier);
    }
    ts.forEachChild(node, visitDynamicImports);
  };
  visitDynamicImports(parsed);
  return [...specifiers];
}


export function packageDeclaredExternalProductionSources(
  scripts: PackageScripts,
  readSource: (path: string) => string,
): readonly RunnerSource[] {
  const paths = new Set<string>();
  for (const [scriptName, command] of Object.entries(scripts)) {
    const config = declaredViteConfigPath(scriptName, command);
    if (config !== undefined && !config.startsWith("src/") && !config.startsWith("scripts/")) {
      paths.add(config);
    }
  }
  if (paths.size === 0) {
    throw new Error("package.json declares no external Vite config module; runner admission scan would be vacuous outside src/scripts");
  }

  const sources = new Map<string, RunnerSource>();
  let totalCharacters = 0;
  const admit = (path: string, content: string): RunnerSource => {
    if (sources.size >= MAX_EXTERNAL_SOURCE_CLOSURE_FILES) {
      throw new Error(`package-declared executable source closure exceeds ${String(MAX_EXTERNAL_SOURCE_CLOSURE_FILES)} files`);
    }
    totalCharacters += content.length;
    if (totalCharacters > MAX_EXTERNAL_SOURCE_CLOSURE_CHARACTERS) {
      throw new Error(`package-declared executable source closure exceeds ${String(MAX_EXTERNAL_SOURCE_CLOSURE_CHARACTERS)} characters`);
    }
    const source = { path, content };
    sources.set(path, source);
    return source;
  };
  const roots = [...paths].sort().map((path) => {
    try {
      return admit(path, readSource(path));
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(
        `package-declared executable source ${path} could not be read${detail}`,
        { cause: error },
      );
    }
  });

  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    if (source === undefined) {
      throw new Error("package-declared executable source closure queue became inconsistent");
    }
    for (const specifier of staticLocalSpecifiers(source)) {
      const candidates = localSourceCandidates(source.path, specifier);
      const known = candidates.find((candidate) => sources.has(candidate));
      if (known !== undefined) continue;
      let admitted: RunnerSource | undefined;
      for (const candidate of candidates) {
        try {
          admitted = admit(candidate, readSource(candidate));
          break;
        } catch (error) {
          if (!missingSource(error)) {
            const detail = error instanceof Error ? `: ${error.message}` : "";
            throw new Error(
              `${source.path} local import ${JSON.stringify(specifier)} could not be read${detail}`,
              { cause: error },
            );
          }
        }
      }
      if (admitted === undefined) {
        throw new Error(`${source.path} has unresolved local import ${JSON.stringify(specifier)}; no repository source module exists`);
      }
      queue.push(admitted);
    }
  }
  return [...sources.values()];
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

function importModule(
  expression: ts.Expression,
  path: string,
  staticSpecifier: (expression: ts.Expression) => string | undefined,
): string | undefined {
  if (!ts.isCallExpression(expression)
    || expression.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const [argument] = expression.arguments;
  const specifier = argument === undefined ? undefined : staticSpecifier(argument);
  return specifier === undefined ? undefined : resolvedModule(path, specifier);
}

function unwrapped(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isAwaitExpression(expression)) return unwrapped(expression.expression);
  return expression;
}

function propertyText(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  staticText?: (expression: ts.Expression) => string | undefined,
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const argument = expression.argumentExpression;
  if (argument === undefined) return undefined;
  if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) return argument.text;
  return staticText?.(argument);
}

function runnerFor(module: string, exportName: string): RunnerName | undefined {
  return RUNNERS.find((candidate) => candidate.module === module
    && candidate.exportName === exportName)?.exportName;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}


export function auditSoleRunnerInvocation(
  sources: readonly RunnerSource[],
): readonly string[] {
  const violations: string[] = [];

  for (const sourceInput of sources) {
    const path = normalized(sourceInput.path);
    const source = sourceFile({ ...sourceInput, path });
    const origins = new Map<string, ReadonlySet<Origin>>();
    const specifiers = new Map<string, ReadonlySet<string>>();
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

    const staticSpecifier = (raw: ts.Expression): string | undefined => {
      const expression = unwrapped(raw);
      if (ts.isStringLiteralLike(expression)) return expression.text;
      if (ts.isIdentifier(expression)) {
        const values = specifiers.get(expression.text);
        return values?.size === 1 ? [...values][0] : undefined;
      }
      if (ts.isBinaryExpression(expression)
        && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticSpecifier(expression.left);
        const right = staticSpecifier(expression.right);
        return left === undefined || right === undefined ? undefined : `${left}${right}`;
      }
      return undefined;
    };

    let changedSpecifiers = true;
    while (changedSpecifiers) {
      changedSpecifiers = false;
      const visitSpecifiers = (node: ts.Node): void => {
        const addSpecifier = (name: ts.Identifier, expression: ts.Expression): void => {
          const value = staticSpecifier(expression);
          if (value !== undefined) {
            const values = new Set(specifiers.get(name.text) ?? []);
            const size = values.size;
            values.add(value);
            if (values.size !== size) {
              specifiers.set(name.text, values);
              changedSpecifiers = true;
            }
          }
        };
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer !== undefined) addSpecifier(node.name, node.initializer);
        if (ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(node.left)) addSpecifier(node.left, node.right);
        ts.forEachChild(node, visitSpecifiers);
      };
      visitSpecifiers(source);
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
              && (element.propertyName?.text ?? element.name.text) === "assertNoMigratedEnvironmentKeys") {
              addOrigins(element.name.text, ["admission"]);
            }
          }
        }
        if (module === "src/backend/storage/admission/bootstrap-admission.ts" && bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) if (!element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === "acquireEntrypointAdmission") addOrigins(element.name.text, ["runtime-admission"]);
        }
        if (module === "src/backend/storage/admission/admission.ts" && bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) if (!element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === "acquireExclusiveRuntimeAdmission") addOrigins(element.name.text, ["runtime-admission"]);
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

    interface PackedBindingSource {
      readonly node: ts.Node;
      readonly expression: ts.Expression;
    }
    const packedBindings = new Map<string, PackedBindingSource[]>();
    const packedAssignments = new Map<string, Map<string, PackedBindingSource[]>>();
    const addPackedBinding = (name: string, node: ts.Node, expression: ts.Expression): void => {
      const current = packedBindings.get(name) ?? [];
      current.push({ node, expression });
      packedBindings.set(name, current);
    };
    const addPackedAssignment = (
      name: string,
      property: string,
      node: ts.Node,
      expression: ts.Expression,
    ): void => {
      const properties = packedAssignments.get(name) ?? new Map<string, PackedBindingSource[]>();
      const current = properties.get(property) ?? [];
      current.push({ node, expression });
      properties.set(property, current);
      packedAssignments.set(name, properties);
    };
    const collectPackedBindings = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer !== undefined) {
        addPackedBinding(node.name.text, node, node.initializer);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (ts.isIdentifier(node.left)) {
          addPackedBinding(node.left.text, node, node.right);
        } else if ((ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
          && ts.isIdentifier(node.left.expression)) {
          const property = propertyText(node.left, staticSpecifier);
          if (property !== undefined) {
            addPackedAssignment(node.left.expression.text, property, node, node.right);
          }
        }
      }
      ts.forEachChild(node, collectPackedBindings);
    };
    collectPackedBindings(source);

    const packedPropertyName = (name: ts.PropertyName): string | undefined => {
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
        return name.text;
      }
      return ts.isComputedPropertyName(name) ? staticSpecifier(name.expression) : undefined;
    };
    const activeProperties = new Map<ts.Expression, Set<string>>();
    const packedPropertyValues = (
      raw: ts.Expression,
      property: string,
      resolving: ReadonlySet<ts.Node>,
    ): readonly ts.Expression[] => {
      const expression = unwrapped(raw);
      const active = activeProperties.get(expression) ?? new Set<string>();
      if (active.has(property)) return [];
      active.add(property); activeProperties.set(expression, active);
      try {
        if (ts.isObjectLiteralExpression(expression)) {
          const values: ts.Expression[] = [];
          for (const member of expression.properties) {
            if (ts.isSpreadAssignment(member)) {
              values.push(...packedPropertyValues(member.expression, property, resolving));
            } else if (ts.isPropertyAssignment(member)) {
              const memberName = packedPropertyName(member.name);
              if (memberName === undefined || memberName === property) {
                values.push(member.initializer);
              }
            } else if (ts.isShorthandPropertyAssignment(member)
              && member.name.text === property) {
              values.push(member.name);
            }
          }
          return values;
        }
        if (ts.isArrayLiteralExpression(expression) && /^\d+$/u.test(property)) {
          const target = Number(property);
          if (expression.elements.some((element) => ts.isSpreadElement(element))) {
            return expression.elements.map((element) => ts.isSpreadElement(element)
              ? element.expression
              : element);
          }
          const selected = expression.elements[target];
          return selected !== undefined && ts.isExpression(selected) ? [selected] : [];
        }
        if (ts.isIdentifier(expression)) {
          const values: ts.Expression[] = [];
          for (const sourceBinding of packedBindings.get(expression.text) ?? []) {
            if (resolving.has(sourceBinding.node)) continue;
            values.push(...packedPropertyValues(
              sourceBinding.expression,
              property,
              new Set([...resolving, sourceBinding.node]),
            ));
          }
          for (const assignment of packedAssignments.get(expression.text)?.get(property) ?? []) {
            if (!resolving.has(assignment.node)) values.push(assignment.expression);
          }
          return values;
        }
        if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
          const receiverProperty = propertyText(expression, staticSpecifier);
          if (receiverProperty === undefined) return [];
          return packedPropertyValues(expression.expression, receiverProperty, resolving)
            .flatMap((value) => packedPropertyValues(value, property, resolving));
        }
        if (ts.isConditionalExpression(expression)) {
          return [
            ...packedPropertyValues(expression.whenTrue, property, resolving),
            ...packedPropertyValues(expression.whenFalse, property, resolving),
          ];
        }
        return [];
      } finally {
        active.delete(property);
        if (active.size === 0) activeProperties.delete(expression);
      }
    };
    const packedAllValues = (
      raw: ts.Expression,
      resolving: ReadonlySet<ts.Node>,
    ): readonly ts.Expression[] => {
      const expression = unwrapped(raw);
      if (ts.isObjectLiteralExpression(expression)) {
        return expression.properties.flatMap((member) => {
          if (ts.isSpreadAssignment(member)) return packedAllValues(member.expression, resolving);
          if (ts.isPropertyAssignment(member)) return [member.initializer];
          if (ts.isShorthandPropertyAssignment(member)) return [member.name];
          return [];
        });
      }
      if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.flatMap((element) => ts.isSpreadElement(element)
          ? packedAllValues(element.expression, resolving)
          : ts.isExpression(element) ? [element] : []);
      }
      if (ts.isIdentifier(expression)) {
        const values: ts.Expression[] = [];
        for (const sourceBinding of packedBindings.get(expression.text) ?? []) {
          if (resolving.has(sourceBinding.node)) continue;
          values.push(...packedAllValues(
            sourceBinding.expression,
            new Set([...resolving, sourceBinding.node]),
          ));
        }
        for (const assignments of packedAssignments.get(expression.text)?.values() ?? []) {
          for (const assignment of assignments) {
            if (!resolving.has(assignment.node)) values.push(assignment.expression);
          }
        }
        return values;
      }
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const property = propertyText(expression, staticSpecifier);
        if (property === undefined) return packedAllValues(expression.expression, resolving);
        return packedPropertyValues(expression.expression, property, resolving);
      }
      if (ts.isConditionalExpression(expression)) {
        return [
          ...packedAllValues(expression.whenTrue, resolving),
          ...packedAllValues(expression.whenFalse, resolving),
        ];
      }
      return [expression];
    };

    function expressionOrigins(
      raw: ts.Expression,
      resolvingExpressions: ReadonlySet<ts.Expression> = new Set(),
    ): ReadonlySet<Origin> {
      const expression = unwrapped(raw);
      if (resolvingExpressions.has(expression)) return new Set();
      const resolving = new Set([...resolvingExpressions, expression]);
      if (ts.isIdentifier(expression)) return origins.get(expression.text) ?? new Set();
      const imported = importModule(expression, path, staticSpecifier);
      if (imported !== undefined) return new Set<Origin>([`module:${imported}`]);
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const receiver = expressionOrigins(expression.expression, resolving);
        const property = propertyText(expression, staticSpecifier);
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
        if (property !== undefined) {
          for (const value of packedPropertyValues(expression.expression, property, new Set())) {
            for (const origin of expressionOrigins(value, resolving)) output.add(origin);
          }
        }
        return output;
      }
      if (ts.isBinaryExpression(expression)) {
        return new Set([
          ...expressionOrigins(expression.left, resolving),
          ...expressionOrigins(expression.right, resolving),
        ]);
      }
      if (ts.isConditionalExpression(expression)) {
        return new Set([
          ...expressionOrigins(expression.whenTrue, resolving),
          ...expressionOrigins(expression.whenFalse, resolving),
        ]);
      }
      if (ts.isCallExpression(expression)) {
        const callee = expressionOrigins(expression.expression, resolving);
        return new Set([...callee].filter((origin) => origin.startsWith("runner:")));
      }
      return new Set();
    }

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
              const propertyName = element.propertyName
                ?? (ts.isIdentifier(element.name) ? element.name : undefined);
              const property = element.dotDotDotToken === undefined && propertyName !== undefined
                ? packedPropertyName(propertyName)
                : undefined;
              const selected = new Set<Origin>();
              for (const origin of receiver) {
                if (!origin.startsWith("module:") || property === undefined) continue;
                const runner = runnerFor(origin.slice("module:".length), property);
                if (runner !== undefined) selected.add(`runner:${runner}`);
              }
              const values = property === undefined
                ? packedAllValues(node.initializer, new Set())
                : packedPropertyValues(node.initializer, property, new Set());
              for (const value of values) {
                for (const origin of expressionOrigins(value)) selected.add(origin);
              }
              const addBindingOrigins = (name: ts.BindingName): void => {
                if (ts.isIdentifier(name)) {
                  changed = addOrigins(name.text, selected) || changed;
                  return;
                }
                for (const nested of name.elements) {
                  if (ts.isBindingElement(nested)) addBindingOrigins(nested.name);
                }
              };
              addBindingOrigins(element.name);
            }
          } else if (ts.isArrayBindingPattern(node.name)) {
            for (const [index, element] of node.name.elements.entries()) {
              if (!ts.isBindingElement(element)) continue;
              const values = element.dotDotDotToken === undefined
                ? packedPropertyValues(node.initializer, String(index), new Set())
                : packedAllValues(node.initializer, new Set());
              const selected = new Set<Origin>();
              for (const value of values) {
                for (const origin of expressionOrigins(value)) selected.add(origin);
              }
              const addBindingOrigins = (name: ts.BindingName): void => {
                if (ts.isIdentifier(name)) {
                  changed = addOrigins(name.text, selected) || changed;
                  return;
                }
                for (const nested of name.elements) {
                  if (ts.isBindingElement(nested)) addBindingOrigins(nested.name);
                }
              };
              addBindingOrigins(element.name);
            }
          }
        }
        if (ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(node.left)) {
          changed = addOrigins(node.left.text, expressionOrigins(node.right)) || changed;
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "then") {
          const receiver = expressionOrigins(node.expression.expression);
          const [callback] = node.arguments;
          if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            const [parameter] = callback.parameters;
            if (parameter !== undefined) {
              for (const origin of receiver) {
                if (!origin.startsWith("module:")) continue;
                const module = origin.slice("module:".length);
                if (ts.isIdentifier(parameter.name)) {
                  changed = addOrigins(parameter.name.text, [origin]) || changed;
                } else if (ts.isObjectBindingPattern(parameter.name)) {
                  for (const element of parameter.name.elements) {
                    if (!ts.isIdentifier(element.name)) continue;
                    const property = element.propertyName !== undefined
                      && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
                      ? element.propertyName.text
                      : element.name.text;
                    const runner = runnerFor(module, property);
                    if (runner !== undefined) {
                      changed = addOrigins(element.name.text, [`runner:${runner}`]) || changed;
                    }
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visitBindings);
      };
      visitBindings(source);
    }

    const invocations: { runner: RunnerName; node: ts.CallExpression }[] = [];
    const dynamicImports: { runner: RunnerName; node: ts.Node }[] = [];
    const unresolvedDynamicImports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [specifier] = node.arguments;
        const module = importModule(node, path, staticSpecifier);
        if (specifier === undefined || (staticSpecifier(specifier) === undefined)) {
          unresolvedDynamicImports.push(node);
        } else if (module !== undefined) {
          for (const runner of RUNNERS) {
            if (runner.module === module) dynamicImports.push({ runner: runner.exportName, node });
          }
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

    if (path === BOOTSTRAP_WRAPPER) {
      const compact = ts.createPrinter({ removeComments: true }).printFile(source).replace(/\s+/gu, "");
      const expected = 'import{pathToFileURL}from"node:url";import{runSecureEnvironmentBootstrap}from"../../src/backend/app/bootstrap/secure-env-bootstrap.js";export{runSecureEnvironmentBootstrap,secureEnvironmentEntrypoint,}from"../../src/backend/app/bootstrap/secure-env-bootstrap.js";exporttype{SecureEnvironmentBootstrapDependencies,SecureEnvironmentEntrypoint,}from"../../src/backend/app/bootstrap/secure-env-bootstrap.js";constentryPath=process.argv[1];if(entryPath!==undefined&&pathToFileURL(entryPath).href===import.meta.url){awaitrunSecureEnvironmentBootstrap();}';
      if (compact !== expected) violations.push(`${path}: bootstrap wrapper must retain only canonical exports and the direct-entry invocation`);
    }

    if (path !== BOOTSTRAP) {
      for (const node of unresolvedDynamicImports) {
        violations.push(
          `${path}:${String(lineOf(source, node))}: dynamic import specifier is unresolved; production import paths must resolve statically`,
        );
      }
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

    for (const node of unresolvedDynamicImports) {
      violations.push(
        `${path}:${String(lineOf(source, node))}: dynamic import specifier is unresolved; production import paths must resolve statically`,
      );
    }

    const admissionCalls: ts.CallExpression[] = [];
    const runtimeAdmissionCalls: ts.CallExpression[] = [];
    const visitBootstrap = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && [...expressionOrigins(node.left)].some(origin => origin === "admission" || origin === "runtime-admission")) violations.push(`${path}: canonical admission binding cannot be reassigned`);
      if (ts.isParameter(node) && ts.isIdentifier(node.name) && [...expressionOrigins(node.name)].some(origin => origin === "admission" || origin === "runtime-admission")) violations.push(`${path}: canonical admission binding cannot be shadowed`);
      if (ts.isCallExpression(node)) {
        if ([...expressionOrigins(node.expression)].includes("admission")) admissionCalls.push(node);
        if ([...expressionOrigins(node.expression)].includes("runtime-admission")) runtimeAdmissionCalls.push(node);
      }
      ts.forEachChild(node, visitBootstrap);
    };
    visitBootstrap(source);
    const compact = (node: ts.Node): string => ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/gu, "");
    let keyRefusal = 0, mainAdmission = 0;
    const profileCustody: ts.IfStatement[] = [];
    const topology = (node: ts.Node): void => {
      if (ts.isIfStatement(node) && ts.isBlock(node.parent) && ts.isTryStatement(node.parent.parent) && compact(node.expression) === '!bootDiagnostics&&!(entrypoint==="cli"&&(entrypointArgs[0]==="storage"||entrypointArgs[0]==="test-data"))'
        && compact(node.thenStatement) === '{(dependencies.assertEnvironment??(()=>assertNoMigratedEnvironmentKeys()))();}' && node.elseStatement === undefined) keyRefusal += 1;
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === "admission" && node.initializer !== undefined
        && compact(node.initializer) === '(dependencies.acquireAdmission??((requested)=>bootDiagnostics?acquireExclusiveRuntimeAdmission(workspace):acquireEntrypointAdmission(workspace,requested)))(mode)') mainAdmission += 1;
      if (ts.isIfStatement(node) && ts.isBlock(node.parent) && ts.isTryStatement(node.parent.parent)
        && compact(node.expression) === 'entrypoint==="cli"&&entrypointArgs[0]==="worker"'
        && compact(node.thenStatement) === '{const{captureSelectedProfileStorage}=awaitimport("../composition/storage-compose.js");constselected=captureSelectedProfileStorage(admission);initialWorkerCustody=acquireRuntimeProcessLock({processLockRoot:join(workspace,rebuildRuntimeIsolation.processLockRoot),name:"workers",pid:process.pid,admission:{kind:"unbound-worker",authorityPath:selected.authorityPath}});selected.assertCurrent();}'
        && node.elseStatement === undefined) profileCustody.push(node);
      ts.forEachChild(node, topology);
    };
    topology(source);
    const selector = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "secureEnvironmentEntrypoint");
    const selectorValid = selector !== undefined && ts.isFunctionDeclaration(selector) && selector.body?.statements.length === 2
      && ts.isIfStatement(selector.body.statements[0]) && compact(selector.body.statements[0].expression) === 'selector==="cli"||selector==="test-target-document-number"'
      && compact(selector.body.statements[0].thenStatement) === 'returnselector;' && selector.body.statements[0].elseStatement === undefined && ts.isThrowStatement(selector.body.statements[1]);
    const machineAdmissions = runtimeAdmissionCalls.filter(call => compact(call) === "acquireEntrypointAdmission(workspace,requested)");
    const exclusiveAdmission = runtimeAdmissionCalls.filter(call => compact(call) === "acquireExclusiveRuntimeAdmission(workspace)");
    const custodyCall = invocations.filter(call => call.runner === "runCli").find(call => compact(call.node) === "runCli(admission,()=>{constcustody=initialWorkerCustody;initialWorkerCustody=undefined;returncustody;})");
    const exclusiveImport = source.statements.some(statement => ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier) && resolvedModule(path, statement.moduleSpecifier.text) === "src/backend/storage/admission/admission.ts"
      && statement.importClause?.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some(element => !element.isTypeOnly && element.name.text === "acquireExclusiveRuntimeAdmission" && element.propertyName === undefined));
    if (admissionCalls.length !== 1 || runtimeAdmissionCalls.length !== 3 || machineAdmissions.length !== 2 || exclusiveAdmission.length !== 1
      || keyRefusal !== 1 || mainAdmission !== 1 || profileCustody.length !== 1 || !selectorValid || custodyCall === undefined || !exclusiveImport) {
      violations.push(`${path}: secure environment bootstrap requires canonical key refusal, exact storage/test-data exemptions, strict selector and canonical runtime admission`);
    }
    const admissionPosition = admissionCalls[0]?.getStart(source);
    if (profileCustody.length === 1 && (custodyCall === undefined || profileCustody[0].getStart(source) >= custodyCall.node.getStart(source))) {
      violations.push(`${path}: selected profile custody must precede the admitted CLI runner`);
    }
    for (const runner of RUNNERS) {
      const imports = dynamicImports.filter((entry) => entry.runner === runner.exportName);
      const calls = invocations.filter((entry) => entry.runner === runner.exportName);
      if (imports.length !== 1 || calls.length !== 1) {
        violations.push(
          `${path}: ${runner.exportName} must have one canonical dynamic import and one direct invocation`,
        );
        continue;
      }
      const imported = imports[0];
      const called = calls[0];
      if (imported === undefined || called === undefined) {
        violations.push(`${path}: ${runner.exportName} canonical import/call lookup was inconsistent`);
        continue;
      }
      if (admissionPosition === undefined
        || admissionPosition >= imported.node.getStart(source)
        || admissionPosition >= called.node.getStart(source)) {
        violations.push(`${path}: environment admission must precede ${runner.exportName}`);
      }
    }
  }

  return violations;
}
