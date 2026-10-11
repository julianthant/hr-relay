import { default as assert } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { deriveRunResultDigest } from "../../../src/models/run/result.js";
import { deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { HASH_B } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { LATER } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import type { AuthorityTerminalizationHooks } from "../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { deriveCheckpointOutputDigest } from "../../../src/models/run/result.js";
import { deriveTerminalFailureDigest } from "../../../src/models/run/result.js";
import { RunTerminalEvidenceResultSchema } from "../../../src/models/run/result.js";
import { testRunLifecycle } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { runWorkerLoop } from "../../../src/backend/runtime/workers/worker-loop.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { RunDryRunPreviewResultSchema } from "../../../src/models/run/result.js";
import { WorkerIdSchema } from "../../../src/rules/identity/ids.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../src/rules/time/clock.js";
import { workflowDryRunSupport } from "../../../src/workflow-kit/workflow.js";
import { workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence } from "../../support/fixtures/write-sequencer-fixtures.js";
import { buildWriteFixtureRegistry } from "../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteFixtureWorld } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_KEY } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_NODE_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_NOW } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_RUN_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_WORKER_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { writeFixtureDescriptor } from "../../support/fixtures/write-sequencer-fixtures.js";
import { writeFixtureQueuedRun } from "../../support/fixtures/write-sequencer-fixtures.js";
import { writeFixtureSessions } from "../../support/fixtures/write-sequencer-fixtures.js";
import type { WriteFixtureWorld } from "../../support/fixtures/write-sequencer-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../support/helpers/duo-ceremony-fixtures.js";
import type { FinalizationHarness } from "../../support/helpers/kuali-finalization-fixtures.js";
import { ManualScheduler } from "../../support/helpers/phase1f-executor-harness.js";
import { recordingLogger } from "../../support/helpers/phase1f-executor-harness.js";
import { recordingTimelineEmitter } from "../../support/helpers/phase1f-executor-harness.js";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import type { ReceiptBuildInput } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import type { RunEvidenceReceipt } from "../../../src/models/trust/evidence.js";
import { kualiReceiptEvidence } from "../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../support/helpers/registered-workflows.js";

{
const CLOCK = manualClock(new Date(LATER));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const WORKER_ID = "person-lookup-worker-1";
const CLAIM = { workerId: WORKER_ID, claimGeneration: 1 };
const ACTIVE = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

function openDatabase(hooks?: AuthorityTerminalizationHooks): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-run-terminal-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
    undefined,
    hooks,
  );
  testWorkerPorts(database, CLOCK, { path: join(root, "authority.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}

function startRunning(database: AuthorityDatabase, nodeId = "crm-dates") {
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        ...QUEUED_RUN.input.parsed,
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
  if (claimed.state !== "claimed") throw new Error("run was not claimed");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: CLAIM,
    lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error("run did not enter validating");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: CLAIM,
    lifecycle: {
      state: "running",
      workerId: WORKER_ID,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: nodeId,
    },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error("run did not enter running");
  return running.run;
}

function resultRequest(database: AuthorityDatabase, run: ReturnType<typeof startRunning>) {
  const activeCheckpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: 1,
    runId: run.envelope.runId,
    output: { schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"), value: ACTIVE },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  database.authority.runCheckpoints.insert(activeCheckpoint);
  const built = buildRunResult(
    personLookupDescriptor,
    run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint: activeCheckpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    CLOCK,
  );
  const result = built.record;
  const authorization = {
    kind: "done" as const,
    runId: result.runId,
    workflowId: result.workflowId,
    attempt: result.attempt,
    descriptorVersion: result.descriptorVersion,
    contractFingerprint: result.contractFingerprint,
    expectedVersion: run.version,
    claim: CLAIM,
    authorizedAt: LATER,
    resultDigest: result.resultDigest,
  };
  return { result, authorization, factoryAuthorization: built.authorization };
}

describe("atomic success terminal authority", () => {
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("rejects the former schema-valid complete/empty-dependencies fabrication bypass", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const resultValue = { schemaHash: HASH_A, value: { complete: true } };
    const fabricated = {
      runId: running.envelope.runId,
      attempt: running.envelope.attempt,
      workflowId: running.envelope.workflow,
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      configFingerprint: running.envelope.configFingerprint,
      configSnapshotId: running.envelope.configSnapshotId,
      resultSchemaHash: HASH_A,
      result: resultValue,
      resultDigest: deriveRunResultDigest(resultValue),
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
      createdAt: LATER,
    };
    const authorization = {
      kind: "done" as const,
      runId: fabricated.runId,
      workflowId: fabricated.workflowId,
      attempt: fabricated.attempt,
      descriptorVersion: fabricated.descriptorVersion,
      contractFingerprint: fabricated.contractFingerprint,
      expectedVersion: running.version,
      claim: CLAIM,
      authorizedAt: LATER,
      resultDigest: fabricated.resultDigest,
      };
    assert.throws(
      () => database.terminalizeSuccess({ result: fabricated, authorization }, {}),
      /lacks factory-authenticated/,
    );
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });

  it("rejects run/outbox identity, stale claim/version, generic done, and non-running success", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    assert.throws(() => database.terminalizeSuccess({
      result: { ...result, runId: UUID_6 },
      authorization,
    }), /must bind the exact result identity/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: { ...authorization, expectedVersion: running.version - 1 },
    }, factoryAuthorization), /not/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: {
        ...authorization,
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
    }, factoryAuthorization), /no longer claimed/);
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }),
      /lacks factory-authenticated/,
    );
    const fabricatedResult = {
      ...result,
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
    };
    assert.throws(
      () => database.terminalizeSuccess({
        result: fabricatedResult,
          authorization,
      }, {}),
      /lacks factory-authenticated/,
    );
    assert.throws(() => database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "done", endedAt: LATER },
      now: LATER,
    }), /requires atomic terminal authority/);
    const cancelled = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER },
      now: LATER,
    });
    assert.equal(cancelled.state, "applied");
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization,
    }), /already terminal without a result/);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });
});
}

