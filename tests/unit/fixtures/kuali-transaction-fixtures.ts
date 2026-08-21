/**
 * The Phase-2 Kuali transaction harness.
 *
 * Unlike `write-sequencer-fixtures`, nothing here is synthetic except the
 * process edges: the contracts, the store, the driver semantics, the descriptor
 * and the transaction node are the REGISTERED production ones. Only the browser
 * (a deterministic Kuali document), the clock, the id source, the timer, and
 * the span sink are fakes — which is what lets a test say "zero rows in
 * `write_intents`" about the real authority database rather than about a mock.
 *
 * The document identity below is synthetic on purpose. No real action id,
 * document number, or EID belongs in the tree: the live surface was verified
 * read-only and captured no values.
 */
import { fixtureDuoCeremonyGates } from "./duo-ceremony-fixtures.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock, type TestClock } from "../../../src/domain/clock.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import type { WriteSequencerContext } from "../../../src/core/run-executor.js";
import {
  createWriteSequencer,
  type ProductionWriteSequencer,
  type WriteSequencerHooks,
} from "../../../src/core/write-sequencer.js";
import { withBoundRunConfigFingerprint, WorkerSessionManager } from "../../../src/core/worker-sessions.js";
import {
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/domain/ids.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import type { RuntimeFlowNode } from "../../../src/domain/workflow/graph.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import type { AuthorityWriteCommitHooks } from "../../../src/infra/sqlite/authority-database.js";
import {
  createDeterministicKualiDriver,
  createKualiFakeWorld,
  type KualiFakeWorld,
} from "../../../src/stores/kuali/driver/fake.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import { kualiTimekeeperAnnotationDescriptor } from "../../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import {
  KualiTimekeeperAnnotationCanonicalInput,
  KualiTimekeeperAnnotationInput,
} from "../../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import { UUID_2, UUID_3, UUID_4 } from "./phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
} from "./phase1f-executor-harness.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";

export const KUALI_ACTION_ID = "0123456789abcdef01234567";
export const KUALI_DOCUMENT_NUMBER = "4444";
export const KUALI_EID = "10800000";
export const KUALI_OTHER_EID = "10800001";
export const KUALI_TIMEKEEPER_VALUE = "PROBE-DELETE-ME";
export const KUALI_WORKFLOW_ID = "kuali-timekeeper-annotation";
export const KUALI_NODE_ID = "annotate-timekeeper";
export const KUALI_WORKER_ID = "kuali-transaction-worker-1";
export const KUALI_RUN_ID = UUID_2;
export const KUALI_ITEM_ID = UUID_3;
export const KUALI_NOW = "2026-08-04T10:00:00.000Z";
export const KUALI_IMPL_FINGERPRINT = FingerprintSchema.parse("d".repeat(64));
export const KUALI_CONFIG_FINGERPRINT = FingerprintSchema.parse("b".repeat(64));

export const KUALI_RUN_INPUT = Object.freeze({
  actionId: KUALI_ACTION_ID,
  documentNumber: KUALI_DOCUMENT_NUMBER,
  emplId: KUALI_EID,
  timekeeperName: KUALI_TIMEKEEPER_VALUE,
});

/** The natural key the commit contract derives — recomputed here, never copied. */
export const KUALI_IDEMPOTENCY_KEY =
  `kuali:${KUALI_DOCUMENT_NUMBER}|${KUALI_ACTION_ID}|timekeeper-name|${KUALI_EID}|${KUALI_TIMEKEEPER_VALUE}`;

export function kualiTransactionNode(): Extract<RuntimeFlowNode, { kind: "transaction" }> {
  const node = descriptorRuntimeNodes(kualiTimekeeperAnnotationDescriptor)
    .find((candidate): candidate is Extract<RuntimeFlowNode, { kind: "transaction" }> =>
      candidate.kind === "transaction");
  if (node === undefined) throw new Error("kuali descriptor lost its transaction node");
  return node;
}

