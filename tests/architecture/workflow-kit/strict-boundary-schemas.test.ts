import { RunRecordSchema } from "../../../src/models/run/record.js";
import { ExplorerOverrideImportReceiptSchema, ExplorerOverrideImportSourceSchema } from "../../../src/models/dashboard/explorer-override.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-authority-reason.js";
import { createRunTerminalEvidenceResult, deriveTerminalFailureDigest, RunTerminalEvidenceResultSchema } from "../../../src/models/run/result.js";
import { RunCompletionSchema, completionFromAuthorization } from "../../../src/models/run/completion.js";
import { currentAtomicWriteFixture } from "../../support/helpers/timeline-write-fixture.js";
import { CredentialStoreApplyOutcomeSchema } from "../../../src/models/config/credential-store.js";
import { initialProtectedStoreRecord } from "../../../src/models/config/protected-settings.js";
import { SettingsRecordSchema, initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import { SeparationsKualiFinalizationTestTargetResolutionSchema, TEST_TARGET_REGISTRY, TestTargetRegistrySchema } from "../../../src/backend/app/registries/test-target-registry.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityTableRegistrySchema, TableSpecSchema } from "../../../src/models/config/authority.js";
import { RebuildArtifactRootSchema } from "../../../src/models/config/define-runtime-isolation.js";
import { ArtifactPutMetadataSchema, ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { BoundaryFailureSchema } from "../../../src/models/failures/boundary-failure.js";
import { TerminalDependencyEvidenceSchema } from "../../../src/backend/runs/lifecycle/run-result.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { BulkRunCommandRequestSchema, COMMAND_FAMILY_REGISTRY, CommandAuditRecordSchema, CommandEnvelopeSchema, CommandFamilyRegistrySchema, CommandFamilySpecSchema, CommandRequestSchema, CommandResultSchema, CommandTargetReferenceSchema, GateCommandRequestSchema, IntakeCommandRequestSchema, NotificationCommandRequestSchema, RunCommandRequestSchema, SettingsCommandRequestSchema, StartCommandRequestSchema, WorkerBrowserCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { ResolvedConfigSchema, resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { defaultRuntimePaths } from "../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema, EditableSettingsOverrideSchema, ProviderInvocationSettingsSchema, ProviderInvocationConfigSchema, SettingsOverrideSchema } from "../../../src/models/config/schema.js";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { ArtifactRefWireSchema, ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../../src/models/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DiagnosticBundleWireSchema } from "../../../src/models/dashboard/diagnostic-bundle.js";
import { DashboardDayWireSchema } from "../../../src/models/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema, DashboardTopicPatchSchema, DashboardTopicSnapshotSchema } from "../../../src/models/dashboard/subscription.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../src/rules/workflow/dependencies.js";
import { GateResultRecordSchema } from "../../../src/models/workflow/gates.js";
import { LedgerEntryPayloadSchema, LedgerEntrySchema, LedgerOutboxPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../../src/rules/runs/ledger.js";
import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { AtomicOutboxPayloadSchema, AtomicOutboxRecordSchema } from "../../../src/models/notifications/outbox.js";
import { ProviderAdapterOutcomeSchema, ProviderUnavailableReasonSchema, ProviderExecutionIdentitySchema, ProviderEvidenceSchema, ProviderRequestEnvelopeSchema, ProviderResponseEnvelopeSchema } from "../../../src/models/providers/providers.js";
import { buildPreflightReport, PreflightObservationSchema, PreflightReportSchema, PreflightResultSchema, requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { ClassifiedDiagnosticValueSchema, RedactionResultSchema } from "../../../src/rules/redaction/redaction.js";
import { RUNTIME_DEPENDENCY_REGISTRY, RuntimeDependencyRegistrySchema } from "../../../src/models/runtime/runtime-dependencies.js";
import { RUNTIME_ENVIRONMENT_REGISTRY, RuntimeEnvironmentRegistrySchema } from "../../../src/models/runtime/runtime-environment.js";
import { SchemaBoundCanonicalValueSchema } from "../../../src/models/validation/schema-bound-value.js";
import { NotRunTerminalDependencySchema, ResolvedTerminalDependencySchema, RunResultRecordSchema, TerminalDependencyRecordSchema, TerminalNotRunReasonSchema, deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest, deriveRunResultDigest, deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";
import { FailureTerminalAuthorizationRecordSchema, SuccessTerminalAuthorizationRecordSchema, TerminalAuthorizationRecordSchema, TerminalizationClaimSchema } from "../../../src/models/run/terminal-authorization.js";

import { DataPointSchema, RecordedDataPointSchema, TaskExecutionIdentitySchema, TaskProvenanceResultSchema, TaskUpstreamCheckpointEvidenceSchema } from "../../../src/rules/workflow/task-provenance.js";
import { GraphCoveragePointSchema, ScenarioCoverageClaimSchema } from "../../../src/workflow-kit/validation/scenario-coverage.js";
import { ApproveContextSchema, ApprovedDocumentSchema, CompletionConsumptionSpecSchema, CompletionProgramSampleSchema, ExtractedFieldSchema, MemberPlanEntrySchema, PreviewRecordSchema } from "../../../src/models/workflow/completion.js";
import { FileAcceptSpecSchema, InputParserSpecSchema, ParsedInputEntrySchema, SurfaceFieldSchema, TextTemplateSchema, UploadFieldSpecSchema, UploadedFileSchema, WorkflowSurfacesSchema } from "../../../src/models/workflow/ingress.js";
import { ResultTitleProjectionSchema, DetailProjectionSpecRuntimeSchema, DurableArtifactProjectionSpecRuntimeSchema, GateProjectionDefinitionSchema, StepProjectionSchema, SurfaceShapeSchema, VerdictDefinitionSchema, WorkflowActionPolicySchema, WorkflowCapabilitiesSchema } from "../../../src/models/workflow/presentation.js";
import { BUILD_MANIFEST } from "../../../src/workflow-kit/validation/build-manifest.js";
import { BuildManifestSchema, SourceHashSchema } from "../../../src/models/workflow/build-manifest.js";
import { CheckpointExpectationSchema, CheckpointMissReasonSchema, FactProvenanceSchema, FreshnessOverrideSchema, RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ChildVisibilitySchema, DelegationManifestRefSchema, DelegationPolicySchema, GraphNodeKindSchema, ParallelBranchSpecSchema, childRunOutcomeSchema } from "../../../src/models/workflow/graph.js";
import { TimecardDateRangeSchema, TimecardMonthDaySchema, VisibleTimecardMonthDaysSchema } from "../../../src/rules/time/timecard-period.js";
import { IdleRefreshCadenceSchema, LoginResultSchema, RetryPolicySchema, SessionNeedSchema } from "../../../src/models/sessions/session.js";
import { FreshnessPolicySchema, ProvenancePolicySchema, SubjectBindingSpecSchema, TaskEffectSchema } from "../../../src/models/task/task-contract.js";
import { UiVerificationEvidenceManifestSchema, UiVerificationScenarioSchema } from "../../../src/models/ui/contracts.js";
import { CRM_ONBOARDING_DISPLAYED_EID, CrmOnboardingDatesReadSchema, CrmOnboardingRecordReadSchema, CrmSubjectBindingSchema } from "../../../src/models/ui/crm-onboarding.js";
import { ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE, ActivityPersonPseudonymSecretReferenceSchema, SECRET_FILE_SPECS, SECRET_SPECS, ProtectedSecretSourceSchema, SecretFileSpecSchema, SecretAvailabilitySchema, SecretSpecSchema } from "../../../src/models/config/secrets.js";
import { ActivityPersonPseudonymEvidenceSchema, ActivityPersonPseudonymGenerationBindingSchema } from "../../../src/models/trust/activity-person-pseudonym.js";

import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { ActionEvidenceSchema, DecisionEvidenceSchema, EvidenceFactSchema, ReuseEvidenceSchema, RunEvidenceReceiptSchema, UncertaintyEvidenceSchema, VerificationEvidenceSchema } from "../../../src/models/trust/evidence.js";
import { FailureRecordSchema } from "../../../src/models/trust/failure.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/models/trust/preflight-scenarios.js";
import { ScenarioManifestSchema } from "../../../src/models/trust/scenario.js";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
import { AbsentEvidenceSchema, IdempotencyKeySchema, NegativeSettlementDecisionSchema, NegativeSettlementEvaluationInputSchema, NegativeSettlementPolicySchema, PresentProofReferenceSchema, RecoveryProbeVerdictSchema, SubjectEvidenceSchema, SubjectProofSchema, TransactionOutcomeSchema, UNSCOPED_COMMIT_REASON_REGISTRY, UnscopedBindingProofSchema, UnscopedCommitReasonSpecSchema, WriteAttemptRecordSchema, WriteBindingProofSchema, WriteIntentRecordSchema } from "../../../src/rules/write-safety/write-safety.js";
import { ArtifactOutboxStorageRecordSchema, AtomicWriteCommitInputSchema, AtomicWriteCommitReportSchema, AtomicWriteCommitStorageStepSchema, AuthorityBackupManifestSchema, AuthorityBackupRequestSchema, AuthorityBackupRunReportSchema, AuthorityBackupServiceOptionsSchema, AuthorityBootReportSchema, AuthorityCopyInspectionSchema, AuthorityDatabaseOptionsSchema, AuthorityInvariantResultSchema, AuthorityMetaSchema, AuthorityPendingCountsSchema, AuthoritySchemaInspectionSchema, BackupHealthSchema, BackupVerificationSchema, ImmutableInsertDispositionSchema, OfflineRestoreOptionsSchema, OfflineRestoreReportSchema, OfflineRestoreRequestSchema, PermanentWriteResolutionSchema, RecoveryProcessLockStateSchema, RecoveryRuntimeLockSnapshotSchema, RecoveryStopProofStoreOptionsSchema, RestoreCandidateSchema, StoppedSystemProofSchema, StoppedSystemProofIssueRequestSchema, StorageDoctorOptionsSchema, StorageDoctorReportSchema, StorageHealthCauseSchema, WriteFenceInputSchema, FailureTerminalizationReportSchema, FailureTerminalizationRequestSchema, FailureTerminalizationStorageStepSchema, SuccessTerminalizationReportSchema, SuccessTerminalizationRequestSchema, SuccessTerminalizationStorageStepSchema } from "../../../src/backend/storage/sqlite/index.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { CRM_UI_REGISTRY } from "../../../src/backend/systems/crm/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "../../../src/backend/systems/ucpath/driver/ui-registry.js";
import { ABSENCE_1, ABSENCE_2, ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, COMMITTED_OUTCOME, CONFIG_SNAPSHOT, DELEGATION_MANIFEST, DEPENDENCY_RECORD, GATE_RESULT, IDEMPOTENCY_KEY, IDEMPOTENCY_KEY_DIGEST, LEDGER_OUTBOX_RECORD, LEDGER_OUTBOX_PAYLOAD, LEDGER_PAYLOAD, NOTIFICATION, SPAN_OUTBOX_PAYLOAD, SPAN_OUTBOX_RECORD, SUBJECT_EVIDENCE, SUBJECT_PROOF, UNSCOPED_PROOF, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";


import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";


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
const DECISION_EVIDENCE = {
  id: UUID_1,
  kind: "identity",
  outcome: "taken",
  reason: "the observed EID matched",
  evidence: [`observation:${UUID_2}`],
};
const ACTION_EVIDENCE = {
  id: UUID_1,
  taskId: "ucpath/search-person",
  kind: "external-read",
  writeState: "not-attempted",
  occurredAt: NOW,
};
const VERIFICATION_EVIDENCE = {
  id: UUID_1,
  obligation: "person.match",
  mandatory: true,
  verdict: "verified",
  evidence: [`observation:${UUID_2}`],
};
const REUSE_EVIDENCE = {
  id: UUID_1,
  kind: "checkpoint",
  source: `observation:${UUID_2}`,
  ageMs: 1_000,
  freshnessLimitMs: 60_000,
};
const UNCERTAINTY_EVIDENCE = {
  id: UUID_1,
  code: "OPTIONAL_FACT_MISSING",
  summary: "an optional note was absent",
  loadBearing: false,
  evidence: [],
};


const BOOTSTRAP = {
  wireVersion: 1, appVersion: "1.0.0", descriptorHash: HASH_A, settingsSchemaHash: HASH_B, protectedSchemaHash: HASH_A,
  projectionGeneration: 1, actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: NOW }, workflows: [],
  systemInstances: [], settingsSections: [], featureAvailability: [],
};
const DAY = {
  day: "2026-07-31", descriptorHash: HASH_A, projectionGeneration: 1, snapshotCursor: "pc:1",
  monthCounts: [], workflowCounts: [], statusCounts: [], queueSurfaces: [], workerCards: [], workerAuthority: { state: "present", members: [] }, workerOperations: [], workerPools: [], notifications: [],
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
const COMMAND_ENVELOPE = {
  commandId: UUID_1,
  requestedAt: NOW,
  requestedBy: "local-operator",
  source: "dashboard",
};
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
const BULK_RUN_COMMAND = {
  ...COMMAND_ENVELOPE,
  bulkCommandId: UUID_2,
  family: "run",
  type: "bump",
  targets: [{ runId: UUID_3, expectedVersion: 1 }],
  mode: "all-or-none",
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
const atomicOutbox = (payload: unknown) => ({
  outboxId: UUID_1,
  aggregate: { kind: "write-intent", writeIntentId: UUID_1, generation: 1 },
  payload,
  projection: { state: "pending" },
  createdAt: NOW,
});
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
  leases: 1,
  providerReservations: 1,
  artifactOutbox: 1,
};
const AUTHORITY_COPY_INSPECTION = {
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
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
  manifestVersion: 3,
  backupFileName: "authority-g4.sqlite",
  sourceDatabaseIdentity: HASH_B,
  applicationId: 1_217_249_861,
  schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
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
const STOPPED_SYSTEM_PROOF = {
  state: "stopped",
  proofId: UUID_1,
  observedAt: NOW,
  observedBy: "local-operator",
  sourceDatabaseIdentity: HASH_B,
  runtimeNamespace: "hrauto-rebuild",
  runtimeGeneration: 7,
  runtimeStateFingerprint: HASH_A,
  processLockGenerations: { server: 11, workers: 13, geocode: 17, "live-smoke": 19 },
};
const RECOVERY_RUNTIME_LOCK_SNAPSHOT = {
  schemaVersion: 1,
  runtimeNamespace: "hrauto-rebuild",
  runtimeGeneration: 7,
  sourceDatabaseIdentity: HASH_B,
  recordedAt: NOW,
  processLocks: {
    server: { state: "stopped", generation: 11 },
    workers: { state: "stopped", generation: 13 },
    geocode: { state: "stopped", generation: 17 },
    "live-smoke": { state: "stopped", generation: 19 },
  },
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
  spanAuthority: { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] },
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

interface BoundaryCatalogEntry {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly fixtures: readonly unknown[];
  /** Deliberately dynamic JSON payloads are data records, not typed decision records. */
  readonly openFixturePaths?: readonly string[];
}

const BOUNDARY_SCHEMA_CATALOG: readonly BoundaryCatalogEntry[] = [
  { name: "ExplorerOverrideImportSource", schema: ExplorerOverrideImportSourceSchema, fixtures: [
    { state: "absent" }, { state: "present", sha256: HASH_A, byteLength: 123, document: { documentVersion: 1, workflows: [{
      overrideVersion: 1, workflowId: "person-lookup", descriptorVersion: 1, contractFingerprint: HASH_B,
      revision: 1, appliedCommandId: UUID_1, commandFingerprint: HASH_A, presentation: { label: "People search" },
    }] } },
  ] },
  { name: "ExplorerOverrideImportReceipt", schema: ExplorerOverrideImportReceiptSchema, fixtures: [
    { format: 1, sourceDatabaseIdentity: HASH_A, backupSha256: "fresh", source: { state: "absent" } },
    { format: 1, sourceDatabaseIdentity: HASH_A, backupSha256: HASH_B, source: { state: "present", sha256: HASH_A, byteLength: 2, document: { documentVersion: 1, workflows: [] } } },
  ] },
  { name: "AuthorityTableSpec", schema: TableSpecSchema, fixtures: AUTHORITY_TABLE_REGISTRY },
  { name: "AuthorityTableRegistry", schema: AuthorityTableRegistrySchema, fixtures: [AUTHORITY_TABLE_REGISTRY] },
  { name: "AuthorityDatabaseOptions", schema: AuthorityDatabaseOptionsSchema, fixtures: [{ path: "/tmp/authority.sqlite", busyTimeoutMs: 250, migrationOwner: "unit-test" }] },
  { name: "AuthorityMeta", schema: AuthorityMetaSchema, fixtures: [{ schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityGeneration: 0, updatedAt: NOW }] },
  { name: "AuthoritySchemaInspection", schema: AuthoritySchemaInspectionSchema, fixtures: [SQLITE_SCHEMA_INSPECTION] },
  { name: "ActivityPersonPseudonymEvidence", schema: ActivityPersonPseudonymEvidenceSchema, fixtures: [{
    runId: UUID_2,
    workflowId: "separations",
    keyGeneration: "activity-person-g1",
    pseudonym: HASH_A,
    derivation: "hmac-sha-256/activity-person/v1",
  }] },
  {
    name: "ActivityPersonPseudonymGenerationBinding",
    schema: ActivityPersonPseudonymGenerationBindingSchema,
    fixtures: [{
      keyGeneration: "activity-person-g1",
      keyCommitment: HASH_A,
      derivation: "hmac-sha-256/activity-person-key-commitment/v1",
    }],
  },
  
  
  
  
  { name: "ActivityPersonPseudonymSecretReference", schema: ActivityPersonPseudonymSecretReferenceSchema, fixtures: [
    ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  ] },
  
  { name: "ImmutableInsertDisposition", schema: ImmutableInsertDispositionSchema, fixtures: ["inserted", "existing"] },
  
  
  
  
  
  // Raw submissions and canonical inputs are open JSON by contract, not unvalidated wire mirrors.
  
  
  { name: "ArtifactOutboxStorageRecord", schema: ArtifactOutboxStorageRecordSchema, fixtures: [SQLITE_ARTIFACT_OUTBOX], openFixturePaths: ["payload.value"] },
  
  { name: "AuthorityBackupServiceOptions", schema: AuthorityBackupServiceOptionsSchema, fixtures: [{ directory: "/tmp/backups" }] },
  { name: "StorageDoctorOptions", schema: StorageDoctorOptionsSchema, fixtures: [{ stateRootTrustAnchor: "/tmp", stateRoot: "/tmp/state", authorityPath: "/tmp/state.sqlite", backupDirectory: "/tmp/backups", maxBackupAgeMs: 60_000, busyTimeoutMs: 250 }] },
  { name: "OfflineRestoreOptions", schema: OfflineRestoreOptionsSchema, fixtures: [{ authorityPath: "/tmp/state.sqlite", suspectDirectory: "/tmp/suspects", busyTimeoutMs: 250, processLockRoot: "/tmp/rebuild-locks", stoppedProofMaxAgeMs: 60_000 }] },
  { name: "RecoveryStopProofStoreOptions", schema: RecoveryStopProofStoreOptionsSchema, fixtures: [{ processLockRoot: "/tmp/rebuild-locks", maxProofAgeMs: 60_000 }] },
  { name: "RecoveryProcessLockState", schema: RecoveryProcessLockStateSchema, fixtures: [{ state: "stopped", generation: 11 }, { state: "active", generation: 12, pid: 1234 }] },
  { name: "RecoveryRuntimeLockSnapshot", schema: RecoveryRuntimeLockSnapshotSchema, fixtures: [RECOVERY_RUNTIME_LOCK_SNAPSHOT] },
  { name: "StoppedSystemProofIssueRequest", schema: StoppedSystemProofIssueRequestSchema, fixtures: [{ observedBy: "local-operator", sourceDatabaseIdentity: HASH_B }] },
  { name: "AuthorityPendingCounts", schema: AuthorityPendingCountsSchema, fixtures: [AUTHORITY_PENDING_COUNTS] },
  { name: "AuthorityInvariantResult", schema: AuthorityInvariantResultSchema, fixtures: [{ state: "valid", violations: [] }] },
  { name: "AuthorityCopyInspection", schema: AuthorityCopyInspectionSchema, fixtures: [AUTHORITY_COPY_INSPECTION] },
  { name: "BackupVerification", schema: BackupVerificationSchema, fixtures: [BACKUP_VERIFICATION] },
  { name: "CredentialStoreApplyOutcome", schema: CredentialStoreApplyOutcomeSchema, fixtures: [{ state: "applied", record: initialProtectedStoreRecord() }] },
  { name: "SettingsRecord", schema: SettingsRecordSchema, fixtures: [initialSettingsFileRecord()] },
  { name: "AuthorityBackupManifest", schema: AuthorityBackupManifestSchema, fixtures: [BACKUP_MANIFEST] },
  { name: "AuthorityBackupRequest", schema: AuthorityBackupRequestSchema, fixtures: [{ trigger: "operator", requiredGeneration: 4 }] },
  { name: "AuthorityBackupRunReport", schema: AuthorityBackupRunReportSchema, fixtures: [{ state: "verified", requestedGeneration: 4, finalGeneration: 4, coalescedRequests: 1, followUpPerformed: false, manifests: [BACKUP_MANIFEST] }] },
  { name: "StorageHealthCause", schema: StorageHealthCauseSchema, fixtures: [HEALTH_CAUSE] },
  { name: "AuthorityBootReport", schema: AuthorityBootReportSchema, fixtures: [
    { state: "healthy", checkedAt: NOW, mutationAvailability: "available", inspection: AUTHORITY_COPY_INSPECTION },
    { state: "degraded-read-only", checkedAt: NOW, mutationAvailability: "blocked", cause: HEALTH_CAUSE },
  ] },
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
  { name: "StoppedSystemProof", schema: StoppedSystemProofSchema, fixtures: [STOPPED_SYSTEM_PROOF] },
  { name: "OfflineRestoreRequest", schema: OfflineRestoreRequestSchema, fixtures: [{ manifestPath: "/tmp/authority.manifest.json", stoppedSystemProof: STOPPED_SYSTEM_PROOF }] },
  { name: "OfflineRestoreReport", schema: OfflineRestoreReportSchema, fixtures: [{ state: "restored", schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, restoredAt: NOW, manifestFileName: "authority-g4.sqlite.manifest.json", backupFileName: "authority-g4.sqlite", suspectFileName: "suspect-state.sqlite", sourceDatabaseIdentity: HASH_B, authorityGeneration: 4, projectionRebuilt: true, authorityPreservedAcrossProjectionRebuild: true }] },
  { name: "SchemaBoundCanonicalValue", schema: SchemaBoundCanonicalValueSchema, fixtures: [{ schemaHash: HASH_A, value: "approved" }] },
  { name: "RebuildArtifactRoot", schema: RebuildArtifactRootSchema, fixtures: [".tracker/data/artifacts"] },
  { name: "ContentAddressedArtifactRef", schema: ArtifactRefSchema, fixtures: [{ id: UUID_1, sha256: HASH_A, bytes: 7, mediaType: "text/plain" }] },
  { name: "ArtifactPutMetadata", schema: ArtifactPutMetadataSchema, fixtures: [{ mediaType: "application/pdf" }] },
  { name: "SessionNeed", schema: SessionNeedSchema, fixtures: [
    { system: "ucpath", access: "read", session: "reuse-worker" },
    { system: "onbase", access: "transaction", session: "fresh", exclusive: true, acceptDownloads: true },
  ] },
  { name: "GraphCoveragePoint", schema: GraphCoveragePointSchema, fixtures: [
    { id: "branch-case:mode-branch/write", kind: "branch-case", nodeId: "mode-branch", detail: "branch mode-branch selects \"write\"" },
  ] },
  { name: "ScenarioCoverageClaim", schema: ScenarioCoverageClaimSchema, fixtures: [
    { scenarioId: "workflow/person-lookup-write-arm", covers: ["branch-case:mode-branch/write"] },
  ] },
  { name: "ExtractedField", schema: ExtractedFieldSchema, fixtures: [
    { key: "employee-id", value: { state: "present", text: "10873698" } },
    { key: "signature", value: { state: "absent" } },
  ] },
  { name: "PreviewRecord", schema: PreviewRecordSchema, fixtures: [PREVIEW_RECORD] },
  { name: "ApproveContext", schema: ApproveContextSchema, fixtures: [APPROVE_CONTEXT] },
  { name: "ApprovedDocument", schema: ApprovedDocumentSchema, fixtures: [{
    sourceArtifactId: UUID_1, intakeSessionId: UUID_2, context: APPROVE_CONTEXT, perRecordItemIds: [UUID_3],
  }] },
  { name: "MemberPlanEntry", schema: MemberPlanEntrySchema, fixtures: [
    { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "eid", emplId: "10873698" } },
    { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "name", name: "Battistessa, Johnnie" } },
  ] },
  { name: "CompletionProgramSample", schema: CompletionProgramSampleSchema, fixtures: [
    { mode: "staged-fanout", record: PREVIEW_RECORD, context: APPROVE_CONTEXT, document: { sourceArtifactId: UUID_1, intakeSessionId: UUID_2, context: APPROVE_CONTEXT } },
    { mode: "complete-then-enqueue", plan: { recordId: STABLE_RECORD_ID, itemId: UUID_1, parentRunId: UUID_2, delegatedRunId: UUID_3, sourceArtifactId: UUID_1, subject: { kind: "eid", emplId: "10873698" } } },
  ] },
  { name: "CompletionConsumptionSpec", schema: CompletionConsumptionSpecSchema, fixtures: [
    { memberShape: "operation-member" },
    { memberShape: "natural", suppress: ["document"] },
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
  { name: "FileAcceptSpec", schema: FileAcceptSpecSchema, fixtures: [
    { mediaType: "application/pdf", extensions: [".pdf"], maxBytes: 10_000_000 },
  ] },
  { name: "UploadedFile", schema: UploadedFileSchema, fixtures: [
    { fileName: "packet.pdf", mediaType: "application/pdf", byteLength: 2048 },
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
  { name: "VerdictDefinition", schema: VerdictDefinitionSchema, fixtures: [
    { key: "not-found", label: "Not found", tone: "warning" },
    { key: "inactive", label: "Inactive", tone: "warning", tag: true },
  ] },
  { name: "WorkflowActionPolicy", schema: WorkflowActionPolicySchema, fixtures: [
    { enabled: ["retry", "cancel"] },
    { enabled: ["retry", "open-review"], conditions: [{ action: "open-review", requires: "has-review-panel" }] },
  ] },
  { name: "WorkflowCapabilities", schema: WorkflowCapabilitiesSchema, fixtures: [
    { review: false, editData: true },
    { review: true, editData: true, delegationDisplay: "inline" },
  ] },
  { name: "ResultTitleProjection", schema: ResultTitleProjectionSchema, fixtures: [
    { fieldPath: "activeStatus.details.name", display: "person-name", protectedInput: "eid" },
  ] },
  { name: "DetailProjectionSpecRuntime", schema: DetailProjectionSpecRuntimeSchema, fixtures: [
    { key: "result-name", label: "Name", source: { kind: "result", fieldPath: "activeStatus.details.name" }, display: "text", when: { source: { kind: "input", fieldPath: "mode" }, equals: "match" } },
    { key: "search", label: "Search", source: { kind: "input-title" }, display: "text" },
    { key: "resolved-eid", label: "EID", source: { nodeId: "searching", fieldPath: "selection.selected" }, display: "eid" },
  ] },
  { name: "DurableArtifactProjectionSpecRuntime", schema: DurableArtifactProjectionSpecRuntimeSchema, fixtures: [
    { id: "retention-row", source: { nodeId: "searching", fieldPath: "selection" }, keyFields: ["selection"], sink: "xlsx-retention", blocking: true },
  ] },
  { name: "StepProjection", schema: StepProjectionSchema, fixtures: [
    { key: "searching", nodeId: "searching", label: "Searching", kind: "task", taskId: "ucpath/search-person-org", conditional: false },
    { key: "submit/commit", nodeId: "submit", label: "Submit — commit", kind: "commit", taskId: "ucpath/submit-termination", conditional: false },
  ] },
  { name: "GateProjectionDefinition", schema: GateProjectionDefinitionSchema, fixtures: [
    { nodeId: "approval", label: "Approval", statusKey: "needsReview", resolvedBy: "operator" },
  ] },
  { name: "FactProvenance", schema: FactProvenanceSchema, fixtures: [
    { path: "selection.selected", source: "live", observedAt: NOW, originalObservedAt: NOW },
    { path: "selection.selected", source: "operator", observedAt: NOW, originalObservedAt: NOW, correctedAt: NOW, supersedes: NOW },
  ] },
  { name: "RunCheckpointRecord", schema: RunCheckpointRecordSchema, fixtures: [RUN_CHECKPOINT], openFixturePaths: ["output.value"] },
  { name: "TerminalNotRunReason", schema: TerminalNotRunReasonSchema, fixtures: TerminalNotRunReasonSchema.options },
  { name: "ResolvedTerminalDependency", schema: ResolvedTerminalDependencySchema, fixtures: [RESOLVED_TERMINAL_DEPENDENCY] },
  { name: "NotRunTerminalDependency", schema: NotRunTerminalDependencySchema, fixtures: [NOT_RUN_TERMINAL_DEPENDENCY] },
  { name: "TerminalDependencyRecord", schema: TerminalDependencyRecordSchema, fixtures: [RESOLVED_TERMINAL_DEPENDENCY, NOT_RUN_TERMINAL_DEPENDENCY] },
  { name: "RunTerminalEvidenceResult", schema: RunTerminalEvidenceResultSchema, fixtures: [FAILED_RESULT.result.value, { kind: "lifecycle-evidence", outcome: "cancelled", commandId: UUID_1, auditId: UUID_1, requestFingerprint: HASH_A, appliedVersion: 2 }] },
  { name: "RunResultRecord", schema: RunResultRecordSchema, fixtures: [RUN_RESULT], openFixturePaths: ["result.value"] },
  
  { name: "TerminalDependencyEvidence", schema: TerminalDependencyEvidenceSchema, fixtures: [
    { state: "resolved", nodeId: RUN_CHECKPOINT.nodeId, checkpoint: RUN_CHECKPOINT },
    NOT_RUN_TERMINAL_DEPENDENCY,
  ], openFixturePaths: ["checkpoint.output.value"] },
  { name: "CheckpointExpectation", schema: CheckpointExpectationSchema, fixtures: [
    { descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B, outputSchemaHash: HASH_A },
  ] },
  { name: "CheckpointMissReason", schema: CheckpointMissReasonSchema, fixtures: CheckpointMissReasonSchema.options },
  { name: "FreshnessOverride", schema: FreshnessOverrideSchema, fixtures: [
    { nodeId: "searching", fieldPaths: ["selection.selected"], confirmedAt: NOW, reason: "confirmed with the operator", validForAttempt: 2 },
  ] },
  { name: "SourceHash", schema: SourceHashSchema, fixtures: [{ path: "src/rules/identity/ids.ts", sha256: HASH_A }] },
  { name: "BuildManifest", schema: BuildManifestSchema, fixtures: [BUILD_MANIFEST] },
  { name: "GraphNodeKind", schema: GraphNodeKindSchema, fixtures: ["task", "transaction", "branch", "parallel", "child-run", "gate"] },
  { name: "ChildVisibility", schema: ChildVisibilitySchema, fixtures: ["inline", "linked", "hidden-unless-failed"] },
  { name: "ParallelBranchSpec", schema: ParallelBranchSpecSchema, fixtures: [{ id: "org", nodes: ["search-person"] }] },
  { name: "DelegationPolicy", schema: DelegationPolicySchema, fixtures: [{
    onChildFailed: "fail-parent", cascadeCancel: "cascade",
    afterChildRetry: "resume-parent", visibility: "inline",
  }] },
  { name: "DelegationManifestRef", schema: DelegationManifestRefSchema, fixtures: [
    { manifestId: UUID_1, edgeId: "sign-many", childCount: 3 },
  ] },
  { name: "ChildRunOutcome", schema: childRunOutcomeSchema(z.strictObject({ verified: z.boolean() })), fixtures: [
    { state: "done", runId: UUID_1, itemId: UUID_2, output: { verified: true } },
    { state: "failed", runId: UUID_1, itemId: UUID_2, failureId: UUID_3 },
    { state: "cancelled", runId: UUID_1, itemId: UUID_2, reason: "operator cancelled", cancelledBy: "operator" },
    { state: "blocked", runId: UUID_1, itemId: UUID_2, failureId: UUID_3, reason: "dependency failed" },
  ] },
  { name: "TimecardMonthDay", schema: TimecardMonthDaySchema, fixtures: [{ month: 12, day: 30 }] },
  { name: "VisibleTimecardMonthDays", schema: VisibleTimecardMonthDaysSchema, fixtures: [
    { first: { month: 12, day: 16 }, last: { month: 1, day: 15 } },
  ] },
  { name: "TimecardDateRange", schema: TimecardDateRangeSchema, fixtures: [
    { start: new Date(2025, 11, 16), end: new Date(2026, 0, 15) },
  ] },
  { name: "LoginResult", schema: LoginResultSchema, fixtures: ["logged-in", "already-authenticated"] },
  { name: "IdleRefreshCadence", schema: IdleRefreshCadenceSchema, fixtures: [{ intervalMs: 30_000 }] },
  { name: "RetryPolicy", schema: RetryPolicySchema, fixtures: [{ attempts: 2, backoffMs: 500, retryOn: "transient" }] },
  { name: "ProviderInvocationConfig", schema: ProviderInvocationConfigSchema, fixtures: [{ timeoutMs: 15_000 }] },
  { name: "ProviderInvocationSettings", schema: ProviderInvocationSettingsSchema.unwrap(), fixtures: [{ geocodeCensus: { timeoutMs: 15_000 }, geocodeNominatim: { timeoutMs: 15_000 } }] },
  { name: "ProviderUnavailableReason", schema: ProviderUnavailableReasonSchema, fixtures: [{ code: "aborted", message: "cancelled" }] },
  { name: "ProviderExecutionIdentity", schema: ProviderExecutionIdentitySchema, fixtures: [{ runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" }] },
  { name: "ProviderEvidence", schema: ProviderEvidenceSchema, fixtures: [{ summary: "synthetic", capturedAt: NOW }] },
  { name: "ProviderRequestEnvelope", schema: ProviderRequestEnvelopeSchema, fixtures: [{ capability: "geocode.census", payload: { schemaHash: HASH_A, value: {} } }], openFixturePaths: ["payload.value"] },
  { name: "ProviderResponseEnvelope", schema: ProviderResponseEnvelopeSchema, fixtures: [{ state: "unavailable", reason: { code: "adapter-unavailable", message: "not connected" } }] },
  { name: "ProviderAdapterOutcome", schema: ProviderAdapterOutcomeSchema, fixtures: [{ response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "not connected" } }, evidence: { summary: "synthetic", capturedAt: NOW } }] },
  { name: "CommandEnvelope", schema: CommandEnvelopeSchema, fixtures: [COMMAND_ENVELOPE] },
  { name: "StartCommandRequest", schema: StartCommandRequestSchema, fixtures: commandFixtures("start") },
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
  { name: "BulkRunCommandRequest", schema: BulkRunCommandRequestSchema, fixtures: [BULK_RUN_COMMAND] },
  { name: "CommandFamilySpec", schema: CommandFamilySpecSchema, fixtures: COMMAND_FAMILY_REGISTRY },
  { name: "CommandFamilyRegistry", schema: CommandFamilyRegistrySchema, fixtures: [COMMAND_FAMILY_REGISTRY] },
  { name: "DependencyRecord", schema: DependencyRecordSchema, fixtures: [DEPENDENCY_RECORD] },
  { name: "DelegationManifest", schema: DelegationManifestSchema, fixtures: [DELEGATION_MANIFEST] },
  { name: "GateResultRecord", schema: GateResultRecordSchema, fixtures: [GATE_RESULT] },
  { name: "NotificationRecord", schema: NotificationRecordSchema, fixtures: [
    NOTIFICATION,
    { ...NOTIFICATION, notificationId: UUID_1, trigger: "verified-done", channel: "inbox", status: "read", snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" }, links: [{ kind: "failure", failureId: UUID_2, runId: UUID_3 }] },
    { ...NOTIFICATION, notificationId: UUID_2, links: [{ kind: "storage", diagnosticFingerprint: HASH_B }] },
  ] },
  { name: "ConfigSnapshotRecord", schema: ConfigSnapshotRecordSchema, fixtures: [CONFIG_SNAPSHOT] },
  { name: "SubjectEvidence", schema: SubjectEvidenceSchema, fixtures: [
    SUBJECT_EVIDENCE,
    { kind: "artifact", artifactId: UUID_1, bindingDigest: HASH_A },
    { kind: "catalog", catalogKey: "annual-dates", bindingDigest: HASH_A },
  ] },
  { name: "SubjectProof", schema: SubjectProofSchema, fixtures: [SUBJECT_PROOF] },
  { name: "UnscopedCommitReasonSpec", schema: UnscopedCommitReasonSpecSchema, fixtures: UNSCOPED_COMMIT_REASON_REGISTRY },
  { name: "UnscopedBindingProof", schema: UnscopedBindingProofSchema, fixtures: [UNSCOPED_PROOF] },
  { name: "WriteBindingProof", schema: WriteBindingProofSchema, fixtures: [SUBJECT_PROOF, UNSCOPED_PROOF] },
  { name: "AbsentEvidence", schema: AbsentEvidenceSchema, fixtures: [ABSENCE_1, ABSENCE_2] },
  { name: "PresentProofReference", schema: PresentProofReferenceSchema, fixtures: [PRESENT_PROOF_REFERENCE] },
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
  { name: "IdempotencyKey", schema: IdempotencyKeySchema, fixtures: [IDEMPOTENCY_KEY] },
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
  { name: "LedgerOutboxPayload", schema: LedgerOutboxPayloadSchema, fixtures: [LEDGER_OUTBOX_PAYLOAD] },
  { name: "WriteCommittedSpanOutboxPayload", schema: WriteCommittedSpanOutboxPayloadSchema, fixtures: [SPAN_OUTBOX_PAYLOAD], openFixturePaths: ["outcome.output.value"] },
  { name: "AtomicOutboxPayload", schema: AtomicOutboxPayloadSchema, fixtures: [LEDGER_OUTBOX_PAYLOAD, SPAN_OUTBOX_PAYLOAD], openFixturePaths: ["outcome.output.value"] },
  { name: "AtomicOutboxRecord", schema: AtomicOutboxRecordSchema, fixtures: [
    atomicOutbox(LEDGER_OUTBOX_PAYLOAD),
    { ...atomicOutbox(SPAN_OUTBOX_PAYLOAD), projection: { state: "projected", projectedAt: ABSENCE_1.observedAt, projectionFingerprint: HASH_A } },
  ], openFixturePaths: ["payload.outcome.output.value"] },
  { name: "WriteFenceInput", schema: WriteFenceInputSchema, fixtures: [{ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT, claim: { workerId: "fixture-worker", claimGeneration: 1 } }] },
  { name: "PermanentWriteResolution", schema: PermanentWriteResolutionSchema, fixtures: [
    { state: "refused", refusal: { reason: "lost" } },
    { state: "refused", refusal: { reason: "invalid-state" } },
    { state: "fenced", intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT },
    { state: "recorded-observed-present", intent: WRITE_INTENT_FIXTURES[0] },
    { state: "existing", intent: WRITE_INTENT_FIXTURES[2] },
  ] },
  { name: "AtomicWriteCommitStorageStep", schema: AtomicWriteCommitStorageStepSchema, fixtures: AtomicWriteCommitStorageStepSchema.options },
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
  { name: "TerminalizationClaim", schema: TerminalizationClaimSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION.claim] },
  { name: "FailureTerminalAuthorizationRecord", schema: FailureTerminalAuthorizationRecordSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION] },
  { name: "SuccessTerminalAuthorizationRecord", schema: SuccessTerminalAuthorizationRecordSchema, fixtures: [SUCCESS_TERMINAL_AUTHORIZATION] },
  { name: "TerminalAuthorizationRecord", schema: TerminalAuthorizationRecordSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION, SUCCESS_TERMINAL_AUTHORIZATION] },
  { name: "FailureTerminalizationRequest", schema: FailureTerminalizationRequestSchema, fixtures: [{
    failure: FAILURE,
    authorization: FAILURE_TERMINAL_AUTHORIZATION,
  }] },
  { name: "FailureTerminalizationReport", schema: FailureTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN, result: FAILED_RESULT },
    { state: "replayed", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN, result: FAILED_RESULT },
  ], openFixturePaths: ["run.input.raw", "run.input.parsed.value"] },
  { name: "FailureTerminalizationStorageStep", schema: FailureTerminalizationStorageStepSchema, fixtures: FailureTerminalizationStorageStepSchema.options },
  { name: "SuccessTerminalizationRequest", schema: SuccessTerminalizationRequestSchema, fixtures: [{
    result: RUN_RESULT,
    authorization: SUCCESS_TERMINAL_AUTHORIZATION,
  }], openFixturePaths: ["result.result.value"] },
  { name: "SuccessTerminalizationReport", schema: SuccessTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, run: DONE_RUN },
    { state: "replayed", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, run: DONE_RUN },
  ], openFixturePaths: ["result.result.value", "run.input.raw", "run.input.parsed.value"] },
  { name: "SuccessTerminalizationStorageStep", schema: SuccessTerminalizationStorageStepSchema, fixtures: SuccessTerminalizationStorageStepSchema.options },
  { name: "BoundaryFailure", schema: BoundaryFailureSchema, fixtures: [{ kind: "boundary-failure", source: "config", summary: "invalid config", issues: [{ path: ["urls"], code: "invalid", message: "invalid URL" }] }] },
  { name: "Config", schema: ConfigSchema, fixtures: [ConfigSchema.parse({ paths: defaultRuntimePaths() })] },
  { name: "SettingsOverride", schema: SettingsOverrideSchema, fixtures: [{}] },
  { name: "EditableSettingsOverride", schema: EditableSettingsOverrideSchema, fixtures: [{}] },
  { name: "ResolvedConfig", schema: ResolvedConfigSchema, fixtures: [resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK)] },
  { name: "ClassifiedDiagnosticValue", schema: ClassifiedDiagnosticValueSchema, fixtures: [{ key: "state", classification: "safe-diagnostic", transform: "allow", value: "healthy" }] },
  { name: "RedactionResult", schema: RedactionResultSchema, fixtures: [{ fields: [], warnings: [] }] },
  { name: "PreflightObservation", schema: PreflightObservationSchema, fixtures: [preflightObservations[0]] },
  { name: "PreflightResult", schema: PreflightResultSchema, fixtures: [PREFLIGHT_REPORT.results[0]] },
  { name: "PreflightReport", schema: PreflightReportSchema, fixtures: [PREFLIGHT_REPORT] },
  { name: "RuntimeEnvironmentRegistry", schema: RuntimeEnvironmentRegistrySchema, fixtures: [RUNTIME_ENVIRONMENT_REGISTRY] },
  { name: "RuntimeDependencyRegistry", schema: RuntimeDependencyRegistrySchema, fixtures: [RUNTIME_DEPENDENCY_REGISTRY] },
  { name: "TaskEffect", schema: TaskEffectSchema, fixtures: ["read", "prepare", "commit"] },
  { name: "FreshnessPolicy", schema: FreshnessPolicySchema, fixtures: [{ defaultMaxAgeMs: 0, byField: [{ path: "eid", maxAgeMs: 0 }] }] },
  { name: "ProvenancePolicy", schema: ProvenancePolicySchema, fixtures: [{ default: "live", byField: [{ path: "eid", source: "live" }] }] },
  { name: "DataPoint", schema: DataPointSchema, fixtures: [{ direction: "read", field: "record", value: { eid: "10873698" } }], openFixturePaths: ["value"] },
  { name: "TaskExecutionIdentity", schema: TaskExecutionIdentitySchema, fixtures: [{ runId: UUID_1, traceId: "pl-120000-aaaa", attempt: 1, workflowId: "person-lookup", nodeId: "searching", taskId: "ucpath/search-person-org" }] },
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
  { name: "SecretSpec", schema: SecretSpecSchema, fixtures: [SECRET_SPECS[0]] },
  { name: "SecretFileSpec", schema: SecretFileSpecSchema, fixtures: [SECRET_FILE_SPECS[0]] },
  { name: "SecretAvailability", schema: SecretAvailabilitySchema, fixtures: [{ name: "ucpathPassword", source: "protected-store", state: "unknown", diagnostic: "registered source could not be read" }] },
  { name: "ProtectedSecretSource", schema: ProtectedSecretSourceSchema, fixtures: [{ read: () => ({}) }] },
  { name: "TestTargetRegistry", schema: TestTargetRegistrySchema, fixtures: [TEST_TARGET_REGISTRY] },
  { name: "SeparationsKualiFinalizationTestTargetResolution", schema: SeparationsKualiFinalizationTestTargetResolutionSchema, fixtures: [{ state: "blocked", label: "finalization-canary", reason: "blocked: needs finalization-canary" }] },
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
  { name: "DecisionEvidence", schema: DecisionEvidenceSchema, fixtures: [DECISION_EVIDENCE] },
  { name: "ActionEvidence", schema: ActionEvidenceSchema, fixtures: [ACTION_EVIDENCE] },
  { name: "VerificationEvidence", schema: VerificationEvidenceSchema, fixtures: [VERIFICATION_EVIDENCE] },
  { name: "ReuseEvidence", schema: ReuseEvidenceSchema, fixtures: [REUSE_EVIDENCE] },
  { name: "UncertaintyEvidence", schema: UncertaintyEvidenceSchema, fixtures: [UNCERTAINTY_EVIDENCE] },
  { name: "RunEvidenceReceipt", schema: RunEvidenceReceiptSchema, fixtures: [RECEIPT] },
  { name: "FrontendBootstrap", schema: FrontendBootstrapWireSchema, fixtures: [BOOTSTRAP] },
  { name: "DiagnosticBundleWire", schema: DiagnosticBundleWireSchema, fixtures: [{ bundleId: UUID_1, capturedAt: NOW, byteSize: 0, contentDigest: HASH_A, redaction: { fields: [], warnings: [] }, contents: [] }] },
  { name: "DashboardDay", schema: DashboardDayWireSchema, fixtures: [DAY] },
  { name: "RunDetail", schema: RunDetailWireSchema, fixtures: [DETAIL] },
  { name: "RunDetailSectionResponse", schema: RunDetailSectionResponseSchema, fixtures: [{ section: "logs", payload: { runId: UUID_1, notes: [], nextCursor: { state: "absent", reason: "end-of-page" } } }] },
  { name: "ArtifactRef", schema: ArtifactRefWireSchema, fixtures: [ARTIFACT_REF] },
  { name: "CapturePointer", schema: CapturePointerWireSchema, fixtures: [{ artifactId: UUID_1, dimensions: { state: "missing", reason: "not captured" } }] },
  { name: "ArtifactResource", schema: ArtifactResourceWireSchema, fixtures: [ARTIFACT] },
  { name: "DashboardTopicSnapshot", schema: DashboardTopicSnapshotSchema, fixtures: [{ topic: "artifact", payload: ARTIFACT }] },
  { name: "DashboardTopicPatch", schema: DashboardTopicPatchSchema, fixtures: [{ topic: "artifact", payload: { operation: "replace-artifact-resource", target: { artifactId: UUID_1 }, replacement: ARTIFACT } }] },
  { name: "DashboardStreamEnvelope", schema: DashboardStreamEnvelopeSchema, fixtures: [{ type: "health", state: "live" }] },
];

interface ZodInternals { readonly _zod: { readonly def: Record<string, unknown> } }

function strictnessViolations(schema: z.ZodType, path = "$", seen = new Set<z.ZodType>()): readonly string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as ZodInternals)._zod.def;
  const type = def.type;
  if (type === "object") {
    const catchall = def.catchall as ZodInternals | undefined;
    const violations = catchall?._zod.def.type === "never" ? [] : [`${path}: object schema is not strict`];
    const shape = def.shape as Record<string, z.ZodType>;
    return [...violations, ...Object.entries(shape).flatMap(([key, child]) => strictnessViolations(child, `${path}.${key}`, seen))];
  }
  if (type === "union") return (def.options as z.ZodType[]).flatMap((child, index) => strictnessViolations(child, `${path}|${index}`, seen));
  if (type === "array") return strictnessViolations(def.element as z.ZodType, `${path}[]`, seen);
  if (type === "record") return [
    ...strictnessViolations(def.keyType as z.ZodType, `${path}{key}`, seen),
    ...strictnessViolations(def.valueType as z.ZodType, `${path}{value}`, seen),
  ];
  if (type === "lazy") return strictnessViolations((def.getter as () => z.ZodType)(), `${path}<lazy>`, seen);
  if (["optional", "nullable", "default", "readonly", "nonoptional", "catch"].includes(String(type))) {
    return strictnessViolations(def.innerType as z.ZodType, `${path}?`, seen);
  }
  if (type === "pipe") return [
    ...strictnessViolations(def.in as z.ZodType, `${path}<in>`, seen),
    ...strictnessViolations(def.out as z.ZodType, `${path}<out>`, seen),
  ];
  if (type === "intersection") return [
    ...strictnessViolations(def.left as z.ZodType, `${path}&left`, seen),
    ...strictnessViolations(def.right as z.ZodType, `${path}&right`, seen),
  ];
  if (type === "tuple") return [
    ...(def.items as z.ZodType[]).flatMap((child, index) => strictnessViolations(child, `${path}[${index}]`, seen)),
    ...(def.rest ? strictnessViolations(def.rest as z.ZodType, `${path}[...]`, seen) : []),
  ];
  return [];
}