{
describe("separations — start planning through the existing service", () => {

  it("keeps protected names and signed comments out of checkpoint and result fingerprint preimages", () => {
    const first = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic First Operator", timekeeperComments: "Filed. -SFO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SFO", separationDate: "06/19/2026" } } };
    const rotated = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic Second Operator", timekeeperComments: "Filed. -SSO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SSO", separationDate: "06/19/2026" } } };
    assert.equal(deriveCheckpointOutputDigest(first), deriveCheckpointOutputDigest(rotated));
    assert.equal(deriveRunResultDigest(first), deriveRunResultDigest(rotated));
    assert.notEqual(deriveRunResultDigest(first), deriveRunResultDigest({ ...first,
      value: { ...first.value, dates: { ...first.value.dates, separationDate: "06/20/2026" } } }));
  });
});
}

{
const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const kualiOpen: FinalizationHarness[] = [];

const PREVIEW_RESULT_SCHEMA_HASH = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");

interface Harness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly emitter: ReturnType<typeof recordingTimelineEmitter>;
  readonly run: (options?: Readonly<{ dryRun?: boolean; probe?: unknown }>) => Promise<void>;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-preview-"));
  roots.push(root);
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);

  const world = createWriteFixtureWorld();
  const stores = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const scheduler = new ManualScheduler(clock);
  const ids = sequentialIdFactory("c");
  const log = recordingLogger().log;
  const emitter = recordingTimelineEmitter(database, clock);

  const run = async (options: Readonly<{ dryRun?: boolean; probe?: unknown }> = {}): Promise<void> => {
    const dryRun = options.dryRun ?? true;
    const workerPorts = testWorkerPorts(database, clock, { path: join(root, "state.db"), descriptor: writeFixtureDescriptor, poolIndex: 1 });
    assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun })).state, "inserted");

    world.probeResults.push(options.probe ?? absentProbeEvidence(WRITE_FIXTURE_NOW));
    await runWorkerLoop({
      ...workerPorts,
      workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID),
      workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID),
      descriptor: writeFixtureDescriptor,
      stores,
      authority: database,
      sessionFactory: sessions.factory,
      emitter: emitter.emitter,
      clock,
      ids,
      scheduler,
      taskDeadlineMs: 60_000,
      sessionAcquireMs: 20_000,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000,
      log,
      stopSignal: new AbortController().signal,
      exitWhenIdle: true,
      writeSequencerFor: (manager) => createWriteSequencer({
        lifecycle: testRunLifecycle(database, clock),
        stores,
        authority: database,
        sessions: manager,
        emitter: emitter.emitter,
        clock,
        ids,
        scheduler,
        taskDeadlineMs: 60_000,
        operator: "local-operator",
        log,
        resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
      }),
    });
  };

  return { database, clock, world, emitter, run };
}

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("a dry run previews its transaction node and ends there", () => {
afterEach(() => {
  for (const open of kualiOpen.splice(0)) open.dispose();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

  it("settles a previewed run with a preview record and NOTHING durable from the write half", async () => {
    const h = harness();
    await h.run();

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state, "terminal");
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "done");


    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result, "a settled run holds its terminal record");
    assert.equal(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);
    assert.notEqual(
      result.resultSchemaHash,
      workflowTerminalResultExecution(writeFixtureDescriptor).schemaHash,
      "a preview must never be bound to the workflow's declared result schema",
    );
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
    assert.equal(preview.kind, "dry-run-preview");
    assert.equal(preview.externalCommit, "none");
    assert.equal(preview.stoppedAtNodeId, WRITE_FIXTURE_NODE_ID);
    assert.equal(preview.preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.preview.probe.state, "absent");
    assert.equal(preview.preview.outcome.state, "would-prepare");
    assert.equal(
      preview.preview.outcome.state === "would-prepare" ? preview.preview.outcome.subject.state : undefined,
      "match",
    );


    const support = workflowDryRunSupport(writeFixtureDescriptor);
    assert.equal(support.state === "supported" ? support.stopsAt : "", preview.stoppedAtNodeId);


    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
      "zero write intents — the fence was never reached",
    );
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        record.envelope.itemId,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "zero transaction checkpoints — a preview settles nothing",
    );
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");
    assert.equal(
      h.world.events.some((event) => event.startsWith("commit-click:")),
      false,
      "zero commit clicks",
    );

    assert.deepEqual(
      h.world.events.slice(0, 2),
      ["probe", "prepare"],
      "the preview probes first, then stages — the real path's order",
    );

    assert.ok(h.world.events.includes("prepare"), h.world.events.join(","));
    assert.ok(
      h.world.events.some((event) => event.startsWith("subject-read:")),
      h.world.events.join(","),
    );
  });

  it("previews an already-present subject as an OUTCOME, staging nothing and writing nothing", async () => {
    const h = harness();
    await h.run({ probe: { state: "present", proof: { transactionId: "T900001" } } });

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "done");
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.equal(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
    assert.equal(preview.preview.probe.state, "present");
    assert.deepEqual(preview.preview.outcome, { state: "already-present", proofSource: "live-probe" });
    assert.equal(preview.externalCommit, "none");

    assert.deepEqual(h.world.events, ["probe"], "the probe settled it; no page was ever staged");
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
      "a preview never records an observed-present intent",
    );
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        record.envelope.itemId,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "a preview settles nothing, including an already-present settlement",
    );

    const previewed = h.emitter.events().filter((event) => event.t === "transaction.previewed");
    assert.equal(previewed.length, 1);
    assert.equal(
      previewed[0]?.subject,
      "not-observed",
      "no page was staged, so no subject was read — and the span says so rather than claiming a match",
    );
  });

  it("refuses the preview when the probe cannot answer, rather than staging anyway", async () => {
    const h = harness();
    await h.run({
      probe: { state: "unknown", reason: "the grid never rendered", observedAt: WRITE_FIXTURE_NOW },
    });

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "failed");
    const failureId = record.lifecycle.state === "terminal" ? record.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = h.database.authority.failures.get(failureId);
    assert.ok(failure);
    const diagnostic = `${failure.summary} ${failure.causeChain.map(({ summary }) => summary).join(" ")}`;
    assert.match(diagnostic, /is indeterminate; the real run would refuse/u);
    assert.doesNotMatch(diagnostic, /grid never rendered/u);
    assert.deepEqual(h.world.events, ["probe"], "nothing was staged behind an unanswerable probe");
    const terminal = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(terminal);
    const retainedFailure = RunTerminalEvidenceResultSchema.parse(terminal.result.value);
    assert.equal(retainedFailure.kind, "failed-evidence");
    if (retainedFailure.kind !== "failed-evidence") throw new Error("terminal failure evidence missing");
    assert.equal(retainedFailure.authorization.failureId, failureId);
    assert.equal(retainedFailure.failureDigest, deriveTerminalFailureDigest(failure));
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
    );
  });
});
}