export function kualiQueuedRun(options: Readonly<{ dryRun?: boolean }> = {}): Record<string, unknown> {
  return {
    envelope: {
      runId: KUALI_RUN_ID,
      workflow: KUALI_WORKFLOW_ID,
      itemId: KUALI_ITEM_ID,
      traceId: "kt-100000-2222",
      descriptorVersion: 1,
      contractFingerprint: kualiTimekeeperAnnotationDescriptor.contractFingerprint,
      resolvedInstance: { kuali: "prod" },
      configFingerprint: KUALI_CONFIG_FINGERPRINT,
      configSnapshotId: UUID_4,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: KUALI_NOW,
    },
    input: {
      raw: { ...KUALI_RUN_INPUT },
      parsed: {
        schemaHash: deriveSchemaHash(KualiTimekeeperAnnotationCanonicalInput, "output"),
        value: { ...KUALI_RUN_INPUT },
      },
      ingressSchemaHash: deriveSchemaHash(KualiTimekeeperAnnotationInput, "input"),
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: KUALI_NOW,
    updatedAt: KUALI_NOW,
  };
}

export interface KualiHarness {
  readonly world: KualiFakeWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly manager: WorkerSessionManager;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  readonly bound: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly dispose: () => void;
}

export function kualiHarness(options: Readonly<{
  persistedTimekeeperName?: string;
  displayedEid?: string;
  /** What the EID field shows AFTER prepare stages — the beat-③ mismatch arm. */
  displayedEidAfterStage?: string;
  /** Crash injection inside the Phase-1c four-row primitive (beat ⑦ inner). */
  commitHooks?: AuthorityWriteCommitHooks;
  /** Crash injection between the outer beat-⑦ bundle's steps. */
  hooks?: WriteSequencerHooks;
  /** Share one authority database across harnesses (the multi-worker arms). */
  database?: AuthorityDatabase;
  /** Distinguish concurrent workers over one database. */
  workerId?: string;
}> = {}): KualiHarness {
  const clock = manualClock(new Date(KUALI_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-kuali-transaction-"));
  const owned = options.database === undefined;
  const database = options.database ?? AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "kuali-transaction-test" },
    clock,
    options.commitHooks,
  );
  const world = createKualiFakeWorld({
    actionId: KUALI_ACTION_ID,
    documentNumber: KUALI_DOCUMENT_NUMBER,
    displayedEid: options.displayedEid ?? KUALI_EID,
    ...(options.persistedTimekeeperName === undefined
      ? {}
      : { persistedTimekeeperName: options.persistedTimekeeperName }),
  });
  if (options.displayedEidAfterStage !== undefined) {
    world.displayedEidAfterStage = options.displayedEidAfterStage;
  }
  const sessions = sessionFactoryHarness({ kuali: () => createDeterministicKualiDriver(world, clock) });
  const manager = new WorkerSessionManager({
    workerId: WorkerIdSchema.parse(options.workerId ?? KUALI_WORKER_ID),
    workflowId: WorkflowIdSchema.parse(KUALI_WORKFLOW_ID),
    stores: taskStoreRegistry,
    factory: sessions.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: fixtureDuoCeremonyGates(clock),
  });
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("c");
  const sequencer = createWriteSequencer({
    stores: taskStoreRegistry,
    authority: database,
    sessions: manager,
    emitter: emitter.emitter,
    clock,
    ids,
    scheduler: new ManualScheduler(clock),
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    log: recordingLogger().log,
    resolveImplFingerprint: () => KUALI_IMPL_FINGERPRINT,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  return {
    world, database, clock, manager, emitter, ids, sequencer,
    bound: <Result>(work: () => Promise<Result>): Promise<Result> =>
      withBoundRunConfigFingerprint(manager, KUALI_CONFIG_FINGERPRINT, work),
    dispose: (): void => {
      if (owned) database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function kualiClaimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = kualiQueuedRun(),
  workerIdInput: string = KUALI_WORKER_ID,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const workerId = workerIdInput;
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  if (enqueued.state !== "inserted") throw new Error(`enqueue outcome was ${enqueued.state}`);
  const claimed = database.authority.runs.claimNext({ workflow: KUALI_WORKFLOW_ID, workerId, now });
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
  if (validating.state !== "applied") throw new Error("validating transition failed");
  const running = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version + 1,
    claim,
    lifecycle: { state: "running", ...base, currentNodeId: KUALI_NODE_ID },
    now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

export function kualiContext(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  dryRun = false,
  descriptor: AnyWorkflowDescriptor = kualiTimekeeperAnnotationDescriptor,
): WriteSequencerContext {
  return {
    descriptor,
    node: kualiTransactionNode(),
    run,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration } as WriteSequencerContext["claim"],
    scope: { input: { ...KUALI_RUN_INPUT }, outputs: {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

/**
 * The durable-absence assertion the dry-run and wrong-subject proofs turn on:
 * NOTHING about this transaction exists in the authority database.
 */
export function kualiDurableFootprint(harness: KualiHarness): Readonly<{
  intent: unknown;
  checkpoint: unknown;
  outboxes: readonly unknown[];
}> {
  const intent = harness.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
  const checkpoint = harness.database.authority.runCheckpoints.latest(
    KUALI_WORKFLOW_ID,
    KUALI_ITEM_ID,
    KUALI_NODE_ID,
  );
  const outboxes = harness.ids.minted()
    .map((id) => harness.database.authority.durableOutbox.get(id))
    .filter((row) => row !== undefined);
  return { intent, checkpoint, outboxes };
}
