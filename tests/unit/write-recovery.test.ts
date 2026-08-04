/**
 * Doc 09 §4 recovery matrix (D118) and the §4.1 typed operator resolutions
 * over the REAL authority database — probe-first routing, D64/D69-qualified
 * negative settlement, present-proof validation before backfill, and every
 * indeterminate arm parking.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  createWriteRecoveryService,
  createWriteResolutionExecutor,
  type WriteRecoveryService,
} from "../../src/core/write-recovery.js";
import type { WriteResolutionContext } from "../../src/core/command-kernel.js";
import type { WorkerSessionManager } from "../../src/core/worker-sessions.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { deriveWriteBindingProofDigest } from "../../src/domain/write-safety.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  ManualScheduler,
  recordingLogger,
  type SessionFactoryHarness,
} from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "./fixtures/phase1c-contract-fixtures.js";
import {
  absentProbeEvidence,
  ambiguousProbeVerdict,
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  unknownProbeVerdict,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_ITEM_ID,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_KEY_DIGEST,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_OBSERVATION,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_STAGED_STATE,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  WriteFixtureProofSchema,
  writeFixtureDescriptor,
  writeFixtureDescriptorAfterUnrelatedEdit,
  writeFixtureDescriptorWithMovedKey,
  writeFixtureQueuedRun,
  writeFixtureSaveDescriptor,
  writeFixtureSessionManager,
  writeFixtureSessions,
  type WriteFixtureWorld,
} from "./fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

const SIGNAL = new AbortController().signal;

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly recovery: WriteRecoveryService;
  /** Every config fingerprint a probe lease actually opened a session under (D116 witness). */
  readonly openedFingerprints: () => readonly string[];
}

function harness(): Harness {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-write-recovery-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-recovery-test" },
    clock,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const inner = writeFixtureSessions(world);
  // D116 witness: record the exact config fingerprint every session open was
  // requested under, so a test can pin that recovery leased under the TARGET
  // run's retained fingerprint and not a recomputed or caller-claimed one.
  const opened: string[] = [];
  const spied: SessionFactoryHarness = {
    ...inner,
    factory: {
      open: (input) => {
        opened.push(String(input.configFingerprint));
        return inner.factory.open(input);
      },
    },
  };
  const manager = writeFixtureSessionManager(spied, registry, clock);
  const ids = sequentialIdFactory("c");
  const recovery = createWriteRecoveryService({
    stores: registry,
    authority: database,
    sessions: manager,
    clock,
    ids,
    scheduler: new ManualScheduler(clock),
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    log: recordingLogger().log,
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
  });
  return {
    world, database, clock, manager, ids, recovery,
    openedFingerprints: () => Object.freeze([...opened]),
  };
}

function ownBindingProof() {
  return {
    kind: "subject-match",
    version: 1,
    proofId: UUID_7,
    runId: WRITE_FIXTURE_RUN_ID,
    attempt: 1,
    leaseId: UUID_6,
    taskId: "ucpath/submit-write-fixture",
    observationId: WRITE_FIXTURE_OBSERVATION,
    pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    match: "match",
    observedAt: WRITE_FIXTURE_NOW,
    afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
  };
}

/**
 * A crashed fenced write: enqueue + claim + running, fence the attempting
 * intent for THIS run, then park the run the way the D118 sweep's parked:true
 * arm does. The intent stays `attempting` — recovery's exact precondition.
 */
function parkedAttemptingWrite(h: Harness, taskIdValue = "ucpath/submit-write-fixture"): {
  run: RunRecord;
  writeIntentId: string;
} {
  const now = h.clock.now().toISOString();
  assert.equal(h.database.authority.runs.enqueue(writeFixtureQueuedRun()).state, "inserted");
  const claimed = h.database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId: WRITE_FIXTURE_WORKER_ID,
    now,
  });
  if (claimed.state !== "claimed") throw new Error("claim failed");
  const claim = { workerId: WRITE_FIXTURE_WORKER_ID, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId: WRITE_FIXTURE_WORKER_ID, claimedAt: now, heartbeatAt: now };
  assert.equal(h.database.authority.runs.transition({
    runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version, claim,
    lifecycle: { state: "validating", ...base }, now,
  }).state, "applied");
  assert.equal(h.database.authority.runs.transition({
    runId: WRITE_FIXTURE_RUN_ID, expectedVersion: claimed.run.version + 1, claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID }, now,
  }).state, "applied");

  const bindingProof = { ...ownBindingProof(), taskId: taskIdValue };
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const intent = {
    writeIntentId: UUID_8,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: taskIdValue,
    system: "ucpath",
    idempotencyKey: WRITE_FIXTURE_KEY,
    idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
    currentAttemptId: UUID_5,
    generation: 1,
    runId: WRITE_FIXTURE_RUN_ID,
    runAttempt: 1,
    bindingProof,
    bindingProofDigest,
    fencedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: "attempting",
  };
  const attempt = {
    writeAttemptId: UUID_5,
    writeIntentId: UUID_8,
    generation: 1,
    runId: WRITE_FIXTURE_RUN_ID,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof,
    bindingProofDigest,
    fencedAt: now,
    outcome: { state: "attempting" },
    recordedAt: now,
  };
  assert.equal(h.database.authority.writeIntents.fenceAttempt({ intent, attempt }).state, "fenced");

  const parked = h.database.authority.runs.transition({
    runId: WRITE_FIXTURE_RUN_ID,
    expectedVersion: claimed.run.version + 2,
    claim,
    lifecycle: {
      state: "parked-write",
      writeIntentId: UUID_8,
      intentGeneration: 1,
      parkedAt: now,
      code: "unknown",
      message: "claim expired mid-write; routed to recovery",
    },
    now,
  });
  if (parked.state !== "applied") throw new Error("park transition failed");
  return { run: parked.run, writeIntentId: UUID_8 };
}

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

