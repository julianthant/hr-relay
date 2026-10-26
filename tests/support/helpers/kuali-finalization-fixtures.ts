import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { ProtectedStoreRecordSchema } from "../../../src/models/config/protected-settings.js";
import { ProtectedInputBindingSchema } from "../../../src/models/write-safety/protected-input.js";
import { protectedSecretSource } from "./protected-secret-source.js";
import { admitProtectedInput } from "../../../src/backend/runs/start/protected-input.js";
import { CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";
import { testWorkerLifetime, testRunLifecycle, testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";

import { duoCeremonyGatesOver } from "./duo-ceremony-fixtures.js";
import { createBoundProfileFixture } from "./admission-fixture.js";
import { manualClock, type TestClock } from "../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import type { WriteSequencerContext } from "../../../src/backend/runtime/execution/run-executor.js";
import {
  createWriteSequencer,
  type ProductionWriteSequencer,
} from "../../../src/backend/runtime/writes/write-sequencer.js";
import {
  withBoundRunConfigFingerprint,
  WorkerSessionManager,
} from "../../../src/backend/runtime/workers/worker-sessions.js";
import { kualiFinalizationIdempotencyKey } from "../../../src/models/systems/kuali/save-separation-finalization.js";
import { SearchPersonOrgOutputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { UcpathVerifyTerminationFilingPresent } from "../../../src/models/systems/ucpath/verify-termination-filing-present.js";
import { SeparationsMatchDepartmentOption } from "../../../src/models/workflows/separations/match-department-option.js";
import { SeparationsVerifyIdentityApproval } from "../../../src/models/workflows/separations/verify-identity-approval.js";
import {
  EidSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/rules/identity/ids.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import {
  kualiFinalizationFields,
  type KualiFinalizationFields,
  type KualiFinalizationVariables,
} from "../../../src/models/ui/kuali-separation-finalization.js";
import { UcpathJobSummaryReadSchema } from "../../../src/models/ui/ucpath-job-summary.js";
import type { RuntimeFlowNode } from "../../../src/models/workflow/graph.js";
import { AuthorityDatabase } from "./synthetic-storage-admission.js";
import {
  createDeterministicKualiDriver,
  createKualiFakeWorld,
  type KualiFakeWorld,
} from "../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import {
  createDeterministicUcpathSmartHrWorldDriver,
  createUcpathSmartHrFakeWorld,
} from "../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import type { KualiFinalizationFieldName } from "../../../src/models/ui/kuali-separation-finalization.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import {
  SeparationsKualiFinalizationCanonicalInput,
  SeparationsKualiFinalizationInput,
} from "../../../src/workflows/separations/steps/kuali-finalization/step.js";
import { separationsKualiFinalizationDescriptor } from "./registered-workflows.js";
import {
  UUID_2,
  UUID_3,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  FIXTURE_SESSION_ACQUIRE_MS,
  ManualScheduler,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
} from "./phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";

export const FINALIZATION_ACTION_ID = "0123456789abcdef01234567";
export const FINALIZATION_DOCUMENT = "4444";
export const FINALIZATION_EID = EidSchema.parse("10800000");
export const FINALIZATION_NAME = "Deterministic Person";
export const FINALIZATION_OTHER_EID = "10800001";
export const FINALIZATION_TRANSACTION_NUMBER = "T009000001";
export const FINALIZATION_WORKFLOW_ID = "separations-kuali-finalization";
export const FINALIZATION_NODE = "finalize-kuali";
export const FINALIZATION_DEPARTMENT_NODE = "department-option";
export const FINALIZATION_WORKER_ID = `${FINALIZATION_WORKFLOW_ID}-worker-1`;
export const FINALIZATION_RUN_ID = UUID_2;
export const FINALIZATION_ITEM_ID = UUID_3;
export const FINALIZATION_NOW = "2026-08-14T10:00:00.000Z";
export const FINALIZATION_IMPL_FINGERPRINT = FingerprintSchema.parse(
  "f".repeat(64),
);
export const FINALIZATION_CONFIG_FINGERPRINT = FingerprintSchema.parse(CONFIG_SNAPSHOT.fingerprint);

/** The department the fold resolved — the option text the fake's control offers. */
export const FINALIZATION_DEPARTMENT_OPTION =
  "000412 - Housing/Dining/Hospitality";

/** The staged VARIABLES, exactly as the descriptor's binds compose them. */
export const FINALIZATION_VARIABLES: KualiFinalizationVariables = Object.freeze(
  {
    department: FINALIZATION_DEPARTMENT_OPTION,
    payrollTitleCode: "004921",
    payrollTitle: "STDT 2",
    timekeeperName: "Deterministic Timekeeper",
    // Finalization effective date is separation date plus one day; last day worked is one day earlier.
    lastDayWorked: "06/09/2026",
    separationDate: "06/10/2026",
    terminationEffectiveDate: "06/11/2026",
    transactionNumber: FINALIZATION_TRANSACTION_NUMBER,
    timekeeperComments:
      "Termination effective date set from the reconciled separation date.",
    observedExistingComments: "",
  },
);

/** Variables + the three §4g/§4e assertions — recomputed here, never copied. */
export const FINALIZATION_FIELDS: KualiFinalizationFields =
  kualiFinalizationFields(FINALIZATION_VARIABLES);

export const FINALIZATION_RUN_INPUT = Object.freeze({
  actionId: FINALIZATION_ACTION_ID,
  documentNumber: FINALIZATION_DOCUMENT,
  employeeName: "Person, Deterministic",
  emplId: FINALIZATION_EID,
  emplIdSource: "document-eid" as const,
  documentEid: { state: "present" as const, value: FINALIZATION_EID },
  ucpathDeptId: { state: "present" as const, value: "000412" },
  ucpathDepartment: {
    state: "present" as const,
    value: "HOUSING/DINING/HOSPITALITY",
  },
  observedDepartmentOptions: [
    "- - -",
    "000141 - Early Childhood Education Center",
    FINALIZATION_DEPARTMENT_OPTION,
    "000414 - Bookstore",
    "000422 - Triton Print & Digital Media",
    "000719 - Supply Chain Services",
  ],
  payrollTitleCode: FINALIZATION_VARIABLES.payrollTitleCode,
  payrollTitle: FINALIZATION_VARIABLES.payrollTitle,
  timekeeperName: FINALIZATION_VARIABLES.timekeeperName,
  lastDayWorked: FINALIZATION_VARIABLES.lastDayWorked,
  separationDate: FINALIZATION_VARIABLES.separationDate,
  terminationEffectiveDate: FINALIZATION_VARIABLES.terminationEffectiveDate,
  transactionNumber: FINALIZATION_VARIABLES.transactionNumber,
  transactionApprovalStatus: "Pending" as const,
  timekeeperComments: FINALIZATION_VARIABLES.timekeeperComments,
  observedExistingComments: FINALIZATION_VARIABLES.observedExistingComments,
});

/** The current UCPath fake answers consumed by the descriptor's two read nodes. */
export const FINALIZATION_NAME_SEARCH_OUTPUT =
  SearchPersonOrgOutputSchema.parse({
    results: [
      {
        emplId: FINALIZATION_EID,
        name: FINALIZATION_RUN_INPUT.employeeName,
        department: "Housing/Dining/Hospitality",
        jobTitle: FINALIZATION_VARIABLES.payrollTitle,
        employeeStatus: "active",
        hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
      },
    ],
    selection: {
      status: "resolved",
      selected: {
        emplId: FINALIZATION_EID,
        name: FINALIZATION_RUN_INPUT.employeeName,
        department: "Housing/Dining/Hospitality",
        jobTitle: FINALIZATION_VARIABLES.payrollTitle,
        employeeStatus: "active",
        hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
      },
      candidateEids: [FINALIZATION_EID],
    },
  });

export const FINALIZATION_JOB_SUMMARY_READ = UcpathJobSummaryReadSchema.parse({
  state: "read",
  summary: {
    pageStateId: "ucpath.person-org.detail-ready",
    emplId: FINALIZATION_EID,
    displayedName: FINALIZATION_NAME,
    jobRows: [
      {
        rowIndex: 0,
        emplRecord: "0",
        hrStatus: "Active",
        businessUnit: "SDCMP",
        effectiveDate: { state: "present", value: "06/01/2026" },
        positionNumber: { state: "present", value: "40012345" },
        deptId: { state: "present", value: "000412" },
        department: { state: "present", value: "Housing/Dining/Hospitality" },
        jobCode: {
          state: "present",
          value: FINALIZATION_VARIABLES.payrollTitleCode,
        },
        jobTitle: {
          state: "present",
          value: FINALIZATION_VARIABLES.payrollTitle,
        },
        expectedJobEndDate: {
          state: "absent",
          reason: "the fixture job has no expected end date",
        },
        fte: { state: "present", value: "0.500000" },
        emplClass: { state: "present", value: "Student" },
      },
    ],
    rowCount: 1,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: FINALIZATION_NOW,
  },
});

/** The natural key the commit contract derives — recomputed, never copied. */
export const FINALIZATION_IDEMPOTENCY_KEY = kualiFinalizationIdempotencyKey({
  actionId: FINALIZATION_ACTION_ID,
  documentNumber: FINALIZATION_DOCUMENT,
  emplId: FINALIZATION_EID,
  variables: FINALIZATION_VARIABLES,
});

/** The post-gate scope the transaction node binds against. */
export const FINALIZATION_SCOPE_OUTPUTS = Object.freeze({
  approval: {
    documentNumber: FINALIZATION_DOCUMENT,
    approved: {
      authority: "operator-approval",
      emplId: FINALIZATION_EID,
      chosenFrom: "checked" as const,
      evidenceDigest: "a".repeat(64),
      ucpathName: FINALIZATION_NAME,
      nameTier: "same" as const,
      approvalShape: "one-click" as const,
    },
    jobs: {
      disposition: "single-active-job" as const,
      rowCount: 1,
      activeRowCount: 1,
      inactiveRowCount: 0,
      unknownRowCount: 0,
      rows: [
        {
          rowIndex: 0,
          emplRecord: "0",
          hrStatus: "Active",
          tier: "active" as const,
          department: "Housing/Dining/Hospitality",
          jobTitle: "STDT 2",
          effectiveDate: "06/01/2026",
        },
      ],
      unreadableCells: [],
    },
  },
  [FINALIZATION_DEPARTMENT_NODE]: {
    option: FINALIZATION_DEPARTMENT_OPTION,
    departmentCode: "000412",
    optionDescription: "Housing/Dining/Hospitality",
    ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
    observedOptionCount: 6,
  },
  "filing-presence": {
    kind: "ucpath-termination-filing-presence" as const,
    transactionId: FINALIZATION_TRANSACTION_NUMBER,
    emplId: FINALIZATION_EID,
    effectiveDate: FINALIZATION_VARIABLES.terminationEffectiveDate,
    approvalStatus: "Pending" as const,
    displayedName: FINALIZATION_NAME,
    observedAt: FINALIZATION_NOW,
    source: "ss-smart-hr-detail-read" as const,
    receiptDisposition: "operator-asserted" as const,
    authority: "kuali-finalization-precondition" as const,
  },
});

export function finalizationNode(): Extract<
  RuntimeFlowNode,
  { kind: "transaction" }
> {
  const node = descriptorRuntimeNodes(
    separationsKualiFinalizationDescriptor,
  ).find(
    (
      candidate,
    ): candidate is Extract<RuntimeFlowNode, { kind: "transaction" }> =>
      candidate.kind === "transaction",
  );
  if (node === undefined)
    throw new Error("the finalization descriptor lost its transaction node");
  return node;
}

export function finalizationQueuedRun(
  options: Readonly<{ dryRun?: boolean; startAt?: string }> = {},
): Record<string, unknown> {
  const source = protectedSecretSource({ timekeeperName: FINALIZATION_VARIABLES.timekeeperName });
  const signer = ProtectedStoreRecordSchema.parse(source.read()).entries.timekeeperName;
  if (signer === undefined) throw new Error("fixture protected signer missing");
  const binding = ProtectedInputBindingSchema.parse({ kind: "protected-store", inputPath: "timekeeperName",
    name: "timekeeperName", valueId: signer.valueId });
  const admitted = admitProtectedInput(separationsKualiFinalizationDescriptor, [FINALIZATION_RUN_INPUT],
    source, undefined, [binding])[0];
  if (admitted === undefined) throw new Error("fixture protected input admission missing");
  return {
    envelope: {
      runId: FINALIZATION_RUN_ID,
      workflow: FINALIZATION_WORKFLOW_ID,
      itemId: FINALIZATION_ITEM_ID,
      traceId: "sf-100000-2222",
      descriptorVersion: 1,
      contractFingerprint:
        separationsKualiFinalizationDescriptor.contractFingerprint,
      resolvedInstance: { kuali: "prod", ucpath: "prod" },
      configFingerprint: FINALIZATION_CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      shape: "single",
      priority: "bulk",
      dryRun: options.dryRun ?? false,
      ...(options.startAt === undefined ? {} : { startAt: options.startAt }),
      attempt: 1,
      enqueuedAt: FINALIZATION_NOW,
    },
    input: {
      raw: admitted.raw,
      parsed: {
        schemaHash: deriveSchemaHash(
          SeparationsKualiFinalizationCanonicalInput,
          "output",
        ),
        value: admitted.admitted,
        protectedBindings: admitted.bindings,
      },
      ingressSchemaHash: deriveSchemaHash(
        SeparationsKualiFinalizationInput,
        "input",
      ),
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: FINALIZATION_NOW,
    updatedAt: FINALIZATION_NOW,
  };
}

export interface FinalizationHarness {
  readonly path: string;
  readonly world: KualiFakeWorld;
  readonly filingWorld: ReturnType<typeof createUcpathSmartHrFakeWorld>;
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly ids: ReturnType<typeof sequentialIdFactory>;
  readonly sequencer: ProductionWriteSequencer;
  readonly sessions: WorkerSessionManager;
  readonly bound: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly dispose: () => void;
}

const retainedFinalizationOwners = new Set<object>();

export function finalizationHarness(
  options: Readonly<{
    /** Seed the document as ALREADY finalized with exactly these ten values. */
    persistedFinalization?: KualiFinalizationFields;
    /** What the EID field shows AFTER the prepare stages — the beat-③ mismatch arm. */
    displayedEidAfterStage?: string;
    /** Controls the page silently drops — the `fillWithVerify` refusal. */
    stagingDrops?: readonly KualiFinalizationFieldName[];

    commitDoesNotPersist?: boolean;
    /** Values offered by the live Department control. */
    departmentOptions?: readonly string[];
  }> = {},
): FinalizationHarness {
  const held: { profile?: ReturnType<typeof createBoundProfileFixture>; database?: AuthorityDatabase; manager?: WorkerSessionManager; primary?: { error: unknown }; failure?: Error } = {};
  retainedFinalizationOwners.add(held);
  try {
  const clock = manualClock(new Date(FINALIZATION_NOW));
  const profile = createBoundProfileFixture(); held.profile = profile;
  const database = AuthorityDatabase.open(
    {
      path: profile.path,
      busyTimeoutMs: 250,
      migrationOwner: "kuali-finalization-test",
    },
    clock,
  );
  held.database = database;
  testWorkerPorts(database, clock, { path: profile.path, descriptor: separationsKualiFinalizationDescriptor, poolIndex: 1 });
  const world = createKualiFakeWorld({
    actionId: FINALIZATION_ACTION_ID,
    documentNumber: FINALIZATION_DOCUMENT,
    displayedEid: FINALIZATION_EID,
  });
  if (options.persistedFinalization !== undefined) {
    world.persistedFinalization = { ...options.persistedFinalization };
  }
  if (options.displayedEidAfterStage !== undefined) {
    world.displayedEidAfterStage = options.displayedEidAfterStage;
  }
  if (options.stagingDrops !== undefined)
    world.finalizationStagingDrops = options.stagingDrops;
  if (options.commitDoesNotPersist === true)
    world.commitFinalizationDoesNotPersist = true;
  if (options.departmentOptions !== undefined) {
    world.finalizationDepartmentOptions = options.departmentOptions;
  }
  const filingWorld = createUcpathSmartHrFakeWorld({
    emplId: FINALIZATION_EID,
    displayedName: FINALIZATION_NAME,
    nextTransactionId: FINALIZATION_TRANSACTION_NUMBER,
    rows: [
      {
        transactionId: FINALIZATION_TRANSACTION_NUMBER,
        emplId: FINALIZATION_EID,
        action: "TER",
        approvalStatus: "Pending",
        startDate: FINALIZATION_VARIABLES.terminationEffectiveDate,
        displayedName: FINALIZATION_NAME,
      },
    ],
  });
  const sessions = sessionFactoryHarness({
    kuali: () => createDeterministicKualiDriver(world, clock),
    ucpath: () => {
      const person = createDeterministicUcpathPersonOrgDriver(
        FINALIZATION_NAME_SEARCH_OUTPUT,
        FINALIZATION_JOB_SUMMARY_READ,
      );
      const filing = createDeterministicUcpathSmartHrWorldDriver(
        filingWorld,
        () => clock.now(),
      );
      return {
        ...person,
        scanTerminationTransactions: filing.scanTerminationTransactions,
        stageTermination: filing.stageTermination,
        stagePendingTerminationSweep: filing.stagePendingTerminationSweep,
        commit: filing.commit,
      };
    },
  });
  const manager = new WorkerSessionManager({
    workerId: WorkerIdSchema.parse(FINALIZATION_WORKER_ID),
    workflowId: WorkflowIdSchema.parse(FINALIZATION_WORKFLOW_ID),
    stores: taskStoreRegistry,
    factory: sessions.factory,
    clock,
    scheduler: new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: duoCeremonyGatesOver(database, clock, new ManualScheduler(clock)),
  });
  held.manager = manager;
  const emitter = recordingEmitter();
  const ids = sequentialIdFactory("b");
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
    resolveImplFingerprint: () => FINALIZATION_IMPL_FINGERPRINT,
  });
  let closeAttempted = false;
  return {
    path: profile.path,
    world,
    filingWorld,
    database,
    clock,
    emitter,
    ids,
    sequencer,
    sessions: manager,
    bound: <Result>(work: () => Promise<Result>): Promise<Result> =>
      withBoundRunConfigFingerprint(
        manager,
        FINALIZATION_CONFIG_FINGERPRINT,
        work,
      ),
    dispose: (): void => {
      if (held.failure !== undefined) throw held.failure;
      if (closeAttempted) return;
      closeAttempted = true;
      try { database.close(); profile.close(); retainedFinalizationOwners.delete(held); }
      catch (error) { held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
    },
  };
  } catch (error) { held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
}

export function finalizationClaimRunning(
  database: AuthorityDatabase,
  clock: TestClock,
  runInput: Record<string, unknown> = finalizationQueuedRun(),
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  const workerId = FINALIZATION_WORKER_ID;
  const now = clock.now().toISOString();
  const enqueued = database.authority.runs.enqueue(runInput);
  if (enqueued.state !== "inserted")
    throw new Error(`enqueue outcome was ${enqueued.state}`);
  const claimMember1 = database.authority.workerSlots.get(workerId);
  if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
  const claimed = database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(database, FINALIZATION_WORKFLOW_ID, claimMember1.poolIndex).workerLifetime,
    workflow: FINALIZATION_WORKFLOW_ID,
    workerId,
    now,
  });
  if (claimed.state !== "claimed")
    throw new Error(`claim outcome was ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const workerLifetime = testWorkerLifetime(database, FINALIZATION_WORKFLOW_ID, claimMember1.poolIndex).workerLifetime;
  const base = { workerId, workerLifetime, claimedAt: now, heartbeatAt: now };
  const validating = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...base },
    now,
  });
  if (validating.state !== "applied")
    throw new Error("validating transition failed");
  const running = database.authority.runs.transition({
    runId: claimed.run.envelope.runId,
    expectedVersion: claimed.run.version + 1,
    claim,
    lifecycle: { state: "running", ...base, currentNodeId: FINALIZATION_NODE },
    now,
  });
  if (running.state !== "applied") throw new Error("running transition failed");
  return { run: running.run, claim };
}

export function finalizationContext(
  run: RunRecord,
  claim: { workerId: string; claimGeneration: number },
  dryRun = false,
): WriteSequencerContext {
  return {
    descriptor: separationsKualiFinalizationDescriptor,
    node: finalizationNode(),
    run,
    claim: {
      workerId: claim.workerId,
      claimGeneration: claim.claimGeneration,
    } as WriteSequencerContext["claim"],
    scope: {
      input: { ...FINALIZATION_RUN_INPUT },
      outputs: { ...FINALIZATION_SCOPE_OUTPUTS },
    },
    dryRun,
    signal: new AbortController().signal,
  };
}

/** Authenticated upstream checkpoint evidence required to seal a preview. */
export function finalizationPreviewDependencies(
  run: RunRecord,
): readonly unknown[] {
  const rowFor = (
    nodeId: string,
    schema: Parameters<typeof deriveSchemaHash>[0],
    value: unknown,
  ) =>
    RunCheckpointRecordSchema.parse({
      workflowId: FINALIZATION_WORKFLOW_ID,
      itemId: run.envelope.itemId,
      nodeId,
      attempt: run.envelope.attempt,
      claimGeneration: run.claimGeneration,
      runId: run.envelope.runId,
      output: {
        schemaHash: deriveSchemaHash(schema, "output"),
        value: schema.parse(value),
      },
      descriptorVersion: separationsKualiFinalizationDescriptor.version,
      contractFingerprint:
        separationsKualiFinalizationDescriptor.contractFingerprint,
      implFingerprint: FINALIZATION_IMPL_FINGERPRINT,
      provenance: [],
      writtenAt: FINALIZATION_NOW,
    });
  return [
    {
      state: "resolved",
      nodeId: "approval",
      checkpoint: rowFor(
        "approval",
        SeparationsVerifyIdentityApproval.output,
        FINALIZATION_SCOPE_OUTPUTS.approval,
      ),
    },
    {
      state: "resolved",
      nodeId: FINALIZATION_DEPARTMENT_NODE,
      checkpoint: rowFor(
        FINALIZATION_DEPARTMENT_NODE,
        SeparationsMatchDepartmentOption.output,
        FINALIZATION_SCOPE_OUTPUTS[FINALIZATION_DEPARTMENT_NODE],
      ),
    },
    {
      state: "resolved",
      nodeId: "filing-presence",
      checkpoint: rowFor(
        "filing-presence",
        UcpathVerifyTerminationFilingPresent.output,
        FINALIZATION_SCOPE_OUTPUTS["filing-presence"],
      ),
    },
  ];
}


export function finalizationDurableFootprint(
  harness: FinalizationHarness,
): Readonly<{
  intent: unknown;
  checkpoint: unknown;
  outboxes: readonly unknown[];
}> {
  const intent = harness.database.authority.writeIntents.findByPermanentKey(
    "kuali",
    FINALIZATION_IDEMPOTENCY_KEY,
  );
  const checkpoint = harness.database.authority.runCheckpoints.latest(
    FINALIZATION_WORKFLOW_ID,
    FINALIZATION_ITEM_ID,
    FINALIZATION_NODE,
  );
  // Retain this shared fixture field for existing callers; its evidence is now
  // immutable native confirmations, so zero-write assertions remain substantive.
  const outboxes = harness.database.authority.timelineEvents
    .page({})
    .filter(
      (event) =>
        event.payload.kind === "operation-confirmed" &&
        event.payload.facts.writeIntentId === intent?.writeIntentId,
    );
  return { intent, checkpoint, outboxes };
}
