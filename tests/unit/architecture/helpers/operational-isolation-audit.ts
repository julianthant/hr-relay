import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

/**
 * Operational isolation — the half of D88 that a repository boundary does NOT
 * hold for you (D93, ref guards-and-tests §3.13).
 *
 * The original `runtime-isolation` guard was two things bolted together: a
 * whole-tree AST scan proving neither side could reach the other through a
 * dynamic import, process spawn, filesystem read, HTTP call, or route proxy —
 * and a configuration audit proving the two sides bind DIFFERENT state roots,
 * artifact roots, ports, process locks, and browser profiles.
 *
 * D93 retires the first half outright: two repositories share no module graph,
 * so a legacy->rebuild import is not a violation to catch, it is an expression
 * that cannot resolve. Retiring it is an explicit recorded replacement, not a
 * silent shrink — this file is that replacement, and the guard inventory names
 * it.
 *
 * The second half survives UNCHANGED, because both worlds still run on ONE
 * machine. A shared port, lock file, state root, or Chromium profile is a real
 * collision that no repository boundary prevents. So the executable-binding
 * proof stays exactly as strict as it was: an exported direct-`const`
 * `defineRuntimeIsolation` call with the exact isolated literal values, and a
 * composition root that consumes it through unshadowed named imports in one
 * direct call inside the declared exported runner — awaited or not, because
 * the runner owns the `dashboard` command's whole lifetime and must return its
 * promise. Secure environment admission owns invocation of that runner; a
 * mention or another function is not proof.
 */

export const SUPPORTED_MODULE_FAMILIES = [
  "filesystem",
  "network-route",
  "process-execution",
  "module-loader",
  "browser-profile",
] as const;

export type RuntimeModuleFamily = typeof SUPPORTED_MODULE_FAMILIES[number];

export interface RuntimeSideContract {
  readonly sourceRoot: string;
  readonly entrypoint: string;
  readonly commands: Readonly<Record<string, string>>;
  readonly stateRoot: string;
  readonly artifactRoot: string;
  readonly backendPort: number;
  readonly frontendPort: number;
  readonly processLockRoot: string;
  readonly browserProfileRoot: string;
  readonly browserSessionNamespace: string;
  readonly runtimeConfig?: {
    readonly module: string;
    readonly factory: string;
    readonly factoryModule: string;
    readonly factoryExport: string;
    readonly exportName: string;
  };
  readonly compositionRoots?: readonly {
    readonly path: string;
    readonly factory: string;
    readonly factoryModule: string;
    readonly factoryExport: string;
    readonly bindingPath: string;
    readonly runnerExport: string;
  }[];
}

export interface OperationalIsolationContract {
  readonly schemaVersion: 3;
  readonly legacy: RuntimeSideContract;
  readonly rebuild: RuntimeSideContract;
}

export interface OperationalIsolationViolation {
  readonly bridgeClass: "runtime-binding";
  readonly file: string;
  readonly detail: string;
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

function moduleResolvesTo(file: string, specifier: string, expectedFile: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const raw = resolve(dirname(file), specifier);
  const candidates = [
    raw,
    raw.replace(/\.(?:js|mjs|cjs)$/, ".ts"),
    raw.replace(/\.(?:js|mjs|cjs)$/, ".tsx"),
  ].map(normalize);
  return candidates.includes(normalize(expectedFile));
}

function addViolation(
  output: OperationalIsolationViolation[],
  bridgeClass: OperationalIsolationViolation["bridgeClass"],
  repoRoot: string,
  file: string,
  detail: string,
): void {
  output.push({ bridgeClass, file: normalize(relative(repoRoot, file)), detail });
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) {
    return property.name.text;
  }
  return undefined;
}

function literalValue(node: ts.Expression): string | number | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function hasExactNamedImport(
  source: ts.SourceFile,
  importerFile: string,
  expectedModuleFile: string,
  importedName: string,
  localName: string,
): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !moduleResolvesTo(importerFile, statement.moduleSpecifier.text, expectedModuleFile)) return false;
    const bindings = statement.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) && bindings.elements.some((element) =>
      !element.isTypeOnly
      && (element.propertyName?.text ?? element.name.text) === importedName
      && element.name.text === localName);
  });
}

function hasTopLevelValueDeclaration(source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name);
    }
    return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement))
      && statement.name?.text === name;
  });
}

