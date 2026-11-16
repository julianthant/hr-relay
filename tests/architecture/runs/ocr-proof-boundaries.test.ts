import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const compact = (node: ts.Node) => node.getText().replace(/\s+/gu, "");
function nodes(root: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) { found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return found;
}
const parse = (text: string) => ts.createSourceFile("candidate.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function ocrJournalIssues(kernelText: string, lifecycleText: string): string[] {
  const issues: string[] = [];
  const kernel = parse(kernelText), lifecycle = parse(lifecycleText);
  const cases = nodes(kernel).filter(ts.isCaseClause).filter(node => node.expression.getText() === '"ocr-review"');
  if (cases.length !== 1) return ["OCR dispatch owner"];
  const branch = cases[0];
  const calls = nodes(branch).filter(ts.isCallExpression);
  const transition = calls.filter(call => compact(call.expression) === "dependencies.lifecycle.transition");
  const append = calls.filter(call => compact(call.expression) === "repositories.ocrReviews.append");
  const expected = [
    'commandId:lifecycleCommandId("operator-ocr-review",request.commandId)', 'runId:request.target.runId',
    'expectedVersion:current.run.version', 'ocrReviewRevision:revision.revision', 'sourceCommandId:request.commandId',
  ];
  if (transition.length !== 1 || transition[0].arguments.length !== 1 || !ts.isObjectLiteralExpression(transition[0].arguments[0])
    || transition[0].arguments[0].properties.map(compact).sort().join(";") !== expected.sort().join(";")) issues.push("exact OCR transition");
  if (append.length !== 1 || transition.length !== 1 || append[0].end >= transition[0].pos
    || compact(append[0]) !== "repositories.ocrReviews.append(reviseOcrReview(current.revision,request,now),current.revision.revision)") issues.push("revision precedes transition");
  const guards = nodes(branch).filter(ts.isIfStatement).map(node => compact(node.expression));
  if (!guards.includes('request.requestedBy!=="local-operator"||request.source!=="dashboard"')
    || !guards.includes("current.revision.revision!==request.target.expectedRevision")) issues.push("actor and revision CAS");
  const revisions = nodes(lifecycle).filter(ts.isIfStatement).filter(node => compact(node.expression) === '"ocrReviewRevision"inrequest');
  if (revisions.length !== 1) return [...issues, "OCR lifecycle owner"];
  const body = revisions[0].thenStatement;
  const refusal = nodes(body).filter(ts.isIfStatement).find(node => nodes(node.thenStatement).some(child =>
    ts.isThrowStatement(child) && child.expression !== undefined && compact(child.expression) === "newOcrReviewRefusedError()"));
  const expectedGuard = 'source?.family!=="ocr-review"||source.requestedBy!=="local-operator"||source.source!=="dashboard"'
    + '||source.target.runId!==request.runId||request.commandId!==lifecycleCommandId("operator-ocr-review",source.commandId)'
    + '||source.target.expectedRevision+1!==request.ocrReviewRevision||revision?.revision!==request.ocrReviewRevision'
    + '||revision.origin.kind!=="command"||revision.origin.commandId!==source.commandId||current.run.envelope.workflow!=="ocr"';
  if (refusal === undefined || compact(refusal.expression) !== expectedGuard) issues.push("exact source and revision authority");
  const bodyCalls = nodes(body).filter(ts.isCallExpression);
  const scope = bodyCalls.filter(call => compact(call) === "assertCanonicalRunCommandScope(repositories,source)");
  const write = bodyCalls.filter(call => compact(call.expression) === "repositories.runs.advanceRevision");
  const journal = bodyCalls.filter(call => compact(call) === "this.recordJournal(repositories,journal.command,journalRun(result.run),current.run.lifecycle)");
  if (scope.length !== 1 || write.length !== 1 || journal.length !== 1 || scope[0].end >= write[0].pos || write[0].end >= journal[0].pos) issues.push("scope and lifecycle journal order");
  if (!nodes(body).filter(ts.isIfStatement).some(node => compact(node.expression).includes('runClaim(current.run)!==undefined')
    && compact(node.expression).includes('current.run.lifecycle.state==="parked-write"'))) issues.push("worker and parked-write exclusion");
  return issues;
}

function ocrSqliteIssues(repositoryText: string, authorityText: string): string[] {
  const issues: string[] = [], repository = parse(repositoryText), authority = parse(authorityText);
  const all = nodes(repository);
  const imports = repository.statements.filter(ts.isImportDeclaration).filter(node =>
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "node:sqlite");
  if (imports.length !== 1 || imports[0].importClause?.isTypeOnly !== true) issues.push("type-only SQLite import");
  const capture = all.filter(ts.isVariableDeclaration).find(node => compact(node.name) === "{database}" && node.initializer?.getText() === "ports");
  const latest = all.filter(ts.isVariableDeclaration).find(node => node.name.getText() === "latest" && node.initializer !== undefined && ts.isArrowFunction(node.initializer));
  if (capture === undefined || latest === undefined) return [...issues, "private handle and latest owner"];
  function withinTransaction(node: ts.Node): boolean {
    for (let parent: ts.Node | undefined = node.parent; parent !== undefined; parent = parent.parent) {
      if (ts.isArrowFunction(parent) && ts.isCallExpression(parent.parent)
        && ["ports.read", "ports.mutate"].includes(compact(parent.parent.expression))
        && parent.parent.arguments.includes(parent)) return true;
    }
    return false;
  }
  function inside(node: ts.Node, owner: ts.Node): boolean {
    for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent) if (parent === owner) return true;
    return false;
  }
  for (const node of all) {
    if (!ts.isIdentifier(node)) continue;
    if (node.text === "DatabaseSync" && !ts.isImportSpecifier(node.parent) && !ts.isTypeReferenceNode(node.parent)) issues.push("runtime SQLite handle");
    if (node.text === "database") {
      if (ts.isPropertySignature(node.parent) && node.parent.name === node) continue;
      if (inside(node, capture.name)) continue;
      if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node || node.parent.name.text !== "prepare"
        || !ts.isCallExpression(node.parent.parent) || node.parent.parent.expression !== node.parent) { issues.push("handle alias or escape"); continue; }
      if (!withinTransaction(node) && (latest.initializer === undefined || !inside(node, latest.initializer))) issues.push("SQL outside authority transaction");
    }
    if (node.text === "latest" && node !== latest.name
      && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node && withinTransaction(node))) issues.push("latest escapes transaction");
  }
  const factories = nodes(authority).filter(ts.isCallExpression).filter(call => call.expression.getText() === "createOcrReviewRepository");
  if (factories.length !== 1 || factories[0].arguments.length !== 1 || compact(factories[0].arguments[0])
    !== "{database:this.#database,read:work=>this.#withReadSnapshot(work),mutate:(table,work)=>this.#authorityWrite(table,work)}") issues.push("AuthorityDatabase transaction owner");
  return issues;
}

