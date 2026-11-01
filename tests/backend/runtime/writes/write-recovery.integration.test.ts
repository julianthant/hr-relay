import { afterAll, afterEach, describe, it, vi } from "vitest";
import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { createWriteRecoveryTestWorld } from "../../../support/helpers/backend/write-recovery-world.js";
import { lifecycleCommandId } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { executeSequencedWriteCommit } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { reconstructConfirmedOperation } from "../../../../src/models/events/confirmed-operation.js";
import { testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_5, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_EID, WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_KEY, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, WRITE_FIXTURE_WORKFLOW_ID, WriteFixtureCommit, WriteFixtureProofSchema, absentProbeEvidence, ambiguousProbeVerdict, unknownProbeVerdict, writeFixtureDescriptor, writeFixtureDescriptorAfterUnrelatedEdit, writeFixtureDescriptorWithMovedKey, writeFixtureDocumentDescriptor, writeFixtureQueuedRun, writeFixtureSaveDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const {SIGNAL, harness, ownBindingProof, parkedAttemptingWrite, cleanup } = createWriteRecoveryTestWorld(profileFixtures.create);

afterEach(cleanup);

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

describe("ref write-safety §4 recovery matrix", () => {
  it("re-probes FIRST and backfills a validated present proof through the atomic beat ⑦", async () => {
    const h = await harness();
    const { run: parkedRun, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.deepEqual(decision, { state: "backfilled", writeIntentId, generation: 1 });
    assert.deepEqual(h.world.events, ["probe"], "recovery probed first and never prepared or clicked");

    assert.deepEqual(
      h.openedFingerprints(),
      [String(parkedRun.envelope.configFingerprint)],
      "the recovery probe leased under the target run's retained config fingerprint",
    );
    // …and recovery released its binding afterwards: a fresh bind succeeds.
    h.manager.bindRunConfigFingerprint(FingerprintSchema.parse("f".repeat(64)));
    h.manager.releaseRunConfigFingerprint();

    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.deepEqual(intent.completionProof.value, { transactionId: "T654321" });
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.equal((checkpoint.output.value as { proofSource: string }).proofSource, "recovery-probe");
    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run && run.lifecycle.state === "queued", "the settled run resumed to the queue");
    const confirmations = h.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed");
    assert.equal(confirmations.length, 1, "recovery backfill is one filed transaction");
    const { ledger, span } = reconstructConfirmedOperation(h.database.authority, confirmations[0]);
    assert.deepEqual(ledger.proof, intent.completionProof);
    assert.equal(span.outcome.proofSource, "recovery-probe");
  });

  it("parks a malformed present proof — never done with unvalidated proof", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    // An invalid proof becomes unknown, never absent; schema refusal must not become negative settlement.
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T1" } });

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.equal(decision.state, "parked");
    if (decision.state === "parked") assert.equal(decision.code, "unknown");
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(
      h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
      undefined,
      "no backfill happened",
    );
  });

  it("treats one early absence as diagnostic only: wait, no retry authority, nothing durable", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    // Observed immediately at the fence instant — before minSinceFenceMs (30s).
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.equal(decision.state, "wait");
    if (decision.state === "wait") assert.equal(decision.observationsNeeded, 2);
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "attempting", "an early absence changes nothing durable");
    assert.equal(intent.generation, 1);
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("keeps waiting while qualified observations are not yet spaced", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.clock.advanceWall(31_000);
    const first = absentProbeEvidence(h.clock.now().toISOString(), `observation:${UUID_5}`);
    h.clock.advanceWall(1_000); // 1s later — under the 5s read spacing
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor,
      writeIntentId,
      priorVerdicts: [first === undefined ? undefined : { state: "absent", evidence: first.evidence }],
      signal: SIGNAL,
    });
    assert.equal(decision.state, "wait");
    if (decision.state === "wait") assert.equal(decision.observationsNeeded, 1);
    assert.equal(intentByKey(h.database)?.status, "attempting");
  });

  it("parks on conflicting observations instead of counting them", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.clock.advanceWall(31_000);
    const foreign = absentProbeEvidence(h.clock.now().toISOString());
    const conflicting = {
      state: "absent",
      evidence: { ...foreign.evidence, queryDigest: "9".repeat(64) },
    };
    h.clock.advanceWall(6_000);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor,
      writeIntentId,
      priorVerdicts: [conflicting],
      signal: SIGNAL,
    });
    assert.equal(decision.state, "parked");
    if (decision.state === "parked") assert.equal(decision.code, "unknown");
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(intentByKey(h.database)?.generation, 1, "no indeterminate arm may advance the generation");
  });

  it("grants retry authority ONLY to policy-qualified stabilized absence, then resumes the run", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.clock.advanceWall(31_000);
    const first = absentProbeEvidence(h.clock.now().toISOString(), `observation:${UUID_5}`);
    h.clock.advanceWall(6_000); // ≥ minBetweenReadsMs (5s)
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor,
      writeIntentId,
      priorVerdicts: [{ state: "absent", evidence: first.evidence }],
      signal: SIGNAL,
    });
    assert.deepEqual(decision, { state: "safe-to-retry", writeIntentId, generation: 1 });
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "retryable");
    assert.equal(intent.generation, 1, "settlement retains the generation; only the NEXT fence advances it");
    assert.equal(intent.settlement.state, "safe-to-retry");
    const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(run && run.lifecycle.state === "queued");
  });

  for (const failure of ["throwing probe", "invalid present proof"] as const) {
    it(`parks a protected-input ${failure} without retaining secret exception detail or retrying`, async () => {
      const h = await harness();
      const protectedValue = "PRIVATE_DOCUMENT_RECOVERY_CANARY";
      const exceptionValue = "PRIVATE_EXCEPTION_RECOVERY_CANARY";
      const { run, writeIntentId } = parkedAttemptingWrite(h, undefined, {
        ...writeFixtureQueuedRun(),
        input: {
          raw: { eid: WRITE_FIXTURE_EID, documentNumber: protectedValue },
          parsed: {
            schemaHash: deriveSchemaHash(writeFixtureDocumentDescriptor.canonicalInput, "output"),
            value: { eid: WRITE_FIXTURE_EID, documentNumber: protectedValue },
            protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber",
              name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: UUID_7 }],
          },
          ingressSchemaHash: deriveSchemaHash(writeFixtureDocumentDescriptor.input, "input"),
        },
      });
      assert.equal(run.input.parsed.protectedBindings.length, 1);
      const parseProof = WriteFixtureProofSchema.parse.bind(WriteFixtureProofSchema);
      const proofConversion = failure === "invalid present proof"
        ? vi.spyOn(WriteFixtureProofSchema, "parse")
          .mockImplementation(() => parseProof({ transactionId: exceptionValue }))
        : undefined;
      h.world.probeResults.push(failure === "throwing probe" ? new Error(exceptionValue)
        : { state: "present", proof: { transactionId: "T654321", documentNumber: protectedValue } });
      try {
        const decision = await h.recovery.recover({ descriptor: writeFixtureDocumentDescriptor, writeIntentId, signal: SIGNAL });
        assert.equal(decision.state, "parked");
        if (decision.state !== "parked") throw new Error("expected parked recovery");
        assert.equal(decision.code, failure === "throwing probe" ? "unknown" : "present-proof-invalid");
        const intent = intentByKey(h.database);
        assert.ok(intent?.status === "parked");
        assert.equal(intent.authorityReason?.code, failure === "throwing probe"
          ? "recovery-probe-exception" : "recovery-present-proof-schema-failure");
        assert.equal(intent.authorityReason?.evidence.kind, "exception");
        assert.match(intent.authorityReason?.evidence.digest ?? "", /^[a-f0-9]{64}$/u);
        const attempt = h.database.authority.writeAttempts.get(UUID_5);
        assert.ok(attempt?.outcome.state === "parked");
        assert.equal(attempt.outcome.code, decision.code);
        assert.deepEqual(attempt.outcome.authorityReason, intent.authorityReason);
        assert.deepEqual(attempt.bindingProof, ownBindingProof());
        assert.equal(attempt.generation, 1);
        const visibleEvidence = JSON.stringify({ decision, intent, attempt });
        for (const secret of [protectedValue, exceptionValue, WRITE_FIXTURE_KEY, WRITE_FIXTURE_EID]) {
          assert.equal(JSON.stringify(decision).includes(secret), false);
          assert.equal(JSON.stringify(intent.authorityReason).includes(secret), false);
        }
        assert.equal(visibleEvidence.includes(exceptionValue), false);
        assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
        assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID), undefined);
        assert.deepEqual(h.world.events, ["probe"]);
        await assert.rejects(h.recovery.recover({ descriptor: writeFixtureDocumentDescriptor, writeIntentId, signal: SIGNAL }), /typed operator resolutions/u);
        assert.deepEqual(h.world.events, ["probe"], "UNKNOWN recovery never retries the probe or write");
      } finally {
        proofConversion?.mockRestore();
      }
    });
  }

  it("parks ambiguous, unknown, and throwing probes — never absent, never retry", async () => {
    for (const [result, code, authorityCode] of [
      [ambiguousProbeVerdict(WRITE_FIXTURE_NOW), "ambiguous", "recovery-probe-ambiguous"],
      [unknownProbeVerdict(WRITE_FIXTURE_NOW), "unknown", "recovery-probe-unknown"],
      [new Error("target system is down"), "unknown", "recovery-probe-exception"],
    ] as const) {
      const h = await harness();
      const { writeIntentId } = parkedAttemptingWrite(h);
      h.world.probeResults.push(result);
      const decision = await h.recovery.recover({
        descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
      });
      assert.equal(decision.state, "parked");
      if (decision.state === "parked") {
        assert.equal(decision.code, code);
        assert.equal(decision.message.includes(WRITE_FIXTURE_KEY), false);
        assert.equal(decision.message.includes(WRITE_FIXTURE_EID), false);
        assert.ok(decision.message.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)));
      }
      const persisted = intentByKey(h.database);
      assert.equal(persisted?.status, "parked");
      if (persisted?.status === "parked") {
        assert.equal(persisted.message.includes(WRITE_FIXTURE_KEY), false);
        assert.equal(persisted.message.includes(WRITE_FIXTURE_EID), false);
        assert.equal(persisted.authorityReason?.code, authorityCode);
        assert.equal(persisted.authorityReason?.evidence.kind, result instanceof Error ? "exception" : "probe");
        assert.match(persisted.authorityReason?.evidence.digest ?? "", /^[a-f0-9]{64}$/u);
      }
    }
  });

  it("parks an operator-only policy without counting any absence evidence", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h, "ucpath/save-write-fixture");
    h.clock.advanceWall(120_000);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureSaveDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.equal(decision.state, "parked");
    if (decision.state === "parked") assert.equal(decision.code, "operator-required");
    const persisted = intentByKey(h.database);
    assert.equal(persisted?.status, "parked");
    if (persisted?.status === "parked") {
      assert.equal(persisted.authorityReason?.code, "negative-settlement-operator-only");
      assert.equal(persisted.authorityReason?.evidence.kind, "settlement");
    }
  });

  it("refuses non-attempting intents and drifted descriptors loudly", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.database.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "already parked", now: h.clock.now().toISOString(),
        authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "test legacy park"),
      });
    });
    await assert.rejects(
      h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL }),
      /typed operator resolutions/,
    );
    assert.deepEqual(h.world.events, [], "no probe ran against a non-attempting intent");
  });

  it("a session host bound to another run refuses loudly — a precondition failure never parks", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    h.manager.bindRunConfigFingerprint(FingerprintSchema.parse("f".repeat(64)));
    try {
      await assert.rejects(
        h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL }),
        /already has a bound run config fingerprint/,
      );
    } finally {
      h.manager.releaseRunConfigFingerprint();
    }
    assert.deepEqual(h.world.events, [], "no probe leased under a foreign run's binding");
    assert.equal(
      intentByKey(h.database)?.status,
      "attempting",
      "the intent is untouched — a precondition refusal is not a probe verdict and parks nothing",
    );
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("a worker restarted onto a moved contract closure still recovers the crash it caused", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptorAfterUnrelatedEdit, writeIntentId, signal: SIGNAL,
    });
    assert.deepEqual(decision, { state: "backfilled", writeIntentId, generation: 1 });
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("recovery still refuses loudly when the permanent key itself moved", async () => {
    const h = await harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    await assert.rejects(
      h.recovery.recover({ descriptor: writeFixtureDescriptorWithMovedKey, writeIntentId, signal: SIGNAL }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /refusing recovery-probe: permanent-key-identity moved/);
        assert.equal(error.message.includes(WRITE_FIXTURE_KEY), false);
        assert.equal(error.message.includes(WRITE_FIXTURE_EID), false);
        assert.ok(error.message.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)));
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "a refused binding never opens a browser session");
    assert.equal(intentByKey(h.database)?.status, "attempting", "a binding refusal parks nothing");
  });
});


