import { buildGateParkSection } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { fenceWriteFixture, seedCorruptWriteFenceFixture } from "../../../support/helpers/write-fence-fixture.js";
import { sweepWorkerClaims } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { testWorkerLifetime, testRunLifecycle,testRunService,testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it,vi } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { deriveWriteBindingProofDigest, deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import {
HASH_A,
LATER,
NOW,
UUID_7,
WRITE_ATTEMPT,
WRITE_INTENT_ATTEMPTING,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
ITEM_ID,
QUEUED_RUN,
RUN_ID,
WORKFLOW_ID,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const OBSERVED_PRESENT_WRITE_INTENT = {
  writeIntentId: UUID_7,
  workflowId: "separation",
  itemId: UUID_7,
  taskId: "ucpath/terminate-person",
  system: "ucpath",
  idempotencyKey: "10101010|termination|2026-08-02",
  idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10101010|termination|2026-08-02"),
  generation: 1,
  status: "observed-present",
  observedProof: { schemaHash: HASH_A, value: "receipt-seen-during-recovery" },
  observedAt: NOW,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const MUCH_LATER = "2026-07-31T18:00:00.000Z";

const WORKER_ID = "person-lookup-worker-1";
const SIBLING_WORKER_ID = "person-lookup-worker-2";
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-claim-sweep-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  for (const poolIndex of [1, 2]) testWorkerPorts(database, manualClock(new Date(NOW)), { path: join(root, "authority.sqlite"), descriptor: personLookupDescriptor, poolIndex });
  databases.push(database);
  return database;
}

/** The attempting intent, rebound to the person-lookup run fixture's item. */
const PERSON_LOOKUP_PROOF = { ...WRITE_INTENT_ATTEMPTING.bindingProof,
  afterPrepareSpanPath: `${QUEUED_RUN.envelope.traceId}/termination/prepare` };
const PERSON_LOOKUP_ATTEMPTING_INTENT = {
  ...WRITE_INTENT_ATTEMPTING,
  workflowId: WORKFLOW_ID,
  itemId: ITEM_ID,
  bindingProof: PERSON_LOOKUP_PROOF, bindingProofDigest: deriveWriteBindingProofDigest(PERSON_LOOKUP_PROOF),
};
const PERSON_LOOKUP_WRITE_ATTEMPT = { ...WRITE_ATTEMPT,
  bindingProof: PERSON_LOOKUP_PROOF, bindingProofDigest: deriveWriteBindingProofDigest(PERSON_LOOKUP_PROOF) };

function claimAndRun(database: AuthorityDatabase, target: "claimed" | "running", queued = QUEUED_RUN, workerId = WORKER_ID): void {
  database.authority.runs.enqueue(queued);
  const claimMember5 = database.authority.workerSlots.get(workerId);
  if (claimMember5 === undefined) throw new Error("fixture-claim-member-required");
  const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember5.poolIndex).workerLifetime, workflow: WORKFLOW_ID, workerId, now: NOW });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed" || target === "claimed") return;
  const validating = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: claimed.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  assert.equal(validating.state, "applied");
  if (validating.state !== "applied") return;
  const running = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: validating.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: {
      state: "running",
      workerId,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: "searching",
    },
    now: NOW,
  });
  assert.equal(running.state, "applied");
}

