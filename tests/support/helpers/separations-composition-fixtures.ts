import { admitProtectedInput } from "../../../src/backend/runs/start/protected-input.js";
import { protectedSecretSource } from "./protected-secret-source.js";
import { testWorkerLifetime, testRunLifecycle, testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";

import { fixtureDuoCeremonyGates } from "./duo-ceremony-fixtures.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { manualClock, type TestClock } from "../../../src/rules/time/clock.js";
import type { WriteSequencerContext } from "../../../src/backend/runtime/execution/run-executor.js";
import {
  createWriteSequencer,
  type ProductionWriteSequencer,
} from "../../../src/backend/runtime/writes/write-sequencer.js";
import { withBoundRunConfigFingerprint, WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { kualiFinalizationIdempotencyKey } from "../../../src/models/systems/kuali/save-separation-finalization.js";
import { ucpathPendingSweepIdempotencyKey } from "../../../src/models/systems/ucpath/delete-pending-terminations.js";
import {
  EidSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import {
  buildFinalizationComments,
  separationInitials,
} from "../../../src/rules/separations/separation-dates.js";
import {
  kualiFinalizationFields,
  type KualiFinalizationFields,
  type KualiFinalizationVariables,
  type KualiObservedFinalizationFields,
} from "../../../src/models/ui/kuali-separation-finalization.js";
import type { UcpathTransactionRow } from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { isUcpathTerminationInProgress } from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import type { RuntimeFlowNode } from "../../../src/models/workflow/graph.js";
import { AuthorityDatabase } from "./synthetic-storage-admission.js";
import {
  createDeterministicKualiDriver,
  createKualiFakeWorld,
  type KualiFakeWorld,
} from "../../../src/backend/systems/kuali/driver/fake.js";
import {
  createDeterministicUcpathSmartHrWorldDriver,
  createUcpathSmartHrFakeWorld,
  type UcpathSmartHrFakeWorld,
} from "../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { SeparationsCanonicalInput, SeparationsInput } from "../../../src/workflows/separations/workflow.js";
import { UUID_2, UUID_3, CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
} from "./phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { separationsDescriptor } from "./registered-workflows.js";

export const COMPOSITION_WORKFLOW_ID = "separations";
export const COMPOSITION_ACTION_ID = "0123456789abcdef01234567";
export const COMPOSITION_DOCUMENT = "4444";
export const COMPOSITION_EID = EidSchema.parse("10800000");
export const COMPOSITION_OTHER_EID = EidSchema.parse("10800001");
export const COMPOSITION_UCPATH_NAME = "Deterministic Person";
export const COMPOSITION_OTHER_NAME = "Somebody Else";
export const COMPOSITION_DOCUMENT_NAME = "Person, Deterministic";
export const COMPOSITION_TIMEKEEPER = "Deterministic Timekeeper";
export const COMPOSITION_RECEIPT = "T009000001";
export const COMPOSITION_WORKER_ID = "separations-worker-1";
export const COMPOSITION_RUN_ID = UUID_2;
export const COMPOSITION_ITEM_ID = UUID_3;
export const COMPOSITION_NOW = "2026-08-14T10:00:00.000Z";
export const COMPOSITION_IMPL_FINGERPRINT = FingerprintSchema.parse("c".repeat(64));
export const COMPOSITION_CONFIG_FINGERPRINT = FingerprintSchema.parse(CONFIG_SNAPSHOT.fingerprint);

export const SWEEP_NODE = "clear-pending";
export const TERMINATION_NODE = "file-termination";
export const FINALIZE_NODE = "finalize-kuali";

/** The reconciled dates the graph's own fold produces for the fixture timecard. */
export const COMPOSITION_KUALI_LDW = "06/12/2026";
export const COMPOSITION_LAST_DAY_WORKED = "06/12/2026";
export const COMPOSITION_SEPARATION_DATE = "06/19/2026";
export const COMPOSITION_EFFECTIVE_DATE = "06/20/2026";
export const COMPOSITION_AS_OF_DATE = "08/14/2026";
export const COMPOSITION_DEPARTMENT_OPTION = "000412 - Housing/Dining/Hospitality";
export const COMPOSITION_EXISTING_COMMENTS = "";

export const COMPOSITION_DATE_CHANGE_COMMENTS =
  `Updated Separation Date from ${COMPOSITION_KUALI_LDW} to ${COMPOSITION_SEPARATION_DATE} `
  + `per Kronos timesheet. -${separationInitials(COMPOSITION_TIMEKEEPER)}`;

export const COMPOSITION_TERMINATION_COMMENTS =
  `Termination eff ${COMPOSITION_EFFECTIVE_DATE}. Last Day Worked ${COMPOSITION_LAST_DAY_WORKED}. `
  + `Holiday Pay on ${COMPOSITION_SEPARATION_DATE}. Kuali form #${COMPOSITION_DOCUMENT}.`;

/** Recomputed through the production builder, never copied. */
export const COMPOSITION_FINALIZATION_COMMENTS = buildFinalizationComments({
  existingComments: COMPOSITION_EXISTING_COMMENTS,
  dateChangeComments: COMPOSITION_DATE_CHANGE_COMMENTS,
  documentNumber: COMPOSITION_DOCUMENT,
  transactionNumber: COMPOSITION_RECEIPT,
  initials: separationInitials(COMPOSITION_TIMEKEEPER),
  asOfDate: COMPOSITION_AS_OF_DATE,
});

export const COMPOSITION_VARIABLES: KualiFinalizationVariables = Object.freeze({
  department: COMPOSITION_DEPARTMENT_OPTION,
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: COMPOSITION_TIMEKEEPER,
  // Use the reconciled date constants so separately spelled fixtures cannot accidentally agree.
  lastDayWorked: COMPOSITION_LAST_DAY_WORKED,
  separationDate: COMPOSITION_SEPARATION_DATE,
  terminationEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
  transactionNumber: COMPOSITION_RECEIPT,
  timekeeperComments: COMPOSITION_FINALIZATION_COMMENTS,
  observedExistingComments: COMPOSITION_EXISTING_COMMENTS,
});

export const COMPOSITION_FINALIZATION_FIELDS: KualiFinalizationFields =
  kualiFinalizationFields(COMPOSITION_VARIABLES);


export const COMPOSITION_RUN_INPUT = Object.freeze({
  documentNumber: COMPOSITION_DOCUMENT,
  timekeeperName: COMPOSITION_TIMEKEEPER,
  searchTimeoutMs: 15_000,
});

/** What `resolve-action` produces, as the live Action List renders it. */
export const COMPOSITION_ACTION_HREF =
  `/build/space/5e47518b90adda9474c14adb/actions/${COMPOSITION_ACTION_ID}`;

export const COMPOSITION_ACTION_RESOLUTION = Object.freeze({
  pageStateId: "kuali.action-list.ready" as const,
  documentNumber: COMPOSITION_DOCUMENT,
  actionId: COMPOSITION_ACTION_ID,
  actionHref: COMPOSITION_ACTION_HREF,
  matchedLinkCount: 2,
  observedAt: COMPOSITION_NOW,
});

export function compositionPendingSet(rows: readonly UcpathTransactionRow[]) {
  const ordered = [...rows].sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  return {
    kind: "ucpath-pending-termination-set" as const,
    emplId: COMPOSITION_EID,
    eligible: ordered.filter(isUcpathTerminationInProgress),
    protected: ordered.filter((row) => !isUcpathTerminationInProgress(row)),
    observedAt: IsoInstantSchema.parse(COMPOSITION_NOW),
    source: "ss-smart-hr-detail-read" as const,
  };
}

/** The natural keys the three commit contracts derive — recomputed, never copied. */
export function compositionSweepIdempotencyKey(rows: readonly UcpathTransactionRow[]): string {
  return ucpathPendingSweepIdempotencyKey({
    emplId: COMPOSITION_EID,
    expectedName: COMPOSITION_UCPATH_NAME,
    observedSet: compositionPendingSet(rows),
  });
}
export const SWEEP_IDEMPOTENCY_KEY = compositionSweepIdempotencyKey([]);
export const TERMINATION_IDEMPOTENCY_KEY =
  `ucpath:termination|${COMPOSITION_EID}|${COMPOSITION_EFFECTIVE_DATE}`;
export const FINALIZATION_IDEMPOTENCY_KEY = kualiFinalizationIdempotencyKey({
  actionId: COMPOSITION_ACTION_ID,
  documentNumber: COMPOSITION_DOCUMENT,
  emplId: COMPOSITION_EID,
  variables: COMPOSITION_VARIABLES,
});


export const COMPOSITION_SCOPE_OUTPUTS = Object.freeze({
  "resolve-action": COMPOSITION_ACTION_RESOLUTION,
  document: {
    timekeeper: { comments: { state: "absent" as const, reason: "the control was empty" } },
  },
  plan: { asOfDate: COMPOSITION_AS_OF_DATE },
  approval: {
    documentNumber: COMPOSITION_DOCUMENT,
    approved: {
      authority: "operator-approval",
      emplId: COMPOSITION_EID,
      chosenFrom: "checked" as const,
      evidenceDigest: "a".repeat(64),
      ucpathName: COMPOSITION_UCPATH_NAME,
      nameTier: "same" as const,
      approvalShape: "one-click" as const,
    },
    jobs: { disposition: "single-active-job" as const, rows: [], activeRows: [] },
  },
  "termination-type": {
    terminationType: "No Reason Given",
    classification: "voluntary" as const,
    template: "UC_VOL_TERM" as const,
    reasonCode: "Resign - No Reason Given",
    observedOptionCount: 2,
  },
  employment: {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    deptId: { state: "present" as const, value: "000412" },
    department: { state: "present" as const, value: "HOUSING/DINING/HOSPITALITY" },
    payrollTitleCode: COMPOSITION_VARIABLES.payrollTitleCode,
    payrollTitle: COMPOSITION_VARIABLES.payrollTitle,
    effectiveDate: { state: "present" as const, value: "07/01/2025" },
    rowCount: 1,
  },
  "department-option": {
    option: COMPOSITION_DEPARTMENT_OPTION,
    departmentCode: "000412",
    optionDescription: "Housing/Dining/Hospitality",
    ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
    observedOptionCount: 6,
  },
  dates: {
    lastDayWorked: COMPOSITION_LAST_DAY_WORKED,
    separationDate: COMPOSITION_SEPARATION_DATE,
    terminationEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
    kualiLastDayWorked: COMPOSITION_KUALI_LDW,
    kualiSeparationDate: COMPOSITION_KUALI_LDW,
    lastDayWorkedChanged: false,
    separationDateChanged: true,
    latestSickDate: null,
    firstHolidayDate: COMPOSITION_SEPARATION_DATE,
    latestHolidayDate: COMPOSITION_SEPARATION_DATE,
    separationDeterminingLeave: "holiday" as const,
    unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
    terminationComments: COMPOSITION_TERMINATION_COMMENTS,
    dateChangeComments: COMPOSITION_DATE_CHANGE_COMMENTS,
    source: "kronos-timesheet" as const,
  },
  "pending-set": compositionPendingSet([]),
  receipt: {
    transactionNumber: COMPOSITION_RECEIPT,
    approvalStatus: "Pending" as const,
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    disposition: "committed" as const,
  },
  "filing-presence": {
    kind: "ucpath-termination-filing-presence" as const,
    transactionId: COMPOSITION_RECEIPT,
    emplId: COMPOSITION_EID,
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    approvalStatus: "Pending" as const,
    displayedName: COMPOSITION_UCPATH_NAME,
    observedAt: COMPOSITION_NOW,
    source: "ss-smart-hr-detail-read" as const,
    receiptDisposition: "committed" as const,
    authority: "kuali-finalization-precondition" as const,
  },
});

export function compositionNode(id: string): Extract<RuntimeFlowNode, { kind: "transaction" }> {
  const node = descriptorRuntimeNodes(separationsDescriptor)
    .find((candidate): candidate is Extract<RuntimeFlowNode, { kind: "transaction" }> =>
      candidate.kind === "transaction" && String(candidate.id) === id);
  if (node === undefined) throw new Error(`the separations descriptor lost its "${id}" node`);
  return node;
}

export function compositionQueuedRun(
  options: Readonly<{ dryRun?: boolean }> = {},
): Record<string, unknown> {
  const admitted = admitProtectedInput(separationsDescriptor,
    [{ documentNumber: COMPOSITION_DOCUMENT, searchTimeoutMs: 15_000 }],
    protectedSecretSource({ timekeeperName: COMPOSITION_TIMEKEEPER }))[0];
  if (admitted === undefined) throw new Error("fixture protected input admission missing");
  return {
    envelope: {
      runId: COMPOSITION_RUN_ID,
      workflow: COMPOSITION_WORKFLOW_ID,
      itemId: COMPOSITION_ITEM_ID,
      traceId: "sp-100000-2222",
      descriptorVersion: 1,
      contractFingerprint: separationsDescriptor.contractFingerprint,
      resolvedInstance: { kuali: "prod", ucpath: "prod", "new-kronos": "prod" },
      configFingerprint: COMPOSITION_CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: COMPOSITION_NOW,
    },
    input: {
      raw: admitted.raw,
      parsed: {
        schemaHash: deriveSchemaHash(SeparationsCanonicalInput, "output"),
        value: admitted.admitted,
        protectedBindings: admitted.bindings,
      },
      ingressSchemaHash: deriveSchemaHash(SeparationsInput, "input"),
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: COMPOSITION_NOW,
    updatedAt: COMPOSITION_NOW,
  };
}

export interface CompositionHarness {
  readonly ucpath: UcpathSmartHrFakeWorld;
  readonly kuali: KualiFakeWorld;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  readonly bound: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly dispose: () => void;
}

export function compositionHarness(options: Readonly<{
  /** UCPath transaction rows the probe will scan. */
  rows?: readonly UcpathTransactionRow[];
  /** Who UCPath Page B shows AFTER staging — the beat-③ mismatch arm. */
  ucpathNameAfterStage?: string;
  /** Who the Kuali document shows AFTER staging — the same arm, one system over. */
  kualiEidAfterStage?: string;

  persistedFinalization?: KualiObservedFinalizationFields;

  kualiCommitDoesNotPersist?: boolean;
}> = {}): CompositionHarness {
  const clock = manualClock(new Date(COMPOSITION_NOW));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-separations-composition-"));
  const database = AuthorityDatabase.open(
    {
      path: join(root, "authority.sqlite"),
      busyTimeoutMs: 250,
      migrationOwner: "separations-composition-test",
    },
    clock,
  );
  testWorkerPorts(database, clock, { path: join(root, "authority.sqlite"), descriptor: separationsDescriptor, poolIndex: 1 });
  const ucpath = createUcpathSmartHrFakeWorld({
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    nextTransactionId: COMPOSITION_RECEIPT,
  });
  if (options.ucpathNameAfterStage !== undefined) {
    ucpath.displayedNameAfterStage = options.ucpathNameAfterStage;
  }
  const kuali = createKualiFakeWorld({
    actionId: COMPOSITION_ACTION_ID,
    documentNumber: COMPOSITION_DOCUMENT,
    displayedEid: COMPOSITION_EID,
  });
  if (options.persistedFinalization !== undefined) {
    kuali.persistedFinalization = { ...options.persistedFinalization };
  }
  if (options.kualiEidAfterStage !== undefined) {
    kuali.displayedEidAfterStage = options.kualiEidAfterStage;
  }
  if (options.kualiCommitDoesNotPersist === true) kuali.commitFinalizationDoesNotPersist = true;
  const sessions = sessionFactoryHarness({
    ucpath: () => createDeterministicUcpathSmartHrWorldDriver(ucpath, () => clock.now()),
    kuali: () => createDeterministicKualiDriver(kuali, clock),
  });
  const manager = new WorkerSessionManager({
    workerId: WorkerIdSchema.parse(COMPOSITION_WORKER_ID),
    workflowId: WorkflowIdSchema.parse(COMPOSITION_WORKFLOW_ID),
    stores: taskStoreRegistry,
    factory: sessions.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: fixtureDuoCeremonyGates(clock),
  });
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("d");
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
    resolveImplFingerprint: () => COMPOSITION_IMPL_FINGERPRINT,
  });
  return {
    ucpath, kuali, database, clock, emitter, ids, sequencer,
    bound: <Result>(work: () => Promise<Result>): Promise<Result> =>
      withBoundRunConfigFingerprint(manager, COMPOSITION_CONFIG_FINGERPRINT, work),
    dispose: (): void => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function compositionClaimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = compositionQueuedRun(),
  nodeId: string = SWEEP_NODE,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const workerId = COMPOSITION_WORKER_ID;
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  if (enqueued.state !== "inserted") throw new Error(`enqueue outcome was ${enqueued.state}`);
  const claimMember1 = database.authority.workerSlots.get(workerId);
  if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
  const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, COMPOSITION_WORKFLOW_ID, claimMember1.poolIndex).workerLifetime,
    workflow: COMPOSITION_WORKFLOW_ID,
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

export function compositionContext(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  nodeId: string,
  dryRun = false,
  pendingRows: readonly UcpathTransactionRow[] = [],
): WriteSequencerContext {
  return {
    descriptor: separationsDescriptor,
    node: compositionNode(nodeId),
    run,
    claim: {
      workerId: claim.workerId,
      claimGeneration: claim.claimGeneration,
    } as WriteSequencerContext["claim"],
    scope: {
      input: { ...COMPOSITION_RUN_INPUT },
      outputs: {
        ...COMPOSITION_SCOPE_OUTPUTS,
        "pending-set": compositionPendingSet(pendingRows),
      },
    },
    dryRun,
    signal: new AbortController().signal,
  };
}

/** NOTHING about this transaction exists in the authority database. */
export function compositionDurableFootprint(
  harness: CompositionHarness,
  system: "ucpath" | "kuali",
  nodeId: string,
  permanentKey: string,
): Readonly<{ intent: unknown; checkpoint: unknown; outboxes: readonly unknown[] }> {
  const intent = harness.database.authority.writeIntents.findByPermanentKey(system, permanentKey);
  const checkpoint = harness.database.authority.runCheckpoints.latest(
    COMPOSITION_WORKFLOW_ID,
    COMPOSITION_ITEM_ID,
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
