import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { personLookupDescriptor, separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_5, UUID_6, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_EID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_SECRET_CANARY, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, WriteFixtureProofSchema, writeFixtureQueuedRun, writeFixtureSaveDescriptor, type WriteFixtureWorld } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const {harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

function parkLegacyAttemptingIntent(database: AuthorityDatabase, message: string): void {
  const attempting = attemptingIntentFixture(UUID_5);
  assert.equal(fenceWriteFixture(database, attempting).state, "fenced");
  database.authority.writeIntents.parkAttempt({
    writeIntentId: attempting.intent.writeIntentId,
    generation: attempting.intent.generation,
    expectedVersion: attempting.intent.version,
    code: "unknown",
    message,
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "seeded legacy park"),
    now: WRITE_FIXTURE_NOW,
  });
}

describe("the seven-beat happy path", () => {
  it("registered transaction policies probe an unseen key before any commit; person-lookup has no transaction node", async () => {
    assert.equal(descriptorRuntimeNodes(personLookupDescriptor).filter((node) => node.kind === "transaction").length, 0);
    const registered = descriptorRuntimeNodes(separationsDescriptor).filter((node) => node.kind === "transaction");
    assert.equal(registered.length, 3);
    for (const node of registered) {
      assert.equal(node.probePolicy, "always", node.id);
      const h = await harness(); const { run, claim } = claimRunning(h.database, h.clock);
      assert.equal(intentByKey(h.database), undefined);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const context = contextFor(run, claim);
      await h.execute({ ...context, node: { ...context.node, probePolicy: node.probePolicy } });
      assert.equal(h.world.events[0], "probe", node.id);
      assert.ok(h.world.events.indexOf("probe") < h.world.events.indexOf("commit-click:ucpath.write-fixture.save-submit"), node.id);
    }
  });

  it("streams the save-verify transaction as ordered probe, stage, fence, click, and read-back beats", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T123456" } });

    await h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));

    assert.deepEqual(
      h.emitter.events().map((event) => [
        event.t,
        event.spanPath,
        event.t === "data.observed" ? event.taskId : "",
      ]),
      [
        ["span.started", "wf-090000-2222/submit-write/probe", ""],
        ["data.observed", "wf-090000-2222/submit-write/probe", "ucpath/read-write-fixture-probe"],
        ["span.ended", "wf-090000-2222/submit-write/probe", ""],
        ["span.started", "wf-090000-2222/submit-write/prepare", ""],
        ["data.observed", "wf-090000-2222/submit-write/prepare", "ucpath/fill-write-fixture"],
        ["span.ended", "wf-090000-2222/submit-write/prepare", ""],
        ["span.started", "wf-090000-2222/submit-write/commit", ""],
        ["transaction.fenced", "wf-090000-2222/submit-write/commit", ""],
        ["data.observed", "wf-090000-2222/submit-write/commit", "ucpath/save-write-fixture"],
        ["span.ended", "wf-090000-2222/submit-write/commit", ""],
        ["span.started", "wf-090000-2222/submit-write/verify", ""],
        ["data.observed", "wf-090000-2222/submit-write/verify", "ucpath/read-write-fixture-verify"],
        ["span.ended", "wf-090000-2222/submit-write/verify", ""],
      ],
    );

    const observed = h.emitter.events().filter((event) => event.t === "data.observed");
    assert.equal(observed.length, 4, "one recordData call from every executed task role");
    for (const event of observed) {
      assert.equal(event.runId, WRITE_FIXTURE_RUN_ID);
      assert.equal(event.nodeId, WRITE_FIXTURE_NODE_ID);
      assert.equal(event.attempt, 1);
      assert.equal(event.observedAt, event.ts, "the event reuses its record-time instant");
    }
    const probe = observed.find((event) => event.taskId === "ucpath/read-write-fixture-probe");
    assert.ok(probe);
    const probeValues = new Map(probe.points.flatMap((point) => point.values.map((value) => [value.key, value])));
    assert.equal(probeValues.get("eid")?.transform, "allow");
    assert.deepEqual(probeValues.get("secretCanary"), {
      key: "secretCanary",
      state: "allowed",
      classification: "secret",
      transform: "allow", value: WRITE_FIXTURE_SECRET_CANARY,
    });
    const bytes = JSON.stringify(h.emitter.events());
    assert.equal(bytes.includes(WRITE_FIXTURE_SECRET_CANARY), true, "already supplied classified local evidence remains complete");
    assert.equal(bytes.includes(WRITE_FIXTURE_EID), true, "complete classified local person identifier reaches the span sink");
  });

  it("replays its own settled checkpoint byte-exact without re-clicking", async () => {
    const h = await harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(first.run, first.claim));
    h.world.events.length = 0;

    const again = await h.execute(contextFor(
      h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID) ?? first.run,
      first.claim,
    ));
    assert.deepEqual(again, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(h.world.events, [], "a replay runs no probe, prepare, observation, or click");
  });
});

