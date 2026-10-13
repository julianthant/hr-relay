
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

const SCAN_ROOT = "src/dashboard";
const FIXTURE = "tests/architecture/runs/fixtures/command-result-unhandled-conflict.ts";
const FIXTURE_UNFOLDED = "tests/architecture/runs/fixtures/command-result-unfolded-dispatch.ts";
const FIXTURE_PARTIAL_FOLD = "tests/architecture/runs/fixtures/command-result-partial-fold.ts";


const EXEMPT = new Set([
  "src/dashboard/app/commands/command-result.ts",
  "src/dashboard/client/commands.ts",
]);


const COMMAND_EXECUTOR = "src/dashboard/app/commands/command-executor.ts";
const DASHBOARD_CLIENT_ADAPTER = "src/dashboard/client/index.ts";
const RUN_LAUNCH_MODEL = "src/dashboard/surfaces/run-start/run-launch-model.ts";
const RUN_START_SURFACE = "src/dashboard/surfaces/run-start/run-start.tsx";

function sourceFiles(root: string): readonly string[] {
  const absolute = join(REPO_ROOT, root);
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(path);
    }
  };
  walk(absolute);
  return found;
}


function decidesSettlementAlone(text: string, source?: ts.SourceFile, checker?: ts.TypeChecker, canonical?: ts.Type): boolean {
  const parsed = source ?? ts.createSourceFile("fixture.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const arms = new Map<ts.Symbol | string, Set<string>>();
  function receiverSymbol(expression: ts.Expression, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    const symbol = checker?.getSymbolAtLocation(expression);
    if (symbol === undefined || seen.has(symbol)) return symbol;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration;
    if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
      && ts.isIdentifier(declaration.initializer)) return receiverSymbol(declaration.initializer, seen) ?? symbol;
    return symbol;
  }
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      const access = ts.isPropertyAccessExpression(node.left) ? node.left : ts.isPropertyAccessExpression(node.right) ? node.right : undefined;
      const literal = ts.isStringLiteralLike(node.right) ? node.right : ts.isStringLiteralLike(node.left) ? node.left : undefined;
      if (access?.name.text === "state" && literal !== undefined && ["rejected", "conflict"].includes(literal.text)) {
        const type = checker?.getTypeAtLocation(access.expression);
        if (checker === undefined || (type !== undefined && canonical !== undefined
          && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) && checker.isTypeAssignableTo(type, canonical))) {
          const key = receiverSymbol(access.expression) ?? access.expression.getText(parsed);
          const found = arms.get(key) ?? new Set<string>();
          found.add(literal.text); arms.set(key, found);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return [...arms.values()].some((found) => found.size === 1);
}

const COMMAND_PROOFS = {
  alias: 'import type { CommandResult as Result } from "../../rules/commands/commands.js"; type Alias = Result; export function bad(result: Alias) { return result.state === "rejected"; }',
  namespace: 'import type * as command from "../../rules/commands/commands.js"; export function bad(result: command.CommandResult) { return result.state === "conflict"; }',
  presentation: 'type CommandResult = { state: "conflict" | "refused" }; export function view(result: CommandResult) { return result.state === "conflict"; }',
  coexist: 'import type { CommandResult } from "../../rules/commands/commands.js"; type Save = { state: "conflict" | "refused" }; export function bad(save: Save, result: CommandResult) { if (save.state === "conflict") return; if (result.state === "rejected") return; }',
  shadow: 'import type { CommandResult } from "../../rules/commands/commands.js"; export function view() { type CommandResult = { state: "conflict" | "refused" }; function local(result: CommandResult) { return result.state === "conflict"; } return local; }',
  scopes: 'import type { CommandResult } from "../../rules/commands/commands.js"; export function first(result: CommandResult) { return result.state === "rejected"; } export function second(result: CommandResult) { return result.state === "conflict"; }',
  aliasedClean: 'import type { CommandResult } from "../../rules/commands/commands.js"; export function view(result: CommandResult) { const alias = result; return result.state === "rejected" || alias.state === "conflict"; }',
  separate: 'import type { CommandResult } from "../../rules/commands/commands.js"; export function bad(first: CommandResult, second: CommandResult) { return first.state === "rejected" || second.state === "conflict"; }',
  clean: 'import type { CommandResult } from "../../rules/commands/commands.js"; export function view(result: CommandResult) { return result.state === "rejected" || result.state === "conflict"; }',
} as const;
let commandAudit: { program: ts.Program; checker: ts.TypeChecker; canonical: ts.Type } | undefined;
function commandContext() {
  if (commandAudit !== undefined) return commandAudit;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true };
  const virtual = new Map(Object.entries(COMMAND_PROOFS).map(([name, text]) => [resolve(REPO_ROOT, `src/dashboard/guard-proofs/${name}.tsx`), text]));
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (file) => virtual.get(file) ?? read(file);
  const program = ts.createProgram([...sourceFiles(SCAN_ROOT), ...virtual.keys()], options, host);
  const checker = program.getTypeChecker();
  const declaration = program.getSourceFile(resolve(REPO_ROOT, "src/rules/commands/commands.ts"))?.statements.find((node) => ts.isTypeAliasDeclaration(node) && node.name.text === "CommandResult");
  expect(declaration).toBeDefined();
  const canonical = checker.getTypeAtLocation(declaration!);
  commandAudit = { program, checker, canonical };
  return commandAudit;
}
function canonicalDecision(path: string): boolean {
  const { program, checker, canonical } = commandContext();
  const source = program.getSourceFile(resolve(REPO_ROOT, path));
  expect(source).toBeDefined();
  return decidesSettlementAlone(source!.text, source, checker, canonical);
}


