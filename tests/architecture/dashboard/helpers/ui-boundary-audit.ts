import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { walkFiles } from "../../support/helpers/guard-files.js";

const RAW_BROWSER_TYPES = new Set(["Page", "Locator", "FrameLocator", "Browser", "BrowserContext"]);
const RAW_BROWSER_MEMBERS = new Set([
  "locator", "frameLocator", "getByRole", "getByText", "getByLabel", "getByTestId",
  "newPage", "evaluate", "$", "$$", "$eval", "$$eval",
]);

/**
 * The closed set of modules allowed to name a Playwright type or drive a raw
 * page. Three closed families, each with one responsibility:
 *
 * - `src/backend/systems/<system>/driver/**` and `.../session.ts` own ONE
 *   system's page knowledge — its semantic driver and its login recipe.
 * - `src/backend/runtime/browser/**` owns browser CREATION itself: the persistent
 *   context, the Duo Autopilot extension, and the provable teardown behind
 *   `WorkerBrowserSessionFactory` (ref execution-and-sessions §4 — "concrete browser creation
 *   remains a factory injected at the runtime composition boundary"). It has
 *   runtime resource ownership stays separate from one system's driver.
 * - `src/backend/systems/browser-shared/**` owns the reusable browser action
 *   and login adapters consumed by system sessions and drivers.
 *
 * Workflow wrappers under `src/workflows/<workflow>/tasks/**` are
 * sessionless consumers; they remain outside the raw-browser owner set.
 * Membership is the whole enforcement — a task or workflow that reaches any
 * private browser family transitively is still a violation, checked below.
 */
function isRawBrowserOwner(path: string): boolean {
  return /^src\/backend\/systems\/[a-z0-9-]+\/driver\//u.test(path)
    || /^src\/backend\/systems\/[a-z0-9-]+\/session\.ts$/u.test(path)
    || /^src\/backend\/runtime\/browser\//u.test(path)
    || /^src\/backend\/systems\/browser-shared\//u.test(path);
}

function isTaskOrWorkflow(path: string): boolean {
  return /^src\/backend\/processing\/[a-z0-9-]+\/tasks\//u.test(path)
    || /^src\/backend\/systems\/[a-z0-9-]+\/tasks\//u.test(path)
    || /^src\/workflows\//u.test(path);
}

function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function importedModules(source: ts.SourceFile): readonly string[] {
  const modules: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const value = stringLiteralValue(node.moduleSpecifier);
      if (value !== undefined) modules.push(value);
    }
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const value = stringLiteralValue(node.arguments[0]);
      if (value !== undefined) modules.push(value);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return modules;
}

function resolveLocalImport(root: string, fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(root, dirname(fromPath), specifier.replace(/\.js$/u, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
    if (existsSync(candidate)) return relative(root, candidate).replaceAll("\\", "/");
  }
  return undefined;
}

function declaredSymbol(checker: ts.TypeChecker, node: ts.Node, name: string, owner: string): boolean {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.name === name && symbol.declarations?.some(declaration =>
    declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith(`/${owner}`)) === true;
}

function installationLocator(checker: ts.TypeChecker, node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.BindingElement, seen = new Set<ts.Symbol>()): boolean {
  const type = checker.getTypeAtLocation(ts.isBindingElement(node) ? node.name : node);
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || type.getCallSignatures().length > 0) return false;
  const symbol = ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name)
    : ts.isBindingElement(node) ? checker.getTypeAtLocation(node.parent).getProperty("locator")
      : checker.getTypeAtLocation(node.expression).getProperty("locator");
  if (symbol === undefined || seen.has(symbol)) return false;
  seen.add(symbol);
  return symbol.declarations?.some(declaration => {
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const value = checker.getShorthandAssignmentValueSymbol(declaration);
      return value?.declarations?.some(binding => ts.isVariableDeclaration(binding) && binding.initializer !== undefined
        && (ts.isPropertyAccessExpression(binding.initializer) || ts.isElementAccessExpression(binding.initializer))
        && installationLocator(checker, binding.initializer, seen)) === true;
    }
    if ((!ts.isPropertySignature(declaration) && !ts.isGetAccessorDeclaration(declaration)) || declaration.type === undefined) return false;
    return ts.isTypeReferenceNode(declaration.type) && declaredSymbol(checker, declaration.type.typeName,
      "RuntimeLocator", "src/backend/storage/admission/installation.ts");
  }) === true;
}

