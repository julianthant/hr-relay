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
  ["src/backend/runtime/workers/worker-loop.ts#tick", "Renews the active worker claim while its run is in progress."],
  ["src/backend/runtime/workers/worker-loop.ts#observeWork", "Checks the active run for pause and cancellation requests."],
  ["src/backend/runtime/workers/worker-loop.ts#handle", "Spaces worker claim attempts while the worker is idle or backing off."],
  ["src/backend/runtime/workers/worker-loop.ts#startHeartbeat", "Arms the initial claim heartbeat for each claimed run."],
  ["src/backend/transports/http/subscriptions/dashboard-stream.ts#cancel", "Retries synchronous row reads while subscribers are owed a value."],
  ["src/backend/transports/http/subscriptions/dashboard-stream.ts#cancelTimer", "Retries run-panel reads after a retryable failure."],
  ["src/backend/app/composition/dashboard/assistant.ts#timer", "Reclaims expired conversation history."],
  ["src/backend/storage/maintenance/session-backups.ts#start", "Checks whether the authority generation needs a session backup."],
  ["src/backend/runs/lifecycle/application-lifecycle.ts#observeQuit", "Waits for run custody to settle after the operator requests quit."],
  ["src/backend/logs/loop-delay.ts#timer", "Samples the event-loop delay histogram."],
  ["src/backend/processing/providers/nominatim-owner.ts#wait", "Waits for the provider's rate-limit slot."],
  ["src/backend/processing/providers/nominatim-owner.ts#stop", "Waits for the provider queue to drain during shutdown."],
  ["src/backend/runtime/browser/onboarding-duo-provider.ts#timedOut", "Bounds each Duo screen capture used by the browser observation loop."],
  ["src/backend/runtime/browser/onboarding-duo-provider.ts#close", "Bounds the memoized Duo session close reached from the browser poll."],
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

function declarationOf(expression: ts.Expression, checker: ts.TypeChecker): ts.Declaration | undefined {
  const reference = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  const symbol = checker.getSymbolAtLocation(reference);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function isGlobalReceiver(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && ["globalThis", "global", "window"].includes(expression.text);
}

function registrationKind(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): TimerKind | undefined {
  if (seen.has(expression)) return undefined;
  seen.add(expression);
  if (ts.isIdentifier(expression)) {
    const declaration = declarationOf(expression, checker);
    if (declaration === undefined) return timerName(expression.text);
    if (ts.isImportSpecifier(declaration) && timersModule(declaration.parent.parent.parent.moduleSpecifier)) {
      return timerName((declaration.propertyName ?? declaration.name).text);
    }
    if ((ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) && declaration.initializer !== undefined) {
      return registrationKind(declaration.initializer, checker, seen);
    }
    if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)
      && ts.isVariableDeclaration(declaration.parent.parent)) {
      const initializer = declaration.parent.parent.initializer;
      const member = declaration.propertyName ?? declaration.name;
      if (initializer !== undefined && isGlobalReceiver(initializer) && ts.isIdentifier(member)) return timerName(member.text);
    }
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const member = ts.isPropertyAccessExpression(expression) ? expression.name : expression.argumentExpression;
    if (!ts.isIdentifier(member) && !ts.isStringLiteral(member)) return undefined;
    const receiver = expression.expression;
    if (ts.isIdentifier(receiver)) {
      const binding = checker.getSymbolAtLocation(receiver)?.declarations?.[0];
      if (isGlobalReceiver(receiver)
        || binding !== undefined && (
          ts.isNamespaceImport(binding) && timersModule(binding.parent.parent.moduleSpecifier)
          || ts.isImportClause(binding) && timersModule(binding.parent.moduleSpecifier)
        )) {
        return timerName(member.text);
      }
    }
  }
  return undefined;
}

function timerSite(call: ts.CallExpression): string {
  for (let node: ts.Node | undefined = call.parent; node !== undefined; node = node.parent) {
    if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
      if (node.name !== undefined) return node.name.getText();
    }
  }
  return "<module>";
}

function isLoop(node: ts.Node): boolean {
  return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node);
}