function exactBindingArgument(
  call: ts.CallExpression,
  bindingPath: string,
  bindingName: string,
): boolean {
  const match = /^(\d+)(?:\.([A-Za-z_$][\w$]*))?$/.exec(bindingPath);
  if (!match) return false;
  const index = Number(match[1]);
  if (call.arguments.length !== index + 1) return false;
  const argument = call.arguments[index];
  const property = match[2];
  if (!property) return ts.isIdentifier(argument) && argument.text === bindingName;
  if (!ts.isObjectLiteralExpression(argument) || argument.properties.length !== 1) return false;
  const member = argument.properties[0];
  return ts.isPropertyAssignment(member) && propertyName(member) === property
    && ts.isIdentifier(member.initializer) && member.initializer.text === bindingName;
}

function hasExactExportedRunnerCompositionCall(
  source: ts.SourceFile,
  runnerExport: string,
  factory: string,
  bindingPath: string,
  bindingName: string,
): boolean {
  const runners = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === runnerExport
    && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    && statement.body !== undefined);
  if (runners.length !== 1) return false;
  const runner = runners[0];
  if (runner === undefined || runner.parameters.length !== 0 || runner.body === undefined) return false;
  const matchingCalls = runner.body.statements.filter((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    // `await startRebuildRuntime(...)` is the same one direct call: the runner
    // returns the runtime's lifetime promise, so awaiting it is required, not a
    // second indirection. Everything else about the call stays exactly as
    // strict — same identifier, same unshadowed binding argument.
    const expression = ts.isAwaitExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression;
    if (!ts.isCallExpression(expression)) return false;
    return ts.isIdentifier(expression.expression) && expression.expression.text === factory
      && exactBindingArgument(expression, bindingPath, bindingName);
  });
  return matchingCalls.length === 1;
}

function executableRuntimeBinding(
  repoRoot: string,
  side: RuntimeSideContract,
): OperationalIsolationViolation[] {
  const output: OperationalIsolationViolation[] = [];
  const config = side.runtimeConfig;
  if (!config) {
    addViolation(output, "runtime-binding", repoRoot, repoRoot, "active rebuild contract has no runtimeConfig binding");
    return output;
  }
  const configFile = resolve(repoRoot, config.module);
  if (!existsSync(configFile)) {
    addViolation(output, "runtime-binding", repoRoot, configFile, "runtime config module is missing");
    return output;
  }
  const configFactoryFile = resolve(repoRoot, config.factoryModule);
  if (!existsSync(configFactoryFile)) {
    addViolation(output, "runtime-binding", repoRoot, configFactoryFile, "runtime config factory module is missing");
  }
  const source = parse(configFile);
  const importsFactory = hasExactNamedImport(
    source,
    configFile,
    configFactoryFile,
    config.factoryExport,
    config.factory,
  );
  const factoryIsShadowed = hasTopLevelValueDeclaration(source, config.factory);
  let bound: Record<string, string | number> | undefined;
  let boundShapeExact = false;
  let boundPropertyCount = 0;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)
      || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
      || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      || statement.declarationList.declarations.length !== 1) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== config.exportName
        || !declaration.initializer || !ts.isCallExpression(declaration.initializer)
        || !ts.isIdentifier(declaration.initializer.expression)
        || declaration.initializer.expression.text !== config.factory
        || declaration.initializer.arguments.length !== 1) continue;
      const argument = declaration.initializer.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) continue;
      bound = {};
      boundPropertyCount = argument.properties.length;
      boundShapeExact = argument.properties.every((property) =>
        ts.isPropertyAssignment(property)
        && propertyName(property) !== undefined
        && literalValue(property.initializer) !== undefined);
      for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property);
        const value = literalValue(property.initializer);
        if (name && value !== undefined) bound[name] = value;
      }
    }
  }
  const expected = {
    stateRoot: side.stateRoot,
    artifactRoot: side.artifactRoot,
    backendPort: side.backendPort,
    frontendPort: side.frontendPort,
    processLockRoot: side.processLockRoot,
    browserProfileRoot: side.browserProfileRoot,
    browserSessionNamespace: side.browserSessionNamespace,
  };
  const boundKeys = Object.keys(bound ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  const exactBinding = importsFactory && !factoryIsShadowed && boundShapeExact
    && boundPropertyCount === expectedKeys.length
    && JSON.stringify(boundKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => bound?.[key] === expected[key as keyof typeof expected]);
  if (!exactBinding) {
    addViolation(output, "runtime-binding", repoRoot, configFile, `runtime config must import ${config.factory} and export one direct const call with the exact isolated values`);
  }

  for (const composition of side.compositionRoots ?? []) {
    const file = resolve(repoRoot, composition.path);
    if (!existsSync(file)) {
      addViolation(output, "runtime-binding", repoRoot, file, "composition root is missing");
      continue;
    }
    const rootSource = parse(file);
    const compositionFactoryFile = resolve(repoRoot, composition.factoryModule);
    const importsBinding = hasExactNamedImport(
      rootSource,
      file,
      configFile,
      config.exportName,
      config.exportName,
    );
    const importsFactoryBinding = hasExactNamedImport(
      rootSource,
      file,
      compositionFactoryFile,
      composition.factoryExport,
      composition.factory,
    );
    const isUnshadowed = !hasTopLevelValueDeclaration(rootSource, config.exportName)
      && !hasTopLevelValueDeclaration(rootSource, composition.factory);
    const consumesBinding = hasExactExportedRunnerCompositionCall(
      rootSource,
      composition.runnerExport,
      composition.factory,
      composition.bindingPath,
      config.exportName,
    );
    if (!existsSync(compositionFactoryFile) || !importsBinding || !importsFactoryBinding
      || !isUnshadowed || !consumesBinding) {
      addViolation(output, "runtime-binding", repoRoot, file, `composition root must export ${composition.runnerExport} with one direct factory call using unshadowed exact imports at the declared binding path`);
    }
  }
  return output;
}