function durableArchiveCommit(checker: ts.TypeChecker, node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node) || !ts.isArrowFunction(node.initializer)
    || !ts.isCallExpression(node.initializer.body)) return false;
  const call = node.initializer.body;
  if (!declaredSymbol(checker, call.expression, "publishManualArchive", "src/backend/runs/lifecycle/archive-terminal-runs.ts")) return false;
  const object = node.parent;
  if (!ts.isObjectLiteralExpression(object)) return false;
  const contextual = checker.getContextualType(object);
  if (contextual === undefined || contextual.getSymbol()?.name !== "CommandApplication"
    || contextual.getSymbol()?.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith("/src/backend/runs/commands/command-application.ts")) !== true) return false;
  let enclosing: ts.Node = object;
  while (!ts.isFunctionLike(enclosing) && enclosing.parent !== undefined) enclosing = enclosing.parent;
  if (!ts.isFunctionDeclaration(enclosing) || enclosing.type === undefined || !ts.isTypeReferenceNode(enclosing.type)
    || !declaredSymbol(checker, enclosing.type.typeName, "CommandApplication", "src/backend/runs/commands/command-application.ts")) return false;
  const inspectedTypes = new Set<ts.Type>();
  function browserDescendant(type: ts.Type, location: ts.Node): boolean {
    if (inspectedTypes.has(type)) return false;
    inspectedTypes.add(type);
    if ((type.flags & ts.TypeFlags.Any) !== 0) return true;
    if (type.isUnionOrIntersection()) return type.types.some(member => browserDescendant(member, location));
    if ((type.flags & ts.TypeFlags.Object) === 0 || type.getCallSignatures().length > 0) return false;
    return type.getProperties().some(property => RAW_BROWSER_MEMBERS.has(property.name) || property.name === "click"
      || browserDescendant(checker.getTypeOfSymbolAtLocation(property, location), location));
  }
  let unsafe = false;
  function inspect(child: ts.Node): void {
    if (ts.isExpression(child) && browserDescendant(checker.getTypeAtLocation(child), child)) unsafe = true;
    if (ts.isPropertyAccessExpression(child) && (RAW_BROWSER_MEMBERS.has(child.name.text) || child.name.text === "click")) unsafe = true;
    ts.forEachChild(child, inspect);
  }
  for (const argument of call.arguments) inspect(argument);
  return !unsafe;
}

