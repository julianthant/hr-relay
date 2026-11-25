import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { createGuardProgram } from "../../support/helpers/caching-compiler-host.js";
import { REPO_ROOT, repoRelative, walkFiles } from "../support/helpers/guard-files.js";

const reviewed = new Map([
  ["src/backend/app/composition/dashboard/timeline.ts#timelineTimer", "Checks timeline and worker change-log revisions."],
  ["src/backend/app/composition/dashboard/timeline.ts#diagnosticRetentionTimer", "Enforces daily diagnostic and timeline retention."],
  ["src/backend/app/composition/dashboard/notifications.ts#timer", "Checks notification source revisions and storage health deadlines."],
  ["src/backend/runtime/settings/settings-runtime.ts#timer", "Checks settings and run activity revisions for keep-awake."],
  ["src/backend/app/composition/dashboard/assistant.ts#timer", "Reclaims expired conversation history."],
  ["src/backend/storage/maintenance/session-backups.ts#start", "Checks whether the authority generation needs a session backup."],
  ["src/backend/runs/lifecycle/application-lifecycle.ts#observeQuit", "Waits for run custody to settle after the operator requests quit."],
  ["src/backend/logs/loop-delay.ts#timer", "Samples the event-loop delay histogram."],
  ["src/backend/processing/providers/nominatim-owner.ts#wait", "Waits for the provider's rate-limit slot."],
  ["src/backend/processing/providers/nominatim-owner.ts#stop", "Waits for the provider queue to drain during shutdown."],
  ["src/backend/runtime/browser/onboarding-duo-provider.ts#waitForManualUcsdSignIn", "Waits for the Duo sign-in page within its deadline."],
  ["src/backend/runtime/browser/onboarding-duo-provider.ts#enrollCopy", "Waits for the Duo key-enrollment receipt."],
  ["src/backend/systems/browser-shared/ucsd-sso.ts#observeDuoTerminalRefusal", "Watches browser frames during the admitted Duo wait."],
  ["src/backend/systems/kuali/driver/interpreter.ts#lookupActionList", "Waits for the Kuali Action List to render the filtered links."],
  ["src/backend/systems/new-kronos/driver/interpreter.ts#tick", "Spaces bounded New Kronos UI probes."],
  ["src/backend/systems/new-kronos/session.ts#verifyNewKronosAuthenticatedApplication", "Waits for evidence that the New Kronos landing is complete."],
]);

type TimerKind = "setInterval" | "setTimeout";

function timerName(name: string | undefined): TimerKind | undefined {
  return name === "setInterval" || name === "setTimeout" ? name : undefined;
}

function timersModule(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) && /^(?:node:)?timers(?:\/promises)?$/u.test(node.text);
}

function registrationKind(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): TimerKind | undefined {
  if (seen.has(expression)) return undefined;
  seen.add(expression);
  if (ts.isIdentifier(expression)) {
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
      ?? checker.getSymbolAtLocation(expression)?.declarations?.[0];
    if (declaration === undefined) return timerName(expression.text);
    if (ts.isImportSpecifier(declaration) && timersModule(declaration.parent.parent.parent.moduleSpecifier)) {
      return timerName((declaration.propertyName ?? declaration.name).text);
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      return registrationKind(declaration.initializer, checker, seen);
    }
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const member = ts.isPropertyAccessExpression(expression) ? expression.name : expression.argumentExpression;
    if (!ts.isIdentifier(member) && !ts.isStringLiteral(member)) return undefined;
    const receiver = expression.expression;
    if (ts.isIdentifier(receiver)) {
      const binding = checker.getSymbolAtLocation(receiver)?.declarations?.[0];
      if (["globalThis", "global", "window"].includes(receiver.text)
        || binding !== undefined && ts.isNamespaceImport(binding) && timersModule(binding.parent.parent.moduleSpecifier)) {
        return timerName(member.text);
      }
    }
  }
  return undefined;
}

function timerSite(call: ts.CallExpression): string {
  for (let node: ts.Node | undefined = call.parent; node !== undefined; node = node.parent) {
    if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      if (node.name !== undefined) return node.name.getText();
    }
  }
  return "<module>";
}

function isLoop(node: ts.Node): boolean {
  return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node);
}

function walkExecution(entry: ts.Node, checker: ts.TypeChecker, onCall: (call: ts.CallExpression) => void): void {
  const seen = new Set<ts.Node>();
  const followed = new Set<ts.Expression>();
  const follow = (expression: ts.Expression): void => {
    if (followed.has(expression)) return;
    followed.add(expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      visit(expression.body);
      return;
    }
    const reference = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
    const declaration = checker.getSymbolAtLocation(reference)?.valueDeclaration;
    if (declaration !== undefined && declaration.getSourceFile() === entry.getSourceFile()) {
      if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body !== undefined) {
        visit(declaration.body);
      } else if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        follow(declaration.initializer);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) follow(node);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      onCall(node);
      follow(node.expression);
      for (const argument of node.arguments) follow(argument);
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isIdentifier(entry) || ts.isPropertyAccessExpression(entry)) follow(entry);
  else visit(entry);
}

