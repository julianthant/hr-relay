// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const descriptor = DESCRIPTORS.find(workflow => workflow.id === "work-study"); assert.ok(descriptor);
const surface = descriptor.surfaces.inputRun; assert.ok(surface?.typedInput);
const workStudy: RunStartWorkflow = { ...h.WORKFLOWS[0], label: descriptor.label, workflowId: descriptor.id, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "present", surface } };

describe("served Work Study Confirm", () => {
  it("shows the typed effective date as an Effective date fact", async () => {
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async () => ({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: descriptor.id, expectedVersion: workStudy.version }) }),
      { workflows: [workStudy], panelWorkflowId: workStudy.workflowId });
    await dialog.type("10812345");
    const date = document.body.querySelector<HTMLInputElement>('input[aria-label="Effective date"]'); assert.ok(date);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(date, "08/03/2026"); date.dispatchEvent(new Event("input", { bubbles: true })); });
    await dialog.press("Continue");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.match(dialog.text(), /Effective date08\/03\/2026/u);
  });
  it("restores a rerun's stored ISO effective date as MM/DD/YYYY and shows it at Confirm", async () => {
    const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
    const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion,
      workflow: descriptor.id, descriptorVersion: descriptor.version, contractFingerprint: "0".repeat(64), outcome: "done" },
      sourceInput: { state: "partial", value: { emplId: "10812345", effectiveDate: "2026-08-03" }, identityCopied: true },
      steps: descriptor.timeline.map(step => ({ key: step.key, state: "unfinished", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "unfinished", reason: "not-recorded" })) })),
      values: [], transactions: [] });
    const dialog = await h.openDialog(h.stubClient({ rerunValues: async () => ({ state: "available", snapshot }),
      previewRerunWarnings: async options => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(options).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async options => { const parsed = StartPlanRequestSchema.parse(options); return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: descriptor.id, expectedVersion: workStudy.version,
        rerun: { source: parsed.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: parsed.warningAcknowledgment } }); },
    }), { workflows: [workStudy], panelWorkflowId: descriptor.id, rerunSource: source });
    await dialog.press("Continue");
    assert.equal(document.body.querySelector<HTMLInputElement>('input[aria-label="Effective date"]')?.value, "08/03/2026");
    for (let guard = 0; guard < 4 && dialog.stage() !== "Confirm"; guard += 1) await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.match(dialog.text(), /Effective date08\/03\/2026/u);
  });
});
