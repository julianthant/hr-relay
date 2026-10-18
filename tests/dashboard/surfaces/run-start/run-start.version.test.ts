// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

it("shows the declared workflow version in Options and Confirm while admitting the plan revision", async () => {
  const declared = h.WORKFLOWS.find(workflow => workflow.workflowId === h.WORKFLOW_ID);
  assert.ok(declared);
  const workflow = { ...declared, version: 3 };
  const plan = h.planResponse("5a000000-0000-4000-8000-000000000001");
  assert.notEqual(plan.expectedVersion, workflow.version);
  let submitted: unknown;
  const dialog = await h.openDialog(h.stubClient({
    submitStartPlan: async () => plan,
    executeCommand: async input => { submitted = input; return h.APPLIED; },
  }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await dialog.type(h.TYPED);
  await dialog.press("Continue");
  assert.match(dialog.text(), /Workflow versionv3/u);
  await dialog.press("Continue");
  const fact = [...document.querySelectorAll("dt")].find(node => node.textContent === "Workflow");
  assert.equal(fact?.nextElementSibling?.textContent, `${workflow.label} · v3`);
  await dialog.press("Start 1 run");
  assert.equal(StartCommandRequestSchema.parse(submitted).target.expectedVersion, plan.expectedVersion);
});
