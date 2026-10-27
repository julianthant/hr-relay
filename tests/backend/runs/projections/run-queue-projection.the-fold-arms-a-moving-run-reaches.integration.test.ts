import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { declareProjectionWorker, atDayOffset, claimEventOf, DAY, dayOffsetOf, instantOffsetOf, notificationRecordOf, runEndedEventOf, traceOf, uuidOf, workerLeaseOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, runRecordOf, queuedEventOf, CLAIM, cleanup } = createRunQueueProjectionTestWorld();


afterEach(cleanup);


describe("the fold arms a moving run reaches (ref dashboard-surfaces)", () => {

  function seedWorkerSpans(w: DashboardWorld, workerId = "person-lookup-worker-1"): void {
    declareProjectionWorker(w.authority, workerId, Number(workerId.split("-").at(-1)));
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: `worker/person-lookup/${workerId}`, name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId,
      spanPath: `worker/person-lookup/${workerId}/browser:ucpath#${uuidOf(50)}`,
      parentSpanPath: `worker/person-lookup/${workerId}`,
      name: "browser-session:ucpath", system: "ucpath",
    });
  }

  it("returns a requeued run to the queue, preserves its attempt, and frees the worker holding it", async () => {
    const w = await world();
    seedWorkerSpans(w);
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...CLAIM, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1 }));
    w.authority.putWorkerLease(workerLeaseOf({ lifecycle: { state: "busy", startedAt: instantOffsetOf(0), heartbeatAt: instantOffsetOf(0), runId: uuidOf(1) } }));
    claimEventOf(w, 1);
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "running");
    assert.deepEqual(
      w.projection.buildDashboardDayWire(DAY).workerCards[0].currentRun,
      { state: "present", runId: uuidOf(1), traceId: traceOf(1) },
    );

    w.authority.put(runRecordOf({ seed: 1, attempt: 1, claimGeneration: 1, lifecycle: { state: "queued" } }));
    w.authority.putWorkerLease(workerLeaseOf());
    w.writer.emit({
      t: "run.requeued", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1),
      cause: "recovery", nextAttempt: 1,
    });

    // Recovery preserves the run attempt; the next claim advances its fence.
    const surface = w.projection.queueSurface(uuidOf(1));
    assert.equal(surface?.status, "queued");
    assert.equal(surface?.attempt, 1);
    const fold = w.projection.runFold(uuidOf(1));
    assert.equal(fold?.requeues, 1);
    assert.equal(fold?.claimedBy, undefined);


    const card = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(card.state, "idle");
    assert.deepEqual(card.currentRun, { state: "absent", reason: "no current claimed run" });
  });

  it("closes an open gate on resolution and records the key and digest that resolved it", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1, lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: instantOffsetOf(0), resumeAt: "approval" } });
    w.writer.emit({
      t: "gate.opened", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), gate: "approval",
    });
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "awaiting-approval");

    w.authority.put(runRecordOf({ seed: 1 }));
    const resolvedAt = w.clock.now().toISOString();
    w.writer.emit({
      t: "gate.resolved", ts: resolvedAt, workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1),
      gate: "approval", resolutionKey: "approved", resultHash: HASH_A,
    });

    // The gate leaves the OPEN list rather than being marked resolved in place:
    // a run still holding an open gate reads as awaiting-approval forever.
    assert.equal(w.projection.queueSurface(uuidOf(1))?.status, "queued");
    const fold = w.projection.runFold(uuidOf(1));
    assert.deepEqual(fold?.openGates, []);
    assert.deepEqual(fold?.resolvedGates, [
      { gate: "approval", resolutionKey: "approved", resultHash: HASH_A, resolvedAt },
    ]);
  });

  it("closes a task span an earlier process opened without inventing when it started", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // A restart: the end arrives for a span whose start belonged to a process
    // that is gone. The chip must still render its real outcome.
    w.writer.emit({
      t: "span.ended", kind: "task", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1),
      spanPath: `${traceOf(1)}/cross-verify#1`, outcome: "done",
    });

    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline, [
      { id: "cross-verify", label: "cross-verify", state: "done" },
    ]);
    const span = w.projection.runFold(uuidOf(1))?.taskSpans[0];
    assert.equal(span?.outcome, "done");
    // The open time is genuinely unknown; a guessed one would print a duration.
    assert.equal(span?.startedAt, undefined);
  });

  it("frees the worker when the run it held ends, then marks the standing card failed when the worker stops", async () => {
    const w = await world();
    seedWorkerSpans(w);
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    runEndedEventOf(w, 1, "done");
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) },
      version: 3,
    }));

    const idle = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(idle.state, "idle");
    assert.deepEqual(idle.currentRun, { state: "absent", reason: "no current claimed run" });

    // Only durable lease settlement closes a worker card; ending a span is an observation.
    w.writer.emit({
      t: "span.ended", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1",
      outcome: "done",
    });
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0].state, "idle");

    w.authority.putWorkerLease(workerLeaseOf({
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 9_000),
        reason: "shutdown",
      },
      directive: "stop",
      version: 3,
    }));
    const stopped = w.projection.buildDashboardDayWire(DAY).workerCards[0];
    assert.equal(stopped.state, "failed");
    assert.equal(stopped.stopReason, "shutdown");
    assert.deepEqual(stopped.currentRun, { state: "absent", reason: "no current claimed run" });
  });

  it("orders worker cards by id and draws only the workers AUTHORITY names", async () => {
    const w = await world();

    seedWorkerSpans(w, "person-lookup-worker-2");
    seedWorkerSpans(w, "person-lookup-worker-1");
    declareProjectionWorker(w.authority, "person-lookup-worker-3", 3);
    w.authority.putWorkerLease(workerLeaseOf({ workerId: "person-lookup-worker-3" }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-4", spanPath: "worker/person-lookup/person-lookup-worker-4",
      name: "person-lookup",
    });

    const cards = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.deepEqual(
      cards.map(({ workerId }) => workerId),
      ["person-lookup-worker-1", "person-lookup-worker-2", "person-lookup-worker-3"],
    );
    assert.deepEqual(cards[2].browsers, []);
  });

  it("refuses a replayed run.queued rather than folding a second identity over the first", async () => {
    const w = await world({ collectRebuilds: true });
    const queued = queuedEventOf(w, { seed: 1 });
    // Identity attributes are write-once. A second `run.queued` for the same
    // run would silently reset the attempt, the members and the details.
    w.projection.apply(queued);
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /identity attributes are write-once/);

    // The JSONL still holds exactly one line, so the guarded rebuild restores
    // the one true row rather than the duplicate that degraded it.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  });

  it("refuses a RUN span that ended as skipped — skipped is a task-span outcome", async () => {
    const w = await world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // The wire union permits the shape (one outcome enum serves both span
    // kinds); the fold is what knows a run cannot be conditionally skipped.
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "skipped",
    });
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /skipped is a task-span outcome/);
  });

  it("orders the month calendar, the workflow badges and the inbox deterministically", async () => {
    const w = await world();
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 1 });
    queuedEventOf(w, { seed: 2, workflow: "separations-kuali-finalization" });
    atDayOffset(w, 1);
    queuedEventOf(w, { seed: 3 });
    atDayOffset(w, 0);

    // Two notifications share an instant on purpose: newest first, and a tie
    // broken by id rather than by whatever order authority happened to return.
    w.authority.notifications.push(
      notificationRecordOf({ seed: 31, title: "later id", lastSeenAt: instantOffsetOf(0, 2_000) }),
      notificationRecordOf({ seed: 32, title: "oldest", lastSeenAt: instantOffsetOf(0, 1_000) }),
      notificationRecordOf({ seed: 30, title: "earlier id", lastSeenAt: instantOffsetOf(0, 2_000) }),
    );

    const day = w.projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.monthCounts, [
      { day: dayOffsetOf(0), count: 2 },
      { day: dayOffsetOf(1), count: 1 },
    ]);

    assert.deepEqual(day.workflowCounts, [
      { workflowId: "person-lookup", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
      { workflowId: "separations-kuali-finalization", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.notifications.map(({ notificationId }) => notificationId), [uuidOf(7030), uuidOf(7031), uuidOf(7032)]);
    assert.deepEqual(day.notifications.map(({ title }) => title), ["Run failed", "Run failed", "Run failed"]);
    assert.equal(day.notifications[0].severity, "error");
    assert.equal(day.notifications[0].state, "unread");
  });
});
