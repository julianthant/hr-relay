import { seedSyntheticRuntimeConfig, singleAppliedRunId } from "../../support/fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { randomUUID } from "node:crypto";

import assert from "node:assert/strict";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, it } from "vitest";
import ts from "typescript";
import { createCommandKernel, PHASE1_ACTIVE_COMMAND_ARMS, PHASE1_DEFERRED_COMMAND_ARMS, type CommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { CommandRequestSchema, CommandResultSchema, COMMAND_FAMILY_REGISTRY } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../src/backend/storage/sqlite/authority-database.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";
import { COMMAND_FIXTURES, HASH_B, NOW, UUID_2, UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../support/fixtures/intake-kernel-seams.js";

function withoutIntakeCommandReceiptRead(content: string): string {
  const source = ts.createSourceFile("candidate.ts", content, ts.ScriptTarget.Latest, true);
  const auditUses: ts.PropertyAccessExpression[] = [];
  let admitted: ts.PropertyAccessExpression | undefined;
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === "commandAudits" && ts.isPropertyAccessExpression(node.parent)
      && node.parent.name === node) auditUses.push(node.parent);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.getText(source) === "database.authority.commandAudits.findByCommand"
      && node.arguments.length === 1 && node.arguments[0].getText(source) === "id") {
      let parent: ts.Node | undefined = node.parent;
      while (parent !== undefined && !ts.isArrowFunction(parent)) parent = parent.parent;
      if (parent !== undefined && ts.isArrowFunction(parent) && ts.isCallExpression(parent.parent)
        && parent.parent.expression.getText(source) === "database.withAuthorityReadSnapshot"
        && parent.parent.arguments.length === 1 && parent.parent.arguments[0] === parent) {
        admitted = node.expression.expression;
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (auditUses.length !== 1 || admitted !== auditUses[0]) return content;
  const start = admitted.name.getStart(source);
  return content.slice(0, start) + "receiptReads" + content.slice(admitted.name.end);
}

function withoutAssistantReconciliationAuditRead(content: string): string {
  const source = ts.createSourceFile("candidate.ts", content, ts.ScriptTarget.Latest, true);
  const compact = (node: ts.Node): string => node.getText(source).replace(/\s+/gu, "");
  const auditUses: ts.PropertyAccessExpression[] = [];
  let admitted: ts.PropertyAccessExpression | undefined;
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === "commandAudits" && ts.isPropertyAccessExpression(node.parent)
      && node.parent.name === node) auditUses.push(node.parent);
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === "reconcile" && node.body !== undefined
      && node.parameters.map(compact).join(",") === "capability:Chat,id:string" && node.body.statements.length === 1) {
      const returned = node.body.statements[0];
      const transaction = ts.isReturnStatement(returned) ? returned.expression : undefined;
      const callback = transaction !== undefined && ts.isCallExpression(transaction) ? transaction.arguments[0] : undefined;
      const object = node.parent;
      if (!ts.isObjectLiteralExpression(object)) return;
      const freeze = object.parent;
      if (!ts.isCallExpression(freeze)) return;
      const outerReturn = freeze.parent, factory = outerReturn.parent?.parent;
      if (compact(freeze.expression) !== "Object.freeze"
        || freeze.arguments.length !== 1 || freeze.arguments[0] !== object || !ts.isReturnStatement(outerReturn)
        || factory === undefined || !ts.isFunctionDeclaration(factory) || factory.name?.text !== "createAssistantAuthorization"
        || factory.parameters.map(compact).join(",") !== "ports:Ports" || transaction === undefined || !ts.isCallExpression(transaction)
        || compact(transaction.expression) !== "ports.database.withAuthorityTransaction" || transaction.arguments.length !== 1
        || callback === undefined || !ts.isArrowFunction(callback) || callback.parameters.length !== 0 || !ts.isBlock(callback.body)) return;
      const expected = [
        'constrow=repository.action(z.uuid().parse(id));',
        'if(row===undefined)thrownewAssistantAuthorizationError("assistant-action-missing");',
        'chat(capability);',
        'if(row.chatId!==capability.chatId||(row.state!=="claimed"&&row.state!=="unknown"))thrownewAssistantAuthorizationError("assistant-action-not-reconcilable");',
        'constaudit=ports.database.authority.commandAudits.findByCommand(row.command.commandId);',
        'if(audit===undefined||!same(audit.request,row.command)||audit.result.state==="pending")thrownewAssistantAuthorizationError("assistant-canonical-outcome-unproved");',
        'repository.transition(row.id,row.revision,"settled",audit.result);',
        'returnaudit.result;',
      ];
      if (callback.body.statements.length !== expected.length
        || callback.body.statements.some((statement, index) => compact(statement) !== expected[index])) return;
      function findRead(child: ts.Node): void {
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
          && compact(child) === "ports.database.authority.commandAudits.findByCommand(row.command.commandId)"
          && ts.isPropertyAccessExpression(child.expression.expression)) admitted = child.expression.expression;
        ts.forEachChild(child, findRead);
      }
      findRead(callback.body);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (auditUses.length !== 1 || admitted !== auditUses[0]) return content;
  const start = admitted.name.getStart(source);
  return content.slice(0, start) + "receiptReads" + content.slice(admitted.name.end);
}

