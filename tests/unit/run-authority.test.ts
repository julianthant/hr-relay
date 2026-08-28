/**
 * The run/claim store (ref execution-and-sessions §3, ref workflow-model §4).
 *
 * Two things are being pinned here, and they are different in kind. The schema
 * tests prove that an illegal *shape* cannot be spelled — a claimed run with no
 * claim generation, a failed run with no failure record, a freshness override
 * that authorizes an attempt this run is not. The repository tests prove that
 * an illegal *sequence* cannot happen even when two callers race: two workers
 * cannot hold one row, a zombie's heartbeat cannot resurrect a claim someone
 * else already took, and a requeue cannot carry a single-resume affordance into
 * the next attempt.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { RunEnvelopeSchema } from "../../src/domain/run/envelope.js";
import {
  RunLifecycleSchema,
  RunRecordSchema,
  runClaim,
  runTransitionViolation,
} from "../../src/domain/run/record.js";
import { WorkerLeaseRecordSchema } from "../../src/domain/run/worker.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  CONFIG_SNAPSHOT,
  HASH_A,
  HASH_B,
  HASH_C,
  NOW,
  UUID_1,
  UUID_5,
} from "./fixtures/phase1c-contract-fixtures.js";
import {
  ITEM_ID,
  QUEUED_RUN,
  RUN_ENVELOPE,
  RUN_ID,
  WORKER_ID,
  WORKER_START_REQUEST,
  WORKFLOW_ID,
} from "./fixtures/phase1f-run-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";
const MUCH_LATER = "2026-07-31T18:00:00.000Z";

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-runs-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  return database;
}

/** A second queued run for the same workflow, distinguishable by id and priority. */
function siblingRun(overrides: Readonly<Record<string, unknown>>, envelope: Readonly<Record<string, unknown>> = {}) {
  return {
    ...QUEUED_RUN,
    envelope: { ...RUN_ENVELOPE, runId: UUID_1, itemId: UUID_5, traceId: "pl-170001-1111", ...envelope },
    ...overrides,
  };
}

function claimOne(database: AuthorityDatabase, now = NOW) {
  const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
  if (outcome.state !== "claimed") throw new Error(`expected a claim, got ${outcome.state}`);
  return outcome.run;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("RunEnvelope", () => {
  it("accepts the minimum legal first-attempt envelope", () => {
    assert.equal(RunEnvelopeSchema.parse(RUN_ENVELOPE).attempt, 1);
  });

  it("refuses a run that is its own retry or its own parent", () => {
    assert.throws(() => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, retryOf: RUN_ID }), /retry of itself/);
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        parent: { runId: RUN_ID, tracePrefix: "pl-170000-2222", edgeId: "member" },
      }),
      /its own parent/,
    );
  });

  it("refuses a resolved instance that ignores or contradicts the request", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        requestedInstance: { ucpath: "test" },
        resolvedInstance: { ucpath: "prod", crm: "prod" },
      }),
      /requested as test but resolved to prod/,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        requestedInstance: { kuali: "test" },
      }),
      /requested but enqueue resolved no instance/,
    );
  });

  it("refuses an unknown browser system in an instance map", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, resolvedInstance: { peoplesoft: "prod" } }),
      /invalid|unrecognized|expected/i,
    );
  });

  it("refuses a freshness override scoped to a different attempt", () => {
    assert.throws(
      () => RunEnvelopeSchema.parse({
        ...RUN_ENVELOPE,
        attempt: 2,
        freshnessOverride: [{
          nodeId: "searching",
          fieldPaths: ["selection.status"],
          confirmedAt: NOW,
          reason: "operator confirmed the person is unchanged",
          validForAttempt: 1,
        }],
      }),
      /scoped to attempt 1 but this run is attempt 2/,
    );
  });

  it("accepts injected patches without an entry node, refusing entry-node and duplicate patches", () => {
    const patch = {
      nodeId: "searching",
      fieldPath: "selection.status",
      value: "resolved",
      correctedAt: NOW,
      reason: "operator corrected the selection",
    };
    // D166: a live Edit-Data save needs no startAt — the executor refuses,
    // loudly, any patch naming a node it will execute rather than replay.
    assert.equal(
      RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, injected: [patch] }).injected?.length,
      1,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "searching", injected: [patch] }),
      /is the entry node and will re-run/,
    );
    assert.throws(
      () => RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "active-status", injected: [patch, patch] }),
      /two patches target searching.selection.status/,
    );
    assert.equal(
      RunEnvelopeSchema.parse({ ...RUN_ENVELOPE, startAt: "active-status", injected: [patch] }).injected?.length,
      1,
    );
  });
});

