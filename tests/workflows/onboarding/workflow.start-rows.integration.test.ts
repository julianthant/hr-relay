import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { StartStepOmissionRefusedError, projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire, startStepWireControl } from "../../../src/backend/runs/start/step-selection.js";
import { startRowsOf } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";

const descriptor = WORKFLOW_MODULES.find(({ descriptor: candidate }) => String(candidate.id) === "onboarding")!.descriptor;

describe("Onboarding Start run rows", () => {
  it("serves every row as a switch with manual values for reads and no fields for form actions", () => {
    const rows = projectStartRows(descriptor);
    assert.deepEqual(rows.map(({ key, label }) => [key, label]), [
      ["crm-data", "Read entry sheet"],
      ["ucpath-search", "Match existing person"],
      ["i9-search", "Search I-9 profiles"],
      ["hire-review", "Review hire findings"],
      ["reference-check", "Check reference spreadsheets"],
      ["i9-creation", "Create I-9 profile"],
      ["ucpath-hire", "Submit hire"],
      ["master-results", "Fill master results"],
    ]);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.kind, "switch", row.key);
      assert.equal(row.lockReason, undefined, row.key);
      assert.ok(row.target && row.manual, row.key);
      assert.equal(row.off, index < 5 ? "values" : "manual", row.key);
      assert.equal(row.manual.form.fields.length > 0, row.off === "values", row.key);
    }
  });

  it("shows which dependent actions also skip when the required I-9 lookup is entered by hand", () => {
    const rows = startRowsOf({
      rows: projectStartRows(descriptor).map(startRowWire),
      steps: projectStartSteps(descriptor).map(step => ({ ...step, control: startStepWireControl(step.control) })),
    });
    assert.equal(rows.find(row => row.key === "i9-search")?.note,
      "Also skips: Review hire findings, Check reference spreadsheets, Create I-9 profile, Submit hire, Fill master results");
    assert.deepEqual(rows.find(row => row.key === "crm-data")?.forces, []);
  });

  it("refuses turning off a read without valid manual values", () => {
    const keys = projectStartSteps(descriptor).map(({ key }) => key);
    const step = "crm-data";
    assert.throws(() => resolveStartStepOmissions(descriptor, keys.filter(key => key !== step), [{ step, facts: {} }]),
      (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid");
  });

  it("plans nothing new and keeps today's node list", () => {
    assert.equal(resolveStartStepOmissions(descriptor, projectStartSteps(descriptor).map(({ key }) => key), undefined), undefined);
    const nodes = descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node.kind, node.dependsOn.map(String), "dryRun" in node ? node.dryRun ?? null : null]);
    assert.deepEqual(nodes.find(([id]) => id === "reference-check")?.[2], ["hire-plan", "hire-subject", "hire-review"]);
    assert.equal(createHash("sha256").update(JSON.stringify(nodes)).digest("hex"), "5b266b94ba8f6729841e17b828b9be64a03009bb84c96053812559b31c2e53cc");
  });
});