function withoutWorkerControlAdmissions(content: string, kernelContent: string): string {
  const workerPath = join(REPO_ROOT, "src/backend/storage/sqlite/worker-control.ts");
  const kernelPath = join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts");
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => file === workerPath || file === kernelPath
    ? ts.createSourceFile(file, file === workerPath ? content : kernelContent, version, true) : original(file, version, onError, fresh);
  const program = ts.createProgram([workerPath, kernelPath], options, host), checker = program.getTypeChecker();
  const worker = program.getSourceFile(workerPath)!, kernel = program.getSourceFile(kernelPath)!;
  const compact = (node: ts.Node): string => node.getText().replace(/\s+/gu, "");
  const canonical = (node: ts.Node, name: string, owner: string): boolean => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.name === name && symbol.declarations?.some(declaration => declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith(owner)) === true;
  };
  const specs = [
    { name: "admitWorkerReset", schema: "LiveWorkerResetRequestSchema", binding: "WorkerResetBindingSchema", args: "repositories,request,dependencies.ids.uuid(),now,descriptor" },
    { name: "admitWorkerLifecycle", schema: "WorkerBrowserCommandRequestSchema", binding: "WorkerLifecycleBindingSchema", args: 'repositories,request,dependencies.ids.uuid(),now,{descriptor,mode:"initialize"}' },
  ];
  const admitted: ts.CallExpression[] = [];
  for (const spec of specs) {
    const functions = worker.statements.filter(ts.isFunctionDeclaration).filter(fn => fn.name?.text === spec.name);
    if (functions.length !== 1) return content;
    const fn = functions[0], repo = fn.parameters[0];
    if (repo.name.getText() !== "repositories" || repo.type === undefined || !ts.isTypeReferenceNode(repo.type)
      || !canonical(repo.type.typeName, "AuthorityRepositories", "/src/backend/storage/sqlite/authority-database.ts") || fn.body === undefined) return content;
    const first = fn.body.statements[0];
    if (!ts.isVariableStatement(first) || first.declarationList.declarations.length !== 1) return content;
    const request = first.declarationList.declarations[0], parse = request.initializer;
    if (request.name.getText() !== "request" || parse === undefined || !ts.isCallExpression(parse) || !ts.isPropertyAccessExpression(parse.expression)
      || parse.expression.name.text !== "parse" || !canonical(parse.expression.expression, spec.schema, "/src/rules/commands/commands.ts")
      || compact(parse) !== `${spec.schema}.parse(input)`) return content;
    const tail = fn.body.statements.slice(-3);
    if (tail.length !== 3 || !ts.isExpressionStatement(tail[0]) || !ts.isCallExpression(tail[0].expression)
      || compact(tail[0]) !== "repositories.commands.insert(request);"
      || !compact(tail[1]).startsWith("repositories.workerLeases.reserveControl(") || !ts.isReturnStatement(tail[2])
      || tail[2].expression === undefined || !compact(tail[2].expression).startsWith("repositories.workerControls.admit(")) return content;
    let identity = false, binding = false;
    function validate(node: ts.Node): void {
      if (ts.isExpressionStatement(node) && node.parent === fn.body && compact(node) === "repositories.commands.assertIdentity(request);") identity = true;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "parse"
        && canonical(node.expression.expression, spec.binding, "/src/models/run/worker-control.ts")) binding = true;
      ts.forEachChild(node, validate);
    }
    validate(fn);
    if (!identity || !binding) return content;
    let localInvocation = false;
    function rejectLocalCall(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && canonical(node.expression, spec.name, "/src/backend/storage/sqlite/worker-control.ts")) localInvocation = true;
      ts.forEachChild(node, rejectLocalCall);
    }
    rejectLocalCall(worker);
    if (localInvocation) return content;
    const calls: ts.CallExpression[] = [];
    function find(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === spec.name) calls.push(node);
      ts.forEachChild(node, find);
    }
    find(kernel);
    if (calls.length !== 1) return content;
    const call = calls[0];
    if (!canonical(call.expression, spec.name, "/src/backend/storage/sqlite/worker-control.ts")
      || call.arguments.map(compact).join(",") !== spec.args) return content;
    let parent: ts.Node | undefined = call.parent;
    while (parent !== undefined && !ts.isArrowFunction(parent)) parent = parent.parent;
    if (parent === undefined || !ts.isArrowFunction(parent) || parent.parameters.length !== 1 || parent.parameters[0].name.getText() !== "repositories"
      || !ts.isCallExpression(parent.parent) || compact(parent.parent.expression) !== "dependencies.authority.withAuthorityTransaction"
      || parent.parent.arguments.length !== 1 || parent.parent.arguments[0] !== parent
      || !ts.isPropertyAccessExpression(parent.parent.expression) || !canonical(parent.parent.expression.name, "withAuthorityTransaction", "/src/backend/runs/commands/command-kernel.ts")) return content;
    const transaction = checker.getSymbolAtLocation(parent.parent.expression.name);
    if (!transaction?.declarations?.some(declaration => ts.isMethodSignature(declaration)
      && ts.isInterfaceDeclaration(declaration.parent) && declaration.parent.name.text === "CommandAuthority")) return content;
    const repoSymbol = checker.getSymbolAtLocation(repo.name);
    const receiver = tail[0].expression.expression;
    if (!ts.isPropertyAccessExpression(receiver) || !ts.isPropertyAccessExpression(receiver.expression)
      || checker.getSymbolAtLocation(receiver.expression.expression) !== repoSymbol) return content;
    admitted.push(tail[0].expression);
  }
  for (const call of admitted.sort((a, b) => b.pos - a.pos)) content = content.slice(0, call.getStart(worker)) + content.slice(call.end);
  return content;
}

