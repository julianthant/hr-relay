import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { walkFiles } from "../support/helpers/guard-files.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const FACTORY_OWNER = "src/models/task/task-contract.ts";

function taskSymbol(checker: ts.TypeChecker, node: ts.Node, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  if (symbol.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith(`/${FACTORY_OWNER}`))) return symbol;
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const resolved = taskSymbol(checker, declaration.initializer, seen);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

function canonicalFactory(checker: ts.TypeChecker, node: ts.Node): boolean {
  return taskSymbol(checker, node)?.name === "defineTaskContract";
}

function objectExpression(node: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return ts.isObjectLiteralExpression(node);
}

function isContractSource(path: string, source: ts.SourceFile, checker: ts.TypeChecker): boolean {
  if (path === FACTORY_OWNER) return true;
  let contract = false;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && canonicalFactory(checker, node.expression)) contract = true;
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "__sealed") contract = true;
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))
      && objectExpression(node.expression)
      && (/\b(?:Sealed\w*Contract|(?:Read|Prepare|Commit|Any)TaskContract)\b/u.test(node.type.getText(source)) || node.type.getText(source).includes("__sealed")
        || ts.isTypeReferenceNode(node.type) && /Contract$/u.test(taskSymbol(checker, node.type.typeName)?.name ?? ""))) contract = true;
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && objectExpression(node.initializer) && node.type !== undefined
      && ts.isTypeReferenceNode(node.type) && /Contract$/u.test(taskSymbol(checker, node.type.typeName)?.name ?? "")) contract = true;
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set(node.properties.filter(ts.isPropertyAssignment).map(property => property.name.getText(source)));
      if (["id", "effect", "input", "output", "errorCodes"].every(name => names.has(name))) contract = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return contract;
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
      const module = stringLiteralValue(node.moduleSpecifier);
      if (module !== undefined) modules.push(module);
    }
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      const module = stringLiteralValue(node.arguments[0]);
      if (module !== undefined) modules.push(module);
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

