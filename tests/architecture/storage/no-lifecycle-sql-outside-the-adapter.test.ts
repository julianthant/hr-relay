import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT, repoRelative } from "../support/helpers/guard-files.js";
import { scaledMs } from "../../support/time-scale.js";

const ALLOWLIST = ["src/backend/storage/sqlite/authority-database.ts", "src/backend/runs/lifecycle/run-record-service.ts"];
const RUN_MUTATORS = new Set(["enqueue", "claimNext", "claimEligible", "renewClaim", "transition", "resume", "requeue",
  "requestCancellation", "advanceRevision", "bumpPriority", "updatePresentation", "injectCheckpointPatches",
  "delete", "terminalizeFailure", "terminalizeSuccess"]);
function owner(node: ts.Node, name: string): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if ((ts.isTypeAliasDeclaration(current) || ts.isClassDeclaration(current)) && current.name?.text === name) return true;
  }
  return false;
}
function mutator(declaration: ts.Declaration | undefined): boolean {
  if (declaration === undefined || repoRelative(declaration.getSourceFile().fileName) !== ALLOWLIST[0]
    || !(ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration))) return false;
  const name = declaration.name.getText();
  return owner(declaration, "RunRepository") && RUN_MUTATORS.has(name)
    || owner(declaration, "AuthorityDatabase") && ["terminalizeFailure", "terminalizeSuccess"].includes(name)
    || owner(declaration, "ArchivedRunRepository") && name === "insert"
    || owner(declaration, "DiagnosticBundleRepository") && name === "purge";
}

