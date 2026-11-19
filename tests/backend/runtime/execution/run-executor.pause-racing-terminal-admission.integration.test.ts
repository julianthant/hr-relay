import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createProfileFixtureSet();
const world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);

it("releases the original claim when an operator Pause wins success admission", async () => {
  const { authority: { database, clock }, deps } = await world.executorHarness();
  const claimed = world.enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const runId = claimed.run.envelope.runId;
  const service = testRunService(database, clock);
  const outcome = await executeClaimedRun({ ...deps, lifecycle: { ...deps.lifecycle,
    terminalize: (...args) => {
      const current = database.authority.runs.get(runId);
      assert.ok(current?.lifecycle.state === "running");
      assert.equal(service.pause({ commandId: randomUUID(), runId, expectedVersion: current.version }).state, "applied");
      return deps.lifecycle.terminalize(...args);
    },
  } }, { ...claimed, signal: world.SIGNAL });
  const paused = database.authority.runs.get(runId);
  assert.ok(paused);
  assert.equal(runClaim(paused), undefined);
  assert.equal(paused.pause?.state, "paused");
  assert.equal(paused.lifecycle.state, "queued");
  assert.deepEqual(outcome, { state: "abandoned", runId, reason: "paused" });
  assert.equal(database.authority.runResults.get(runId), undefined);
});
