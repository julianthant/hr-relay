import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createApplicationLifecycle } from "../../../../src/backend/runs/lifecycle/application-lifecycle.js";
import { lifecycleCommandId, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { pendingInterruptOf } from "../../../../src/rules/runs/run-interrupt.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);
afterEach(cleanup);

it("settles a run that is both pausing and stopping as the stop the served toolbar state shows", async () => {
  const harness = await executorHarness();
  const { database, clock } = harness.authority;
  const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const lifecycle = testRunService(database, clock);
  const pausing = requireLifecycleApplied(lifecycle.pause({ commandId: lifecycleCommandId("fixture-pause", RUN_ID),
    runId: RUN_ID, expectedVersion: claimed.run.version }));
  const stopping = requireLifecycleApplied(lifecycle.transition({ commandId: lifecycleCommandId("fixture-cancel-request", RUN_ID),
    runId: RUN_ID, expectedVersion: pausing.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }));
  assert.equal(stopping.pause?.state, "requested");
  assert.equal(stopping.cancelRequested, true);
  assert.equal(pendingInterruptOf(stopping), "stop-requested");

  const application = createApplicationLifecycle({ database, requestQuit() {}, onFailure: error => { throw error; } });
  try {
    assert.deepEqual(application.snapshot().targets, [{ runId: RUN_ID, expectedVersion: stopping.version, pause: stopping.pause, pauseUnavailable: true }]);
  } finally { application.dispose(); }

  const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
  assert.deepEqual(outcome, { state: "abandoned", runId: RUN_ID, reason: "cancelled" });
  const settled = database.authority.runs.get(RUN_ID);
  assert.ok(settled?.lifecycle.state === "terminal");
  assert.equal(settled.lifecycle.outcome, "cancelled");
  assert.equal(settled.pause, undefined);
});