type DelegationAuditRead = Readonly<{ owner: string; id: string; guards: readonly string[]; calls?: readonly string[] }>;
const DELEGATION_AUDIT_READS: Readonly<Record<string, readonly DelegationAuditRead[]>> = {
  "src/backend/storage/sqlite/command-record-row.ts": [
    { owner: "withCanonicalRunCommandScope", id: "request.commandId", guards: [
      'canonicalJsonStringify(repositories.commands.get(request.commandId))!==canonicalJsonStringify(request)',
      'repositories.commandAudits.findByCommand(request.commandId)!==undefined',
      'activeRunCommand!==undefined', 'request.family!=="run"', 'request.type!=="retry"&&request.type!=="cancel"', '"then"inresult',
    ], calls: ["repositories.commands.assertIdentity(request,parentCommandId)"] },
  ],
  "src/backend/storage/sqlite/delegation-root-authority.ts": [
    { owner: "authenticateRunPriority", id: "source.commandId", guards: ['audit?.result.state!=="applied"', "!same(audit.request,source)", "Number(changes[0].before)!==Number(source.target.expectedVersion)"], calls: ["validateNativeLifecycleRequest(command)"] },
    { owner: "authenticateStartPlanRun", id: "plan.consumedBy.commandId", guards: ["audit===undefined", "!same(audit.request,command)", "command.target.expectedVersion!==plan.version-1"], calls: ["validateNativeLifecycleRequest(created)"] },
    { owner: "authenticateRootRun", id: "request.sourceCommandId", guards: ['audit?.result.state!=="applied"', "!same(audit.request,source)", "source.target.expectedVersion!==request.expectedVersion"], calls: ["validateNativeLifecycleRequest(origin)"] },
  ],
  "src/backend/storage/sqlite/delegation-authority.ts": [
    { owner: "authenticateOperatorSource", id: "source.commandId", guards: ['audit.result.state!=="applied"', "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(source)", "source.requestedBy!==LOCAL_OPERATOR_ACTOR_ID"], calls: ["assertCanonicalRunCommandScope(repositories,source)"] },
    { owner: "resolveDelegationRetry", id: "retry.sourceCommandId", guards: ['sourceAudit?.result.state!=="applied"', "canonicalJsonStringify(sourceAudit.request)!==canonicalJsonStringify(source)", "lifecycleRequest.sourceCommandId!==source.commandId"], calls: ["assertDelegationReplacement(repositories,original,child,next)"] },
    { owner: "delegationCancellationAvailability", id: "source.commandId", guards: ['run?.lifecycle.state!=="terminal"', "repositories.commandAudits.findByCommand(source.commandId)===undefined"], calls: ["readDelegationCancellation(repositories,runId)"] },
    { owner: "readDelegationCancellation", id: "source.commandId", guards: ['authored?.result.state!=="applied"', "canonicalJsonStringify(authored.request)!==canonicalJsonStringify(source)", "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(retained)"], calls: ["authenticateCancellationSource(repositories,run,request.cancellationSource)"] },
  ],
  "src/backend/runs/lifecycle/delegation-admission.ts": [
    { owner: "admitDelegation", id: "gate.commandId", guards: ['audit?.result.state!=="applied"', "canonicalJsonStringify(audit.request)!==canonicalJsonStringify(command)", "command.target.expectedVersion!==gate.expectedVersion", "command.requestedBy!==gate.resolvedBy"] },
  ],
};

function withoutDelegationAuditReads(content: string, path: string, kernelContent: string): string {
  const specs = DELEGATION_AUDIT_READS[path];
  if (specs === undefined) return content;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const compact = (node: ts.Node): string => node.getText(source).replace(/\s+/gu, "");
  const importsRepository = source.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === (path.endsWith("/delegation-admission.ts") ? "../../storage/sqlite/authority-database.js" : "./authority-database.js")
    && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some(binding => binding.name.text === "AuthorityRepositories" && binding.propertyName === undefined));
  if (!importsRepository) return content;
  const uses: ts.PropertyAccessExpression[] = [];
  function findUses(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "commandAudits") uses.push(node);
    ts.forEachChild(node, findUses);
  }
  findUses(source);
  if (uses.length !== specs.length) return content;
  const admitted: ts.PropertyAccessExpression[] = [];
  for (const spec of specs) {
    const owner = source.statements.filter(ts.isFunctionDeclaration).find(fn => fn.name?.text === spec.owner);
    if (owner?.body === undefined) return content;
    if (spec.owner !== "admitDelegation" && (owner.parameters[0]?.name.getText(source) !== "repositories"
      || owner.parameters[0].type?.getText(source) !== "AuthorityRepositories")) return content;
    const candidates = uses.filter(use => { let node: ts.Node | undefined = use.parent;
      while (node !== undefined && !ts.isFunctionDeclaration(node)) node = node.parent;
      return node === owner;
    });
    if (candidates.length !== 1) return content;
    const use = candidates[0], method = use.parent, call = method.parent;
    if (compact(use.expression) !== "repositories" || !ts.isPropertyAccessExpression(method) || method.name.text !== "findByCommand"
      || !ts.isCallExpression(call) || call.expression !== method || call.arguments.length !== 1 || compact(call.arguments[0]) !== spec.id) return content;
    const guards = new Set<string>(), calls = new Set<string>();
    function facts(node: ts.Node): void {
      if (ts.isCallExpression(node)) calls.add(compact(node));
      if (ts.isIfStatement(node)) {
        let refuses = false;
        function refusal(statement: ts.Node): void {
          const literal = (expression: ts.Expression): ts.Expression => ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) ? literal(expression.expression) : expression;
          if (ts.isThrowStatement(statement) || ts.isReturnStatement(statement) && statement.expression !== undefined
            && (statement.expression.kind === ts.SyntaxKind.FalseKeyword || ts.isObjectLiteralExpression(statement.expression)
              && statement.expression.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "state"
                && ts.isStringLiteral(literal(property.initializer)) && literal(property.initializer).text === "unavailable"))) refuses = true;
          ts.forEachChild(statement, refusal);
        }
        refusal(node.thenStatement);
        if (refuses) {
          function condition(expression: ts.Node): void {
            if (ts.isBinaryExpression(expression) || ts.isPrefixUnaryExpression(expression)) guards.add(compact(expression));
            ts.forEachChild(expression, condition);
          }
          condition(node.expression);
        }
      }
      ts.forEachChild(node, facts);
    }
    facts(owner.body);
    if (spec.guards.some(proof => !guards.has(proof)) || spec.calls?.some(proof => !calls.has(proof))) return content;
    if (spec.owner === "withCanonicalRunCommandScope") {
      const installed = owner.body.statements.some(statement => ts.isExpressionStatement(statement)
        && compact(statement) === "activeRunCommand={repositories,request:canonicalJsonStringify(request)};");
      const guarded = owner.body.statements.filter(ts.isTryStatement);
      if (!installed || guarded.length !== 1 || guarded[0].finallyBlock === undefined
        || compact(guarded[0].finallyBlock) !== "{activeRunCommand=undefined;}"
        || guarded[0].tryBlock.statements.length !== 3
        || compact(guarded[0].tryBlock.statements[0]) !== "constresult=work();"
        || !ts.isReturnStatement(guarded[0].tryBlock.statements[2])
        || compact(guarded[0].tryBlock.statements[2]) !== "returnresult;") return content;
    }
    if (spec.owner === "admitDelegation") {
      if (owner.parameters[0]?.name.getText(source) !== "dependencies" || owner.parameters[0].type?.getText(source) !== "RunRecordServiceDependencies"
        || !source.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
          && node.moduleSpecifier.text === "./run-record-service.js" && node.importClause?.namedBindings !== undefined
          && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === "RunRecordServiceDependencies" && binding.propertyName === undefined))) return content;
      let callback: ts.Node | undefined = call.parent;
      while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
      // The gate read sits inside its map callback; locate the actual authority callback above it.
      while (callback !== undefined && !(ts.isArrowFunction(callback) && ts.isCallExpression(callback.parent)
        && compact(callback.parent.expression) === "dependencies.database.withAuthorityTransaction")) callback = callback.parent;
      if (callback === undefined || !ts.isArrowFunction(callback) || callback.parameters[0]?.name.getText(source) !== "repositories") return content;
    }
    admitted.push(use);
  }
  if (path.endsWith("/command-record-row.ts")) {
    const kernel = ts.createSourceFile("kernel.ts", kernelContent, ts.ScriptTarget.Latest, true);
    if (!kernel.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "../../storage/sqlite/command-record-row.js" && node.importClause?.namedBindings !== undefined
      && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === "withCanonicalRunCommandScope" && binding.propertyName === undefined))) return content;
    const calls: ts.CallExpression[] = [];
    function find(node: ts.Node): void { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "withCanonicalRunCommandScope") calls.push(node); ts.forEachChild(node, find); }
    find(kernel);
    if (calls.length !== 1 || calls[0].arguments.map(node => node.getText(kernel).replace(/\s+/gu, "")).join(",")
      !== "repositories,request,()=>dispatchActive(dependencies,repositories,request,now,auditId),parentCommandId") return content;
    let callback: ts.Node | undefined = calls[0].parent;
    while (callback !== undefined && !ts.isArrowFunction(callback)) callback = callback.parent;
    if (callback === undefined || !ts.isArrowFunction(callback) || !ts.isCallExpression(callback.parent)
      || callback.parent.expression.getText(kernel) !== "dependencies.authority.withAuthorityTransaction") return content;
    const before: ts.CallExpression[] = [], after: ts.CallExpression[] = [];
    function journal(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(kernel);
        if (expression === "repositories.commands.insert") before.push(node);
        if (expression === "repositories.commandAudits.insert") after.push(node);
      }
      ts.forEachChild(node, journal);
    }
    journal(callback.body);
    if (before.length !== 1 || after.length !== 1 || before[0].end >= calls[0].getStart(kernel)
      || calls[0].end >= after[0].getStart(kernel)) return content;
    const owned = callback.body.getText(kernel).replace(/\s+/gu, "");
    if (!owned.includes("repositories.commands.assertIdentity(request,parentCommandId);")
      || !owned.includes("repositories.commands.insert(journalRequest,parentCommandId)")
      || !owned.includes('if(journal.state==="existing"){if(request.family==="assistant-model-preference")repositories.assistantModelPreference.get();returnreplay(dependencies,repositories,request,now);}')) return content;
  }
  for (const use of admitted.sort((left, right) => right.name.getStart(source) - left.name.getStart(source))) {
    content = content.slice(0, use.name.getStart(source)) + "receiptReads" + content.slice(use.name.end);
  }
  return content;
}

