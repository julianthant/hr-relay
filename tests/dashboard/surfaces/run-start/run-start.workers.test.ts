// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
describe("automatic worker forms", () => {
  it("offers no worker choice in Run and omits workers from its request", async () => {
    let submitted: unknown;
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
      submitted = input;
      return h.planResponse("5a000000-0000-4000-8000-000000000001");
    } }));
    await dialog.type(h.TYPED); await dialog.press("Continue");
    assert.equal(document.querySelector('button[aria-label$=" Workers"]') === null, true, "Workers picker must be absent");
    await dialog.press("Continue");
    assert.ok(submitted !== null && typeof submitted === "object");
    assert.equal(Object.hasOwn(submitted, "workers"), false);
    assert.equal(dialog.stage(), "Confirm");
    assert.equal([...document.querySelectorAll("dt")].some(node => node.textContent === "Workers"), false);
  });

  it("offers no worker choice in Rerun and omits workers from its request", async () => {
    const workflow = h.WORKFLOWS.find(value => value.workflowId === h.WORKFLOW_ID); assert.ok(workflow);
    const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
    const snapshot = RerunValuesSnapshotSchema.parse({
      source: { runId: source.runId, version: source.expectedVersion, workflow: workflow.workflowId,
        descriptorVersion: workflow.version, contractFingerprint: h.HASH, outcome: "done" },
      sourceInput: { state: "available", value: { emplId: h.TYPED } },
      steps: workflow.steps.map(step => ({ key: step.key, state: "completed", nodes: [{ nodeId: step.key, state: "completed", reason: "checkpoint" }] })),
      values: [], transactions: [] });
    let submitted: unknown;
    const dialog = await h.openDialog(h.stubClient({
      rerunValues: async () => ({ state: "available", snapshot }),
      previewRerunWarnings: async input => RerunWarningWireSchema.parse({ workflowId: workflow.workflowId,
        rerun: { source: RerunWarningRequestSchema.parse(input).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async input => {
        submitted = input;
        const request = StartPlanRequestSchema.parse(input);
        return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"),
          rerun: { source: request.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: request.warningAcknowledgment } });
      },
    }), { workflows: [workflow], panelWorkflowId: workflow.workflowId, rerunSource: source });
    await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    assert.equal(document.querySelector('button[aria-label$=" Workers"]') === null, true, "Workers picker must be absent");
    await dialog.press("Continue");
    assert.ok(submitted !== null && typeof submitted === "object");
    assert.equal(Object.hasOwn(submitted, "workers"), false);
    assert.equal(dialog.stage(), "Confirm");
  });
});
