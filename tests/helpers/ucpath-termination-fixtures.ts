import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * The separations chunk-4 UCPath transaction harness.
 *
 * Same shape and same claim as the Kuali one it is modelled on: nothing here is
 * synthetic except the process edges. The contracts, the store, the driver
 * semantics, the descriptor and BOTH transaction nodes are the REGISTERED
 * production ones; only the browser (a deterministic Smart HR world), the
 * clock, the id source, the timer and the span sink are fakes. That is what
 * lets a scenario say "zero rows in `run_operations`" about the real authority
 * database rather than about a mock.
 *
 * The identity below is synthetic on purpose. The live surface was verified
 * read-only and NOTHING was ever submitted; no real EID belongs in the tree.
 */
import { fixtureDuoCeremonyGates } from "./duo-ceremony-fixtures.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import type { WriteSequencerContext } from "../../src/core/run-executor.js";
import {
  createWriteSequencer,
  type ProductionWriteSequencer,
} from "../../src/core/write-sequencer.js";
import { withBoundRunConfigFingerprint, WorkerSessionManager } from "../../src/core/worker-sessions.js";
import {
  EidSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import type { RuntimeFlowNode } from "../../src/domain/workflow/graph.js";
import { AuthorityDatabase } from "./synthetic-storage-admission.js";
import {
  createDeterministicUcpathSmartHrWorldDriver,
  createUcpathSmartHrFakeWorld,
  type UcpathSmartHrFakeWorld,
} from "../../src/stores/ucpath/driver/smart-hr-fake.js";
import type {
  UcpathPendingTransactionSet,
  UcpathSsSmartHrSettlementDiagnostic,
  UcpathTransactionRow,
} from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import { isUcpathTerminationInProgress } from "../../src/domain/ui/ucpath-smart-hr-termination.js";
import { ucpathPendingSweepIdempotencyKey } from "../../src/domain/contracts/ucpath/delete-pending-terminations.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import {
  SeparationsUcpathTerminationCanonicalInput,
  SeparationsUcpathTerminationInput,
} from "../../src/workflows/separations/ucpath-transaction/workflow.js";
import { separationsUcpathTerminationDescriptor } from "./registered-workflows.js";
import { UUID_2, UUID_3, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
} from "./phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";

export const TERMINATION_EID = EidSchema.parse("10800000");
export const TERMINATION_NAME = "Deterministic Person";
export const TERMINATION_OTHER_NAME = "Somebody Else";
export const TERMINATION_DOCUMENT = "4444";
export const TERMINATION_EFFECTIVE_DATE = "06/11/2026";
export const TERMINATION_LAST_DATE_WORKED = "06/10/2026";
export const TERMINATION_WORKFLOW_ID = "separations-ucpath-termination";
export const TERMINATION_SWEEP_NODE = "clear-pending";
export const TERMINATION_FILE_NODE = "file-termination";
export const TERMINATION_WORKER_ID = "ucpath-termination-worker-1";
export const TERMINATION_RUN_ID = UUID_2;
export const TERMINATION_ITEM_ID = UUID_3;
export const TERMINATION_NOW = "2026-08-13T10:00:00.000Z";
export const TERMINATION_IMPL_FINGERPRINT = FingerprintSchema.parse("e".repeat(64));
export const TERMINATION_CONFIG_FINGERPRINT = FingerprintSchema.parse("b".repeat(64));
export const TERMINATION_RECEIPT = "T009000001";

export const TERMINATION_RUN_INPUT = Object.freeze({
  documentNumber: TERMINATION_DOCUMENT,
  employeeName: "Person, Deterministic",
  emplId: TERMINATION_EID,
  emplIdSource: "document-eid" as const,
  documentEid: { state: "present" as const, value: TERMINATION_EID },
  terminationType: { state: "present" as const, value: "No Reason Given" },
  observedTerminationTypeOptions: ["- - -", "No Reason Given"],
  emplRecord: "0",
  effectiveDate: TERMINATION_EFFECTIVE_DATE,
  lastDateWorked: TERMINATION_LAST_DATE_WORKED,
  initiatorComments: "Separation filed from Kuali RRSS document 4444.",
});

