import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { walkFiles } from "./helpers/guard-files.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function isContractSource(path: string): boolean {
  return path.startsWith("src/") && path.includes("/contracts/") && path.endsWith(".ts");
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
  const factoryOwner = path === "src/domain/contracts/base.ts";
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

function auditTaskContractSources(root: string): readonly string[] {
  const issues: string[] = [];
  const files = walkFiles(resolve(root, "src"), { missing: "planned-empty" });
  const sources = new Map(files.map((file) => {
    const path = relative(root, file).replaceAll("\\", "/");
    const source = ts.createSourceFile(path, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return [path, source] as const;
  }));
  const contractPaths = [...sources.keys()].filter(isContractSource);
  if (contractPaths.length === 0) issues.push("task-contract source family is empty");
  const imports = new Map([...sources].map(([path, source]) => [
    path,
    importedModules(source),
  ]));
  for (const path of contractPaths) {
    const source = sources.get(path);
    if (!source) throw new Error(`missing parsed source ${path}`);
    issues.push(...contractAstIssues(path, source));
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
      if (!dependency.startsWith("src/domain/")
        && !dependency.startsWith("src/validation/")
        && !isContractSource(dependency)) {
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
    assert.deepEqual(auditTaskContractSources(REPO_ROOT), []);
    const base = readFileSync(resolve(REPO_ROOT, "src/domain/contracts/base.ts"), "utf8");
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
    const file = resolve(root, "src/stores/ucpath/contracts/bad.ts");
    const helper = resolve(root, "src/stores/ucpath/helper.ts");
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        'import { z } from "zod";\nimport { helper } from "../helper.js";\nvoid import("playwright");\nexport const open = z.object({ value: z.string() });\nexport const forged = { __sealed: true, helper } as SealedReadContract;\n',
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