describe("doc 09 §4 recovery matrix", () => {
  it("re-probes FIRST and backfills a validated present proof through the atomic beat ⑦", async () => {
    const h = harness();
    const { run: parkedRun, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.deepEqual(decision, { state: "backfilled", writeIntentId, generation: 1 });
    assert.deepEqual(h.world.events, ["probe"], "recovery probed first and never prepared or clicked");
    // D116: the probe lease opened under the TARGET run's retained immutable
    // config fingerprint — the authority run row's value, nothing recomputed.
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
    // Ledger + span outboxes exist — recovery backfill IS a filed transaction.
    const minted = h.ids.minted();
    assert.ok(h.database.authority.durableOutbox.get(minted[minted.length - 2]));
    assert.ok(h.database.authority.durableOutbox.get(minted[minted.length - 1]));
  });

  it("parks a malformed present proof — never done with unvalidated proof", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    // "T1" fails the proof regex: the ProbeVerdict parse refuses it, which
    // surfaces as a throwing probe — and a throwing probe is `unknown`, never
    // absent and never done. There is NO path to backfill without a proof that
    // parsed the exact completion proofSchema.
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
    const h = harness();
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
    const h = harness();
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
    const h = harness();
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
    const h = harness();
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

  it("parks ambiguous, unknown, and throwing probes — never absent, never retry", async () => {
    for (const [result, code] of [
      [ambiguousProbeVerdict(WRITE_FIXTURE_NOW), "ambiguous"],
      [unknownProbeVerdict(WRITE_FIXTURE_NOW), "unknown"],
      [new Error("target system is down"), "unknown"],
    ] as const) {
      const h = harness();
      const { writeIntentId } = parkedAttemptingWrite(h);
      h.world.probeResults.push(result);
      const decision = await h.recovery.recover({
        descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL,
      });
      assert.equal(decision.state, "parked");
      if (decision.state === "parked") assert.equal(decision.code, code);
      assert.equal(intentByKey(h.database)?.status, "parked");
    }
  });

  it("parks an operator-only policy without counting any absence evidence", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h, "ucpath/save-write-fixture");
    h.clock.advanceWall(120_000);
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));

    const decision = await h.recovery.recover({
      descriptor: writeFixtureSaveDescriptor, writeIntentId, signal: SIGNAL,
    });
    assert.equal(decision.state, "parked");
    if (decision.state === "parked") assert.equal(decision.code, "operator-required");
    assert.equal(intentByKey(h.database)?.status, "parked");
  });

  it("refuses non-attempting intents and drifted descriptors loudly", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.database.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "already parked", now: h.clock.now().toISOString(),
      });
    });
    await assert.rejects(
      h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL }),
      /typed operator resolutions/,
    );
    assert.deepEqual(h.world.events, [], "no probe ran against a non-attempting intent");
  });

  it("D116: a session host bound to another run refuses loudly — a precondition failure never parks", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    // A foreign claimed-run binding occupies the host (one worker, one active
    // run). Recovery's own bind must throw OUT of recover() — the D116 refusal
    // is a precondition failure, never converted into a park that reads as a
    // probe verdict (doc 09 §4 fail-loud).
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

  it("D136: a worker restarted onto a moved contract closure still recovers the crash it caused", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const decision = await h.recovery.recover({
      descriptor: writeFixtureDescriptorAfterUnrelatedEdit, writeIntentId, signal: SIGNAL,
    });
    assert.deepEqual(decision, { state: "backfilled", writeIntentId, generation: 1 });
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("D136: recovery still refuses loudly when the permanent key itself moved", async () => {
    const h = harness();
    const { writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    await assert.rejects(
      h.recovery.recover({ descriptor: writeFixtureDescriptorWithMovedKey, writeIntentId, signal: SIGNAL }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /refusing recovery-probe: permanent-key-identity moved/);
        assert.ok(error.message.includes(WRITE_FIXTURE_KEY));
        return true;
      },
    );
    assert.deepEqual(h.world.events, [], "a refused binding never opens a browser session");
    assert.equal(intentByKey(h.database)?.status, "attempting", "a binding refusal parks nothing");
  });
});

