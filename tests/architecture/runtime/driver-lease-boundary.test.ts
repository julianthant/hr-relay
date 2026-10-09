/**
 * Ref execution-and-sessions §§1,4: a driver is exclusive task-length access backed by the
 * worker's browser session — it exists ONLY inside the callback lease
 * `WorkerSessionManager.withDriver` hands out, plus the write sequencer's
 * one-way `withTransactionDriver` fence-retained arm. Nothing else in `src/` may
 * acquire a session resource, hold a driver across a lease, or construct a
 * second ownership path around the manager.
 *
 * Enforced structurally over the whole tree:
 *
 * - `withDriver(` is called only by the manager itself, the one graph
 *   interpreter (`src/backend/runtime/execution/run-executor.ts`), and the ref write-safety write sequencer
 *   (`src/backend/runtime/writes/write-sequencer.ts`), whose probe read lease and transaction
 *   lease are exactly the callback leases ref write-safety §3 assigns it;
 * - `withTransactionDriver(` is called only by the write sequencer, which
 *   crosses its retention boundary only after the durable fence;
 * - the browser-session factory's `.open(` — the raw resource mint — is
 *   invoked only inside `src/backend/runtime/workers/worker-sessions.ts`;
 * - `new WorkerSessionManager(` is constructed only by the worker loop, so a
 *   task, store, or workflow cannot mint a private ownership scope.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import ts from "typescript";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

function sourceFiles(): readonly { path: string; content: string }[] {
  return walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
    .map((file) => ({
      path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
      content: readFileSync(file, "utf8"),
    }));
}

function admittedFactoryDelegations(source: ts.SourceFile, checker: ts.TypeChecker): readonly ts.CallExpression[] {
  const admitted: ts.CallExpression[] = [];
  const compact = (node: ts.Node): string => node.getText(source).replace(/\s+/gu, "");
  const canonicalType = (type: ts.TypeNode | undefined, name: string, owner: string): boolean => {
    if (type === undefined || !ts.isTypeReferenceNode(type)) return false;
    let symbol = checker.getSymbolAtLocation(type.typeName);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.name === name
      && symbol.declarations?.some(node => node.getSourceFile().fileName.replaceAll("\\", "/").endsWith(`/${owner}`)) === true;
  };
  const canonicalValue = (node: ts.Node, name: string, owner: string): boolean => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.name === name && symbol.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith(owner)) === true;
  };
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && canonicalType(node.type, "WorkerBrowserSessionFactory", "src/workflow-kit/session.ts")
      && node.parameters.length === 3 && node.parameters[0].name.getText(source) === "factory"
      && canonicalType(node.parameters[0].type, "WorkerBrowserSessionFactory", "src/workflow-kit/session.ts") && node.parameters[1].name.getText(source) === "preflight"
      && canonicalType(node.parameters[1].type, "RuntimePreflight", "src/backend/app/preflight/runtime-admission.ts")
      && node.parameters[2].name.getText(source) === "scope"
      && canonicalType(node.parameters[2].type, "PreflightAdmissionScope", "src/rules/preflight/preflight-admission.ts")
      && node.body?.statements.length === 1) {
      const statement = node.body.statements[0];
      if (ts.isReturnStatement(statement) && statement.expression !== undefined
        && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === "Object.freeze"
        && ts.isPropertyAccessExpression(statement.expression.expression)
        && canonicalValue(statement.expression.expression.expression, "Object", "/typescript/lib/lib.es5.d.ts")
        && statement.expression.arguments.length === 1 && ts.isObjectLiteralExpression(statement.expression.arguments[0])) {
        const properties = statement.expression.arguments[0].properties;
        const method = properties[0];
        if (properties.length === 2 && ts.isMethodDeclaration(method) && method.name.getText(source) === "open"
          && method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
          && method.parameters.length === 1 && method.parameters[0].name.getText(source) === "request"
          && method.parameters[0].type !== undefined && compact(method.parameters[0].type) === 'Parameters<WorkerBrowserSessionFactory["open"]>[0]'
          && method.body?.statements.length === 4 && ts.isSpreadAssignment(properties[1])
          && compact(properties[1]) === '...(factory.discardProfile===undefined?{}:{discardProfile:factory.discardProfile.bind(factory)})') {
          const [scopeCheck, prepare, ready, delegate] = method.body.statements;
          if (ts.isIfStatement(scopeCheck)
            && compact(scopeCheck.expression) === 'request.configFingerprint!==scope.configFingerprint||!scope.requestedCapabilities.includes(`system.${request.system}.${request.instance??"prod"}`asPreflightAdmissionScope["requestedCapabilities"][number])'
            && ts.isBlock(scopeCheck.thenStatement) && scopeCheck.elseStatement === undefined
            && scopeCheck.thenStatement.statements.length === 1 && ts.isThrowStatement(scopeCheck.thenStatement.statements[0])
            && ts.isNewExpression(scopeCheck.thenStatement.statements[0].expression)
            && canonicalValue(scopeCheck.thenStatement.statements[0].expression.expression, "PreflightAdmissionRefusal", "/src/rules/preflight/preflight-admission.ts")
            && compact(scopeCheck.thenStatement.statements[0].expression) === 'newPreflightAdmissionRefusal("scope-mismatch","Browserrequestdiffersfromitsadmittedpreflightscope.")'
            && compact(prepare) === 'awaitpreflight.admission.prepare(scope,request.signal);'
            && compact(ready) === 'preflight.admission.assertReady(scope);'
            && ts.isReturnStatement(delegate) && delegate.expression !== undefined
            && ts.isCallExpression(delegate.expression) && compact(delegate.expression) === 'factory.open(request)') admitted.push(delegate.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return admitted;
}

function rawFactoryIssues(content: string, source: ts.SourceFile, checker: ts.TypeChecker): boolean {
  for (const call of [...admittedFactoryDelegations(source, checker)].sort((a, b) => b.pos - a.pos)) {
    content = content.slice(0, call.getStart(source)) + content.slice(call.end);
  }
  return /[Ff]actory\.open\(/u.test(content);
}

describe("driver lease boundary", () => {
  it("keeps withDriver callers to the manager and the interpreter alone", () => {
    const allowed = new Set([
      "src/backend/runtime/workers/worker-sessions.ts",
      "src/backend/runtime/execution/run-executor.ts",
      "src/backend/runtime/writes/write-sequencer.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes(".withDriver(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "withDriver lease acquisition leaked outside the interpreter");
  });

  it("keeps the fence-retained transaction lease exclusive to the write sequencer", () => {
    const allowed = new Set([
      "src/backend/runtime/workers/worker-sessions.ts",
      "src/backend/runtime/writes/write-sequencer.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes(".withTransactionDriver(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "fence-retained driver lease acquisition leaked outside write safety");
  });

  it("keeps raw browser-resource minting inside the session manager", () => {
    const files = sourceFiles();
    const program = ts.createProgram(files.map(file => join(REPO_ROOT, file.path)), { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    const checker = program.getTypeChecker();
    const violations = files
      .filter(({ path, content }) => path !== "src/backend/runtime/workers/worker-sessions.ts"
        && rawFactoryIssues(content, program.getSourceFile(join(REPO_ROOT, path))!, checker))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "browser-session factory open() leaked outside worker-sessions");
  });

  it("admits only canonical scope-checked preflight delegation with a closed body", () => {
    const path = join(REPO_ROOT, "src/backend/app/preflight/worker-admission.ts");
    const content = readFileSync(path, "utf8");
    const audit = (candidate: string): boolean => {
      const host = ts.createCompilerHost({});
      const getSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === path
        ? ts.createSourceFile(file, candidate, languageVersion, true)
        : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
      const program = ts.createProgram([path], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }, host);
      return rawFactoryIssues(candidate, program.getSourceFile(path)!, program.getTypeChecker());
    };
    assert.equal(audit(content), false);
    for (const bad of [
      content.replace('await preflight.admission.prepare(scope, request.signal);', 'factory.open(request);'),
      content.replace('preflight.admission.assertReady(scope);\n      return factory.open(request);', 'return factory.open(request);'),
      content.replace('request.configFingerprint !== scope.configFingerprint', 'false'),
      content.replace('return factory.open(request);', 'factory.open(request); return factory.open(request);'),
      content.replace('import type { WorkerBrowserSessionFactory } from "../../../workflow-kit/session.js";', 'interface WorkerBrowserSessionFactory { open(request: unknown): unknown; discardProfile?: () => void }'),
      `${content}\nconst Object = { freeze: (value: unknown) => value };`,
      content.replace('factory: WorkerBrowserSessionFactory, preflight: RuntimePreflight', 'factory: WorkerBrowserSessionFactory, preflight: any'),
      `${content}\nfunction arbitrary(factory: any, request: any) { return factory.open(request); }`,
    ]) assert.equal(audit(bad), true, "unadmitted raw factory delegation must fail");
  });

  it("keeps WorkerSessionManager construction at the worker loop", () => {
    const allowed = new Set(["src/backend/runtime/workers/worker-loop.ts", "src/backend/runtime/workers/worker-sessions.ts"]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes("new WorkerSessionManager(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a second WorkerSessionManager ownership scope appeared");
  });

  it("proves the lease surface it guards actually exists", () => {
    // A rename would otherwise turn every scan above vacuously green.
    const manager = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-sessions.ts"), "utf8");
    assert.ok(manager.includes("async withDriver<"), "worker-sessions must own the withDriver lease");
    assert.ok(
      manager.includes("async withTransactionDriver<"),
      "worker-sessions must own the fence-retained transaction lease",
    );
    const interpreter = readFileSync(join(REPO_ROOT, "src/backend/runtime/execution/run-executor.ts"), "utf8");
    assert.ok(interpreter.includes(".withDriver("), "the interpreter must consume the lease");
    const sequencer = readFileSync(join(REPO_ROOT, "src/backend/runtime/writes/write-sequencer.ts"), "utf8");
    assert.ok(
      sequencer.includes(".withTransactionDriver("),
      "the write sequencer must consume the fence-retained transaction lease",
    );
    const loop = readFileSync(join(REPO_ROOT, "src/backend/runtime/workers/worker-loop.ts"), "utf8");
    assert.ok(loop.includes("new WorkerSessionManager("), "the worker loop must own the manager");
  });
});
