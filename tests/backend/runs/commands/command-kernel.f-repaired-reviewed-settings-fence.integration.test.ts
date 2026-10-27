import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";

const { roots, openDatabases, rejectActiveDescriptor, createHarness, createPlan, startCommand, applyCurrentSettings } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


describe("F repaired reviewed settings fence", () => {
  it("requires a fresh review without consuming a plan after active settings change", async () => {
    const h = await createHarness();
    const plan = createPlan(h, rejectActiveDescriptor, ["10800000"]);
    applyCurrentSettings(h);
    const result = h.kernel.execute(startCommand(plan));
    assert.equal(result.state, "rejected");
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "replan-required");
    assert.match(result.message, /settings changed/iu);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(h.database.authority.runs.listByWorkflow(plan.workflowId), []);
  });
});
