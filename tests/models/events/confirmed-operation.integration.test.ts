import { createWriteSequencerTestWorld } from "../../support/helpers/backend/write-sequencer-world.js";
import { reconstructConfirmedOperation } from "../../../src/models/events/confirmed-operation.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { absentProbeEvidence, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/write-sequencer-fixtures.js";

const {harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("the seven-beat happy path", () => {
  it("probes, prepares, binds, fences before the click, and settles beat ⑦ atomically", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onCommitClick = () => {
      // Fence-before-click: the durable attempting intent exists BEFORE the click.
      const fenced = intentByKey(h.database);
      assert.ok(fenced);
      assert.equal(fenced.status, "attempting");
    };

    const outcome = await h.execute(contextFor(run, claim));
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });

    // Exact ordering: probe → prepare → fresh subject observation → click.
    assert.deepEqual(h.world.events, [
      "probe",
      "prepare",
      `subject-read:${WRITE_FIXTURE_OBSERVATION}`,
      "commit-click:ucpath.write-fixture.save-submit",
    ]);

    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.equal(intent.generation, 1);
    assert.deepEqual(intent.completionProof.value, { transactionId: "T123456" });
    const attempt = h.database.authority.writeAttempts.get(intent.currentAttemptId);
    assert.ok(attempt && attempt.outcome.state === "committed");

    const confirmation = h.database.authority.timelineEvents.page({}).find((row) => row.payload.kind === "operation-confirmed");
    assert.ok(confirmation);
    const { ledger, span } = reconstructConfirmedOperation(h.database.authority, confirmation);
    assert.equal(ledger.idempotencyKey, WRITE_FIXTURE_KEY);
    assert.equal(ledger.proofSource, "normal-output");
    assert.equal(ledger.operator, "local-operator");
    assert.equal(ledger.instance, "prod");
    assert.equal(span.kind, "write-committed-span");

    // The transaction checkpoint retains the durable TransactionOutcome.
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    const stored = checkpoint.output.value as { disposition: string; proofSource: string };
    assert.equal(stored.disposition, "committed");
    assert.equal(stored.proofSource, "normal-output");

    // The run advanced within running under the same claim, and nothing poisoned.
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.lifecycle.state === "running");
    assert.ok(current.version > run.version);
    assert.deepEqual(h.sessions.closeReasons(), []);

    // Every task role is opened and closed; the receipt arm has no verifier.
    assert.deepEqual(
      h.emitter.events().map((event) => [event.t, event.spanPath]),
      [
        ["span.started", "wf-090000-2222/submit-write/probe"],
        ["data.observed", "wf-090000-2222/submit-write/probe"],
        ["span.ended", "wf-090000-2222/submit-write/probe"],
        ["span.started", "wf-090000-2222/submit-write/prepare"],
        ["data.observed", "wf-090000-2222/submit-write/prepare"],
        ["span.ended", "wf-090000-2222/submit-write/prepare"],
        ["span.started", "wf-090000-2222/submit-write/commit"],
        ["transaction.fenced", "wf-090000-2222/submit-write/commit"],
        ["data.observed", "wf-090000-2222/submit-write/commit"],
        ["span.ended", "wf-090000-2222/submit-write/commit"],
      ],
    );
  });
});