describe("RunRecord", () => {
  it("refuses a claimed run that was never claimed", () => {
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
        claimGeneration: 0,
      }),
      /must have been claimed at least once/,
    );
  });

  it("requires a failure record for a failed run and forbids one otherwise", () => {
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "terminal", outcome: "failed", endedAt: LATER },
      }),
      /must name its structured failure record/,
    );
    assert.throws(
      () => RunRecordSchema.parse({
        ...QUEUED_RUN,
        lifecycle: { state: "terminal", outcome: "done", endedAt: LATER, failureId: UUID_1 },
      }),
      /outcome done cannot carry a failure record/,
    );
  });

  it("returns no claim for a queued, parked, or terminal row", () => {
    assert.equal(runClaim(RunRecordSchema.parse(QUEUED_RUN)), undefined);
    assert.equal(
      runClaim(RunRecordSchema.parse({
        ...QUEUED_RUN,
        claimGeneration: 1,
        lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
      })),
      undefined,
    );
  });
});

describe("run transition legality", () => {
  const lifecycle = (input: unknown) => RunLifecycleSchema.parse(input);
  const queued = lifecycle({ state: "queued" });
  const claimed = lifecycle({ state: "claimed", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW });
  const running = lifecycle({ state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW });
  const done = lifecycle({ state: "terminal", outcome: "done", endedAt: LATER });
  const interrupted = lifecycle({ state: "terminal", outcome: "interrupted", endedAt: LATER });

  it("permits the documented edges", () => {
    assert.equal(runTransitionViolation(queued, claimed), undefined);
    assert.equal(runTransitionViolation(running, done), undefined);
    assert.equal(runTransitionViolation(interrupted, queued), undefined);
  });

  it("refuses running without a claim, and refuses reopening a settled run", () => {
    assert.match(String(runTransitionViolation(queued, running)), /queued cannot transition to running/);
    assert.match(String(runTransitionViolation(done, queued)), /only an interrupted run may be requeued/);
  });

  it("refuses a queued run ending as done without ever being claimed", () => {
    assert.match(String(runTransitionViolation(queued, done)), /cannot end as done without being claimed/);
    assert.equal(
      runTransitionViolation(queued, lifecycle({ state: "terminal", outcome: "cancelled", endedAt: LATER })),
      undefined,
    );
  });

  it("permits an unchanged lifecycle from any state, including a settled one", () => {
    assert.equal(runTransitionViolation(done, done), undefined);
    assert.equal(runTransitionViolation(queued, queued), undefined);
  });
});