describe("doc 09 §4.1 typed operator resolutions (the kernel seam)", () => {
  function resolutionHarness() {
    const h = harness();
    const executor = createWriteResolutionExecutor({
      descriptors: {
        resolve: (workflowId) =>
          [writeFixtureDescriptor, writeFixtureSaveDescriptor]
            .find((descriptor) => String(descriptor.id) === workflowId && descriptor === writeFixtureDescriptor),
      },
      authority: h.database,
      ids: h.ids,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    });
    return { h, executor };
  }

  function commandFor(type: "resolve-write-present" | "resolve-write-absent", run: RunRecord, payload: Record<string, unknown>) {
    return CommandRequestSchema.parse({
      commandId: UUID_7,
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type,
      target: {
        runId: run.envelope.runId,
        expectedVersion: run.version,
        writeIntentId: UUID_8,
        intentGeneration: 1,
      },
      payload,
    });
  }

  it("confirmed-present parses the exact proof schema, runs beat ⑦, and resumes the run", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    // Park the intent the way recovery would have before the operator acts.
    const parkedIntent = h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "clicked, cannot prove it landed", now: h.clock.now().toISOString(),
      }));
    const command = commandFor("resolve-write-present", run, {
      proof: {
        schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"),
        value: { transactionId: "T999999" },
      },
      evidenceNote: "Verified transaction T999999 in the target system",
    });
    if (command.family !== "run" || command.type !== "resolve-write-present") throw new Error("unreachable");
    const context: WriteResolutionContext = Object.freeze({
      command, run, intent: parkedIntent, now: h.clock.now().toISOString(),
    });

    const outcome = h.database.withAuthorityTransaction((repositories) =>
      executor.resolvePresent(repositories, context)) as { run: RunRecord };
    assert.equal(outcome.run.envelope.runId, run.envelope.runId);
    assert.equal(outcome.run.lifecycle.state, "queued");

    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.deepEqual(intent.completionProof.value, { transactionId: "T999999" });
    const checkpoint = h.database.authority.runCheckpoints.latest(
      WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID);
    assert.ok(checkpoint);
    assert.equal((checkpoint.output.value as { proofSource: string }).proofSource, "operator-attestation");
  });

  it("confirmed-present with a wrong proof schema hash changes nothing", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    const parkedIntent = h.database.withAuthorityTransaction((repositories) =>
      repositories.writeIntents.parkAttempt({
        writeIntentId, generation: 1, expectedVersion: 1,
        code: "unknown", message: "clicked, cannot prove it landed", now: h.clock.now().toISOString(),
      }));
    const command = commandFor("resolve-write-present", run, {
      proof: { schemaHash: "1".repeat(64), value: { transactionId: "T999999" } },
      evidenceNote: "wrong schema",
    });
    if (command.family !== "run" || command.type !== "resolve-write-present") throw new Error("unreachable");
    const context: WriteResolutionContext = Object.freeze({
      command, run, intent: parkedIntent, now: h.clock.now().toISOString(),
    });
    assert.throws(
      () => h.database.withAuthorityTransaction((repositories) => executor.resolvePresent(repositories, context)),
      /bound to schema/,
    );
    assert.equal(intentByKey(h.database)?.status, "parked", "the refused resolution changed nothing");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("confirmed-absent records the typed operator settlement and resumes for a fresh generation", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    const intent = h.database.authority.writeIntents.get(writeIntentId);
    assert.ok(intent);
    const command = commandFor("resolve-write-absent", run, {
      evidenceNote: "Checked UCPath directly; the transaction is absent",
    });
    if (command.family !== "run" || command.type !== "resolve-write-absent") throw new Error("unreachable");
    const context: WriteResolutionContext = Object.freeze({
      command, run, intent, now: h.clock.now().toISOString(),
    });

    const outcome = h.database.withAuthorityTransaction((repositories) =>
      executor.resolveAbsent(repositories, context)) as { run: RunRecord };
    assert.equal(outcome.run.lifecycle.state, "queued");
    const settled = intentByKey(h.database);
    assert.ok(settled && settled.status === "retryable");
    assert.equal(settled.settlement.state, "operator-confirmed-absent");
    if (settled.settlement.state === "operator-confirmed-absent") {
      assert.equal(settled.settlement.operator, "local-operator");
      assert.match(settled.settlement.evidenceNote, /transaction is absent/);
    }
    assert.equal(settled.generation, 1, "the resolution never itself advances the generation");
  });

  it("refuses to resolve a committed intent — there is no reopen of committed history", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    return h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL })
      .then((decision) => {
        assert.equal(decision.state, "backfilled");
        const committed = h.database.authority.writeIntents.get(writeIntentId);
        assert.ok(committed);
        const command = commandFor("resolve-write-absent", run, { evidenceNote: "stale operator tab" });
        if (command.family !== "run" || command.type !== "resolve-write-absent") throw new Error("unreachable");
        const context: WriteResolutionContext = Object.freeze({
          command, run, intent: committed, now: h.clock.now().toISOString(),
        });
        assert.throws(
          () => h.database.withAuthorityTransaction((repositories) => executor.resolveAbsent(repositories, context)),
          /has no operator resolution/,
        );
        assert.equal(h.database.authority.writeIntents.get(writeIntentId)?.status, "committed");
      });
  });
});
