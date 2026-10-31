import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { reconcileExitedWorker, reconcileStartupCrash } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { attemptingOwnedWrite, ownedWorkerLifetimeFixture } from "../../../support/helpers/backend/worker-lifetime-world.js";

const world = createRunRecordServiceTestWorld();
afterEach(world.cleanup);

it("reclaims a dead idle lifetime before admitting another claim of the same workflow", async () => {
  const f = await ownedWorkerLifetimeFixture(world);
  try {
    const queued = world.created(f.service, f.request);
    f.observe("idle");
    await f.dispose();
    f.clock.advanceWall(120_000); f.clock.advanceMonotonic(120_000);
    reconcileStartupCrash({ ...f, lifecycle: f.service, lock: f.lifetime });
    assert.equal(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state, "stopped");
    assert.ok(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID)
      .some(note => note.title === "RUN_CRASH_RESOURCES_RELEASED"));
    const now = f.clock.now().toISOString();
    const replacement = f.database.authority.workerLeases.start({ workerId: f.slot.workerId, workflow: f.slot.workflow,
      browserSystems: ["crm", "ucpath"], processId: process.pid, requestedBy: "local-operator", now });
    assert.equal(replacement.state, "started");
    if (replacement.state !== "started") throw new Error("replacement lifetime required");
    assert.equal(replacement.lease.leaseGeneration, f.started.leaseGeneration + 1);
    assert.equal(replacement.lease.processId, process.pid);
    const claimed = f.database.authority.runs.claimNext({ workflow: f.slot.workflow, workerId: f.slot.workerId,
      workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: replacement.lease.leaseGeneration }, now });
    assert.ok(claimed.state === "claimed");
    assert.equal(claimed.run.envelope.runId, queued.envelope.runId);
  } finally { await f.dispose(); }
});

for (const scenario of ["interrupted", "startup-cancelled", "global-cancelled", "attempting-write", "cancelled-attempting-write"] as const) it(
  `controller recovers ${scenario} without another claim or browser birth`, async () => {
    const f = await ownedWorkerLifetimeFixture(world, { fenceInOwner: scenario.endsWith("attempting-write") });
    try {
      const queued = world.created(f.service, f.request);
      const claimed = f.database.authority.runs.claimNext({ workflow: f.slot.workflow, workerId: f.slot.workerId,
        workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: f.started.leaseGeneration }, now: f.now });
      assert.ok(claimed.state === "claimed", "the actual child must own the claim");
      let intentId: string | undefined;
      if (scenario.endsWith("attempting-write")) {
        const claim = { workerId: f.slot.workerId, claimGeneration: claimed.run.claimGeneration };
        const validating = f.database.authority.runs.transition({ runId: queued.envelope.runId,
          expectedVersion: claimed.run.version, claim, now: f.now,
          lifecycle: { ...claimed.run.lifecycle, state: "validating" } });
        assert.ok(validating.state === "applied");
        const running = f.database.authority.runs.transition({ runId: queued.envelope.runId,
          expectedVersion: validating.run.version, claim, now: f.now,
          lifecycle: { ...validating.run.lifecycle, state: "running", currentNodeId: "crm-dates" } });
        assert.ok(running.state === "applied");
        intentId = (await attemptingOwnedWrite(f, running.run)).writeIntentId;
      } else if (scenario.endsWith("cancelled")) {
        assert.equal(f.service.transition({ commandId: randomUUID(), runId: queued.envelope.runId,
          expectedVersion: claimed.run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.now } }).state, "applied");
      }
      if (scenario === "cancelled-attempting-write") {
        const current = f.database.authority.runs.get(queued.envelope.runId);
        assert.ok(current);
        assert.equal(f.service.transition({ commandId: randomUUID(), runId: queued.envelope.runId,
          expectedVersion: current.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.now } }).state, "applied");
      }
      await f.dispose();
      if (scenario === "startup-cancelled") {
        const before = f.database.authority.runs.get(queued.envelope.runId);
        assert.ok(before);
        assert.throws(() => f.service.recoverCrash({ commandId: randomUUID(), runId: queued.envelope.runId,
          expectedVersion: before.version, claim: { workerId: f.slot.workerId, claimGeneration: before.claimGeneration },
          workerLifetime: { membershipRevision: f.slot.membershipRevision, leaseGeneration: f.started.leaseGeneration + 1 },
          now: f.now }, f.lifetime), /crash-recovery-lifetime-changed/u);
        assert.deepEqual(f.database.authority.runs.get(queued.envelope.runId), before);
      }
      f.clock.advanceWall(scenario === "global-cancelled" ? 600_000 : 2_000);
      f.clock.advanceMonotonic(2_000);
      const reconcile = () => scenario === "global-cancelled"
        ? reconcileExitedWorker({ ...f, lifecycle: f.service, lock: f.lifetime,
          workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration })
        : reconcileStartupCrash({ ...f, lifecycle: f.service, lock: f.lifetime });
      reconcile();
      const recovered = f.database.authority.runs.get(queued.envelope.runId);
      assert.ok(recovered);
      assert.equal(recovered.envelope.attempt, claimed.run.envelope.attempt);
      assert.equal(recovered.claimGeneration, claimed.run.claimGeneration);
      assert.equal(f.database.authority.workerLeases.get(f.slot.workerId)?.leaseGeneration, f.started.leaseGeneration);
      assert.deepEqual(f.database.authority.workerControls.browsers(f.slot.workerId), []);
      if (scenario.endsWith("attempting-write")) {
        assert.ok(recovered.lifecycle.state === "parked-write");
        assert.equal(recovered.lifecycle.writeIntentId, intentId);
        assert.equal(f.database.authority.runResults.get(queued.envelope.runId), undefined);
      } else {
        assert.ok(recovered.lifecycle.state === "terminal");
        assert.equal(recovered.lifecycle.outcome, scenario === "interrupted" ? "failed" : "cancelled");
        if (scenario === "interrupted") assert.equal(f.database.authority.failures.listByRun(queued.envelope.runId)[0]?.code,
          "RUN_INTERRUPTED_BY_CRASH");
        else assert.deepEqual(recovered.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() });
        const terminal = f.database.authority.timelineEvents.page({ runId: queued.envelope.runId })
          .flatMap(record => record.payload.kind === "span" ? [record.payload.event] : [])
          .filter(event => event.t === "span.ended" && event.kind === "run");
        assert.equal(terminal.length, 1);
        assert.equal(terminal[0]?.attempt, claimed.run.envelope.attempt);
        assert.equal(terminal[0]?.traceId, claimed.run.envelope.traceId);
        assert.ok(terminal[0]?.t === "span.ended");
        assert.equal(terminal[0].outcome, recovered.lifecycle.outcome);
      }
      const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
      reconcile();
      assert.deepEqual(f.database.authority.runs.get(queued.envelope.runId), recovered);
      assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
    } finally { await f.dispose(); }
  });
