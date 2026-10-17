import { jsonLeafPaths } from "../../../src/backend/runs/provenance/task-provenance.js";
import { JsonValueSchema } from "../../../src/rules/validation/canonical-json.js";
import { resolvePersonLookupIdentity, derivePersonLookupOutcome } from "../../../src/rules/matching/person-lookup.js";
import { PersonLookupInput } from "../../../src/models/workflows/person-lookup/input.js";
import { ReadResolvedIdentity } from "../../../src/models/workflows/person-lookup/read-resolved-identity.js";
import { CrmSearchOnboardingRecords } from "../../../src/models/systems/crm/search-onboarding-records.js";
import { CrmVerifyOnboardingRecord } from "../../../src/models/systems/crm/verify-onboarding-record.js";

import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import {
  KualiSaveSeparationFinalization,
  kualiFinalizationIdempotencyKey,
} from "../../../src/models/systems/kuali/save-separation-finalization.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
  TransactionOutcomeSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
} from "../../../src/rules/write-safety/write-safety.js";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import type { ReceiptWriteEvidence } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import type { AuthorityDatabase } from "../../../src/backend/storage/sqlite/index.js";
import {
  RunRecordSchema,
  type RunRecord,
} from "../../../src/models/run/record.js";
import {
  RunResultRecordSchema,
  deriveTerminalDependencyDigest,
} from "../../../src/models/run/result.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../../src/workflows/separations/steps/kuali-finalization/step.js";
import {
  separationsIdentityCheckDescriptor,
  separationsKualiFinalizationDescriptor,
} from "../helpers/registered-workflows.js";
import { SeparationsIdentityCheckCanonicalInput } from "../../../src/workflows/separations/steps/identity-check/step.js";
import { SeparationsVerifyIdentityApproval } from "../../../src/models/workflows/separations/verify-identity-approval.js";
import { SeparationsMatchDepartmentOption } from "../../../src/models/workflows/separations/match-department-option.js";
import { IdentityApprovalResultSchema } from "../../../src/rules/separations/identity-approval.js";
import { GateResultRecordSchema } from "../../../src/models/workflow/gates.js";
import {
  FINALIZATION_ACTION_ID,
  FINALIZATION_DOCUMENT,
  FINALIZATION_EID,
  FINALIZATION_FIELDS,
  FINALIZATION_RUN_INPUT,
  FINALIZATION_SCOPE_OUTPUTS,
  FINALIZATION_VARIABLES,
} from "../helpers/kuali-finalization-fixtures.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

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
  hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
});

const SEARCH_OUTPUT = Object.freeze({
  results: [SELECTED_CANDIDATE],
  selection: {
    status: "resolved",
    selected: SELECTED_CANDIDATE,
    candidateEids: [EXIT_EID],
  },
});

function provenance(
  paths: readonly string[],
  source: "live" | "derived",
  observedAt: string,
): readonly unknown[] {
  return paths.map((path) => ({
    path,
    source,
    observedAt,
    originalObservedAt: observedAt,
  }));
}

