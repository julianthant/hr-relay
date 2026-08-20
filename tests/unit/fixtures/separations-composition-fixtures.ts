/**
 * The chunk-6 COMPOSITION harness — one authority database, one write
 * sequencer, and BOTH deterministic browsers the composed graph's three
 * transaction nodes reach.
 *
 * Same claim as the chunk-4 and chunk-5 harnesses it merges: nothing here is
 * synthetic except the process edges. The contracts, the four stores, the driver
 * semantics, the registered `separations` descriptor and all three of its
 * transaction nodes are the production ones; only the browsers, the clock, the
 * id source, the timer and the span sink are fakes. That is what lets a scenario
 * say "zero rows in `write_intents`" about the real authority database.
 *
 * It is ONE harness rather than two because §4c's arm is a claim about a single
 * run: the UCPath termination commits for real, the Kuali save lands nothing,
 * and what has to be true afterwards is a durable receipt beside a parked
 * finalization intent. Two harnesses could only assert that separately, which is
 * the state the operator's head was holding in the first place.
 *
 * The identity below is synthetic on purpose. Nothing has ever been written to
 * either live surface by this repository.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import { manualClock, type TestClock } from "../../../src/domain/clock.js";
import type { WriteSequencerContext } from "../../../src/core/run-executor.js";
import {
  createWriteSequencer,
  type ProductionWriteSequencer,
} from "../../../src/core/write-sequencer.js";
import { withBoundRunConfigFingerprint, WorkerSessionManager } from "../../../src/core/worker-sessions.js";
import { kualiFinalizationIdempotencyKey } from "../../../src/domain/contracts/kuali/save-separation-finalization.js";
import {
  EidSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/domain/ids.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import {
  buildFinalizationComments,
  separationInitials,
} from "../../../src/domain/separations/separation-dates.js";
import {
  kualiFinalizationFields,
  type KualiFinalizationFields,
  type KualiFinalizationVariables,
  type KualiObservedFinalizationFields,
} from "../../../src/domain/ui/kuali-separation-finalization.js";
import type { UcpathTransactionRow } from "../../../src/domain/ui/ucpath-smart-hr-termination.js";
import type { RuntimeFlowNode } from "../../../src/domain/workflow/graph.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  createDeterministicKualiDriver,
  createKualiFakeWorld,
  type KualiFakeWorld,
} from "../../../src/stores/kuali/driver/fake.js";
import {
  createDeterministicUcpathSmartHrWorldDriver,
  createUcpathSmartHrFakeWorld,
  type UcpathSmartHrFakeWorld,
} from "../../../src/stores/ucpath/driver/smart-hr-fake.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import {
  SeparationsCanonicalInput,
  SeparationsInput,
  separationsDescriptor,
} from "../../../src/workflows/separations/descriptor.js";
import { UUID_2, UUID_3, UUID_4 } from "./phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
} from "./phase1f-executor-harness.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";

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
export const COMPOSITION_CONFIG_FINGERPRINT = FingerprintSchema.parse("b".repeat(64));

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
  // §4e's 2026-08-14 amendment, taken from the SAME reconciled constants the
  // `dates` node output below carries — never re-spelled, so the fixture cannot
  // agree with itself while disagreeing with the graph. This fixture's
  // separation date MOVED (06/12 → 06/19 on a holiday), which is the case the
  // write-back exists for.
  lastDayWorked: COMPOSITION_LAST_DAY_WORKED,
  separationDate: COMPOSITION_SEPARATION_DATE,
  terminationEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
  transactionNumber: COMPOSITION_RECEIPT,
  timekeeperComments: COMPOSITION_FINALIZATION_COMMENTS,
  observedExistingComments: COMPOSITION_EXISTING_COMMENTS,
});

export const COMPOSITION_FINALIZATION_FIELDS: KualiFinalizationFields =
  kualiFinalizationFields(COMPOSITION_VARIABLES);

/**
 * D261 removed `actionId` from the ingress — the graph's head node resolves it
 * — so the run input is the one number an operator types plus the constant the
 * start surface contributes. `COMPOSITION_ACTION_ID` stays, because it is still
 * the value the RESOLVE NODE produces and every downstream fixture binds.
 */
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

/** The natural keys the three commit contracts derive — recomputed, never copied. */
export const SWEEP_IDEMPOTENCY_KEY = `ucpath:pending-terminations-clear|${COMPOSITION_EID}`;
export const TERMINATION_IDEMPOTENCY_KEY =
  `ucpath:termination|${COMPOSITION_EID}|${COMPOSITION_EFFECTIVE_DATE}`;
export const FINALIZATION_IDEMPOTENCY_KEY = kualiFinalizationIdempotencyKey({
  actionId: COMPOSITION_ACTION_ID,
  documentNumber: COMPOSITION_DOCUMENT,
  emplId: COMPOSITION_EID,
  variables: COMPOSITION_VARIABLES,
});

/**
 * The post-gate scope all three transaction nodes and the `receipt` fold bind
 * against — the exact node outputs the composed descriptor names.
 */
export const COMPOSITION_SCOPE_OUTPUTS = Object.freeze({
  "resolve-action": COMPOSITION_ACTION_RESOLUTION,
  document: {
    timekeeper: { comments: { state: "absent" as const, reason: "the control was empty" } },
  },
  plan: { asOfDate: COMPOSITION_AS_OF_DATE },
  approval: {
    documentNumber: COMPOSITION_DOCUMENT,
    approved: {
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
  },
  receipt: {
    transactionNumber: COMPOSITION_RECEIPT,
    approvalStatus: "Pending" as const,
    effectiveDate: COMPOSITION_EFFECTIVE_DATE,
    emplId: COMPOSITION_EID,
    displayedName: COMPOSITION_UCPATH_NAME,
    disposition: "committed" as const,
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
      configSnapshotId: UUID_4,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: COMPOSITION_NOW,
    },
    input: {
      raw: { ...COMPOSITION_RUN_INPUT },
      parsed: {
        schemaHash: deriveSchemaHash(SeparationsCanonicalInput, "output"),
        value: { ...COMPOSITION_RUN_INPUT },
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
  /**
   * Seed the Kuali document with exactly these values.
   *
   * Typed as the OBSERVED shape rather than the staged one so a partly filled
   * document is spellable — a real RRSS document normally carries its two date
   * controls and nothing else, which is precisely the starting state §4e's
   * 2026-08-14 date write-backs act on.
   */
  persistedFinalization?: KualiObservedFinalizationFields;
  /** The Kuali Save click succeeds and Kuali keeps the old values — S59 / D128. */
  kualiCommitDoesNotPersist?: boolean;
}> = {}): CompositionHarness {
  const clock = manualClock(new Date(COMPOSITION_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-separations-composition-"));
  const database = AuthorityDatabase.open(
    {
      path: join(root, "authority.sqlite"),
      busyTimeoutMs: 250,
      migrationOwner: "separations-composition-test",
    },
    clock,
  );
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
  });
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("d");
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
  const claimed = database.authority.runs.claimNext({
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
      outputs: { ...COMPOSITION_SCOPE_OUTPUTS },
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
  const outboxes = harness.ids.minted()
    .map((id) => harness.database.authority.durableOutbox.get(id))
    .filter((row) => row !== undefined);
  return { intent, checkpoint, outboxes };
}