describe("beat ③ — zero fence and zero click on any binding failure", () => {
  for (const [name, mutate, expected] of [
    ["mismatched subject", (world: WriteFixtureWorld) => { world.subjectEid = "10899999"; }, /subject mismatch/],
    ["unreadable subject", (world: WriteFixtureWorld) => {
      world.subjectReadThrows = new Error("stale element");
    }, /subject observation .* failed on the staged page/],
    ["driver without a semantic read", (world: WriteFixtureWorld) => { world.omitDriverRead = true; }, /exposes no semantic read/],
  ] as const) {
    it(`refuses on a ${name}`, async () => {
      const h = await harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      mutate(h.world);
      await assert.rejects(h.execute(contextFor(run, claim)), expected);
      assert.equal(intentByKey(h.database), undefined, "no fence");
      assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "no click");
      assert.deepEqual(h.sessions.closeReasons(), ["poisoned"], "the staged page was poison-closed");
      const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.equal(current?.lifecycle.state, "running", "a pre-fence refusal leaves settlement to the interpreter");
    });
  }
});

describe("beat ④ — budget expiry and CAS races discard the staged page", () => {

  it("routes a lost fence race to the winner: attempting refuses, observed-present reuses", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const foreign = attemptingIntentFixture(UUID_5);
    h.world.onPrepare = () => {
      assert.equal(fenceWriteFixture(h.database, foreign).state, "fenced");
    };
    await assert.rejects(h.execute(contextFor(run, claim)), /lost the race .* nothing was clicked/s);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));

    // Observed-present winner: the same race resolves to already-present reuse.
    const h2 = await harness();
    const second = claimRunning(h2.database, h2.clock);
    h2.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h2.world.onPrepare = () => {
      const recorded = h2.database.authority.writeIntents.recordObservedPresent({
        writeIntentId: UUID_8,
        workflowId: WRITE_FIXTURE_WORKFLOW_ID,
        itemId: WRITE_FIXTURE_ITEM_ID,
        taskId: "ucpath/submit-write-fixture",
        system: "ucpath",
        idempotencyKey: WRITE_FIXTURE_KEY,
        idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
        generation: 1,
        status: "observed-present",
        observedProof: {
          schemaHash: deriveProofSchemaHash(),
          value: { transactionId: "T777777" },
        },
        observedAt: WRITE_FIXTURE_NOW,
        version: 1,
        createdAt: WRITE_FIXTURE_NOW,
        updatedAt: WRITE_FIXTURE_NOW,
      });
      assert.equal(recorded.state, "recorded-observed-present");
    };
    const outcome = await h2.execute(contextFor(second.run, second.claim));
    assert.deepEqual(outcome, {
      disposition: "already-present",
      proofSource: "durable-intent",
      output: { transactionId: "T777777" },
      proof: { transactionId: "T777777" },
    });
    assert.ok(!h2.world.events.some((event) => event.startsWith("commit-click")));
  });
});

function deriveProofSchemaHash(): string {
  return deriveSchemaHash(WriteFixtureProofSchema, "output");
}