describe("finite native delegation audit read ownership", () => {
  for (const [path, specs] of Object.entries(DELEGATION_AUDIT_READS)) {
    it(`retains exact proof-bound reads and refuses altered authority in ${path}`, () => {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      const kernel = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
      assert.ok(!withoutDelegationAuditReads(source, path, kernel).includes("commandAudits"));
      const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const calls: ts.CallExpression[] = [], expressions: ts.Node[] = [];
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "commandAudits") calls.push(node);
        if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node)) expressions.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      assert.equal(calls.length, specs.length);
      const mutate = (node: ts.Node, replacement: string) => source.slice(0, node.getStart(parsed)) + replacement + source.slice(node.end);
      const mutants: string[] = [`${source}\nfunction unrelated(repositories: any) { return repositories.commandAudits; }`];
      for (const call of calls) {
        for (const method of ["insert", "get"]) mutants.push(mutate(call, `repositories.commandAudits.${method}(${call.arguments[0].getText(parsed)})`));
        mutants.push(mutate(call.arguments[0], "foreignCommandId"));
        mutants.push(mutate(call, "repositories.commandAudits.findByCommand"));
      }
      for (const spec of specs) {
        const proof = expressions.find(expression => expression.getText(parsed).replace(/\s+/gu, "") === spec.guards[1]);
        assert.ok(proof);
        mutants.push(mutate(proof, "true"));
      }
      for (const mutant of mutants) {
        assert.notEqual(mutant, source);
        if (mutant.includes("commandAudits")) assert.ok(withoutDelegationAuditReads(mutant, path, kernel).includes("commandAudits"));
      }
      if (path.endsWith("command-record-row.ts")) {
        for (const mutant of [
          kernel.replace("withCanonicalRunCommandScope(repositories, request,", "withCanonicalRunCommandScope(repositories, otherRequest,"),
          kernel.replace("() => dispatchActive(dependencies, repositories, request, now, auditId), parentCommandId)", "() => arbitraryDispatch(dependencies, repositories, request, now, auditId), parentCommandId)"),
          kernel.replaceAll("dependencies.authority.withAuthorityTransaction", "dependencies.authority.withAuthorityReadSnapshot"),
        ]) {
          assert.notEqual(mutant, kernel);
          assert.ok(withoutDelegationAuditReads(source, path, mutant).includes("commandAudits"));
        }
        const revoked = source.replace("activeRunCommand = undefined;", "void activeRunCommand;");
        assert.notEqual(revoked, source);
        assert.ok(withoutDelegationAuditReads(revoked, path, kernel).includes("commandAudits"));
      }
    });
  }
});