const ARCHIVE_SECTION_SQL = "UPDATE archived_runs SET transactions_json=?, transactions_digest=? WHERE record_key=? AND transactions_json IS NULL";
const COMPLETION_SQL = "UPDATE workflow_runs SET record_json = ? WHERE record_key = ?";
function allowedCompletionSql(relative: string, node: ts.Node): boolean {
  if (relative !== "src/backend/storage/sqlite/completion-conversion.ts" || !ts.isStringLiteralLike(node) || node.text !== COMPLETION_SQL) return false;
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent.name?.text === "convertRunCompletions";
  }
  return false;
}
function allowedArchiveSectionSql(relative: string, node: ts.Node): boolean {
  if (relative !== "src/backend/storage/sqlite/timeline-conversion.ts" || !ts.isStringLiteralLike(node)
    || node.text !== ARCHIVE_SECTION_SQL) return false;
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent.name?.text === "freezeConvertedArchiveTransactions";
  }
  return false;
}
function allowedNativeDeletionSql(relative: string, node: ts.Node): boolean {
  if (relative !== "src/backend/storage/sqlite/native-run-deletion.ts" || !ts.isStringLiteralLike(node)
    || node.text !== "INSERT INTO deleted_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)") return false;
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent.name?.text === "executeNativeRunDeletion";
  }
  return false;
}
function nativeDeletionSqlFixture(path: string, functionName: string, sql: string): boolean {
  const source = ts.createSourceFile(path, `function ${functionName}() { database.prepare(${JSON.stringify(sql)}); }`, ts.ScriptTarget.Latest, true);
  let accepted = false;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) accepted = allowedNativeDeletionSql(path, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return accepted;
}
function collectAudit(): readonly string[] {
  const roots = gitVisibleFiles(["src"]).filter((path) => /\.tsx?$/u.test(path));
  const extras = new Map(["sql", "mutator", "view"].map((kind) => [resolve(REPO_ROOT, `src/core/guard-fixtures/${kind}.ts`),
    readFileSync(resolve(REPO_ROOT, `tests/architecture/storage/fixtures/lifecycle/${kind}.txt`), "utf8")]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true };
  const files = [...roots.map((file) => resolve(REPO_ROOT, file)), ...extras.keys()];
  const program = createGuardProgram(files, options, extras); const checker = program.getTypeChecker();
  // Only lifecycle mutators need overload resolution; resolving every call also infers unrelated arguments.
  const possibleMutators = new WeakMap<ts.Type, boolean>();
  function mayCallMutator(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) {
      let symbol = checker.getSymbolAtLocation(expression);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declarations = symbol?.declarations;
      if (declarations?.length && declarations.every(ts.isFunctionDeclaration)) return false;
    }
    const type = checker.getApparentType(checker.getNonNullableType(checker.getTypeAtLocation(expression)));
    const cached = possibleMutators.get(type);
    if (cached !== undefined) return cached;
    const possible = type.getCallSignatures().some((signature) => mutator(signature.declaration));
    possibleMutators.set(type, possible);
    return possible;
  }
  function fromView(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
    if (seen.has(expression)) return false; seen.add(expression);
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === "runsView") return true;
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)
      && expression.argumentExpression.text === "runsView") return true;
    if (ts.isIdentifier(expression)) {
      return checker.getSymbolAtLocation(expression)?.declarations?.some((declaration) =>
        ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && fromView(declaration.initializer, seen)
        || ts.isBindingElement(declaration) && (declaration.propertyName?.getText() ?? declaration.name.getText()) === "runsView") ?? false;
    }
    return false;
  }
  const violations: string[] = []; let visited = 0;
  for (const file of files) {
    const relative = repoRelative(file); if (ALLOWLIST.includes(relative)) continue;
    const source = program.getSourceFile(file); assert.ok(source, relative);
    function visit(node: ts.Node): void {
      visited++;
      const report = (arm: string) => violations.push(`${relative}:${arm}:${node.getText().slice(0, 100)}`);
      if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
        && /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`[]?(?:workflow_runs|tasks|workflow_workers|leases|archived_runs|deleted_runs|run_results|archive_relaunches)\b/iu.test(node.getText())
        && !allowedArchiveSectionSql(relative, node) && !allowedCompletionSql(relative, node) && !allowedNativeDeletionSql(relative, node)) report("sql");
      if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) && /\bFROM\s+["`[]?runs_view\b/iu.test(node.getText())) report("runs-view");
      const signature = ts.isCallExpression(node) && mayCallMutator(node.expression)
        ? checker.getResolvedSignature(node)?.declaration : undefined;
      const symbol = ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) : undefined;
      if (mutator(signature) || symbol?.declarations?.some(mutator)) report("mutator");
      if (ts.isPropertyAccessExpression(node) && ["get", "list"].includes(node.name.text) && fromView(node.expression)) report("runs-view");
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(visited > 1000 && roots.includes("src/backend/runs/commands/command-kernel.ts"), "walker must inspect production commands");
  return Object.freeze(violations);
}
// One immutable program covers both the production census and disjoint virtual
// modules. Reusing its completed census avoids a second compiler under coverage.
let auditSnapshot: readonly string[] | undefined;
function audit(fixtures = false): readonly string[] {
  auditSnapshot ??= collectAudit();
  return fixtures ? auditSnapshot : auditSnapshot.filter((entry) => !entry.startsWith("src/core/guard-fixtures/"));
}
describe("no-lifecycle-sql-outside-the-adapter", () => {
  it("admits native tombstone SQL only at its exact deletion owner", () => {
    const path = "src/backend/storage/sqlite/native-run-deletion.ts";
    const sql = "INSERT INTO deleted_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)";
    assert.equal(nativeDeletionSqlFixture(path, "executeNativeRunDeletion", sql), true);
    assert.equal(nativeDeletionSqlFixture("src/backend/transports/http/forged.ts", "executeNativeRunDeletion", sql), false);
    assert.equal(nativeDeletionSqlFixture(path, "forgedDeletion", sql), false);
    assert.equal(nativeDeletionSqlFixture(path, "executeNativeRunDeletion", "DELETE FROM deleted_runs"), false);
  });
  it("admits only exact frozen-section SQL in its stopped converter", () => {
    const check = (sql: string, path: string, name: string) => {
      const source = ts.createSourceFile(path, `function ${name}() { db.prepare(${JSON.stringify(sql)}); }`, ts.ScriptTarget.Latest, true);
      let admitted = false;
      const visit = (node: ts.Node): void => { if (allowedArchiveSectionSql(path, node)) admitted = true; ts.forEachChild(node, visit); };
      visit(source); return admitted;
    };
    const path = "src/backend/storage/sqlite/timeline-conversion.ts";
    assert.equal(check(ARCHIVE_SECTION_SQL, path, "freezeConvertedArchiveTransactions"), true);
    assert.equal(check(ARCHIVE_SECTION_SQL, "src/core/guard-fixtures/sql.ts", "freezeConvertedArchiveTransactions"), false);
    assert.equal(check(ARCHIVE_SECTION_SQL, path, "ordinaryRuntime"), false);
    assert.equal(check(ARCHIVE_SECTION_SQL.replace(" AND transactions_json IS NULL", ""), path, "freezeConvertedArchiveTransactions"), false);
    assert.equal(check("UPDATE archived_runs SET record_json=? WHERE record_key=?", path, "freezeConvertedArchiveTransactions"), false);
  });
  it("admits only the exact validated stopped completion conversion statement", () => {
    const check = (path: string, name: string, sql: string) => {
      const source = ts.createSourceFile(path, `function ${name}() { db.prepare(${JSON.stringify(sql)}); }`, ts.ScriptTarget.Latest, true);
      let admitted = false;
      const visit = (node: ts.Node): void => { if (allowedCompletionSql(path,node)) admitted = true; ts.forEachChild(node,visit); };
      visit(source); return admitted;
    };
    assert.equal(check("src/backend/storage/sqlite/completion-conversion.ts","convertRunCompletions",COMPLETION_SQL),true);
    assert.equal(check("src/core/unsafe.ts","convertRunCompletions",COMPLETION_SQL),false);
    assert.equal(check("src/backend/storage/sqlite/completion-conversion.ts","runtime",COMPLETION_SQL),false);
    assert.equal(check("src/backend/storage/sqlite/completion-conversion.ts","convertRunCompletions","DELETE FROM workflow_runs"),false);
  });
  it("limits lifecycle writes to the service/adapter and remaining exact stopped conversions", () => { assert.deepEqual(audit(), []); }, scaledMs(45_000));
  it("detects checked-in SQL, aliased mutator and runs_view reader violations", () => {
    const found = audit(true);
    for (const arm of ["sql", "mutator", "view"]) assert.ok(found.some((entry) => entry.startsWith(`src/core/guard-fixtures/${arm}.ts:`)), arm);
    assert.ok(found.some((entry) => entry.includes("UPDATE workflow_runs")), "renamed run table remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE archived_runs")), "archive body remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE tasks")), "historical run table remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE workflow_workers")), "renamed worker table remains protected");
    assert.ok(found.some((entry) => entry.includes("mutate({})")), "destructured mutator is still resolved");
    assert.ok(found.some((entry) => entry.includes("mutatorFactory(repositories)({})")), "factory-returned mutator is still resolved");
    assert.ok(found.some((entry) => entry.endsWith(":mutator:repositories.runs.resume")), "bare mutator reference remains protected");
    assert.ok(!found.some((entry) => entry.includes('overloaded("safe")')), "safe selected overload remains allowed");
    for (const call of ["facade.move({})", 'indexed["continue"]({})', "overloaded({})", "optional?.({})", "generic({})", "union({})"]) {
      assert.ok(found.some((entry) => entry.includes(call)), `indirect mutator remains protected: ${call}`);
    }
  });
});