function checkpoint(
  input: Readonly<{
    nodeId: string;
    attempt: number;
    claimGeneration: number;
    schema: Parameters<typeof deriveSchemaHash>[0];
    value: unknown;
    provenance: readonly unknown[];
    writtenAt: string;
  }>,
): unknown {
  return RunCheckpointRecordSchema.parse({
    workflowId: personLookupDescriptor.id,
    itemId: EXIT_ITEM_ID,
    nodeId: input.nodeId,
    attempt: input.attempt,
    claimGeneration: input.claimGeneration,
    runId: EXIT_RUN_ID,
    output: {
      schemaHash: deriveSchemaHash(input.schema, "output"),
      value: input.value,
    },
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


export function seedPersonLookupExitRun(
  database: AuthorityDatabase,
  options: { readonly dryRun?: boolean } = {},
): SeededExitRun {
  const active = database.authority.runtimeConfig.get();
  if (active === undefined) throw new Error("exit fixture requires admitted current settings");
  const slot = database.authority.workerSlots.list(personLookupDescriptor.id).find(record => record.poolIndex === 1 && record.retiredAt === null);
  if (slot === undefined || database.authority.workerLeases.get(slot.workerId) === undefined) throw new Error("exit fixture requires an admitted leased worker");
  database.authority.runs.enqueue({
    envelope: {
      runId: EXIT_RUN_ID,
      workflow: personLookupDescriptor.id,
      itemId: EXIT_ITEM_ID,
      traceId: EXIT_TRACE_ID,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      configFingerprint: active.configFingerprint,
      configSnapshotId: active.configSnapshotId,
      shape: "single",
      priority: "interactive",
      dryRun: options.dryRun ?? false,
      attempt: 1,
      enqueuedAt: ENQUEUED_AT,
    },
    input: {
      raw: { emplId: EXIT_EID },
      parsed: {
        protectedBindings: [],
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { mode: "search", crmCheck: true, emplId: EXIT_EID, keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: ENQUEUED_AT,
    updatedAt: ENQUEUED_AT,
  });

  const workerId = slot.workerId;
  const firstClaim = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    now: ENQUEUED_AT,
  });
  if (firstClaim.state !== "claimed")
    throw new Error("exit run attempt 1 was not claimed");
  const firstToken = {
    workerId,
    claimGeneration: firstClaim.run.claimGeneration,
  };
  let firstRun = firstClaim.run;
  for (const state of ["validating", "running"] as const) {
    const transition = database.authority.runs.transition({
      runId: EXIT_RUN_ID,
      expectedVersion: firstRun.version,
      claim: firstToken,
      lifecycle: {
        state,
        workerId,
        claimedAt: ENQUEUED_AT,
        heartbeatAt: ENQUEUED_AT,
        ...(state === "running" ? { currentNodeId: "searching" } : {}),
      },
      now: ENQUEUED_AT,
    });
    if (transition.state !== "applied")
      throw new Error("exit run attempt 1 did not advance");
    firstRun = transition.run;
  }
  const searching = checkpoint({
    nodeId: "searching",
    attempt: 1,
    claimGeneration: firstClaim.run.claimGeneration,
    schema: SearchPersonOrg.output,
    value: SEARCH_OUTPUT,
    provenance: provenance(
      [
        "results",
        "selection.status",
        "selection.selected.emplId",
        "selection.selected.name",
        "selection.selected.department",
        "selection.selected.jobTitle",
        "selection.selected.employeeStatus",
        "selection.selected.hdh",
        "selection.candidateEids",
      ],
      "live",
      SEARCH_OBSERVED_AT,
    ),
    writtenAt: SEARCH_OBSERVED_AT,
  });
  database.authority.runCheckpoints.insert(searching);
  const requeued = database.authority.runs.requeue({
    runId: EXIT_RUN_ID,
    expectedVersion: firstRun.version,
    claim: firstToken,
    cause: "recovery",
    now: ATTEMPT_2_AT,
  });
  if (requeued.state !== "applied")
    throw new Error("exit run did not requeue for its next claim");
  const claimed = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    now: ATTEMPT_2_AT,
  });
  if (claimed.state !== "claimed")
    throw new Error(`exit run was not claimed: ${claimed.state}`);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = {
    workerId,
    claimedAt: ATTEMPT_2_AT,
    heartbeatAt: ATTEMPT_2_AT,
  };

  const validating = database.authority.runs.transition({
    runId: EXIT_RUN_ID,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...claimFields },
    now: ATTEMPT_2_AT,
  });
  if (validating.state !== "applied")
    throw new Error("exit run did not enter validating");
  const running = database.authority.runs.transition({
    runId: EXIT_RUN_ID,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: {
      state: "running",
      ...claimFields,
      currentNodeId: "active-status",
    },
    now: ATTEMPT_2_AT,
  });
  if (running.state !== "applied")
    throw new Error("exit run did not enter running");

  const canonical = PersonLookupInput.parse({ emplId: EXIT_EID });
  const searched = SearchPersonOrg.output.parse(SEARCH_OUTPUT);
  const discovery = CrmSearchOnboardingRecords.output.parse({ state: "checked", records: [{ recordId: EXIT_CRM_RECORD_ID, recordUrl: "https://example.invalid/record", emplId: EXIT_EID, name: "Battistessa, Johnnie", department: "Housing Dining Hospitality", firstDayOfService: "07/15/2026", dateSigned: "" }] });
  const initialIdentity = resolvePersonLookupIdentity({ input: canonical, person: searched });
  const resolvedIdentity = resolvePersonLookupIdentity({ input: canonical, person: searched, crm: discovery });
  const identityCheckpointInputs = [
    ["search-identity", ReadResolvedIdentity.output, initialIdentity],
    ["crm-identity", ReadResolvedIdentity.output, resolvedIdentity],
    ["crm-selected-record", CrmVerifyOnboardingRecord.output, discovery],
  ] as const;
  const identityCheckpoints = identityCheckpointInputs.map(([nodeId, schema, value]) => checkpoint({ nodeId, attempt: 1, claimGeneration: claimed.run.claimGeneration,
    schema: schema as Parameters<typeof deriveSchemaHash>[0], value, provenance: provenance(jsonLeafPaths(JsonValueSchema.parse(value)), nodeId === "crm-selected-record" ? "live" : "derived", CROSS_VERIFY_OBSERVED_AT), writtenAt: CROSS_VERIFY_OBSERVED_AT }));
  for (const record of identityCheckpoints) database.authority.runCheckpoints.insert(record);
  const crossVerify = checkpoint({
    nodeId: "cross-verify",
    attempt: 1,
    claimGeneration: claimed.run.claimGeneration,
    schema: CrmSearchOnboardingRecords.output,
    value: discovery,
    provenance: provenance(["state", "records"], "live", CROSS_VERIFY_OBSERVED_AT),
    writtenAt: CROSS_VERIFY_OBSERVED_AT,
  });
  const activeStatus = checkpoint({
    nodeId: "active-status",
    attempt: 1,
    claimGeneration: claimed.run.claimGeneration,
    schema: ReadActiveStatus.output,
    value: derivePersonLookupOutcome({ input: canonical, identity: resolvedIdentity }),
    provenance: provenance(
      jsonLeafPaths(JsonValueSchema.parse(derivePersonLookupOutcome({ input: canonical, identity: resolvedIdentity }))),
      "derived",
      ACTIVE_STATUS_AT,
    ),
    writtenAt: ACTIVE_STATUS_AT,
  });
  for (const record of [crossVerify, activeStatus]) {
    database.authority.runCheckpoints.insert(record);
  }

  const built = buildRunResult(
    personLookupDescriptor,
    running.run,
    [
      ...identityCheckpoints.map(value => ({ state: "resolved" as const, nodeId: RunCheckpointRecordSchema.parse(value).nodeId, checkpoint: value })),
      { state: "not-run", nodeId: "matching", reason: "condition-false" },
      { state: "not-run", nodeId: "crm-results", reason: "condition-false" },
      { state: "resolved", nodeId: "active-status", checkpoint: activeStatus },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    manualClock(new Date(EXIT_TERMINAL_AT)),
  );
  database.terminalizeSuccess(
    {
      result: built.record,
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
      },
    },
    built.authorization,
  );

  const terminal = database.authority.runs.get(EXIT_RUN_ID);
  if (terminal === undefined)
    throw new Error("exit run vanished after terminalization");
  return { run: terminal, checkpoints: database.authority.runCheckpoints.listByItem(terminal.envelope.workflow, terminal.envelope.itemId) };
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
  afterPrepareSpanPath: `${KUALI_TRACE_ID}/finalize-kuali/prepare`,
});

