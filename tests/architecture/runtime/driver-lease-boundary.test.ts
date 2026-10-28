import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";

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
        if (properties.length === 3 && ts.isMethodDeclaration(method) && method.name.getText(source) === "open"
          && method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
          && method.parameters.length === 1 && method.parameters[0].name.getText(source) === "request"
          && method.parameters[0].type !== undefined && compact(method.parameters[0].type) === 'Parameters<WorkerBrowserSessionFactory["open"]>[0]'
          && method.body?.statements.length === 3 && ts.isSpreadAssignment(properties[2])
          && compact(properties[2]) === '...(factory.discardProfile===undefined?{}:{discardProfile:factory.discardProfile.bind(factory)})'
          && compact(properties[1]) === 'asyncprobeProfile(request:Parameters<WorkerBrowserSessionFactory["probeProfile"]>[0]){if(!scope.requestedCapabilities.includes(`system.${request.system}.${request.instance??"prod"}`asPreflightAdmissionScope["requestedCapabilities"][number]))thrownewPreflightAdmissionRefusal("scope-mismatch","Browserprobediffersfromitsadmittedpreflightscope.");awaitpreflight.prepareSession(scope,request.system,request.signal);returnfactory.probeProfile(request);}') {
          const [scopeCheck, prepare, delegate] = method.body.statements;
          if (ts.isIfStatement(scopeCheck)
            && compact(scopeCheck.expression) === 'request.configFingerprint!==scope.configFingerprint||!scope.requestedCapabilities.includes(`system.${request.system}.${request.instance??"prod"}`asPreflightAdmissionScope["requestedCapabilities"][number])'
            && ts.isBlock(scopeCheck.thenStatement) && scopeCheck.elseStatement === undefined
            && scopeCheck.thenStatement.statements.length === 1 && ts.isThrowStatement(scopeCheck.thenStatement.statements[0])
            && ts.isNewExpression(scopeCheck.thenStatement.statements[0].expression)
            && canonicalValue(scopeCheck.thenStatement.statements[0].expression.expression, "PreflightAdmissionRefusal", "/src/rules/preflight/preflight-admission.ts")
            && compact(scopeCheck.thenStatement.statements[0].expression) === 'newPreflightAdmissionRefusal("scope-mismatch","Browserrequestdiffersfromitsadmittedpreflightscope.")'
            && compact(prepare) === 'awaitpreflight.prepareSession(scope,request.system,request.signal);'
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

function withoutRetryInitialization(content: string): string {
  const path = join(REPO_ROOT, "src/backend/app/composition/worker-compose.ts");
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => file === path ? ts.createSourceFile(file, content, version, true) : original(file, version, onError, fresh);
  const program = ts.createProgram([path], options, host), checker = program.getTypeChecker(), source = program.getSourceFile(path)!;
  const compact = (node: ts.Node): string => node.getText().replace(/\s+/gu, "");
  const canonical = (node: ts.Node, name: string, owner: string): boolean => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.name === name && symbol.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith(owner)) === true;
  };
  const functions = source.statements.filter(ts.isFunctionDeclaration).filter(fn => fn.name?.text === "initializeRetryWorker");
  if (functions.length !== 1) return content;
  const fn = functions[0], type = fn.parameters[0]?.type;
  if (fn.parameters.length !== 1 || fn.parameters[0].name.getText() !== "input" || type === undefined || !ts.isTypeReferenceNode(type)
    || type.typeName.getText() !== "Readonly" || type.typeArguments?.length !== 1 || !ts.isTypeLiteralNode(type.typeArguments[0]) || fn.body === undefined) return content;
  const manager = type.typeArguments[0].members.find(member => member.name?.getText() === "sessions");
  if (manager === undefined || !ts.isPropertySignature(manager) || manager.type === undefined || !ts.isTypeReferenceNode(manager.type)
    || !canonical(manager.type.typeName, "WorkerSessionManager", "/src/backend/runtime/workers/worker-sessions.ts")) return content;
  for (const [name, typeName, owner] of [
    ["database", "AuthorityDatabase", "/src/backend/storage/sqlite/authority-database.ts"],
    ["descriptor", "AnyWorkflowDescriptor", "/src/workflow-kit/workflow.ts"],
  ]) {
    const property = type.typeArguments[0].members.find(member => member.name?.getText() === name);
    if (property === undefined || !ts.isPropertySignature(property) || property.type === undefined || !ts.isTypeReferenceNode(property.type)
      || !canonical(property.type.typeName, typeName, owner)) return content;
  }
  const required = [
    'const{database,commandId,leaseGeneration,descriptor,configFingerprint,sessions,signal,clock,scheduler}=input;',
    'constcommand=database.authority.workerControls.get(commandId);', 'constbinding=command?.lifecycle;',
    'if(binding?.operation.kind!=="retry")return;',
    'if(binding.member.workflowId!==descriptor.id||binding.operation.configSnapshotId!==database.authority.runtimeConfig.get()?.configSnapshotId||binding.operation.configFingerprint!==configFingerprint||binding.operation.descriptorVersion!==descriptor.version||binding.operation.contractFingerprint!==descriptor.contractFingerprint)thrownewError("worker-initialization-current-settings-changed");',
    'if(database.authority.workerControls.get(commandId)?.readiness?.state!=="initializing")thrownewError("worker-initialization-authority-unavailable");',
    'constcontracts=newSet(workflowProjections(descriptor).contracts.map(contract=>contract.id));',
    'constneeds=(input.stores??taskStoreRegistry).stores.flatMap(store=>Object.values(store.tasks).filter(task=>contracts.has(task.contract.id)).flatMap(task=>task.impl.sessions));',
    'if(systems.has(need.system))continue;systems.add(need.system);',
    'database.completeWorkerInitialization(command.commandId,leaseGeneration,descriptor,clock.now().toISOString());',
  ];
  if (required.some(fragment => !compact(fn.body!).includes(fragment))) return content;
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "withDriver") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(fn);
  if (calls.length !== 1) return content;
  const call = calls[0];
  if (compact(call) !== 'sessions.withDriver({...need,access:"read",session:"reuse-worker"},"prod",signal,async()=>undefined)'
    || !ts.isPropertyAccessExpression(call.expression) || !canonical(call.expression.name, "withDriver", "/src/backend/runtime/workers/worker-sessions.ts")
    || !ts.isAwaitExpression(call.parent)) return content;
  let callback: ts.Node | undefined = call.parent;
  while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
  if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isCallExpression(callback.parent)
    || !canonical(callback.parent.expression, "withBoundRunConfigFingerprint", "/src/backend/runtime/workers/worker-sessions.ts")
    || callback.parent.arguments.length !== 3 || compact(callback.parent.arguments[0]) !== "sessions"
    || compact(callback.parent.arguments[1]) !== "binding.operation.configFingerprint" || callback.parent.arguments[2] !== callback) return content;
  return content.slice(0, call.getStart(source)) + content.slice(call.end);
}