function actionNoteCommit(checker: ts.TypeChecker, node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node) || !ts.isArrowFunction(node.initializer)) return false;
  const fn = node.initializer;
  const parameter = fn.parameters[0];
  const actionOwner = "src/backend/systems/browser-shared/action-notes.ts";
  if (fn.parameters.length !== 1 || parameter === undefined || !ts.isIdentifier(parameter.name)
    || parameter.type === undefined || !ts.isTypeReferenceNode(parameter.type)
    || !declaredSymbol(checker, parameter.type.typeName, "BrowserAction", actionOwner)
    || fn.type === undefined || !ts.isTypeReferenceNode(fn.type)
    || !declaredSymbol(checker, fn.type.typeName, "BrowserAction", actionOwner)
    || !ts.isBlock(fn.body) || fn.body.statements.length !== 3) return false;
  const [bind, retain, returned] = fn.body.statements;
  if (bind === undefined || !ts.isVariableStatement(bind) || bind.declarationList.declarations.length !== 1
    || (bind.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const binding = bind.declarationList.declarations[0];
  if (binding === undefined || !ts.isIdentifier(binding.name) || binding.initializer === undefined
    || !ts.isCallExpression(binding.initializer)) return false;
  const call = binding.initializer;
  if (call.arguments.length !== 1 || call.arguments[0].getText() !== parameter.name.text
    || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "commit") return false;
  const symbol = checker.getSymbolAtLocation(call.expression.name);
  if (symbol?.declarations?.some(declaration => ts.isPropertyAssignment(declaration)
    && ts.isCallExpression(declaration.initializer)
    && declaredSymbol(checker, declaration.initializer.expression, "createDeclaredActionBinder", "src/backend/runtime/writes/operation-action-binding.ts")) !== true) return false;
  if (returned === undefined || !ts.isReturnStatement(returned) || returned.expression?.getText() !== binding.name.text
    || retain === undefined || !ts.isIfStatement(retain) || retain.elseStatement !== undefined) return false;
  const condition = retain.expression;
  function equals(expression: ts.Expression, member: string, value: string): boolean {
    return ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && expression.left.getText().replaceAll("?.", ".") === `${binding.name.getText()}.${member}`
      && ts.isStringLiteral(expression.right) && expression.right.text === value;
  }
  if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
    || !equals(condition.left, "kind", "clicked") || !equals(condition.right, "operation.state", "completed")) return false;
  const retained = retain.thenStatement;
  if (!ts.isExpressionStatement(retained) || !ts.isCallExpression(retained.expression)) return false;
  const push = retained.expression;
  if (!ts.isPropertyAccessExpression(push.expression) || push.expression.name.text !== "push"
    || push.arguments.length !== 1 || push.arguments[0].getText() !== binding.name.text) return false;
  const collection = checker.getSymbolAtLocation(push.expression.expression);
  return collection?.declarations?.some(declaration => ts.isVariableDeclaration(declaration)
    && declaration.type !== undefined && ts.isArrayTypeNode(declaration.type)
    && ts.isTypeReferenceNode(declaration.type.elementType)
    && declaredSymbol(checker, declaration.type.elementType.typeName, "BrowserAction", actionOwner)
    && declaration.initializer !== undefined && ts.isArrayLiteralExpression(declaration.initializer)
    && declaration.initializer.elements.length === 0) === true;
}

