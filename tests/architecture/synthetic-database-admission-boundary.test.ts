import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { REPO_ROOT, repoRelative } from "./helpers/guard-files.js";

const narrowHelper = "tests/helpers/synthetic-database-admission.ts";
const forbiddenModules = new Set([
  "src/backend/app/control/test-data.ts",
  "src/backend/app/control/test-target-registry.ts",
  "src/backend/app/test-data/compose.ts",
  "src/backend/app/storage-compose.ts",
]);

function valueSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly = clause?.isTypeOnly === true || (clause?.name === undefined && bindings !== undefined
        && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly));
      if (!typesOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.exportClause;
      if (bindings === undefined || !ts.isNamedExports(bindings) || bindings.elements.some(binding => !binding.isTypeOnly)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function valueClosure(entry: string, override?: string): Set<string> {
  const seen = new Set<string>();
  const pending = [resolve(REPO_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    assert.ok(file);
    if (seen.has(file)) continue;
    seen.add(file);
    const text = file === resolve(REPO_ROOT, entry) && override !== undefined ? override : readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const specifier of valueSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolve(file, "..", specifier);
      if (!target.endsWith(".js")) continue;
      const candidates = [target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx"];
      const resolved = candidates.find(candidate => existsSync(candidate));
      assert.ok(resolved, `Unresolved fixture value import: ${repoRelative(file)} -> ${specifier}`);
      pending.push(resolved);
    }
  }
  return new Set([...seen].map(repoRelative));
}

function forbiddenReach(closure: ReadonlySet<string>): string[] {
  return [...closure].filter(file => forbiddenModules.has(file)).sort();
}

describe("synthetic database fixture admission import boundary", () => {
  it("uses the real databases and admission without loading test-data or storage CLI composition", () => {
    const closure = valueClosure(narrowHelper);
    for (const required of ["src/infra/sqlite/authority-database.ts", "src/infra/sqlite/archive-database.ts", "src/infra/runtime-control/admission.ts"]) assert.ok(closure.has(required), required);
    assert.deepEqual(forbiddenReach(closure), []);
    const harness = valueClosure("tests/unit/server/helpers/dashboard-harness.ts");
    assert.ok(harness.has(narrowHelper));
    assert.deepEqual(forbiddenReach(harness), []);
  });

  it("launch fixtures retain real authority admission without unrelated command compositions", () => {
    const fixture = "tests/integration/fixtures/source-bound-fixtures.ts";
    const closure = valueClosure("tests/fixtures/run-launch-fixtures.ts");
    for (const required of [fixture, narrowHelper, "src/infra/sqlite/authority-database.ts", "src/infra/runtime-control/admission.ts"]) assert.ok(closure.has(required), required);
    assert.deepEqual(forbiddenReach(closure), []);
    const source = readFileSync(resolve(REPO_ROOT, fixture), "utf8");
    assert.ok(source.includes("../../helpers/synthetic-database-admission.js"));
    const injected = source.replace("../../helpers/synthetic-database-admission.js", "../../helpers/synthetic-storage-admission.js");
    assert.deepEqual(forbiddenReach(valueClosure(fixture, injected)), [...forbiddenModules].sort());
  });

  it("detects the broad fixture's real side-effect closure and a reintroduced value reexport", () => {
    assert.deepEqual(forbiddenReach(valueClosure("tests/helpers/synthetic-storage-admission.ts")), [...forbiddenModules].sort());
    const source = readFileSync(resolve(REPO_ROOT, narrowHelper), "utf8");
    const reach = forbiddenReach(valueClosure(narrowHelper, `${source}\nexport * from "../../src/backend/app/test-data/compose.js";\n`));
    assert.ok(reach.includes("src/backend/app/test-data/compose.ts"));
    assert.ok(reach.includes("src/backend/app/control/test-data.ts"));
    assert.ok(reach.includes("src/backend/app/control/test-target-registry.ts"));
  });
});