describe("beat ① — durable same-key dedupe", () => {
  it("refuses loudly while another run is mid-submit, before any probe or browser", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(fenceWriteFixture(h.database, attemptingIntentFixture(UUID_5)).state, "fenced");
    await assert.rejects(
      h.execute(contextFor(run, claim)),
      /another run .* is mid-submit .* refusing to double-fence/s,
    );
    assert.deepEqual(h.world.events, [], "no probe, no prepare, no click");
  });

  it("withholds a legacy parked message from real-run failure material", async () => {
    const h = await harness();
    const legacyMessage = `legacy failure for ${WRITE_FIXTURE_KEY} and standalone suffix 2345`;
    parkLegacyAttemptingIntent(h.database, legacyMessage);
    const { run, claim } = claimRunning(h.database, h.clock);

    await assert.rejects(
      h.execute(contextFor(run, claim)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /parked \(unknown\)/u);
        assert.doesNotMatch(error.message, /10812345|2345|legacy failure/u);
        return true;
      },
    );
    const parked = intentByKey(h.database);
    assert.ok(parked?.status === "parked");
    assert.equal(parked.message, legacyMessage, "presentation repair never rewrites authority evidence");
    assert.deepEqual(h.world.events, [], "no probe, prepare, recovery, or click ran");
  });

  it("reuses a committed permanent key for a later fresh item without a second fence or ledger row", async () => {
    const h = await harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(first.run, first.claim));
    const confirmationsAfterCommit = h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed");
    assert.equal(confirmationsAfterCommit.length, 1);
    h.world.events.length = 0;

    h.admitWorker(2);
    const second = claimRunning(
      h.database, h.clock,
      writeFixtureQueuedRun({ runId: UUID_5, itemId: UUID_6 }),
      "write-fixture-worker-2",
    );
    const outcome = await h.execute(contextFor(second.run, second.claim));
    assert.deepEqual(outcome, {
      disposition: "already-present",
      proofSource: "durable-intent",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(h.world.events, [], "durable reuse runs no probe, prepare, or click");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed" && intent.generation === 1);
    assert.deepEqual(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed"), confirmationsAfterCommit);
  });
});

describe("retryable re-fence (only a settled retryable key mints a new generation)", () => {
  it("fences generation 2 with a fresh binding proof and commits", async () => {
    const h = await harness();
    const now = h.clock.now().toISOString();
    const { run, claim } = claimRunning(h.database, h.clock);
    const settled = attemptingIntentFixture(run.envelope.runId);
    assert.equal(fenceWriteFixture(h.database, settled).state, "fenced");
    h.database.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.settleRetryable({
        writeIntentId: settled.intent.writeIntentId,
        generation: 1,
        expectedVersion: 1,
        settlement: {
          state: "operator-confirmed-absent",
          writeIntentId: settled.intent.writeIntentId,
          generation: 1,
          operator: "local-operator",
          confirmedAt: now,
        },
        now,
      });
    });

    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const outcome = await h.execute(contextFor(run, claim));
    assert.equal((outcome as { disposition: string }).disposition, "committed");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.equal(intent.generation, 2, "the re-fence advanced exactly one generation");
    assert.equal(intent.writeIntentId, settled.intent.writeIntentId, "the permanent row identity is retained");
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {

  it("executeDryRun probes, stages, observes the subject, and creates nothing durable", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));

    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const preview = await h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true));
    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.probe.state, "absent");
    assert.equal(
      preview.outcome.state === "would-prepare" ? preview.outcome.subject.state : undefined,
      "match",
    );
    assert.deepEqual(h.world.events, ["probe", "prepare", `subject-read:${WRITE_FIXTURE_OBSERVATION}`]);
    assert.deepEqual(h.emitter.events().map((event) => [event.t, event.spanPath]), [
      ["span.started", "wf-090000-2222/submit-write/probe"],
      ["data.observed", "wf-090000-2222/submit-write/probe"],
      ["span.ended", "wf-090000-2222/submit-write/probe"],
      ["span.started", "wf-090000-2222/submit-write/prepare"],
      ["data.observed", "wf-090000-2222/submit-write/prepare"],
      ["span.ended", "wf-090000-2222/submit-write/prepare"],
    ], "dry-run reports probe and stage only; it fabricates no fence, click, or read-back");
    assert.equal(intentByKey(h.database), undefined, "zero intents");
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "zero clicks");
    assert.equal(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    assert.equal(
      h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
      undefined,
      "zero checkpoints",
    );
  });

  it("withholds a legacy parked message from preview failure material", async () => {
    const h = await harness();
    const legacyMessage = `legacy failure for ${WRITE_FIXTURE_KEY} and standalone suffix 2345`;
    parkLegacyAttemptingIntent(h.database, legacyMessage);
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /parked \(unknown\)/u);
        assert.doesNotMatch(error.message, /10812345|2345|legacy failure/u);
        return true;
      },
    );
    const parked = intentByKey(h.database);
    assert.ok(parked?.status === "parked");
    assert.equal(parked.message, legacyMessage, "presentation repair never rewrites authority evidence");
  });

  it("refuses a malformed staged EID without echoing the observed value", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.subjectEid = "EID 10899999";

    await assert.rejects(
      h.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /does not normalize to an EID/);
        assert.doesNotMatch(error.message, /10899999/);
        return true;
      },
    );
  });
});
