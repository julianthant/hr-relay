// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import { versionTag } from "../../../../src/dashboard/surfaces/shared/status/format.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const PLAN_ID = "5a000000-0000-4000-8000-000000000001";
const stageNames = (): string[] => [...document.body.querySelectorAll('ol[aria-label="Run configuration path"] li')]
  .map(item => (item.textContent ?? "").replace(/^\d+/u, "").trim());

describe("the Run dialog has no Confirm stage", () => {
  it("walks Start from Input to Start and a clean plan starts at once", async () => {
    const plans: unknown[] = [];
    const dialog = await h.openDialog(h.stubClient({
      submitStartPlan: async request => { plans.push(request); return h.planResponse(PLAN_ID); },
      executeCommand: async () => h.APPLIED,
    }));
    assert.deepEqual(stageNames(), ["Input", "Start"]);
    await dialog.type(h.TYPED);
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Start");
    assert.ok(!dialog.text().includes("Preview plan"));
    await dialog.press("Start run");
    assert.equal(plans.length, 1);
    assert.deepEqual(h.closed, [false], "a clean plan submits in the same press");
  });

  it("adds Steps as the last page only while Customize steps is on, and keeps the choices across Back", async () => {
    const plans: unknown[] = [];
    const dialog = await h.openDialog(h.stubClient({
      submitStartPlan: async request => { plans.push(request); return h.planResponse(PLAN_ID); },
      executeCommand: async () => h.APPLIED,
    }));
    await dialog.type(h.TYPED);
    await dialog.press("Next");
    await dialog.press("Customize steps");
    assert.deepEqual(stageNames(), ["Input", "Start", "Steps"]);
    await dialog.press("Customize steps");
    assert.deepEqual(stageNames(), ["Input", "Start"]);
    assert.ok(!dialog.text().includes("Next"), "Start run is back on the Start page");
    await dialog.press("Customize steps");
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Steps");
    await dialog.press("CRM Dates");
    await dialog.press("2 Start");
    assert.equal(dialog.stage(), "Start");
    await dialog.press("1 Input");
    await dialog.press("Next");
    await dialog.press("Next");
    await dialog.press("Start run");
    assert.equal(plans.length, 1);
    assert.deepEqual(StartPlanRequestSchema.parse(plans[0]).selectedStepKeys, ["searching", "cross-verify", "active-status", "crm-dates"]);
  });

  it("shows neither the workflow version line nor planned outputs on a stopped plan", async () => {
    const refusedPlan = { ...h.planResponse(PLAN_ID), priority: "bulk", refused: [{ entry: 2, code: "input-invalid", message: "No such person." }] };
    const dialog = await h.openDialog(h.stubClient({
      submitStartPlan: async () => refusedPlan as ReturnType<typeof h.planResponse>,
      executeCommand: async () => h.APPLIED,
    }));
    await dialog.type(`${h.TYPED}\n10873699`);
    await dialog.press("Next");
    await dialog.press("Start run");
    assert.equal(dialog.stage(), "Start", "a stopped plan stays on the last stage");
    assert.match(dialog.text(), /Relay could not use .+\./);
    assert.ok(!dialog.text().includes("No such person."), "the server message is not shown");
    assert.ok(!dialog.text().includes(versionTag(h.WORKFLOWS[0].version)), "the version line is retired");
    assert.ok(!dialog.text().includes("ready to queue"));
    assert.equal(document.body.querySelector('[aria-label="Run outputs"]') === null, true);
    assert.deepEqual(h.closed, []);
    await dialog.press("Start run");
    assert.deepEqual(h.closed, [], "Start stays disabled while the refusal shows; nothing is submitted");
  });
});