const ASSISTANT_PREFERENCE_PROFILE = "11111111-1111-4111-8111-111111111111";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
  ...["remove-worker", "retry-worker"].map((type, index) => ({
    commandId: index === 0 ? "10101010-1010-4010-8010-101010101010" : "20202020-2020-4020-8020-202020202020",
    requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type,
    target: { workflowId: "fixture-graph", workerId: "fixture-graph-worker-1", membershipRevision: 1,
      expectedVersion: 0, controlBasis: { leaseGeneration: 1, controlRevision: 1 } },
  })),
  {
    commandId: "12121212-1212-4121-8121-121212121212", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "assistant-model-preference", type: "set-assistant-model-preference",
    target: { profileId: ASSISTANT_PREFERENCE_PROFILE, epoch: 0, expectedRevision: 1 }, payload: { slug: "gpt-6.1-sol", effort: "low" },
  },
  {
    commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "failure-resolution", type: "annotate-failure",
    target: { runId: UUID_2, failureId: UUID_4, expectedVersion: 1 }, payload: { action: "resolve" },
  },
  {
    commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "workflow-batch", type: "set-batch-grouping",
    target: { batchId: UUID_2, expectedVersion: 1 }, payload: { groupInQueue: false },
  },
  {
    commandId: UUID_2,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: HASH_B,
      writeId: UUID_4,
      entries: { ucpathPassword: { clear: true } },
    },
  },

  {
    commandId: "abababab-abab-4aba-8aba-abababababab", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "storage-relocation", type: "plan-storage-relocation",
    target: { installationId: UUID_2, sourceGeneration: 0,
      sourcePair: { stateRoot: "/synthetic/state", artifactRoot: "/synthetic/state/artifacts" }, expectedRevision: 0 },
    payload: { writeId: UUID_4, desiredPair: { stateRoot: "/synthetic/next-state", artifactRoot: "/synthetic/next-state/artifacts" },
      desiredDigest: HASH_B, requestFingerprint: HASH_B },
  },
  {
    commandId: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard", family: "storage-relocation", type: "cancel-storage-relocation",
    target: { installationId: UUID_2, sourceGeneration: 0,
      sourcePair: { stateRoot: "/synthetic/state", artifactRoot: "/synthetic/state/artifacts" }, expectedRevision: 1 },
    payload: { writeId: "efefefef-efef-4efe-8efe-efefefefefef", cancelledPlanCommandId: "abababab-abab-4aba-8aba-abababababab",
      cancelledPlanDigest: HASH_B, requestFingerprint: HASH_B },
  },
]);

/* ── the partition (ref dashboard-surfaces authority) ────────── */

