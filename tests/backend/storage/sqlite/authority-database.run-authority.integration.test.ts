import { join } from "node:path";
import { testWorkerLifetime, testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createRunClaimFixtures } from "../../../support/helpers/backend/run-claim-fixtures.js";



import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";


import { afterEach,describe,it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
CONFIG_SNAPSHOT,
HASH_A,
NOW,
UUID_1,
UUID_5
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
WORKER_START_REQUEST as BASE_WORKER_START_REQUEST,
ITEM_ID,
QUEUED_RUN,
RUN_ENVELOPE,
RUN_ID,
WORKFLOW_ID,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const WORKER_ID = `${WORKFLOW_ID}-worker-1`;
const WORKER_START_REQUEST = { ...BASE_WORKER_START_REQUEST, workerId: WORKER_ID };
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";
const MUCH_LATER = "2026-07-31T18:00:00.000Z";

const { openDatabase, claimOne, cleanup: cleanupClaims } =
  createRunClaimFixtures(CLOCK, roots, databases, WORKER_START_REQUEST, WORKER_ID);

/** A second queued run for the same workflow, distinguishable by id and priority. */
function siblingRun(overrides: Readonly<Record<string, unknown>>, envelope: Readonly<Record<string, unknown>> = {}) {
  return {
    ...QUEUED_RUN,
    envelope: { ...RUN_ENVELOPE, runId: UUID_1, itemId: UUID_5, traceId: "pl-170001-1111", ...envelope },
    ...overrides,
  };
}



afterEach(cleanupClaims);

describe("run claim store", () => {

  it("advances lifecycle without reassigning the run identity or losing checkpoints", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const raw = new DatabaseSync(syntheticDatabasePath(database));
    try {
      raw.exec("CREATE TRIGGER reject_run_id_update BEFORE UPDATE OF id ON runs BEGIN SELECT RAISE(ABORT, 'run-id-reassigned'); END");
    } finally { raw.close(); }

    const claimed = claimOne(database);
    const checkpoint = database.authority.runCheckpoints.insert({
      workflowId: WORKFLOW_ID, itemId: ITEM_ID, runId: RUN_ID, nodeId: "searching",
      attempt: 1, claimGeneration: claimed.claimGeneration,
      output: { schemaHash: HASH_A, value: { state: "resolved" } },
      descriptorVersion: claimed.envelope.descriptorVersion,
      contractFingerprint: claimed.envelope.contractFingerprint,
      implFingerprint: HASH_A, provenance: [], writtenAt: NOW,
    }).record;
    let current = claimed;
    for (const state of ["validating", "running"] as const) {
      const changed = database.authority.runs.transition({
        runId: RUN_ID, expectedVersion: current.version,
        claim: { workerId: WORKER_ID, claimGeneration: claimed.claimGeneration },
        lifecycle: { state, workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: LATER },
        now: LATER,
      });
      assert.equal(changed.state, "applied");
      if (changed.state !== "applied") throw new Error("lifecycle transition should apply");
      current = changed.run;
    }
    const cancelled = database.authority.runs.transition({
      runId: RUN_ID, expectedVersion: current.version,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.claimGeneration },
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER }, now: LATER,
    });
    assert.equal(cancelled.state, "applied");
    assert.equal(database.authority.runs.get(RUN_ID)?.version, claimed.version + 3);
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: LATER });
    assert.deepEqual(database.authority.runCheckpoints.get(WORKFLOW_ID, ITEM_ID, "searching", 1, claimed.claimGeneration), checkpoint);
  });

  it("atomically refuses a claim after the dashboard active generation advances", async () => {
    const database = await openDatabase();
    const snapshot = {
      ...CONFIG_SNAPSHOT,
      configSnapshotId: RUN_ENVELOPE.configSnapshotId,
      fingerprint: RUN_ENVELOPE.configFingerprint,
    };
    database.authority.configSnapshots.insert(snapshot);
    const first = database.authority.runtimeConfig.activate({
      settingsRevision: 1,
      settingsFingerprint: HASH_A,
      configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint,
      activatedAt: NOW,
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runtimeConfig.activate({
      settingsRevision: 1,
      settingsFingerprint: HASH_A,
      configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint,
      activatedAt: LATER,
    });

    assert.throws(
      () => database.authority.runs.claimNext({
        workflow: WORKFLOW_ID,
        workerId: WORKER_ID,
        now: LATER,
        configFingerprint: first.configFingerprint,
        runtimeConfig: {
          generation: first.generation,
          settingsRevision: first.settingsRevision,
          settingsFingerprint: first.settingsFingerprint,
          configFingerprint: first.configFingerprint,
        },
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
  });

  it("enqueues idempotently and refuses a reused id with different content", async () => {
    const database = await openDatabase();
    assert.equal(database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
    assert.equal(database.authority.runs.enqueue(QUEUED_RUN).state, "existing");
    assert.throws(
      () => database.authority.runs.enqueue({ ...QUEUED_RUN, displayName: "A different content" }),
      /already exists with different content/,
    );
  });

  it("refuses to enqueue a run that is not queued", async () => {
    const database = await openDatabase();
    assert.throws(
      () => database.authority.runs.enqueue({
        ...QUEUED_RUN,
        claimGeneration: 1,
        lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      }),
      /must be enqueued in the queued state/,
    );
  });

  it("reports idle with no rows and deferred while every row is held back", async () => {
    const database = await openDatabase();
    assert.deepEqual(
      database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW }),
      { state: "idle" },
    );
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      lifecycle: { state: "queued", notBefore: MUCH_LATER },
    });
    assert.deepEqual(
      database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW }),
      { state: "deferred", nextEligibleAt: MUCH_LATER },
    );
    const claimMember1 = database.authority.workerSlots.get(WORKER_ID);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const outcome = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId: WORKER_ID, now: MUCH_LATER });
    assert.equal(outcome.state, "claimed");
  });

  it("claims interactive work ahead of bulk, then FIFO", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(siblingRun({ createdAt: LATER, updatedAt: LATER }, {
      priority: "interactive",
      enqueuedAt: LATER,
    }));
    assert.equal(claimOne(database, LATER).envelope.priority, "interactive");
    const claimMember2 = database.authority.workerSlots.get(`${WORKFLOW_ID}-worker-2`);
    if (claimMember2 === undefined) throw new Error("fixture-claim-member-required");
    const second = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember2.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId: `${WORKFLOW_ID}-worker-2`, now: LATER });
    if (second.state !== "claimed") throw new Error("the bulk row should still be claimable");
    assert.equal(second.run.envelope.priority, "bulk");
  });

  it("does not claim another workflow's rows", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const root = roots[databases.indexOf(database)];
    assert.ok(root);
    const { workerId, workerLifetime } = testAdmittedWorker(database, CLOCK, { path: join(root, "state.db"),
      workflow: "separation", poolIndex: 1, browserSystems: ["ucpath"],
    });
    assert.deepEqual(
      database.authority.runs.claimNext({ workflow: "separation", workerId, workerLifetime, now: NOW }),
      { state: "idle" },
    );
  });

  it("advances the claim generation on every claim and never rewinds it", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const first = claimOne(database);
    assert.equal(first.claimGeneration, 1);
    const requeued = database.authority.runs.requeue({
      runId: RUN_ID,
      expectedVersion: first.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      cause: "reassign",
      now: LATER,
    });
    assert.equal(requeued.state, "applied");
    const second = claimOne(database, LATER);
    assert.equal(second.claimGeneration, 2);
  });

  it("reports a lost claim rather than renewing one the row no longer holds", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    const renewed = database.authority.runs.renewClaim({
      runId: RUN_ID,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      now: LATER,
    });
    assert.equal(renewed.state, "renewed");

    const swept = database.authority.runs.sweepExpiredClaims({ staleBefore: MUCH_LATER, now: MUCH_LATER });
    assert.equal(swept.length, 1);
    const zombie = database.authority.runs.renewClaim({
      runId: RUN_ID,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      now: MUCH_LATER,
    });
    assert.equal(zombie.state, "lost");
    assert.equal(claimed.envelope.attempt, 1);
  });

  it("refuses a second active claim for one worker", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(siblingRun({}));
    const first = claimOne(database);
    assert.throws(
      () => database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: LATER }),
      new RegExp(`already holds active run ${first.envelope.runId}`),
    );
    // A second, distinct worker takes the other row — parallelism is worker
    // count, and nothing about the first claim blocks it.
    const claimMember3 = database.authority.workerSlots.get(`${WORKFLOW_ID}-worker-2`);
    if (claimMember3 === undefined) throw new Error("fixture-claim-member-required");
    const second = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember3.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId: `${WORKFLOW_ID}-worker-2`, now: LATER });
    assert.equal(second.state, "claimed");
    assert.equal(database.authority.runs.listByWorker(WORKER_ID).length, 1);
    assert.equal(database.authority.runs.listByWorker(`${WORKFLOW_ID}-worker-2`).length, 1);
  });

  it("frees the worker once its run parks or terminalizes", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(siblingRun({}));
    const first = claimOne(database);
    const cancelled = database.authority.runs.transition({
      runId: first.envelope.runId,
      expectedVersion: first.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER },
      now: LATER,
    });
    assert.equal(cancelled.state, "applied");
    const next = claimOne(database, LATER);
    assert.notEqual(next.envelope.runId, first.envelope.runId);
    assert.equal(database.authority.runs.listByWorker(WORKER_ID).length, 1);
  });

  it("requeues the immutable attempt and preserves its single-resume authority", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      envelope: {
        ...RUN_ENVELOPE,
        startAt: "active-status",
        injected: [{
          nodeId: "searching",
          fieldPath: "selection.status",
          value: "resolved",
          correctedAt: NOW,
          reason: "operator corrected the selection",
        }],
        freshnessOverride: [{
          nodeId: "searching",
          fieldPaths: ["selection.status"],
          confirmedAt: NOW,
          reason: "operator confirmed the person is unchanged",
          validForAttempt: 1,
        }],
      },
    });
    const claimed = claimOne(database);
    const outcome = database.authority.runs.requeue({
      runId: RUN_ID,
      expectedVersion: claimed.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      cause: "recovery",
      notBefore: MUCH_LATER,
      now: LATER,
    });
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("requeue should apply");
    assert.equal(outcome.run.envelope.attempt, 1);
    assert.deepEqual(outcome.run.envelope, claimed.envelope);
    assert.deepEqual(outcome.run.input, claimed.input);
    assert.equal(outcome.run.claimGeneration, claimed.claimGeneration);
    assert.deepEqual(outcome.run.lifecycle, {
      state: "queued",
      requeuedFrom: "recovery",
      notBefore: MUCH_LATER,
    });
  });

  it("refuses a transition from a stale version or a lost claim", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    const stale = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.version - 1,
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    assert.equal(stale.state, "conflict");
    const wrongWorker = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.version,
      claim: { workerId: `${WORKFLOW_ID}-worker-2`, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    assert.equal(wrongWorker.state, "conflict");
  });

  it("refuses an illegal transition outright rather than recording it", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    assert.throws(
      () => database.authority.runs.transition({
        runId: RUN_ID,
        expectedVersion: claimed.version,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
        now: LATER,
      }),
      /claimed cannot transition to parked-gate/,
    );
  });


  it("lists a run parked at a gate for exactly as long as it is parked", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    assert.deepEqual(database.authority.runs.listParkedAtGate(), []);

    const claimed = claimOne(database);
    const validating = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    if (validating.state !== "applied") throw new Error("validating transition should apply");
    const running = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: LATER },
      now: LATER,
    });
    if (running.state !== "applied") throw new Error("running transition should apply");
    // A RUNNING row is not a park: the watch must not announce a run nobody is
    // waiting on.
    assert.deepEqual(database.authority.runs.listParkedAtGate(), []);

    const parked = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
      now: LATER,
    });
    if (parked.state !== "applied") throw new Error("park should apply");

    const waiting = database.authority.runs.listParkedAtGate();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.envelope.runId, RUN_ID);
    assert.equal(
      waiting[0]?.lifecycle.state === "parked-gate" ? waiting[0].lifecycle.gateId : undefined,
      "approval",
    );

    const resumed = database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parked.run.version,
      startAt: "active-status",
      now: MUCH_LATER,
    });
    if (resumed.state !== "applied") throw new Error("resume should apply");
    assert.deepEqual(database.authority.runs.listParkedAtGate(), []);
  });

  it("renames through the version gate, and refuses a stale one", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const renamed = database.authority.runs.updatePresentation({
      runId: RUN_ID,
      expectedVersion: 1,
      displayName: "Battistessa, Johnnie",
      now: LATER,
    });
    if (renamed.state !== "applied") throw new Error("rename should apply");
    assert.equal(renamed.run.displayName, "Battistessa, Johnnie");
    // The rename advanced the version, so the SAME expected version is stale.
    assert.equal(
      database.authority.runs.updatePresentation({
        runId: RUN_ID,
        expectedVersion: 1,
        displayName: "Renamed from a stale tab",
        now: LATER,
      }).state,
      "conflict",
    );

    assert.throws(
      () => database.authority.runs.updatePresentation({ runId: RUN_ID, expectedVersion: 2, now: LATER }),
      /displayName/,
    );
  });

  it("lists every run of one logical item", async () => {
    const database = await openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);

    database.authority.runs.enqueue(siblingRun({}, { itemId: ITEM_ID, retryOf: RUN_ID, attempt: 2 }));
    const runs = database.authority.runs.listByItem({ workflow: WORKFLOW_ID, itemId: ITEM_ID });
    assert.equal(runs.length, 2);
  });
});