describe("driver lease boundary", () => {
  it("keeps withDriver callers to owners and exact run-independent Retry initialization", () => {
    const allowed = new Set([
      "src/backend/runtime/workers/worker-sessions.ts",
      "src/backend/runtime/execution/run-executor.ts",
      "src/backend/runtime/writes/write-sequencer.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ path, content }) => (path === "src/backend/app/composition/worker-compose.ts" ? withoutRetryInitialization(content) : content).includes(".withDriver(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "withDriver lease acquisition leaked outside the interpreter");
  });

  it.each(["rogue", "access", "callback", "manager", "settings"])("refuses %s driver acquisition beyond exact Retry initialization", kind => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/app/composition/worker-compose.ts"), "utf8");
    const candidate = kind === "rogue" ? `${source}\nasync function rogue(sessions: any) { await sessions.withDriver({}, "prod", undefined, async () => undefined); }`
      : kind === "access" ? source.replace('access: "read", session: "reuse-worker"', 'access: "transaction", session: "reuse-worker"')
      : kind === "callback" ? source.replace('signal, async () => undefined)', 'signal, async () => { throw new Error("arbitrary"); })')
      : kind === "settings" ? source.replace('binding.member.workflowId !== descriptor.id', "false")
      : source.replace('WorkerBrowserSessionFactory, WorkerSessionManager', 'WorkerBrowserSessionFactory') + "\ninterface WorkerSessionManager {}";
    assert.notEqual(candidate, source, "the negative control must change its targeted source");
    assert.ok(withoutRetryInitialization(candidate).includes(".withDriver("));
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
    const program = createGuardProgram(files.map(file => join(REPO_ROOT, file.path)), { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
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
      const program = createGuardProgram([path], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }, new Map([[path, candidate]]));
      return rawFactoryIssues(candidate, program.getSourceFile(path)!, program.getTypeChecker());
    };
    assert.equal(audit(content), false);
    for (const bad of [
      content.replace('await preflight.prepareSession(scope, request.system, request.signal);', 'factory.open(request);'),
      content.replace('await preflight.prepareSession(scope, request.system, request.signal);', 'preflight.prepareSession(scope, request.system, request.signal);'),
      content.replace('await preflight.prepareSession(scope, request.system, request.signal);', ''),
      content.replace('scope, request.system, request.signal', 'scope, "ucpath", request.signal'),
      content.replace('!scope.requestedCapabilities.includes', 'scope.requestedCapabilities.includes'),
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