function forwardingParameter(call: ts.CallExpression, checker: ts.TypeChecker): ts.ParameterDeclaration | undefined {
  const callback = call.arguments[0];
  const parameter = callback === undefined ? undefined : declarationOf(callback, checker);
  if (parameter === undefined || !ts.isParameter(parameter)) return undefined;
  const wrapper = parameter.parent;
  if (!ts.isFunctionDeclaration(wrapper) && !ts.isMethodDeclaration(wrapper)
    && !(ts.isArrowFunction(wrapper) && (ts.isVariableDeclaration(wrapper.parent)
      || ts.isPropertyAssignment(wrapper.parent) || ts.isPropertyDeclaration(wrapper.parent)))) return undefined;
  for (let node: ts.Node = call.parent; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isFunctionLike(node)) return node === wrapper ? parameter : undefined;
  }
  return undefined;
}

function callable(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Node>()): ts.FunctionLikeDeclaration | undefined {
  if (seen.has(expression)) return undefined;
  seen.add(expression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === "bind") return callable(expression.expression.expression, checker, seen);
  const declaration = declarationOf(expression, checker);
  if (declaration === undefined || declaration.getSourceFile() !== expression.getSourceFile()) return undefined;
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
  if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration))
    && declaration.initializer !== undefined) return callable(declaration.initializer, checker, seen);
  return undefined;
}

