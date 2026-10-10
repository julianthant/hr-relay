
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


const FORWARDING_LAYERS = new Set([
  "src/dashboard/client/index.ts",
  "src/dashboard/surfaces/run-start/run-launch-model.ts",
]);

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

  it("every dashboard module folds at least as many commands as it posts", () => {
    const offenders = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !EXEMPT.has(path) && !FORWARDING_LAYERS.has(path))
      .filter((path) => foldsFewerCommandsThanItPosts(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("proves admitted forwarding layers forward command execution and their callers settle them", () => {
    for (const path of FORWARDING_LAYERS) {
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      expect(canonicalDecision(path), `${path} must not decide settlement alone`).toBe(false);
      expect(
        /return\s+(await\s+)?(commands|client)\.executeCommand|:\s*\(input.*?\)\s*=>\s*client\.executeCommand/u.test(text),
        `${path} must return or forward executeCommand`,
      ).toBe(true);
    }
    const runLaunchCallers = sourceFiles(SCAN_ROOT)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !FORWARDING_LAYERS.has(path) && !EXEMPT.has(path))
      .filter((path) => {
        const text = readFileSync(join(REPO_ROOT, path), "utf8");
        return text.includes("createRunLaunchService") || text.includes("launchService.submit");
      });
    expect(runLaunchCallers.length).toBeGreaterThan(0);
    for (const callerPath of runLaunchCallers) {
      const text = readFileSync(join(REPO_ROOT, callerPath), "utf8");
      expect(text.includes("settleCommandResult"), `${callerPath} must consume forwarded command with settleCommandResult`).toBe(true);
    }
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

  it("the fold's own module is the only place the arms are enumerated for a verdict", () => {
    const fold = readFileSync(join(REPO_ROOT, "src/dashboard/app/commands/command-result.ts"), "utf8");
    for (const arm of ["applied", "already-applied", "conflict", "rejected"]) {
      expect(fold, `settleCommandResult must handle ${arm}`).toContain(`case "${arm}"`);
    }
  });
});