export interface KualiReceiptEvidence {
  readonly run: unknown;
  readonly result: unknown;
  readonly checkpoints: readonly unknown[];
  readonly writes: readonly ReceiptWriteEvidence[];
}


export function kualiReceiptEvidence(
  input?: Readonly<{ readonly contractFingerprint?: string }>,
): KualiReceiptEvidence {
  const descriptor = separationsKualiFinalizationDescriptor;
  const storedContractFingerprint =
    input?.contractFingerprint ?? descriptor.contractFingerprint;
  const proofSchemaHash = deriveSchemaHash(
    KualiSaveSeparationFinalization.writeSafety.completion.proofSchema,
    "output",
  );
  const outputSchemaHash = deriveSchemaHash(
    KualiSaveSeparationFinalization.output,
    "output",
  );
  const outcome = TransactionOutcomeSchema.parse({
    disposition: "committed",
    proofSource: "normal-output",
    proof: { schemaHash: proofSchemaHash, value: KUALI_SAVED_PROOF },
    output: {
      schemaHash: outputSchemaHash,
      value: { savedState: KUALI_SAVED_PROOF },
    },
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
        ...Object.keys(FINALIZATION_FIELDS).map(
          (field) => `output.savedState.fields.${field}`,
        ),
        "output.savedState.source",
      ],
      "live",
      KUALI_CONFIRMED_AT,
    ),
    writtenAt: KUALI_CONFIRMED_AT,
  });
  const dependencyCheckpoint = (
    input: Readonly<{
      nodeId: "approval" | "department-option";
      schema: Parameters<typeof deriveSchemaHash>[0];
      value: unknown;
      paths: readonly string[];
    }>,
  ) =>
    RunCheckpointRecordSchema.parse({
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
    paths: [
      "option",
      "departmentCode",
      "optionDescription",
      "ucpathDepartment",
      "observedOptionCount",
    ],
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
        protectedBindings: [{ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: "11111111-1111-4111-8111-111111111111" }],
        schemaHash: deriveSchemaHash(
          SeparationsKualiFinalizationCanonicalInput,
          "output",
        ),
        value: canonicalInput,
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: {
      state: "terminal",
      outcome: "done",
      endedAt: KUALI_CONFIRMED_AT,
    },
    claimGeneration: 1,
    version: 5,
    createdAt: KUALI_FENCED_AT,
    updatedAt: KUALI_CONFIRMED_AT,
  };


  const built = buildRunResult(
    descriptor,
    { ...run, lifecycle: RUNNING_LIFECYCLE, version: 4 },
    [
      { state: "resolved", nodeId: "approval", checkpoint: approvalCheckpoint },
      {
        state: "resolved",
        nodeId: "department-option",
        checkpoint: departmentCheckpoint,
      },
      {
        state: "resolved",
        nodeId: "finalize-kuali",
        checkpoint: transactionCheckpoint,
      },
    ],
    manualClock(new Date(KUALI_CONFIRMED_AT)),
  );
  const result = built.record;
  const completedRun = RunRecordSchema.parse({
    ...run,
    completion: {
      schemaVersion: 1,
      kind: "done",
      expectedVersion: 4,
      claim: { workerId: RUNNING_LIFECYCLE.workerId, claimGeneration: 1 },
      authorizedAt: KUALI_CONFIRMED_AT,
      resultDigest: result.resultDigest,
    },
  });

  const bindingProofDigest = deriveWriteBindingProofDigest(KUALI_BINDING_PROOF);
  const writeAttemptId = "3d5f8a12-9b04-4c6e-8a33-77e1c2b9d045";
  const intent = WriteIntentRecordSchema.parse({
    writeIntentId: KUALI_INTENT_ID,
    workflowId: descriptor.id,
    itemId: KUALI_ITEM_ID,
    taskId: "kuali/save-separation-finalization",
    system: "kuali",
    idempotencyKey: KUALI_IDEMPOTENCY_KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest(
      "kuali",
      KUALI_IDEMPOTENCY_KEY,
    ),
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
      completionProof: {
        schemaHash: proofSchemaHash,
        value: KUALI_SAVED_PROOF,
      },
      confirmedAt: KUALI_CONFIRMED_AT,
    },
    recordedAt: KUALI_CONFIRMED_AT,
  });

  const checkpoints = [
    approvalCheckpoint,
    departmentCheckpoint,
    transactionCheckpoint,
  ];
  if (storedContractFingerprint === descriptor.contractFingerprint) {
    return {
      run: completedRun,
      result,
      checkpoints,
      writes: [{ intent, attempts: [attempt] }],
    };
  }
  const storedRun = RunRecordSchema.parse({
    ...completedRun,
    envelope: {
      ...run.envelope,
      contractFingerprint: storedContractFingerprint,
    },
  });
  const storedCheckpoints = checkpoints.map((record) =>
    RunCheckpointRecordSchema.parse({
      ...record,
      contractFingerprint: storedContractFingerprint,
    }),
  );
  const storedDependencies = result.dependencies.map((dependency) =>
    dependency.state === "resolved"
      ? { ...dependency, contractFingerprint: storedContractFingerprint }
      : dependency,
  );
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


