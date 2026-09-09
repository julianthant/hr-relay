import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT, repoRelative } from "./helpers/guard-files.js";

const ALLOWLIST = ["src/infra/sqlite/authority-database.ts", "src/core/run-record-service.ts"];
const RUN_MUTATORS = new Set(["enqueue", "claimNext", "claimEligible", "renewClaim", "transition", "resume", "requeue",
  "sweepExpiredClaims", "requestCancellation", "advanceRevision", "bumpPriority", "updatePresentation", "injectCheckpointPatches",
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
// D332/D336's sole stopped, transactional ordinal backfill; its import closure
// is independently guarded by authority-upgrade-adapters-isolated.
const BACKFILL_SQL = "UPDATE deleted_runs SET item_id=?, attempt=?, run_number=NULL, ordinal_source=?, record_json=json_set(record_json,'$.itemId',?,'$.attempt',?,'$.runNumber',NULL,'$.ordinalSource',?) WHERE record_key=? AND item_id IS NULL AND attempt IS NULL AND run_number IS NULL";
// T/P7 permits only this one-time section enrichment inside the stopped converter.
const ARCHIVE_SECTION_SQL = "UPDATE archived_runs SET transactions_json=?, transactions_digest=? WHERE record_key=? AND transactions_json IS NULL";
function allowedArchiveSectionSql(relative: string, node: ts.Node): boolean {
  if (relative !== "src/infra/sqlite/timeline-conversion.ts" || !ts.isStringLiteralLike(node)
    || node.text !== ARCHIVE_SECTION_SQL) return false;
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent.name?.text === "freezeConvertedArchiveTransactions";
  }
  return false;
}
function audit(fixtures = false): string[] {
  const roots = gitVisibleFiles(["src"]).filter((path) => /\.tsx?$/u.test(path));
  const extras = new Map(["sql", "mutator", "view"].map((kind) => [resolve(REPO_ROOT, `src/core/guard-fixtures/${kind}.ts`),
    readFileSync(resolve(REPO_ROOT, `tests/unit/architecture/fixtures/lifecycle/${kind}.txt`), "utf8")]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options); const original = host.readFile.bind(host);
  host.readFile = (file) => fixtures && extras.has(file) ? extras.get(file) : original(file);
  const files = [...roots.map((file) => resolve(REPO_ROOT, file)), ...(fixtures ? extras.keys() : [])];
  const program = ts.createProgram(files, options, host); const checker = program.getTypeChecker();
  // Resolving every call also infers its arguments. Only calls whose callable
  // declarations can own a lifecycle mutation need that overload resolution.
  // Keep the final resolved declaration check so a safe overload stays safe.
  const possibleMutators = new WeakMap<ts.Type, boolean>();
  function mayCallMutator(expression: ts.Expression): boolean {
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
        && !allowedArchiveSectionSql(relative, node)
        && !(relative === "src/infra/compat/settings-database-upgrade.ts" && ts.isStringLiteralLike(node) && node.text === BACKFILL_SQL)) report("sql");
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
  assert.ok(visited > 1000 && roots.includes("src/core/command-kernel.ts"), "walker must inspect production commands");
  return violations;
}
describe("no-lifecycle-sql-outside-the-adapter", () => {
  it("admits only exact frozen-section SQL in its stopped converter", () => {
    const check = (sql: string, path: string, name: string) => {
      const source = ts.createSourceFile(path, `function ${name}() { db.prepare(${JSON.stringify(sql)}); }`, ts.ScriptTarget.Latest, true);
      let admitted = false;
      const visit = (node: ts.Node): void => { if (allowedArchiveSectionSql(path, node)) admitted = true; ts.forEachChild(node, visit); };
      visit(source); return admitted;
    };
    const path = "src/infra/sqlite/timeline-conversion.ts";
    assert.equal(check(ARCHIVE_SECTION_SQL, path, "freezeConvertedArchiveTransactions"), true);
    assert.equal(check(ARCHIVE_SECTION_SQL, "src/core/guard-fixtures/sql.ts", "freezeConvertedArchiveTransactions"), false);
    assert.equal(check(ARCHIVE_SECTION_SQL, path, "ordinaryRuntime"), false);
    assert.equal(check(ARCHIVE_SECTION_SQL.replace(" AND transactions_json IS NULL", ""), path, "freezeConvertedArchiveTransactions"), false);
    assert.equal(check("UPDATE archived_runs SET record_json=? WHERE record_key=?", path, "freezeConvertedArchiveTransactions"), false);
  });
  it("limits lifecycle writes to the service/adapter and exact stopped ordinal backfill", () => { assert.deepEqual(audit(), []); });
  it("detects checked-in SQL, aliased mutator and runs_view reader violations", () => {
    const found = audit(true);
    for (const arm of ["sql", "mutator", "view"]) assert.ok(found.some((entry) => entry.startsWith(`src/core/guard-fixtures/${arm}.ts:`)), arm);
    assert.ok(found.some((entry) => entry.includes("UPDATE workflow_runs")), "renamed run table remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE archived_runs")), "archive body remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE tasks")), "historical run table remains protected");
    assert.ok(found.some((entry) => entry.includes("UPDATE workflow_workers")), "renamed worker table remains protected");
    assert.ok(found.some((entry) => entry.includes("mutate({})")), "destructured mutator is still resolved");
    assert.ok(!found.some((entry) => entry.includes('overloaded("safe")')), "safe selected overload remains allowed");
    for (const call of ["facade.move({})", 'indexed["continue"]({})', "overloaded({})", "optional?.({})", "generic({})", "union({})"]) {
      assert.ok(found.some((entry) => entry.includes(call)), `indirect mutator remains protected: ${call}`);
    }
  });
});