describe("expired-claim sweep write-intent gate", () => {
  it("records exactly one parked event with its journal and rolls it back with the park", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, { intent: PERSON_LOOKUP_ATTEMPTING_INTENT, attempt: PERSON_LOOKUP_WRITE_ATTEMPT });
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    const before = database.authority.runs.get(RUN_ID); assert.ok(before);
    const request = { commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", runId: RUN_ID,
      expectedVersion: before.version, staleBefore: MUCH_LATER, cause: "recovery" };
    const events = () => database.authority.timelineEvents.page({ runId: RUN_ID }).filter(record => record.payload.kind === "write-parked");
    assert.throws(() => database.withAuthorityTransaction(() => {
      assert.equal(service.requeue(request).state, "recovery-required");
      assert.equal(events().length, 1);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "parked-write");
      throw new Error("rollback parked event");
    }), /rollback parked event/);
    assert.deepEqual(database.authority.runs.get(RUN_ID), before);
    assert.equal(database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
    assert.deepEqual(events(), []);
    assert.equal(service.requeue(request).state, "recovery-required");
    const event = events()[0]; assert.ok(event);
    assert.deepEqual(event.payload, { kind: "write-parked", runId: RUN_ID, workflow: WORKFLOW_ID,
      attempt: before.envelope.attempt, traceId: before.envelope.traceId, nodeId: "termination",
      writeIntentId: PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId, generation: 1 });
    assert.ok(event.cursor > 0);
    assert.equal(service.requeue(request).state, "applied-already");
    assert.equal(events().length, 1);
    assert.equal(database.authority.writeIntents.get(PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId)?.status, "attempting");
  });

  it("records the normal intent park, run park and event atomically without retry authority", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, { intent: PERSON_LOOKUP_ATTEMPTING_INTENT, attempt: PERSON_LOOKUP_WRITE_ATTEMPT });
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    const before = database.authority.runs.get(RUN_ID); assert.ok(before);
    const request = { commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff", runId: RUN_ID, expectedVersion: before.version,
      claim: { workerId: WORKER_ID, claimGeneration: before.claimGeneration }, lifecycle: { state: "parked-write",
        writeIntentId: PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId, intentGeneration: 1,
        parkedAt: MUCH_LATER, code: "unknown", message: "post-fence unknown" } };
    const park = () => database.withAuthorityTransaction(repositories => {
      repositories.writeIntents.parkAttempt({ writeIntentId: PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId,
        generation: 1, expectedVersion: 1, code: "unknown", message: "post-fence unknown",
        authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "post-fence unknown"), now: MUCH_LATER });
      assert.equal(service.workerTransition(request).state, "applied");
    });
    const intentBefore = database.authority.writeIntents.get(PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId);
    assert.throws(() => database.withAuthorityTransaction(() => { park(); throw new Error("rollback normal park"); }), /rollback normal park/);
    assert.deepEqual(database.authority.runs.get(RUN_ID), before);
    assert.deepEqual(database.authority.writeIntents.get(PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId), intentBefore);
    assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).filter(record => record.payload.kind === "write-parked").length, 0);
    park();
    assert.equal(database.authority.writeIntents.get(PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId)?.status, "parked");
    assert.equal(service.workerTransition(request).state, "applied-already");
    assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).filter(record => record.payload.kind === "write-parked").length, 1);
  });

  it("records a recovery park on its actual run without adopting the earlier write owner's span or serving its decision", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    const runId = "33333333-3333-4333-8333-333333333333";
    const later = { ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, traceId: "pl-170000-3333", attempt: 2, retryOf: RUN_ID } };
    claimAndRun(database, "running", later, SIBLING_WORKER_ID);
    fenceWriteFixture(database, { intent: PERSON_LOOKUP_ATTEMPTING_INTENT, attempt: PERSON_LOOKUP_WRITE_ATTEMPT });
    const current = database.authority.runs.get(runId); assert.ok(current);
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    const result = service.requeue({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", runId,
      expectedVersion: current.version, staleBefore: MUCH_LATER, cause: "recovery" });
    assert.equal(result.state, "recovery-required");
    const events = database.authority.timelineEvents.page({ runId }).filter(record => record.payload.kind === "write-parked");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload, { kind: "write-parked", runId, workflow: WORKFLOW_ID,
      attempt: current.envelope.attempt, traceId: later.envelope.traceId, nodeId: "termination",
      writeIntentId: PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId, generation: 1 });
    assert.equal(database.authority.runs.get(runId)?.lifecycle.state, "parked-write");
    assert.equal(database.authority.writeIntents.get(PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId)?.status, "attempting");
    assert.throws(() => buildGateParkSection({ runReader: service,
      authority: { getWriteIntent: (id: string) => database.authority.writeIntents.get(id) },
    } as unknown as RunDetailQueryDeps, runId, "parked-write"), /which is attempting/);
  });

  it("refuses a malformed recorded prepare owner without parking or recording a guessed node", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    const proof = { ...PERSON_LOOKUP_PROOF, afterPrepareSpanPath: "foreign/termination/prepare" };
    const bindingProofDigest = deriveWriteBindingProofDigest(proof);
    fenceWriteFixture(database, { intent: { ...PERSON_LOOKUP_ATTEMPTING_INTENT, bindingProof: proof, bindingProofDigest },
      attempt: { ...PERSON_LOOKUP_WRITE_ATTEMPT, bindingProof: proof, bindingProofDigest } });
    const current = database.authority.runs.get(RUN_ID); assert.ok(current);
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    assert.throws(() => service.requeue({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", runId: RUN_ID,
      expectedVersion: current.version, staleBefore: MUCH_LATER, cause: "recovery" }), /timeline-parked-write-node-mismatch/);
    assert.deepEqual(database.authority.runs.get(RUN_ID), current);
    assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).filter(record => record.payload.kind === "write-parked").length, 0);
  });

  it("parks a running run with an attempting intent as parked-write instead of requeueing", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, {
      intent: PERSON_LOOKUP_ATTEMPTING_INTENT,
      attempt: PERSON_LOOKUP_WRITE_ATTEMPT,
    });

    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), { staleBefore: MUCH_LATER, now: MUCH_LATER });
    assert.equal(swept.length, 1);
    const outcome = swept[0];
    assert.ok(outcome);
    assert.equal(outcome.state, "recovery-required");
    if (outcome.state !== "recovery-required") return;
    assert.equal(outcome.parked, true);
    assert.equal(outcome.writeIntentId, PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId);
    assert.equal(outcome.intentGeneration, 1);
    assert.match(outcome.message, /unfinished attempting write intent/);

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "parked-write");
    if (run.lifecycle.state === "parked-write") {
      assert.equal(run.lifecycle.code, "unknown");
      assert.equal(run.lifecycle.writeIntentId, PERSON_LOOKUP_ATTEMPTING_INTENT.writeIntentId);
    }

    assert.equal(run.envelope.attempt, 1);
    const claimMember1 = database.authority.workerSlots.get(SIBLING_WORKER_ID);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const reclaim = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember1.poolIndex).workerLifetime,
      workflow: WORKFLOW_ID,
      workerId: SIBLING_WORKER_ID,
      now: MUCH_LATER,
    });
    assert.equal(reclaim.state, "idle");
  });

  it("leaves a claimed run with an attempting intent unclaimable under its expired claim", () => {
    const database = openDatabase();
    claimAndRun(database, "claimed");
    seedCorruptWriteFenceFixture(database, {
      intent: PERSON_LOOKUP_ATTEMPTING_INTENT,
      attempt: PERSON_LOOKUP_WRITE_ATTEMPT,
    }, DatabaseSync);

    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), { staleBefore: MUCH_LATER, now: MUCH_LATER });
    assert.equal(swept.length, 1);
    const outcome = swept[0];
    assert.ok(outcome && outcome.state === "recovery-required");
    if (outcome.state !== "recovery-required") return;
    assert.equal(outcome.parked, false);

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "claimed");
    const claimMember2 = database.authority.workerSlots.get(SIBLING_WORKER_ID);
    if (claimMember2 === undefined) throw new Error("fixture-claim-member-required");
    const reclaim = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember2.poolIndex).workerLifetime,
      workflow: WORKFLOW_ID,
      workerId: SIBLING_WORKER_ID,
      now: MUCH_LATER,
    });
    assert.equal(reclaim.state, "idle");
  });

  it("requeues ordinarily when the item has no unfinished attempting intent", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    // A settled observed-present intent on the same item is NOT recovery work.
    database.authority.writeIntents.recordObservedPresent({
      ...OBSERVED_PRESENT_WRITE_INTENT,
      workflowId: WORKFLOW_ID,
      itemId: ITEM_ID,
    });

    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), { staleBefore: MUCH_LATER, now: MUCH_LATER });
    assert.equal(swept.length, 1);
    const outcome = swept[0];
    assert.ok(outcome && outcome.state === "applied");
    if (outcome.state !== "applied") return;
    assert.equal(outcome.run.lifecycle.state, "queued");
    assert.equal(outcome.run.envelope.attempt, 1, "recovery retains the item attempt");
    const requeuedFrom = outcome.run.lifecycle.state === "queued"
      ? outcome.run.lifecycle.requeuedFrom
      : undefined;
    assert.equal(requeuedFrom, "recovery");
    const claimMember3 = database.authority.workerSlots.get(SIBLING_WORKER_ID);
    if (claimMember3 === undefined) throw new Error("fixture-claim-member-required");
    const reclaim = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember3.poolIndex).workerLifetime,
      workflow: WORKFLOW_ID,
      workerId: SIBLING_WORKER_ID,
      now: LATER,
    });
    assert.equal(reclaim.state, "claimed");
  });



  /** A second queued run on its own logical item, for a sibling worker. */
  const SIBLING_RUN = {
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId: "77777777-7777-4777-8777-777777777777",
      itemId: "88888888-8888-4888-8888-888888888888",
      traceId: "pl-170001-7777",
    },
  };

  it("releases only the named worker's rows, leaving a live sibling's fresh claim alone", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    database.authority.runs.enqueue(SIBLING_RUN);
    const claimMember4 = database.authority.workerSlots.get(SIBLING_WORKER_ID);
    if (claimMember4 === undefined) throw new Error("fixture-claim-member-required");
    const sibling = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember4.poolIndex).workerLifetime,
      workflow: WORKFLOW_ID,
      workerId: SIBLING_WORKER_ID,
      now: NOW,
    });
    assert.equal(sibling.state, "claimed");

    // Startup sweep scopes staleBefore to the reclaimed worker so live peers remain untouched.
    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), {
      workerId: WORKER_ID,
      now: NOW,
    });
    assert.equal(swept.length, 1);
    assert.equal(swept[0]?.state, "applied");
    assert.equal(swept[0]?.run.envelope.runId, RUN_ID);

    const siblingRun = database.authority.runs.get(SIBLING_RUN.envelope.runId);
    assert.equal(siblingRun?.lifecycle.state, "claimed", "a live sibling worker's claim was swept");
  });

  it("parks — never requeues — the named worker's running row that holds an attempting intent", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, {
      intent: PERSON_LOOKUP_ATTEMPTING_INTENT,
      attempt: PERSON_LOOKUP_WRITE_ATTEMPT,
    });


    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), {
      workerId: WORKER_ID,
      now: NOW,
    });
    assert.equal(swept.length, 1);
    const outcome = swept[0];
    assert.ok(outcome && outcome.state === "recovery-required");
    if (outcome.state !== "recovery-required") return;
    assert.equal(outcome.parked, true);

    const run = database.authority.runs.get(RUN_ID);
    assert.equal(run?.lifecycle.state, "parked-write");
    assert.equal(run?.envelope.attempt, 1, "a parked run must not take a new attempt");
    assert.equal(
      database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, 1).workerLifetime, workflow: WORKFLOW_ID, workerId: WORKER_ID, now: LATER }).state,
      "idle",
      "the parked row must not be claimable, but it must no longer wedge the worker id",
    );
  });

  it("leaves the named worker's CLAIMED row with an attempting intent held, and says so", () => {
    const database = openDatabase();
    claimAndRun(database, "claimed");
    seedCorruptWriteFenceFixture(database, {
      intent: PERSON_LOOKUP_ATTEMPTING_INTENT,
      attempt: PERSON_LOOKUP_WRITE_ATTEMPT,
    }, DatabaseSync);

    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), {
      workerId: WORKER_ID,
      now: NOW,
    });
    assert.equal(swept.length, 1);
    assert.equal(swept[0]?.state, "recovery-required");

    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "claimed");
    assert.equal(database.authority.runs.listByWorker(WORKER_ID).length, 1);
  });

  it("does not gate a run in a DIFFERENT workflow/item on this item's intent", () => {
    const database = openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, {
      intent: {
        ...PERSON_LOOKUP_ATTEMPTING_INTENT,
        // The intent belongs to ANOTHER logical item entirely.
        itemId: "99999999-9999-4999-8999-999999999999",
      },
      attempt: PERSON_LOOKUP_WRITE_ATTEMPT,
    });

    const swept = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))), { staleBefore: MUCH_LATER, now: MUCH_LATER });
    assert.equal(swept.length, 1);
    assert.equal(swept[0]?.state, "applied");
  });
});