/** The natural keys the two commit contracts derive — recomputed, never copied. */
export const TERMINATION_IDEMPOTENCY_KEY =
  `ucpath:termination|${TERMINATION_EID}|${TERMINATION_EFFECTIVE_DATE}`;
export function terminationPendingSet(
  rows: readonly UcpathTransactionRow[],
  emplId = TERMINATION_EID,
): UcpathPendingTransactionSet {
  const ordered = [...rows].sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  return {
    kind: "ucpath-pending-termination-set",
    emplId,
    eligible: ordered.filter(isUcpathTerminationInProgress),
    protected: ordered.filter((row) => !isUcpathTerminationInProgress(row)),
    observedAt: IsoInstantSchema.parse(TERMINATION_NOW),
    source: "ss-smart-hr-detail-read",
  };
}

export function sweepIdempotencyKey(rows: readonly UcpathTransactionRow[]): string {
  return ucpathPendingSweepIdempotencyKey({
    emplId: TERMINATION_EID,
    expectedName: TERMINATION_NAME,
    observedSet: terminationPendingSet(rows),
  });
}

export const SWEEP_IDEMPOTENCY_KEY = sweepIdempotencyKey([]);

/** The post-gate scope both transaction nodes bind against. */
export const TERMINATION_SCOPE_OUTPUTS = Object.freeze({
  approval: {
    documentNumber: TERMINATION_DOCUMENT,
    approved: {
      authority: "operator-approval",
      emplId: TERMINATION_EID,
      chosenFrom: "checked" as const,
      evidenceDigest: "a".repeat(64),
      ucpathName: TERMINATION_NAME,
      nameTier: "same" as const,
      approvalShape: "one-click" as const,
    },
    jobs: {
      disposition: "single-active-job" as const,
      rows: [],
      activeRows: [],
    },
  },
  "termination-type": {
    terminationType: "No Reason Given",
    classification: "voluntary" as const,
    template: "UC_VOL_TERM" as const,
    reasonCode: "Resign - No Reason Given",
    observedOptionCount: 2,
  },
});

export function terminationNode(
  id: string,
): Extract<RuntimeFlowNode, { kind: "transaction" }> {
  const node = descriptorRuntimeNodes(separationsUcpathTerminationDescriptor)
    .find((candidate): candidate is Extract<RuntimeFlowNode, { kind: "transaction" }> =>
      candidate.kind === "transaction" && String(candidate.id) === id);
  if (node === undefined) throw new Error(`the termination descriptor lost its "${id}" node`);
  return node;
}