it("binds OCR dispatch to the exact canonical scope and revision journal with rejecting mutants", () => {
  const kernel = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
  const lifecycle = readFileSync(join(REPO_ROOT, "src/backend/runs/lifecycle/run-record-service.ts"), "utf8");
  assert.deepEqual(ocrJournalIssues(kernel, lifecycle), []);
  for (const [from, to] of [
    ["sourceCommandId: request.commandId", "sourceCommandId: foreignCommandId"],
    ["ocrReviewRevision: revision.revision", "ocrReviewRevision: revision.revision + 1"],
    ["expectedVersion: current.run.version", "expectedVersion: 1"],
    ['request.source !== "dashboard"', "false"],
  ]) {
    const mutant = kernel.replaceAll(from, to); assert.notEqual(mutant, kernel);
    assert.notDeepEqual(ocrJournalIssues(mutant, lifecycle), []);
  }
  for (const [from, to] of [
    ['source?.family !== "ocr-review"', 'source?.family !== "settings"'],
    ['source.requestedBy !== "local-operator"', "false"],
    ['source.source !== "dashboard"', "false"],
    ["revision.origin.commandId !== source.commandId", "false"],
    ["source.target.runId !== request.runId", "false"],
    ["assertCanonicalRunCommandScope(repositories, source)", "void source"],
    ["this.recordJournal(repositories, journal.command, journalRun(result.run), current.run.lifecycle)", "void result"],
    ['current.run.lifecycle.state === "parked-write"', "false"],
  ]) {
    const mutant = lifecycle.replaceAll(from, to); assert.notEqual(mutant, lifecycle);
    assert.notDeepEqual(ocrJournalIssues(kernel, mutant), []);
  }
});

it("keeps the OCR SQLite type-only adapter inside AuthorityDatabase transactions with rejecting mutants", () => {
  const repository = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/ocr-review.ts"), "utf8");
  const authority = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/authority-database.ts"), "utf8");
  assert.deepEqual(ocrSqliteIssues(repository, authority), []);
  for (const [from, to] of [
    ['import type { DatabaseSync }', 'import { DatabaseSync }'],
    ['const { database } = ports;', 'const { database } = ports; const raw = database;'],
    ['const { database } = ports;', 'const { database } = ports; database.prepare("DELETE FROM ocr_review_revisions").run();'],
    ['latest(record.sourceRunId)', 'latest.bind(null)(record.sourceRunId)'],
  ]) {
    const mutant = repository.replaceAll(from, to); assert.notEqual(mutant, repository);
    assert.notDeepEqual(ocrSqliteIssues(mutant, authority), []);
  }
  for (const [from, to] of [
    ['read: work => this.#withReadSnapshot(work)', 'read: work => work()'],
    ['mutate: (table, work) => this.#authorityWrite(table, work)', 'mutate: (_table, work) => work().result'],
    ['createOcrReviewRepository({ database: this.#database', 'createOcrReviewRepository({ database: foreignDatabase'],
  ]) {
    const mutant = authority.replaceAll(from, to); assert.notEqual(mutant, authority);
    assert.notDeepEqual(ocrSqliteIssues(repository, mutant), []);
  }
});

it("keeps OCR SQLite imports at their exact transaction and migration owners", () => {
  const target = join(REPO_ROOT, "src/backend/storage/sqlite/ocr-review.ts");
  const importers: { file: string; names: string[] }[] = [];
  for (const file of gitVisibleFiles(["src"]).filter(file => /\.tsx?$/u.test(file))) {
    const source = parse(readFileSync(join(REPO_ROOT, file), "utf8"));
    const imports = nodes(source).flatMap(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) ? [{ specifier: node.moduleSpecifier.text,
        names: ts.isImportDeclaration(node) && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
          ? node.importClause.namedBindings.elements.map(binding => binding.propertyName?.text ?? binding.name.text).sort() : ["*"] }] : []
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) ? [{ specifier: node.arguments[0].text, names: ["*"] }] : []);
    for (const imported of imports) if (imported.specifier.startsWith(".")
      && resolve(dirname(join(REPO_ROOT, file)), imported.specifier.replace(/\.js$/u, ".ts")) === target) importers.push({ file, names: imported.names });
  }
  assert.deepEqual(importers.sort((left, right) => left.file.localeCompare(right.file)), [
    { file: "src/backend/storage/sqlite/authority-database.ts", names: ["createOcrReviewRepository"] },
    { file: "src/backend/storage/sqlite/migrations.ts", names: ["OCR_REVIEW_MIGRATION"] },
  ]);
});