describe("recovery cancellation publication", () => {
  it("commits cancellation once with the sweep, rolling it back with the outer transaction", () => {
    const database = openDatabase();
    claimAndRun(database, "claimed");
    const clock = manualClock(new Date(MUCH_LATER));
    const service = testRunService(database, clock);
    const current = database.authority.runs.get(RUN_ID);
    assert.ok(current);
    assert.equal(service.transition({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      runId: RUN_ID, expectedVersion: current.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: MUCH_LATER } }).state, "applied");
    const published = () => database.authority.timelineEvents.page({ runId: RUN_ID }).flatMap((record) =>
      record.payload.kind === "span" && record.payload.event.t === "span.ended" && record.payload.event.kind === "run"
        && record.payload.event.outcome === "cancelled" ? [record.scope.kind === "run" ? record.scope.runId : "invalid"] : []);
    const sweep = () => sweepWorkerClaims(database, testRunLifecycle(database, clock),
      { staleBefore: MUCH_LATER, now: MUCH_LATER });
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => database.withAuthorityTransaction(() => {
      sweep();
      assert.deepEqual(published(), [RUN_ID], "cancellation event participates in the outer transaction");
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "terminal");
      throw new Error("outer sweep rollback");
    }), /outer sweep rollback/);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(published(), []);
    database.withAuthorityTransaction(() => {
      sweep();
      assert.deepEqual(published(), [RUN_ID], "cancellation event participates in the outer transaction");
    });
    assert.deepEqual(published(), [RUN_ID]);
    const committed = database.getMeta().authorityGeneration;
    assert.deepEqual(sweep(), []);
    assert.deepEqual(published(), [RUN_ID]);
    assert.equal(database.getMeta().authorityGeneration, committed);
  });
});


describe("bounded recovery candidate selection", () => {
  it("selects active stale claims in SQLite instead of enumerating retained workflow history", () => {
    const database = openDatabase();
    claimAndRun(database, "claimed");
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      const outcomes = sweepWorkerClaims(database, testRunLifecycle(database, manualClock(new Date(MUCH_LATER))),
        { staleBefore: MUCH_LATER, now: MUCH_LATER });
      assert.equal(outcomes.length, 1);
      const queries = spy.mock.calls.map(([sql]) => sql.replace(/\s+/gu, " ").trim());
      assert.ok(queries.some((sql) => sql.includes("WHERE state IN ('claimed', 'validating', 'running')")
        && sql.includes("AND heartbeat_at < ?")), "recovery must filter active/stale rows before reading their JSON");
      assert.equal(queries.some((sql) => sql.startsWith("SELECT DISTINCT workflow FROM runs")), false);
      assert.equal(queries.some((sql) => sql === "SELECT * FROM runs WHERE workflow = ? ORDER BY created_at, id"), false);
    } finally {
      spy.mockRestore();
    }
  });
});
