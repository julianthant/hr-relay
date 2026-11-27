import { RunRecordSchema } from "../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-authority-reason.js";
import { createRunTerminalEvidenceResult, deriveTerminalFailureDigest, RunTerminalEvidenceResultSchema, RunResultRecordSchema, TerminalDependencyRecordSchema, deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest, deriveRunResultDigest, deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";
import { RunCompletionSchema, completionFromAuthorization } from "../../../src/models/run/completion.js";
import { currentAtomicWriteFixture } from "../../support/helpers/timeline-write-fixture.js";
import { CredentialStoreApplyOutcomeSchema } from "../../../src/models/config/credential-store.js";
import { initialProtectedStoreRecord } from "../../../src/models/config/protected-settings.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { TEST_TARGET_REGISTRY, TestTargetRegistrySchema } from "../../../src/backend/app/registries/test-target-registry.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityTableRegistrySchema, TableSpecSchema } from "../../../src/models/config/authority.js";
import { BoundaryFailureSchema } from "../../../src/models/failures/boundary-failure.js";
import { TerminalDependencyEvidenceSchema } from "../../../src/backend/runs/lifecycle/run-result.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CommandAuditRecordSchema, CommandRequestSchema, CommandResultSchema, CommandTargetReferenceSchema, GateCommandRequestSchema, IntakeCommandRequestSchema, NotificationCommandRequestSchema, RunCommandRequestSchema, SettingsCommandRequestSchema, WorkerBrowserCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { ArtifactRefWireSchema, ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../../src/models/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DiagnosticBundleWireSchema } from "../../../src/models/dashboard/diagnostic-bundle.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema } from "../../../src/models/dashboard/subscription.js";
import { GateResultRecordSchema } from "../../../src/models/workflow/gates.js";
import { LedgerEntryPayloadSchema, LedgerEntrySchema, WriteCommittedSpanOutboxPayloadSchema } from "../../../src/rules/runs/ledger.js";
import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema, ProviderResponseEnvelopeSchema } from "../../../src/models/providers/providers.js";
import { buildPreflightReport, PreflightObservationSchema, PreflightReportSchema, PreflightResultSchema, requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { ClassifiedDiagnosticValueSchema, RedactionResultSchema } from "../../../src/rules/redaction/redaction.js";
import { RUNTIME_DEPENDENCY_REGISTRY, RuntimeDependencyRegistrySchema } from "../../../src/models/runtime/runtime-dependencies.js";
import { RUNTIME_ENVIRONMENT_REGISTRY, RuntimeEnvironmentRegistrySchema } from "../../../src/models/runtime/runtime-environment.js";
import { SchemaBoundCanonicalValueSchema } from "../../../src/models/validation/schema-bound-value.js";
import { FailureTerminalAuthorizationRecordSchema, TerminalAuthorizationRecordSchema } from "../../../src/models/run/terminal-authorization.js";
import { DataPointSchema, RecordedDataPointSchema, TaskProvenanceResultSchema, TaskUpstreamCheckpointEvidenceSchema } from "../../../src/rules/workflow/task-provenance.js";
import { CompletionProgramSampleSchema, ExtractedFieldSchema, MemberPlanEntrySchema, PreviewRecordSchema } from "../../../src/models/workflow/completion.js";
import { InputParserSpecSchema, ParsedInputEntrySchema, SurfaceFieldSchema, TextTemplateSchema, UploadFieldSpecSchema, WorkflowSurfacesSchema } from "../../../src/models/workflow/ingress.js";
import { DetailProjectionSpecRuntimeSchema, SurfaceShapeSchema, WorkflowCapabilitiesSchema } from "../../../src/models/workflow/presentation.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { childRunOutcomeSchema } from "../../../src/models/workflow/graph.js";
import { RetryPolicySchema } from "../../../src/models/sessions/session.js";
import { FreshnessPolicySchema, SubjectBindingSpecSchema } from "../../../src/models/task/task-contract.js";
import { UiVerificationEvidenceManifestSchema, UiVerificationScenarioSchema } from "../../../src/models/ui/contracts.js";
import { CRM_ONBOARDING_DISPLAYED_EID, CrmOnboardingDatesReadSchema, CrmOnboardingRecordReadSchema, CrmSubjectBindingSchema } from "../../../src/models/ui/crm-onboarding.js";
import { SecretAvailabilitySchema } from "../../../src/models/config/secrets.js";
import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { ActionEvidenceSchema, EvidenceFactSchema, RunEvidenceReceiptSchema } from "../../../src/models/trust/evidence.js";
import { FailureRecordSchema } from "../../../src/models/trust/failure.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/models/trust/preflight-scenarios.js";
import { ScenarioManifestSchema } from "../../../src/models/trust/scenario.js";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
import { NegativeSettlementDecisionSchema, NegativeSettlementEvaluationInputSchema, NegativeSettlementPolicySchema, RecoveryProbeVerdictSchema, SubjectEvidenceSchema, SubjectProofSchema, TransactionOutcomeSchema, WriteAttemptRecordSchema, WriteBindingProofSchema, WriteIntentRecordSchema } from "../../../src/rules/write-safety/write-safety.js";
import { ArtifactOutboxStorageRecordSchema, AtomicWriteCommitInputSchema, AtomicWriteCommitReportSchema, AuthorityBackupRunReportSchema, AuthorityCopyInspectionSchema, PermanentWriteResolutionSchema, StorageDoctorReportSchema, WriteFenceInputSchema, FailureTerminalizationReportSchema, FailureTerminalizationRequestSchema, SuccessTerminalizationReportSchema, SuccessTerminalizationRequestSchema } from "../../../src/backend/storage/sqlite/index.js";
import { AuthoritySchemaInspectionSchema } from "../../../src/backend/storage/sqlite/authority-connection.js";
import { BackupHealthSchema, RestoreCandidateSchema } from "../../../src/models/storage/storage-status.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { CRM_UI_REGISTRY } from "../../../src/backend/systems/crm/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "../../../src/backend/systems/ucpath/driver/ui-registry.js";
import { ABSENCE_1, ABSENCE_2, ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, COMMITTED_OUTCOME, GATE_RESULT, IDEMPOTENCY_KEY, IDEMPOTENCY_KEY_DIGEST, LEDGER_OUTBOX_RECORD, LEDGER_PAYLOAD, NOTIFICATION, SPAN_OUTBOX_PAYLOAD, SPAN_OUTBOX_RECORD, SUBJECT_EVIDENCE, SUBJECT_PROOF, UNSCOPED_PROOF, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

const STABLE_RECORD_ID = `${"c".repeat(64)}#oath-signature#1`;
const PREVIEW_RECORD = {
  recordId: STABLE_RECORD_ID,
  sourceArtifactId: "11111111-1111-4111-8111-111111111111",
  page: 1,
  fields: [{ key: "employee-id", value: { state: "present", text: "10873698" } }],
};
const APPROVE_CONTEXT = {
  parentRunId: "22222222-2222-4222-8222-222222222222",
  parentItemId: "33333333-3333-4333-8333-333333333333",
  intakeSessionId: "11111111-1111-4111-8111-111111111111",
  sourceArtifactId: "11111111-1111-4111-8111-111111111111",
  approvedBy: "local-operator",
  approvedAt: "2026-07-31T17:00:00.000Z",
};
const RUN_CHECKPOINT = {
  workflowId: "person-lookup",
  itemId: "33333333-3333-4333-8333-333333333333",
  nodeId: "searching",
  attempt: 1,
  claimGeneration: 1,
  runId: "22222222-2222-4222-8222-222222222222",
  output: { schemaHash: "a".repeat(64), value: { verified: true } },
  descriptorVersion: 1,
  contractFingerprint: "a".repeat(64),
  implFingerprint: "b".repeat(64),
  provenance: [{
    path: "selection.selected",
    source: "live",
    observedAt: "2026-07-31T17:00:00.000Z",
    originalObservedAt: "2026-07-31T17:00:00.000Z",
  }],
  writtenAt: "2026-07-31T17:00:00.000Z",
};
const RESOLVED_TERMINAL_DEPENDENCY = {
  state: "resolved",
  nodeId: RUN_CHECKPOINT.nodeId,
  checkpoint: {
    workflowId: RUN_CHECKPOINT.workflowId,
    itemId: RUN_CHECKPOINT.itemId,
    attempt: RUN_CHECKPOINT.attempt,
    claimGeneration: RUN_CHECKPOINT.claimGeneration,
    runId: RUN_CHECKPOINT.runId,
  },
  outputSchemaHash: RUN_CHECKPOINT.output.schemaHash,
  descriptorVersion: RUN_CHECKPOINT.descriptorVersion,
  contractFingerprint: RUN_CHECKPOINT.contractFingerprint,
  implFingerprint: RUN_CHECKPOINT.implFingerprint,
  outputDigest: deriveCheckpointOutputDigest(RUN_CHECKPOINT.output),
  provenanceDigest: deriveCheckpointProvenanceDigest(RUN_CHECKPOINT.provenance),
};
const NOT_RUN_TERMINAL_DEPENDENCY = {
  state: "not-run",
  nodeId: "crm-dates",
  reason: "condition-false",
};
const TERMINAL_RESULT_VALUE = { schemaHash: "a".repeat(64), value: { complete: true } };
const TERMINAL_DEPENDENCIES = [RESOLVED_TERMINAL_DEPENDENCY, NOT_RUN_TERMINAL_DEPENDENCY];
const RUN_RESULT = {
  runId: "22222222-2222-4222-8222-222222222222",
  attempt: 1,
  workflowId: "person-lookup",
  descriptorVersion: 1,
  contractFingerprint: "a".repeat(64),
  configFingerprint: "b".repeat(64),
  configSnapshotId: "33333333-3333-4333-8333-333333333333",
  resultSchemaHash: "a".repeat(64),
  result: TERMINAL_RESULT_VALUE,
  resultDigest: deriveRunResultDigest(TERMINAL_RESULT_VALUE),
  dependencies: TERMINAL_DEPENDENCIES,
  dependencyDigest: deriveTerminalDependencyDigest(TERMINAL_DEPENDENCIES),
  createdAt: "2026-07-31T17:00:00.000Z",
};

const PERSON_LOOKUP_PARSER = {
  split: { kind: "delimited", delimiters: [";", "\n"] },
  rules: [
    { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
    { when: { kind: "otherwise" }, emit: "name" },
  ],
  constants: [{ field: "keepNonHdh", value: { kind: "boolean", value: false } }],
};

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-31T17:00:00.000Z";
const CLOCK = manualClock(new Date("2026-07-31T10:00:00-07:00"));
const UI_EVIDENCE = JSON.parse(readFileSync(
  join(REPO_ROOT, "tests/support/fixtures/ui/ucpath/person-org.fixture.json"),
  "utf8",
)) as unknown;

const FAILURE = {
  failureId: UUID_1, fingerprint: HASH_B, runId: QUEUED_RUN.envelope.runId, traceId: QUEUED_RUN.envelope.traceId, attempt: QUEUED_RUN.envelope.attempt,
  workflowId: QUEUED_RUN.envelope.workflow, nodeId: "search-person", taskId: "ucpath/search-person",
  code: "UNEXPECTED_PAGE_STATE", summary: "Expected state did not render", transient: false,
  writeState: "not-attempted",
  causeChain: [{ code: "UNEXPECTED_PAGE_STATE", summary: "Page mismatch", role: "primary", transient: false }],
  remediation: [{ kind: "code-change", message: "Repair the state recipe" }], occurredAt: NOW,
};
const FAILURE_TERMINAL_AUTHORIZATION = {
  kind: "failed",
  runId: FAILURE.runId,
  workflowId: FAILURE.workflowId,
  attempt: FAILURE.attempt,
  descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
  contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
  expectedVersion: 1,
  claim: { workerId: "worker-1", claimGeneration: 1 },
  authorizedAt: NOW,
  failureId: FAILURE.failureId,
};
const SUCCESS_TERMINAL_AUTHORIZATION = {
  kind: "done",
  runId: RUN_RESULT.runId,
  workflowId: RUN_RESULT.workflowId,
  attempt: RUN_RESULT.attempt,
  descriptorVersion: RUN_RESULT.descriptorVersion,
  contractFingerprint: RUN_RESULT.contractFingerprint,
  expectedVersion: 1,
  claim: { workerId: "worker-1", claimGeneration: 1 },
  authorizedAt: NOW,
  resultDigest: RUN_RESULT.resultDigest,
};

const FAILED_RUN = {
  completion: completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(FAILURE_TERMINAL_AUTHORIZATION)),
  ...QUEUED_RUN,
  lifecycle: {
    state: "terminal",
    outcome: "failed",
    endedAt: NOW,
    failureId: FAILURE.failureId,
    errorSummary: FAILURE.summary,
  },
  claimGeneration: 1,
  version: 2,
};
const DONE_RUN = {
  completion: completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(SUCCESS_TERMINAL_AUTHORIZATION)),
  ...QUEUED_RUN,
  lifecycle: { state: "terminal", outcome: "done", endedAt: NOW },
  claimGeneration: 1,
  version: 2,
};
const FAILED_RESULT = createRunTerminalEvidenceResult(RunRecordSchema.parse(FAILED_RUN), { kind: "failed-evidence", authorization: FailureTerminalAuthorizationRecordSchema.parse(FAILURE_TERMINAL_AUTHORIZATION), failureDigest: deriveTerminalFailureDigest(FailureRecordSchema.parse(FAILURE)) });
const RECEIPT = {
  composition: 5,
  receiptId: UUID_1, runId: UUID_2, traceId: "on-120000-2222", workflowId: "onboarding", attempt: 1,
  generatedAt: NOW, descriptorFingerprint: HASH_A, configFingerprint: HASH_A,
  retryOf: { state: "absent" }, failure: { state: "absent" }, input: [], observations: [], decisions: [],
  actions: [], verification: [{ id: UUID_3, obligation: "run.completed", mandatory: true, verdict: "verified", evidence: [`observation:${UUID_2}`] }],
  output: [], reuse: [], warnings: [], confidence: "verified", result: "verified-done",
};
const EVIDENCE_FACT = {
  id: UUID_1,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: NOW },
  value: { state: "transformed", key: "employeeId", classification: "direct-identifier", transform: "last4", value: "1234" },
};
const ACTION_EVIDENCE = {
  id: UUID_1,
  taskId: "ucpath/search-person",
  kind: "external-read",
  writeState: "not-attempted",
  occurredAt: NOW,
};
const BOOTSTRAP = {
  wireVersion: 1, appVersion: "1.0.0", descriptorHash: HASH_A, settingsSchemaHash: HASH_B, protectedSchemaHash: HASH_A,
  projectionGeneration: 1, actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy" }, workflows: [],
};
const DAY = {
  day: "2026-07-31", descriptorHash: HASH_A, projectionGeneration: 1, snapshotCursor: "pc:1",
  monthCounts: [], workflowCounts: [], statusCounts: [], queueSurfaces: [], workerCards: [], workerAuthority: { state: "present", members: [] }, workerPools: [],
};
const DETAIL = {
  runId: UUID_1, rowRevision: 1, panelKind: "run",
  header: { runId: UUID_1, traceId: "on-120000-1111", workflowId: "onboarding", actorId: "local-operator", title: "Run", status: "running", attempt: 1 },
  timeline: { events: [] }, gate: { state: "absent", reason: "no gate" },
  outcome: { state: "absent", reason: "active" }, context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  availableSections: ["logs"],
};
const ARTIFACT = { state: "missing", artifactId: UUID_1, reason: "not captured" };
const ARTIFACT_REF = {
  artifactId: UUID_1, sha256: HASH_A, byteLength: 10, sensitivity: "redacted", redaction: "applied",
  mediaKind: "image", mediaType: "image/png", width: 10, height: 10,
};

