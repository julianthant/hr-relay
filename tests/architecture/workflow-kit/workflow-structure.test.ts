import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("workflow-structure", () => {
  it("every workflow.ts folder has tasks/ and at least one steps/<step>/step.ts", () => {
    assertWorkflowStructure(join(REPO_ROOT, "src/workflows"));
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
