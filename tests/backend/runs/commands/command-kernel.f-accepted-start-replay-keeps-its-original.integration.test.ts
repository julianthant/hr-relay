import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, it } from "vitest";
import { singleAppliedRunId } from "../../../support/fixtures/operator-command-fixtures.js";

const { roots, openDatabases, rejectActiveDescriptor, createHarness, createPlan, startCommand, applyCurrentSettings } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});


it("F accepted start replay keeps its original run after active settings change", async () => {
 const h = await createHarness();
 const plan = createPlan(h, rejectActiveDescriptor, ["10800000"]);
 const command = startCommand(plan);
 const first = h.kernel.execute(command);
 const runId = singleAppliedRunId(first);
 const original = h.database.authority.runs.get(runId);
 applyCurrentSettings(h);
 const replay = h.kernel.execute(command);
 assert.equal(replay.state, "already-applied");
 assert.equal(singleAppliedRunId(replay), runId);
 assert.deepEqual(h.database.authority.runs.get(runId), original);
});