describe("positive recovery composite refusal", () => {
  it("unwinds evidence inserted before continuation refuses", async () => {
    const h = await harness(true);
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    const intent = intentByKey(h.database);
    const generation = h.database.getMeta().authorityGeneration;
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    await assert.rejects(h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL }),
      /run lifecycle conflict/);
    assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), run);
    assert.deepEqual(intentByKey(h.database), intent);
    assert.equal(h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(h.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed"), []);
  });
});


describe("resume-queued helper replay", () => {
  it.each([writeFixtureDescriptor,writeFixtureDescriptorAfterUnrelatedEdit])("preserves continuation and exact recovery owner on replay under $contractFingerprint", async descriptor => {
    const h = await harness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    await h.recovery.recover({ descriptor, writeIntentId, signal: SIGNAL });
    const intent = intentByKey(h.database);
    assert.ok(intent?.status === "committed");
    const checkpoint = h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID,
      WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.equal(checkpoint.contractFingerprint,run.envelope.contractFingerprint);
    assert.equal(checkpoint.descriptorVersion,run.envelope.descriptorVersion);
    assert.equal(checkpoint.implFingerprint,WRITE_FIXTURE_IMPL_FINGERPRINT);
    assert.equal(intent.completionProof.schemaHash,deriveSchemaHash(WriteFixtureProofSchema,"output"));
    const outcome=checkpoint.output.value;
    assert.ok(typeof outcome==="object" && outcome!==null && "output" in outcome);
    assert.deepEqual(outcome.output,{schemaHash:deriveSchemaHash(WriteFixtureCommit.output,"output"),value:{transactionId:"T654321"}});

    const confirmation = h.database.authority.timelineEvents.page({}).find((event) => event.payload.kind === "operation-confirmed");
    assert.ok(confirmation);
    const { ledger: transaction, span: committedSpan } = reconstructConfirmedOperation(h.database.authority, confirmation);
    const input = { run: { runId: run.envelope.runId, expectedVersion: run.version }, checkpoint,
      commit: { writeIntentId, generation: intent.generation, completionProof: intent.completionProof,
        confirmedAt: intent.confirmedAt, outcome: checkpoint.output.value, transaction, committedSpan } };
    h.restart();
    const transition = { kind: "resume-queued" as const, startAt: WRITE_FIXTURE_NODE_ID,
      port: testRunContinuation(h.database, h.clock),
      commandId: lifecycleCommandId("positive-recovery", { writeIntentId, generation: intent.generation }) };
    const generation = h.database.getMeta().authorityGeneration;
    const replay = executeSequencedWriteCommit(h.database, input, transition);
    assert.equal(replay.run.envelope.startAt, WRITE_FIXTURE_NODE_ID);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.throws(() => executeSequencedWriteCommit(h.database, input, { ...transition, startAt: "other-node" }), /replay-divergent/);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
});
