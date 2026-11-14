import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { runClaim } from "../../../../src/models/run/record.js";
import { childWaitModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1TransientFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createDelegationExecutionWorld } from "../../../support/helpers/backend/delegation-execution-world.js";

const workflows = childWaitModules("manual");
const world = createDelegationExecutionWorld(workflows);
afterEach(world.cleanup);

it("withdraws an ordinary requested pause on a parent whose earlier manual retry Resume already acknowledged", async () => {
  const f = await world.fixture(plan1TransientFailureStores(() => {}), "fail", workflows);
  await f.execution.step(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "failed");
  const middleId = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]?.envelope.runId; assert.ok(middleId);
  const failed = f.database.authority.runs.listChildren(middleId)[0]; assert.ok(failed?.lifecycle.state === "terminal");
  const command = (type: "pause" | "resume" | "retry", runId: string) => {
    const run = f.database.authority.runs.get(runId); assert.ok(run);
    return f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard", requestedBy: "local-operator",
      requestedAt: f.clock.now().toISOString(), target: { runId, expectedVersion: run.version } });
  };
  assert.equal(command("retry", failed.envelope.runId).state, "applied");
  assert.equal((await f.execution.step(f.run, world.SIGNAL)).outcome.state, "done");
  assert.equal(command("resume", middleId).state, "applied");
  assert.equal(f.database.authority.dependencies.readiness(middleId, "join").state, "ready");

  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const owner = testWorkerLifetime(f.database, f.run.envelope.workflow, 1);
  const claimed = f.execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: f.run.envelope.workflow, workerId: owner.workerId,
    runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
      settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } });
  assert.ok(claimed.state === "applied" && claimed.run.envelope.runId === middleId, JSON.stringify(claimed));
  assert.equal(command("pause", middleId).state, "applied");
  assert.equal(f.database.authority.runs.get(middleId)?.pause?.state, "requested");

  assert.equal(command("resume", middleId).state, "applied");
  const withdrawn = f.database.authority.runs.get(middleId); assert.ok(withdrawn);
  assert.equal(withdrawn.pause, undefined);
  assert.deepEqual(runClaim(withdrawn), runClaim(claimed.run));
  assert.equal(f.database.authority.dependencies.readiness(middleId, "join").state, "ready");
});
