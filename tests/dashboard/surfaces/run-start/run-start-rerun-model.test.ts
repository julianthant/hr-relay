import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultRerunSteps, initialRerunValueDrafts, plainRerunInputText, partialRerunTypedInput } from "../../../../src/dashboard/surfaces/run-start/run-start-rerun-model.js";
import { RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { WORK_STUDY_TYPED_INPUT } from "../../../../src/models/workflows/work-study/input.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const workflow: RunStartWorkflow = {
  workflowId: "rerun-proof", version: 1, label: "Rerun proof", categoryId: "operations", role: { kind: "standalone" },
  enqueue: "reject-active", spreadsheetIntake: false, requiredWorkbookFields: [], referenceSources: [],
  inputRun: { state: "present", surface: { placeholder: "Employee ID", parser: {
    split: { kind: "whole-text" }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "eid" }],
  } } },
  steps: [
    { key: "read", label: "Read", includedByDefault: true, control: { state: "omittable", form: { fields: [] }, forces: [] } },
    { key: "finish", label: "Finish", includedByDefault: true, control: { state: "required", reason: "Required" } },
  ],
};
const snapshot = RerunValuesSnapshotSchema.parse({
  sourceInput: { state: "available", value: { eid: "10812345" } },
  source: { runId: "10000000-0000-4000-8000-000000000001", version: 3, workflow: "rerun-proof",
    descriptorVersion: 1, contractFingerprint: "a".repeat(64), outcome: "failed" },
  steps: [{ key: "read", state: "completed", nodes: [{ nodeId: "read", state: "completed", reason: "checkpoint" }] },
    { key: "finish", state: "failed", nodes: [{ nodeId: "finish", state: "failed", reason: "failure" }] }],
  values: [], transactions: [],
});

describe("Rerun current-step defaults", () => {
  it("restores only the exact declared plain-parser identity from a safe partial input", () => {
    assert.ok(workflow.inputRun.state === "present");
    const surface = workflow.inputRun.surface;
    assert.equal(plainRerunInputText(surface, { state: "partial", value: { eid: "10812345" }, identityCopied: true }), "10812345");
    assert.equal(plainRerunInputText(surface, { state: "partial", value: { other: "10812345" }, identityCopied: true }), "");
    for (const value of [{ eid: " 10812345 " }, { eid: "10812345\n10812346" }, { eid: "not-an-id" }]) {
      assert.equal(plainRerunInputText(surface, { state: "partial", value, identityCopied: true }), "");
    }
    assert.equal(plainRerunInputText(surface, { state: "partial", value: { eid: "10812345" }, identityCopied: false }), "");
    assert.equal(plainRerunInputText(surface, { state: "unavailable", reason: "protected" }), "");
  });
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

it("does not invent a mode when a source partial input has no declared mode", () => {
  const surface = DESCRIPTORS.find(workflow => workflow.id === "onboarding")?.surfaces.inputRun?.typedInput;
  assert.ok(surface);
  const values: readonly Record<string, string>[] = [{ email: "hire@example.test" }, { email: "hire@example.test", mode: "unknown" }];
  for (const value of values) {
    assert.deepEqual(partialRerunTypedInput(surface, { state: "partial", value, identityCopied: true }), { draft: {}, text: "", input: {} });
  }
  assert.deepEqual(partialRerunTypedInput(surface, { state: "partial", value: { email: "hire@example.test", mode: "rehire" }, identityCopied: true }).draft, { mode: "rehire" });
});

it("restores a Work Study rerun: the single mode applies, the stored ISO date shows as MM/DD/YYYY and no mode is submitted", () => {
  const surface = WORK_STUDY_TYPED_INPUT;
  const restored = partialRerunTypedInput(surface, { state: "partial", value: { emplId: "10000001", effectiveDate: "2026-08-03" }, identityCopied: true });
  assert.equal(restored.draft.effectiveDate, "08/03/2026");
  assert.equal(restored.text, "10000001");
  assert.deepEqual(restored.input, { emplId: "10000001", effectiveDate: "08/03/2026" });
});
