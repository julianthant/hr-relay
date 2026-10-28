import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { reconcileStartupCrash, StartupCrashRecoveryRefusedError } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";

const world = createRunRecordServiceTestWorld();
afterEach(async () => { await world.cleanup(); vi.restoreAllMocks(); });

it("cancels only previous-local-day pristine queues, records notifications, and repeats without effects", async () => {
  const f = await world.fixture(), lock = f.lifetime;
  const reconcile = () => reconcileStartupCrash({ ...f, lifecycle: f.service, lock });
  const old = world.created(f.service, f.request);
  f.clock.advanceWall(24 * 60 * 60 * 1000);
  const today = world.created(f.service, { ...f.request, commandId: randomUUID(), matchKey: "today-synthetic-item" });
  reconcile();
  const cancelled = f.database.authority.runs.get(old.envelope.runId); assert.ok(cancelled);
  assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  assert.match(cancelled.lifecycle.errorSummary ?? "", /RUN_STALE_QUEUE_CANCELLED/u);
  assert.equal(f.database.authority.runs.get(today.envelope.runId)?.lifecycle.state, "queued");
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.equal(notifications.filter(note => note.title === "RUN_STALE_QUEUE_CANCELLED").length, 1);
  reconcile();
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

for (const mode of ["none", "attempting", "parked"] as const) it(`recovers an interrupted run with ${mode} write state and releases its resources once`, async () => {
  const f = await world.interruptedFixture(), now = f.clock.now().toISOString();
  const workerId = f.recoveryRequest.claim.workerId, leaseGeneration = f.recoveryRequest.workerLifetime.leaseGeneration;
  const intent = mode === "none" ? undefined : mode === "parked"
    ? world.parkedWriteIntent(f.database, f.run, { writeIntentId: randomUUID(), code: "unknown", message: "Synthetic unresolved write" })
    : await attemptingOwnedWrite({ database: f.database, fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  f.database.authority.workerControls.observe({ workerId, leaseGeneration, sessionId: randomUUID(), system: "ucpath",
    configFingerprint: "a".repeat(64), signInFingerprint: "b".repeat(64), browserMode: "headless",
    acceptDownloads: false, exclusive: true, health: "unknown", observedAt: now, openedAt: now, profileRevision: 1 });
  const credentialKey = "ab".repeat(32);
  assert.equal(f.database.authority.duoCeremonyLeases.acquire({ credentialKey, workerId, system: "ucpath", now, ttlMs: 60000 }).state, "acquired");
  const reconcile = () => reconcileStartupCrash({ ...f, lifecycle: f.service });
  reconcile();
  const recovered = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(recovered);
  if (intent === undefined) {
    assert.ok(recovered.lifecycle.state === "terminal" && recovered.lifecycle.outcome === "failed");
    assert.equal(f.database.authority.failures.listByRun(f.run.envelope.runId)[0]?.code, "RUN_INTERRUPTED_BY_CRASH");
  } else {
    assert.equal(recovered.lifecycle.state, "parked-write");
    assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  }
  assert.equal(f.database.authority.workerLeases.get(workerId)?.lifecycle.state, "stopped");
  assert.ok(f.database.authority.workerControls.browsers(workerId).every(browser => browser.health === "closed"));
  assert.equal(f.database.authority.duoCeremonyLeases.get(credentialKey)?.state, "released");
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.equal(notifications.filter(note => note.title === "RUN_CRASH_RESOURCES_RELEASED").length, 3);
  assert.ok(notifications.some(note => note.title === (intent === undefined ? "RUN_INTERRUPTED_BY_CRASH" : "RUN_CRASH_WRITE_UNRESOLVED")));
  reconcile();
  assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), recovered);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

it("refuses other unfinished write states and rolls back all cleanup", async () => {
  const f = await world.interruptedFixture(), now = f.clock.now().toISOString();
  const intent = await attemptingOwnedWrite({ database: f.database, fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  f.database.authority.writeIntents.settleRetryable({ writeIntentId: intent.writeIntentId, generation: intent.generation,
    expectedVersion: intent.version, now, settlement: { state: "operator-confirmed-absent", writeIntentId: intent.writeIntentId,
      generation: intent.generation, operator: "local-operator", confirmedAt: now, evidenceNote: "Synthetic absence" } });
  const before = f.database.readProfileResourceCustody();
  assert.throws(() => reconcileStartupCrash({ ...f, lifecycle: f.service }), StartupCrashRecoveryRefusedError);
  assert.deepEqual(f.database.readProfileResourceCustody(), before);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
});

it("refuses a closed controller without consuming a run", async () => {
  const f = await world.interruptedFixture();
  const closed = await RuntimeLifetimeLock.acquire(0);
  await closed.close();
  assert.throws(() => reconcileStartupCrash({ ...f, lock: closed, lifecycle: f.service }), StartupCrashRecoveryRefusedError);
  assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), f.run);
});

it("refuses an unrelated held controller before changing any interrupted run or resource", async () => {
  const f = await world.interruptedFixture(), unrelated = await RuntimeLifetimeLock.acquire(0);
  const before = f.database.readProfileResourceCustody(), generation = f.database.getMeta().authorityGeneration;
  try {
    assert.throws(() => reconcileStartupCrash({ ...f, lock: unrelated, lifecycle: f.service }), error => {
      assert.ok(error instanceof StartupCrashRecoveryRefusedError);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, "crash-recovery-controller-mismatch");
      return true;
    });
    assert.deepEqual(f.database.readProfileResourceCustody(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
    f.lifetime.assertHeld();
  } finally { await unrelated.close(); }
});

it("preserves the source-closure error identity for composition custody retention", async () => {
  const f = await world.interruptedFixture();
  const failure = new AuthoritySourceClosureUnprovedError([new Error("synthetic unclosed reader")]);
  vi.spyOn(f.database, "readProfileResourceCustody").mockImplementationOnce(() => { throw failure; });
  assert.throws(() => reconcileStartupCrash({ ...f, lifecycle: f.service }), error => error === failure);
});
