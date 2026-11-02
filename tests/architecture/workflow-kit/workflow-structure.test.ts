import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

function assertWorkflowStructure(root: string): void {
  const workflows = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, "workflow.ts")));
  assert.ok(workflows.length > 0, "no workflow.ts folders found");
  for (const { name } of workflows) {
    const folder = join(root, name);
    assert.ok(existsSync(join(folder, "tasks")) && statSync(join(folder, "tasks")).isDirectory(), `${name} requires tasks/`);
    const steps = join(folder, "steps");
    assert.ok(existsSync(steps) && statSync(steps).isDirectory(), `${name} requires steps/`);
    assert.ok(readdirSync(steps, { withFileTypes: true }).some(entry => entry.isDirectory()
      && existsSync(join(steps, entry.name, "step.ts"))
      && statSync(join(steps, entry.name, "step.ts")).isFile()), `${name} requires at least one steps/<step>/step.ts`);
  }
}

function assertStepOwnership(path: string, text: string): void {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.namedBindings === undefined
      || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const binding of statement.importClause.namedBindings.elements) {
      imports.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
    }
  }
  let declarations = 0;
  const step = path.endsWith("/step.ts");
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const localName = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      const name = localName === undefined ? undefined : imports.get(localName) ?? localName;
      if (step) {
        assert.notEqual(name, "defineWorkflow", `${path}: step proofs must be derived, never hand-written defineWorkflow`);
        if (name === "defineStep") declarations += 1;
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "find") {
          assert.ok(!/\.steps\b/u.test(node.expression.expression.getText(source)), `${path}: no runtime step lookup`);
        }
      } else {
        assert.ok(!["task", "gate", "transaction", "parallel", "delegate", "group", "defineStepEntries", "defineWorkflowStep"].includes(name ?? ""),
          `${path}: step modules own wiring (${name})`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (step) assert.equal(declarations, 1, `${path}: requires exactly one defineStep declaration`);
}

describe("workflow-structure", () => {
  it("every workflow.ts folder has tasks/ and at least one steps/<step>/step.ts", () => {
    assertWorkflowStructure(join(REPO_ROOT, "src/workflows"));
  });

  it("step modules own wiring and proof declarations across registered and unregistered workflows", () => {
    const root = join(REPO_ROOT, "src/workflows");
    for (const workflow of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const folder = join(root, workflow.name);
      if (!existsSync(join(folder, "workflow.ts"))) continue;
      assertStepOwnership(`${workflow.name}/workflow.ts`, readFileSync(join(folder, "workflow.ts"), "utf8"));
      for (const step of readdirSync(join(folder, "steps"))) {
        const path = join(folder, "steps", step, "step.ts");
        assertStepOwnership(`${workflow.name}/steps/${step}/step.ts`, readFileSync(path, "utf8"));
      }
    }
  });

  it("rejects duplicated wiring, aliased hand-written proofs and runtime step lookup", () => {
    assert.doesNotThrow(() => assertStepOwnership("example/workflow.ts", "defineWorkflow({ steps: author => readStep.build(author) });"));
    assert.doesNotThrow(() => assertStepOwnership("example/steps/read/step.ts", "defineStep({ group, build, proof });"));
    assert.throws(() => assertStepOwnership("example/workflow.ts", "author.task(identity, [], bind);"), /step modules own wiring/u);
    assert.throws(() => assertStepOwnership("example/steps/read/step.ts", 'import { defineWorkflow as copied } from "kit"; copied({});'), /never hand-written/u);
    assert.throws(() => assertStepOwnership("example/steps/read/step.ts", "defineStep({}); parent.steps.find(matches);"), /no runtime step lookup/u);
    assert.throws(() => assertStepOwnership("example/steps/read/step.ts", "defineStep({}); defineStep({});"), /exactly one/u);
  });

  it("rejects missing tasks, missing steps, and an empty or malformed step folder", () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-structure-"));
    const workflow = join(root, "example");
    try {
      mkdirSync(workflow);
      writeFileSync(join(workflow, "workflow.ts"), "");
      assert.throws(() => assertWorkflowStructure(root), /requires tasks\//u);
      mkdirSync(join(workflow, "tasks"));
      assert.throws(() => assertWorkflowStructure(root), /requires steps\//u);
      mkdirSync(join(workflow, "steps"));
      assert.throws(() => assertWorkflowStructure(root), /requires at least one/u);
      mkdirSync(join(workflow, "steps", "read"));
      mkdirSync(join(workflow, "steps", "read", "step.ts"));
      assert.throws(() => assertWorkflowStructure(root), /requires at least one/u);
      rmSync(join(workflow, "steps", "read", "step.ts"), { recursive: true });
      writeFileSync(join(workflow, "steps", "read", "step.ts"), "");
      assert.doesNotThrow(() => assertWorkflowStructure(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
