// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../mocks/helpers/fixture-day.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const PICKER: readonly RunStartWorkflow[] = parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows).map((entry): RunStartWorkflow => {
  const start = entry.start;
  return { workflowId: String(entry.id), label: entry.label, categoryId: entry.categoryId, role: entry.role,
    enqueue: start.enqueue, version: start.version, steps: start.steps,
    inputRun: start.inputRun === undefined ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] } : { state: "present", surface: start.inputRun },
    spreadsheetIntake: start.spreadsheetIntake, requiredWorkbookFields: start.requiredWorkbookFields, workbookReference: start.workbookReference,
    referenceSources: FIXTURE_START_PICKER_BOOTSTRAP.workbookCompatibility.workflows.find(workflow => workflow.workflowId === entry.id)?.sources ?? [] };
});
const STARTABLE = PICKER.filter(flow => flow.inputRun.state === "present");

describe("Run dialog footer and priority wording", () => {
  it("names the opened workflow in the footer, for every served workflow", async () => {
    assert.deepEqual(STARTABLE.map(flow => flow.label).sort(), ["CRM Document Download", "Onboarding", "Person Lookup", "Separations", "Work-Study"]);
    for (const workflow of STARTABLE) {
      const dialog = await h.openDialog(h.stubClient({}), { workflows: PICKER, panelWorkflowId: workflow.workflowId });
      assert.match(dialog.text(), new RegExp(`${workflow.label} · \\d+ of \\d+ steps`), workflow.workflowId);
      await h.cleanup();
    }
  });
  it("names the picked workflow after switching in the picker", async () => {
    const dialog = await h.openDialog(h.stubClient({}), { workflows: PICKER, panelWorkflowId: STARTABLE[0].workflowId });
    for (const workflow of [...STARTABLE, ...STARTABLE].reverse()) {
      const button = [...document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Workflow"] button')].find(node => node.textContent?.includes(workflow.label));
      assert.ok(button, workflow.label);
      await act(async () => button.click());
      assert.match(dialog.text(), new RegExp(`${workflow.label} · \\d+ of \\d+ steps`), workflow.workflowId);
    }
  });
  it("words priority as Priority, never Interactive or Bulk", async () => {
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async () => h.planResponse("5a000000-0000-4000-8000-000000000001") }));
    await dialog.type(h.TYPED);
    await dialog.press("Continue");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.match(dialog.text(), /PriorityOn/u);
    assert.doesNotMatch(dialog.text(), /Interactive|Bulk/u);
  });
});