describe("worker leases", () => {
  it("refuses a second live process for one worker id and restarts a stopped one", async () => {
    const database = await openDatabase();
    const started = database.authority.workerLeases.start(WORKER_START_REQUEST);
    assert.equal(started.state, "started");
    if (started.state !== "started") throw new Error("start should succeed");
    assert.equal(started.lease.leaseGeneration, 1);
    assert.deepEqual(started.lease.browserSystems, ["crm", "ucpath"]);

    const second = database.authority.workerLeases.start({ ...WORKER_START_REQUEST, processId: 4243 });
    assert.equal(second.state, "conflict");

    const stopped = database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_ID,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: LATER, reason: "shutdown" },
      now: LATER,
    });
    assert.equal(stopped.state, "applied");
    if (stopped.state !== "applied") throw new Error("stop should apply");
    assert.equal(stopped.lease.control.directive, "stop");

    const restarted = database.authority.workerLeases.start({ ...WORKER_START_REQUEST, now: MUCH_LATER });
    if (restarted.state !== "started") throw new Error("restart should succeed");
    assert.equal(restarted.lease.leaseGeneration, 2);
  });

  it("refuses a lifecycle report from a superseded lease generation", async () => {
    const database = await openDatabase();
    database.authority.workerLeases.start(WORKER_START_REQUEST);
    const outcome = database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_ID,
      leaseGeneration: 2,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: LATER },
      now: LATER,
    });
    assert.equal(outcome.state, "conflict");
  });

  it("records an operator directive without pretending the worker obeyed it", async () => {
    const database = await openDatabase();
    const started = database.authority.workerLeases.start(WORKER_START_REQUEST);
    if (started.state !== "started") throw new Error("start should succeed");
    const busy = database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_ID,
      leaseGeneration: 1,
      lifecycle: { state: "busy", startedAt: NOW, heartbeatAt: LATER, runId: RUN_ID },
      now: LATER,
    });
    if (busy.state !== "applied") throw new Error("busy report should apply");

    const paused = database.authority.workerLeases.control({
      workerId: WORKER_ID,
      expectedVersion: busy.lease.version,
      control: { directive: "pause", requestedAt: LATER, requestedBy: "local-operator", reason: "operator paused" },
      now: LATER,
    });
    if (paused.state !== "applied") throw new Error("pause should apply");
    assert.equal(paused.lease.control.directive, "pause");
    assert.equal(paused.lease.lifecycle.state, "busy", "the worker is still busy until it says otherwise");

    assert.equal(
      database.authority.workerLeases.control({
        workerId: WORKER_ID,
        expectedVersion: busy.lease.version,
        control: { directive: "stop", requestedAt: LATER, requestedBy: "local-operator" },
        now: LATER,
      }).state,
      "conflict",
    );
  });

  it("expires a lease whose heartbeat went stale", async () => {
    const database = await openDatabase();
    database.authority.workerLeases.start(WORKER_START_REQUEST);
    database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_ID,
      leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    const expired = database.authority.workerLeases.sweepExpired({ staleBefore: LATER, now: LATER });
    assert.equal(expired.length, 1);
    assert.equal(expired[0].lifecycle.state, "stopped");
    assert.equal(database.authority.workerLeases.listLive().length, 0);
  });
});
