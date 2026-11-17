// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { versionTag } from "../../../../src/dashboard/surfaces/shared/status/format.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const PLAN_ID = "5a000000-0000-4000-8000-000000000001";
const stageNames = (): string[] => [...document.body.querySelectorAll('ol[aria-label="Run configuration path"] li')]
  .map(item => (item.textContent ?? "").replace(/^\d+/u, "").trim());

describe("the Run dialog has no Confirm stage", () => {
  it("walks Start from Input to Options and a clean plan starts at once", async () => {
    const plans: unknown[] = [];
    const dialog = await h.openDialog(h.stubClient({
      submitStartPlan: async request => { plans.push(request); return h.planResponse(PLAN_ID); },
      executeCommand: async () => h.APPLIED,
    }));
    assert.deepEqual(stageNames(), ["Input", "Options", "Checks"]);
    await dialog.type(h.TYPED);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    assert.ok(!dialog.text().includes("Preview plan"));
    assert.ok(!dialog.text().includes("Enter to start"), "Start lives on Checks, not Options");
    await dialog.press("Start run");
    assert.equal(dialog.stage(), "Checks");
    assert.equal(plans.length, 1);
    assert.deepEqual(h.closed, [false], "a clean plan submits in the same press");
  });

  it("shows neither the workflow version line nor planned outputs on a stopped plan", async () => {
    const refusedPlan = { ...h.planResponse(PLAN_ID), refused: [{ entry: 2, code: "input-invalid", message: "No such person." }] };
    const dialog = await h.openDialog(h.stubClient({
      submitStartPlan: async () => refusedPlan as ReturnType<typeof h.planResponse>,
      executeCommand: async () => h.APPLIED,
    }));
    await dialog.type(`${h.TYPED}\n10873699`);
    await dialog.press("Continue");
    await dialog.press("Start run");
    assert.equal(dialog.stage(), "Checks", "a stopped plan stays on the last stage");
    assert.ok(dialog.text().includes("No such person."));
    assert.ok(!dialog.text().includes(versionTag(h.WORKFLOWS[0].version)), "the version line is retired");
    assert.ok(!dialog.text().includes("ready to queue"));
    assert.equal(document.body.querySelector('[aria-label="Run outputs"]'), null);
    assert.deepEqual(h.closed, []);
    await dialog.press("Start 1 run");
    assert.deepEqual(h.closed, [false], "the second Start submits the shown plan");
  });
});