function isExecuteCommandCall(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "executeCommand";
}


function isSettleCommandResultCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "settleCommandResult";
  if (ts.isPropertyAccessExpression(callee)) {
    if (callee.name.text === "settleCommandResult") return true;
    if (callee.name.text === "then") {
      const fulfillment = node.arguments[0];
      if (fulfillment === undefined) return false;
      return (ts.isIdentifier(fulfillment) && fulfillment.text === "settleCommandResult")
        || (ts.isPropertyAccessExpression(fulfillment) && fulfillment.name.text === "settleCommandResult");
    }
  }
  return false;
}

function countCallSites(source: ts.SourceFile, isMatch: (node: ts.CallExpression) => boolean): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isMatch(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function foldsFewerCommandsThanItPosts(path: string, text: string): boolean {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const posts = countCallSites(source, isExecuteCommandCall);
  if (posts === 0) return false;
  const settles = countCallSites(source, isSettleCommandResultCall);
  return settles < posts;
}

function expressionPath(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const parent = expressionPath(expression.expression);
  return parent === undefined ? undefined : `${parent}.${expression.name.text}`;
}

function findNodes<T extends ts.Node>(root: ts.Node, isMatch: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (isMatch(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function callSites(root: ts.Node, path: string): ts.CallExpression[] {
  return findNodes(root, (node): node is ts.CallExpression => ts.isCallExpression(node) && expressionPath(node.expression) === path);
}

function callHasArguments(call: ts.CallExpression, args: readonly string[]): boolean {
  return call.arguments.length === args.length && args.every((arg, index) => call.arguments[index]?.getText() === arg);
}

function methodNamed(root: ts.Node, name: string): ts.MethodDeclaration | undefined {
  return findNodes(root, (node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === name)[0];
}

function propertyValue(expression: ts.Expression, name: string): ts.Expression | undefined {
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  const property = expression.properties.find((entry) => ts.isPropertyAssignment(entry)
    && ((ts.isIdentifier(entry.name) || ts.isStringLiteralLike(entry.name)) && entry.name.text === name));
  return property !== undefined && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function returnKind(statement: ts.ReturnStatement): string | undefined {
  if (statement.expression === undefined) return undefined;
  const kind = propertyValue(statement.expression, "kind");
  return kind !== undefined && ts.isStringLiteralLike(kind) ? kind.text : undefined;
}

function isDescendant(node: ts.Node, ancestor: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function hasCheckedSingleSettlement(dispatch: ts.Node): boolean {
  const calls = callSites(dispatch, "options.scope.client.executeCommand");
  return calls.length === 1 && calls.every((call) => {
    if (!callHasArguments(call, ["request"]) || !ts.isAwaitExpression(call.parent)) return false;
    const checked = call.parent.parent;
    if (!ts.isCallExpression(checked) || expressionPath(checked.expression) !== "checkedCommandResult"
      || checked.arguments[0]?.getText() !== "request" || checked.arguments[1] !== call.parent) return false;
    const settled = checked.parent;
    return ts.isCallExpression(settled) && expressionPath(settled.expression) === "this.settle"
      && callHasArguments(settled, ["request", checked.getText(), "options"])
      && ts.isAwaitExpression(settled.parent);
  });
}

function hasOrderedBulkSettlement(dispatch: ts.Node): boolean {
  const calls = callSites(dispatch, "options.scope.client.executeBulkCommand");
  if (calls.length !== 1) return false;
  const call = calls[0]!;
  if (!callHasArguments(call, ["request"]) || !ts.isAwaitExpression(call.parent)) return false;
  const checked = call.parent.parent;
  if (!ts.isCallExpression(checked) || expressionPath(checked.expression) !== "checkedBulkCommandResult"
    || checked.arguments[0]?.getText() !== "request" || checked.arguments[1] !== call.parent) return false;
  const reply = findNodes(dispatch, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === "reply" && node.initializer === checked)[0];
  if (reply === undefined) return false;
  return findNodes(dispatch, (node): node is ts.ForOfStatement => ts.isForOfStatement(node)).some((loop) => {
    if (!ts.isVariableDeclarationList(loop.initializer) || !ts.isCallExpression(loop.expression)
      || expressionPath(loop.expression.expression) !== "commands.entries" || loop.expression.arguments.length !== 0) return false;
    const binding = loop.initializer.declarations[0]?.name;
    if (binding === undefined || !ts.isArrayBindingPattern(binding)) return false;
    const index = binding.elements[0];
    const command = binding.elements[1];
    if (index === undefined || command === undefined || !ts.isBindingElement(index) || !ts.isBindingElement(command)
      || !ts.isIdentifier(index.name) || !ts.isIdentifier(command.name)) return false;
    const child = findNodes(loop.statement, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name) && node.name.text === "child" && node.initializer !== undefined
      && ts.isElementAccessExpression(node.initializer) && expressionPath(node.initializer.expression) === "reply.results"
      && node.initializer.argumentExpression?.getText() === index.name.text)[0];
    if (child === undefined) return false;
    return callSites(loop.statement, "outcomes.push").some((push) => {
      const result = push.arguments[0];
      if (result === undefined || !ts.isConditionalExpression(result)
        || result.condition.getText() !== `${child.name.getText()} === undefined`) return false;
      const refusal = result.whenTrue;
      const settled = result.whenFalse;
      if (!ts.isCallExpression(refusal) || expressionPath(refusal.expression) !== "this.refuse"
        || !callHasArguments(refusal, [`${command.name.text}.commandId`, '"not-attempted"'])
        || !ts.isAwaitExpression(settled) || !ts.isCallExpression(settled.expression)
        || expressionPath(settled.expression.expression) !== "this.settle") return false;
      return callHasArguments(settled.expression, [command.name.text, child.name.getText(), "options"]);
    });
  });
}

function isStateComparison(expression: ts.Expression, state: string): expression is ts.BinaryExpression {
  return ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && expressionPath(expression.left) === "readback.state"
    && ts.isStringLiteralLike(expression.right) && expression.right.text === state;
}

function hasRequiredReadbackSettlement(settle: ts.Node): boolean {
  const readbacks = callSites(settle, "options.readback");
  const awaitedReadback = readbacks.find((call) => callHasArguments(call, ["request", "reply", "options.scope"])
    && ts.isAwaitExpression(call.parent)
    && ts.isVariableDeclaration(call.parent.parent)
    && ts.isIdentifier(call.parent.parent.name) && call.parent.parent.name.text === "readback");
  if (readbacks.length !== 1 || awaitedReadback === undefined) return false;
  const declaration = awaitedReadback.parent.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isVariableStatement(declaration.parent.parent)) return false;
  const statement = declaration.parent.parent;
  const tryBlocks = findNodes(settle, (node): node is ts.TryStatement => ts.isTryStatement(node)
    && isDescendant(statement, node.tryBlock));
  if (tryBlocks.length !== 1 || statement.parent !== tryBlocks[0]!.tryBlock) return false;
  const readbackBlock = tryBlocks[0]!.tryBlock;
  const branches = readbackBlock.statements.filter((node): node is ts.IfStatement => ts.isIfStatement(node));
  const matched = branches.filter((node) => isStateComparison(node.expression, "matched"));
  const conflicts = branches.filter((node) => isStateComparison(node.expression, "conflict"));
  if (matched.length !== 1 || conflicts.length !== 1) return false;
  const matchedBranch = matched[0]!;
  const conflictBranch = conflicts[0]!;
  const statements = readbackBlock.statements;
  if (statements.indexOf(matchedBranch) <= statements.indexOf(statement)
    || statements.indexOf(conflictBranch) <= statements.indexOf(statement)) return false;
  const returns = findNodes(settle, (node): node is ts.ReturnStatement => ts.isReturnStatement(node));
  const confirmed = returns.filter((statement) => returnKind(statement) === "confirmed");
  const conflictReturns = findNodes(conflictBranch.thenStatement, (node): node is ts.ReturnStatement => ts.isReturnStatement(node))
    .filter((statement) => returnKind(statement) === "conflict");
  const readbackReturns = findNodes(readbackBlock, (node): node is ts.ReturnStatement => ts.isReturnStatement(node));
  const uncertain = readbackReturns.filter((statement) => returnKind(statement) === "uncertain");
  return confirmed.length === 1 && isDescendant(confirmed[0]!, matchedBranch.thenStatement)
    && propertyValue(confirmed[0]!.expression!, "readback")?.getText() === "readback.evidence"
    && conflictReturns.length === 1 && isDescendant(conflictReturns[0]!, conflictBranch.thenStatement)
    && propertyValue(conflictReturns[0]!.expression!, "readback")?.getText() === "readback.evidence"
    && uncertain.length === 1 && !isDescendant(uncertain[0]!, matchedBranch.thenStatement)
    && !isDescendant(uncertain[0]!, conflictBranch.thenStatement);
}

function isCommandDispatchCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const member = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
    : ts.isElementAccessExpression(node.expression) && node.expression.argumentExpression !== undefined
      && ts.isStringLiteralLike(node.expression.argumentExpression)
      ? node.expression.argumentExpression.text : undefined;
  return member === "executeCommand" || member === "executeBulkCommand";
}

function hasOnlyOwnedDispatchCalls(path: string, source: ts.SourceFile): boolean {
  const calls = findNodes(source, isCommandDispatchCall);
  const dispatch = path === COMMAND_EXECUTOR ? methodNamed(source, "dispatch") : undefined;
  return calls.every((call) => {
    const callPath = expressionPath(call.expression);
    return path === COMMAND_EXECUTOR
      ? dispatch !== undefined && isDescendant(call, dispatch)
        && (callPath === "options.scope.client.executeCommand" || callPath === "options.scope.client.executeBulkCommand")
      : path === DASHBOARD_CLIENT_ADAPTER && callPath === "commands.executeCommand";
  });
}

function isRunBindingDelegation(source: ts.SourceFile): boolean {
  const submit = methodNamed(source, "submit");
  const binding = submit?.parameters[1];
  const bindingType = binding?.type;
  if (submit === undefined || binding === undefined || !ts.isIdentifier(binding.name)
    || bindingType === undefined || !ts.isTypeReferenceNode(bindingType) || !ts.isIdentifier(bindingType.typeName)
    || bindingType.typeName.text !== "DashboardCommandBinding") return false;
  const options = findNodes(submit, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === "options" && node.initializer !== undefined
    && ts.isObjectLiteralExpression(node.initializer))[0];
  if (options === undefined || options.initializer === undefined || !ts.isObjectLiteralExpression(options.initializer)) return false;
  const scope = propertyValue(options.initializer, "scope");
  if (scope === undefined || expressionPath(scope) !== "binding.scope") return false;
  const readback = propertyValue(options.initializer, "readback");
  if (readback === undefined || !ts.isArrowFunction(readback)
    || !callSites(readback, "verifyRunLaunchReadback").some((call) => callHasArguments(call, ["client", "request", "reply", "plan"]))) return false;
  const hasRetainedLookup = callSites(submit, "binding.executor.retainedAttempts").length === 1;
  const delegated = findNodes(submit, (node): node is ts.ConditionalExpression => ts.isConditionalExpression(node)).some((choice) => {
    if (choice.condition.getText() !== "retained === undefined" || !ts.isCallExpression(choice.whenTrue)
      || !ts.isCallExpression(choice.whenFalse) || expressionPath(choice.whenTrue.expression) !== "binding.executor.execute"
      || expressionPath(choice.whenFalse.expression) !== "binding.executor.replay") return false;
    return callHasArguments(choice.whenTrue, ["command", "options"])
      && callHasArguments(choice.whenFalse, ["command.commandId", "options"]);
  });
  return hasRetainedLookup && delegated;
}

function parseSource(path: string, text = readFileSync(join(REPO_ROOT, path), "utf8")): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

describe("command-result-exhaustive", () => {
  it("no dashboard module tests ONE refusal arm and lets the other fall through", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !EXEMPT.has(path))
      .filter(canonicalDecision);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the walker SEES the pattern it forbids (negative control)", () => {
    const violating = readFileSync(join(REPO_ROOT, FIXTURE), "utf8");
    expect(decidesSettlementAlone(violating)).toBe(true);
    // And a module that names both arms in one condition is clean, so the
    // guard cannot be satisfied by a walker that answers `true` for everything.
    expect(decidesSettlementAlone(
      'if (result.state === "conflict" || result.state === "rejected") report(result.message);',
    )).toBe(false);
    // The negated early-return form is exhaustive too, and must read clean.
    expect(decidesSettlementAlone(
      'if (result.state !== "conflict" && result.state !== "rejected") return null;',
    )).toBe(false);
  });

  it("binds raw refusal checks to canonical results and each receiver", () => {
    for (const name of ["alias", "namespace", "coexist", "separate", "scopes"] as const) expect(canonicalDecision(`src/dashboard/guard-proofs/${name}.tsx`), name).toBe(true);
    for (const name of ["presentation", "shadow", "clean", "aliasedClean"] as const) expect(canonicalDecision(`src/dashboard/guard-proofs/${name}.tsx`), name).toBe(false);
  });

  it("settles checked transport replies in the shared executor and Run binding", () => {
    const executor = parseSource(COMMAND_EXECUTOR);
    const dispatch = methodNamed(executor, "dispatch");
    const settle = methodNamed(executor, "settle");
    expect(dispatch).toBeDefined();
    expect(settle).toBeDefined();
    expect(hasCheckedSingleSettlement(dispatch!)).toBe(true);
    expect(hasOrderedBulkSettlement(dispatch!)).toBe(true);
    expect(hasRequiredReadbackSettlement(settle!)).toBe(true);

    const launch = parseSource(RUN_LAUNCH_MODEL);
    expect(isRunBindingDelegation(launch)).toBe(true);
    const surface = parseSource(RUN_START_SURFACE);
    expect(callSites(surface, "launchService.submit").some((call) => call.arguments[1]?.getText() === "binding")).toBe(true);
  });

  it("keeps raw dispatch inside the executor and client adapter only", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((absolute) => ({ path: relative(REPO_ROOT, absolute), source: parseSource(relative(REPO_ROOT, absolute)) }))
      .filter(({ path, source }) => !hasOnlyOwnedDispatchCalls(path, source))
      .map(({ path }) => path);
    expect(offenders, offenders.join("\n")).toEqual([]);

    for (const method of ["executeCommand", "executeBulkCommand"] as const) {
      const surfaceDispatch = parseSource("src/dashboard/surfaces/dispatch-fixture.ts", `client.${method}(request);`);
      expect(hasOnlyOwnedDispatchCalls("src/dashboard/surfaces/dispatch-fixture.ts", surfaceDispatch), method).toBe(false);
    }
  });

  it("rejects removed or wrong settlement and readback bypasses", () => {
    const checked = 'async function dispatch(request, options) { return await this.settle(request, checkedCommandResult(request, await options.scope.client.executeCommand(request)), options); }';
    const missingSettle = 'async function dispatch(request, options) { return checkedCommandResult(request, await options.scope.client.executeCommand(request)); }';
    const wrongFold = 'async function dispatch(request, options) { return settleCommandResult(checkedCommandResult(request, await options.scope.client.executeCommand(request))); }';
    expect(hasCheckedSingleSettlement(parseSource("fixture.ts", checked))).toBe(true);
    expect(hasCheckedSingleSettlement(parseSource("fixture.ts", missingSettle))).toBe(false);
    expect(hasCheckedSingleSettlement(parseSource("fixture.ts", wrongFold))).toBe(false);

    const bulk = 'async function dispatch(request, options, commands, outcomes) { const reply = checkedBulkCommandResult(request, await options.scope.client.executeBulkCommand(request)); for (const [index, command] of commands.entries()) { const child = reply.results[index]; outcomes.push(child === undefined ? this.refuse(command.commandId, "not-attempted") : await this.settle(command, child, options)); } }';
    expect(hasOrderedBulkSettlement(parseSource("fixture.ts", bulk))).toBe(true);
    expect(hasOrderedBulkSettlement(parseSource("fixture.ts", bulk.replace("await this.settle(command, child, options)", "child")))).toBe(false);

    const readback = 'async function settle(request, reply, options) { if ("outcome" in reply) { if (reply.outcome === "errored") return { kind: "uncertain" }; if (reply.outcome === "conflict") return { kind: "conflict" }; } if ("state" in reply) { if (reply.state === "conflict") return { kind: "conflict" }; if (reply.state === "rejected") return { kind: "uncertain" }; } try { const readback = await options.readback(request, reply, options.scope); if (readback.state === "matched") return { kind: "confirmed", readback: readback.evidence }; if (readback.state === "conflict") return { kind: "conflict", readback: readback.evidence }; return { kind: "uncertain" }; } catch (cause) { return { kind: "uncertain" }; } }';
    const bypass = readback.replace("await options.readback", "options.readback");
    const prematureConfirmation = readback.replace('if (reply.state === "conflict") return { kind: "conflict" };', 'if (reply.state === "conflict") return { kind: "confirmed", readback: reply };');
    const unmatchedConfirmation = readback.replace('if (readback.state === "matched") return { kind: "confirmed", readback: readback.evidence };', 'if (readback.state !== "matched") return { kind: "confirmed", readback: readback.evidence };');
    expect(hasRequiredReadbackSettlement(parseSource("fixture.ts", readback))).toBe(true);
    expect(hasRequiredReadbackSettlement(parseSource("fixture.ts", bypass))).toBe(false);
    expect(hasRequiredReadbackSettlement(parseSource("fixture.ts", prematureConfirmation))).toBe(false);
    expect(hasRequiredReadbackSettlement(parseSource("fixture.ts", unmatchedConfirmation))).toBe(false);
  });

  it("the call-site walker sees its own violations (negative control)", () => {
    // No import of the fold at all: every posted command falls straight
    // through to the success path.
    expect(foldsFewerCommandsThanItPosts(
      FIXTURE_UNFOLDED,
      readFileSync(join(REPO_ROOT, FIXTURE_UNFOLDED), "utf8"),
    )).toBe(true);
    // A REAL import of the fold, called on only ONE of two dispatches — the
    // shape the import-only check could not see.
    expect(foldsFewerCommandsThanItPosts(
      FIXTURE_PARTIAL_FOLD,
      readFileSync(join(REPO_ROOT, FIXTURE_PARTIAL_FOLD), "utf8"),
    )).toBe(true);
    // A type import and comment mention cannot settle a posted command.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import type { CommandSettlement } from "../app/command-result.js";\n'
      + '// settleCommandResult(result) would settle this, but nothing calls it.\n'
      + 'export function post(client: { executeCommand: (r: unknown) => Promise<CommandSettlement> }, r: unknown) {\n'
      + '  void client.executeCommand(r);\n'
      + '}\n',
    )).toBe(true);
    // A module that posts twice and folds both is clean, so the walker
    // cannot be satisfied by one that answers `true` for everything.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then((r) => { if (settleCommandResult(r).kind === "refused") stop(); });\n'
      + 'client.executeCommand(b).then((r) => { settleCommandResult(r); });',
    )).toBe(false);
    // Passing settleCommandResult directly as a .then callback settles the command.
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then(settleCommandResult);\n',
    )).toBe(false);
    // Passing an un-settled callback to .then leaves the command unhandled (negative control).
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'client.executeCommand(a).then((res) => console.log(res));\n',
    )).toBe(true);
    // Passing settleCommandResult as second (rejection) argument to .then leaves the fulfillment unhandled (negative control).
    expect(foldsFewerCommandsThanItPosts(
      "fixture.ts",
      'import { settleCommandResult } from "../app/command-result.js";\n'
      + 'client.executeCommand(a).then(() => toastSuccess(), settleCommandResult);\n',
    )).toBe(true);
    // And a module that posts nothing is out of this arm's scope entirely.
    expect(foldsFewerCommandsThanItPosts("fixture.ts", "export const NOTHING_IS_POSTED = 1;")).toBe(false);
  });

  it("the command-result fold handles every current wire state", () => {
    const source = parseSource("src/dashboard/app/commands/command-result.ts");
    const fold = findNodes(source, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
      && node.name?.text === "settleCommandResult")[0];
    const branches = fold === undefined ? [] : findNodes(fold, (node): node is ts.SwitchStatement => ts.isSwitchStatement(node));
    expect(branches).toHaveLength(1);
    const states = branches[0]!.caseBlock.clauses.map((clause) => ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression)
      ? clause.expression.text : "unexpected");
    expect(states).toEqual(["applied", "already-applied", "confirmation-required", "conflict", "rejected"]);
  });
});
