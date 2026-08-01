import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { walkFiles } from "./guard-files.js";

const RAW_BROWSER_TYPES = new Set(["Page", "Locator", "FrameLocator", "Browser", "BrowserContext"]);
const RAW_BROWSER_MEMBERS = new Set([
  "locator", "frameLocator", "getByRole", "getByText", "getByLabel", "getByTestId",
  "newPage", "evaluate", "$", "$$", "$eval", "$$eval",
]);

function isRawBrowserOwner(path: string): boolean {
  return /^src\/stores\/[a-z0-9-]+\/driver\//u.test(path)
    || /^src\/stores\/[a-z0-9-]+\/session\.ts$/u.test(path);
}

function isTaskOrWorkflow(path: string): boolean {
  return /^src\/stores\/[a-z0-9-]+\/tasks\//u.test(path)
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

function rawBrowserAstIssues(path: string, source: ts.SourceFile): readonly string[] {
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
    if (!rawOwner && ts.isPropertyAccessExpression(node) && RAW_BROWSER_MEMBERS.has(node.name.text)) {
      issues.push(`${path}: raw browser member .${node.name.text} crosses the driver/session boundary`);
    }
    if (!rawOwner && ts.isElementAccessExpression(node)) {
      const member = stringLiteralValue(node.argumentExpression);
      if (member !== undefined && RAW_BROWSER_MEMBERS.has(member)) {
        issues.push(`${path}: computed raw browser member ${member} crosses the driver/session boundary`);
      }
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && node.type.getText(source).includes("MutationCapability")) {
      issues.push(`${path}: MutationCapability cannot be minted by type assertion`);
    }
    if (ts.isSatisfiesExpression(node) && node.type.getText(source).includes("MutationCapability")) {
      issues.push(`${path}: MutationCapability cannot be minted by satisfies`);
    }
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === "commit" && node.body !== undefined) {
      issues.push(`${path}: commit implementation is forbidden before the Phase 1f runtime token validator`);
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "commit"
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      issues.push(`${path}: commit implementation is forbidden before the Phase 1f runtime token validator`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...new Set(issues)];
}

export function auditTaskDriverBoundary(root: string): readonly string[] {
  const issues: string[] = [];
  const absoluteFiles = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  const sources = new Map(absoluteFiles.map((absolute) => {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const content = readFileSync(absolute, "utf8");
    return [path, ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)] as const;
  }));
  const imports = new Map([...sources].map(([path, source]) => [
    path,
    importedModules(source).flatMap((specifier) => {
      const resolved = resolveLocalImport(root, path, specifier);
      return resolved === undefined ? [] : [resolved];
    }),
  ]));

  for (const [path, source] of sources) issues.push(...rawBrowserAstIssues(path, source));
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