{
const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;

function runUnderMovedClosure(patch: Readonly<{
  envelope?: Record<string, unknown>;
  inputParsed?: Record<string, unknown>;
}> = {}): unknown {
  const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
  return {
    ...run,
    envelope: { ...run.envelope, contractFingerprint: MOVED_CLOSURE, ...(patch.envelope ?? {}) },
    input: { ...run.input, parsed: { ...run.input.parsed, ...(patch.inputParsed ?? {}) } },
  };
}

function receiptFrom(overrides: Partial<ReceiptBuildInput> = {}): RunEvidenceReceipt {
  return buildRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides });
}

function refusalFor(overrides: Partial<ReceiptBuildInput>): string {
  try {
    receiptFrom(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the derivation was expected to refuse and did not");
}

describe("receipt derivation binding — a moved surface refuses by name", () => {

  it("refuses when the terminal dependency set the stored result was built from has moved", () => {
    const evidence = kualiReceiptEvidence();
    assert.ok(evidence.result !== null && typeof evidence.result === "object");


    const message = refusalFor({
      run: runUnderMovedClosure(),
      result: {
        ...evidence.result,
        dependencies: [],
        dependencyDigest: deriveTerminalDependencyDigest([]),
      },
    });
    assert.match(message, /terminal-dependency-set moved/);
    assert.match(message, /the mandatory-evidence set would move/);
  });
});
}
