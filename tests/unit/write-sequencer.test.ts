/**
 * Doc 09 §3 beats ①–⑦ over the REAL authority database, worker session
 * manager, and a sealed synthetic transaction corpus — only the process edges
 * (browser driver, clock, ids, timers, span sink) are recording fakes.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { TaskError } from "../../src/base/errors.js";
import type { WriteSequencerContext } from "../../src/core/run-executor.js";
import {
  createWriteSequencer,
  StagedPageDiscardedError,
  WriteParkedError,
  type ProductionWriteSequencer,
  type WriteSequencerHooks,
} from "../../src/core/write-sequencer.js";
import type { WorkerSessionManager } from "../../src/core/worker-sessions.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import type { AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { deriveWriteBindingProofDigest } from "../../src/domain/write-safety.js";
import {
  AtomicWriteCommitStorageStepSchema,
  AuthorityDatabase,
  SequencedWriteCommitStepSchema,
  type AuthorityWriteCommitHooks,
} from "../../src/infra/sqlite/index.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "./fixtures/phase1c-contract-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  absentProbeEvidence,
  ambiguousProbeVerdict,
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  WRITE_FIXTURE_EID,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_ITEM_ID,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_KEY_DIGEST,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_OBSERVATION,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_STAGED_STATE,
  unknownProbeVerdict,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  WriteFixtureProofSchema,
  writeFixtureDescriptor,
  writeFixtureQueuedRun,
  writeFixtureSaveDescriptor,
  writeFixtureSessionManager,
  writeFixtureSessions,
  writeFixtureTransactionNode,
  type WriteFixtureWorld,
} from "./fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface Harness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly sessions: ReturnType<typeof writeFixtureSessions>;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
}

function harness(options: Readonly<{
  hooks?: WriteSequencerHooks;
  commitHooks?: AuthorityWriteCommitHooks;
}> = {}): Harness {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-write-sequencer-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-sequencer-test" },
    clock,
    options.commitHooks,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const manager = writeFixtureSessionManager(sessions, registry, clock);
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("c");
  const sequencer = createWriteSequencer({
    stores: registry,
    authority: database,
    sessions: manager,
    emitter: emitter.emitter,
    clock,
    ids,
    scheduler: new ManualScheduler(clock),
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    log: recordingLogger().log,
    resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  return { world, database, clock, manager, sessions, emitter, ids, sequencer };
}

function claimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = writeFixtureQueuedRun(),
  workerId: string = WRITE_FIXTURE_WORKER_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  assert.equal(enqueued.state, "inserted");
  const claimed = database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID,
    workerId,
    now,
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId, claimedAt: now, heartbeatAt: now };
  const validating = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...base },
    now,
  });
  assert.equal(validating.state, "applied");
  const running = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version + 1,
    claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID },
    now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

function contextFor(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  descriptor: AnyWorkflowDescriptor = writeFixtureDescriptor,
  dryRun = false,
): WriteSequencerContext {
  return {
    descriptor,
    node: writeFixtureTransactionNode(descriptor),
    run,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } as WriteSequencerContext["claim"],
    scope: { input: { eid: WRITE_FIXTURE_EID }, outputs: {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function intentByKey(database: AuthorityDatabase) {
  return database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
}

function foreignBindingProof(runId: string, leaseId: string) {
  return {
    kind: "subject-match",
    version: 1,
    proofId: UUID_7,
    runId,
    attempt: 1,
    leaseId,
    taskId: "ucpath/submit-write-fixture",
    observationId: WRITE_FIXTURE_OBSERVATION,
    pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "a".repeat(64),
      displaySuffix: "2345",
    },
    observed: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "a".repeat(64),
      displaySuffix: "2345",
    },
    match: "match",
    observedAt: WRITE_FIXTURE_NOW,
    afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
  };
}

function attemptingIntentFixture(runId: string, options: Readonly<{ intentId?: string }> = {}) {
  const bindingProof = foreignBindingProof(runId, UUID_6);
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const intent = {
    writeIntentId: options.intentId ?? UUID_8,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: "ucpath/submit-write-fixture",
    system: "ucpath",
    idempotencyKey: WRITE_FIXTURE_KEY,
    idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
    currentAttemptId: UUID_5,
    generation: 1,
    runId,
    runAttempt: 1,
    bindingProof,
    bindingProofDigest,
    fencedAt: WRITE_FIXTURE_NOW,
    version: 1,
    createdAt: WRITE_FIXTURE_NOW,
    updatedAt: WRITE_FIXTURE_NOW,
    status: "attempting",
  };
  const attempt = {
    writeAttemptId: UUID_5,
    writeIntentId: intent.writeIntentId,
    generation: 1,
    runId,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof,
    bindingProofDigest,
    fencedAt: WRITE_FIXTURE_NOW,
    outcome: { state: "attempting" },
    recordedAt: WRITE_FIXTURE_NOW,
  };
  return { intent, attempt };
}

describe("the seven-beat happy path", () => {
  it("probes, prepares, binds, fences before the click, and settles beat ⑦ atomically", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onCommitClick = () => {
      // Fence-before-click: the durable attempting intent exists BEFORE the click.
      const fenced = intentByKey(h.database);
      assert.ok(fenced);
      assert.equal(fenced.status, "attempting");
    };

    const outcome = await h.sequencer.executeTransaction(contextFor(run, claim));
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

    // The two atomic outboxes exist and are the last two minted ids.
    const minted = h.ids.minted();
    const ledgerOutbox = h.database.authority.durableOutbox.get(minted[minted.length - 2]);
    const spanOutbox = h.database.authority.durableOutbox.get(minted[minted.length - 1]);
    assert.ok(ledgerOutbox && ledgerOutbox.payload.kind === "ledger-entry");
    assert.equal(ledgerOutbox.payload.entry.idempotencyKey, WRITE_FIXTURE_KEY);
    assert.equal(ledgerOutbox.payload.entry.proofSource, "normal-output");
    assert.equal(ledgerOutbox.payload.entry.operator, "local-operator");
    assert.equal(ledgerOutbox.payload.entry.instance, "prod");
    assert.ok(spanOutbox && spanOutbox.payload.kind === "write-committed-span");

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

    // Prepare and commit sub-spans were emitted around the beats.
    assert.deepEqual(
      h.emitter.events().map((event) => [event.t, event.spanPath]),
      [
        ["span.started", "wf-090000-2222/submit-write/prepare"],
        ["span.ended", "wf-090000-2222/submit-write/prepare"],
        ["span.started", "wf-090000-2222/submit-write/commit"],
        ["span.ended", "wf-090000-2222/submit-write/commit"],
      ],
    );
  });

  it("replays its own settled checkpoint byte-exact without re-clicking", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.sequencer.executeTransaction(contextFor(first.run, first.claim));
    h.world.events.length = 0;

    const again = await h.sequencer.executeTransaction(contextFor(
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
      const h = harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      mutate(h.world);
      await assert.rejects(h.sequencer.executeTransaction(contextFor(run, claim)), expected);
      assert.equal(intentByKey(h.database), undefined, "no fence");
      assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "no click");
      assert.deepEqual(h.sessions.closeReasons(), ["poisoned"], "the staged page was poison-closed");
      const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
      assert.equal(current?.lifecycle.state, "running", "a pre-fence refusal leaves settlement to the interpreter");
    });
  }
});

describe("beat ④ — budget expiry and CAS races discard the staged page", () => {
  it("discards on an elapsed probe→fence budget and never clicks", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.onPrepare = () => h.clock.advanceMonotonic(30_001);
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => error instanceof StagedPageDiscardedError && /probe-to-fence budget/.test(error.message),
    );
    assert.equal(intentByKey(h.database), undefined);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("routes a lost fence race to the winner: attempting refuses, observed-present reuses", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const foreign = attemptingIntentFixture(UUID_5);
    h.world.onPrepare = () => {
      assert.equal(h.database.authority.writeIntents.fenceAttempt(foreign).state, "fenced");
    };
    await assert.rejects(h.sequencer.executeTransaction(contextFor(run, claim)), /lost the race .* nothing was clicked/s);
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));

    // Observed-present winner: the same race resolves to already-present reuse.
    const h2 = harness();
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
    const outcome = await h2.sequencer.executeTransaction(contextFor(second.run, second.claim));
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

describe("beat ① — durable same-key dedupe (D18)", () => {
  it("refuses loudly while another run is mid-submit, before any probe or browser", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(attemptingIntentFixture(UUID_5)).state, "fenced");
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      /another run .* is mid-submit .* refusing to double-fence/s,
    );
    assert.deepEqual(h.world.events, [], "no probe, no prepare, no click");
  });

  it("reuses a committed permanent key for a later fresh item without a second fence or ledger row", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await h.sequencer.executeTransaction(contextFor(first.run, first.claim));
    const mintedAfterCommit = h.ids.minted().length;
    h.world.events.length = 0;

    const second = claimRunning(
      h.database, h.clock,
      writeFixtureQueuedRun({ runId: UUID_5, itemId: UUID_6 }),
      "write-fixture-worker-2",
    );
    const outcome = await h.sequencer.executeTransaction(contextFor(second.run, second.claim));
    assert.deepEqual(outcome, {
      disposition: "already-present",
      proofSource: "durable-intent",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
    assert.deepEqual(h.world.events, [], "durable reuse runs no probe, prepare, or click");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed" && intent.generation === 1);
    // No new outboxes: discovering existing work writes no ledger row.
    const minted = h.ids.minted();
    for (const id of minted.slice(mintedAfterCommit)) {
      assert.equal(h.database.authority.durableOutbox.get(id), undefined);
    }
  });
});

describe("beat ⑤/⑥ — post-fence uncertainty durably parks (never done, never silent)", () => {
  it("parks intent and run when the commit impl throws after the fence", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitThrows = new Error("browser crashed mid-click");
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(intent.parkedCode, "unknown");
    const current = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(current && current.lifecycle.state === "parked-write");
    assert.equal(current.lifecycle.writeIntentId, intent.writeIntentId);
    assert.equal(current.lifecycle.intentGeneration, 1);
    assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
  });

  it("parks when the receipt fails its proof schema — clicked, cannot prove it landed", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.commitOutput = { transactionId: "" };
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });

  it("save-verify: a present read-back commits; an absent read-back parks", async () => {
    const h = harness();
    const first = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h.world.verifyResults.push({ state: "present", proof: { transactionId: "T222222" } });
    const outcome = await h.sequencer.executeTransaction(
      contextFor(first.run, first.claim, writeFixtureSaveDescriptor),
    );
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T222222" },
    });
    assert.ok(h.world.events.includes("verify"));

    const h2 = harness();
    const second = claimRunning(h2.database, h2.clock);
    h2.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    h2.world.verifyResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h2.sequencer.executeTransaction(contextFor(second.run, second.claim, writeFixtureSaveDescriptor)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h2.database)?.status, "parked");
  });
});

describe("beat ① — pre-fence probe indeterminacy refuses loudly", () => {
  for (const [verdict, expected] of [
    [ambiguousProbeVerdict(WRITE_FIXTURE_NOW), /found 2 matches/],
    [unknownProbeVerdict(WRITE_FIXTURE_NOW), /indeterminate .*grid did not render/],
  ] as const) {
    it(`${verdict.state} means no fence and no click`, async () => {
      const h = harness();
      const { run, claim } = claimRunning(h.database, h.clock);
      h.world.probeResults.push(verdict);
      await assert.rejects(h.sequencer.executeTransaction(contextFor(run, claim)), expected);
      assert.equal(intentByKey(h.database), undefined);
      assert.deepEqual(h.world.events, ["probe"]);
    });
  }
});

describe("beat ⑦ — the whole bundle commits once or not at all", () => {
  for (const step of AtomicWriteCommitStorageStepSchema.options) {
    it(`rolls back everything when the inner primitive fails after ${step}`, async () => {
      const h = harness({
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
        h.sequencer.executeTransaction(contextFor(run, claim)),
        new RegExp(`injected failure after ${step}`),
      );
      const intent = intentByKey(h.database);
      assert.ok(intent && intent.status === "attempting", "the intent stays attempting for §4 recovery");
      assert.equal(
        h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
        undefined,
      );
      assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.version, versionBefore);
      const minted = h.ids.minted();
      assert.equal(h.database.authority.durableOutbox.get(minted[minted.length - 1]), undefined);
      assert.equal(h.database.authority.durableOutbox.get(minted[minted.length - 2]), undefined);
    });
  }

  for (const step of SequencedWriteCommitStepSchema.options) {
    it(`rolls back everything when the outer bundle fails after ${step}`, async () => {
      const h = harness({
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
        h.sequencer.executeTransaction(contextFor(run, claim)),
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
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    const own = attemptingIntentFixture(WRITE_FIXTURE_RUN_ID);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(own).state, "fenced");
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });

    const outcome = await h.sequencer.executeTransaction(contextFor(run, claim));
    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "recovery-probe",
      output: { transactionId: "T654321" },
      proof: { transactionId: "T654321" },
    });
    assert.deepEqual(h.world.events, ["probe"], "recovery probes; it never prepares or clicks");
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("parks on an absent recovery probe — one observation is never retry authority", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock);
    assert.equal(
      h.database.authority.writeIntents.fenceAttempt(attemptingIntentFixture(WRITE_FIXTURE_RUN_ID)).state,
      "fenced",
    );
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim)),
      (error: unknown) => error instanceof WriteParkedError && error.parkCode === "unknown",
    );
    assert.equal(intentByKey(h.database)?.status, "parked");
    assert.equal(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle.state, "parked-write");
  });
});

describe("retryable re-fence (only a settled retryable key mints a new generation)", () => {
  it("fences generation 2 with a fresh binding proof and commits", async () => {
    const h = harness();
    const now = h.clock.now().toISOString();
    const settled = attemptingIntentFixture(UUID_5);
    assert.equal(h.database.authority.writeIntents.fenceAttempt(settled).state, "fenced");
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
          evidenceNote: "Checked the target system; the write is absent",
        },
        now,
      });
    });

    const { run, claim } = claimRunning(h.database, h.clock);
    h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    const outcome = await h.sequencer.executeTransaction(contextFor(run, claim));
    assert.equal((outcome as { disposition: string }).disposition, "committed");
    const intent = intentByKey(h.database);
    assert.ok(intent && intent.status === "committed");
    assert.equal(intent.generation, 2, "the re-fence advanced exactly one generation");
    assert.equal(intent.writeIntentId, settled.intent.writeIntentId, "the permanent row identity is retained");
  });
});

describe("dry-run — structurally zero intent, zero fence, zero commit", () => {
  it("executeTransaction refuses a dry-run context before any side effect", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    await assert.rejects(
      h.sequencer.executeTransaction(contextFor(run, claim, writeFixtureDescriptor, true)),
      (error: unknown) => error instanceof TaskError && error.code === "capability-unavailable",
    );
    assert.deepEqual(h.world.events, []);
    assert.equal(intentByKey(h.database), undefined);
  });

  it("executeDryRun stages, observes the subject, and creates nothing durable", async () => {
    const h = harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun({ dryRun: true }));
    const preview = await h.sequencer.executeDryRun(contextFor(run, claim, writeFixtureDescriptor, true));
    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.subject.state, "match");
    assert.deepEqual(h.world.events, ["prepare", `subject-read:${WRITE_FIXTURE_OBSERVATION}`]);
    assert.equal(intentByKey(h.database), undefined, "zero intents");
    assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")), "zero clicks");
    const minted = h.ids.minted();
    for (const id of minted) {
      assert.equal(h.database.authority.durableOutbox.get(id), undefined, "zero outboxes");
    }
    assert.equal(
      h.database.authority.runCheckpoints.latest(WRITE_FIXTURE_WORKFLOW_ID, WRITE_FIXTURE_ITEM_ID, WRITE_FIXTURE_NODE_ID),
      undefined,
      "zero checkpoints",
    );
  });
});
