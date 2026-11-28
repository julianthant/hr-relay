import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { buildGateParkSection } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { assertCredentialCopyResourcesClosed, assertLogoutResourcesClosed, assertShutdownResourcesClosed } from "../../../../src/backend/storage/maintenance/profile-custody.js";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { cleanup, roundTrip, parkedIntent, resolutionCommand } = createParkedWriteRoundTripTestWorld();


afterEach(cleanup);

describe("post-fence park → typed outcome arm → typed operator resolution", () => {

  it("recheck settles the same beat ⑦ bundle and resumes the run", async () => {
    const harness = await roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);

    const parks = harness.database.authority.timelineEvents.page({ runId: WRITE_FIXTURE_RUN_ID })
      .filter(record => record.payload.kind === "write-parked");
    assert.equal(parks.length, 1);
    assert.deepEqual(parks[0].payload, { kind: "write-parked", runId: WRITE_FIXTURE_RUN_ID,
      workflow: WRITE_FIXTURE_WORKFLOW_ID, attempt: parked.envelope.attempt, traceId: parked.envelope.traceId,
      nodeId: WRITE_FIXTURE_NODE_ID, writeIntentId: intent.writeIntentId, generation: intent.generation });

    const command = resolutionCommand("recheck-write", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, {});
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "applied");

    harness.world.events.length = 0;
    harness.world.probeResults.push({ state: "present", proof: { transactionId: "T998877" } });
    assert.equal((await harness.resume()).outcomes[0]?.state, "done");
    assert.equal(harness.world.events.some(event => /prepare|stage|fence|commit-click/u.test(event)), false);
    const settled = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled && settled.status === "committed");
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "terminal");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    // The read proof is durable as the transaction outcome.
    const checkpoint = harness.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID,
      parked.envelope.itemId,
      WRITE_FIXTURE_NODE_ID,
    );
    assert.ok(checkpoint);
    const nestedId = lifecycleCommandId("write-recheck", command.commandId);
    assert.notEqual(nestedId, command.commandId);
    assert.ok(harness.database.authority.commands.get(command.commandId));
    const nested = harness.database.authority.lifecycleJournal.getCommand(nestedId);
    assert.ok(nested && "kind" in nested && nested.kind === "run-lifecycle");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
  });

  it("Not saved queues a read that settles a saved write against the original attempt", async () => {
    const harness = await roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    const command = resolutionCommand("resolve-write-absent", { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
    assert.equal(harness.kernel.execute(command).state, "applied");
    const requested = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(requested?.status === "parked" && requested.recheck?.commandId === command.commandId);
    assert.equal(harness.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1, "the answer itself starts no attempt");

    harness.world.events.length = 0;
    harness.world.probeResults.push({ state: "present", proof: { transactionId: "T998877" } });
    assert.equal((await harness.resume()).outcomes[0]?.state, "done");
    assert.equal(harness.world.events[0], "probe");
    assert.equal(harness.world.events.some(event => /prepare|commit-click/u.test(event)), false, "a present probe files nothing again");
    const saved = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(saved?.status === "committed");
    assert.equal(saved.resolution?.writeAttemptId, requested.currentAttemptId);
    assert.deepEqual(saved.completionProof.value, { transactionId: "T998877" });
  });

  it("file again leaves a read-back failure parked when the fresh read is indeterminate", async () => {
    const harness = await roundTrip(writeFixtureSaveDescriptor, undefined, writeFixtureSaveDescriptor);
    harness.world.verifyResults.push({ state: "unknown", reason: "Read unavailable", observedAt: WRITE_FIXTURE_NOW });
    await harness.park(false);
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(intent.status === "parked" && parked?.lifecycle.state === "parked-write");
    const command = resolutionCommand("resolve-write-absent", { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
    assert.equal(harness.kernel.execute(command).state, "applied");

    harness.world.events.length = 0;
    harness.world.probeResults.push({ state: "unknown", reason: "Read unavailable", observedAt: WRITE_FIXTURE_NOW });
    assert.equal((await harness.resume()).outcomes[0]?.state, "parked-write");
    assert.deepEqual(harness.world.events, ["probe"]);
    const retained = parkedIntent(harness.database);
    assert.ok(retained.status === "parked" && retained.generation === intent.generation);
    assert.equal(harness.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);

    const { database, clock, profile } = harness;
    const reader = testRunService(database, clock);
    const descriptors = { resolve: (id: string) => id === WRITE_FIXTURE_WORKFLOW_ID ? writeFixtureSaveDescriptor : undefined };
    const projection = createOperatorProjection({ database, reader, descriptors, clock, stateRoot: profile.stateRoot,
      appVersion: "0.1.0", descriptorSetHash: writeFixtureSaveDescriptor.contractFingerprint,
      ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
    const deps = createOperatorRunDetail({ database, projection, runReader: reader, stateRoot: profile.stateRoot,
      canonical: { database, reader, descriptors } });
    const parks = database.authority.timelineEvents.page({ runId: WRITE_FIXTURE_RUN_ID }).filter(event => event.payload.kind === "write-parked");
    assert.equal(parks.length, 2);
    const section = buildGateParkSection(deps, WRITE_FIXTURE_RUN_ID, "parked-write");
    assert.ok(section.section === "parked-write");
    assert.equal(section.payload.native?.eventId, parks[1]?.eventId);
    assert.deepEqual(section.payload.decision?.options.map(option => option.id), ["check-again", "saved", "not-saved", "mark-as-failed"]);
  });

  it("ends a read-back failure without reading or filing and retains the fenced write", async () => {
    const harness = await roundTrip(writeFixtureSaveDescriptor, undefined, writeFixtureSaveDescriptor);
    harness.world.verifyResults.push({ state: "unknown", reason: "Read unavailable", observedAt: WRITE_FIXTURE_NOW });
    await harness.park(false);
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(intent.status === "parked" && parked?.lifecycle.state === "parked-write");
    const target = { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version, writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation };
    assert.notEqual(harness.kernel.execute(resolutionCommand("fail-read-back", { ...target, expectedVersion: parked.version + 1 }, {})).state, "applied");
    assert.equal(harness.kernel.execute(resolutionCommand("fail-read-back", target, {})).state, "applied");

    harness.world.events.length = 0;
    assert.equal((await harness.resume()).outcomes[0]?.state, "failed");
    assert.deepEqual(harness.world.events, []);
    const ended = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(ended?.lifecycle.state === "terminal" && ended.lifecycle.outcome === "failed" && ended.lifecycle.failureId !== undefined);
    const failure = harness.database.authority.failures.get(ended.lifecycle.failureId);
    assert.equal(failure?.code, "RUN_READ_BACK_FAILED");
    assert.equal(failure?.writeState, "unknown");
    assert.deepEqual(failure?.writeAuthorityReason, intent.authorityReason);
    const retained = parkedIntent(harness.database);
    assert.ok(retained.status === "parked" && retained.recheck === undefined);
    assert.equal(retained.currentAttemptId, intent.currentAttemptId);
    assert.equal(harness.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);

    const custody = harness.database.readProfileResourceCustody();
    assert.doesNotThrow(() => assertShutdownResourcesClosed(custody));
    assert.throws(() => assertShutdownResourcesClosed({ ...custody, failedReadBackWriteAttempts: [] }), /profile-shutdown-custody-unproved/u);
    assert.throws(() => assertShutdownResourcesClosed({ ...custody, runs: [] }), /profile-shutdown-custody-unproved/u);
    assert.throws(() => assertCredentialCopyResourcesClosed(custody), /credential-maintenance-custody-unproved/u);
    assert.throws(() => assertLogoutResourcesClosed(custody), /credential-maintenance-custody-unproved/u);
    const deletion = harness.kernel.execute({ commandId: randomUUID(), requestedAt: WRITE_FIXTURE_NOW, requestedBy: "local-operator",
      source: "run-detail", family: "run", type: "delete", target: { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: ended.version } });
    assert.ok(deletion.state === "rejected" && deletion.code === "policy-refused");
    assert.ok(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID));

    const next = randomUUID();
    harness.enqueue(next, 2);
    const outcome = (await harness.resume()).outcomes[0];
    assert.ok(outcome?.state === "failed" && outcome.runId === next);
    assert.deepEqual(harness.world.events, []);
    assert.deepEqual(parkedIntent(harness.database), retained);
  });

  it("refuses Mark as failed on a parked write: the run stays parked and the intent UNKNOWN", async () => {
    const harness = await roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    const result = harness.kernel.execute({ commandId: randomUUID(), requestedAt: harness.clock.now().toISOString(), requestedBy: "local-operator",
      source: "run-detail", family: "failure-resolution", type: "annotate-failure",
      target: { runId: WRITE_FIXTURE_RUN_ID, failureId: randomUUID(), expectedVersion: 1 }, payload: { action: "resolve" } });
    assert.equal(result.state, "rejected");
    assert.deepEqual(harness.database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID), parked);
  });
});
