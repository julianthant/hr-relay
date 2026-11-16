import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";

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

  it("Not saved only confirms absence: the intent turns retryable, and the next attempt probes before it prepares or clicks", async () => {
    const harness = await roundTrip();
    await harness.park();
    const intent = parkedIntent(harness.database);
    const parked = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(parked);
    const command = resolutionCommand("resolve-write-absent", { runId: WRITE_FIXTURE_RUN_ID, expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
    assert.equal(harness.kernel.execute(command).state, "applied");
    const resolved = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(resolved?.status === "retryable" && resolved.settlement.state === "operator-confirmed-absent");
    assert.equal(harness.database.authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1, "the answer itself starts no attempt");

    harness.world.events.length = 0;
    harness.world.probeResults.push({ state: "present", proof: { transactionId: "T998877" } });
    await harness.resume();
    assert.equal(harness.world.events[0], "probe");
    assert.equal(harness.world.events.some(event => /prepare|commit-click/u.test(event)), false, "a present probe files nothing again");
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
