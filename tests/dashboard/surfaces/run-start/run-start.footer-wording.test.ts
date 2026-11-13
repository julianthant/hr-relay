// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

describe("Run dialog footer and priority wording", () => {
  it("names the opened workflow in the footer, for every served workflow", async () => {
    for (const workflow of h.WORKFLOWS.filter(flow => flow.inputRun.state === "present")) {
      const dialog = await h.openDialog(h.stubClient({}), { workflows: h.WORKFLOWS, panelWorkflowId: workflow.workflowId });
      assert.match(dialog.text(), new RegExp(`${workflow.label} · \\d+ of \\d+ steps`), workflow.workflowId);
      await h.cleanup();
    }
  });
  it("names the picked workflow after switching in the picker", async () => {
    const dialog = await h.openDialog(h.stubClient({}));
    for (const workflow of h.WORKFLOWS.filter(flow => flow.inputRun.state === "present")) {
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
