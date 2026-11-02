import { RunClaimTokenSchema } from "../../../../src/models/run/worker.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";
import { testRunLifecycle, testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildCommittedSettlement, executeSequencedWriteCommit } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { absentProbeEvidence, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureCommit, writeFixtureDescriptor, WriteFixtureProofSchema, writeFixtureQueuedRun, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { AtomicWriteCommitStorageStepSchema, SequencedWriteCommitStepSchema } from "../../../support/helpers/synthetic-storage-admission.js";

const {harness, claimRunning, contextFor, intentByKey, attemptingIntentFixture, cleanup } = createWriteSequencerTestWorld();

afterEach(cleanup);

describe("beat ⑤/⑥ — post-fence uncertainty durably parks (never done, never silent)", () => {
  it("keeps the commit lane and session owned until a deadline-ignoring callback actually settles", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let releaseCallback = (): void => undefined;
    const callbackMaySettle = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let reportCallbackInFlight = (): void => undefined;
    const callbackInFlight = new Promise<void>((resolve) => {
      reportCallbackInFlight = resolve;
    });
    h.world.afterCommitClickBeforeTaskSettlement = async () => {
      reportCallbackInFlight();
      await callbackMaySettle;
    };

    const execution = h.execute(contextFor(run, claim));
    await callbackInFlight;
    const [commitDeadline] = h.scheduler.pending();
    assert.ok(commitDeadline, "the in-flight commit owns its immutable task deadline");
    commitDeadline.fire();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      h.emitter.events()
        .filter((event) => event.spanPath.endsWith("/commit"))
        .map((event) => event.t),
      ["span.started"],
      "deadline alone cannot flush the fenced commit lane before callback settlement",
    );
    assert.equal(intentByKey(h.database)?.status, "attempting", "the unsettled write remains recovery-visible");
    assert.deepEqual(h.sessions.closeReasons(), [], "the callback's transaction session remains open");

    releaseCallback();
    await assert.rejects(execution, /exceeded its immutable 60000ms task deadline/u);
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("settles the verified external commit despite fence-event delivery failure after pre-click recordData", async () => {
    const h = await harness({ emitterThrowsOn: "transaction.fenced" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitRecordsBeforeClick = true;

    assert.deepEqual(await h.execute(contextFor(run, claim)), {
      disposition: "committed", proofSource: "normal-output", output: { transactionId: "T123456" }, proof: { transactionId: "T123456" },
    });

    assert.ok(
      h.world.events.indexOf("commit-click:ucpath.write-fixture.save-submit")
        < h.world.events.indexOf("emitter-throw:transaction.fenced"),
      "the external click must precede the first fallible post-fence span write",
    );
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("runs mandatory saved-effect verification despite its start-span delivery failure", async () => {
    const h = await harness({ emitterThrowsOn: "verify-start" });
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    const outcome = await h.execute(contextFor(run, claim, writeFixtureSaveDescriptor));
    assert.deepEqual(outcome, { disposition: "committed", proofSource: "normal-output", output: { transactionId: "T123456" }, proof: { transactionId: "T222222" } });
    assert.equal(intentByKey(h.database)?.status, "committed");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "running");
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.deepEqual(checkpoint.output.value, { disposition: "committed", proofSource: "normal-output",
      confirmedAt: WRITE_FIXTURE_NOW,
      output: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T123456" } },
      proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T222222" } } });
    assert.ok(h.world.events.includes("emitter-throw:verify-start"));
    assert.ok(h.world.events.includes("verify"));
  });
});

describe("beat ⑦ — the whole bundle commits once or not at all", () => {
  for (const step of AtomicWriteCommitStorageStepSchema.options) {
    it(`rolls back everything when the inner primitive fails after ${step}`, async () => {
      const h = await harness({
        commitHooks: {
          afterStorageStep(failedStep) {
            if (failedStep === step) throw new Error(`injected failure after ${failedStep}`);
          },
        },
      });
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const versionBefore = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version;
      await assert.rejects(
        h.execute(contextFor(run, claim)),
        new RegExp(`injected failure after ${step}`),
      );
      const intent = intentByKey(h.database);
      assert.ok(intent && intent.status === "attempting", "the intent stays attempting for §4 recovery");
      assert.equal(
        h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version, versionBefore);
      assert.equal(h.database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    });
  }

  for (const step of SequencedWriteCommitStepSchema.options) {
    it(`rolls back everything when the outer bundle fails after ${step}`, async () => {
      const h = await harness({
        hooks: {
          afterSequencedStep(failedStep) {
            if (failedStep === step) throw new Error(`injected outer failure after ${failedStep}`);
          },
        },
      });
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      const versionBefore = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version;
      await assert.rejects(
        h.execute(contextFor(run, claim)),
        new RegExp(`injected outer failure after ${step}`),
      );
      const intent = intentByKey(h.database);
      assert.ok(intent && intent.status === "attempting");
      assert.equal(
        h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version, versionBefore);
    });
  }
});

describe("inline recovery of this run's own attempting intent", () => {
  it("backfills committed from a validated present recovery probe without a second click", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    const own = attemptingIntentFixture(WRITE_FIXTURE_RUN_ID);
    assert.equal(fenceWriteFixture(h.database, own).state, "fenced");
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const outcome = await h.execute(contextFor(run, claim));
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "recovery-probe",
      output: { transactionId: "T654321" },
      proof: { transactionId: "T654321" },
    });
    assert.deepEqual(h.world.events, ["probe"], "recovery probes; it never prepares or clicks");
    assert.equal(intentByKey(h.database)?.status, "committed");
  });
});

describe("service-backed shared settlement", () => {
  it("keeps settlement journal identity independent of protected proof bytes while binding ordinary proof", async () => {
    const settle = async (documentNumber: string, transactionId = "T123456", protectedKey = false) => {
      const h = await harness();
      const queued = RunRecordSchema.parse(writeFixtureQueuedRun());
      const protectedBindings = [{ kind: "test-data-local", name: "separationsKualiFinalizationCanaryDocumentNumber",
        inputPath: "documentNumber", sourceId: "10000000-0000-4000-8000-000000000001" }];
      const { run, claim } = claimRunning(h.database, h.clock, { ...queued,
        input: { ...queued.input, raw: { documentNumber }, parsed: { ...queued.input.parsed,
          value: { documentNumber }, protectedBindings } } });
      const fence = attemptingIntentFixture(run.envelope.runId);
      if (protectedKey) {
        fence.intent.idempotencyKey = `protected-document:${documentNumber}`;
        fence.intent.idempotencyKeyDigest = deriveIdempotencyKeyDigest("ucpath", fence.intent.idempotencyKey);
      }
      assert.equal(fenceWriteFixture(h.database, fence).state, "fenced");
      const intent = h.database.authority.writeIntents.get(fence.intent.writeIntentId);
      assert.ok(intent?.status === "attempting");
      const bundle = buildCommittedSettlement({ descriptor: writeFixtureDescriptor, nodeId: WRITE_FIXTURE_NODE_ID,
        run, intent, commitContract: WriteFixtureCommit, operator: ActorIdSchema.parse("local-operator"),
        implFingerprint: WRITE_FIXTURE_IMPL_FINGERPRINT, proofSource: "normal-output",
        proofValue: { documentNumber, transactionId }, outputValue: { documentNumber, transactionId },
        confirmedAt: WRITE_FIXTURE_NOW, ids: h.ids });
      const input = { run: { runId: run.envelope.runId, expectedVersion: run.version, claim }, ...bundle };
      const { outcome: _outcome, ...request } = input;
      const transition = { kind: "advance-running" as const, claim: RunClaimTokenSchema.parse(claim),
        claimedAt: WRITE_FIXTURE_NOW, port: testRunLifecycle(h.database, h.clock) };
      executeSequencedWriteCommit(h.database, request, transition);
      assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.idempotencyKey, fence.intent.idempotencyKey);
      assert.equal(h.database.authority.writeIntents.get(intent.writeIntentId)?.idempotencyKeyDigest, fence.intent.idempotencyKeyDigest);
      const generation = h.database.getMeta().authorityGeneration;
      executeSequencedWriteCommit(h.database, request, transition);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
      const commandId = lifecycleCommandId("write-advance-running", { runId: run.envelope.runId,
        expectedVersion: run.version, writeIntentId: intent.writeIntentId, generation: intent.generation });
      const journal = h.database.authority.lifecycleJournal.getCommand(commandId);
      assert.ok(journal && "requestFingerprint" in journal);
      return journal.requestFingerprint;
    };
    assert.equal(await settle("12345678"), await settle("87654321"));
    assert.notEqual(await settle("12345678"), await settle("12345678", "T234567"));
    assert.equal(await settle("12345678", "T123456", true), await settle("87654321", "T123456", true));
  });
  it("replays the exact worker bundle without writes and refuses changed evidence", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.execute(contextFor(run, claim));
    const intent = intentByKey(h.database);
    assert.ok(intent?.status === "committed");
    const checkpoint = h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    const confirmation = h.database.authority.timelineEvents.page({}).find((row) => row.payload.kind === "operation-confirmed");
    assert.ok(confirmation);
    const { ledger: transaction, span: committedSpan } = reconstructConfirmedOperation(h.database.authority, confirmation);

    const input = { run: { runId: run.envelope.runId, expectedVersion: run.version, claim }, checkpoint,
      commit: { writeIntentId: intent.writeIntentId, generation: intent.generation,
        completionProof: intent.completionProof, confirmedAt: intent.confirmedAt,
        outcome: checkpoint.output.value, transaction, committedSpan } };
    const transition = { kind: "advance-running" as const, claim: RunClaimTokenSchema.parse(claim), claimedAt: WRITE_FIXTURE_NOW,
      port: testRunLifecycle(h.database, h.clock) };
    const generation = h.database.getMeta().authorityGeneration;
    const before = h.database.authority.runs.get(run.envelope.runId);
    assert.deepEqual(executeSequencedWriteCommit(h.database, input, transition).run, before);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.throws(() => executeSequencedWriteCommit(h.database, { ...input,
      checkpoint: { ...checkpoint, implFingerprint: "f".repeat(64) } }, transition), /replay-divergent/);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), before);
  });
});