const requestedCapabilities = ["dashboard.serve"] as const;
const preflightObservations = requiredPreflightChecks(requestedCapabilities).map((check) => ({
  check, state: "healthy" as const, summary: `${check} healthy`,
}));
const PREFLIGHT_REPORT = buildPreflightReport({
  configFingerprint: HASH_A, requestedCapabilities, observations: preflightObservations, clock: CLOCK,
});

const commandFixtures = (family: string): readonly unknown[] => COMMAND_FIXTURES.filter(
  (fixture) => (fixture as { readonly family: string }).family === family,
);
const COMMAND_RESULT = {
  state: "applied",
  commandId: UUID_1,
  affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }],
};
const COMMAND_AUDIT = {
  auditId: UUID_2,
  request: COMMAND_FIXTURES[0],
  result: COMMAND_RESULT,
  completedAt: NOW,
  versionChanges: [],
  affectedDependencyIds: [],
};
const PRESENT_PROOF_REFERENCE = {
  proofSchemaHash: HASH_A,
  proofFingerprint: HASH_B,
  evidenceRef: `observation:${UUID_3}`,
};
const STABILIZED_POLICY = {
  kind: "stabilized",
  minSinceFenceMs: 60_000,
  consistentReads: 2,
  minBetweenReadsMs: 60_000,
  requireSameSourceState: true,
};
const NEGATIVE_EVALUATION = {
  writeIntentId: UUID_1,
  generation: 1,
  idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
  authoritativeSource: ABSENCE_1.source,
  authoritativeSourceState: ABSENCE_1.sourceState,
  queryDigest: ABSENCE_1.queryDigest,
  fencedAt: NOW,
  policy: STABILIZED_POLICY,
  verdicts: [{ state: "absent", evidence: ABSENCE_1 }, { state: "absent", evidence: ABSENCE_2 }],
};
const SAFE_SETTLEMENT = {
  state: "safe-to-retry",
  writeIntentId: UUID_1,
  generation: 1,
  decidedAt: "2026-07-31T17:03:00.000Z",
  evidence: [ABSENCE_1, ABSENCE_2],
};
const WRITE_INTENT_FIXTURES = [
  {
    writeIntentId: UUID_1,
    workflowId: "separation",
    itemId: UUID_3,
    taskId: "ucpath/terminate-person",
    system: "ucpath",
    idempotencyKey: IDEMPOTENCY_KEY,
    idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
    generation: 1,
    status: "observed-present",
    observedProof: { schemaHash: HASH_A, value: "T123" },
    observedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  WRITE_INTENT_ATTEMPTING,
  { ...WRITE_INTENT_ATTEMPTING, status: "committed", completionProof: { schemaHash: HASH_A, value: "T123" }, confirmedAt: ABSENCE_1.observedAt },
  { ...WRITE_INTENT_ATTEMPTING, status: "retryable", settlement: SAFE_SETTLEMENT, resolvedAt: ABSENCE_2.observedAt },
  { ...WRITE_INTENT_ATTEMPTING, status: "parked", parkedCode: "operator-required", message: "Manual confirmation required", authorityReason: deriveWriteAuthorityReason("manual-confirmation-required", "proof", "Synthetic verifier requires manual confirmation") },
];
const WRITE_ATTEMPT_FIXTURES = [
  WRITE_ATTEMPT,
  { ...WRITE_ATTEMPT, outcome: { state: "committed", completionProof: { schemaHash: HASH_A, value: "T123" }, confirmedAt: ABSENCE_1.observedAt } },
  { ...WRITE_ATTEMPT, outcome: { state: "safe-to-retry", settlement: SAFE_SETTLEMENT } },
  { ...WRITE_ATTEMPT, outcome: { state: "parked", code: "operator-required", message: "Manual confirmation required", authorityReason: deriveWriteAuthorityReason("manual-confirmation-required", "proof", "Synthetic verifier requires manual confirmation") } },
];
const LEDGER_ENTRY = { outboxId: UUID_1, seq: 0, payload: LEDGER_PAYLOAD };
const SQLITE_SCHEMA_INSPECTION = {
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  authorityGeneration: 0,
  pragmas: { journalMode: "wal", foreignKeys: 1, synchronous: 2, busyTimeoutMs: 250 },
  tables: AUTHORITY_TABLE_REGISTRY.map(({ name, classification }) => ({ name, classification })),
};



const SQLITE_ARTIFACT_OUTBOX = {
  outboxId: UUID_1,
  artifactId: UUID_2,
  projectionId: "retention-record",
  stableKeyFingerprint: HASH_B,
  keyValues: [{ field: "subject", value: "10456712" }],
  sinkId: "xlsx-retention",
  sourceRunId: UUID_1,
  sourceNodeId: "extract",
  state: "pending",
  payload: { schemaHash: HASH_A, value: { artifact: UUID_2 } },
  createdAt: NOW,
};

const AUTHORITY_PENDING_COUNTS = {
  pendingCommands: 1,
  unresolvedWriteIntents: 1,
  providerReservations: 1,
  artifactOutbox: 1,
};
const AUTHORITY_COPY_INSPECTION = {
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  installationId: UUID_1,
  profileId: UUID_2,
  pageCount: 24,
  authorityGeneration: 4,
  authorityContentFingerprint: HASH_A,
  quickCheck: "ok",
  foreignKeyViolations: 0,
  invariants: { state: "valid", violations: [] },
  tables: AUTHORITY_TABLE_REGISTRY.map(({ name, classification }) => ({ name, classification })),
  counts: AUTHORITY_PENDING_COUNTS,
};
const BACKUP_VERIFICATION = {
  state: "verified",
  observedFrom: "backup-copy",
  observedAt: NOW,
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  installationId: UUID_1,
  profileId: UUID_2,
  pageCount: 24,
  authorityGeneration: 4,
  authorityContentFingerprint: HASH_A,
  quickCheck: "ok",
  foreignKeyViolations: 0,
  invariantViolations: [],
  exactTableRegistry: true,
};
const BACKUP_MANIFEST = {
  kind: "hrauto-authority-backup",
  manifestVersion: 4,
  backupFileName: "authority-g4.sqlite",
  sourceDatabaseIdentity: HASH_B,
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  installationId: UUID_1,
  profileId: UUID_2,
  pageCount: 24,
  authorityGeneration: 4,
  authorityContentFingerprint: HASH_A,
  createdAt: NOW,
  byteSize: 4096,
  sha256: HASH_B,
  verification: BACKUP_VERIFICATION,
};
const HEALTH_CAUSE = { code: "backup-stale", summary: "verified backup is behind authority" };
const RESTORE_CANDIDATE = {
  state: "verified-compatible",
  selection: "single-database",
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  restoreEligibility: { state: "eligible" },
  manifestFileName: "authority-g4.sqlite.manifest.json",
  backupFileName: "authority-g4.sqlite",
  createdAt: NOW,
  authorityGeneration: 4,
  ageMs: 1_000,
  generationGap: { state: "known", value: 0 },
};

const STORAGE_DOCTOR_REPORT = {
  recovery: { state: "clear" },
  authorityUpgrades: { state: "absent", reason: "journal-empty" },
  tombstoneOrdinals: { state: "available", findings: [{ code: "tombstone-ordinal-unknown", runId: UUID_1, missingFields: ["runNumber"] }] },
  protectedSettings: { state: "unavailable", cause: { code: "authority-unavailable", summary: "protected settings fixture is unavailable" } },
  kind: "authority-storage-doctor",
  mode: "read-only",
  checkedAt: NOW,
  sourceDatabaseIdentity: HASH_B,
  authority: { state: "healthy", inspection: AUTHORITY_COPY_INSPECTION },
  counts: { state: "available", values: AUTHORITY_PENDING_COUNTS },
  spanAuthority: { state: "reconciled", streamRunCount: 0, liveRunCount: 0, deleted: [] },
  backup: { state: "current", latest: RESTORE_CANDIDATE },
  restoreCandidates: [RESTORE_CANDIDATE],
};
const CRM_SUBJECT_BINDING = CrmSubjectBindingSchema.parse({
  state: "displayed-record",
  observationId: CRM_ONBOARDING_DISPLAYED_EID,
  expectedEid: "10873698",
  observedEid: "10873698",
});
const CRM_RECORD_READ = CrmOnboardingRecordReadSchema.parse({
  binding: CRM_SUBJECT_BINDING,
  output: {
    state: "found",
    record: {
      recordId: "ONB-40213",
      emplId: "10873698",
      fullName: "Fixture, Person",
      rawStage: "Completed",
    },
  },
});
const CRM_DATES_READ = CrmOnboardingDatesReadSchema.parse({
  binding: CRM_SUBJECT_BINDING,
  output: {
    emplId: "10873698",
    state: "read", employmentDate: "2026-07-15", oathDate: null, reason: "",
  },
});

interface BoundarySchemaFixture {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly fixtures: readonly unknown[];
  /** Deliberately dynamic JSON payloads are data records, not typed decision records. */
  readonly openFixturePaths?: readonly string[];
}

export const BOUNDARY_SCHEMA_FIXTURES: readonly BoundarySchemaFixture[] = [
  { name: "AuthorityTableSpec", schema: TableSpecSchema, fixtures: AUTHORITY_TABLE_REGISTRY },
  { name: "AuthorityTableRegistry", schema: AuthorityTableRegistrySchema, fixtures: [AUTHORITY_TABLE_REGISTRY] },
  { name: "AuthoritySchemaInspection", schema: AuthoritySchemaInspectionSchema, fixtures: [SQLITE_SCHEMA_INSPECTION] },
  { name: "ArtifactOutboxStorageRecord", schema: ArtifactOutboxStorageRecordSchema, fixtures: [SQLITE_ARTIFACT_OUTBOX], openFixturePaths: ["payload.value"] },
  { name: "AuthorityCopyInspection", schema: AuthorityCopyInspectionSchema, fixtures: [AUTHORITY_COPY_INSPECTION] },
  { name: "CredentialStoreApplyOutcome", schema: CredentialStoreApplyOutcomeSchema, fixtures: [{ state: "applied", record: initialProtectedStoreRecord() }] },
  { name: "AuthorityBackupRunReport", schema: AuthorityBackupRunReportSchema, fixtures: [{ state: "verified", requestedGeneration: 4, finalGeneration: 4, coalescedRequests: 1, followUpPerformed: false, manifests: [BACKUP_MANIFEST] }] },
  { name: "RestoreCandidate", schema: RestoreCandidateSchema, fixtures: [
    RESTORE_CANDIDATE,
    { ...RESTORE_CANDIDATE, generationGap: { state: "unavailable", reason: "live authority is degraded" } },
    { state: "invalid", manifestFileName: "bad.manifest.json", cause: { code: "backup-invalid", summary: "checksum mismatch" } },
  ] },
  { name: "BackupHealth", schema: BackupHealthSchema, fixtures: [
    { state: "current", latest: RESTORE_CANDIDATE },
    { state: "stale", latest: RESTORE_CANDIDATE, cause: HEALTH_CAUSE },
    { state: "missing", cause: { code: "backup-missing", summary: "no backup exists" } },
    { state: "invalid", cause: { code: "backup-invalid", summary: "checksum mismatch" } },
  ] },
  { name: "StorageDoctorReport", schema: StorageDoctorReportSchema, fixtures: [
    STORAGE_DOCTOR_REPORT,
    { ...STORAGE_DOCTOR_REPORT, tombstoneOrdinals: { state: "unavailable", cause: HEALTH_CAUSE }, authority: { state: "degraded", cause: HEALTH_CAUSE }, counts: { state: "unavailable", cause: HEALTH_CAUSE }, backup: { state: "missing", cause: { code: "backup-missing", summary: "no backup exists" } }, restoreCandidates: [] },
  ] },
  { name: "SchemaBoundCanonicalValue", schema: SchemaBoundCanonicalValueSchema, fixtures: [{ schemaHash: HASH_A, value: "approved" }] },
  { name: "ExtractedField", schema: ExtractedFieldSchema, fixtures: [
    { key: "employee-id", value: { state: "present", text: "10873698" } },
    { key: "signature", value: { state: "absent" } },
  ] },
  { name: "PreviewRecord", schema: PreviewRecordSchema, fixtures: [PREVIEW_RECORD] },
  { name: "MemberPlanEntry", schema: MemberPlanEntrySchema, fixtures: [
    { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "eid", emplId: "10873698" } },
    { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "name", name: "Battistessa, Johnnie" } },
  ] },
  { name: "CompletionProgramSample", schema: CompletionProgramSampleSchema, fixtures: [
    { mode: "staged-fanout", record: PREVIEW_RECORD, context: APPROVE_CONTEXT, document: { sourceArtifactId: UUID_1, intakeSessionId: UUID_2, context: APPROVE_CONTEXT } },
    { mode: "complete-then-enqueue", plan: { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "eid", emplId: "10873698" } } },
  ] },
  { name: "TextTemplate", schema: TextTemplateSchema, fixtures: [{ segments: [
    { kind: "literal", text: "Uploaded " },
    { kind: "count", field: "pages", singular: "page", plural: "pages" },
    { kind: "field", field: "documentName" },
  ] }] },
  { name: "SurfaceField", schema: SurfaceFieldSchema, fixtures: [
    { field: "name", value: { kind: "text", text: "Battistessa, Johnnie" } },
    { field: "keepNonHdh", value: { kind: "boolean", value: false } },
    { field: "pages", value: { kind: "count", value: 2 } },
  ] },
  { name: "InputParserSpec", schema: InputParserSpecSchema, fixtures: [PERSON_LOOKUP_PARSER] },
  { name: "ParsedInputEntry", schema: ParsedInputEntrySchema, fixtures: [
    { index: 0, sourceText: "10873698", fields: [{ field: "emplId", value: { kind: "text", text: "10873698" } }] },
  ] },
  { name: "UploadFieldSpec", schema: UploadFieldSpecSchema, fixtures: [
    { kind: "text", field: "documentName", label: "Document", required: true },
    { kind: "boolean", field: "keepNonHdh", label: "Keep non-HDH", initial: false },
    { kind: "select", field: "mode", label: "Mode", required: true, options: [{ value: "sign", label: "Sign" }] },
  ] },
  { name: "WorkflowSurfaces", schema: WorkflowSurfacesSchema, fixtures: [
    {},
    { inputRun: { placeholder: "Enter EIDs or names", parser: PERSON_LOOKUP_PARSER, supportsDryRun: true } },
    { uploadRun: {
      title: { segments: [{ kind: "literal", text: "Upload packet" }] },
      fields: [{ kind: "text", field: "documentName", label: "Document", required: true }],
      accepts: [{ mediaType: "application/pdf", extensions: [".pdf"], maxBytes: 10_000_000 }],
      successMessage: { segments: [{ kind: "literal", text: "Queued" }] },
    } },
  ] },
  { name: "SurfaceShape", schema: SurfaceShapeSchema, fixtures: [{ shape: "single" }, { resolveShape: "by-input" }] },
  { name: "WorkflowCapabilities", schema: WorkflowCapabilitiesSchema, fixtures: [
    { review: false, editData: true },
    { review: true, editData: true, delegationDisplay: "inline" },
  ] },
  { name: "DetailProjectionSpecRuntime", schema: DetailProjectionSpecRuntimeSchema, fixtures: [
    { key: "result-name", label: "Name", source: { kind: "result", fieldPath: "activeStatus.details.name" }, display: "text", when: { source: { kind: "input", fieldPath: "mode" }, equals: "match" } },
    { key: "search", label: "Search", source: { kind: "input-title" }, display: "text" },
    { key: "resolved-eid", label: "EID", source: { nodeId: "searching", fieldPath: "selection.selected" }, display: "eid" },
  ] },
  { name: "RunCheckpointRecord", schema: RunCheckpointRecordSchema, fixtures: [RUN_CHECKPOINT], openFixturePaths: ["output.value"] },
  { name: "TerminalDependencyRecord", schema: TerminalDependencyRecordSchema, fixtures: [RESOLVED_TERMINAL_DEPENDENCY, NOT_RUN_TERMINAL_DEPENDENCY,
    { state: "gate-resolved", nodeId: GATE_RESULT.nodeId, gate: { runId: GATE_RESULT.runId, gateId: GATE_RESULT.gateId },
      resultSchemaHash: GATE_RESULT.result.schemaHash, checkpointFingerprint: GATE_RESULT.checkpointFingerprint, recordDigest: HASH_A }] },
  { name: "RunTerminalEvidenceResult", schema: RunTerminalEvidenceResultSchema, fixtures: [FAILED_RESULT.result.value, { kind: "lifecycle-evidence", outcome: "cancelled", commandId: UUID_1, auditId: UUID_1, requestFingerprint: HASH_A, appliedVersion: 2 }] },
  { name: "RunResultRecord", schema: RunResultRecordSchema, fixtures: [RUN_RESULT], openFixturePaths: ["result.value"] },
  { name: "TerminalDependencyEvidence", schema: TerminalDependencyEvidenceSchema, fixtures: [
    { state: "resolved", nodeId: RUN_CHECKPOINT.nodeId, checkpoint: RUN_CHECKPOINT },
    NOT_RUN_TERMINAL_DEPENDENCY,
    { state: "gate-resolved", nodeId: GATE_RESULT.nodeId, gate: GATE_RESULT },
  ], openFixturePaths: ["checkpoint.output.value"] },
  { name: "ChildRunOutcome", schema: childRunOutcomeSchema(z.strictObject({ verified: z.boolean() })), fixtures: [
    { state: "done", runId: UUID_1, itemId: UUID_2, output: { verified: true } },
    { state: "failed", runId: UUID_1, itemId: UUID_2, failureId: UUID_3 },
    { state: "cancelled", runId: UUID_1, itemId: UUID_2, reason: "operator cancelled", cancelledBy: "operator" },
    { state: "blocked", runId: UUID_1, itemId: UUID_2, failureId: UUID_3, reason: "dependency failed" },
  ] },
  { name: "RetryPolicy", schema: RetryPolicySchema, fixtures: [{ attempts: 2, backoffMs: 500, retryOn: "transient" }] },
  { name: "ProviderRequestEnvelope", schema: ProviderRequestEnvelopeSchema, fixtures: [{ capability: "geocode.census", payload: { schemaHash: HASH_A, value: {} } }], openFixturePaths: ["payload.value"] },
  { name: "ProviderResponseEnvelope", schema: ProviderResponseEnvelopeSchema, fixtures: [{ state: "unavailable", reason: { code: "adapter-unavailable", message: "not connected" } }] },
  { name: "ProviderAdapterOutcome", schema: ProviderAdapterOutcomeSchema, fixtures: [{ response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "not connected" } }, evidence: { summary: "synthetic", capturedAt: NOW } }] },
  { name: "IntakeCommandRequest", schema: IntakeCommandRequestSchema, fixtures: commandFixtures("intake") },
  { name: "WorkerBrowserCommandRequest", schema: WorkerBrowserCommandRequestSchema, fixtures: commandFixtures("worker-browser") },
  { name: "SettingsCommandRequest", schema: SettingsCommandRequestSchema, fixtures: commandFixtures("settings") },
  { name: "RunCommandRequest", schema: RunCommandRequestSchema, fixtures: commandFixtures("run") },
  { name: "GateCommandRequest", schema: GateCommandRequestSchema, fixtures: commandFixtures("gate") },
  { name: "NotificationCommandRequest", schema: NotificationCommandRequestSchema, fixtures: commandFixtures("notification") },
  { name: "CommandRequest", schema: CommandRequestSchema, fixtures: COMMAND_FIXTURES },
  { name: "CommandTargetReference", schema: CommandTargetReferenceSchema, fixtures: [
    { family: "start", workflowId: "onboarding", startPlanId: UUID_1, expectedVersion: 1 },
    { family: "intake", intakeSessionId: UUID_1 },
    { family: "worker-browser", workerId: "worker-1" },
    { family: "settings", revision: 1 },
    { family: "run", runId: UUID_1 },
    { family: "gate", runId: UUID_1, gateId: "identity-approval" },
    { family: "notification", notificationId: UUID_1 },
  ] },
  { name: "CommandResult", schema: CommandResultSchema, fixtures: [
    COMMAND_RESULT,
    { state: "conflict", commandId: UUID_1, currentVersion: 2, message: "Target changed" },
    { state: "rejected", commandId: UUID_1, code: "policy-refused", message: "Policy refused the command" },
  ] },
  { name: "CommandAuditRecord", schema: CommandAuditRecordSchema, fixtures: [COMMAND_AUDIT] },
  { name: "GateResultRecord", schema: GateResultRecordSchema, fixtures: [GATE_RESULT] },
  { name: "NotificationRecord", schema: NotificationRecordSchema, fixtures: [
    NOTIFICATION,
    { ...NOTIFICATION, notificationId: UUID_1, trigger: "verified-done", channel: "inbox", status: "read", snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" }, links: [{ kind: "failure", failureId: UUID_2, runId: UUID_3 }] },
    { ...NOTIFICATION, notificationId: UUID_2, links: [{ kind: "storage", diagnosticFingerprint: HASH_B }] },
  ] },
  { name: "SubjectEvidence", schema: SubjectEvidenceSchema, fixtures: [
    SUBJECT_EVIDENCE,
    { kind: "artifact", artifactId: UUID_1, bindingDigest: HASH_A },
    { kind: "catalog", catalogKey: "annual-dates", bindingDigest: HASH_A },
  ] },
  { name: "SubjectProof", schema: SubjectProofSchema, fixtures: [SUBJECT_PROOF] },
  { name: "WriteBindingProof", schema: WriteBindingProofSchema, fixtures: [SUBJECT_PROOF, UNSCOPED_PROOF] },
  { name: "RecoveryProbeVerdict", schema: RecoveryProbeVerdictSchema, fixtures: [
    { state: "present", proof: PRESENT_PROOF_REFERENCE },
    { state: "absent", evidence: ABSENCE_1 },
    { state: "ambiguous", matches: 2, observedAt: ABSENCE_1.observedAt, queryDigest: HASH_A, evidence: [`observation:${UUID_1}`, `observation:${UUID_2}`] },
    { state: "unknown", reason: "probe timed out", observedAt: ABSENCE_1.observedAt },
  ] },
  { name: "NegativeSettlementPolicy", schema: NegativeSettlementPolicySchema, fixtures: [STABILIZED_POLICY, { kind: "operator-only", reason: "no trustworthy negative read" }] },
  { name: "NegativeSettlementEvaluationInput", schema: NegativeSettlementEvaluationInputSchema, fixtures: [NEGATIVE_EVALUATION] },
  { name: "NegativeSettlementDecision", schema: NegativeSettlementDecisionSchema, fixtures: [
    SAFE_SETTLEMENT,
    { state: "wait", writeIntentId: UUID_1, generation: 1, decidedAt: NOW, notBefore: ABSENCE_1.observedAt, observationsNeeded: 1 },
    { state: "parked", writeIntentId: UUID_1, generation: 1, decidedAt: NOW, code: "unknown", reason: "probe timed out" },
  ] },
  { name: "WriteIntentRecord", schema: WriteIntentRecordSchema, fixtures: WRITE_INTENT_FIXTURES },
  { name: "WriteAttemptRecord", schema: WriteAttemptRecordSchema, fixtures: WRITE_ATTEMPT_FIXTURES },
  { name: "TransactionOutcome", schema: TransactionOutcomeSchema, fixtures: [
    COMMITTED_OUTCOME,
    { disposition: "already-present", proofSource: "live-probe", proof: COMMITTED_OUTCOME.proof, output: COMMITTED_OUTCOME.output, observedAt: ABSENCE_1.observedAt },
  ], openFixturePaths: ["output.value"] },
  { name: "LedgerEntryPayload", schema: LedgerEntryPayloadSchema, fixtures: [
    LEDGER_PAYLOAD,
    { ...LEDGER_PAYLOAD, subject: { state: "absent" }, externalOccurredAt: { state: "present", value: ABSENCE_1.observedAt } },
  ] },
  { name: "LedgerEntry", schema: LedgerEntrySchema, fixtures: [LEDGER_ENTRY] },
  { name: "WriteCommittedSpanOutboxPayload", schema: WriteCommittedSpanOutboxPayloadSchema, fixtures: [SPAN_OUTBOX_PAYLOAD], openFixturePaths: ["outcome.output.value"] },
  { name: "WriteFenceInput", schema: WriteFenceInputSchema, fixtures: [{ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT, claim: { workerId: "fixture-worker", claimGeneration: 1 } }] },
  { name: "PermanentWriteResolution", schema: PermanentWriteResolutionSchema, fixtures: [
    { state: "refused", refusal: { reason: "lost" } },
    { state: "refused", refusal: { reason: "invalid-state" } },
    { state: "fenced", intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT },
    { state: "recorded-observed-present", intent: WRITE_INTENT_FIXTURES[0] },
    { state: "existing", intent: WRITE_INTENT_FIXTURES[2] },
  ] },
  { name: "AtomicWriteCommitInput", schema: AtomicWriteCommitInputSchema, fixtures: [currentAtomicWriteFixture(ATOMIC_WRITE_COMMIT)], openFixturePaths: ["outcome.output.value", "committedSpan.outcome.output.value"] },
  { name: "AtomicWriteCommitReport", schema: AtomicWriteCommitReportSchema, fixtures: [{
    state: "committed",
    intent: {
      ...WRITE_INTENT_ATTEMPTING,
      status: "committed",
      completionProof: LEDGER_PAYLOAD.proof,
      confirmedAt: LEDGER_OUTBOX_RECORD.createdAt,
    },
    attempt: {
      ...WRITE_ATTEMPT,
      outcome: {
        state: "committed",
        completionProof: LEDGER_PAYLOAD.proof,
        confirmedAt: LEDGER_OUTBOX_RECORD.createdAt,
      },
      recordedAt: LEDGER_OUTBOX_RECORD.createdAt,
    },
    transaction: LEDGER_OUTBOX_RECORD.payload.entry,
    committedSpan: SPAN_OUTBOX_RECORD.payload,
  }], openFixturePaths: ["committedSpan.outcome.output.value"] },
  { name: "RunCompletion", schema: RunCompletionSchema, fixtures: [FAILED_RUN.completion, DONE_RUN.completion] },
  { name: "TerminalAuthorizationRecord", schema: TerminalAuthorizationRecordSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION, SUCCESS_TERMINAL_AUTHORIZATION] },
  { name: "FailureTerminalizationRequest", schema: FailureTerminalizationRequestSchema, fixtures: [{
    failure: FAILURE,
    authorization: FAILURE_TERMINAL_AUTHORIZATION,
  }] },
  { name: "FailureTerminalizationReport", schema: FailureTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN, result: FAILED_RESULT },
    { state: "replayed", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN, result: FAILED_RESULT },
  ], openFixturePaths: ["run.input.raw", "run.input.parsed.value"] },
  { name: "SuccessTerminalizationRequest", schema: SuccessTerminalizationRequestSchema, fixtures: [{
    result: RUN_RESULT,
    authorization: SUCCESS_TERMINAL_AUTHORIZATION,
  }], openFixturePaths: ["result.result.value"] },
  { name: "SuccessTerminalizationReport", schema: SuccessTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, run: DONE_RUN },
    { state: "replayed", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, run: DONE_RUN },
  ], openFixturePaths: ["result.result.value", "run.input.raw", "run.input.parsed.value"] },
  { name: "BoundaryFailure", schema: BoundaryFailureSchema, fixtures: [{ kind: "boundary-failure", source: "config", summary: "invalid config", issues: [{ path: ["urls"], code: "invalid", message: "invalid URL" }] }] },
  { name: "ClassifiedDiagnosticValue", schema: ClassifiedDiagnosticValueSchema, fixtures: [{ key: "state", classification: "safe-diagnostic", transform: "allow", value: "healthy" }] },
  { name: "RedactionResult", schema: RedactionResultSchema, fixtures: [{ fields: [], warnings: [] }] },
  { name: "PreflightObservation", schema: PreflightObservationSchema, fixtures: [preflightObservations[0]] },
  { name: "PreflightResult", schema: PreflightResultSchema, fixtures: [PREFLIGHT_REPORT.results[0]] },
  { name: "PreflightReport", schema: PreflightReportSchema, fixtures: [PREFLIGHT_REPORT] },
  { name: "RuntimeEnvironmentRegistry", schema: RuntimeEnvironmentRegistrySchema, fixtures: [RUNTIME_ENVIRONMENT_REGISTRY] },
  { name: "RuntimeDependencyRegistry", schema: RuntimeDependencyRegistrySchema, fixtures: [RUNTIME_DEPENDENCY_REGISTRY] },
  { name: "FreshnessPolicy", schema: FreshnessPolicySchema, fixtures: [{ defaultMaxAgeMs: 0, byField: [{ path: "eid", maxAgeMs: 0 }] }] },
  { name: "DataPoint", schema: DataPointSchema, fixtures: [{ direction: "read", field: "record", value: { eid: "10873698" } }], openFixturePaths: ["value"] },
  { name: "RecordedDataPoint", schema: RecordedDataPointSchema, fixtures: [{ direction: "read", field: "record", value: { eid: "10873698" }, execution: { runId: UUID_1, traceId: "pl-120000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: "ucpath/search-person-org" }, recordedAt: NOW }], openFixturePaths: ["value"] },
  { name: "TaskProvenanceResult", schema: TaskProvenanceResultSchema, fixtures: [{ points: [{ direction: "read", field: "record", value: { eid: "10873698" }, execution: { runId: UUID_1, traceId: "pl-120000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: "ucpath/search-person-org" }, recordedAt: NOW }], provenance: [{ path: "record.eid", source: "live", observedAt: NOW, originalObservedAt: NOW }] }], openFixturePaths: ["points.0.value"] },
  { name: "TaskUpstreamCheckpointEvidence", schema: TaskUpstreamCheckpointEvidenceSchema, fixtures: [{ checkpoints: [RUN_CHECKPOINT] }], openFixturePaths: ["checkpoints.0.output.value"] },
  { name: "SubjectBindingSpec", schema: SubjectBindingSpecSchema, fixtures: [
    { kind: "none", reason: "global read" },
    { kind: "person", expected: { fromInput: "eid", identity: "eid" }, observe: "ucpath.person-org.displayed-eid", match: "normalized-exact-eid", requiredAt: "before-subject-read" },
    { kind: "artifact", expected: { fromInput: "artifactId", identity: "artifact-id" }, observe: "onbase.import.staged-artifact", match: "exact", requiredAt: "after-prepare-before-fence" },
  ] },
  { name: "UiVerificationEvidenceManifest", schema: UiVerificationEvidenceManifestSchema, fixtures: [UI_EVIDENCE] },
  { name: "UiVerificationScenario", schema: UiVerificationScenarioSchema, fixtures: [...UCPATH_UI_REGISTRY.scenarios, ...CRM_UI_REGISTRY.scenarios] },
  { name: "CrmSubjectBinding", schema: CrmSubjectBindingSchema, fixtures: [CRM_SUBJECT_BINDING] },
  { name: "CrmOnboardingRecordRead", schema: CrmOnboardingRecordReadSchema, fixtures: [CRM_RECORD_READ] },
  { name: "CrmOnboardingDatesRead", schema: CrmOnboardingDatesReadSchema, fixtures: [CRM_DATES_READ] },
  { name: "SecretAvailability", schema: SecretAvailabilitySchema, fixtures: [{ name: "ucpathPassword", source: "protected-store", state: "unknown", diagnostic: "registered source could not be read" }] },
  { name: "TestTargetRegistry", schema: TestTargetRegistrySchema, fixtures: [TEST_TARGET_REGISTRY] },
  { name: "ScenarioManifest", schema: ScenarioManifestSchema, fixtures: [PREFLIGHT_SCENARIO_MANIFESTS[0]], openFixturePaths: ["input"] },
  { name: "DryRunScenarioResult", schema: DryRunScenarioResultSchema, fixtures: [
    {
      resultId: UUID_1,
      scenarioId: "separations-kuali-finalization/dry-run",
      workflow: "separations-kuali-finalization",
      subjectLabel: "finalization-canary",
      manifestDigest: HASH_A,
      verdict: "met",
      assertions: [{ assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" }],
      wallTimeMs: 12_345,
      recordedAt: NOW,
      execution: { state: "started", runId: UUID_2, traceId: "sep-120000-2222" },
    },
    {
      resultId: UUID_3,
      scenarioId: "separations-kuali-finalization/dry-run",
      workflow: "separations-kuali-finalization",
      subjectLabel: "finalization-canary",
      manifestDigest: HASH_A,
      verdict: "blocked",
      assertions: [{ assertionId: "subject-available", verdict: "blocked", reason: "subject-unavailable" }],
      wallTimeMs: 0,
      recordedAt: NOW,
      execution: { state: "not-started", reason: "subject-unavailable" },
    },
  ] },
  { name: "FailureRecord", schema: FailureRecordSchema, fixtures: [FAILURE] },
  { name: "DiagnosticBundle", schema: DiagnosticBundleSchema, fixtures: [{ bundleId: UUID_1, runId: UUID_2, origin: { kind: "operator-request", requestedBy: "local-operator" }, createdAt: NOW, contentDigest: HASH_A, configFingerprint: HASH_A, descriptorFingerprint: HASH_B, redaction: { fields: [], warnings: [] }, attachments: [], retention: { kind: "pinned", reason: "fix" } }] },
  { name: "EvidenceFact", schema: EvidenceFactSchema, fixtures: [EVIDENCE_FACT] },
  { name: "ActionEvidence", schema: ActionEvidenceSchema, fixtures: [ACTION_EVIDENCE] },
  { name: "RunEvidenceReceipt", schema: RunEvidenceReceiptSchema, fixtures: [RECEIPT] },
  { name: "FrontendBootstrap", schema: FrontendBootstrapWireSchema, fixtures: [BOOTSTRAP] },
  { name: "DiagnosticBundleWire", schema: DiagnosticBundleWireSchema, fixtures: [{ bundleId: UUID_1, capturedAt: NOW, byteSize: 0, contentDigest: HASH_A, redaction: { fields: [], warnings: [] }, contents: [] }] },
  { name: "DashboardDay", schema: DashboardDayWireSchema, fixtures: [DAY] },
  { name: "RunDetail", schema: RunDetailWireSchema, fixtures: [DETAIL] },
  { name: "RunDetailSectionResponse", schema: RunDetailSectionResponseSchema, fixtures: [{ section: "logs", payload: { runId: UUID_1, notes: [], nextCursor: { state: "absent", reason: "end-of-page" } } }] },
  { name: "ArtifactRef", schema: ArtifactRefWireSchema, fixtures: [ARTIFACT_REF] },
  { name: "CapturePointer", schema: CapturePointerWireSchema, fixtures: [{ artifactId: UUID_1, dimensions: { state: "missing", reason: "not captured" } }] },
  { name: "ArtifactResource", schema: ArtifactResourceWireSchema, fixtures: [ARTIFACT] },
  { name: "DashboardStreamEnvelope", schema: DashboardStreamEnvelopeSchema, fixtures: [{ type: "health", state: "live" }] },
];
