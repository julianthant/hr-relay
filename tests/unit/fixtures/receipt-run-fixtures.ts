/**
 * The two runs THIS program actually produced, as receipt evidence.
 *
 * 1. **The live person-lookup exit run** (doc 01 §Exit criteria): EID
 *    10873698, trace `pl-000619-4ebf`, terminal `done` at ATTEMPT 2 after the
 *    CRM browser died mid-run, `crm-dates` skipped `condition-false`, result
 *    `activeStatus.state = "active"` cross-verified against CRM record
 *    `a1ZVr000004Xoq9MAC`. This one is seeded through the REAL authority
 *    database and the REAL D110/D114 terminalization — nothing is hand-built.
 *
 * 2. **A deterministic separations Kuali finalization**: the real chunk-5
 *    descriptor, save contract, transaction node, twelve-field reload proof,
 *    and fenced write records over synthetic identifiers.
 *
 *    Its terminal result comes from the REAL `buildRunResult` over the real
 *    transaction checkpoint. The dependency identities and every digest are
 *    the descriptor factory's own; only process-edge ids and values are
 *    deterministic test data.
 */
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { manualClock } from "../../../src/domain/clock.js";
import { CrmReadOnboardingRecord } from "../../../src/domain/contracts/crm/read-onboarding-record.js";
import { ReadActiveStatus } from "../../../src/domain/contracts/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../../src/domain/contracts/ucpath/search-person-org.js";
import {
  KualiSaveSeparationFinalization,
  kualiFinalizationIdempotencyKey,
} from "../../../src/domain/contracts/kuali/save-separation-finalization.js";
import { RunTerminalOutboxRecordSchema } from "../../../src/domain/run/terminal-outbox.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
  TransactionOutcomeSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
} from "../../../src/domain/write-safety.js";
import { buildRunResult } from "../../../src/core/run-result.js";
import type { ReceiptWriteEvidence } from "../../../src/core/evidence-receipt.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import {
  RunResultRecordSchema,
  deriveTerminalDependencyDigest,
} from "../../../src/domain/run/result.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../../src/workflows/separations/kuali-finalization/workflow.js";
import { separationsKualiFinalizationDescriptor } from "../../helpers/registered-workflows.js";
import {
  SeparationsIdentityCheckCanonicalInput,
  separationsIdentityCheckDescriptor,
} from "../../../src/workflows/separations/identity-check/descriptor.js";
import { SeparationsVerifyIdentityApproval } from "../../../src/domain/contracts/separations/verify-identity-approval.js";
import { SeparationsMatchDepartmentOption } from "../../../src/domain/contracts/separations/match-department-option.js";
import { IdentityApprovalResultSchema } from "../../../src/domain/separations/identity-approval.js";
import { GateResultRecordSchema } from "../../../src/domain/gates.js";
import {
  FINALIZATION_ACTION_ID,
  FINALIZATION_DOCUMENT,
  FINALIZATION_EID,
  FINALIZATION_FIELDS,
  FINALIZATION_RUN_INPUT,
  FINALIZATION_SCOPE_OUTPUTS,
  FINALIZATION_VARIABLES,
} from "./kuali-finalization-fixtures.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

/* ── person-lookup: the live Phase-1 exit run ────────────────────────────── */

export const EXIT_RUN_ID = "4ebf7275-0158-49af-a78f-1f37948efb27";
export const EXIT_TRACE_ID = "pl-000619-4ebf";
export const EXIT_ITEM_ID = "10873698-0000-4000-8000-000000000001";
export const EXIT_EID = "10873698";
export const EXIT_CRM_RECORD_ID = "a1ZVr000004Xoq9MAC";

const ENQUEUED_AT = "2026-08-04T00:06:19.000Z";
/** attempt 1 — `searching` succeeded before the CRM browser died. */
const SEARCH_OBSERVED_AT = "2026-08-04T00:06:41.500Z";
/** attempt 2 — the re-run after the worker reopened the poisoned CRM session. */
const ATTEMPT_2_AT = "2026-08-04T00:11:00.000Z";
const CROSS_VERIFY_OBSERVED_AT = "2026-08-04T00:11:12.800Z";
const ACTIVE_STATUS_AT = "2026-08-04T00:11:13.000Z";
export const EXIT_TERMINAL_AT = "2026-08-04T00:11:13.500Z";