describe("durable cancellation at a retained write fence", () => {
  it("lets the callback and write settlement finish before cancellation can terminalize", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered = (): void => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    h.world.afterCommitClickBeforeTaskSettlement = async () => { entered(); await pending; };
    let finished = false;
    const execution = h.execute(contextFor(run, claim)).finally(() => { finished = true; });
    await started;
    const service = testRunService(h.database, h.clock);
    const current = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(current);
    const request = service.transition({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: run.envelope.runId, expectedVersion: current.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: WRITE_FIXTURE_NOW } });
    assert.equal(request.state, "applied");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal(intentByKey(h.database)?.status, "attempting");
    assert.deepEqual(h.sessions.closeReasons(), []);
    assert.deepEqual(h.emitter.events().filter((event) => event.spanPath.endsWith("/commit")).map((event) => event.t), ["span.started"]);
    release();
    await execution;
    assert.equal(intentByKey(h.database)?.status, "committed");
    const settled = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(settled && settled.cancelRequested === true && settled.lifecycle.state === "running");
    assert.equal(service.terminalize({ kind: "cancelled", commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      runId: settled.envelope.runId, expectedVersion: settled.version, claim, endedAt: WRITE_FIXTURE_NOW },
    writeFixtureDescriptor).state, "applied");
    const cancelled = h.database.authority.runs.get(run.envelope.runId);
    assert.ok(cancelled?.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  });
});