function contractAstIssues(path: string, source: ts.SourceFile): readonly string[] {
  const issues: string[] = [];
  const factoryOwner = path === "src/models/task/task-contract.ts";
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === "z" && node.expression.name.text === "object") {
      issues.push(`${path}: task boundaries must use z.strictObject`);
    }
    if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      issues.push(`${path}: contract modules cannot use dynamic imports or require`);
    }
    if (!factoryOwner && ts.isPropertyAssignment(node)
      && node.name.getText(source) === "__sealed" && node.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      issues.push(`${path}: only defineTaskContract may mint a sealed contract`);
    }
    if (!factoryOwner && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))) {
      const typeText = node.type.getText(source);
      if (/\b(?:Sealed\w*Contract|(?:Read|Prepare|Commit)TaskContract)\b/u.test(typeText)
        || typeText.includes("__sealed")) {
        issues.push(`${path}: structural cast cannot forge a sealed task contract`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return issues;
}

function auditTaskContractSources(root: string, census?: string[]): readonly string[] {
  const issues: string[] = [];
  const files = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  const program = createGuardProgram(files, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const sources = new Map(files.map((file) => {
    const path = relative(root, file).replaceAll("\\", "/");
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`missing parsed source ${path}`);
    return [path, source] as const;
  }));
  const contractPaths = [...sources].filter(([path, source]) => isContractSource(path, source, checker)).map(([path]) => path);
  census?.push(...contractPaths.sort());
  if (contractPaths.length === 0) issues.push("task-contract source family is empty");
  const imports = new Map([...sources].map(([path, source]) => [
    path,
    importedModules(source),
  ]));
  for (const path of contractPaths) {
    const source = sources.get(path);
    if (!source) throw new Error(`missing parsed source ${path}`);
    issues.push(...contractAstIssues(path, source));
    if (path !== FACTORY_OWNER) {
      function minted(expression: ts.Expression, seen = new Set<ts.Symbol>()): boolean {
        while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
        if (ts.isCallExpression(expression)) return canonicalFactory(checker, expression.expression);
        if (!ts.isIdentifier(expression)) return false;
        let symbol = checker.getSymbolAtLocation(expression);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        if (symbol === undefined || seen.has(symbol)) return false;
        seen.add(symbol);
        return symbol.declarations?.some(declaration => ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && minted(declaration.initializer, seen)) === true;
      }
      function contractType(type: ts.TypeNode): boolean {
        return /\b(?:Sealed\w*Contract|(?:Read|Prepare|Commit|Any)TaskContract)\b/u.test(type.getText(source))
          || type.getText(source).includes("__sealed")
          || ts.isTypeReferenceNode(type) && /Contract$/u.test(taskSymbol(checker, type.typeName)?.name ?? "");
      }
      function inspect(node: ts.Node): void {
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined && node.type !== undefined
          && contractType(node.type) && !minted(node.initializer)) issues.push(`${path}: task declaration has no canonical defineTaskContract mint`);
        if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))
          && contractType(node.type) && !minted(node.expression)) issues.push(`${path}: task declaration has no canonical defineTaskContract mint`);
        if (ts.isObjectLiteralExpression(node)) {
          const names = new Set(node.properties.filter(ts.isPropertyAssignment).map(property => property.name.getText(source)));
          if (names.has("__sealed") || ["id", "effect", "input", "output", "errorCodes"].every(name => names.has(name))) {
            let argument: ts.Node = node;
            while (ts.isParenthesizedExpression(argument.parent) || ts.isAsExpression(argument.parent) || ts.isTypeAssertionExpression(argument.parent) || ts.isSatisfiesExpression(argument.parent)) argument = argument.parent;
            if (!ts.isCallExpression(argument.parent) || !canonicalFactory(checker, argument.parent.expression)) issues.push(`${path}: task declaration has no canonical defineTaskContract mint`);
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
    for (const specifier of imports.get(path) ?? []) {
      if (!specifier.startsWith(".") && specifier !== "zod") {
        issues.push(`${path}: bundle-safe contract imports external runtime module ${specifier}`);
      }
    }
    const visited = new Set<string>();
    const stack = (imports.get(path) ?? []).flatMap((specifier) => {
      const resolved = resolveLocalImport(root, path, specifier);
      return resolved === undefined ? [] : [resolved];
    });
    while (stack.length > 0) {
      const dependency = stack.pop();
      if (dependency === undefined || visited.has(dependency)) continue;
      visited.add(dependency);
      if (!dependency.startsWith("src/models/")
        && !dependency.startsWith("src/rules/")
        && !contractPaths.includes(dependency)) {
        issues.push(`${path}: import graph reaches server/runtime infrastructure ${dependency}`);
        continue;
      }
      for (const specifier of imports.get(dependency) ?? []) {
        if (!specifier.startsWith(".") && specifier !== "zod") {
          issues.push(`${path}: import graph reaches external runtime module ${specifier}`);
          continue;
        }
        const resolved = resolveLocalImport(root, dependency, specifier);
        if (resolved !== undefined) stack.push(resolved);
      }
    }
  }
  return [...new Set(issues)];
}

describe("task contract sealing architecture", () => {
  it("keeps task contracts bundle-safe and factory-sealed", () => {
    const census: string[] = [];
    assert.deepEqual(auditTaskContractSources(REPO_ROOT, census), []);
    assert.deepEqual(census, [
      "src/models/processing/extraction/extract-pdf-pages.ts",
      "src/models/processing/extraction/extract-spreadsheet.ts",
      "src/models/processing/normalization/normalize-contact.ts",
      "src/models/processing/ocr/extract-form-page.ts",
      "src/models/processing/roster/match-spreadsheet.ts",
      "src/models/systems/crm/read-onboarding-dates.ts",
      "src/models/systems/crm/read-onboarding-record.ts",
      "src/models/systems/crm/read-onboarding-results.ts",
      "src/models/systems/crm/search-onboarding-records.ts",
      "src/models/systems/crm/verify-onboarding-record.ts",
      "src/models/systems/kuali/match-separation-finalization.ts",
      "src/models/systems/kuali/read-separation-document.ts",
      "src/models/systems/kuali/save-separation-finalization.ts",
      "src/models/systems/kuali/search-separation-action.ts",
      "src/models/systems/kuali/stage-separation-finalization.ts",
      "src/models/systems/kuali/verify-separation-finalization.ts",
      "src/models/systems/new-kronos/read-separation-timecard.ts",
      "src/models/systems/new-kronos/search-employee.ts",
      "src/models/systems/ucpath/create-termination.ts",
      "src/models/systems/ucpath/delete-pending-terminations.ts",
      "src/models/systems/ucpath/match-existing-termination.ts",
      "src/models/systems/ucpath/match-pending-terminations.ts",
      "src/models/systems/ucpath/read-job-summary.ts",
      "src/models/systems/ucpath/read-pending-termination-set.ts",
      "src/models/systems/ucpath/search-person-match.ts",
      "src/models/systems/ucpath/search-person-org.ts",
      "src/models/systems/ucpath/stage-pending-termination-sweep.ts",
      "src/models/systems/ucpath/stage-termination.ts",
      "src/models/systems/ucpath/verify-pending-terminations-cleared.ts",
      "src/models/systems/ucpath/verify-termination-filing-present.ts",
      "src/models/systems/ucpath/verify-termination.ts",
      "src/models/task/task-contract.ts",
      "src/models/workflows/person-lookup/read-active-status.ts",
      "src/models/workflows/person-lookup/read-resolved-identity.ts",
      "src/models/workflows/separations/match-active-employment.ts",
      "src/models/workflows/separations/match-department-option.ts",
      "src/models/workflows/separations/match-identity.ts",
      "src/models/workflows/separations/match-separation-subject.ts",
      "src/models/workflows/separations/match-termination-type.ts",
      "src/models/workflows/separations/read-separation-dates.ts",
      "src/models/workflows/separations/read-separation-plan.ts",
      "src/models/workflows/separations/verify-identity-approval.ts",
      "src/models/workflows/separations/verify-termination-receipt.ts",
    ]);
    const base = readFileSync(resolve(REPO_ROOT, "src/models/task/task-contract.ts"), "utf8");
    for (const effect of ["read", "prepare", "commit"]) {
      assert.match(base, new RegExp(`readonly effect: ["']${effect}["']`, "u"));
    }
    assert.match(base, /sealDeclarativeMetadata\(\{ \.\.\.contract, example: parsedExample, __sealed: true as const \}\)/u);
  });

  it("pins compile-time denial of undeclared errors, unsafe outputs, and read mutation", () => {
    const fixture = readFileSync(resolve(REPO_ROOT, "tests/types/task-contracts.typecheck.ts"), "utf8");
    assert.match(fixture, /undeclared task error codes must not compile/u);
    assert.match(fixture, /read contexts cannot acquire mutation capability/u);
    assert.match(fixture, /z\.any cannot be a canonical task output schema/u);
    assert.match(fixture, /z\.unknown cannot be a canonical task output schema/u);
    assert.match(fixture, /browser task contexts reject service-system drivers/u);
    assert.match(fixture, /taskFailer\(contract\)/u);
    assert.doesNotMatch(fixture, /taskFailer\s*</u);
  });

  it("catches store-contract dynamic/import-graph, schema, and sealing bypasses", () => {
    const root = resolve(tmpdir(), `hrauto-task-contract-${String(process.pid)}-${String(Date.now())}`);
    const file = resolve(root, "src/models/systems/ucpath/bad.ts");
    const helper = resolve(root, "src/backend/systems/ucpath/helper.ts");
    try {
      mkdirSync(dirname(file), { recursive: true });
      mkdirSync(dirname(helper), { recursive: true });
      writeFileSync(
        file,
        'import { z } from "zod";\nimport { helper } from "../../../backend/systems/ucpath/helper.js";\nvoid import("playwright");\nexport const open = z.object({ value: z.string() });\nexport const forged = { __sealed: true, helper } as SealedReadContract;\n',
      );
      writeFileSync(helper, 'export { taskFailer as helper } from "../../base/task.js";\n');
      const issues = auditTaskContractSources(root).join("\n");
      assert.match(issues, /dynamic imports/);
      assert.match(issues, /external runtime module playwright/);
      assert.match(issues, /server\/runtime infrastructure/);
      assert.match(issues, /z\.strictObject/);
      assert.match(issues, /mint a sealed contract/);
      assert.match(issues, /structural cast/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it("follows canonical factory aliases and reexports and rejects future forged declarations", () => {
  const root = resolve(tmpdir(), `hrauto-task-family-${String(process.pid)}-${String(Date.now())}`);
  const owner = resolve(root, FACTORY_OWNER);
  const model = resolve(root, "src/models/systems/future/task.ts");
  const bridge = resolve(root, "src/models/task/bridge.ts");
  try {
    mkdirSync(dirname(owner), { recursive: true }); mkdirSync(dirname(model), { recursive: true });
    writeFileSync(owner, 'export function defineTaskContract(value: unknown) { return value; } export interface ReadTaskContract { readonly effect: "read" }');
    writeFileSync(bridge, 'export { defineTaskContract as define } from "./task-contract.js";');
    writeFileSync(model, 'import { define as factory } from "../../task/bridge.js"; const alias = factory; export const contract = alias({ id: "future/read", effect: "read", input: 1, output: 1, errorCodes: [] });');
    assert.deepEqual(auditTaskContractSources(root), []);
    for (const source of [
      'export const forged = { __sealed: true };',
      'export const forged = {} as ReadTaskContract;',
      'import type { ReadTaskContract as Read } from "../../task/task-contract.js"; export const forged: Read = { effect: "read" };',
      'export const unsealed = { id: "future/read", effect: "read", input: 1, output: 1, errorCodes: [] };',
    ]) {
      writeFileSync(model, source);
      assert.match(auditTaskContractSources(root).join("\n"), /task declaration has no canonical defineTaskContract mint/u);
    }
    const good = 'import { define as factory } from "../../task/bridge.js"; import type { ReadTaskContract as Read } from "../../task/task-contract.js"; const good = factory({ id: "future/read", effect: "read", input: 1, output: 1, errorCodes: [] });';
    for (const forged of [
      'const bad: Read = { effect: "read" };',
      'const bad = { effect: "read" } as Read;',
      'const bad = { effect: "read" } satisfies Read;',
      'const fake = { effect: "read" }; const bad: Read = fake;',
    ]) {
      writeFileSync(model, good + forged);
      assert.match(auditTaskContractSources(root).join("\n"), /task declaration has no canonical defineTaskContract mint/u, forged);
    }
    writeFileSync(model, good + 'const copy: Read = good;');
    assert.deepEqual(auditTaskContractSources(root), []);
    writeFileSync(model, 'import { define as factory } from "../../task/bridge.js"; export function spoof(factory: (value: unknown) => unknown) { return factory({ id: "future/read", effect: "read", input: 1, output: 1, errorCodes: [] }); }');
    assert.match(auditTaskContractSources(root).join("\n"), /task declaration has no canonical defineTaskContract mint/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
