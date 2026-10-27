import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureProofSchema } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { cleanup, roundTrip, parkedIntent, resolutionCommand } = createParkedWriteRoundTripTestWorld();


afterEach(cleanup);

describe("post-fence park → typed outcome arm → typed operator resolution", () => {

  it("confirmed-present settles the same beat ⑦ bundle and resumes the run", async () => {
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

    const command = resolutionCommand("resolve-write-present", {
      runId: WRITE_FIXTURE_RUN_ID,
      expectedVersion: parked.version,
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
    }, {
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        value: { transactionId: "T998877" },
      },
    });
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "applied");

    const settled = harness.database.authority.writeIntents.get(intent.writeIntentId);
    assert.ok(settled && settled.status === "committed");
    const resumed = harness.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(resumed && resumed.lifecycle.state === "queued");
    assert.equal(resumed.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    // The operator attestation is durable as the node's transaction outcome.
    const checkpoint = harness.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID,
      parked.envelope.itemId,
      WRITE_FIXTURE_NODE_ID,
    );
    assert.ok(checkpoint);
    const nestedId = lifecycleCommandId("operator-present", command.commandId);
    assert.notEqual(nestedId, command.commandId);
    assert.ok(harness.database.authority.commands.get(command.commandId));
    const nested = harness.database.authority.lifecycleJournal.getCommand(nestedId);
    assert.ok(nested && "kind" in nested && nested.kind === "run-lifecycle");
    const generation = harness.database.getMeta().authorityGeneration;
    assert.equal(harness.kernel.execute(command).state, "already-applied");
    assert.equal(harness.database.getMeta().authorityGeneration, generation);
  });
});
