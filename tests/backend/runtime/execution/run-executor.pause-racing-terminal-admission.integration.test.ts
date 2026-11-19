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

it.each([false, true])("releases the original claim when Pause wins success admission (withdrawn=%s)", async withdrawn => {
  const { authority: { database, clock }, deps } = await world.executorHarness();
  const claimed = world.enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const runId = claimed.run.envelope.runId;
  const service = testRunService(database, clock);
  const outcome = await executeClaimedRun({ ...deps, lifecycle: { ...deps.lifecycle,
    terminalize: (...args) => {
      const current = database.authority.runs.get(runId);
      assert.ok(current?.lifecycle.state === "running");
      const pause = service.pause({ commandId: randomUUID(), runId, expectedVersion: current.version });
      assert.ok(pause.state === "applied");
      const admission = deps.lifecycle.terminalize(...args);
      assert.deepEqual(admission, { state: "refused", refusal: { reason: "lost" } });
      if (withdrawn) {
        const resume = service.resumePaused({ commandId: randomUUID(), runId, expectedVersion: pause.run.version });
        assert.ok(resume.state === "applied");
        assert.equal(resume.run.pause, undefined);
        assert.deepEqual(runClaim(resume.run), runClaim(current));
      }
      return admission;
    },
  } }, { ...claimed, signal: world.SIGNAL });
  const released = database.authority.runs.get(runId);
  assert.ok(released);
  assert.equal(runClaim(released), undefined);
  assert.equal(released.pause?.state, withdrawn ? undefined : "paused");
  assert.equal(released.lifecycle.state, "queued");
  assert.deepEqual(outcome, { state: "abandoned", runId, reason: withdrawn ? "requeued" : "paused" });
  assert.equal(database.authority.runResults.get(runId), undefined);
});