function validateCommands(
  repoRoot: string,
  side: RuntimeSideContract,
  scripts: Readonly<Record<string, string>>,
): OperationalIsolationViolation[] {
  const output: OperationalIsolationViolation[] = [];
  for (const [name, expected] of Object.entries(side.commands)) {
    if (scripts[name] !== expected) {
      addViolation(output, "runtime-binding", repoRoot, resolve(repoRoot, "package.json"), `${name} must equal ${expected}`);
    }
  }
  return output;
}

/** Resources that must differ between the two runtimes on one machine. */
export const DISTINCT_RESOURCE_KEYS = [
  // `stateRoot` left this list with D321 (operator decision, 2026-09-03): both
  // repos name their state root `.tracker`, and a repo-relative root never
  // collides across checkouts. The artifact root, the lock root, both ports
  // and the session namespace below still differ and stay audited.
  "artifactRoot",
  "processLockRoot",
  // `browserProfileRoot` left this list with D216 (operator decision,
  // 2026-08-14): both repos name their profile root `.auth`, which never
  // collides on disk because the roots are repo-relative. The browser-state
  // identity that MUST stay distinct is `browserSessionNamespace` below —
  // that is what keeps a session opened in the wrong checkout from reusing
  // the other runtime's authenticated state.
  "browserSessionNamespace",
] as const;

function validateDistinctResources(
  repoRoot: string,
  contract: OperationalIsolationContract,
): OperationalIsolationViolation[] {
  const output: OperationalIsolationViolation[] = [];
  const contractFile = resolve(repoRoot, "config/runtime-isolation.json");
  for (const key of DISTINCT_RESOURCE_KEYS) {
    if (contract.legacy[key] === contract.rebuild[key]) {
      addViolation(output, "runtime-binding", repoRoot, contractFile, `${key} must differ between the two runtimes`);
    }
  }
  if (contract.legacy.backendPort === contract.rebuild.backendPort) {
    addViolation(output, "runtime-binding", repoRoot, contractFile, "backendPort must differ between the two runtimes");
  }
  if (contract.legacy.frontendPort === contract.rebuild.frontendPort) {
    addViolation(output, "runtime-binding", repoRoot, contractFile, "frontendPort must differ between the two runtimes");
  }
  // D247: command NAMES are not an isolation resource; each declared command
  // is still audited byte-exactly against its own checkout's scripts.
  return output;
}

/**
 * Audits THIS repo's rebuild runtime binding plus the cross-runtime resource
 * distinctness the machine still needs. `legacyScripts` is the legacy repo's
 * own `package.json` scripts map — the declared launch commands must stay
 * exact on both sides (D247: exact, not distinct), which is only checkable with
 * both in hand.
 */
export function auditOperationalIsolation(
  repoRoot: string,
  contract: OperationalIsolationContract,
  rebuildScripts: Readonly<Record<string, string>>,
  legacyScripts: Readonly<Record<string, string>>,
): OperationalIsolationViolation[] {
  return [
    ...validateDistinctResources(repoRoot, contract),
    ...validateCommands(repoRoot, contract.rebuild, rebuildScripts),
    ...validateCommands(repoRoot, contract.legacy, legacyScripts),
    ...executableRuntimeBinding(repoRoot, contract.rebuild),
  ];
}
