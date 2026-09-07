import { CredentialStoreApplyOutcomeSchema } from "../../../src/domain/config/credential-store.js";
import { initialProtectedStoreRecord } from "../../../src/domain/config/protected-settings.js";
import { SettingsRecordSchema, initialSettingsFileRecord } from "../../../src/domain/config/settings.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  SeparationsKualiFinalizationTestTargetResolutionSchema,
  TEST_TARGET_REGISTRY,
  TestTargetRegistrySchema,
} from "../../../src/control/test-target-registry.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityTableRegistrySchema, TableSpecSchema } from "../../../src/domain/authority.js";
import { RebuildArtifactRootSchema } from "../../../src/config/define-runtime-isolation.js";
import { ArtifactPutMetadataSchema, ArtifactRefSchema } from "../../../src/domain/artifacts.js";
import { BoundaryFailureSchema } from "../../../src/domain/boundary-failure.js";
import { TerminalDependencyEvidenceSchema } from "../../../src/core/run-result.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  BulkRunCommandRequestSchema,
  COMMAND_FAMILY_REGISTRY,
  CommandAuditRecordSchema,
  CommandEnvelopeSchema,
  CommandFamilyRegistrySchema,
  CommandFamilySpecSchema,
  CommandRequestSchema,
  CommandResultSchema,
  CommandTargetReferenceSchema,
  GateCommandRequestSchema,
  IntakeCommandRequestSchema,
  NotificationCommandRequestSchema,
  RunCommandRequestSchema,
  SettingsCommandRequestSchema,
  StartCommandRequestSchema,
  VersionArchiveCommandRequestSchema,
  WorkerBrowserCommandRequestSchema,
} from "../../../src/domain/commands.js";
import {
  CONFIG_ENV_BINDINGS,
  ConfigEnvBindingRegistrySchema,
  ResolvedConfigSchema,
  resolveConfigWithProvenance,
} from "../../../src/domain/config/resolve.js";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import {
  ConfigSchema,
  EditableSettingsOverrideSchema,
  ProviderBudgetConfigSchema,
  ProviderBudgetSchema,
  SettingsOverrideSchema,
} from "../../../src/domain/config/schema.js";
import { ConfigSnapshotRecordSchema } from "../../../src/domain/config/snapshot.js";
import { ArtifactRefWireSchema, ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../../src/domain/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { DiagnosticBundleWireSchema } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema, DashboardTopicPatchSchema, DashboardTopicSnapshotSchema } from "../../../src/domain/dashboard/subscription.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../src/domain/dependencies.js";
import { GateResultRecordSchema } from "../../../src/domain/gates.js";
import { LedgerEntryPayloadSchema, LedgerEntrySchema, LedgerOutboxPayloadSchema, WriteCommittedSpanOutboxPayloadSchema } from "../../../src/domain/ledger.js";
import { NotificationRecordSchema } from "../../../src/domain/notifications.js";
import { AtomicOutboxPayloadSchema, AtomicOutboxRecordSchema } from "../../../src/domain/outbox.js";
import {
  ProviderAdmissionDenyRequestSchema,
  ProviderAdmissionInterruptRequestSchema,
  ProviderAdmissionLifecycleSchema,
  ProviderAdmissionMutationOutcomeSchema,
  ProviderAdmissionRecordSchema,
  ProviderAdmissionReserveOutcomeSchema,
  ProviderAdmissionReserveRequestSchema,
  ProviderAdmissionSettleRequestSchema,
  ProviderAdmissionSweepOutcomeSchema,
  ProviderAdmissionSweepRequestSchema,
  ProviderBudgetCounterSchema,
  ProviderBudgetReservationSchema,
  ProviderCostEstimateSchema,
  ProviderExecutionIdentitySchema,
  ProviderMeasuredUsageSchema,
  ProviderUnavailableReasonSchema,
  RedactedProviderEvidenceSchema,
} from "../../../src/domain/provider-admission.js";
import {
  ProviderAdapterOutcomeSchema,
  ProviderRequestEnvelopeSchema,
  ProviderResponseEnvelopeSchema,
} from "../../../src/domain/providers.js";
import {
  ProviderDenialDispositionSchema,
  ProviderDenialRunContextSchema,
} from "../../../src/core/provider-admission.js";
import {
  buildPreflightReport,
  PreflightObservationSchema,
  PreflightReportSchema,
  PreflightResultSchema,
  requiredPreflightChecks,
} from "../../../src/domain/preflight.js";
import { ClassifiedDiagnosticValueSchema, RedactionResultSchema } from "../../../src/domain/redaction.js";
import { RUNTIME_DEPENDENCY_REGISTRY, RuntimeDependencyRegistrySchema } from "../../../src/domain/runtime-dependencies.js";
import { RUNTIME_ENVIRONMENT_REGISTRY, RuntimeEnvironmentRegistrySchema } from "../../../src/domain/runtime-environment.js";
import { SchemaBoundCanonicalValueSchema } from "../../../src/domain/schema-bound-value.js";
import {
  NotRunTerminalDependencySchema,
  ResolvedTerminalDependencySchema,
  RunResultRecordSchema,
  TerminalDependencyRecordSchema,
  TerminalNotRunReasonSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
} from "../../../src/domain/run/result.js";
import {
  FailureTerminalAuthorizationRecordSchema,
  SuccessTerminalAuthorizationRecordSchema,
  TerminalAuthorizationRecordSchema,
  TerminalizationClaimSchema,
} from "../../../src/domain/run/terminal-authorization.js";
import { RunTerminalOutboxRecordSchema } from "../../../src/domain/run/terminal-outbox.js";
import {
  DataPointSchema,
  RecordedDataPointSchema,
  TaskExecutionIdentitySchema,
  TaskProvenanceResultSchema,
  TaskUpstreamCheckpointEvidenceSchema,
} from "../../../src/domain/task-provenance.js";
import {
  GraphCoveragePointSchema,
  ScenarioCoverageClaimSchema,
} from "../../../src/domain/workflow/scenario-coverage.js";
import {
  ApproveContextSchema,
  ApprovedDocumentSchema,
  CompletionConsumptionSpecSchema,
  CompletionProgramSampleSchema,
  ExtractedFieldSchema,
  MemberPlanEntrySchema,
  PreviewRecordSchema,
} from "../../../src/domain/workflow/completion.js";
import {
  FileAcceptSpecSchema,
  InputParserSpecSchema,
  ParsedInputEntrySchema,
  SurfaceFieldSchema,
  TextTemplateSchema,
  UploadFieldSpecSchema,
  UploadedFileSchema,
  WorkflowSurfacesSchema,
} from "../../../src/domain/workflow/ingress.js";
import {
  DetailProjectionSpecRuntimeSchema,
  DurableArtifactProjectionSpecRuntimeSchema,
  GateProjectionDefinitionSchema,
  StepProjectionSchema,
  SurfaceShapeSchema,
  VerdictDefinitionSchema,
  WorkflowActionPolicySchema,
  WorkflowCapabilitiesSchema,
} from "../../../src/domain/workflow/presentation.js";
import {
  BUILD_MANIFEST,
  BuildManifestSchema,
  SourceHashSchema,
} from "../../../src/domain/workflow/build-manifest.js";
import {
  CheckpointExpectationSchema,
  CheckpointMissReasonSchema,
  FactProvenanceSchema,
  FreshnessOverrideSchema,
  RunCheckpointRecordSchema,
} from "../../../src/domain/workflow/checkpoint.js";
import {
  ChildVisibilitySchema,
  DelegationManifestRefSchema,
  DelegationPolicySchema,
  GraphNodeKindSchema,
  ParallelBranchSpecSchema,
  childRunOutcomeSchema,
} from "../../../src/domain/workflow/graph.js";
import {
  TimecardDateRangeSchema,
  TimecardMonthDaySchema,
  VisibleTimecardMonthDaysSchema,
} from "../../../src/domain/timecard-period.js";
import {
  IdleRefreshCadenceSchema,
  LoginResultSchema,
  RetryPolicySchema,
  SessionNeedSchema,
} from "../../../src/domain/session.js";
import {
  FreshnessPolicySchema,
  ProvenancePolicySchema,
  SubjectBindingSpecSchema,
  TaskEffectSchema,
} from "../../../src/domain/contracts/base.js";
import {
  UiCatalogSchema,
  UiVerificationEvidenceManifestSchema,
  UiVerificationScenarioSchema,
} from "../../../src/domain/ui/contracts.js";
import {
  CRM_ONBOARDING_DISPLAYED_EID,
  CrmOnboardingDatesReadSchema,
  CrmOnboardingRecordReadSchema,
  CrmSubjectBindingSchema,
} from "../../../src/domain/ui/crm-onboarding.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  ActivityPersonPseudonymSecretReferenceSchema,
  SECRET_FAMILY_SPECS,
  SECRET_FILE_SPECS,
  SECRET_SPECS,
  ProtectedSecretSourceSchema,
  SecretFamilySpecSchema,
  SecretFileSpecSchema,
  SecretAvailabilitySchema,
  SecretSpecSchema,
  TEST_TARGET_SECRET_SPECS,
  TestTargetSecretSpecSchema,
} from "../../../src/domain/secrets.js";
import {
  ActivityPersonPseudonymEvidenceSchema,
  ActivityPersonPseudonymGenerationBindingSchema,
} from "../../../src/domain/trust/activity-person-pseudonym.js";
import {
  ActivityPersonPseudonymBackfillOutcomeSchema,
  ActivityPersonPseudonymBackfillReportSchema,
  ActivityPersonPseudonymBackfillRequestSchema,
  CurrentSeparationsPseudonymSourceResultSchema,
} from "../../../src/domain/trust/activity-person-pseudonym-backfill.js";
import { DiagnosticBundleSchema } from "../../../src/domain/trust/diagnostic.js";
import {
  ActionEvidenceSchema,
  DecisionEvidenceSchema,
  EvidenceFactSchema,
  ReuseEvidenceSchema,
  RunEvidenceReceiptSchema,
  UncertaintyEvidenceSchema,
  VerificationEvidenceSchema,
} from "../../../src/domain/trust/evidence.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { FixRecordSchema, KnowledgeRecordSchema } from "../../../src/domain/trust/knowledge.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/domain/trust/preflight-scenarios.js";
import { ScenarioManifestSchema } from "../../../src/domain/trust/scenario.js";
import { DryRunScenarioResultSchema } from "../../../src/domain/trust/dry-run-scenario-result.js";
import {
  AbsentEvidenceSchema,
  IdempotencyKeySchema,
  NegativeSettlementDecisionSchema,
  NegativeSettlementEvaluationInputSchema,
  NegativeSettlementPolicySchema,
  PresentProofReferenceSchema,
  RecoveryProbeVerdictSchema,
  SubjectEvidenceSchema,
  SubjectProofSchema,
  TransactionOutcomeSchema,
  UNSCOPED_COMMIT_REASON_REGISTRY,
  UnscopedBindingProofSchema,
  UnscopedCommitReasonSpecSchema,
  WriteAttemptRecordSchema,
  WriteBindingProofSchema,
  WriteIntentRecordSchema,
} from "../../../src/domain/write-safety.js";
import {
  ArtifactOutboxStorageRecordSchema,
  AtomicWriteCommitInputSchema,
  AtomicWriteCommitReportSchema,
  AtomicWriteCommitStorageStepSchema,
  AuthorityBackupManifestSchema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  AuthorityBackupServiceOptionsSchema,
  AuthorityBootReportSchema,
  AuthorityCopyInspectionSchema,
  AuthorityDatabaseOptionsSchema,
  AuthorityInvariantResultSchema,
  AuthorityMetaSchema,
  AuthorityPendingCountsSchema,
  AuthoritySchemaInspectionSchema,
  BackupHealthSchema,
  BackupVerificationSchema,
  ImmutableInsertDispositionSchema,
  OfflineRestoreOptionsSchema,
  OfflineRestoreReportSchema,
  OfflineRestoreRequestSchema,
  OpaqueAuthorityRecordSchema,
  ProjectionStorageRecordSchema,
  PermanentWriteResolutionSchema,
  RecoveryProcessLockStateSchema,
  RecoveryRuntimeLockSnapshotSchema,
  RecoveryStopProofStoreOptionsSchema,
  RestoreCandidateSchema,
  SqliteStorageRecordIdSchema,
  StoppedSystemProofSchema,
  StoppedSystemProofIssueRequestSchema,
  StorageDoctorOptionsSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  VersionPlanStorageRecordSchema,
  WriteFenceInputSchema,
  FailureTerminalizationReportSchema,
  FailureTerminalizationRequestSchema,
  FailureTerminalizationStorageStepSchema,
  SuccessTerminalizationReportSchema,
  SuccessTerminalizationRequestSchema,
  SuccessTerminalizationStorageStepSchema,
} from "../../../src/infra/sqlite/index.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/infra/sqlite/migrations.js";
import { buildSafeUiCatalog } from "../../../src/stores/ucpath/driver/catalog.js";
import { CRM_UI_REGISTRY } from "../../../src/stores/crm/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "../../../src/stores/ucpath/driver/ui-registry.js";
import {
  ABSENCE_1,
  ABSENCE_2,
  ATOMIC_WRITE_COMMIT,
  COMMAND_FIXTURES,
  COMMITTED_OUTCOME,
  CONFIG_SNAPSHOT,
  DELEGATION_MANIFEST,
  DEPENDENCY_RECORD,
  GATE_RESULT,
  IDEMPOTENCY_KEY,
  IDEMPOTENCY_KEY_DIGEST,
  LEDGER_OUTBOX_RECORD,
  LEDGER_OUTBOX_PAYLOAD,
  LEDGER_PAYLOAD,
  NOTIFICATION,
  SPAN_OUTBOX_PAYLOAD,
  SPAN_OUTBOX_RECORD,
  SUBJECT_EVIDENCE,
  SUBJECT_PROOF,
  UNSCOPED_PROOF,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  ARCHIVE_RELAUNCH,
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_BUMP_PLAN,
  VERSION_PLAN_ROW,
} from "../fixtures/archive-fixtures.js";
import {
  ArchivedRunRecordSchema,
  ArchiveRelaunchRecordSchema,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
} from "../../../src/domain/archive/model.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { CURRENT_SEPARATIONS_RESULT } from "../fixtures/activity-person-pseudonym-fixtures.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";
import {
  ActivityPersonPseudonymBackfillCommandOutcomeSchema,
} from "../../../src/server/activity-person-pseudonym-backfill/compose.js";

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
const RUN_TERMINAL_OUTBOX = {
  outboxId: "11111111-1111-4111-8111-111111111111",
  payload: {
    kind: "run-terminal-result",
    runId: RUN_RESULT.runId,
    workflowId: RUN_RESULT.workflowId,
    attempt: RUN_RESULT.attempt,
    resultDigest: RUN_RESULT.resultDigest,
  },
  projection: { state: "pending" },
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
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_8 = "88888888-8888-4888-8888-888888888888";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-31T17:00:00.000Z";
const LATER = "2026-07-31T17:01:00.000Z";
const CLOCK = manualClock(new Date("2026-07-31T10:00:00-07:00"));
const UI_EVIDENCE = JSON.parse(readFileSync(
  join(REPO_ROOT, "evidence/ui/ucpath/person-org.fixture.json"),
  "utf8",
)) as unknown;

const FAILURE = {
  failureId: UUID_1, fingerprint: HASH_B, runId: UUID_2, traceId: "on-120000-2222", attempt: 1,
  workflowId: "onboarding", nodeId: "search-person", taskId: "ucpath/search-person",
  code: "UNEXPECTED_PAGE_STATE", summary: "Expected state did not render", transient: false,
  writeState: "not-attempted",
  causeChain: [{ code: "UNEXPECTED_PAGE_STATE", summary: "Page mismatch", role: "primary", transient: false }],
  remediation: [{ kind: "code-change", message: "Repair the state recipe" }], occurredAt: NOW,
};
const FAILED_RUN = {
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
  ...QUEUED_RUN,
  lifecycle: { state: "terminal", outcome: "done", endedAt: NOW },
  claimGeneration: 1,
  version: 2,
};
const FAILURE_TERMINAL_AUTHORIZATION = {
  kind: "failed",
  runId: FAILURE.runId,
  workflowId: FAILURE.workflowId,
  attempt: FAILURE.attempt,
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
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
  outboxId: RUN_TERMINAL_OUTBOX.outboxId,
};

const RECEIPT = {
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

const KNOWLEDGE = {
  id: UUID_1, status: "active", scope: { system: "ucpath" }, title: "Search state", symptom: "Controls absent",
  trigger: "Frame race", rootCause: "Incomplete state", invariant: "Ready state is complete", fix: "Add condition",
  regressionScenarios: ["ucpath/person-search-frame-race"], evidence: [`observation:${UUID_2}`],
  verifiedAt: NOW, sourceCommits: ["abcdef1"],
};

const FIX = {
  id: UUID_3, failureFingerprint: HASH_B, status: "verified", requestedBy: "codex", summary: "Close race",
  affected: ["ucpath/search-person"], files: ["src/stores/ucpath/driver/person-search.ts"],
  scenarios: ["ucpath/person-search-frame-race"], verification: [`observation:${UUID_2}`], commit: "abcdef1",
  knowledge: [UUID_1], createdAt: NOW,
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
  monthCounts: [], workflowCounts: [], statusCounts: [], queueSurfaces: [], workerCards: [], workerPools: [], notifications: [],
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
  { ...WRITE_INTENT_ATTEMPTING, status: "parked", parkedCode: "operator-required", message: "Manual confirmation required" },
];
const WRITE_ATTEMPT_FIXTURES = [
  WRITE_ATTEMPT,
  { ...WRITE_ATTEMPT, outcome: { state: "committed", completionProof: { schemaHash: HASH_A, value: "T123" }, confirmedAt: ABSENCE_1.observedAt } },
  { ...WRITE_ATTEMPT, outcome: { state: "safe-to-retry", settlement: SAFE_SETTLEMENT } },
  { ...WRITE_ATTEMPT, outcome: { state: "parked", code: "operator-required", message: "Manual confirmation required" } },
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
const SQLITE_OPAQUE_RECORD = {
  recordId: UUID_1,
  payload: { schemaHash: HASH_A, value: { reserved: true } },
  createdAt: NOW,
};
/** D179: the real plan row, whose fingerprint the schema recomputes. */
const SQLITE_VERSION_PLAN = VERSION_PLAN_ROW;
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
const SQLITE_PROJECTION = {
  projectionKey: HASH_A,
  payload: { schemaHash: HASH_B, value: { status: "running" } },
  updatedAt: NOW,
};
const AUTHORITY_PENDING_COUNTS = {
  pendingCommands: 1,
  unresolvedWriteIntents: 1,
  leases: 1,
  durableOutbox: 1,
  runTerminalOutbox: 1,
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
  processLockGenerations: { server: 11, workers: 13 },
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
  },
};
const STORAGE_DOCTOR_REPORT = {
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
    invitedOn: { state: "present", value: "2026-06-01" },
    startsOn: { state: "present", value: "2026-07-15" },
    completedOn: { state: "absent", reason: "history has no Completed transition" },
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
  { name: "ActivityPersonPseudonymBackfillRequest", schema: ActivityPersonPseudonymBackfillRequestSchema, fixtures: [
    { scope: "current-separations" },
    { scope: "selected-runs", runIds: [UUID_2] },
  ] },
  { name: "ActivityPersonPseudonymBackfillOutcome", schema: ActivityPersonPseudonymBackfillOutcomeSchema, fixtures: [
    { runId: UUID_2, state: "inserted", keyGeneration: "activity-person-g1" },
    { runId: UUID_3, state: "unavailable", reason: "canonical-subject-missing" },
  ] },
  { name: "ActivityPersonPseudonymBackfillReport", schema: ActivityPersonPseudonymBackfillReportSchema, fixtures: [{
    scope: "current-separations",
    keyGeneration: "activity-person-g1",
    outcomes: [{ runId: UUID_2, state: "inserted", keyGeneration: "activity-person-g1" }],
    counts: { examined: 1, inserted: 1, existing: 0, unavailable: 0 },
  }] },
  {
    name: "CurrentSeparationsPseudonymSourceResult",
    schema: CurrentSeparationsPseudonymSourceResultSchema,
    fixtures: [CURRENT_SEPARATIONS_RESULT],
  },
  { name: "ActivityPersonPseudonymSecretReference", schema: ActivityPersonPseudonymSecretReferenceSchema, fixtures: [
    ACTIVITY_PERSON_PSEUDONYM_SECRET_REFERENCE,
  ] },
  { name: "ActivityPersonPseudonymBackfillCommandOutcome", schema: ActivityPersonPseudonymBackfillCommandOutcomeSchema, fixtures: [
    { output: "backfill complete", exitCode: 0 },
  ] },
  { name: "ImmutableInsertDisposition", schema: ImmutableInsertDispositionSchema, fixtures: ["inserted", "existing"] },
  { name: "SqliteStorageRecordId", schema: SqliteStorageRecordIdSchema, fixtures: [UUID_1] },
  { name: "OpaqueAuthorityRecord", schema: OpaqueAuthorityRecordSchema, fixtures: [SQLITE_OPAQUE_RECORD], openFixturePaths: ["payload.value"] },
  { name: "VersionPlanStorageRecord", schema: VersionPlanStorageRecordSchema, fixtures: [SQLITE_VERSION_PLAN] },
  { name: "VersionBumpPlan", schema: VersionBumpPlanSchema, fixtures: [VERSION_BUMP_PLAN] },
  { name: "VersionBumpApplication", schema: VersionBumpApplicationSchema, fixtures: [VERSION_BUMP_APPLICATION] },
  // `input.raw` is the operator's exact submission and `input.parsed.value` is
  // a schema-bound canonical value — both are open JSON by contract (ref workflow-model
  // §2), which is precisely why the archive keeps them beside their hashes.
  {
    name: "ArchivedRunRecord",
    schema: ArchivedRunRecordSchema,
    fixtures: [ARCHIVED_RUN],
    openFixturePaths: ["input.raw", "input.parsed.value"],
  },
  { name: "ArchiveRelaunchRecord", schema: ArchiveRelaunchRecordSchema, fixtures: [ARCHIVE_RELAUNCH] },
  { name: "ArtifactOutboxStorageRecord", schema: ArtifactOutboxStorageRecordSchema, fixtures: [SQLITE_ARTIFACT_OUTBOX], openFixturePaths: ["payload.value"] },
  { name: "ProjectionStorageRecord", schema: ProjectionStorageRecordSchema, fixtures: [SQLITE_PROJECTION], openFixturePaths: ["payload.value"] },
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
  { name: "OfflineRestoreReport", schema: OfflineRestoreReportSchema, fixtures: [{ state: "restored", schemaVersion: 32, restoredAt: NOW, manifestFileName: "authority-g4.sqlite.manifest.json", backupFileName: "authority-g4.sqlite", suspectFileName: "suspect-state.sqlite", sourceDatabaseIdentity: HASH_B, authorityGeneration: 4, projectionRebuilt: true, authorityPreservedAcrossProjectionRebuild: true }] },
  { name: "SchemaBoundCanonicalValue", schema: SchemaBoundCanonicalValueSchema, fixtures: [{ schemaHash: HASH_A, value: "approved" }] },
  { name: "RebuildArtifactRoot", schema: RebuildArtifactRootSchema, fixtures: [".tracker/artifacts"] },
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
  { name: "DetailProjectionSpecRuntime", schema: DetailProjectionSpecRuntimeSchema, fixtures: [
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
  { name: "RunResultRecord", schema: RunResultRecordSchema, fixtures: [RUN_RESULT], openFixturePaths: ["result.value"] },
  { name: "RunTerminalOutboxRecord", schema: RunTerminalOutboxRecordSchema, fixtures: [
    RUN_TERMINAL_OUTBOX,
    { ...RUN_TERMINAL_OUTBOX, projection: { state: "projected", projectedAt: NOW, projectionFingerprint: HASH_A } },
  ] },
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
  { name: "SourceHash", schema: SourceHashSchema, fixtures: [{ path: "src/domain/ids.ts", sha256: HASH_A }] },
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
  { name: "ProviderBudget", schema: ProviderBudgetSchema, fixtures: [{ timeoutMs: 15_000, concurrency: 1, requestsPerMinute: 10, dailyRequestLimit: 100, costLimitUsdMicros: 0 }] },
  { name: "ProviderBudgetConfig", schema: ProviderBudgetConfigSchema, fixtures: [ConfigSchema.parse({ paths: defaultRuntimePaths() }).providers] },
  { name: "ProviderUnavailableReason", schema: ProviderUnavailableReasonSchema, fixtures: [
    { code: "rate-exhausted", message: "fixed minute exhausted", retryAt: LATER },
    { code: "aborted", message: "run aborted" },
  ] },
  { name: "ProviderCostEstimate", schema: ProviderCostEstimateSchema, fixtures: [{ maximumCostUsdMicros: 0 }] },
  { name: "ProviderMeasuredUsage", schema: ProviderMeasuredUsageSchema, fixtures: [{ requestCount: 1, costUsdMicros: 0 }] },
  { name: "RedactedProviderEvidence", schema: RedactedProviderEvidenceSchema, fixtures: [{ summary: "redacted fixture", capturedAt: NOW }] },
  { name: "ProviderExecutionIdentity", schema: ProviderExecutionIdentitySchema, fixtures: [{ runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" }] },
  { name: "ProviderBudgetReservation", schema: ProviderBudgetReservationSchema, fixtures: [{ requestCount: 1, maximumCostUsdMicros: 0 }] },
  { name: "ProviderAdmissionLifecycle", schema: ProviderAdmissionLifecycleSchema, fixtures: [{ state: "reserved", reservedAt: NOW, leaseExpiresAt: LATER, deadlineAt: LATER }] },
  { name: "ProviderAdmissionRecord", schema: ProviderAdmissionRecordSchema, fixtures: [{
    admissionId: UUID_8,
    execution: { runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" },
    capability: "ocr.extract",
    configSnapshotId: UUID_4,
    configFingerprint: HASH_A,
    requestFingerprint: HASH_B,
    budget: { timeoutMs: 15_000, concurrency: 1, requestsPerMinute: 10, dailyRequestLimit: 100, costLimitUsdMicros: 0 },
    estimate: { maximumCostUsdMicros: 0 },
    reservation: { requestCount: 1, maximumCostUsdMicros: 0 },
    lifecycle: { state: "reserved", reservedAt: NOW, leaseExpiresAt: LATER, deadlineAt: LATER },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }] },
  { name: "ProviderBudgetCounter", schema: ProviderBudgetCounterSchema, fixtures: [{
    capability: "ocr.extract", minuteWindowStartedAt: NOW, minuteRequests: 1,
    dayWindowStartedAt: NOW, dayRequests: 1, dayReservedCostUsdMicros: 0,
    activeReservations: 1, version: 1, createdAt: NOW, updatedAt: NOW,
  }] },
  { name: "ProviderAdmissionReserveRequest", schema: ProviderAdmissionReserveRequestSchema, fixtures: [{
    admissionId: UUID_8,
    execution: { runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" },
    capability: "ocr.extract", configSnapshotId: UUID_4, configFingerprint: HASH_A,
    requestFingerprint: HASH_B, estimate: { maximumCostUsdMicros: 0 },
    leaseExpiresAt: LATER, deadlineAt: LATER, now: NOW,
  }] },
  { name: "ProviderAdmissionDenyRequest", schema: ProviderAdmissionDenyRequestSchema, fixtures: [{
    admissionId: UUID_8,
    execution: { runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" },
    capability: "ocr.extract", configSnapshotId: UUID_4, configFingerprint: HASH_A,
    requestFingerprint: HASH_B, estimate: { maximumCostUsdMicros: 0 },
    reason: { code: "aborted", message: "run aborted" }, now: NOW,
  }] },
  { name: "ProviderAdmissionReserveOutcome", schema: ProviderAdmissionReserveOutcomeSchema, fixtures: [{
    state: "existing",
    admission: {
      admissionId: UUID_8,
      execution: { runId: UUID_1, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" },
      capability: "ocr.extract", configSnapshotId: UUID_4, configFingerprint: HASH_A,
      requestFingerprint: HASH_B,
      budget: { timeoutMs: 15_000, concurrency: 1, requestsPerMinute: 10, dailyRequestLimit: 100, costLimitUsdMicros: 0 },
      estimate: { maximumCostUsdMicros: 0 }, reservation: { requestCount: 1, maximumCostUsdMicros: 0 },
      lifecycle: { state: "reserved", reservedAt: NOW, leaseExpiresAt: LATER, deadlineAt: LATER },
      version: 1, createdAt: NOW, updatedAt: NOW,
    },
  }] },
  { name: "ProviderAdmissionSettleRequest", schema: ProviderAdmissionSettleRequestSchema, fixtures: [{
    admissionId: UUID_8, expectedVersion: 1, actualUsage: { requestCount: 1, costUsdMicros: 0 },
    adapterDisposition: "produced", evidence: { summary: "redacted fixture", capturedAt: NOW }, now: NOW,
  }] },
  { name: "ProviderAdmissionInterruptRequest", schema: ProviderAdmissionInterruptRequestSchema, fixtures: [{ admissionId: UUID_8, expectedVersion: 1, code: "timeout", message: "deadline elapsed", now: NOW }] },
  { name: "ProviderAdmissionMutationOutcome", schema: ProviderAdmissionMutationOutcomeSchema, fixtures: [] },
  { name: "ProviderAdmissionSweepRequest", schema: ProviderAdmissionSweepRequestSchema, fixtures: [{ now: NOW }] },
  { name: "ProviderAdmissionSweepOutcome", schema: ProviderAdmissionSweepOutcomeSchema, fixtures: [{ expired: [], counters: [] }] },
  { name: "ProviderRequestEnvelope", schema: ProviderRequestEnvelopeSchema, fixtures: [{ capability: "ocr.extract", payload: { schemaHash: HASH_A, value: "redacted fixture" } }] },
  { name: "ProviderResponseEnvelope", schema: ProviderResponseEnvelopeSchema, fixtures: [
    { state: "produced", value: { schemaHash: HASH_A, value: "recognized fixture" } },
    { state: "unavailable", reason: { code: "adapter-unavailable", message: "no configured provider" } },
    { state: "invalid-response", reason: "response did not match the requested schema" },
  ] },
  { name: "ProviderAdapterOutcome", schema: ProviderAdapterOutcomeSchema, fixtures: [{
    response: { state: "produced", value: { schemaHash: HASH_A, value: "recognized fixture" } },
    usage: { requestCount: 1, costUsdMicros: 0 },
    evidence: { summary: "redacted fixture", capturedAt: NOW },
  }] },
  { name: "ProviderDenialRunContext", schema: ProviderDenialRunContextSchema, fixtures: [{ runId: UUID_1, expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 }, now: NOW }] },
  { name: "ProviderDenialDisposition", schema: ProviderDenialDispositionSchema, fixtures: [{ state: "stop", code: "aborted" }] },
  { name: "CommandEnvelope", schema: CommandEnvelopeSchema, fixtures: [COMMAND_ENVELOPE] },
  { name: "StartCommandRequest", schema: StartCommandRequestSchema, fixtures: commandFixtures("start") },
  { name: "IntakeCommandRequest", schema: IntakeCommandRequestSchema, fixtures: commandFixtures("intake") },
  { name: "WorkerBrowserCommandRequest", schema: WorkerBrowserCommandRequestSchema, fixtures: commandFixtures("worker-browser") },
  { name: "SettingsCommandRequest", schema: SettingsCommandRequestSchema, fixtures: commandFixtures("settings") },
  { name: "VersionArchiveCommandRequest", schema: VersionArchiveCommandRequestSchema, fixtures: commandFixtures("version-archive") },
  { name: "RunCommandRequest", schema: RunCommandRequestSchema, fixtures: commandFixtures("run") },
  { name: "GateCommandRequest", schema: GateCommandRequestSchema, fixtures: commandFixtures("gate") },
  { name: "NotificationCommandRequest", schema: NotificationCommandRequestSchema, fixtures: commandFixtures("notification") },
  { name: "CommandRequest", schema: CommandRequestSchema, fixtures: COMMAND_FIXTURES },
  { name: "CommandTargetReference", schema: CommandTargetReferenceSchema, fixtures: [
    { family: "start", workflowId: "onboarding", startPlanId: UUID_1, expectedVersion: 1 },
    { family: "intake", intakeSessionId: UUID_1 },
    { family: "worker-browser", workerId: "worker-1" },
    { family: "settings", revision: 1 },
    { family: "version-archive", versionPlanId: UUID_1 },
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
  { name: "WriteFenceInput", schema: WriteFenceInputSchema, fixtures: [{ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }] },
  { name: "PermanentWriteResolution", schema: PermanentWriteResolutionSchema, fixtures: [
    { state: "fenced", intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT },
    { state: "recorded-observed-present", intent: WRITE_INTENT_FIXTURES[0] },
    { state: "existing", intent: WRITE_INTENT_FIXTURES[2] },
  ] },
  { name: "AtomicWriteCommitStorageStep", schema: AtomicWriteCommitStorageStepSchema, fixtures: AtomicWriteCommitStorageStepSchema.options },
  { name: "AtomicWriteCommitInput", schema: AtomicWriteCommitInputSchema, fixtures: [ATOMIC_WRITE_COMMIT], openFixturePaths: ["outcome.output.value", "terminalSpanOutbox.payload.outcome.output.value"] },
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
    ledgerOutbox: LEDGER_OUTBOX_RECORD,
    terminalSpanOutbox: SPAN_OUTBOX_RECORD,
  }], openFixturePaths: ["terminalSpanOutbox.payload.outcome.output.value"] },
  { name: "TerminalizationClaim", schema: TerminalizationClaimSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION.claim] },
  { name: "FailureTerminalAuthorizationRecord", schema: FailureTerminalAuthorizationRecordSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION] },
  { name: "SuccessTerminalAuthorizationRecord", schema: SuccessTerminalAuthorizationRecordSchema, fixtures: [SUCCESS_TERMINAL_AUTHORIZATION] },
  { name: "TerminalAuthorizationRecord", schema: TerminalAuthorizationRecordSchema, fixtures: [FAILURE_TERMINAL_AUTHORIZATION, SUCCESS_TERMINAL_AUTHORIZATION] },
  { name: "FailureTerminalizationRequest", schema: FailureTerminalizationRequestSchema, fixtures: [{
    failure: FAILURE,
    authorization: FAILURE_TERMINAL_AUTHORIZATION,
  }] },
  { name: "FailureTerminalizationReport", schema: FailureTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN },
    { state: "replayed", authorization: FAILURE_TERMINAL_AUTHORIZATION, failure: FAILURE, run: FAILED_RUN },
  ], openFixturePaths: ["run.input.raw", "run.input.parsed.value"] },
  { name: "FailureTerminalizationStorageStep", schema: FailureTerminalizationStorageStepSchema, fixtures: FailureTerminalizationStorageStepSchema.options },
  { name: "SuccessTerminalizationRequest", schema: SuccessTerminalizationRequestSchema, fixtures: [{
    result: RUN_RESULT,
    outbox: RUN_TERMINAL_OUTBOX,
    authorization: SUCCESS_TERMINAL_AUTHORIZATION,
  }], openFixturePaths: ["result.result.value"] },
  { name: "SuccessTerminalizationReport", schema: SuccessTerminalizationReportSchema, fixtures: [
    { state: "applied", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, outbox: RUN_TERMINAL_OUTBOX, run: DONE_RUN },
    { state: "replayed", authorization: SUCCESS_TERMINAL_AUTHORIZATION, result: RUN_RESULT, outbox: RUN_TERMINAL_OUTBOX, run: DONE_RUN },
  ], openFixturePaths: ["result.result.value", "run.input.raw", "run.input.parsed.value"] },
  { name: "SuccessTerminalizationStorageStep", schema: SuccessTerminalizationStorageStepSchema, fixtures: SuccessTerminalizationStorageStepSchema.options },
  { name: "BoundaryFailure", schema: BoundaryFailureSchema, fixtures: [{ kind: "boundary-failure", source: "config", summary: "invalid config", issues: [{ path: ["urls"], code: "invalid", message: "invalid URL" }] }] },
  { name: "Config", schema: ConfigSchema, fixtures: [ConfigSchema.parse({ paths: defaultRuntimePaths() })] },
  { name: "SettingsOverride", schema: SettingsOverrideSchema, fixtures: [{}] },
  { name: "EditableSettingsOverride", schema: EditableSettingsOverrideSchema, fixtures: [{}] },
  { name: "ResolvedConfig", schema: ResolvedConfigSchema, fixtures: [resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK)] },
  { name: "ConfigEnvBindings", schema: ConfigEnvBindingRegistrySchema, fixtures: [CONFIG_ENV_BINDINGS] },
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
  { name: "UiCatalog", schema: UiCatalogSchema, fixtures: [buildSafeUiCatalog()] },
  { name: "UiVerificationEvidenceManifest", schema: UiVerificationEvidenceManifestSchema, fixtures: [UI_EVIDENCE] },
  { name: "UiVerificationScenario", schema: UiVerificationScenarioSchema, fixtures: [...UCPATH_UI_REGISTRY.scenarios, ...CRM_UI_REGISTRY.scenarios] },
  { name: "CrmSubjectBinding", schema: CrmSubjectBindingSchema, fixtures: [CRM_SUBJECT_BINDING] },
  { name: "CrmOnboardingRecordRead", schema: CrmOnboardingRecordReadSchema, fixtures: [CRM_RECORD_READ] },
  { name: "CrmOnboardingDatesRead", schema: CrmOnboardingDatesReadSchema, fixtures: [CRM_DATES_READ] },
  { name: "SecretSpec", schema: SecretSpecSchema, fixtures: [SECRET_SPECS[0]] },
  { name: "SecretFamilySpec", schema: SecretFamilySpecSchema, fixtures: [SECRET_FAMILY_SPECS[0]] },
  { name: "SecretFileSpec", schema: SecretFileSpecSchema, fixtures: [SECRET_FILE_SPECS[0]] },
  { name: "SecretAvailability", schema: SecretAvailabilitySchema, fixtures: [{ name: "ucpathPassword", source: "protected-store", state: "unknown", diagnostic: "registered source could not be read" }] },
  { name: "ProtectedSecretSource", schema: ProtectedSecretSourceSchema, fixtures: [{ read: () => ({}) }] },
  { name: "TestTargetSecretSpec", schema: TestTargetSecretSpecSchema, fixtures: [TEST_TARGET_SECRET_SPECS[0]] },
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
  { name: "KnowledgeRecord", schema: KnowledgeRecordSchema, fixtures: [KNOWLEDGE] },
  { name: "FixRecord", schema: FixRecordSchema, fixtures: [FIX] },
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
  // In-process credential authority port: methods consume and return schema-derived data.
  "src/domain/config/credential-store.ts:CredentialStore",
  "src/core/runtime-composition.ts:RebuildRuntimeStart",
  // The dashboard composition seam handed to the CLI (1g): a process-lifetime
  // handle (port + stop), operational like RebuildRuntimeStart, not wire data.
  "src/core/runtime-composition.ts:RunningDashboard",
  // The dashboard's shutdown seam: one `subscribe` FUNCTION returning its
  // disposer, so like the clock it is an injected in-process dependency and no
  // schema can describe it. Nothing here is stored or served — the values that
  // cross are the OS signal names, already a closed literal union.
  "src/core/runtime-composition.ts:RuntimeShutdownSignals",
  "src/domain/canonical-json.ts:JsonObject",
  "src/domain/clock.ts:Clock",
  "src/domain/clock.ts:TestClock",
  // The id source is injected exactly like the clock, and for the same reason:
  // a value the caller cannot pin makes a durable record unassertable.
  "src/domain/identifiers.ts:IdFactory",
  "src/domain/preflight.ts:BuildPreflightReportInput",
  // The deadline scheduler is an injected process-timer surface: it carries
  // callbacks and cancellation functions, never durable or wire data.
  "src/domain/preflight.ts:PreflightDeadlineHandle",
  "src/domain/preflight.ts:PreflightDeadlineScheduler",
  "src/domain/preflight.ts:PreflightRunner",
  "src/domain/preflight.ts:PreflightRunnerContext",
  // D228 — the AUTHORED faces of `NodeConditionSchema`, exactly as
  // `WorkflowCapabilitiesSpec` is the authored face of its runtime schema. They
  // exist so a descriptor literal need not spell a brand; `parseNodeCondition`
  // runs the schema before anything durable, wire-bound, or executable sees the
  // value, and the schema-derived `NodeCondition` is what every consumer holds.
  "src/domain/workflow/node-condition.ts:NodeConditionOperandSpec",
  "src/domain/workflow/node-condition.ts:NodeConditionSpec",
  "src/domain/ui/driver.ts:MutationCapability",
  "src/domain/ui/driver.ts:CommitCapableSystemDriver",
  "src/domain/ui/driver.ts:SystemDriver",
  "src/domain/ui/ucpath-person-org.ts:UcpathPersonOrgScreens",
  "src/domain/ui/ucpath-person-org.ts:UcpathPersonOrgStates",
  "src/domain/ui/ucpath-person-org.ts:UcpathPersonOrgFields",
  "src/domain/ui/ucpath-person-org.ts:UcpathPersonOrgObservations",
  "src/domain/ui/ucpath-person-org.ts:UcpathPersonOrgDriver",
  // Chunk 4's Smart HR family, for the same reason as its Person Org sibling
  // above: these are DRIVER-SHAPE types — screen/state/observation unions and a
  // surface of functions — not data crossing a boundary. Every value they carry
  // IS schema-described (`UcpathTerminationTargetSchema`,
  // `UcpathTerminationStagingSchema`, `UcpathTransactionScanSchema`,
  // `UcpathTerminationProofSchema`, `UcpathPendingSweepProofSchema`), and a
  // schema over the driver itself would be describing a set of functions.
  "src/domain/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrScreens",
  "src/domain/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrStates",
  "src/domain/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrObservations",
  "src/domain/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrTerminationDriver",
  // The JOIN of the store's two driver halves (D197 rule 1: one declaration per
  // store). It adds no data of its own — it is the intersection of the two
  // allowlisted surfaces plus the shared `SystemDriver` navigation seam.
  "src/domain/ui/ucpath-driver.ts:UcpathStoreDriver",
  "src/domain/contracts/base.ts:ReadTaskContract",
  "src/domain/contracts/base.ts:PrepareTaskContract",
  "src/domain/contracts/base.ts:CommitTaskContract",
  "src/domain/contracts/base.ts:SealedReadContract",
  "src/domain/contracts/base.ts:SealedPrepareContract",
  "src/domain/contracts/base.ts:SealedCommitContract",
  "src/domain/contracts/base.ts:AnyReadTaskContract",
  "src/domain/contracts/base.ts:AnyPrepareTaskContract",
  "src/domain/contracts/base.ts:AnyCommitTaskContract",
  "src/domain/contracts/base.ts:AnyTaskContract",
  "src/domain/contracts/write-safety.ts:CanonicalJsonSchema",
  "src/domain/contracts/write-safety.ts:ProbeVerdict",
  "src/domain/contracts/write-safety.ts:ProofCheck",
  "src/domain/contracts/write-safety.ts:ReceiptCheck",
  "src/domain/contracts/write-safety.ts:SaveVerifyCheck",
  "src/domain/contracts/write-safety.ts:UploadVerifyCheck",
  "src/domain/contracts/write-safety.ts:CompletionCheck",
  "src/domain/contracts/write-safety.ts:Idempotency",
  "src/domain/contracts/write-safety.ts:WriteSafety",
  "src/domain/ids.ts:LiteralTaskId",
  "src/domain/session.ts:SessionNeed",
  // Workflow graph nodes carry pure functions (bind/choose/resolve) and are
  // generic over contract/schema type parameters, so no zod schema can describe
  // them. Their DURABLE halves do have schemas: DelegationPolicySchema,
  // DelegationManifestRefSchema, ParallelBranchSpecSchema, GraphNodeKindSchema,
  // transactionOutcomeSchema(), and childRunOutcomeSchema() are all catalogued.
  // A schema TYPE, like CanonicalJsonSchema above — it describes a validator,
  // not a value that crosses a boundary, so it cannot itself be schema-derived.
  "src/domain/workflow/canonical-input.ts:CanonicalInputSchema",
  "src/domain/workflow/graph.ts:ProofOf",
  "src/domain/workflow/graph.ts:WorkflowRef",
  "src/domain/workflow/graph.ts:AnyWorkflowRef",
  "src/domain/workflow/graph.ts:RuntimeScope",
  "src/domain/workflow/graph.ts:WorkflowGateSource",
  "src/domain/workflow/graph.ts:ExternalGateSource",
  "src/domain/workflow/graph.ts:GraphNodeBase",
  "src/domain/workflow/graph.ts:TaskStepNode",
  "src/domain/workflow/graph.ts:TypedTransactionOutcome",
  "src/domain/workflow/graph.ts:TransactionNode",
  "src/domain/workflow/graph.ts:BranchNode",
  "src/domain/workflow/graph.ts:ParallelNode",
  "src/domain/workflow/graph.ts:ChildRunOutcome",
  "src/domain/workflow/graph.ts:ChildRunNode",
  "src/domain/workflow/graph.ts:OperatorGateNode",
  "src/domain/workflow/graph.ts:ChildrenGateNode",
  "src/domain/workflow/graph.ts:ExternalGateNode",
  "src/domain/workflow/graph.ts:AnyGateNode",
  "src/domain/workflow/graph.ts:RuntimeFlowNode",
  // The pre-write fan-out plan is generic over its target workflow, so no static
  // schema describes it. Its DURABLE counterpart is `DelegationManifestSchema`
  // in `src/domain/dependencies.ts`, which is catalogued.
  "src/domain/workflow/delegation.ts:PlannedChild",
  "src/domain/workflow/delegation.ts:DelegationPlan",
  "src/domain/workflow/delegation.ts:DelegationFanOutRequest",
  "src/domain/workflow/delegation.ts:DelegationJoin",
  // The completion program is generic over its target workflow refs and carries
  // pure derive/eligibility functions, so no static schema describes it. What
  // DOES cross a boundary has one: PreviewRecordSchema, ApproveContextSchema,
  // ApprovedDocumentSchema, MemberPlanEntrySchema, CompletionProgramSampleSchema,
  // CompletionConsumptionSpecSchema, and CoordinatorPolicySchema are catalogued.
  // `SealedCompletionProgram` is deliberately opaque — a schema for it would
  // re-expose exactly the structure ref dashboard-surfaces §4.2 closes.
  "src/domain/workflow/completion.ts:NamedPredicate",
  "src/domain/workflow/completion.ts:PerRecordStage",
  "src/domain/workflow/completion.ts:PerDocumentStage",
  "src/domain/workflow/completion.ts:AnyFanOutStage",
  "src/domain/workflow/completion.ts:FanOutStages",
  "src/domain/workflow/completion.ts:StagedFanOut",
  "src/domain/workflow/completion.ts:CompleteThenEnqueue",
  "src/domain/workflow/completion.ts:CompletionProgram",
  "src/domain/workflow/completion.ts:CompletionRevealKey",
  "src/domain/workflow/completion.ts:SealedCompletionProgram",
  // The checkpoint LOAD result and its migrations are generic over the producing
  // contract's exact output type, which no static schema describes — that is the
  // point of the discriminated `{found}` union. The durable halves have schemas:
  // RunCheckpointRecordSchema, FactProvenanceSchema, CheckpointExpectationSchema,
  // CheckpointMissReasonSchema, and FreshnessOverrideSchema are catalogued.
  "src/domain/workflow/checkpoint.ts:CheckpointLoad",
  "src/domain/workflow/checkpoint.ts:CheckpointMigration",
  "src/domain/workflow/checkpoint.ts:CanonicalInputSnapshotMigration",
  "src/domain/workflow/checkpoint.ts:ReplayedCheckpoint",
  "src/domain/workflow/checkpoint.ts:FreshnessWalkInput",
  // A canonical field carries a `coerce` FUNCTION and is generic over the exact
  // zod schema it owns, so no schema can describe it — describing it would mean
  // describing a validator, like `CanonicalJsonSchema` above. `CellLocation` is
  // the in-process address of one cell during validation; it is never stored
  // and never served. What DOES become durable has schemas: RowRejectSchema and
  // IntakePlanManifestSchema carry the same facts and are catalogued.
  "src/domain/fields/registry.ts:CanonicalField",
  "src/domain/fields/cell-coercion.ts:CellLocation",
  // An intake projection holds the workflow's own zod schema and a lookup
  // FUNCTION, so like the graph nodes above it cannot be schema-described. Its
  // durable half is `IntakeTargetSchema`, and the fingerprint it derives is
  // what a saved `ColumnMapping` actually stores.
  "src/domain/intake/projection.ts:IntakeProjection",
  // The validation pass is an in-process call: its input carries the workflow's
  // own `deriveItemId` FUNCTION and a live `IntakeProjection`, and its result is
  // consumed by `buildIntakeManifest` in the same call stack. Nothing here is
  // stored or served. The DURABLE halves all have schemas: IntakePlanManifest,
  // RowReject, ValidRow, SourceRowDisposition and IntakeCorrection.
  "src/domain/intake/validate.ts:IntakeValidationInput",
  "src/domain/intake/validate.ts:ValidatedRow",
  "src/domain/intake/validate.ts:IntakeValidationResult",
  // Same shape one level up (D171): the enqueue derivation takes a live
  // `IntakeProjection` and the workflow's own `deriveItemId` FUNCTION, and hands
  // back the manifest plus its readiness verdict in the same call stack. Both
  // durable halves ARE schema-described — `IntakePlanManifestSchema` is what the
  // authority row stores and `EnqueueReadinessSchema` is what gates it.
  "src/domain/intake/enqueue.ts:IntakeEnqueueSessionView",
  "src/domain/intake/enqueue.ts:IntakeEnqueuePlan",
  "src/domain/intake/enqueue.ts:IntakeEnqueuePlanInput",
  // D288's pseudonym domain holds a secret key inside an in-process closure and
  // exposes one derivation FUNCTION. Its only crossing values are described by
  // ActivityPersonPseudonymEvidenceSchema and the strict backfill schemas.
  "src/domain/trust/activity-person-pseudonym.ts:ActivityPersonPseudonymDomain",
  // D307 — a step omission's declaration carries per-node PRODUCER functions
  // and the plan/cascade are in-process values over Maps; their crossing halves
  // ARE schema-described: StepOmissionFormSchema (the form a step declares),
  // StepOmissionsSchema (the envelope entries), and the not-run reason enums.
  "src/domain/workflow/step-omission.ts:StepOmissionProduceContext",
  "src/domain/workflow/step-omission.ts:StepOmissionDeclaration",
  "src/domain/workflow/step-omission.ts:StepOmissionSpec",
  "src/domain/workflow/step-omission.ts:StepOmissionGraphView",
  "src/domain/workflow/step-omission.ts:StepOmissionRefusal",
  "src/domain/workflow/step-omission.ts:StepOmissionPlan",
  "src/domain/workflow/step-omission.ts:StepOmissionCascadeRow",
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
        && !(path === "src/domain/canonical-json.ts" && node.name.text === "JsonValue")) {
        violations.push(`${identity}: exported boundary type is not schema-derived`);
      }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Record"
      && node.typeArguments?.length === 2) {
      const value = node.typeArguments[1];
      if (value.kind === ts.SyntaxKind.UnknownKeyword
        || ts.isTypeReferenceNode(value) && ts.isIdentifier(value.typeName) && value.typeName.text === "JsonValue") {
        violations.push(`${path}: decision-bearing open Record is forbidden at a boundary`);
      }
    }
    const constAssertion = ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "const";
    if ((ts.isAsExpression(node) && !constAssertion) || ts.isTypeAssertionExpression(node)) {
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
    for (const entry of BOUNDARY_SCHEMA_CATALOG) {
      assert.deepEqual(strictnessViolations(entry.schema), [], entry.name);
      for (const fixture of entry.fixtures) assert.equal(entry.schema.safeParse(fixture).success, true, entry.name);
    }
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

  it("keeps every current domain boundary source free of unsafe escape hatches", () => {
    const violations = gitVisibleFiles(["src/domain", "src/core/runtime-composition.ts"])
      .filter((path) => path.endsWith(".ts"))
      .flatMap((path) => boundarySourceViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });
});
