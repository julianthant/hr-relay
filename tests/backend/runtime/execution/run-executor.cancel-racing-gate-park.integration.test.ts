import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, it } from "vitest";
import { z } from "zod";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { childExecutionStores, childWaitModules } from "../../../support/fixtures/child-execution-workflows.js";
import { testWorkerPorts, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";

const profiles = createProfileFixtureSet();
const world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);

it("settles an accepted Cancel that races worker admission to a gate park", async () => {
  const { descriptor } = childWaitModules("gate").leaf;
  const { deps, authority: { database, path, clock } } = await world.executorHarness({ descriptor, stores: childExecutionStores });
  const execution = canonicalChildExecution(deps, database, path, () => descriptor);
  const run = execution.start(descriptor, { emplId: "10800000", text: "review", mode: "ok" }, { dryRun: false });
  const runId = run.envelope.runId;
  const ports = testWorkerPorts(database, clock, { path, descriptor, poolIndex: 1 });
  const { workerId } = testWorkerLifetime(database, descriptor.id, 1);
  const claimed = requireLifecycleApplied(ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId }));
  const claim = { workerId, claimGeneration: claimed.claimGeneration };
  let requested = false;
  const outcome = await executeClaimedRun({ ...deps, lifecycle: { ...deps.lifecycle,
    workerTransition: request => {
      if (z.object({ lifecycle: z.object({ state: z.literal("parked-gate") }) }).safeParse(request).success) {
        const current = database.authority.runs.get(runId);
        assert.ok(current?.lifecycle.state === "running");
        const stopped = requireLifecycleApplied(execution.lifecycle.transition({ commandId: randomUUID(), runId,
          expectedVersion: current.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }));
        assert.equal(stopped.cancelRequested, true);
        requested = true;
      }
      return deps.lifecycle.workerTransition(request);
    },
  } }, { run: claimed, claim, signal: world.SIGNAL });
  assert.equal(requested, true);
  assert.deepEqual(outcome, { state: "abandoned", runId, reason: "cancelled" });
  const settled = database.authority.runs.get(runId);
  assert.ok(settled?.lifecycle.state === "terminal");
  assert.equal(settled.lifecycle.outcome, "cancelled");
  assert.equal(runClaim(settled), undefined);
});