const RUNNING_LIFECYCLE = Object.freeze({
  state: "running",
  workerId: "kuali-receipt-worker-1",
  claimedAt: KUALI_FENCED_AT,
  heartbeatAt: KUALI_CONFIRMED_AT,
  currentNodeId: "finalize-kuali",
});



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

  readonly evidenceDigest: string;
}


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
      schemaHash: deriveSchemaHash(
        SeparationsVerifyIdentityApproval.output,
        "output",
      ),
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
    throw new Error(
      "the gate fixture requires an operator-approved identity subject",
    );
  }

  const gateResult = GateResultRecordSchema.parse({
    runId: GATE_RUN_ID,
    gateId: "identity-approval",
    nodeId: "identity-approval",
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
        protectedBindings: [],
        schemaHash: deriveSchemaHash(
          SeparationsIdentityCheckCanonicalInput,
          "output",
        ),
        value: canonicalInput,
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: {
      state: "terminal",
      outcome: "done",
      endedAt: GATE_TERMINAL_AT,
    },
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
    run: RunRecordSchema.parse({
      ...run,
      completion: {
        schemaVersion: 1,
        kind: "done",
        expectedVersion: 17,
        claim: { workerId: "identity-check-worker-1", claimGeneration: 1 },
        authorizedAt: GATE_TERMINAL_AT,
        resultDigest: built.record.resultDigest,
      },
    }),
    result: built.record,
    checkpoints: [approvalCheckpoint],
    gateResults: [gateResult],
    evidenceDigest,
  };
}