type Segment = string | number;
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function objectPaths(value: unknown, path: readonly Segment[] = []): readonly (readonly Segment[])[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  if (!isObject(value)) return [];
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}
function addUnknown(value: unknown, target: readonly Segment[], depth = 0): unknown {
  if (depth === target.length) return { ...(value as Record<string, unknown>), unexpectedBoundaryKey: true };
  const segment = target[depth];
  if (typeof segment === "number") return (value as unknown[]).map((child, index) => index === segment ? addUnknown(child, target, depth + 1) : child);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) =>
    key === segment ? [key, addUnknown(child, target, depth + 1)] : [key, child]
  ));
}
function pathText(path: readonly Segment[]): string {
  return path.map(String).join(".");
}

const EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST = new Set([
  // These relocated pure modules expose in-process repository and schema-walk
  // shapes. Durable event and validation values retain their own schemas.
  "src/models/events/timeline.ts:TimelineRepository",
  "src/models/validation/contract-boundary.ts:ContractSchemaLeaf",
  "src/models/validation/proof-shape.ts:ProofShapeField",
  "src/models/validation/proof-shape.ts:ProofShape",
  "src/models/validation/rerun-values.ts:RerunMappingView",
  "src/models/validation/schema-path.ts:ResolvedSchemaPath",
  "src/models/validation/schema-path.ts:SchemaPathFailure",
  // In-process transaction/reader methods, not wire data. Their values and receipts are strict schemas.
  "src/models/dashboard/explorer-override.ts:ExplorerOverrideReader",
  "src/models/dashboard/explorer-override.ts:ExplorerOverrideRepository",
  // In-process credential authority port: methods consume and return schema-derived data.
  "src/models/config/credential-store.ts:CredentialStore",
  "src/backend/app/composition/runtime-composition.ts:RebuildRuntimeStart",
  // The dashboard composition seam handed to the CLI (1g): a process-lifetime
  // handle (port + stop), operational like RebuildRuntimeStart, not wire data.
  "src/backend/app/composition/runtime-composition.ts:RunningDashboard",
  // The injected subscription function and disposer remain in-process and cannot be schema-described.
  "src/backend/app/composition/runtime-composition.ts:RuntimeShutdownSignals",
  "src/rules/validation/canonical-json.ts:JsonObject",
  "src/rules/time/clock.ts:Clock",
  "src/rules/time/clock.ts:TestClock",
  // The id source is injected exactly like the clock, and for the same reason:
  // a value the caller cannot pin makes a durable record unassertable.
  "src/rules/identity/identifiers.ts:IdFactory",
  "src/models/preflight/preflight.ts:BuildPreflightReportInput",
  // The deadline scheduler is an injected process-timer surface: it carries
  // callbacks and cancellation functions, never durable or wire data.
  "src/models/preflight/preflight.ts:PreflightDeadlineHandle",
  "src/models/preflight/preflight.ts:PreflightDeadlineScheduler",
  "src/models/preflight/preflight.ts:PreflightRunner",
  // In-process admission capability consumes a strict retained preflight report.
  "src/rules/preflight/preflight-admission.ts:PreflightAdmission",
  "src/models/preflight/preflight.ts:PreflightRunnerContext",

  "src/models/workflow/node-condition.ts:NodeConditionOperandSpec",
  "src/models/workflow/node-condition.ts:NodeConditionSpec",
  "src/models/ui/driver.ts:MutationCapability",
  "src/models/ui/driver.ts:CommitCapableSystemDriver",
  "src/models/ui/driver.ts:SystemDriver",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgScreens",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgStates",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgFields",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgObservations",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgDriver",

  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrScreens",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrStates",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrObservations",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrTerminationDriver",

  "src/models/ui/ucpath-driver.ts:UcpathStoreDriver",
  "src/models/task/task-contract.ts:ReadTaskContract",
  "src/models/task/task-contract.ts:PrepareTaskContract",
  "src/models/task/task-contract.ts:CommitTaskContract",
  "src/models/task/task-contract.ts:SealedReadContract",
  "src/models/task/task-contract.ts:SealedPrepareContract",
  "src/models/task/task-contract.ts:SealedCommitContract",
  "src/models/task/task-contract.ts:AnyReadTaskContract",
  "src/models/task/task-contract.ts:AnyPrepareTaskContract",
  "src/models/task/task-contract.ts:AnyCommitTaskContract",
  "src/models/task/task-contract.ts:AnyTaskContract",
  "src/models/task/write-safety.ts:CanonicalJsonSchema",
  "src/models/task/write-safety.ts:ProbeVerdict",
  "src/models/task/write-safety.ts:ProofCheck",
  "src/models/task/write-safety.ts:ReceiptCheck",
  "src/models/task/write-safety.ts:SaveVerifyCheck",
  "src/models/task/write-safety.ts:UploadVerifyCheck",
  "src/models/task/write-safety.ts:CompletionCheck",
  "src/models/task/write-safety.ts:Idempotency",
  "src/models/task/write-safety.ts:WriteSafety",
  "src/rules/identity/ids.ts:LiteralTaskId",
  "src/models/sessions/session.ts:SessionNeed",
  // Graph bind, choose and resolve functions are generic in-process values; crossing data uses strict schemas.
  "src/models/workflow/operation-display.ts:OperationActionKind",
  "src/models/workflow/operation-display.ts:WorkflowCompositionActionKind",
  "src/models/workflow/operation-display.ts:LogicalSessionReference",
  "src/models/workflow/operation-display.ts:LogicalPageReference",
  "src/models/workflow/operation-display.ts:TaskOperationValueSlot",
  "src/models/workflow/operation-display.ts:TemplateVariable",
  "src/models/workflow/operation-display.ts:TemplateCondition",
  "src/models/workflow/operation-display.ts:OperationTemplateSegment",
  "src/models/workflow/operation-display.ts:OperationTemplate",
  "src/models/workflow/operation-display.ts:OperationTransformDeclaration",
  "src/models/workflow/operation-display.ts:OperationOutcomeCase",
  "src/models/workflow/operation-display.ts:TaskOperationAction",
  "src/models/workflow/operation-display.ts:TaskOperationDeclaration",
  "src/models/workflow/operation-display.ts:WorkflowValueReference",
  "src/models/workflow/operation-display.ts:WorkflowResultSourceBinding",
  "src/models/workflow/operation-display.ts:WorkflowDisplayTransformDeclaration",
  "src/models/workflow/operation-display.ts:WorkflowOutcomePredicate",
  "src/models/workflow/operation-display.ts:WorkflowOutcomeCase",
  "src/models/workflow/operation-display.ts:OperationInvocationDeclaration",
  "src/models/workflow/operation-display.ts:WorkflowOperationPresentationNode",
  "src/models/workflow/operation-display.ts:WorkflowOperationDisplayDeclaration",
  "src/models/workflow/operation-display.ts:WorkflowOperationContractProjection",
  "src/models/workflow/operation-display.ts:WorkflowOperationEntryProjection",
  "src/models/workflow/operation-display.ts:WorkflowOperationDisplayCompileInput",
  "src/models/workflow/operation-display.ts:LegacyWorkflowOperationDisplay",
  "src/models/workflow/operation-display.ts:CompleteWorkflowOperationDisplay",
  "src/models/workflow/operation-display.ts:WorkflowOperationDisplay",
  // In-process identity argument; requireWorkflowOperationDisplaySnapshot parses
  // both fields and compares them with the schema-validated durable snapshot.
  "src/models/workflow/operation-display-snapshot.ts:OperationDisplaySnapshotIdentity",
  "src/models/workflow/canonical-input.ts:CanonicalInputSchema",

  "src/models/config/test-data.ts:TestDataLocalInputEntry",
  "src/models/config/test-data.ts:TestDataInputSource",
  "src/models/workflow/graph.ts:ProofOf",
  "src/models/workflow/graph.ts:WorkflowRef",
  "src/models/workflow/graph.ts:AnyWorkflowRef",
  "src/models/workflow/graph.ts:RuntimeScope",
  "src/models/workflow/graph.ts:WorkflowGateSource",
  "src/models/workflow/graph.ts:ExternalGateSource",
  "src/models/workflow/graph.ts:GraphNodeBase",
  "src/models/workflow/graph.ts:TaskStepNode",
  "src/models/workflow/graph.ts:TypedTransactionOutcome",
  "src/models/workflow/graph.ts:TransactionNode",
  "src/models/workflow/graph.ts:BranchNode",
  "src/models/workflow/graph.ts:ParallelNode",
  "src/models/workflow/graph.ts:ChildRunOutcome",
  "src/models/workflow/graph.ts:ChildRunNode",
  "src/models/workflow/graph.ts:OperatorGateNode",
  "src/models/workflow/graph.ts:ChildrenGateNode",
  "src/models/workflow/graph.ts:ExternalGateNode",
  "src/models/workflow/graph.ts:AnyGateNode",
  "src/models/workflow/graph.ts:RuntimeFlowNode",
  // Fan-out plans are generic in-process values; their durable manifests are schema-bound.
  "src/models/workflow/delegation.ts:PlannedChild",
  "src/models/workflow/delegation.ts:DelegationPlan",
  "src/models/workflow/delegation.ts:DelegationFanOutRequest",
  "src/models/workflow/delegation.ts:DelegationJoin",
  // Completion programs carry in-process derivation functions; crossing values remain schema-bound.
  "src/models/workflow/completion.ts:NamedPredicate",
  "src/models/workflow/completion.ts:PerRecordStage",
  "src/models/workflow/completion.ts:PerDocumentStage",
  "src/models/workflow/completion.ts:AnyFanOutStage",
  "src/models/workflow/completion.ts:FanOutStages",
  "src/models/workflow/completion.ts:StagedFanOut",
  "src/models/workflow/completion.ts:CompleteThenEnqueue",
  "src/models/workflow/completion.ts:CompletionProgram",
  "src/models/workflow/completion.ts:CompletionRevealKey",
  "src/models/workflow/completion.ts:SealedCompletionProgram",
  // Checkpoint load results are generic over the producing output schema.
  "src/models/workflow/checkpoint.ts:CheckpointLoad",
  "src/models/workflow/checkpoint.ts:ReplayedCheckpoint",
  "src/models/workflow/checkpoint.ts:FreshnessWalkInput",
  // Canonical fields carry coercion functions and their own schema, so no static data schema describes them.
  "src/models/fields/registry.ts:CanonicalField",
  "src/models/fields/cell-coercion.ts:CellLocation",
  // Intake projections carry a live schema and lookup function; their durable representation is schema-bound.
  "src/models/intake/projection.ts:IntakeProjection",
  // Validation inputs carry derivation functions and are consumed in-process.
  "src/models/intake/validate.ts:IntakeValidationInput",
  "src/models/intake/validate.ts:ValidatedRow",
  "src/models/intake/validate.ts:IntakeValidationResult",

  "src/models/intake/enqueue.ts:IntakeEnqueueSessionView",
  "src/models/intake/enqueue.ts:IntakeEnqueuePlan",
  "src/models/intake/enqueue.ts:IntakeEnqueuePlanInput",
  // The identity domain retains a secret in a closure; only its schema-bound derivation crosses boundaries.
  "src/models/trust/activity-person-pseudonym.ts:ActivityPersonPseudonymDomain",
  // Omission declarations carry producer functions and plans use Maps; crossing values have strict schemas.
  "src/models/workflow/step-omission.ts:StepOmissionProduceContext",
  "src/models/workflow/step-omission.ts:StepOmissionDeclaration",
  "src/models/workflow/step-omission.ts:StepOmissionSpec",
  "src/models/workflow/step-omission.ts:StepOmissionGraphView",
  "src/models/workflow/step-omission.ts:StepOmissionRefusal",
  "src/models/workflow/step-omission.ts:StepOmissionPlan",
  "src/models/workflow/step-omission.ts:StepOmissionCascadeRow",
]);