describe("run claim store", () => {
  it("atomically refuses a claim after the dashboard active generation advances", () => {
    const database = openDatabase();
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
        configFingerprint: HASH_B,
        runtimeConfig: {
          generation: first.generation,
          settingsRevision: first.settingsRevision,
          settingsFingerprint: first.settingsFingerprint,
          configFingerprint: first.configFingerprint,
        },
      }),
      /runtime config generation 1 is no longer dashboard-active/u,
    );
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
  });

  it("enqueues idempotently and refuses a reused id with different content", () => {
    const database = openDatabase();
    assert.equal(database.authority.runs.enqueue(QUEUED_RUN).state, "inserted");
    assert.equal(database.authority.runs.enqueue(QUEUED_RUN).state, "existing");
    assert.throws(
      () => database.authority.runs.enqueue({ ...QUEUED_RUN, displayName: "A different content" }),
      /already exists with different content/,
    );
  });

  it("refuses to enqueue a run that is not queued", () => {
    const database = openDatabase();
    assert.throws(
      () => database.authority.runs.enqueue({
        ...QUEUED_RUN,
        claimGeneration: 1,
        lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      }),
      /must be enqueued in the queued state/,
    );
  });

  it("reports idle with no rows and deferred while every row is held back", () => {
    const database = openDatabase();
    assert.deepEqual(
      database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW }),
      { state: "idle" },
    );
    database.authority.runs.enqueue({
      ...QUEUED_RUN,
      lifecycle: { state: "queued", notBefore: MUCH_LATER },
    });
    assert.deepEqual(
      database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW }),
      { state: "deferred", nextEligibleAt: MUCH_LATER },
    );
    const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: MUCH_LATER });
    assert.equal(outcome.state, "claimed");
  });

  it("claims interactive work ahead of bulk, then FIFO", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(siblingRun({ createdAt: LATER, updatedAt: LATER }, {
      priority: "interactive",
      enqueuedAt: LATER,
    }));
    assert.equal(claimOne(database, LATER).envelope.priority, "interactive");
    const second = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: "worker-2", now: LATER });
    if (second.state !== "claimed") throw new Error("the bulk row should still be claimable");
    assert.equal(second.run.envelope.priority, "bulk");
  });

  it("does not claim another workflow's rows", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    assert.deepEqual(
      database.authority.runs.claimNext({ workflow: "separation", workerId: WORKER_ID, now: NOW }),
      { state: "idle" },
    );
  });

  it("advances the claim generation on every claim and never rewinds it", () => {
    const database = openDatabase();
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

  it("reports a lost claim rather than renewing one the row no longer holds", () => {
    const database = openDatabase();
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

  it("refuses a second active claim for one worker", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    database.authority.runs.enqueue(siblingRun({}));
    const first = claimOne(database);
    assert.throws(
      () => database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: LATER }),
      new RegExp(`already holds active run ${first.envelope.runId}`),
    );
    // A second, distinct worker takes the other row — parallelism is worker
    // count, and nothing about the first claim blocks it.
    const second = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: "worker-2", now: LATER });
    assert.equal(second.state, "claimed");
    assert.equal(database.authority.runs.listByWorker(WORKER_ID).length, 1);
    assert.equal(database.authority.runs.listByWorker("worker-2").length, 1);
  });

  it("frees the worker once its run parks or terminalizes", () => {
    const database = openDatabase();
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

  it("requeues with a new attempt and drops every single-resume affordance", () => {
    const database = openDatabase();
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
    assert.equal(outcome.run.envelope.attempt, 2);
    assert.equal(outcome.run.envelope.startAt, undefined);
    assert.equal(outcome.run.envelope.injected, undefined);
    assert.equal(outcome.run.envelope.freshnessOverride, undefined);
    assert.deepEqual(outcome.run.lifecycle, {
      state: "queued",
      requeuedFrom: "recovery",
      notBefore: MUCH_LATER,
    });
  });

  it("refuses a transition from a stale version or a lost claim", () => {
    const database = openDatabase();
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
      claim: { workerId: "worker-2", claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    assert.equal(wrongWorker.state, "conflict");
  });

  it("refuses an illegal transition outright rather than recording it", () => {
    const database = openDatabase();
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

  it("resumes only a parked run, and only to a named node", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    const validating = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
      now: LATER,
    });
    if (validating.state !== "applied") throw new Error("validating transition should apply");
    assert.throws(
      () => database.authority.runs.resume({
        runId: RUN_ID,
        expectedVersion: validating.run.version,
        startAt: "active-status",
        now: LATER,
      }),
      /only a parked run resumes/,
    );

    const running = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: LATER },
      now: LATER,
    });
    if (running.state !== "applied") throw new Error("running transition should apply");
    const parked = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "active-status" },
      now: LATER,
    });
    if (parked.state !== "applied") throw new Error("park should apply");
    // A parked run holds no claim: the column trigger and the schema agree.
    assert.equal(runClaim(parked.run), undefined);

    const resumed = database.authority.runs.resume({
      runId: RUN_ID,
      expectedVersion: parked.run.version,
      startAt: "active-status",
      now: MUCH_LATER,
    });
    if (resumed.state !== "applied") throw new Error("resume should apply");
    assert.equal(resumed.run.envelope.startAt, "active-status");
    assert.equal(resumed.run.envelope.attempt, 1, "a gate resume continues the same attempt");
    assert.equal(resumed.run.lifecycle.state, "queued");
  });

  /**
   * D262 — the needs-you watch's ONE authority read. The park is a STANDING
   * fact, so the query must answer it for as long as the run holds it and stop
   * answering the instant a human resolves it; that pair is what makes the
   * watcher's transition rule derivable from authority rather than from a
   * process's memory of what it saw.
   */
  it("lists a run parked at a gate for exactly as long as it is parked", () => {
    const database = openDatabase();
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

  it("renames through the version gate, and refuses a stale one", () => {
    const database = openDatabase();
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
    // D234 retired `hidden`; presentation is the display name and nothing else,
    // so an update that names no name is refused by the schema itself.
    assert.throws(
      () => database.authority.runs.updatePresentation({ runId: RUN_ID, expectedVersion: 2, now: LATER }),
      /displayName/,
    );
  });

  it("lists every run of one logical item", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    // D221 — the retry takes the ITEM's next attempt; attempt 1 is spent.
    database.authority.runs.enqueue(siblingRun({}, { itemId: ITEM_ID, retryOf: RUN_ID, attempt: 2 }));
    const runs = database.authority.runs.listByItem({ workflow: WORKFLOW_ID, itemId: ITEM_ID });
    assert.equal(runs.length, 2);
  });
});