export function terminationQueuedRun(
  options: Readonly<{ dryRun?: boolean }> = {},
): Record<string, unknown> {
  return {
    envelope: {
      runId: TERMINATION_RUN_ID,
      workflow: TERMINATION_WORKFLOW_ID,
      itemId: TERMINATION_ITEM_ID,
      traceId: "st-100000-2222",
      descriptorVersion: 1,
      contractFingerprint: separationsUcpathTerminationDescriptor.contractFingerprint,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: TERMINATION_CONFIG_FINGERPRINT,
      configSnapshotId: UUID_4,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: TERMINATION_NOW,
    },
    input: {
      raw: { ...TERMINATION_RUN_INPUT },
      parsed: {
        schemaHash: deriveSchemaHash(SeparationsUcpathTerminationCanonicalInput, "output"),
        value: { ...TERMINATION_RUN_INPUT },
      },
      ingressSchemaHash: deriveSchemaHash(SeparationsUcpathTerminationInput, "input"),
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: TERMINATION_NOW,
    updatedAt: TERMINATION_NOW,
  };
}

export interface TerminationHarness {
  readonly world: UcpathSmartHrFakeWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  readonly bound: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly dispose: () => void;
}

export function terminationHarness(options: Readonly<{
  rows?: readonly UcpathTransactionRow[];
  displayedName?: string;
  /** Who Page B shows AFTER staging — the beat-③ mismatch arm. */
  displayedNameAfterStage?: string;
  unreadable?: Readonly<{
    reason: string;
    diagnostic: UcpathSsSmartHrSettlementDiagnostic;
  }>;
  commitPerformed?: boolean;
}> = {}): TerminationHarness {
  const clock = manualClock(new Date(TERMINATION_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-ucpath-termination-"));
  const database = AuthorityDatabase.open(
    {
      path: join(root, "authority.sqlite"),
      busyTimeoutMs: 250,
      migrationOwner: "ucpath-termination-test",
    },
    clock,
  );
  const world = createUcpathSmartHrFakeWorld({
    emplId: TERMINATION_EID,
    displayedName: options.displayedName ?? TERMINATION_NAME,
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    nextTransactionId: TERMINATION_RECEIPT,
  });
  if (options.displayedNameAfterStage !== undefined) {
    world.displayedNameAfterStage = options.displayedNameAfterStage;
  }
  if (options.unreadable !== undefined) world.unreadable = options.unreadable;
  if (options.commitPerformed !== undefined) world.commitPerformed = options.commitPerformed;
  const sessions = sessionFactoryHarness({
    ucpath: () => createDeterministicUcpathSmartHrWorldDriver(world, () => clock.now()),
  });
  const manager = new WorkerSessionManager({
    workerId: WorkerIdSchema.parse(TERMINATION_WORKER_ID),
    workflowId: WorkflowIdSchema.parse(TERMINATION_WORKFLOW_ID),
    stores: taskStoreRegistry,
    factory: sessions.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: fixtureDuoCeremonyGates(clock),
  });
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("f");
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(database, clock),
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
    resolveImplFingerprint: () => TERMINATION_IMPL_FINGERPRINT,
  });
  return {
    world, database, clock, emitter, ids, sequencer,
    bound: <Result>(work: () => Promise<Result>): Promise<Result> =>
      withBoundRunConfigFingerprint(manager, TERMINATION_CONFIG_FINGERPRINT, work),
    dispose: (): void => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function terminationClaimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = terminationQueuedRun(),
  nodeId: string = TERMINATION_FILE_NODE,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const workerId = TERMINATION_WORKER_ID;
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  if (enqueued.state !== "inserted") throw new Error(`enqueue outcome was ${enqueued.state}`);
  const claimed = database.authority.runs.claimNext({
    workflow: TERMINATION_WORKFLOW_ID,
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
  if (validating.state !== "applied") throw new Error("validating transition failed");
  const running = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version + 1,
    claim,
    lifecycle: { state: "running", ...base, currentNodeId: nodeId },
    now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

export function terminationContext(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  nodeId: string,
  dryRun = false,
  pendingRows: readonly UcpathTransactionRow[] = [],
): WriteSequencerContext {
  return {
    descriptor: separationsUcpathTerminationDescriptor,
    node: terminationNode(nodeId),
    run,
    claim: {
      workerId: claim.workerId,
      claimGeneration: claim.claimGeneration,
    } as WriteSequencerContext["claim"],
    scope: {
      input: { ...TERMINATION_RUN_INPUT },
      outputs: {
        ...TERMINATION_SCOPE_OUTPUTS,
        "pending-set": terminationPendingSet(pendingRows),
      },
    },
    dryRun,
    signal: new AbortController().signal,
  };
}

/**
 * The durable-absence assertion the dry-run and wrong-subject proofs turn on:
 * NOTHING about this transaction exists in the authority database.
 */
export function terminationDurableFootprint(
  harness: TerminationHarness,
  nodeId: string,
  permanentKey: string,
): Readonly<{ intent: unknown; checkpoint: unknown; outboxes: readonly unknown[] }> {
  const intent = harness.database.authority.writeIntents.findByPermanentKey("ucpath", permanentKey);
  const checkpoint = harness.database.authority.runCheckpoints.latest(
    TERMINATION_WORKFLOW_ID,
    TERMINATION_ITEM_ID,
    nodeId,
  );
  // Retain this shared fixture field for existing callers; its evidence is now
  // immutable native confirmations, so zero-write assertions remain substantive.
  const outboxes = harness.database.authority.timelineEvents.page({}).filter(
    (event) => event.payload.kind === "operation-confirmed"
      && event.payload.facts.writeIntentId === intent?.writeIntentId,
  );
  return { intent, checkpoint, outboxes };
}