const EXPECTED_ACTIVE = {
  "assistant-model-preference": ["set-assistant-model-preference"],
  "failure-resolution": ["annotate-failure"],
  start: ["start-run"],
  "workflow-batch": ["set-batch-grouping"],
  "worker-browser": [
    "plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker",
    "resume-worker", "refresh-browser", "reopen-browser",
  ],
  run: [
    "retry",

    "restart",
    "cancel", "bump", "rename",

    "delete",
    "resolve-write-present", "resolve-write-absent",

  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"],

  intake: [
    "inspect-intake", "confirm-intake-mapping", "correct-intake-row",
    "exclude-intake-row", "validate-intake", "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],
  "storage-relocation": ["plan-storage-relocation", "cancel-storage-relocation"],

  explorer: ["apply-explorer-edit"],
} as const;

const EXPECTED_DEFERRED = {
  intake: [],
  settings: [],
  "storage-relocation": [],
  run: [],
  notification: [],
} as const;

const DEFERRED_KEYS = new Set(
  Object.entries(EXPECTED_DEFERRED as Readonly<Record<string, readonly string[]>>).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── harness ─────────────────────────────────────────────────────────────── */

const profileFixtures: ReturnType<typeof createBoundProfileFixture>[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  const failures: unknown[] = [];
  for (const database of openDatabases.splice(0)) { try { database.close(); } catch (error) { failures.push(error); } }
  for (const fixture of profileFixtures.splice(0)) { try { fixture.close(); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, "command guard fixture cleanup failed");
});

type RepositoryWrap = (repositories: AuthorityRepositories) => AuthorityRepositories;

interface GuardHarness {
  readonly path: string;
  readonly processLockRoot: string;
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

function createHarness(wrap?: RepositoryWrap): GuardHarness {
  const fixture = createBoundProfileFixture();
  profileFixtures.push(fixture);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(fixture.admission,
    { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "command-guard" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(fixture.admission));

  seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
  const seamFailure = (seam: string) => () => {
    throw new Error(`${seam} process seam was reached before authority validation`);
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    appVersion: "0.1.0",
    configIdentity: database.authority.runtimeConfig.get()!,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(wrap === undefined ? repositories : wrap(repositories)),
      ),
    },
    clock,
    ids: sequentialIdFactory("a"),
    authorityProfileId: ASSISTANT_PREFERENCE_PROFILE,
    prepareAssistantModelPreference: async () => () => true,
    descriptors: {
      resolve: (workflowId) => workflowId === "fixture-graph" ? fixtureDescriptor : undefined,
    },
    writeResolution: {
      resolvePresent: seamFailure("resolve-write-present"),
      resolveAbsent: seamFailure("resolve-write-absent"),
    },
    workerRuntime: { pool: {
      planPoolWorkerCount: async () => seamFailure("plan-worker-count")(),
      spawnPoolWorker: async () => seamFailure("spawn-worker")(),
      refreshPoolBrowser: async () => seamFailure("refresh-browser")(),
      reopenPoolBrowser: async () => seamFailure("reopen-browser")(),
      stopPoolWorker: async () => seamFailure("stop-worker")(),
      pausePoolWorker: async () => seamFailure("pause-worker")(),
      resumePoolWorker: async () => seamFailure("resume-worker")(),
    } },
    settings: {
      validateRequest: (command) => command.type === "apply-settings" && command.payload.settingsSchemaHash !== SETTINGS_SCHEMA_HASH
        ? { state: "rejected", code: "schema-mismatch", message: "guard fixture uses a noncurrent settings schema" } : undefined,
      commitPrivate: (command) => command.type === "apply-protected-settings"
        ? { state: "conflict", currentRevision: PositiveIntSchema.parse(1), message: "guard fixture has no mutable private target" } : undefined,
      reconcileReplay: () => {
        throw new Error("guard fixture has no persisted settings replay target");
      },
      applyOrdinary: () => ({
        state: "conflict",
        currentRevision: 1,
        message: "guard fixture has no mutable settings target",
      }),
    },
    explorerEdits: {
      apply: () => ({
        result: {
          state: "refused",
          category: "fixture-refusal",
          message: "Explorer guard fixture refuses before persistence",
        },
      }),
    },
  });
  return { path: fixture.path, processLockRoot: join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot), database, kernel, clock, plannerIds: sequentialIdFactory("f") };
}

let guardCommandSequence = 0;

function nextCommandId(): string {
  guardCommandSequence += 1;
  const tail = String(guardCommandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function createFixturePlan(harness: GuardHarness) {
  const plan = planStart(
    { authority: harness.database, clock: harness.clock, ids: harness.plannerIds, planTtlMs: 600_000 },
    {
      descriptor: fixtureDescriptor,
      submissions: [{ eid: "10800000", mode: "read-only" }],
      dryRun: false,
      priority: "bulk",
      shape: "single",
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId,
      plannedBy: "local-operator",
    },
  );
  assert.equal(harness.database.authority.startPlans.create(plan).state, "inserted");
  return plan;
}

function startCommandFor(plan: ReturnType<typeof createFixturePlan>) {
  return {
    commandId: nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version },
    payload: {
      descriptorFingerprint: plan.descriptorFingerprint,
      configFingerprint: plan.configFingerprint,
      ingressSchemaHash: plan.ingressSchemaHash,
      canonicalInputSchemaHash: plan.canonicalInputSchemaHash,
      inputFingerprint: plan.inputFingerprint,
    },
  };
}

describe("control-command-single-path", () => {
  it("pins the exact ratified Phase-1f active/deferred arm partition", () => {
    assert.deepEqual(PHASE1_ACTIVE_COMMAND_ARMS, EXPECTED_ACTIVE);
    assert.deepEqual(PHASE1_DEFERRED_COMMAND_ARMS, EXPECTED_DEFERRED);
    const partitioned = [
      ...Object.entries(EXPECTED_ACTIVE),
      ...Object.entries(EXPECTED_DEFERRED),
    ].flatMap(([family, actions]) => actions.map((action) => `${family}/${action}`));
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...partitioned].sort(), [...registry].sort());
    assert.equal(new Set(partitioned).size, partitioned.length);
  });

  it("refuses prohibited audit authority in the relocation restore candidate", () => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/relocation-restore-candidate.ts"), "utf8");
    assert.ok(!source.includes("commandAudits"));
    const additions = [
      'function probe(repo: any) { repo.commandAudits.insert({}); }',
      'function probe(repo: any) { return repo.commandAudits.findByCommand("other"); }',
      'const forged = { commandAudits: { findByCommand: () => undefined } };',
      'function probe(repo: any) { return repo["commandAudits"]; }',
      'function probe(repo: any) { return Reflect.get(repo, "commandAudits"); }',
      'function probe(repo: any) { const { commandAudits } = repo; return commandAudits; }',
      'function probe(repo: any) { const audit = repo.commandAudits; return audit; }',
      'export function probe(repo: any) { return repo.commandAudits.get("other"); }',
    ];
    for (const addition of additions) {
      const bad = `${source}\n${addition}`;
      assert.notEqual(bad, source);
      assert.ok(bad.includes("commandAudits"), "unrelated audit authority must remain visible");
    }
  });

  it("admits only the chat-bound terminal assistant reconciliation audit read", () => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/assistant/authorization.ts"), "utf8");
    assert.ok(!withoutAssistantReconciliationAuditRead(source).includes("commandAudits"));
    const parsed = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
    let method: ts.MethodDeclaration | undefined;
    function find(node: ts.Node): void {
      if (ts.isMethodDeclaration(node) && node.name.getText(parsed) === "reconcile") method = node;
      ts.forEachChild(node, find);
    }
    find(parsed); assert.ok(method);
    const admittedMethod = method;
    const original = admittedMethod.getText(parsed);
    const mutate = (from: string, to: string): string => {
      const changed = original.replace(from, to); assert.notEqual(changed, original);
      return source.slice(0, admittedMethod.getStart(parsed)) + changed + source.slice(admittedMethod.end);
    };
    const mutants = [
      mutate("findByCommand(row.command.commandId)", "findByCommand(id)"),
      mutate("commandAudits.findByCommand", "commandAudits.get"),
      mutate("commandAudits.findByCommand", "commandAudits.insert"),
      mutate("ports.database.withAuthorityTransaction", "ports.database.withAuthorityReadSnapshot"),
      mutate("!same(audit.request, row.command) || ", ""),
      mutate("same(audit.request, row.command)", "same(audit.request, audit.request)"),
      mutate("chat(capability);", "chat(Object.freeze({ chatId: id }));"),
      mutate(' || audit.result.state === "pending"', ""),
      `${source}\nconst extra = ports.database.authority.commandAudits.findByCommand(id);`,
      `${source}\nconst aliased = ports.database.authority.commandAudits;`,
    ];
    for (const bad of mutants) {
      assert.notEqual(bad, source);
      assert.ok(withoutAssistantReconciliationAuditRead(bad).includes("commandAudits"));
    }
  });

  it("admits only the intake receipt query's snapshot-bound audit read", () => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/runs/queries/intake-command-result.ts"), "utf8");
    assert.ok(!withoutIntakeCommandReceiptRead(source).includes("commandAudits"));
    for (const bad of [
      source.replace("commandAudits.findByCommand(id)", "commandAudits.insert(id)"),
      source.replace("commandAudits.findByCommand(id)", "commandAudits.findByCommand(otherId)"),
      source.replace("database.withAuthorityReadSnapshot", "database.withAuthorityTransaction"),
      source.replace("commandAudits.findByCommand(id)", "commandAudits.get(id)"),
      `${source}\nfunction forged(database: any) { database.authority.commandAudits.insert({}); }`,
      `${source}\nfunction forged(database: any) { return database.authority.commandAudits; }`,
    ]) assert.ok(withoutIntakeCommandReceiptRead(bad).includes("commandAudits"), "mutating, aliased or out-of-snapshot audit reach stays visible");
  });

  it("keeps the command journal, audit, and start-plan consumption on exactly one executing path", () => {
    const allowed = new Set([
      "src/backend/runs/commands/command-kernel.ts",
      "src/backend/storage/sqlite/authority-database.ts",
    ]);
    const tokens = ["commandAudits", ".commands.insert(", "startPlans.consume("];
    const settingsAuditReaders = new Map([
      ["src/backend/runtime/settings/settings-runtime.ts", 1],
      ["src/backend/storage/maintenance/storage-relocation-plans.ts", 1],
      ["src/backend/storage/sqlite/backup-service.ts", 0],
      ["src/backend/runs/lifecycle/run-record-service.ts", 1],
      ["src/backend/runs/recovery/span-root-repair.ts", 1],
      ["src/models/events/confirmed-operation.ts", 1],
    ]);
    const violations: string[] = [];
    let kernelDefinitions = 0;
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const raw = readFileSync(file, "utf8");
      const kernelContent = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
      const content = path === "src/backend/storage/sqlite/worker-control.ts"
        ? withoutWorkerControlAdmissions(raw, kernelContent) : withoutDelegationAuditReads(raw, path, kernelContent);
      if (content.includes("export function createCommandKernel")) kernelDefinitions += 1;
      if (path !== "src/backend/runs/commands/command-kernel.ts" && path !== "src/backend/storage/sqlite/worker-control.ts"
        && /\b(?:admitWorkerReset|admitWorkerLifecycle)\b/u.test(raw)) violations.push(`${path} references private native worker admission outside the kernel`);
      if (path !== "src/backend/runs/commands/command-kernel.ts" && path !== "src/backend/storage/sqlite/command-record-row.ts"
        && /\bwithCanonicalRunCommandScope\b/u.test(raw)) violations.push(`${path} references private synchronous run command custody outside the kernel`);
      if (allowed.has(path)) continue;
      for (const token of tokens) {
        const expectedSettingsAuditReads = settingsAuditReaders.get(path);
        if (path === "src/backend/runs/queries/intake-command-result.ts" && token === "commandAudits") {
          if (withoutIntakeCommandReceiptRead(content).includes(token)) violations.push(`${path} may only read its actual intake receipt in an authority snapshot`);
          continue;
        }
        if (path === "src/backend/assistant/authorization.ts" && token === "commandAudits") {
          if (withoutAssistantReconciliationAuditRead(content).includes(token)) violations.push(`${path} may only reconcile its chat-bound exact terminal command audit`);
          continue;
        }
        if (expectedSettingsAuditReads !== undefined && token === "commandAudits") {
          const auditUses = content.match(/\bcommandAudits\.[A-Za-z]+/gu) ?? [];
          if (auditUses.length !== expectedSettingsAuditReads
            || auditUses.some((use) => use !== (path === "src/backend/runtime/settings/settings-runtime.ts" ? "commandAudits.findSettingsHistory"
              : path === "src/backend/runs/lifecycle/run-record-service.ts" || path === "src/models/events/confirmed-operation.ts" ? "commandAudits.get" : "commandAudits.findByCommand"))) {
            violations.push(
              `${path} may only authenticate settings through exactly ${String(expectedSettingsAuditReads)} `
              + "commandAudits.findByCommand reads",
            );
          }
          continue;
        }
        if (content.includes(token)) violations.push(`${path} reaches ${token} outside the command kernel`);
      }
    }
    assert.deepEqual(violations, []);
    assert.equal(kernelDefinitions, 1, "exactly one module may define the command kernel");

    // The kernel itself holds no raw storage escape hatch and no UI Delete.
    const kernelSource = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
    assert.ok(!/\bDatabaseSync\b/.test(kernelSource), "the kernel may not hold a raw database handle");
    assert.ok(!/\bDELETE\s+FROM\b/i.test(kernelSource), "the kernel may not physically delete authority rows");
    assert.ok(!/"Delete"/.test(kernelSource), "the UI label is Hide, never Delete");
  });

  it.each(["rogue", "repository", "schema", "caller"])("refuses %s command insertion beyond exact native admission", kind => {
    const source = readFileSync(join(REPO_ROOT, "src/backend/storage/sqlite/worker-control.ts"), "utf8");
    const kernel = readFileSync(join(REPO_ROOT, "src/backend/runs/commands/command-kernel.ts"), "utf8");
    const candidate = kind === "rogue" ? `${source}\nfunction rogue(repositories: any, request: any) { repositories.commands.insert(request); }`
      : kind === "repository" ? source.replaceAll("repositories: AuthorityRepositories", "repositories: any")
      : kind === "schema" ? source.replace("CommandIdentityConflictError, LiveWorkerResetRequestSchema,", "CommandIdentityConflictError,") + "\nconst LiveWorkerResetRequestSchema = { parse: (input: unknown) => input };" : source;
    const caller = kind === "caller" ? kernel.replace("try { result = dependencies.authority.withAuthorityTransaction(repositories => {", "try { result = unowned(repositories => {") : kernel;
    assert.ok(candidate !== source || caller !== kernel, "the negative control must change its targeted source");
    assert.ok(withoutWorkerControlAdmissions(candidate, caller).includes(".commands.insert("));
  });

  it("carries a version or immutability binding on every wire arm's target", () => {
    const versionless: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const parsed = CommandRequestSchema.parse(fixture);
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const target: Record<string, unknown> = request.target;
      const members = target.members;
      const memberVersions = Array.isArray(members) && members.length > 0 && members.every(member => member !== null && typeof member === "object" && "expectedVersion" in member);
      const carries = "expectedVersion" in target || "expectedRevision" in target
        || "scope" in target || memberVersions;
      if (!carries) versionless.push(`${request.family}/${request.type}`);
    }
    assert.deepEqual(versionless, []);
  });

  it("dispatches every command family/action: active arms execute and unavailable arms have zero effects", async () => {
    const harness = createHarness();
    const seen: string[] = [];
    for (const fixture of CURRENT_COMMAND_FIXTURES) {
      const parsed = CommandRequestSchema.parse(fixture);
      const request = parsed.family === "worker-browser" && "workflowId" in parsed.target
        ? { ...parsed, target: { ...parsed.target, workflowId: "fixture-graph" } } : parsed;
      const key = `${request.family}/${request.type}`;
      seen.push(key);
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = CommandResultSchema.parse(request.family === "worker-browser"
        ? await harness.kernel.executeWorkerPool(structuredClone(request))
        : request.family === "assistant-model-preference"
          ? await harness.kernel.executeAssistantModelPreference(structuredClone(request))
          : harness.kernel.execute(structuredClone(request)));
      if (DEFERRED_KEYS.has(key) || request.family === "storage-relocation") {
        assert.equal(result.state, "rejected", key);
        if (result.state !== "rejected") continue;
        assert.equal(result.code, "capability-unavailable", key);
        assert.equal(harness.database.getMeta().authorityGeneration, generationBefore, key);
        assert.equal(harness.database.authority.commands.get(request.commandId), undefined, key);
      } else {
        // Active arms EXECUTE: against an empty store they refuse on exact
        // authority lookups with a typed code that is never the deferred one.
        assert.notEqual(result.state, "applied", key);
        if (result.state === "rejected") {
          assert.notEqual(result.code, "capability-unavailable", `${key} must execute in Phase 1f`);
        }
      }
    }
    const registry = COMMAND_FAMILY_REGISTRY.flatMap(({ family, actions }) =>
      actions.map((action) => `${family}/${action}`));
    assert.deepEqual([...new Set(seen)].sort(), [...registry].sort(), "the fixture corpus must cover every current family/action");
  });


  it("CASes every run verb against the caller's version — presentation included", () => {
    const harness = createHarness();
    assert.equal(harness.database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
      configFingerprint: harness.database.authority.runtimeConfig.get()!.configFingerprint,
      configSnapshotId: harness.database.authority.runtimeConfig.get()!.configSnapshotId } }).state, "inserted");
    const base = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
    };
    const live = harness.database.authority.runs.get(UUID_2)?.version ?? 0;
    assert.ok(live > 0);

    const staleRename = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: 999 },
      payload: { displayName: "Renamed despite drift" },
    });
    assert.equal(staleRename.state, "conflict", "a stale rename may not overwrite a current name");
    assert.equal(harness.database.authority.runs.get(UUID_2)?.displayName, undefined);

    const staleBump = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(staleBump.state, "conflict", "bump CASes the caller's value");
    assert.equal(
      harness.database.authority.runs.get(UUID_2)?.envelope.priority,
      QUEUED_RUN.envelope.priority,
      "a refused bump reorders nothing",
    );

    const cancelled = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "cancel",
      target: { runId: UUID_2, expectedVersion: 999 },
    });
    assert.equal(cancelled.state, "conflict", "cancel-tree is CAS-enforced");

    // At the LIVE version both land, and rename is still presentation-only:
    // the run row exists, its lifecycle is untouched.
    const renamed = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "rename",
      target: { runId: UUID_2, expectedVersion: live },
      payload: { displayName: "Renamed at the live version" },
    });
    assert.equal(renamed.state, "applied");
    const bumped = harness.kernel.execute({
      ...base, commandId: nextCommandId(), type: "bump",
      target: { runId: UUID_2, expectedVersion: harness.database.authority.runs.get(UUID_2)?.version ?? 0 },
    });
    assert.equal(bumped.state, "applied");

    const afterRename = harness.database.authority.runs.get(UUID_2);
    assert.ok(afterRename !== undefined, "presentation may never delete the run row");
    assert.equal(afterRename.lifecycle.state, "queued");
    assert.equal(afterRename.displayName, "Renamed at the live version");
    assert.equal(afterRename.envelope.priority, "interactive");
  });

  it("enqueue policy is transactional: an injected active-run lookup error creates zero runs", () => {
    let shouldFail = false;
    const harness = createHarness((repositories) => ({
      ...repositories,
      runs: {
        ...repositories.runs,
        listByItem: (input: unknown) => {
          if (shouldFail) throw new Error("injected active-run lookup failure");
          return repositories.runs.listByItem(input);
        },
      },
    }));
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    shouldFail = true;
    const generationBefore = harness.database.getMeta().authorityGeneration;
    assert.throws(() => harness.kernel.execute(command), /injected active-run lookup failure/);
    assert.deepEqual(harness.database.authority.runs.listByWorkflow(plan.workflowId), []);
    assert.equal(harness.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("commands are idempotent: byte-exact replay returns already-applied; a different body on the same id fails loud", () => {
    const harness = createHarness();
    const plan = createFixturePlan(harness);
    const command = startCommandFor(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    assert.throws(
      () => harness.kernel.execute({ ...command, reason: "different content, same id" }),
      /reused with different content/,
    );
  });

  it("typed gate results parse the descriptor's exact schema and store a checkpointed result", () => {
    const harness = createHarness();
    const plan = createFixturePlan(harness);
    const runId = singleAppliedRunId(harness.kernel.execute(startCommandFor(plan)));
    const slot = harness.database.withAuthorityTransaction(repositories => {
      const member = admitDirectWorker(repositories, { commandId: randomUUID(), workflow: "fixture-graph", poolIndex: 1,
        expectedPoolVersion: 0, processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: harness.path,
        processLockRoot: harness.processLockRoot, now: NOW }, randomUUID());
      assert.equal(repositories.workerLeases.start({ workerId: member.workerId, workflow: "fixture-graph", browserSystems: [],
        processId: process.pid, requestedBy: "local-operator", now: NOW }).state, "started");
      return member;
    });
    const lease = harness.database.authority.workerLeases.get(slot.workerId);
    assert.ok(lease);
    const workerLifetime = { membershipRevision: slot.membershipRevision, leaseGeneration: lease.leaseGeneration };
    const claimed = harness.database.authority.runs.claimNext({
      workflow: "fixture-graph", workerId: slot.workerId, workerLifetime, now: NOW,
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    const claim = { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration };
    const live = { workerId: slot.workerId, workerLifetime, claimedAt: NOW, heartbeatAt: NOW };
    let version: number = claimed.run.version;
    for (const state of ["validating", "running"] as const) {
      assert.equal(harness.database.authority.runs.transition({
        runId, expectedVersion: version, claim, lifecycle: { state, ...live }, now: NOW,
      }).state, "applied");
      version += 1;
    }
    const parked = harness.database.authority.runs.transition({
      runId, expectedVersion: version, claim,
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: NOW, resumeAt: "fan" },
      now: NOW,
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") return;

    const gateBase = {
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "gate",
      type: "resolve-gate",
    };
    const generationBefore = harness.database.getMeta().authorityGeneration;
    const wrong = harness.kernel.execute({
      ...gateBase, commandId: nextCommandId(),
      target: { runId, gateId: "approval", expectedVersion: parked.run.version },
      payload: { result: { schemaHash: "9".repeat(64), value: { approved: true } } },
    });
    assert.equal(wrong.state, "rejected");
    if (wrong.state === "rejected") assert.equal(wrong.code, "schema-mismatch");
    assert.equal(harness.database.authority.gateResults.get(`${runId}:approval`), undefined);
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
  });

  it("notification stays read/unread/snooze", () => {
    const notification = COMMAND_FAMILY_REGISTRY.find(({ family }) => family === "notification");
    assert.deepEqual(notification?.actions, ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"]);
  });
});
