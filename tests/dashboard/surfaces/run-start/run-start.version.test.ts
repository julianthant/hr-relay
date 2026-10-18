// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { StartPlanWireSchema as StartPlanResponseSchema } from "../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";

import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../parity/helpers/fixture-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

it.each([{workflowId:h.WORKFLOW_ID,version:3},{workflowId:"separations",version:9}])("shows $workflowId declared v$version in Options and Confirm while admitting the independent plan revision", async ({workflowId,version}) => {
  const declared = parseWorkflows(FIXTURE_START_PICKER_BOOTSTRAP.workflows).find(workflow => workflow.id === workflowId);
  assert.ok(declared?.start.inputRun);
  const workflow = { ...h.WORKFLOWS[0], workflowId, label: declared.label, categoryId: declared.categoryId, role: declared.role, version, steps: declared.start.steps, inputRun: { state: "present" as const, surface: declared.start.inputRun } };
  const plan = StartPlanResponseSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId });
  assert.notEqual(plan.expectedVersion, workflow.version);
  let submitted: unknown;
  const dialog = await h.openDialog(h.stubClient({
    submitStartPlan: async () => plan,
    executeCommand: async input => { submitted = input; return CommandResultSchema.parse({ ...h.APPLIED, affectedTargets: [{ family: "start", workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }] }); },
  }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await dialog.type(workflowId === "separations" ? "4502" : h.TYPED);
  await dialog.press("Continue");
  assert.ok(dialog.text().includes(`Workflow versionv${version}`));
  await dialog.press("Continue");
  const fact = [...document.querySelectorAll("dt")].find(node => node.textContent === "Workflow");
  assert.equal(fact?.nextElementSibling?.textContent, `${workflow.label} · v${version}`);
  await dialog.press("Start 1 run");
  const target = StartCommandRequestSchema.parse(submitted).target;
  assert.equal(target.workflowId, workflowId);
  assert.equal(target.expectedVersion, plan.expectedVersion);
});