const CONFIG_FINGERPRINT = "b".repeat(64);
const IMPL_FINGERPRINT = "c".repeat(64);
const INGRESS_SCHEMA_HASH = "a".repeat(64);
const CONFIG_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";

const SELECTED_CANDIDATE = Object.freeze({
  emplId: EXIT_EID,
  name: "Battistessa, Johnnie",
  department: "Housing Dining Hospitality",
  jobTitle: "Dining Assistant",
  employeeStatus: "active",
  hdh: true,
});

const SEARCH_OUTPUT = Object.freeze({
  results: [SELECTED_CANDIDATE],
  selection: { status: "resolved", selected: SELECTED_CANDIDATE, candidateEids: [EXIT_EID] },
});

const CRM_OUTPUT = Object.freeze({
  state: "found",
  record: {
    recordId: EXIT_CRM_RECORD_ID,
    emplId: EXIT_EID,
    fullName: "Battistessa, Johnnie",
    rawStage: "Completed",
  },
});

const ACTIVE_STATUS_OUTPUT = Object.freeze({
  state: "active",
  reason: `UCPath reports active and CRM record ${EXIT_CRM_RECORD_ID} matches the selected EID`,
  hdh: true,
});

function provenance(
  paths: readonly string[],
  source: "live" | "derived",
  observedAt: string,
): readonly unknown[] {
  return paths.map((path) => ({ path, source, observedAt, originalObservedAt: observedAt }));
}

function checkpoint(input: Readonly<{
  nodeId: string;
  attempt: number;
  claimGeneration: 1,
  schema: Parameters<typeof deriveSchemaHash>[0];
  value: unknown;
  provenance: readonly unknown[];
  writtenAt: string;
}>): unknown {
  return RunCheckpointRecordSchema.parse({
    workflowId: personLookupDescriptor.id,
    itemId: EXIT_ITEM_ID,
    nodeId: input.nodeId,
    attempt: input.attempt,
    claimGeneration: 1,
    runId: EXIT_RUN_ID,
    output: { schemaHash: deriveSchemaHash(input.schema, "output"), value: input.value },
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: IMPL_FINGERPRINT,
    provenance: input.provenance,
    writtenAt: input.writtenAt,
  });
}

export interface SeededExitRun {
  readonly run: RunRecord;
  readonly checkpoints: readonly unknown[];
}

/**
 * Seed the exit run through the REAL authority database: enqueue at attempt 2
 * (the attempt that actually settled), claim it, walk it to `running`, write
 * the three checkpoints, and terminalize through the D110/D114 composite with
 * a factory-sealed result. Nothing about the terminal row is hand-built.
 */