function walkExecution(
  entry: ts.Node,
  checker: ts.TypeChecker,
  onCall: (call: ts.CallExpression) => void,
  onFollow?: (fn: ts.FunctionLikeDeclaration) => void,
): void {
  const seen = new Set<ts.Node>();
  const followed = new Set<ts.Expression>();
  const follow = (expression: ts.Expression): void => {
    if (followed.has(expression)) return;
    followed.add(expression);
    const fn = callable(expression, checker);
    if (fn?.body !== undefined) {
      onFollow?.(fn);
      visit(fn.body);
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
  if (ts.isIdentifier(entry) || ts.isPropertyAccessExpression(entry) || ts.isCallExpression(entry)) follow(entry);
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

function findRepeatedTimeouts(
  timeouts: ReadonlyMap<ts.CallExpression, number>,
  loops: readonly ts.Node[],
  checker: ts.TypeChecker,
): ReadonlySet<ts.CallExpression> {
  const repeated = new Set<ts.CallExpression>();
  for (const loop of loops) {
    walkExecution(loop, checker, call => { if (timeouts.has(call)) repeated.add(call); });
  }
  const recursion = new Map<ts.Node, ReadonlySet<ts.CallExpression>>();
  for (const [timeout, callbackIndex] of timeouts) {
    const callback = timeout.arguments[callbackIndex];
    const handle = timeoutHandle(timeout, checker);
    if (callback !== undefined) {
      walkExecution(callback, checker, call => {
        const target = call.expression;
        if (call === timeout || (handle !== undefined && ts.isPropertyAccessExpression(target)
          && target.name.text === "refresh" && checker.getSymbolAtLocation(target.expression) === handle)) {
          repeated.add(timeout);
        }
      });
    }
    if (repeated.has(timeout)) continue;
    for (let node: ts.Node | undefined = timeout.parent; node !== undefined; node = node.parent) {
      if (!ts.isFunctionLike(node) || !("body" in node) || node.body === undefined) continue;
      if (!recursion.has(node)) {
        const reached = new Set<ts.CallExpression>();
        let recursive = false;
        walkExecution(node.body, checker, call => { if (timeouts.has(call)) reached.add(call); }, fn => {
          if (fn === node) recursive = true;
        });
        recursion.set(node, recursive ? reached : new Set());
      }
      if (recursion.get(node)?.has(timeout)) {
        repeated.add(timeout);
        break;
      }
    }
  }
  return repeated;
}

function assertReviewedTimers(overlay: ReadonlyMap<string, string> = new Map()): void {
  const files = walkFiles(join(REPO_ROOT, "src/backend"))
    .filter(path => /\b(?:setInterval|setTimeout|schedule|MonotonicDeadlineScheduler)\b/u.test(overlay.get(path) ?? readFileSync(path, "utf8")));
  const program = createGuardProgram(files, {
    noResolve: true, noLib: true, types: [], moduleResolution: ts.ModuleResolutionKind.Node10,
  }, overlay);
  const checker = program.getTypeChecker();
  const scheduler = program.getSourceFile(join(REPO_ROOT, "src/backend/runtime/scheduling/deadline-scheduler.ts"));
  assert.ok(scheduler, "Missing MonotonicDeadlineScheduler source");
  const remaining = new Map(reviewed);
  const unreviewed: string[] = [];
  for (const path of files) {
    const source = program.getSourceFile(path);
    assert.ok(source, `Missing source for ${repoRelative(path)}`);
    const calls: ts.CallExpression[] = [];
    const intervals: ts.CallExpression[] = [];
    const timeouts = new Map<ts.CallExpression, number>();
    const forwarders = new Map<ts.Node, number>();
    const injected = new Map<ts.Declaration, ts.Expression>();
    const loops: ts.Node[] = [];
    function collect(node: ts.Node): void {
      if (isLoop(node)) loops.push(node);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword
        && ts.isBinaryExpression(node.right) && node.right.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        const property = declarationOf(node.left, checker);
        if (property !== undefined) injected.set(property, node.right.right);
      }
      if (ts.isCallExpression(node)) {
        calls.push(node);
        const kind = registrationKind(node.expression, checker);
        if (kind === "setInterval") intervals.push(node);
        if (kind === "setTimeout") {
          const parameter = forwardingParameter(node, checker);
          if (parameter !== undefined) {
            forwarders.set(parameter.parent, parameter.parent.parameters.indexOf(parameter));
          } else {
            timeouts.set(node, 0);
          }
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
    for (const call of calls) {
      const declaration = declarationOf(call.expression, checker);
      if (declaration !== undefined && ts.isMethodSignature(declaration)
        && declaration.getSourceFile() === scheduler && declaration.name.getText() === "schedule"
        && ts.isInterfaceDeclaration(declaration.parent)
        && declaration.parent.name.text === "MonotonicDeadlineScheduler") {
        timeouts.set(call, 1);
        continue;
      }
      const fallback = declaration === undefined ? undefined : injected.get(declaration);
      const wrapper = callable(fallback ?? call.expression, checker);
      const index = wrapper === undefined ? undefined : forwarders.get(wrapper);
      if (index !== undefined) timeouts.set(call, index);
    }

    const repeated = findRepeatedTimeouts(timeouts, loops, checker);
    for (const call of [...intervals, ...calls.filter(call => repeated.has(call))]) {
      const site = `${repoRelative(path)}#${timerSite(call)}`;
      if (remaining.delete(site)) continue;
      const line = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
      unreviewed.push(`${site}:${String(line)} unreviewed recurring ${timeouts.has(call) ? "setTimeout" : "setInterval"}`);
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

      export function plantedRearms(database: AuthorityDatabase) {
        const read = () => database.authority.timelineEvents.highWaterMark();
        function schedule(ms: number, task: () => void) { return setTimeout(task, ms); }
        function wrapped() {
          read();
          schedule(1, wrapped);
        }
        class ArrowTimer {
          tick = () => { read(); setTimeout(this.tick, 1); };
        }
        const propertyTimer = {
          fire: () => { read(); setTimeout(propertyTimer.fire, 1); },
        };
        class BoundTimer {
          tick() { read(); setTimeout(this.tick.bind(this), 1); }
        }
        async function awaited() {
          read();
          await new Promise<void>(resolve => setTimeout(resolve, 1));
          return awaited();
        }
        function chained() {
          read();
          return new Promise<void>(resolve => setTimeout(resolve, 1)).then(chained);
        }
        return { wrapped, ArrowTimer, propertyTimer, BoundTimer, awaited, chained };
      }

      import nodeTimers from "node:timers";
      export function plantedTimerAliases(database: AuthorityDatabase, every = setInterval) {
        const read = () => database.authority.timelineEvents.highWaterMark();
        const { setInterval: interval } = globalThis;
        const defaultImport = nodeTimers.setInterval(read, 1);
        const destructured = interval(read, 1);
        const defaultParameter = every(read, 1);
        return { defaultImport, destructured, defaultParameter };
      }
`;
    assert.throws(() => assertReviewedTimers(new Map([[path, candidate]])), (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError);
      const escapedPath = file.replaceAll(".", "\\.");
      const expected = new RegExp([
        `^${escapedPath}#plantedInterval:\\d+ unreviewed recurring setInterval`,
        `${escapedPath}#defaultImport:\\d+ unreviewed recurring setInterval`,
        `${escapedPath}#destructured:\\d+ unreviewed recurring setInterval`,
        `${escapedPath}#defaultParameter:\\d+ unreviewed recurring setInterval`,
        `${escapedPath}#arm:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#refreshed:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#wrapped:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#tick:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#fire:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#tick:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#awaited:\\d+ unreviewed recurring setTimeout`,
        `${escapedPath}#chained:\\d+ unreviewed recurring setTimeout$`,
      ].join("\\n"), "u");
      assert.match(error.message, expected);
      process.stdout.write(`${error.message}\n`);
      return true;
    });
  });
});
