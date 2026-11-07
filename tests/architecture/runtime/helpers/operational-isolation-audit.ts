import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";



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
  readonly archiveDatabaseFile?: string;
  readonly artifactRoot: string;
  readonly backendPort: number;
  readonly lockPort?: number;
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

function hasExactAdmissionParameter(source: ts.SourceFile, runner: ts.FunctionDeclaration,
  importerFile: string, admissionFile: string): boolean {
  if (runner.parameters.length === 0) return true;
  if (![1, 3].includes(runner.parameters.length) || runner.body === undefined) return false;
  if (runner.parameters.length === 3) {
    const printer = ts.createPrinter({ removeComments: true });
    const compact = (parameter: ts.ParameterDeclaration) => printer.printNode(ts.EmitHint.Unspecified, parameter, source).replace(/\s+/gu, "");
    const dashboard = runner.parameters[1], lifetime = runner.parameters[2];
    if (dashboard === undefined || lifetime === undefined
      || compact(dashboard) !== "acceptDashboardAdmission:(()=>void)|undefined"
      || compact(lifetime) !== "lifetime:RuntimeLifetime") return false;
    const imported = source.statements.some(statement => ts.isImportDeclaration(statement)
      && statement.importClause?.isTypeOnly === true && ts.isStringLiteral(statement.moduleSpecifier)
      && moduleResolvesTo(importerFile, statement.moduleSpecifier.text, resolve(admissionFile, "..", "..", "..", "app", "bootstrap", "secure-env-bootstrap.ts"))
      && statement.importClause.namedBindings !== undefined && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some(element => element.name.text === "RuntimeLifetime" && element.propertyName === undefined));
    if (!imported) return false;
  }
  const parameter = runner.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name) || parameter.name.text !== "admission"
    || parameter.initializer !== undefined || parameter.questionToken !== undefined
    || parameter.dotDotDotToken !== undefined || parameter.modifiers !== undefined
    || parameter.type === undefined || !ts.isTypeReferenceNode(parameter.type)
    || !ts.isIdentifier(parameter.type.typeName) || parameter.type.typeName.text !== "RuntimeAdmission"
    || parameter.type.typeArguments !== undefined) return false;
  const importsAdmission = source.statements.some(statement => {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly !== true
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !moduleResolvesTo(importerFile, statement.moduleSpecifier.text, admissionFile)) return false;
    const bindings = statement.importClause.namedBindings;
    return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some(element =>
      element.name.text === "RuntimeAdmission" && element.propertyName === undefined);
  });
  const first = runner.body.statements[0];
  if (first === undefined || !ts.isExpressionStatement(first) || !ts.isCallExpression(first.expression)) return false;
  const call = first.expression;
  return importsAdmission && call.arguments.length === 0 && ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === "admission"
    && call.expression.name.text === "assertLive";
}

function hasExactExportedRunnerCompositionCall(
  source: ts.SourceFile,
  runnerExport: string,
  factory: string,
  bindingPath: string,
  bindingName: string,
  importerFile: string,
  admissionFile: string,
): boolean {
  const runners = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === runnerExport
    && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    && statement.body !== undefined);
  if (runners.length !== 1) return false;
  const runner = runners[0];
  if (runner === undefined || runner.body === undefined
    || !hasExactAdmissionParameter(source, runner, importerFile, admissionFile)) return false;
  const matchingCalls = runner.body.statements.filter((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    // Awaiting the direct runner call preserves ownership of its lifetime promise.
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
    ...(side.archiveDatabaseFile === undefined ? {} : { archiveDatabaseFile: side.archiveDatabaseFile }),
    artifactRoot: side.artifactRoot,
    backendPort: side.backendPort,
    ...(side.lockPort === undefined ? {} : { lockPort: side.lockPort }),
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
      file,
      resolve(repoRoot, "src/backend/storage/admission/admission.ts"),
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
  // Repository-relative state roots do not collide across checkouts.
  "artifactRoot",
  "processLockRoot",
  // Repository-relative profiles stay separate on disk; session namespaces prevent cross-runtime reuse.
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
  if (contract.rebuild.lockPort === undefined || [contract.rebuild.backendPort, contract.rebuild.frontendPort,
    contract.legacy.backendPort, contract.legacy.frontendPort].includes(contract.rebuild.lockPort)) {
    addViolation(output, "runtime-binding", repoRoot, contractFile, "lockPort must be a dedicated port distinct from both runtimes' HTTP ports");
  }
  // Command names may coincide; each checkout must retain its own exact launch scripts.
  return output;
}


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