// These four existing pure implementations inspect Zod internals or freeze a
// generic result; their assertions do not admit unschematized boundary data.
const ZOD_INTROSPECTION_IMPLEMENTATIONS = new Set([
  "src/models/validation/canonical-input-schema.ts",
  "src/models/validation/contract-boundary.ts",
  "src/models/validation/proof-shape.ts",
  "src/models/validation/schema-path.ts",
]);

export function boundarySourceViolations(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      const identity = `${path}:${node.name.text}`;
      if (!EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST.has(identity)) violations.push(`${identity}: exported boundary interface has no schema`);
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) violations.push(`${path}: any is forbidden at a boundary`);
    if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      const identity = `${path}:${node.name.text}`;
      const type = node.type;
      const schemaDerived = ts.isTypeReferenceNode(type) && ts.isQualifiedName(type.typeName)
        && ts.isIdentifier(type.typeName.left) && type.typeName.left.text === "z"
        && ["infer", "input", "output"].includes(type.typeName.right.text);
      if (!schemaDerived && !EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST.has(identity)
        && !(path === "src/rules/validation/canonical-json.ts" && node.name.text === "JsonValue")) {
        violations.push(`${identity}: exported boundary type is not schema-derived`);
      }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Record"
      && node.typeArguments?.length === 2) {
      const value = node.typeArguments[1];
      const proofShapeIntrospection = path === "src/models/validation/proof-shape.ts"
        && node.typeArguments[0]?.kind === ts.SyntaxKind.StringKeyword
        && value.kind === ts.SyntaxKind.UnknownKeyword;
      if (!proofShapeIntrospection && (value.kind === ts.SyntaxKind.UnknownKeyword
        || ts.isTypeReferenceNode(value) && ts.isIdentifier(value.typeName) && value.typeName.text === "JsonValue")) {
        violations.push(`${path}: decision-bearing open Record is forbidden at a boundary`);
      }
    }
    const constAssertion = ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "const";
    if (!ZOD_INTROSPECTION_IMPLEMENTATIONS.has(path)
      && ((ts.isAsExpression(node) && !constAssertion) || ts.isTypeAssertionExpression(node))) {
      violations.push(`${path}: unchecked type assertion at a boundary`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call = node.expression;
      if (ts.isIdentifier(call.expression) && call.expression.text === "z" && call.name.text === "object") {
        violations.push(`${path}: z.object is open; use z.strictObject`);
      }
      if (["passthrough", "strip"].includes(call.name.text)) violations.push(`${path}: ${call.name.text} opens or silently strips a boundary`);
      if (call.name.text === "parse" && node.arguments[0] && ts.isBinaryExpression(node.arguments[0])
        && node.arguments[0].operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        && ts.isObjectLiteralExpression(node.arguments[0].right)) {
        violations.push(`${path}: parse cannot default malformed boundary input to an empty object`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe("strict boundary schemas", () => {
  it("keeps the explicit top-level boundary catalog unique, valid, and recursively strict", () => {
    assert.equal(new Set(BOUNDARY_SCHEMA_CATALOG.map(({ name }) => name)).size, BOUNDARY_SCHEMA_CATALOG.length);
    const invalid: unknown[] = [];
    for (const entry of BOUNDARY_SCHEMA_CATALOG) {
      assert.deepEqual(strictnessViolations(entry.schema), [], entry.name);
      for (const [index, fixture] of entry.fixtures.entries()) {
        const parsed = entry.schema.safeParse(fixture);
        if (!parsed.success) invalid.push({ name: entry.name, index, issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) });
      }
    }
    assert.deepEqual(invalid, []);
  });

  it("rejects an unknown key at every exercised nested object boundary", () => {
    for (const entry of BOUNDARY_SCHEMA_CATALOG) for (const fixture of entry.fixtures) {
      const parsed = entry.schema.parse(fixture);
      for (const path of objectPaths(parsed)) {
        const text = pathText(path);
        if (entry.openFixturePaths?.some((open) => text === open || text.startsWith(`${open}.`))) continue;
        assert.equal(entry.schema.safeParse(addUnknown(parsed, path)).success, false,
          `${entry.name} accepted unknown key at ${text || "$"}`);
      }
    }
  });

  it("walks every object arm nested under arrays, unions, lazies, and wrappers", () => {
    const nested = z.lazy(() => z.strictObject({
      entries: z.array(z.union([
        z.strictObject({ kind: z.literal("left"), value: z.strictObject({ label: z.string() }) }),
        z.strictObject({ kind: z.literal("right"), value: z.strictObject({ count: z.number() }) }),
      ])).optional(),
    }));
    assert.deepEqual(strictnessViolations(nested), []);
    assert.notDeepEqual(strictnessViolations(z.lazy(() => z.union([
      z.strictObject({ safe: z.string() }), z.object({ unsafe: z.string() }),
    ]))), []);
    const fixtures = [
      { entries: [{ kind: "left", value: { label: "x" } }] },
      { entries: [{ kind: "right", value: { count: 1 } }] },
    ];
    for (const fixture of fixtures) for (const path of objectPaths(fixture)) {
      assert.equal(nested.safeParse(addUnknown(fixture, path)).success, false);
    }
  });

  it("rejects unschematized interfaces, open schemas, any, assertions, and catch/default parsing", () => {
    const fixture = [
      "export interface DurableThing { value: any }",
      "export const Schema = z.object({ value: z.string() }).passthrough();",
      "export const value = input as DurableThing;",
      "export const parsed = Schema.parse(input ?? {});",
    ].join("\n");
    assert.equal(boundarySourceViolations("src/domain/new-boundary.ts", fixture).length >= 5, true);
  });

  it("keeps exact operational classifications from exempting either display module", () => {
    const fixtures = [
      { source: "export interface UndeclaredWire { value: string }", refusal: "exported boundary interface has no schema" },
      { source: "export type UndeclaredWire = { value: string }", refusal: "exported boundary type is not schema-derived" },
      { source: "export const Schema = z.object({ value: z.string() });", refusal: "z.object is open" },
      { source: "export interface OperationTransformDeclaration { value: any }", refusal: "any is forbidden" },
      { source: "export const value = input as OperationTransformDeclaration;", refusal: "unchecked type assertion" },
      { source: "export const parsed = Schema.parse(input ?? {});", refusal: "parse cannot default malformed boundary input" },
    ];
    for (const path of ["src/models/workflow/operation-display.ts", "src/models/workflow/operation-display-snapshot.ts"]) {
      const current = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.deepEqual(boundarySourceViolations(path, current), []);
      for (const { source, refusal } of fixtures) {
        assert.equal(boundarySourceViolations(path, `${current}\n${source}`).some((violation) => violation.includes(refusal)), true,
          `${path} did not refuse ${refusal}`);
      }
    }
  });

  it("keeps relocated validation classifications exact to their reviewed files and types", () => {
    const path = "src/domain/validation/new-boundary.ts";
    const source = [
      "export interface TimelineRepository { read(): unknown }",
      "export interface ContractSchemaLeaf { value: string }",
      "export type ProofShapeField = { value: string };",
      "export type ProofShape = { value: string };",
      "export interface RerunMappingView { value: string }",
      "export interface ResolvedSchemaPath { value: string }",
      "export type SchemaPathFailure = { value: string };",
      "export const inspected = raw as Record<string, unknown>;",
      "export const anything: any = inspected;",
      "export const open = z.object({ value: z.string() });",
      "export const parsed = open.parse(input ?? {});",
    ].join("\n");
    const violations = boundarySourceViolations(path, source);
    for (const name of ["TimelineRepository", "ContractSchemaLeaf", "ProofShapeField", "ProofShape",
      "RerunMappingView", "ResolvedSchemaPath", "SchemaPathFailure"]) {
      assert.ok(violations.some((violation) => violation.includes(`${path}:${name}:`)), name);
    }
    for (const rule of ["unchecked type assertion", "decision-bearing open Record", "any is forbidden",
      "z.object is open", "parse cannot default malformed boundary input"]) {
      assert.ok(violations.some((violation) => violation.includes(rule)), rule);
    }
    assert.ok(boundarySourceViolations("src/models/validation/proof-shape.ts",
      "export const dynamic = input as Record<string, JsonValue>;")
      .some((violation) => violation.includes("decision-bearing open Record")));
  });

  it("keeps every current domain boundary source free of unsafe escape hatches", () => {
    const violations = gitVisibleFiles(["src/domain", "src/backend/app/composition/runtime-composition.ts"])
      .filter((path) => path.endsWith(".ts"))
      .flatMap((path) => boundarySourceViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });
});
