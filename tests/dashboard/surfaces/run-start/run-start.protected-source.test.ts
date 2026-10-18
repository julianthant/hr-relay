// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

it("explains how to start again when retained source input is protected without offering it for copying", async () => {
  const declared = WORKFLOW_DESCRIPTORS.find(value => value.id === h.WORKFLOW_ID); assert.ok(declared?.surfaces.inputRun);
  const workflow = { ...h.WORKFLOWS[0], version: declared.version, steps: projectStartSteps(declared), inputRun: { state: "present" as const, surface: declared.surfaces.inputRun } };
  const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
  const snapshot = RerunValuesSnapshotSchema.parse({
    source: { runId: source.runId, version: source.expectedVersion, workflow: workflow.workflowId,
      descriptorVersion: workflow.version, contractFingerprint: h.HASH, outcome: "done" },
    sourceInput: { state: "unavailable", reason: "protected" },
    steps: workflow.steps.map(step => ({ key: step.key, state: "completed", nodes: [{ nodeId: step.key, state: "completed", reason: "checkpoint" }] })),
    values: [], transactions: [],
  });
  const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => ({ state: "available", snapshot }) }),
    { workflows: [workflow], panelWorkflowId: workflow.workflowId, rerunSource: source });
  assert.match(dialog.text(), /source input is protected/u);
  assert.match(dialog.text(), /Start a new run and enter the values again/u);
  assert.equal(dialog.disabled("Continue"), true);
  assert.equal(document.querySelector("textarea"), null);
});