export function seedPersonLookupExitRun(database: AuthorityDatabase): SeededExitRun {
  const enqueued = database.authority.runs.enqueue({
    envelope: {
      runId: EXIT_RUN_ID,
      workflow: personLookupDescriptor.id,
      itemId: EXIT_ITEM_ID,
      traceId: EXIT_TRACE_ID,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      shape: "single",
      priority: "interactive",
      dryRun: false,
      attempt: 2,
      enqueuedAt: ENQUEUED_AT,
    },
    input: {
      raw: { emplId: EXIT_EID },
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: EXIT_EID, keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    // The real run's record was created when it was ENQUEUED; attempt 2 came
    // later, through a requeue this seed compresses away. (D221 anchors the
    // "created at enqueue" invariant on the record version rather than on
    // `attempt === 1`, so the seed has to be truthful about that instant.)
    createdAt: ENQUEUED_AT,
    updatedAt: ATTEMPT_2_AT,
  });

  const workerId = "person-lookup-worker-1";
  const claimed = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    now: ATTEMPT_2_AT,
  });
  if (claimed.state !== "claimed") throw new Error(`exit run was not claimed: ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId, claimedAt: ATTEMPT_2_AT, heartbeatAt: ATTEMPT_2_AT };

  const validating = database.authority.runs.transition({
    runId: EXIT_RUN_ID,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...claimFields },
    now: ATTEMPT_2_AT,
  });
  if (validating.state !== "applied") throw new Error("exit run did not enter validating");
  const running = database.authority.runs.transition({
    runId: EXIT_RUN_ID,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...claimFields, currentNodeId: "active-status" },
    now: ATTEMPT_2_AT,
  });
  if (running.state !== "applied") throw new Error("exit run did not enter running");

  const searching = checkpoint({
    nodeId: "searching",
    attempt: 1,
    claimGeneration: 1,
    schema: SearchPersonOrg.output,
    value: SEARCH_OUTPUT,
    provenance: provenance(
      [
        "results", "selection.status", "selection.selected.emplId", "selection.selected.name",
        "selection.selected.department", "selection.selected.jobTitle",
        "selection.selected.employeeStatus", "selection.selected.hdh", "selection.candidateEids",
      ],
      "live",
      SEARCH_OBSERVED_AT,
    ),
    writtenAt: SEARCH_OBSERVED_AT,
  });
  const crossVerify = checkpoint({
    nodeId: "cross-verify",
    attempt: 2,
    claimGeneration: 1,
    schema: CrmReadOnboardingRecord.output,
    value: CRM_OUTPUT,
    provenance: provenance(
      ["state", "record.recordId", "record.emplId", "record.fullName", "record.rawStage"],
      "live",
      CROSS_VERIFY_OBSERVED_AT,
    ),
    writtenAt: CROSS_VERIFY_OBSERVED_AT,
  });
  const activeStatus = checkpoint({
    nodeId: "active-status",
    attempt: 2,
    claimGeneration: 1,
    schema: ReadActiveStatus.output,
    value: ACTIVE_STATUS_OUTPUT,
    provenance: provenance(["state", "reason", "hdh"], "derived", ACTIVE_STATUS_AT),
    writtenAt: ACTIVE_STATUS_AT,
  });
  for (const record of [searching, crossVerify, activeStatus]) {
    database.authority.runCheckpoints.insert(record);
  }

  const built = buildRunResult(
    personLookupDescriptor,
    running.run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint: activeStatus },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    manualClock(new Date(EXIT_TERMINAL_AT)),
  );
  const outboxId = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";
  database.terminalizeSuccess({
    result: built.record,
    outbox: RunTerminalOutboxRecordSchema.parse({
      outboxId,
      payload: {
        kind: "run-terminal-result",
        runId: built.record.runId,
        workflowId: built.record.workflowId,
        attempt: built.record.attempt,
        resultDigest: built.record.resultDigest,
      },
      projection: { state: "pending" },
      createdAt: built.record.createdAt,
    }),
    authorization: {
      kind: "done",
      runId: built.record.runId,
      workflowId: built.record.workflowId,
      attempt: built.record.attempt,
      descriptorVersion: built.record.descriptorVersion,
      contractFingerprint: built.record.contractFingerprint,
      expectedVersion: running.run.version,
      claim,
      authorizedAt: EXIT_TERMINAL_AT,
      resultDigest: built.record.resultDigest,
      outboxId,
    },
  }, built.authorization);

  const terminal = database.authority.runs.get(EXIT_RUN_ID);
  if (terminal === undefined) throw new Error("exit run vanished after terminalization");
  void enqueued;
  return { run: terminal, checkpoints: [searching, crossVerify, activeStatus] };
}

/* ── separations-kuali-finalization: deterministic receipt evidence ──────── */

export const KUALI_RUN_ID = "d1254233-dd33-4bc5-afaf-c2bf52ea693f";
export const KUALI_INTENT_ID = "9c1e4b2a-7d55-4a11-9f6e-2b8c0d3f1a77";
export const KUALI_TRACE_ID = "kt-170848-d125";
export const KUALI_ITEM_ID = "44894489-4489-4489-8489-448944894489";
export const KUALI_ACTION_ID = FINALIZATION_ACTION_ID;
export const KUALI_DOCUMENT_NUMBER = FINALIZATION_DOCUMENT;
export const KUALI_EID = FINALIZATION_EID;
export const KUALI_VALUE = FINALIZATION_VARIABLES.timekeeperName;
export const KUALI_FENCED_AT = "2026-08-14T17:08:48.805Z";
export const KUALI_CONFIRMED_AT = "2026-08-14T17:08:54.867Z";
export const KUALI_IDEMPOTENCY_KEY = kualiFinalizationIdempotencyKey({
  actionId: KUALI_ACTION_ID,
  documentNumber: KUALI_DOCUMENT_NUMBER,
  emplId: KUALI_EID,
  variables: FINALIZATION_VARIABLES,
});

const KUALI_SAVED_PROOF = Object.freeze({
  kind: "kuali-saved-finalization",
  actionId: KUALI_ACTION_ID,
  documentNumber: KUALI_DOCUMENT_NUMBER,
  observedEid: KUALI_EID,
  fields: FINALIZATION_FIELDS,
  source: "reload-read-back",
});

const KUALI_SUBJECT_EVIDENCE = Object.freeze({
  kind: "person",
  identifierKind: "eid",
  bindingDigest: "d77e42b6".padEnd(64, "0"),
  displaySuffix: String(KUALI_EID).slice(-4),
});

const KUALI_BINDING_PROOF = Object.freeze({
  kind: "subject-match",
  version: 1,
  proofId: "7f3a1c88-2e44-4b90-8a51-6d2f9c0b4e13",
  runId: KUALI_RUN_ID,
  attempt: 1,
  leaseId: "1b9d7e40-5c33-4a28-8f77-0c6e2a5b9d81",
  taskId: "kuali/save-separation-finalization",
  observationId: "kuali.rrss-document.displayed-eid",
  pageStateId: "kuali.rrss-document.finalization-staged",
  expected: KUALI_SUBJECT_EVIDENCE,
  observed: KUALI_SUBJECT_EVIDENCE,
  match: "match",
  observedAt: KUALI_FENCED_AT,
  afterPrepareSpanPath: "finalize-kuali/prepare",
});

export interface KualiReceiptEvidence {
  readonly run: unknown;
  readonly result: unknown;
  readonly checkpoints: readonly unknown[];
  readonly writes: readonly ReceiptWriteEvidence[];
}

/**
 * The exact durable shapes the controlled commit left behind, plus the
 * terminal rows the run WOULD carry once a transaction node can be a terminal
 * dependency. See this module's header for what is real and what stands in.
 */
export function kualiReceiptEvidence(input?: Readonly<{ readonly contractFingerprint?: string }>): KualiReceiptEvidence {
  const descriptor = separationsKualiFinalizationDescriptor;
  const storedContractFingerprint = input?.contractFingerprint ?? descriptor.contractFingerprint;
  const proofSchemaHash = deriveSchemaHash(
    KualiSaveSeparationFinalization.writeSafety.completion.proofSchema,
    "output",
  );
  const outputSchemaHash = deriveSchemaHash(KualiSaveSeparationFinalization.output, "output");
  const outcome = TransactionOutcomeSchema.parse({
    disposition: "committed",
    proofSource: "normal-output",
    proof: { schemaHash: proofSchemaHash, value: KUALI_SAVED_PROOF },
    output: { schemaHash: outputSchemaHash, value: { savedState: KUALI_SAVED_PROOF } },
    confirmedAt: KUALI_CONFIRMED_AT,
  });
  const transactionCheckpoint = RunCheckpointRecordSchema.parse({
    workflowId: descriptor.id,
    itemId: KUALI_ITEM_ID,
    nodeId: "finalize-kuali",
    attempt: 1,
    claimGeneration: 1,
    runId: KUALI_RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(TransactionOutcomeSchema, "output"),
      value: outcome,
    },
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: IMPL_FINGERPRINT,
    provenance: provenance(
      [
        "output.savedState.kind",
        "output.savedState.actionId",
        "output.savedState.documentNumber",
        "output.savedState.observedEid",
        ...Object.keys(FINALIZATION_FIELDS).map((field) => `output.savedState.fields.${field}`),
        "output.savedState.source",
      ],
      "live",
      KUALI_CONFIRMED_AT,
    ),
    writtenAt: KUALI_CONFIRMED_AT,
  });
  const dependencyCheckpoint = (input: Readonly<{
    nodeId: "approval" | "department-option";
    schema: Parameters<typeof deriveSchemaHash>[0];
    value: unknown;
    paths: readonly string[];
  }>) => RunCheckpointRecordSchema.parse({
    workflowId: descriptor.id,
    itemId: KUALI_ITEM_ID,
    nodeId: input.nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: KUALI_RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(input.schema, "output"),
      value: input.value,
    },
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: IMPL_FINGERPRINT,
    provenance: provenance(input.paths, "derived", KUALI_FENCED_AT),
    writtenAt: KUALI_FENCED_AT,
  });
  const approvalCheckpoint = dependencyCheckpoint({
    nodeId: "approval",
    schema: SeparationsVerifyIdentityApproval.output,
    value: FINALIZATION_SCOPE_OUTPUTS.approval,
    paths: [
      "documentNumber",
      "approved.emplId",
      "approved.chosenFrom",
      "approved.evidenceDigest",
      "approved.ucpathName",
      "approved.nameTier",
      "approved.approvalShape",
      "jobs.disposition",
      "jobs.rowCount",
      "jobs.activeRowCount",
      "jobs.inactiveRowCount",
      "jobs.unknownRowCount",
      "jobs.rows",
      "jobs.unreadableCells",
    ],
  });
  const departmentCheckpoint = dependencyCheckpoint({
    nodeId: "department-option",
    schema: SeparationsMatchDepartmentOption.output,
    value: FINALIZATION_SCOPE_OUTPUTS["department-option"],
    paths: ["option", "departmentCode", "optionDescription", "ucpathDepartment", "observedOptionCount"],
  });

  const canonicalInput = { ...FINALIZATION_RUN_INPUT };
  const run = {
    envelope: {
      runId: KUALI_RUN_ID,
      workflow: descriptor.id,
      itemId: KUALI_ITEM_ID,
      traceId: KUALI_TRACE_ID,
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: { kuali: "prod" },
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      shape: "single",
      priority: "interactive",
      dryRun: false,
      attempt: 1,
      enqueuedAt: KUALI_FENCED_AT,
    },
    input: {
      raw: canonicalInput,
      parsed: {
        schemaHash: deriveSchemaHash(SeparationsKualiFinalizationCanonicalInput, "output"),
        value: canonicalInput,
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "terminal", outcome: "done", endedAt: KUALI_CONFIRMED_AT },
    claimGeneration: 1,
    version: 5,
    createdAt: KUALI_FENCED_AT,
    updatedAt: KUALI_CONFIRMED_AT,
  };

  // The terminal record is built by the REAL descriptor factory over the REAL
  // stored checkpoint (D144). Nothing about it is typed here — not the value,
  // not the dependency identities, not the digests — so if the factory's
  // terminal contract moves, this fixture moves with it or fails loud.
  const built = buildRunResult(
    descriptor,
    { ...run, lifecycle: RUNNING_LIFECYCLE, version: 4 },
    [
      { state: "resolved", nodeId: "approval", checkpoint: approvalCheckpoint },
      { state: "resolved", nodeId: "department-option", checkpoint: departmentCheckpoint },
      { state: "resolved", nodeId: "finalize-kuali", checkpoint: transactionCheckpoint },
    ],
    manualClock(new Date(KUALI_CONFIRMED_AT)),
  );
  const result = built.record;

  const bindingProofDigest = deriveWriteBindingProofDigest(KUALI_BINDING_PROOF);
  const writeAttemptId = "3d5f8a12-9b04-4c6e-8a33-77e1c2b9d045";
  const intent = WriteIntentRecordSchema.parse({
    writeIntentId: KUALI_INTENT_ID,
    workflowId: descriptor.id,
    itemId: KUALI_ITEM_ID,
    taskId: "kuali/save-separation-finalization",
    system: "kuali",
    idempotencyKey: KUALI_IDEMPOTENCY_KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", KUALI_IDEMPOTENCY_KEY),
    currentAttemptId: writeAttemptId,
    generation: 1,
    runId: KUALI_RUN_ID,
    runAttempt: 1,
    bindingProof: KUALI_BINDING_PROOF,
    bindingProofDigest,
    fencedAt: KUALI_FENCED_AT,
    version: 2,
    createdAt: KUALI_FENCED_AT,
    updatedAt: KUALI_CONFIRMED_AT,
    status: "committed",
    completionProof: { schemaHash: proofSchemaHash, value: KUALI_SAVED_PROOF },
    confirmedAt: KUALI_CONFIRMED_AT,
  });
  const attempt = WriteAttemptRecordSchema.parse({
    writeAttemptId,
    writeIntentId: KUALI_INTENT_ID,
    generation: 1,
    runId: KUALI_RUN_ID,
    runAttempt: 1,
    leaseId: KUALI_BINDING_PROOF.leaseId,
    bindingProof: KUALI_BINDING_PROOF,
    bindingProofDigest,
    fencedAt: KUALI_FENCED_AT,
    outcome: {
      state: "committed",
      completionProof: { schemaHash: proofSchemaHash, value: KUALI_SAVED_PROOF },
      confirmedAt: KUALI_CONFIRMED_AT,
    },
    recordedAt: KUALI_CONFIRMED_AT,
  });

  const checkpoints = [approvalCheckpoint, departmentCheckpoint, transactionCheckpoint];
  if (storedContractFingerprint === descriptor.contractFingerprint) {
    return { run, result, checkpoints, writes: [{ intent, attempts: [attempt] }] };
  }
  const storedRun = RunRecordSchema.parse({
    ...run,
    envelope: { ...run.envelope, contractFingerprint: storedContractFingerprint },
  });
  const storedCheckpoints = checkpoints.map((record) => RunCheckpointRecordSchema.parse({
    ...record,
    contractFingerprint: storedContractFingerprint,
  }));
  const storedDependencies = result.dependencies.map((dependency) => dependency.state === "resolved"
    ? { ...dependency, contractFingerprint: storedContractFingerprint }
    : dependency);
  const storedResult = RunResultRecordSchema.parse({
    ...result,
    contractFingerprint: storedContractFingerprint,
    dependencies: storedDependencies,
    dependencyDigest: deriveTerminalDependencyDigest(storedDependencies),
  });
  return {
    run: storedRun,
    result: storedResult,
    checkpoints: storedCheckpoints,
    writes: [{ intent, attempts: [attempt] }],
  };
}

/**
 * The claim the terminal record is built against. The Kuali run's own terminal
 * lifecycle is the settled state AFTER the build; `buildRunResult` refuses any
 * run that is not `running` under a live claim, which is exactly the check that
 * makes this fixture's record a real one rather than a shape.
 */
const RUNNING_LIFECYCLE = Object.freeze({
  state: "running",
  workerId: "kuali-receipt-worker-1",
  claimedAt: KUALI_FENCED_AT,
  heartbeatAt: KUALI_CONFIRMED_AT,
  currentNodeId: "finalize-kuali",
});

/* ── separations-identity-check: the gated run (D204) ────────────────────── */

/** The live chunk-3 approval, at the ids and instants that run actually had. */
export const GATE_RUN_ID = "774cb34c-c684-44d7-9c43-b4d460c8a51c";
export const GATE_TRACE_ID = "si-161551-774c";
export const GATE_ITEM_ID = "45104510-4510-4510-8510-451045104510";
export const GATE_COMMAND_ID = "4928fee1-d93c-43f7-bb25-e225f4e5aca5";
export const GATE_RESOLVED_BY = "local-operator";
export const GATE_RESOLVED_AT = "2026-08-12T23:16:43.985Z";
export const GATE_APPROVAL_AT = "2026-08-12T23:16:44.500Z";
export const GATE_TERMINAL_AT = "2026-08-12T23:16:45.000Z";

export interface IdentityGateReceiptEvidence {
  readonly run: unknown;
  readonly result: unknown;
  readonly checkpoints: readonly unknown[];
  readonly gateResults: readonly unknown[];
  /** The exact evidence digest the approval was bound to. */
  readonly evidenceDigest: string;
}

/**
 * A settled `separations-identity-check` run whose ALWAYS-GATE was resolved by
 * a real operator — the shape ref write-safety §14.6 risk 6 is about.
 *
 * The gate's payload and the post-gate node's output are bound to each other
 * the way a real run binds them: the approval's `evidenceDigest` is the one the
 * `approval` node carried forward, so a receipt that printed one without the
 * other would be visibly wrong here. The post-gate output is the CONTRACT's own
 * sealed example, so a contract that grows a field grows this fixture with it
 * rather than drifting away from it.
 *
 * Only the `approval` node has a checkpoint. That is not a shortcut: it is the
 * only terminal dependency, and it makes this fixture also cover the arm where
 * a gate is the ONLY evidence a receipt has for the middle of the graph.
 */
export function identityGateReceiptEvidence(): IdentityGateReceiptEvidence {
  const descriptor = separationsIdentityCheckDescriptor;
  const approvalOutput = SeparationsVerifyIdentityApproval.example;
  const evidenceDigest = approvalOutput.approved.evidenceDigest;

  const approvalCheckpoint = RunCheckpointRecordSchema.parse({
    workflowId: descriptor.id,
    itemId: GATE_ITEM_ID,
    nodeId: "approval",
    attempt: 1,
    claimGeneration: 1,
    runId: GATE_RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(SeparationsVerifyIdentityApproval.output, "output"),
      value: approvalOutput,
    },
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: IMPL_FINGERPRINT,
    provenance: provenance(
      ["documentNumber", "approved", "jobs"],
      "derived",
      GATE_APPROVAL_AT,
    ),
    writtenAt: GATE_APPROVAL_AT,
  });

  if (!("chosenFrom" in approvalOutput.approved)) {
    throw new Error("the gate fixture requires an operator-approved identity subject");
  }

  const gateResult = GateResultRecordSchema.parse({
    runId: GATE_RUN_ID,
    gateId: "identity-approval",
    commandId: GATE_COMMAND_ID,
    expectedVersion: 17,
    resolvedBy: GATE_RESOLVED_BY,
    resolvedAt: GATE_RESOLVED_AT,
    checkpointFingerprint: IMPL_FINGERPRINT,
    result: {
      schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
      value: {
        decision: "approved",
        eid: approvalOutput.approved.emplId,
        chosenFrom: approvalOutput.approved.chosenFrom,
        evidenceDigest,
      },
    },
  });

  const canonicalInput = {
    documentNumber: approvalOutput.documentNumber,
    employeeName: approvalOutput.approved.ucpathName,
    emplId: approvalOutput.approved.emplId,
    emplIdSource: "document-eid",
    documentEid: { state: "present", value: approvalOutput.approved.emplId },
  };
  const run = {
    envelope: {
      runId: GATE_RUN_ID,
      workflow: descriptor.id,
      itemId: GATE_ITEM_ID,
      traceId: GATE_TRACE_ID,
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      shape: "single",
      priority: "interactive",
      dryRun: false,
      attempt: 1,
      enqueuedAt: GATE_RESOLVED_AT,
    },
    input: {
      raw: canonicalInput,
      parsed: {
        schemaHash: deriveSchemaHash(SeparationsIdentityCheckCanonicalInput, "output"),
        value: canonicalInput,
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "terminal", outcome: "done", endedAt: GATE_TERMINAL_AT },
    claimGeneration: 1,
    version: 18,
    createdAt: GATE_RESOLVED_AT,
    updatedAt: GATE_TERMINAL_AT,
  };

  const built = buildRunResult(
    descriptor,
    {
      ...run,
      lifecycle: {
        state: "running",
        workerId: "identity-check-worker-1",
        claimedAt: GATE_RESOLVED_AT,
        heartbeatAt: GATE_APPROVAL_AT,
        currentNodeId: "approval",
      },
      version: 17,
    },
    [{ state: "resolved", nodeId: "approval", checkpoint: approvalCheckpoint }],
    manualClock(new Date(GATE_TERMINAL_AT)),
  );

  return {
    run,
    result: built.record,
    checkpoints: [approvalCheckpoint],
    gateResults: [gateResult],
    evidenceDigest,
  };
}
