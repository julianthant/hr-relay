// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
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
});