function timeoutHandle(call: ts.CallExpression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const owner = call.parent;
  if (ts.isVariableDeclaration(owner) && owner.initializer === call) return checker.getSymbolAtLocation(owner.name);
  if (ts.isBinaryExpression(owner) && owner.operatorToken.kind === ts.SyntaxKind.EqualsToken && owner.right === call) {
    return checker.getSymbolAtLocation(owner.left);
  }
  return undefined;
}

function assertReviewedTimers(overlay: ReadonlyMap<string, string> = new Map()): void {
  const files = walkFiles(join(REPO_ROOT, "src/backend"))
    .filter(path => /\bset(?:Interval|Timeout)\b/u.test(overlay.get(path) ?? readFileSync(path, "utf8")));
  const program = createGuardProgram(files, { noResolve: true, noLib: true, types: [] }, overlay);
  const checker = program.getTypeChecker();
  const remaining = new Map(reviewed);
  const unreviewed: string[] = [];
  for (const path of files) {
    const source = program.getSourceFile(path);
    assert.ok(source, `Missing source for ${repoRelative(path)}`);
    const intervals: ts.CallExpression[] = [];
    const timeouts: ts.CallExpression[] = [];
    const loops: ts.Node[] = [];
    function collect(node: ts.Node): void {
      if (isLoop(node)) loops.push(node);
      if (ts.isCallExpression(node)) {
        const kind = registrationKind(node.expression, checker);
        if (kind === "setInterval") intervals.push(node);
        if (kind === "setTimeout") timeouts.push(node);
      }
      ts.forEachChild(node, collect);
    }
    collect(source);

    const repeated = new Set<ts.CallExpression>();
    const timeoutSites = new Set(timeouts);
    for (const loop of loops) {
      walkExecution(loop, checker, call => { if (timeoutSites.has(call)) repeated.add(call); });
    }
    for (const timeout of timeouts) {
      const callback = timeout.arguments[0];
      if (callback === undefined) continue;
      const handle = timeoutHandle(timeout, checker);
      walkExecution(callback, checker, call => {
        const target = call.expression;
        if (call === timeout || (handle !== undefined && ts.isPropertyAccessExpression(target)
          && target.name.text === "refresh" && checker.getSymbolAtLocation(target.expression) === handle)) {
          repeated.add(timeout);
        }
      });
    }
    for (const call of [...intervals, ...repeated]) {
      const site = `${repoRelative(path)}#${timerSite(call)}`;
      if (remaining.delete(site)) continue;
      const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
      unreviewed.push(`${site}:${String(line)} unreviewed recurring ${timeoutSites.has(call) ? "setTimeout" : "setInterval"}`);
    }
  }
  const violations = [...unreviewed, ...Array.from(remaining.keys(), site => `${site} reviewed timer no longer found`)];
  assert.ok(violations.length === 0, violations.join("\n"));
}

describe("backend store-reading timer boundary", () => {
  it("keeps recurring timer registrations at individually reviewed sites", () => {
    assertReviewedTimers();
  });

  it("reports planted store-reading intervals and repeating timeouts on a scratch overlay", () => {
    const file = "src/backend/app/composition/dashboard/timeline.ts";
    const path = join(REPO_ROOT, file);
    const candidate = `${readFileSync(path, "utf8")}
      export function plantedTimers(database: AuthorityDatabase) {
        const plantedInterval = setInterval(() => database.authority.timelineEvents.highWaterMark(), 1_000);
        const arm = () => setTimeout(() => tick(), 1_000);
        function tick() {
          database.authority.timelineEvents.highWaterMark();
          arm();
        }
        setTimeout(tick, 0);
        const refreshed = setTimeout(() => {
          database.authority.timelineEvents.highWaterMark();
          refreshed.refresh();
        }, 1_000);
        return plantedInterval;
      }
`;
    assert.throws(() => assertReviewedTimers(new Map([[path, candidate]])), (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError);
      const escapedPath = file.replaceAll(".", "\\.");
      const expected = new RegExp([
        `^${escapedPath}#plantedInterval:\\d+ unreviewed recurring setInterval`,
        `${escapedPath}#arm:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#refreshed:\\d+ unreviewed recurring setTimeout$`,
      ].join("\\n"), "u");
      assert.match(error.message, expected);
      process.stdout.write(`${error.message}\n`);
      return true;
    });
  });
});
