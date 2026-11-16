import assert from "node:assert/strict";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import { REPO_ROOT, walkFiles } from "../support/helpers/guard-files.js";

const TASK_OWNER = "src/workflow-kit/task.ts";
const ERROR_OWNER = "src/workflow-kit/errors.ts";
const CONTRACT_OWNER = "src/models/task/task-contract.ts";
const CONTROL_PATH = resolve(REPO_ROOT, "src/workflows/failure-code-controls.ts");
const CONTROL_SOURCE = `
import { z } from "zod";
import { defineTaskContract } from "../models/task/task-contract.js";
import { taskId } from "../rules/identity/ids.js";
import { defineTask, taskFailer, type TaskCtxCommon } from "../workflow-kit/task.js";
import { TaskError as Failure } from "../workflow-kit/errors.js";
const contract = defineTaskContract({ id: taskId("workflow:guard/read"), title: "Guard", effect: "read",
  input: z.strictObject({}), output: z.strictObject({}), errorCodes: ["declared"],
  subject: { kind: "none", reason: "Synthetic guard control" }, scenarios: [], example: {},
  freshness: { defaultMaxAgeMs: 0 }, provenance: { default: "derived" } });
const alias = contract;
const otherContract = defineTaskContract({ ...contract, id: taskId("workflow:guard/other") });
const fail = taskFailer(contract);
export function accepted(code: "declared") { fail(code, "declared dynamic code"); }
export const task = defineTask(contract, { async run({ ctx }) {
  const { fail: reject } = ctx;
  return reject("declared", "destructured context fail");
} });
export function rejectedDynamic(code: "declared" | "undeclared") { fail(code, "bad union"); }
export function rejectedContext(code: "declared" | "undeclared") {
  return defineTask(contract, { async run({ ctx }) { const { fail: reject } = ctx; return reject(code, "bad context union"); } });
}
export function rejectedDirect() { throw new Failure(alias.id, "undeclared", "bad constructor"); }
export function acceptedDirect(code: "declared") { throw new Failure(alias.id, code, "good constructor"); }
export function rejectedAny(code: any) { fail(code, "any bypass"); }
export function rejectedUnknown(code: unknown) { fail(code, "unknown bypass"); }
export function rejectedString(code: string) { fail(code, "widened bypass"); }
export function rejectedCast(code: unknown) { fail(code as "declared", "cast bypass"); }
export function rejectedFactory() {
  taskFailer({ id: contract.id, errorCodes: ["undeclared"] as const })("undeclared", "forged factory");
}
export function rejectedContextCast() {
  return defineTask(contract, { async run({ ctx }) {
    return (ctx as TaskCtxCommon<readonly ["undeclared"]>).fail("undeclared", "forged context");
  } });
}
function helper(ctx: TaskCtxCommon<readonly ["declared"]>) { return ctx.fail("declared", "helper"); }
export const helperTask = defineTask(contract, { async run({ ctx }) { return helper(ctx); } });
export function rejectedUnowned(ctx: TaskCtxCommon<readonly ["declared"]>) { return ctx.fail("declared", "no owner"); }
export function rejectedHelper(ctx: TaskCtxCommon<readonly ["declared" | "undeclared"]>) { return ctx.fail("undeclared", "helper contract mismatch"); }
export const badHelperTask = defineTask(contract, { async run({ ctx }) { return rejectedHelper(ctx); } });
export function rejectedIdentity(id: typeof contract.id) { throw new Failure(id, "declared", "no contract"); }
export function rejectedForeignFactory() {
  return defineTask(contract, { async run() { return taskFailer(otherContract)("declared", "foreign factory"); } });
}
export function rejectedForeignConstructor() {
  return defineTask(contract, { async run() { throw new Failure(otherContract.id, "declared", "foreign constructor"); } });
}
export function acceptedOwnerAlias() {
  return defineTask(contract, { async run() { return taskFailer(alias)("declared", "same factory owner"); } });
}
export function acceptedConstructorAlias() {
  return defineTask(contract, { async run() { throw new Failure(alias.id, "declared", "same constructor owner"); } });
}
`;

