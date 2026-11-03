import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function isRequestHandler(node: ts.Node): boolean {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if ((!ts.isArrowFunction(parent) && !ts.isFunctionExpression(parent)) || !ts.isCallExpression(parent.parent)) continue;
    const call = parent.parent;
    if (ts.isPropertyAccessExpression(call.expression) && /^(?:get|post|put|patch|delete|use|onError)$/u.test(call.expression.name.text)) return true;
  }
  return false;
}

function silentRequestCatches(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    const handler = ts.isCatchClause(node) ? node.block : ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "catch" ? node.arguments[0] : undefined;
    if (handler !== undefined && isRequestHandler(node)) {
      const text = handler.getText(source);
      const emits = /\.(?:emit|error)\??\.?(?:\()/u.test(text);
      const propagates = /\bthrow\b|\bpopulationFailure\(/u.test(text);
      const responds = /\.json\(/u.test(text) && /\b(?:failure|wireError)\(|state:\s*["'](?:error|failed|refused|rejected|unknown|uncertain|unavailable)["']/u.test(text);
      const retained = /current\.loggingFailure\s*=\s*\{\s*cause:/u.test(text)
        && /if \(current\.loggingFailure !== undefined\) return c\.json\(wireError\("LOGGING_UNAVAILABLE"/u.test(source.text);
      if (!emits && !propagates && !responds && !retained) violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

describe("terminal failures remain observable", () => {
  it("refuses catches that turn a request failure into silence or success", () => {
    for (const body of ["return undefined;", "return c.json({ state: 'applied' });", "return [];", ""]) {
      assert.equal(silentRequestCatches("src/bad.ts", `app.get('/bad', async c => { try { await work(); } catch { ${body} } });`).length, 1);
    }
    assert.deepEqual(silentRequestCatches("src/good.ts", "app.get('/good', async c => { try { await work(); } catch { return c.json({state:'refused',code:'CLOSED'}); } });"), []);
  });
  it("audits every request catch and observes returned and thrown failures before registering routes", () => {
    const files = gitVisibleFiles(["src/backend/transports/http/routes"]).filter(path => path.endsWith(".ts"));
    assert.ok(files.length > 20);
    assert.deepEqual(files.flatMap(path => silentRequestCatches(path, read(path))), []);
    const api = read("src/backend/transports/http/routes/api.ts");
    assert.ok(api.includes("registerDebugResponses(app, debugEvents)"));
    assert.ok(api.indexOf("registerDebugResponses(app, debugEvents)") < api.indexOf('app.use("*"'));
    assert.match(read("src/backend/transports/http/routes/debug-responses.ts"), /debugFailureOutcomes\(body, c.res.status\)[\s\S]*writer.emit/u);
  });
  it("requires retained asynchronous logging faults to surface at readback", () => {
    const source = 'app.post("/auth", c => { try { record(); } catch (error) { current.loggingFailure = { cause: error }; } if (current.loggingFailure !== undefined) return c.json(wireError("LOGGING_UNAVAILABLE", "unavailable", false), 500); });';
    assert.deepEqual(silentRequestCatches("src/retained.ts", source), []);
    assert.equal(silentRequestCatches("src/retained.ts", source.replace("current.loggingFailure !== undefined", "current.other !== undefined")).length, 1);
  });
  it("requires durable sinks at worker, provider and asynchronous authorization boundaries", () => {
    const requirements = [
      ["src/backend/app/composition/dashboard/compose.ts", /const reportSupervisorFault[\s\S]*?debugEvents.emit\(event\)/u],
      ["src/backend/app/composition/dashboard/compose.ts", /const reportDashboardTransferFault[\s\S]*?debugEvents.emit\(event\)/u],
      ["src/backend/app/composition/worker-compose.ts", /catch \(error\) \{\s*runtimeError = error;\s*try \{\s*debugEvents.emit/u],
      ["src/backend/app/composition/worker-compose.ts", /debugEvents,\s*taskNotes/u],
      ["src/backend/runtime/workers/worker-loop.ts", /debugEvents: deps.debugEvents/u],
      ["src/backend/runtime/workers/worker-loop.ts", /onFailure: failure => deps.debugEvents\?\.emit/u],
      ["src/backend/runtime/execution/run-executor.ts", /observe: event => \{[\s\S]*?deps.debugEvents\?\.emit/u],
      ["src/backend/processing/providers/provider-client.ts", /return publish\(await Promise.race/u],
      ["src/backend/transports/http/routes/chatgpt-account.ts", /\.catch\(error => \{[\s\S]*?deps.debugEvents\?\.emit/u],
    ] as const;
    for (const [path, pattern] of requirements) {
      const source = read(path);
      assert.match(source, pattern, path);
      assert.doesNotMatch(source.replaceAll(/\b(?:debugEvents|publish)\b/gu, "droppedFailure"), pattern, `${path} mutation control`);
    }
  });
});
