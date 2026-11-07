import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";








const { roots, openDatabases, profiles, rejectActiveDescriptor, createHarness, nextCommandId, createPlan, startCommand } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("command idempotency", () => {
  it("returns already-applied for a byte-exact replay after revalidating the plan bindings", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    const first = harness.kernel.execute(command);
    assert.equal(first.state, "applied");
    if (first.state !== "applied") return;

    const generationBefore = harness.database.getMeta().authorityGeneration;
    const replayed = harness.kernel.execute(structuredClone(command));
    assert.equal(replayed.state, "already-applied");
    if (replayed.state !== "already-applied") return;
    assert.deepEqual(replayed.affectedTargets, first.affectedTargets);
    // Replay reads; it never re-executes.
    assert.equal(harness.database.getMeta().authorityGeneration, generationBefore);
    const runs = harness.database.authority.runs.listByItem({
      workflow: plan.workflowId,
      itemId: plan.planned[0].itemId,
    });
    assert.equal(runs.length, 1);
  });

  it("rejects a same-id different-content replay loudly", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    const command = startCommand(plan);
    assert.equal(harness.kernel.execute(command).state, "applied");
    const conflicting = { ...command, reason: "a different body wearing the same id" };
    assert.throws(() => harness.kernel.execute(conflicting), /reused with different content/);
  });

  it("refuses a spent plan presented by a different command", async () => {
    const harness = await createHarness();
    const plan = createPlan(harness, rejectActiveDescriptor, ["10800000"]);
    assert.equal(harness.kernel.execute(startCommand(plan)).state, "applied");
    const second = harness.kernel.execute(startCommand(plan, nextCommandId()));
    assert.equal(second.state, "rejected");
    if (second.state === "rejected") {
      assert.equal(second.code, "invalid-state");
      assert.match(second.message, /already consumed/);
    }
  });
});