function unwrapped(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

function canonicalSymbol(checker: ts.TypeChecker, node: ts.Node, name: string, owner: string, seen = new Set<ts.Symbol>()): boolean {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol === undefined || seen.has(symbol)) return false;
  seen.add(symbol);
  return symbol.name === name && symbol.declarations?.some(declaration =>
    resolve(declaration.getSourceFile().fileName) === resolve(REPO_ROOT, owner)) === true
    || symbol.declarations?.some(declaration => ts.isVariableDeclaration(declaration)
      && declaration.initializer !== undefined && canonicalSymbol(checker, unwrapped(declaration.initializer), name, owner, seen)) === true;
}

function sealedContract(checker: ts.TypeChecker, expression: ts.Expression, seen = new Set<ts.Symbol>()): ts.CallExpression | undefined {
  expression = unwrapped(expression);
  if (ts.isCallExpression(expression)) return canonicalSymbol(checker, expression.expression, "defineTaskContract", CONTRACT_OWNER)
    ? expression : undefined;
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const contract = sealedContract(checker, declaration.initializer, seen);
      if (contract !== undefined) return contract;
    }
  }
  return undefined;
}

function finiteCodes(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(finiteCodes) : type.isStringLiteral();
}

function factoryContract(checker: ts.TypeChecker, expression: ts.Expression, seen = new Set<ts.Symbol>()): ts.Expression | undefined {
  expression = unwrapped(expression);
  if (ts.isCallExpression(expression) && canonicalSymbol(checker, expression.expression, "taskFailer", TASK_OWNER)) return expression.arguments[0];
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const contract = factoryContract(checker, declaration.initializer, seen);
      if (contract !== undefined) return contract;
    }
  }
  return undefined;
}

function ownerContracts(node: ts.Node, checker: ts.TypeChecker, calls: readonly ts.CallExpression[], seen = new Set<ts.Node>()): readonly (ts.Expression | undefined)[] {
  if (seen.has(node)) return [];
  seen.add(node);
  let helper: ts.FunctionDeclaration | undefined;
  for (let ancestor: ts.Node | undefined = node.parent; ancestor !== undefined; ancestor = ancestor.parent) {
    if (ts.isCallExpression(ancestor) && canonicalSymbol(checker, ancestor.expression, "defineTask", TASK_OWNER)) {
      const contracts = ancestor.arguments.slice(0, 2).filter(argument => sealedContract(checker, argument));
      return contracts.length === 0 ? [undefined] : contracts;
    }
    if (helper === undefined && ts.isFunctionDeclaration(ancestor)) helper = ancestor;
  }
  if (helper === undefined) return [undefined];
  const callers = calls.filter(call => checker.getResolvedSignature(call)?.declaration === helper);
  return callers.length === 0 ? [undefined] : [...new Set(callers.flatMap(call => ownerContracts(call, checker, calls, seen)))];
}