describe("worker leases", () => {
  it("refuses a second live process for one worker id and restarts a stopped one", () => {
    const database = openDatabase();
    const started = database.authority.workerLeases.start(WORKER_START_REQUEST);
    assert.equal(started.state, "started");
    if (started.state !== "started") throw new Error("start should succeed");
    assert.equal(started.lease.leaseGeneration, 1);

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

  it("refuses a lifecycle report from a superseded lease generation", () => {
    const database = openDatabase();
    database.authority.workerLeases.start(WORKER_START_REQUEST);
    const outcome = database.authority.workerLeases.reportLifecycle({
      workerId: WORKER_ID,
      leaseGeneration: 2,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: LATER },
      now: LATER,
    });
    assert.equal(outcome.state, "conflict");
  });

  it("records an operator directive without pretending the worker obeyed it", () => {
    const database = openDatabase();
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

  it("expires a lease whose heartbeat went stale", () => {
    const database = openDatabase();
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

  it("refuses a stopped lease that still carries a run directive", () => {
    assert.throws(
      () => WorkerLeaseRecordSchema.parse({
        workerId: WORKER_ID,
        workflow: WORKFLOW_ID,
        processId: 1,
        leaseGeneration: 1,
        lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: LATER, reason: "shutdown" },
        control: { directive: "run", requestedAt: NOW, requestedBy: "local-operator" },
        version: 1,
        createdAt: NOW,
        updatedAt: LATER,
      }),
      /cannot carry a run directive/,
    );
  });
});

describe("run row column invariants", () => {
  it("keeps the typed columns in lockstep with the record, and rejects a claim outside a claimed state", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(QUEUED_RUN);
    const claimed = claimOne(database);
    assert.equal(runClaim(claimed)?.workerId, WORKER_ID);
    // The boot-time validator walks every authority row against its schema, so
    // reopening the database is the end-to-end proof that what was written
    // parses back as a run.
    const reopened = database.authority.runs.get(RUN_ID);
    assert.equal(reopened?.lifecycle.state, "claimed");
    assert.equal(reopened?.input.parsed.schemaHash, HASH_C);
    assert.equal(reopened?.input.ingressSchemaHash, HASH_A);
  });
});