function rawBrowserAstIssues(path: string, source: ts.SourceFile, checker: ts.TypeChecker): readonly string[] {
  const issues: string[] = [];
  const rawOwner = isRawBrowserOwner(path);
  function visit(node: ts.Node): void {
    if (!rawOwner && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) {
      const module = stringLiteralValue(node.moduleSpecifier);
      if (module?.startsWith("playwright") === true) issues.push(`${path}: Playwright import crosses the driver/session boundary`);
    }
    if (!rawOwner && ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const module = stringLiteralValue(node.arguments[0]);
      if (module?.startsWith("playwright") === true) issues.push(`${path}: dynamic Playwright import crosses the driver/session boundary`);
    }
    if (!rawOwner && ts.isIdentifier(node) && RAW_BROWSER_TYPES.has(node.text)) {
      issues.push(`${path}: raw browser type ${node.text} crosses the driver/session boundary`);
    }
    if (!rawOwner && ts.isPropertyAccessExpression(node) && RAW_BROWSER_MEMBERS.has(node.name.text)
      && !(node.name.text === "locator" && installationLocator(checker, node))) {
      issues.push(`${path}: raw browser member .${node.name.text} crosses the driver/session boundary`);
    }
    if (!rawOwner && ts.isElementAccessExpression(node)) {
      const member = stringLiteralValue(node.argumentExpression);
      if (member !== undefined && RAW_BROWSER_MEMBERS.has(member)
        && !(member === "locator" && installationLocator(checker, node))) {
        issues.push(`${path}: computed raw browser member ${member} crosses the driver/session boundary`);
      }
    }
    if (!rawOwner && ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = node.propertyName ?? node.name;
      const member = ts.isIdentifier(name) ? name.text : stringLiteralValue(name);
      if (member !== undefined && RAW_BROWSER_MEMBERS.has(member)
        && !(member === "locator" && installationLocator(checker, node))) {
        issues.push(`${path}: extracted raw browser member ${member} crosses the driver/session boundary`);
      }
    }
    // Ref write-safety beat ⑤ / D111: `src/workflow-kit/mutation-capability.ts` owns the ONE
    // sanctioned minting point (its WeakSet makes the token runtime-
    // unforgeable); every other file asserting the brand is still a forgery.
    if (path !== MUTATION_CAPABILITY_REGISTRY
      && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && node.type.getText(source).includes("MutationCapability")) {
      issues.push(`${path}: MutationCapability cannot be minted by type assertion`);
    }
    if (ts.isSatisfiesExpression(node) && node.type.getText(source).includes("MutationCapability")) {
      issues.push(`${path}: MutationCapability cannot be minted by satisfies`);
    }
    // The minting FUNCTION has exactly one caller. Naming it anywhere else is
    // a second minting point even though the assertion stayed in one file.
    if (path !== MUTATION_CAPABILITY_REGISTRY && path !== MUTATION_CAPABILITY_MINTER
      && ts.isIdentifier(node) && node.text === "mintMutationCapability") {
      issues.push(`${path}: mintMutationCapability has exactly one permitted caller`);
    }
    // Browser commits require a capability-validating driver owner; durable
    // Archive callbacks require their exact command and publisher declarations.
    const commitImplementation = (ts.isMethodDeclaration(node) && node.name.getText(source) === "commit"
      && node.body !== undefined)
      || (ts.isPropertyAssignment(node) && node.name.getText(source) === "commit"
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
      || (ts.isFunctionDeclaration(node) && node.name?.getText(source) === "commit" && node.body !== undefined);
    if (commitImplementation && !durableArchiveCommit(checker, node) && !actionNoteCommit(checker, node)
      && !(DRIVER_OWNER_PATTERN.test(path) && source.getFullText().includes("assertMintedMutationCapability"))) {
      issues.push(
        `${path}: a commit implementation must live in a store driver owner and validate its `
        + "MutationCapability before clicking",
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...new Set(issues)];
}

const MUTATION_CAPABILITY_REGISTRY = "src/workflow-kit/mutation-capability.ts";
const MUTATION_CAPABILITY_MINTER = "src/backend/runtime/writes/write-sequencer.ts";
const DRIVER_OWNER_PATTERN = /^src\/(?:stores|backend\/systems)\/[a-z0-9-]+\/driver\//u;

export function auditTaskDriverBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  const absoluteFiles = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  const parsed = new Map(absoluteFiles.map(absolute => {
    const path = relative(root, absolute).replaceAll("\\", "/");
    return [absolute, ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)] as const;
  }));
  const semanticFiles = absoluteFiles.filter(absolute => {
    const source = parsed.get(absolute);
    let needed = false;
    function inspect(node: ts.Node): void {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "locator"
        || ts.isElementAccessExpression(node) && stringLiteralValue(node.argumentExpression) === "locator"
        || ts.isPropertyAssignment(node) && node.name.getText(source) === "commit"
        || ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(source) === "locator") needed = true;
      ts.forEachChild(node, inspect);
    }
    if (source !== undefined) inspect(source);
    return needed;
  });
  const configPath = resolve(root, "tsconfig.json");
  const options = existsSync(configPath)
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, path => ts.sys.readFile(path)).config, ts.sys, root).options
    : { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve };
  const program = ts.createProgram(semanticFiles, options);
  const checker = program.getTypeChecker();
  const sources = new Map(absoluteFiles.map(absolute => {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const source = program.getSourceFile(absolute) ?? parsed.get(absolute);
    if (source === undefined || semanticFiles.includes(absolute) && program.getSourceFile(absolute) === undefined) {
      throw new Error(`task-driver-boundary: source unavailable ${path}`);
    }
    return [path, source] as const;
  }));
  const imports = new Map([...sources].map(([path, source]) => [
    path,
    importedModules(source).flatMap((specifier) => {
      const resolved = resolveLocalImport(root, path, specifier);
      return resolved === undefined ? [] : [resolved];
    }),
  ]));

  for (const [path, source] of sources) issues.push(...rawBrowserAstIssues(path, source, checker));
  for (const taskPath of [...sources.keys()].filter(isTaskOrWorkflow)) {
    const visited = new Set<string>();
    const stack = [...(imports.get(taskPath) ?? [])];
    while (stack.length > 0) {
      const dependency = stack.pop();
      if (dependency === undefined || visited.has(dependency)) continue;
      visited.add(dependency);
      if (isRawBrowserOwner(dependency)) {
        issues.push(`${taskPath}: import graph reaches private raw-browser owner ${dependency}`);
        continue;
      }
      stack.push(...(imports.get(dependency) ?? []));
    }
  }
  return [...new Set(issues)];
}