function failureIssues(source: ts.SourceFile, checker: ts.TypeChecker, calls: readonly ts.CallExpression[], root: ts.Node = source): readonly string[] {
  const issues: string[] = [];
  const report = (node: ts.Node, reason: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    issues.push(`${relative(REPO_ROOT, source.fileName).replaceAll("\\", "/")}:${String(line + 1)}: ${reason}`);
  };
  const checkCode = (node: ts.Node, argument: ts.Expression | undefined, allowed: ts.Type | undefined) => {
    if (argument === undefined || allowed === undefined || !finiteCodes(allowed)) {
      report(node, "failure has no finite declared errorCodes");
      return;
    }
    const actual = checker.getTypeAtLocation(unwrapped(argument));
    if ((actual.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || !checker.isTypeAssignableTo(actual, allowed)) {
      report(node, `emitted code ${checker.typeToString(actual)} is outside declared ${checker.typeToString(allowed)}`);
    }
  };
  const contractCodes = (contract: ts.Expression): ts.Type | undefined => {
    const codes = checker.getTypeAtLocation(contract).getProperty("errorCodes");
    const declared = codes === undefined ? undefined : checker.getTypeOfSymbolAtLocation(codes, contract);
    return declared === undefined ? undefined : checker.getIndexTypeOfType(declared, ts.IndexKind.Number);
  };
  const matchesOwner = (node: ts.Node, contract: ts.Expression): boolean => {
    const identity = sealedContract(checker, contract);
    return ownerContracts(node, checker, calls).every(owner => owner === undefined
      || sealedContract(checker, owner) === identity);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      const declaration = signature?.declaration;
      if (declaration !== undefined && resolve(declaration.getSourceFile().fileName) === resolve(REPO_ROOT, TASK_OWNER)) {
        const contextFail = ts.isFunctionTypeNode(declaration) && ts.isPropertySignature(declaration.parent)
          && declaration.parent.name.getText() === "fail";
        const factoryFail = ts.isArrowFunction(declaration) && ts.isReturnStatement(declaration.parent)
          && ts.isBlock(declaration.parent.parent) && ts.isFunctionDeclaration(declaration.parent.parent.parent)
          && declaration.parent.parent.parent.name?.text === "taskFailer";
        if (contextFail || factoryFail) {
          const factory = factoryFail ? factoryContract(checker, node.expression) : undefined;
          const contracts = factoryFail ? (factory === undefined ? [] : [factory]) : ownerContracts(node, checker, calls);
          if (contracts.length === 0 || contracts.some(contract => contract === undefined || !sealedContract(checker, contract))) {
            report(node, "failure authority does not resolve to an owning sealed contract");
          } else if (factory !== undefined && !matchesOwner(node, factory)) {
            report(node, "failure authority differs from the owning task contract");
          } else {
            for (const contract of contracts) {
              if (contract !== undefined) checkCode(node, node.arguments[0], contractCodes(contract));
            }
          }
        }
      }
    }
    if (ts.isNewExpression(node) && canonicalSymbol(checker, node.expression, "TaskError", ERROR_OWNER)) {
      const identity = node.arguments?.[0];
      const contract = identity !== undefined && ts.isPropertyAccessExpression(unwrapped(identity))
        ? unwrapped(identity) : undefined;
      if (contract === undefined || !ts.isPropertyAccessExpression(contract) || contract.name.text !== "id"
        || !sealedContract(checker, contract.expression)) {
        report(node, "TaskError identity does not resolve to a sealed contract.id");
      } else {
        if (!matchesOwner(node, contract.expression)) report(node, "TaskError identity differs from the owning task contract");
        else checkCode(node, node.arguments?.[1], contractCodes(contract.expression));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return issues;
}

let audit: { program: ts.Program; checker: ts.TypeChecker; calls: readonly ts.CallExpression[] } | undefined;
function context() {
  if (audit !== undefined) return audit;
  const roots = [resolve(REPO_ROOT, "src/backend/app/registries/workflow-registry.ts"),
    ...walkFiles(resolve(REPO_ROOT, "src/workflows")), CONTROL_PATH];
  const program = createGuardProgram(roots, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true },
  new Map([[CONTROL_PATH, CONTROL_SOURCE]]));
  const calls: ts.CallExpression[] = [];
  for (const source of program.getSourceFiles()) {
    if (!relative(REPO_ROOT, source.fileName).replaceAll("\\", "/").startsWith("src/")) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  audit = { program, checker: program.getTypeChecker(), calls };
  return audit;
}

describe("workflow failure code declarations", () => {
  it("audits registered implementation imports and authored workflows against their task contracts", () => {
    const { program, checker, calls } = context();
    const authored = program.getSourceFiles().filter(source => {
      const path = relative(REPO_ROOT, source.fileName).replaceAll("\\", "/");
      return resolve(source.fileName) !== CONTROL_PATH && (path.startsWith("src/workflows/")
        || path.startsWith("src/backend/") && !path.startsWith("src/backend/runtime/"));
    });
    assert.ok(authored.some(source => source.fileName.replaceAll("\\", "/").endsWith("/systems/crm/tasks/read-onboarding-results.ts")));
    assert.deepEqual(authored.flatMap(source => failureIssues(source, checker, calls)), []);
  });

  it("accepts declared dynamic codes and aliases and rejects undeclared or widened emissions", () => {
    const { program, checker, calls } = context();
    const source = program.getSourceFile(CONTROL_PATH);
    assert.ok(source);
    const functions = source.statements.filter(ts.isFunctionDeclaration);
    for (const declaration of functions) {
      const name = declaration.name?.text;
      assert.ok(name);
      const issues = failureIssues(source, checker, calls, declaration);
      if (name.startsWith("accepted") || name === "helper") assert.deepEqual(issues, [], name);
      else assert.equal(issues.length, 1, `${name}: ${issues.join("; ")}`);
    }
    assert.equal(functions.length, 19);
    const issues = failureIssues(source, checker, calls);
    assert.equal(issues.length, 14, issues.join("\n"));
    assert.ok(issues.some(issue => issue.includes("undeclared")));
    assert.ok(issues.some(issue => issue.includes("sealed contract.id")));
  });
});
