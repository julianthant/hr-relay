import ts from "typescript";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

function executionSource(): string {
  return [
    "run-executor.ts",
    "run-execution-contract.ts",
    "run-execution-outcome.ts",
    "run-execution-plan.ts",
    "run-execution-task.ts",
    "run-execution-walk.ts",
    "run-execution-write.ts",
  ].map(file => readFileSync(join(REPO_ROOT, "src/backend/runtime/execution", file), "utf8")).join("\n");
}

function deadlineInvocationIssues(content: string): readonly string[] {
  const source = ts.createSourceFile("run-executor.ts", content, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  let service = 0, browser = 0, retention = 0, retainedRace = 0;
  function calls(node: ts.Node, name: string): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    function visit(child: ts.Node): void { if (ts.isCallExpression(child) && child.expression.getText(source) === name) found.push(child); ts.forEachChild(child, visit); }
    visit(node); return found;
  }
  function checkRace(call: ts.CallExpression): boolean {
    return call.arguments.length === 4
      && call.arguments[1].getText(source) === "controller.signal"
      && call.arguments[2].getText(source) === "contract.id"
      && call.arguments[3].getText(source) === "retain";
  }
  function inspect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "retain") {
      retention += 1;
      const initializer = node.initializer;
      const hook = initializer === undefined ? [] : calls(initializer, "deps.retainCallback");
      const identity = hook[0]?.arguments[0];
      const expectedIdentity = new Map([
        ["runId", "runId"], ["claimGeneration", "claim.claimGeneration"], ["attempt", "envelope.attempt"],
      ]);
      const boundIdentity = identity !== undefined && ts.isObjectLiteralExpression(identity)
        && identity.properties.length === expectedIdentity.size && identity.properties.every((property) => {
          if (ts.isShorthandPropertyAssignment(property)) return expectedIdentity.get(property.name.text) === property.name.text;
          return ts.isPropertyAssignment(property)
            && expectedIdentity.get(property.name.getText(source)) === property.initializer.getText(source);
        });
      if (initializer === undefined || !ts.isConditionalExpression(initializer)
        || initializer.condition.getText(source) !== "deps.retainCallback === undefined"
        || initializer.whenTrue.getText(source) !== "undefined"
        || !ts.isArrowFunction(initializer.whenFalse)
        || hook.length !== 1 || !boundIdentity || hook[0]?.arguments[1]?.getText(source) !== "operation") {
        issues.push("retention must bind the pending operation to its run, claim and attempt");
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "raceAbortable") {
      retainedRace += 1;
      const hooks = calls(node, "retain");
      if (hooks.length !== 1 || hooks[0].arguments.length !== 1
        || hooks[0].arguments[0].getText(source) !== "operation") issues.push("abort races must retain their operation");
    }
    if (ts.isIfStatement(node) && node.expression.getText(source) === "need === undefined" && node.elseStatement !== undefined) {
      service += 1; browser += 1;
      const pure = calls(node.thenStatement, "raceAbortable"), leased = calls(node.elseStatement, "raceAbortable");
      if (pure.length !== 1 || !pure.every(checkRace) || leased.length !== 2 || !leased.every(checkRace)) issues.push("service and browser invocation races must use the armed controller");
      if (calls(node.thenStatement, "run").length !== 1 || calls(node.elseStatement, "run").length !== 1) issues.push("each race arm must invoke exactly one task");
      const lease = calls(node.elseStatement, "deps.sessions.withDriver");
      if (lease.length !== 1 || lease[0].arguments[2]?.getText(source) !== "controller.signal") issues.push("browser lease acquisition must use the armed signal");
      for (const arm of [node.thenStatement, node.elseStatement]) {
        if (!arm.getText(source).includes("withBrowserActionNotes")) issues.push("invocations must preserve the notes wrapper");
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  if (service !== 1 || browser !== 1) issues.push("exact service/browser invocation topology is absent or duplicated");
  if (retention !== 1 || retainedRace !== 1) issues.push("exact callback retention topology is absent or duplicated");
  return issues;
}

describe("bounded task deadline", () => {
  it("keeps the deadline mandatory and racing on every invocation path", () => {
    const source = executionSource();
    assert.ok(/readonly taskDeadlineMs: number;/.test(source), "taskDeadlineMs must be a required dependency");
    assert.ok(!/taskDeadlineMs\s*\?\?/.test(source), "taskDeadlineMs must have no defaulting fallback");
    assert.ok(
      /z\.number\(\)\.int\(\)\.positive\(\)\.parse\(deps\.taskDeadlineMs\)/.test(source),
      "the executor must validate the bound before any node runs",
    );
    // Both invocation arms (pure/service and browser-leased) go through the
    // abort race against the deadline-armed controller signal.
    assert.deepEqual(deadlineInvocationIssues(source), []);
    assert.ok(
      /deps\.scheduler\.schedule\(\s*clock\.monotonicMs\(\) \+ deps\.taskDeadlineMs/.test(source),
      "the deadline must be armed on the injected monotonic scheduler",
    );
  });

  it("rejects missing task races and ignored lease or task signals inside notes wrappers", () => {
    const source = executionSource();
    for (const bad of [
      source.replace("() => raceAbortable(", "() => unbounded("),
      source.replace("deps.sessions.withDriver(need, instanceSelection, controller.signal", "deps.sessions.withDriver(need, instanceSelection, unrelated.signal"),
      source.replace("controller.signal, contract.id,", "unrelated.signal, contract.id,"),
      source.replace("withBrowserActionNotes(clock", "otherNotes(clock"),
      source.replace("controller.signal, contract.id, retain,", "controller.signal, contract.id,"),
      source.replace("controller.signal, contract.id, retain,", "controller.signal, contract.id, unrelated,"),
      source.replace("deps.retainCallback?.({ runId,", "deps.otherCallback?.({ runId,"),
      source.replace("claimGeneration: claim.claimGeneration, attempt: envelope.attempt }, operation", "claimGeneration: 1, attempt: envelope.attempt }, operation"),
      source.replace("retain?.(operation)", "retain?.(Promise.resolve())"),
    ]) {
      assert.notEqual(bad, source, "the violating mutation must change executable source");
      assert.ok(deadlineInvocationIssues(bad).length > 0);
    }
  });
});
