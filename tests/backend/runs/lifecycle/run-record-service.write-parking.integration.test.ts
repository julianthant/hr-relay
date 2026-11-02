import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { createProfileFixtureSet, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { buildGateParkSection } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { testWorkerLifetime, testRunService, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
ITEM_ID,
QUEUED_RUN,
RUN_ID,
WORKFLOW_ID,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const MUCH_LATER = "2026-07-31T18:00:00.000Z";

const WORKER_ID = "person-lookup-worker-1";
const SIBLING_WORKER_ID = "person-lookup-worker-2";
const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const databases: AuthorityDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    for (const run of database.authority.runs.listByWorkflow(WORKFLOW_ID)) {
      for (const intent of database.authority.writeIntents.listByRun(run.envelope.runId)) {
        if (intent.status !== "attempting") continue;
        database.authority.writeIntents.parkAttempt({ writeIntentId: intent.writeIntentId, generation: intent.generation,
          expectedVersion: intent.version, code: "unknown", message: "fixture release",
          authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "fixture release"), now: MUCH_LATER });
      }
      if (run.lifecycle.state === "parked-write") {
        const intent = database.authority.writeIntents.get(run.lifecycle.writeIntentId);
        if (intent === undefined || !("runId" in intent) || intent.runId !== run.envelope.runId) {
          assert.equal(database.authority.runs.transition({ runId: run.envelope.runId,
            expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: MUCH_LATER }, now: MUCH_LATER }).state, "applied");
        }
      }
    }
    releaseSeededWriteOwners(database, MUCH_LATER);
    database.close();
  }
  for (const profile of heldProfiles.splice(0)) await profile.close();
});

async function openDatabase(): Promise<AuthorityDatabase> {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  for (const poolIndex of [1, 2]) testWorkerPorts(database, manualClock(new Date(NOW)), { path: profile.path, descriptor: personLookupDescriptor, poolIndex });
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
    lifecycle: { state: "validating", workerId, workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember5.poolIndex).workerLifetime, claimedAt: NOW, heartbeatAt: NOW },
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
      workerLifetime: testWorkerLifetime(database, WORKFLOW_ID, claimMember5.poolIndex).workerLifetime,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: "searching",
    },
    now: NOW,
  });
  assert.equal(running.state, "applied");
}

describe("write parking and recovery fencing", () => {
  it("records exactly one parked event with its journal and rolls it back with the park", async () => {
    const database = await openDatabase();
    claimAndRun(database, "running");
    fenceWriteFixture(database, { intent: PERSON_LOOKUP_ATTEMPTING_INTENT, attempt: PERSON_LOOKUP_WRITE_ATTEMPT });
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    const before = database.authority.runs.get(RUN_ID); assert.ok(before);
    const request = { commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", runId: RUN_ID,
      expectedVersion: before.version, claim: { workerId: WORKER_ID, claimGeneration: before.claimGeneration }, cause: "recovery" };
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

  it("records the normal intent park, run park and event atomically without retry authority", async () => {
    const database = await openDatabase();
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

  it("records a recovery park on its actual run without adopting the earlier write owner's span or serving its decision", async () => {
    const database = await openDatabase();
    claimAndRun(database, "running");
    const runId = "33333333-3333-4333-8333-333333333333";
    const later = { ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, traceId: "pl-170000-3333", attempt: 2, retryOf: RUN_ID } };
    claimAndRun(database, "running", later, SIBLING_WORKER_ID);
    fenceWriteFixture(database, { intent: PERSON_LOOKUP_ATTEMPTING_INTENT, attempt: PERSON_LOOKUP_WRITE_ATTEMPT });
    const current = database.authority.runs.get(runId); assert.ok(current);
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    const result = service.requeue({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", runId,
      expectedVersion: current.version, claim: { workerId: SIBLING_WORKER_ID, claimGeneration: current.claimGeneration }, cause: "recovery" });
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

  it("refuses a malformed recorded prepare owner without parking or recording a guessed node", async () => {
    const database = await openDatabase();
    claimAndRun(database, "running");
    const proof = { ...PERSON_LOOKUP_PROOF, afterPrepareSpanPath: "foreign/termination/prepare" };
    const bindingProofDigest = deriveWriteBindingProofDigest(proof);
    fenceWriteFixture(database, { intent: { ...PERSON_LOOKUP_ATTEMPTING_INTENT, bindingProof: proof, bindingProofDigest },
      attempt: { ...PERSON_LOOKUP_WRITE_ATTEMPT, bindingProof: proof, bindingProofDigest } });
    const current = database.authority.runs.get(RUN_ID); assert.ok(current);
    const service = testRunService(database, manualClock(new Date(MUCH_LATER)));
    assert.throws(() => service.requeue({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", runId: RUN_ID,
      expectedVersion: current.version, claim: { workerId: WORKER_ID, claimGeneration: current.claimGeneration }, cause: "recovery" }), /timeline-parked-write-node-mismatch/);
    assert.deepEqual(database.authority.runs.get(RUN_ID), current);
    assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).filter(record => record.payload.kind === "write-parked").length, 0);
  });

});
