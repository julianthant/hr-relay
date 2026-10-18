import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultRerunSteps, initialRerunValueDrafts } from "../../../../src/dashboard/surfaces/run-start/run-start-rerun-model.js";
import { RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const workflow: RunStartWorkflow = {
  workflowId: "rerun-proof", version: 1, label: "Rerun proof", categoryId: "operations", role: { kind: "standalone" },
  enqueue: "reject-active", spreadsheetIntake: false,
  inputRun: { state: "present", surface: { placeholder: "Employee ID", parser: {
    split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }],
  } } },
  steps: [
    { key: "read", label: "Read", includedByDefault: true, control: { state: "omittable", form: { fields: [] }, forces: [] } },
    { key: "finish", label: "Finish", includedByDefault: true, control: { state: "required", reason: "Required" } },
  ],
};
const snapshot = RerunValuesSnapshotSchema.parse({
  workers: "auto", sourceInput: { state: "available", value: { eid: "10812345" } },
  source: { runId: "10000000-0000-4000-8000-000000000001", version: 3, workflow: "rerun-proof",
    descriptorVersion: 1, contractFingerprint: "a".repeat(64), outcome: "failed" },
  steps: [{ key: "read", state: "completed", nodes: [{ nodeId: "read", state: "completed", reason: "checkpoint" }] },
    { key: "finish", state: "failed", nodes: [{ nodeId: "finish", state: "failed", reason: "failure" }] }],
  values: [], transactions: [],
});

describe("Rerun current-step defaults", () => {
  it("refuses a different workflow instead of selecting its steps", () => {
    assert.throws(() => defaultRerunSteps(snapshot, { ...workflow, workflowId: "other-workflow" }),
      /response|validation|invalid|understand|expected/iu);
  });
  it("preserves completed-step preselection for the same descriptor", () => {
    assert.deepEqual(defaultRerunSteps(snapshot, workflow), ["finish"]);
  });
  it("selects every current step when the descriptor version changed", () => {
    assert.deepEqual(defaultRerunSteps(snapshot, { ...workflow, version: 2 }), ["read", "finish"]);
  });
  it("selects every current step when the step structure changed", () => {
    const current = { ...workflow, steps: workflow.steps.map(step => step.key === "read" ? { ...step, key: "current-read" } : step) };
    assert.deepEqual(defaultRerunSteps(snapshot, current), ["current-read", "finish"]);
  });
  it("never copies a candidate the current input rejected", () => {
    const rejected = RerunValuesSnapshotSchema.parse({ ...snapshot, values: [{ state: "unavailable", reason: "target-invalid",
      sourceStepKey: "read", nodeId: "read", fieldPath: "eid", targetFieldPath: "eid", label: "Employee ID" }] });
    assert.deepEqual(initialRerunValueDrafts(rejected, workflow), {});
  });
});
