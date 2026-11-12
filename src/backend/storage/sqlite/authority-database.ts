import { createWorkerSlotRepository, workerSlotFromRow } from "./worker-slots.js";
import { stoppedProfileOwnsCredentialCommand } from "../configuration/protected-settings-upgrade.js";
import { collectEvidenceSchemaAdmissions } from "./evidence-schema-upgrade.js";
import { evidenceSchemaSourceDigest, type EvidenceSchemaOwner } from "../../../models/storage/evidence-schema-admission.js";
import { artifactReferencesIn, deletionArtifactReferenceMatcher } from "./artifact-references.js";
import { fileStatus } from "../file-identity.js";
import { assertMaintenanceCustodyAvailable } from "../maintenance/custody-availability.js";
import { deriveEvidenceReceiptId } from "../../../models/trust/evidence-identity.js";
import { CURRENT_RUN_SETTLEMENT_SQL, readRunSettlementRow, runSettlementContext, runSettlementColumns } from "./run-settlement-row.js";
import { convertPersonPreferencesRow } from "./person-preferences-migration.js";
import { readContinuationGate, validateRunContinuation } from "./run-continuation.js";
import { AuthenticatedRunContinuation } from "./run-continuation-delegation.js";
import type { ChildProcess } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { existsSync,statSync } from "node:fs";
import { basename,dirname,join } from "node:path";
import { DatabaseSync,backup as sqliteBackup } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ArtifactRefSchema,type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { AUTHORITY_TABLE_REGISTRY,AuthorityTableNameSchema,AuthorityEvidenceSchemaUpgradeRecordSchema,AuthorityUpgradeRecordSchema,ProjectionTableNameSchema,type AuthorityTableName,type RunRecordRefusal,type TableName } from "../../../models/config/authority.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import { type ActiveRuntimeConfigRecord,type RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import { type SettingsCurrentRecord } from "../../../models/config/settings-current.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema,type ConfigSnapshotRecord,ConfigSnapshotWriteSchema } from "../../../models/config/snapshot.js";
import { RunSearchRebuildRequestSchema } from "../../../models/dashboard/search-index.js";
import { ConfirmationPublicationSchema,confirmationPublicationFromRow,confirmedOperationTimeline,reconstructConfirmedOperation,type ConfirmationPublication } from "../../../models/events/confirmed-operation.js";
import { TimelineEventRecordSchema,TimelinePageRequestSchema,timelineAppendContent,timelineCheckpointReference,type TimelineAppend,type TimelineRepository } from "../../../models/events/timeline.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { bindErrorOrigin } from "../../../models/failures/error-origins.js";
import { IntakePlanManifestSchema } from "../../../models/intake/manifest.js";
import { IntakeSessionSchema } from "../../../models/intake/session.js";
import { NotificationFoldRequestSchema,NotificationRecordOutcomeSchema,NotificationRecordSchema,NotificationStateRequestSchema,notificationCollectionTarget,requireMutableNotification,type NotificationCollectionOperation,type NotificationCollectionTarget,type NotificationRecord,type NotificationRecordOutcome } from "../../../models/notifications/notifications.js";
import { StoredOcrExtractionSchema, type StoredOcrExtraction } from "../../../models/ocr/stored-extraction.js";
import { OcrPageReadingSchema } from "../../../models/workflows/ocr/page-accounting.js";
import { AssistantActionRecordSchema,AssistantChatRecordSchema,AssistantGrantRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { LogoutOperationSchema,ProfileDatabaseBindingSchema,type LogoutOperation } from "../../../models/profiles/profile.js";
import { completionFromAuthorization } from "../../../models/run/completion.js";
import { DeletedRunRecordSchema,RunDeleteInputSchema,type DeletedRunRecord } from "../../../models/run/deleted-run.js";
import { PredecessorRunRecordSchema,RunRecordSchema,runClaim,runTransitionViolation,type PredecessorRunRecord,type RunRecord } from "../../../models/run/record.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { RunResultRecordSchema, readRunPreviewResult,createRunTerminalEvidenceResult,deriveCheckpointOutputDigest,deriveCheckpointProvenanceDigest,deriveTerminalFailureDigest,terminalDelegationDependencyRecord,terminalGateDependencyRecord,refreshedRunSettlement,terminalEvidenceResult,type RunResultRecord } from "../../../models/run/result.js";
import { RunSessionRecordSchema,type RunSessionRecord } from "../../../models/run/session.js";
import { StartPlanRecordSchema,isStartPlanExpired,type StartPlanRecord } from "../../../models/run/start-plan.js";
import { FailureTerminalAuthorizationRecordSchema,TerminalAuthorizationRecordSchema,type TerminalAuthorizationRecord } from "../../../models/run/terminal-authorization.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { WorkerPoolRecordSchema,workerPoolVersion,type WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { CanonicalCrashRecoveryRequestSchema,RunClaimTokenSchema } from "../../../models/run/worker.js";
import { DiagnosticBundleSchema,type DiagnosticBundle } from "../../../models/trust/diagnostic.js";
import { deriveBulkChildCommand,deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import { AuthorityCommandAuditRecordSchema,AuthorityCommandRecordSchema,BulkParentCommandRecordSchema,BulkRunCommandAcceptanceRecordSchema,CommandAuditRecordSchema,CommandIdentityConflictError,CommandRequestSchema,RunLifecycleCommandAuditRecordSchema,RunLifecycleCommandRecordSchema,StoredAuthorityCommandRecordSchema } from "../../../rules/commands/commands.js";
import { deriveStableUuid,lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { deriveCanonicalPerson } from "../../../rules/runs/summary-derivation.js";
import { interruptTransition } from "../../../rules/runs/run-interrupt.js";
import { capturedInstantClock } from "../../../rules/time/clock.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { DelegationManifestSchema,DependencyRecordSchema,delegationJoinDisposition,type DelegationManifest,type DelegationReadiness } from "../../../rules/workflow/dependencies.js";
import { authenticateAuditedParkedWriteResolution,authenticateParkedWriteRecheck,authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { type InstallationLease } from "../admission/installation.js";
import { RuntimeLifetimeLock,offlineMaintenanceWorkspace,type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { assertOfflineMaintenanceForProcessRoot } from "../admission/process-root.js";
import { inspectArtifactDeletionFile,pendingDiagnosticArtifacts,reclaimDiagnosticStages,removeArtifactDeletionFile } from "../artifacts/content-addressed-artifact-writer.js";
import { fileIdentityObservation,sameDirectory,type DirectoryIdentity, clearOperationProofSlots,outermostOperationProof,readPrivateFile,revalidateOperationProof,withOperationProof } from "../configuration/credential-safe-file.js";
import { assertCredentialStoreOwner } from "../configuration/credential-store.js";
import { readTimelineRecords } from "../events/timeline-reader.js";
import { profileAuthorityFileWitnesses } from "../maintenance/existing-data-backup-files.js";
import { fixedLayoutOutputPaths,fixedLayoutSettingsUpdate,readFixedLayoutIntent,type FixedLayoutActivation } from "../maintenance/fixed-layout.js";
import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { privatePathRejects } from "../private-path.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { createAssistantAuthorizationRepository } from "./assistant-authorization.js";
import { createAssistantModelPreferenceRepository } from "./assistant-model-preference.js";
import { NativeCommandAuditSchema,commandFromRow,insertNativeCommand,settleNativeCommand,settledRunDeletionIds } from "./command-record-row.js";
import { authoritySourceDatabaseIdentity,type AuthorityBackupExpectedSource } from "./database-identity.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { extractedArtifactFromRow } from "./extracted-artifact-row.js";
import { createOcrReviewRepository } from "./ocr-review.js";
import { createFailureResolutionRepository } from "./failure-resolution.js";
import { createGeneratedArtifactRepository,generatedArtifactFromRow } from "./generated-artifacts.js";
import { createImportedArtifactRepositories,importedArtifactFromRow } from "./imported-artifacts.js";
import { isNativeOrdinaryTable,nativeOrdinaryRecordFromRow,type NativeOrdinaryTable } from "./native-record-row.js";
import { deletionArtifactValues,executeNativeRunDeletion,prepareNativeRunDeletion } from "./native-run-deletion.js";
import { createNotificationMetadataRepositories,validateNotificationMetadata } from "./notification-publications.js";
import { createReadonlyAuthoritySnapshot,withAuthorityDatabaseReadOnly,withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { deletePreBuildRuns } from "./pre-build-run-deletion.js";
import { assertWorkerCustodyConverted, convertWorkerCustody, execMigrationStatement } from "./worker-custody-migration.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { assertPredecessorWorkerHistory, isPredecessorWorkerHistory, predecessorCommandFromRow, predecessorCustodyRunFromRow, predecessorCustodyRunRow, predecessorLifecycleRequest, predecessorWorkerSlotFromRow } from "./worker-custody-predecessor.js";
import { predecessorRunRecordFromRow,runRecordColumns,runRecordFromRow,transitionRunRecord,transitionStoredRun,updateRunRecord } from "./run-record-row.js";
import { createRunSearchIndex,runSearchIndexFromRow } from "./run-search-index.js";
import { continuationDelegationGroups } from "./run-continuation-delegation.js";
import { ApplicationAdmissionHoldSchema, ApplicationAdmissionReleaseSchema, type ApplicationAdmissionRequestSchema, CanonicalPauseRequestSchema,RunClaimOutcomeSchema,RunClaimRequestSchema,RunHeartbeatOutcomeSchema,RunHeartbeatRequestSchema,RunInjectPatchesRequestSchema,RunItemQuerySchema,RunPresentationRequestSchema,RunPriorityBumpRequestSchema,RunRequeueRequestSchema,RunResumeRequestSchema,RunTransitionRequestSchema,RunUpdateOutcomeSchema,StartPlanConsumeOutcomeSchema,StartPlanConsumeRequestSchema,WorkerPoolPlanOutcomeSchema,WorkerPoolPlanRequestSchema,type RunClaimOutcome,type RunHeartbeatOutcome,type RunUpdateOutcome,type StartPlanConsumeOutcome,type WorkerPoolPlanOutcome,type RunAdmission,} from "./run-store-contracts.js";
import { createRunSummaries } from "./run-summaries.js";
import { createSettingsActivationRepositories } from "./settings-activation.js";
import { readAppSettings, migratePersonPreferences } from "./settings-storage.js";
import { TimelineRecordError,createTimelineRepository,timelineEventFromRow } from "./timeline-repository.js";
import { RecoveryActivitySchema, recoveryActivitySpanPath } from "../../../models/run/recovery-activity.js";
import { createTransactionHistory } from "./transaction-history.js";
import { selectTransactions } from "./transaction-selection.js";
import { createWorkbookLibraryRepository,hasOnlyInitialWorkbookType,validateWorkbookLibrary } from "./workbook-library-repository.js";

import { DryRunScenarioResultSchema,type DryRunScenarioResult } from "../../../models/trust/dry-run-scenario-result.js";
import { DryRunWriteSafetyCountsSchema } from "../../../models/trust/dry-run-scenario.js";
import { RunEvidenceReceiptSchema,type RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { FailureRecordSchema,failureCauseNames,settledWriteState,type FailureRecord } from "../../../models/trust/failure.js";
import { RunCheckpointRecordSchema,checkpointLookupKey,checkpointRecordKey,type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { ActorIdSchema,ArtifactIdSchema,BrowserSystemIdSchema,CommandAuditIdSchema,CommandIdSchema,DiagnosticBundleIdSchema,FailureIdSchema,FailureFingerprintSchema,FingerprintSchema,GateIdSchema,IsoInstantSchema,ItemIdSchema,LOCAL_OPERATOR_ACTOR_ID,PositiveIntSchema,RunIdSchema,RunSessionIdSchema,TraceIdSchema,WorkerIdSchema,WorkflowIdSchema,WriteIntentIdSchema } from "../../../rules/identity/ids.js";
import { DuoCeremonyLeaseAcquireRequestSchema,DuoCeremonyLeaseRecordSchema,DuoCeremonyLeaseReleaseOutcomeSchema,DuoCeremonyLeaseTakeoverSchema,isDuoCeremonyLeaseLive,type DuoCeremonyLeaseAcquireRequest,type DuoCeremonyLeaseRecord,type DuoCeremonyLeaseReleaseOutcome } from "../../../rules/sessions/duo-ceremony-lease.js";
import { localDatePart,systemClock,type Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { IdempotencyKeySchema,WriteAttemptRecordSchema,WriteIntentRecordSchema,type WriteAttemptRecord,type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { WriteEvent } from "../../../rules/write-safety/write-transitions.js";
import { isDuoCeremonyLeaseToken,mintDuoCeremonyLeaseToken,retireDuoCeremonyLeaseToken,type DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { assertWorkflowRunResultAuthorization,workflowDelegationAccounting,descriptorRuntimeNodes,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { assertCredentialCopyResourcesClosed, assertLogoutResourcesClosed } from "../maintenance/profile-custody.js";
import type { VerifiedBackup } from "./backup-service.js";
import { admitDelegationRefresh, authenticateDelegationRefresh, settleDelegationRefresh } from "./delegation-refresh.js";
import { newDelegationAuthenticationMemo,type DelegationAuthenticationMemo,currentDelegationManifests,assertDelegationReplacement,authenticateCancellationSource,authenticateDelegationDependency,authenticateDelegationGroup,authenticateDescendantHome,memoizedDelegationGroup,childTerminalSettlement,delegationEdgeForChild,lifecycleChildEdge,prepareDelegationRetry,readDelegationCancellation,readDelegationEvidence,readDelegationInvocationEvidence,readDelegationReadiness,readQueueParents,readDelegationWait,readDelegationWaitState,retainedDelegationManifests } from "./delegation-authority.js";
import { DelegationRetryRequestSchema,DelegationSettlementRequestSchema } from "./delegation-contracts.js";
import { createExclusiveSessionLeaseRepository, exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { AUTHORITY_APPLICATION_ID,BUILD_ID_ENVELOPE_SCHEMA_VERSION,CURRENT_AUTHORITY_SCHEMA_VERSION,WORKER_CUSTODY_DROPPED_TABLES,WORKER_CUSTODY_SCHEMA_VERSION,isWorkerCustodyDroppedTable,SQLITE_MIGRATIONS,WORKER_CUSTODY_CONVERSION_ID,WORKER_CUSTODY_SCAN_ID,auditMigrationTableCoverage,deriveAuthorityUpgradePlanDigest,isCurrentAuthoritySchemaVersion,isSupportedStoppedAuthoritySchemaVersion,migrationTableNames,OPENABLE_AUTHORITY_SCHEMA_VERSIONS,UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS,tableClassification } from "./migrations.js";
import { AuthorityCopyInspectionSchema,SpanAuthorityReadSnapshotSchema,SpanAuthorityRunResolutionSchema,SpanAuthorityRunRootSchema,type AuthorityCopyInspection,type SpanAuthorityReadSnapshot,type SpanAuthorityRunRoot } from "./recovery-contracts.js";
import { FailureTerminalizationReportSchema,FailureTerminalizationRequestSchema,SuccessTerminalizationReportSchema,SuccessTerminalizationRequestSchema,type FailureTerminalizationReport,type FailureTerminalizationStorageStep,type SuccessTerminalizationReport,type SuccessTerminalizationStorageStep } from "./run-terminal-contracts.js";
import { DiagnosticAttachmentStorageRecordSchema,type ArtifactOutboxStorageRecord,type ArtifactSinkHeadRecord,type DiagnosticAttachmentStorageRecord } from "./storage-records.js";

import { applyWriteTransition,AtomicWriteCommitInputSchema,AtomicWriteCommitReportSchema,PermanentWriteResolutionSchema,ResolvedParkedWriteAbsenceInputSchema,ResolvedParkedWriteCommitInputSchema,WriteFenceInputSchema,WriteFenceRecordsSchema,WriteIntentParkRequestSchema,WriteIntentRetrySettlementRequestSchema,WriteRecheckParkRequestSchema,WriteRecheckRequestSchema,WriteRefenceInputSchema,type AtomicWriteCommitReport,type AtomicWriteCommitStorageStep,type PermanentWriteResolution } from "./write-commit-contracts.js";


export class AuthoritySchemaVersionError extends Error {
  readonly code = "authority-schema-mismatch";
  constructor(readonly schemaVersion: number) {
    super(`authority schema ${schemaVersion} does not match supported ${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
    this.name = "AuthoritySchemaVersionError";
  }
}
bindErrorOrigin(AuthoritySchemaVersionError, error => error.schemaVersion > CURRENT_AUTHORITY_SCHEMA_VERSION ? "profile-newer" : "unknown-error");

/** A registered person database this build must not read or repair: newer, or an unsupported format. */
export class AuthorityFormatUnsupportedError extends Error {
  constructor(readonly code: "STORAGE_PROFILE_NEWER_VERSION" | "STORAGE_PROFILE_FORMAT_UNSUPPORTED", options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "AuthorityFormatUnsupportedError";
  }
}
bindErrorOrigin(AuthorityFormatUnsupportedError, error => error.code === "STORAGE_PROFILE_NEWER_VERSION" ? "profile-newer" : "profile-format-unsupported");

export class AuthorityWriterBusyError extends Error {
  readonly code = "DATABASE_WRITER_UNAVAILABLE";
  constructor(options: ErrorOptions) {
    super("authority-writer-busy: database is locked", options);
    this.name = "AuthorityWriterBusyError";
  }
}

export const AuthorityDatabaseOpenModeSchema = z.enum([
  "read-write",
  "storage-backup-read-only-no-migrate",
  "storage-doctor-read-only-no-migrate",
  "storage-upgrade-preflight-read-only-no-migrate",
]);

export const AuthorityDatabaseOptionsSchema = z.strictObject({
  path: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  migrationOwner: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  openMode: AuthorityDatabaseOpenModeSchema.default("read-write"),
});

export const AuthorityMetaSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  installationId: z.uuid(),
  profileId: z.uuid(),
  authorityGeneration: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const AuthoritySchemaInspectionSchema = z.strictObject({
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  authorityGeneration: z.number().int().nonnegative(),
  pragmas: z.strictObject({
    journalMode: z.literal("wal"),
    foreignKeys: z.literal(1),
    synchronous: z.literal(2),
    busyTimeoutMs: z.number().int().positive(),
  }),
  tables: z.array(z.strictObject({
    name: z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]),
    classification: z.enum(["authority", "projection"]),
  })),
});

export const ImmutableInsertDispositionSchema = z.enum(["inserted", "existing"]);


export const DiagnosticPurgeDispositionSchema = z.enum(["purged", "absent"]);

/** Delegation reads one locked operation reuses: group proofs and invocation commands. */
type DelegationOperationReads = {
  memo: DelegationAuthenticationMemo;
  invocations: Map<string, readonly z.infer<typeof RunLifecycleCommandRecordSchema>[]>;
};

type ImmutableInsertResult<RecordValue> = Readonly<{
  state: z.infer<typeof ImmutableInsertDispositionSchema>;
  record: RecordValue;
}>;

type ImmutableRepository<RecordValue> = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RecordValue>;
  get(recordKey: string): RecordValue | undefined;
}>;

type ReadRepository<RecordValue> = Readonly<{
  get(recordKey: string): RecordValue | undefined;
}>;

type CommandNoticeRead = Readonly<{
  request: z.infer<typeof CommandRequestSchema>;
  state: "admitted" | "executing" | "succeeded" | "refused" | "uncertain";
  result?: z.infer<typeof CommandAuditRecordSchema>["result"];
}>;
type CommandRepository = Readonly<{
  assertIdentity(input: unknown, parentCommandId?: string): void;
  insert(input: unknown, parentCommandId?: string): ImmutableInsertResult<z.infer<typeof CommandRequestSchema>>;
  acceptBulk(input: unknown): ImmutableInsertResult<z.infer<typeof BulkRunCommandAcceptanceRecordSchema>>;
  getBulk(commandId: string): z.infer<typeof BulkRunCommandAcceptanceRecordSchema> | undefined;
  readForNotice(commandId: string): CommandNoticeRead | undefined;
  listBulkChildren(bulkCommandId: string): readonly CommandNoticeRead[];
  parentId(commandId: string): string | null | undefined;
  get(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
  getSettingsHistory(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
  findProtectedSettingsCommandIdByWriteId(input: unknown): string | undefined;
  listRunResumes(runId: string, expectedVersion: number): readonly z.infer<typeof CommandRequestSchema>[];
  listRunBumpCommands(runId: string): readonly z.infer<typeof CommandRequestSchema>[];
}>;
type CommandAuditRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandAuditRecordSchema>>;
  get(auditId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findByCommand(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findSettingsHistory(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  /** Parked-write check audits for one run, oldest first. */
  parkedWriteChecks(runId: string): readonly z.infer<typeof CommandAuditRecordSchema>[];
}>;

type RunLifecycleJournalRepository = Readonly<{
  insertCommand(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandRecordSchema>>;
  getCommand(commandId: string): z.infer<typeof AuthorityCommandRecordSchema> | undefined;
  insertAudit(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandAuditRecordSchema>>;
  findAuditByCommand(commandId: string): z.infer<typeof AuthorityCommandAuditRecordSchema> | undefined;
  findContinuationIssue(runId: string, appliedVersion?: number): z.infer<typeof RunLifecycleCommandAuditRecordSchema> | undefined;
  findRunResume(runId: string, throughVersion?: number): z.infer<typeof RunLifecycleCommandAuditRecordSchema> | undefined;
  findDelegationParentHold(runId: string, sourceCommandId: string, appliedVersion: number): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  findRunOrigin(runId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  findGatePark(runId: string, gateId: string, throughVersion: number): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  findCancellation(runId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  listDelegationInvocations(parentRunId: string): readonly z.infer<typeof RunLifecycleCommandRecordSchema>[];
  listDelegationRefreshes(runId: string): readonly z.infer<typeof RunLifecycleCommandRecordSchema>[];
  findDelegationInvocation(manifestId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  listDelegationAdmissions(runId: string, claimGeneration: number): readonly z.infer<typeof RunLifecycleCommandRecordSchema>[];
  findDelegationOwner(runId: string, claimGeneration: number, throughVersion: number): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
}>;

type RuntimeConfigRepository = Readonly<{
  matchesClaim(input: unknown): boolean;
  matchesRun(configFingerprint: string, runFingerprint: string): boolean;
  hasHistory(): boolean;
  hasAdvancedHistory(): boolean;
  get(): ActiveRuntimeConfigRecord | undefined;
  initialize(input: unknown, identity?: Readonly<{ commandId: string; auditId: string }>): ActiveRuntimeConfigRecord;
  activate(input: unknown): ActiveRuntimeConfigRecord;
  requireActive(input: unknown): RuntimeConfigClaimToken;
  requireSettingsCurrent(): void;
}>;

type SettingsCurrentRepository = Readonly<{
  get(): SettingsCurrentRecord | undefined;
  hasHistory(): boolean;
  hasAuditHistory(): boolean;
  advance(input: unknown): SettingsCurrentRecord;
}>;



type DependencyRepository = Readonly<{
  authenticateGroup(manifest: DelegationManifest): ReturnType<typeof authenticateDelegationGroup>;
  parents(envelopes: readonly RunRecord["envelope"][]): ReturnType<typeof readQueueParents>;
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof DependencyRecordSchema>>;
  get(dependencyId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  listByParentRun(parentRunId: string): readonly z.infer<typeof DependencyRecordSchema>[];
  activateRetry(input: unknown, now: string, refreshAuthorization?: object): void;
  refreshAfterRetry(input: unknown, authorization: object, now: string): RunRecord;
  settle(input: unknown): z.infer<typeof DependencyRecordSchema>;
  reconcile(parentRunId: string, now: string): void;
  members(manifestId: string): ReturnType<typeof authenticateDelegationGroup>["children"];
  groups(parentRunId: string, selection?: "current" | "retained"): ReturnType<typeof continuationDelegationGroups>;
  childHistory(dependencyId: string): readonly string[];
  lifecycleEdgeForChild(parentRunId: string, childRunId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  edgeForChild(parentRunId: string, childRunId: string): z.infer<typeof DependencyRecordSchema>;
  cancellationOutcome(runId: string): ReturnType<typeof readDelegationCancellation>;
  evidence(parentRunId: string, nodeId: string): ReturnType<typeof readDelegationEvidence>;
  continuedEvidence(parentRunId: string, nodeId: string, edgeId: string): ReturnType<AuthenticatedRunContinuation["delegation"]>;
  readiness(parentRunId: string, intent: "join" | "cancel"): DelegationReadiness;
  waitState(parentRunId: string): ReturnType<typeof readDelegationWaitState>;
  wait(parentRunId: string, descriptor: AnyWorkflowDescriptor): ReturnType<typeof readDelegationWait>;
}>;

type WriteIntentRepository = Readonly<{
  getPublication(id:string): ConfirmationPublication | undefined;
  authenticatedDeletion(runId:string, publication:ConfirmationPublication): boolean;
  listByBusinessKey(system: unknown, digest: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];

  listAttemptingByItem(input: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];
  recordObservedPresent(input: unknown): PermanentWriteResolution;
  fenceAttempt(input: unknown): PermanentWriteResolution;

  refenceRetryable(input: unknown): PermanentWriteResolution;
  requestRecheck(input: unknown): WriteIntentRecord;
  parkRecheck(input: unknown): WriteIntentRecord;
  /** Ref write-safety §4 arm 3: CAS `attempting` → `parked` on intent AND current attempt. */
  parkAttempt(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  /** Stabilized negative evidence settles only an attempting callback. */
  settleRetryable(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  get(writeIntentId: string): z.infer<typeof WriteIntentRecordSchema> | undefined;
  findByPermanentKey(system: unknown, idempotencyKey: unknown): z.infer<typeof WriteIntentRecordSchema> | undefined;
  // Intents outlive runs; join exact write authority through its binding proof, never assumed run columns.
  listByRun(runId: string): readonly z.infer<typeof WriteIntentRecordSchema>[];
  // Dry-run attempt and outbox evidence join through the run's intent rows because they have no run ID.
  countDryRunEvidenceByRun(runId: string): z.infer<typeof DryRunWriteSafetyCountsSchema>;
}>;

export type PendingLogoutServices = Readonly<{
  browserClosure: ProfileBrowserClosure;
  recover(database: AuthorityDatabase, operation: LogoutOperation, lifetime: RuntimeLifetimeLock): void;
}>;

export interface AuthorityWriteCommitHooks {
  afterStorageStep(step: AtomicWriteCommitStorageStep): void;
}

export interface AuthorityTerminalizationHooks {
  afterFailureStorageStep?(step: FailureTerminalizationStorageStep): void;
  afterSuccessStorageStep?(step: SuccessTerminalizationStorageStep): void;
}

export interface AuthorityLifecycleHooks {
  afterClaimSelection?(): void;
  afterRunWrite?(run: RunRecord): void;
  afterDeletionFileRemoved?(event: Readonly<{ runId: string; digest: string }>): void;
  afterDeleteStep?(event: Readonly<{
    runId: string;
    step: "tombstone" | "cascade-complete" | DeletedRunRecord["removed"][number]["table"];
  }>): void;
}


type RunCheckpointRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RunCheckpointRecord>;
  get(
    workflowId: string,
    itemId: string,
    nodeId: string,
    attempt: number,
    claimGeneration: number,
  ): RunCheckpointRecord | undefined;
  /** The LATEST EXECUTION — highest attempt, then highest claim generation. */
  latest(workflowId: string, itemId: string, nodeId: string): RunCheckpointRecord | undefined;
  /** Every execution of one node inside one attempt, in the order they ran. */
  listByAttempt(
    workflowId: string,
    itemId: string,
    nodeId: string,
    attempt: number,
  ): readonly RunCheckpointRecord[];
  /** Ref operator-trust §2.3: a receipt explains one logical item across every attempt. */
  listByItem(workflowId: string, itemId: string): readonly RunCheckpointRecord[];
}>;



type DeletedRunRepository = Readonly<{
  get(runId: string): DeletedRunRecord | undefined;
  list(): readonly DeletedRunRecord[];
}>;

type CanonicalRunClaimOutcome = RunClaimOutcome | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>;

/** A confirmed Pause all and quit of the bound runtime generation (`held`) that no application-admission release names; binds the generation twice. */
const UNRELEASED_QUIT_HOLD_SQL = `held.family='application'
  AND json_extract(held.request_json,'$.type')='pause-all-and-quit'
  AND json_extract(held.request_json,'$.payload.confirmed')=1
  AND json_extract(held.request_json,'$.target.runtimeGeneration')=?
  AND NOT EXISTS(SELECT 1 FROM commands release WHERE release.state IN ('executing','succeeded') AND release.family='run-lifecycle'
    AND json_extract(release.request_json,'$.operation')='application-admission'
    AND json_extract(release.request_json,'$.request.runtimeGeneration')=?
    AND json_extract(release.request_json,'$.request.releases')=held.id)`;

type RunRepository = Readonly<{
  holdAdmission(input: unknown): void;
  releaseQuitAdmission(input: unknown): void;
  admission(): RunAdmission;
  /** The current runtime's unreleased Pause all and quit, whether or not an earlier hold also closes admission. */
  quitAdmission(): string | undefined;

  enqueue(input: unknown): ImmutableInsertResult<RunRecord>;

  assertDeletionAllowed(input: unknown): void;
  delete(input: unknown): DeletedRunRecord;
  get(runId: string): RunRecord | undefined;
  /** A bounded, keyset-ordered read over exact non-archived run authority. */
  search(input: unknown): RunSearchAuthorityPage;
  listByItem(input: unknown): readonly RunRecord[];

  nextItemAttempt(input: unknown): number;

  nextWorkflowRunNumber(workflow: string): number;
  listByWorker(workerId: string): readonly RunRecord[];

  listBySession(sessionId: string): readonly RunRecord[];

  listParkedAtGate(): readonly RunRecord[];
  listChildren(parentRunId: string): readonly RunRecord[];

  findByTrace(traceId: string): RunRecord | undefined;

  listByWorkflow(workflow: string): readonly RunRecord[];
  listActiveOwners(workflow: string): readonly Readonly<{ workerId: string; runId: string }>[];
  listPage(input: Readonly<{ workflow?: string; offset: number; limit: number }>): readonly RunRecord[];

  listCurrentByWorkflow(workflow: string): readonly RunRecord[];
  listByPauseState(state: "requested" | "paused"): readonly RunRecord[];

  listWorkflows(): readonly string[];
  claimNext(input: unknown): RunClaimOutcome;

  claimEligible(input: unknown, admit?: (run: RunRecord) => void, eligible?: (run: RunRecord) => boolean): CanonicalRunClaimOutcome;
  renewClaim(input: unknown): RunHeartbeatOutcome;
  transition(input: unknown): RunUpdateOutcome;
  requeue(input: unknown): RunUpdateOutcome;
  resume(input: unknown): RunUpdateOutcome;
  updatePresentation(input: unknown): RunUpdateOutcome;
  requestCancellation(input: Readonly<{ runId: string; expectedVersion: number; now: string; errorSummary?: string; cancellationSource?: Readonly<{ commandId: string; rootRunId: string }> }>): RunUpdateOutcome;
  advanceRevision(input: Readonly<{ runId: string; expectedVersion: number; now: string }>): RunUpdateOutcome;

  setPause(input: unknown, accountingAuthorization?: object): RunUpdateOutcome;
  bumpPriority(input: unknown): RunUpdateOutcome;

  injectCheckpointPatches(input: unknown): RunUpdateOutcome;
}>;

// Failure fingerprint is a class join key, never inferred message text.
type FailureRepository = Readonly<{
  get(failureId: string): FailureRecord | undefined;
  listByRun(runId: string): readonly FailureRecord[];
  listByFingerprint(fingerprint: string): readonly FailureRecord[];
  countByFingerprint(fingerprint: string): number;
}>;


type DiagnosticBundleRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<DiagnosticBundle>;
  insertPrepared(input: unknown, publication: Readonly<{ publish(): DiagnosticBundle; committed(): void }>): ImmutableInsertResult<DiagnosticBundle>;
  get(bundleId: string): DiagnosticBundle | undefined;
  listByRun(runId: string): readonly DiagnosticBundle[];
  listAttachments(bundleId: string): readonly DiagnosticAttachmentStorageRecord[];
  findByArtifact(artifactId: string): readonly DiagnosticAttachmentStorageRecord[];

  listRetentionDue(now: string): readonly DiagnosticBundle[];

  purge(bundleId: string, now: string): z.infer<typeof DiagnosticPurgeDispositionSchema>;
}>;

/** Ref operator-trust §2.3. One terminal run, one server-derived receipt. */
type EvidenceReceiptRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RunEvidenceReceipt>;
  get(receiptId: string): RunEvidenceReceipt | undefined;
  findByRun(runId: string): RunEvidenceReceipt | undefined;
  /** Cardinality-preserving exact-run read for diagnostics and repository checks. */
  listByRun(runId: string): readonly RunEvidenceReceipt[];
}>;

/** Ref guards-and-tests §10.6. Citable scenario evidence is insert-only. */
type DryRunScenarioResultRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<DryRunScenarioResult>;
  get(resultId: string): DryRunScenarioResult | undefined;
  list(): readonly DryRunScenarioResult[];
}>;

/** insert-only proof binding one selection to exact stored workbook bytes and headers. */
export type OperatorXlsxExportRepository = ReturnType<typeof createGeneratedArtifactRepository>["exports"];



type NotificationRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<NotificationRecord>;
  fold(input: unknown): NotificationRecordOutcome;
  updateState(input: unknown): NotificationRecord;
  get(notificationId: string): NotificationRecord | undefined;
  findByDedupe(actorId: string, dedupeFingerprint: string): NotificationRecord | undefined;
  listByActor(actorId: string, status?: unknown): readonly NotificationRecord[];
  collection(actorId: string, operation: NotificationCollectionOperation): NotificationCollectionTarget;
}>;




type RunResultRepository = Readonly<{
  getInitialSettlement(runId: string): Readonly<{ run: RunRecord; result: RunResultRecord }> | undefined;
  refreshedSettlementVersion(runId: string): number | undefined;
  getSettlement(runId: string, appliedVersion: number): Readonly<{ run: RunRecord; result: RunResultRecord }> | undefined;
  get(runId: string): RunResultRecord | undefined;
}>;


type StartPlanRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<StartPlanRecord>;
  get(startPlanId: string): StartPlanRecord | undefined;
  consume(input: unknown): StartPlanConsumeOutcome;
}>;


type WorkerPoolRepository = Readonly<{
  plan(input: unknown): WorkerPoolPlanOutcome;
  get(workflow: string): WorkerPoolRecord | undefined;
  list(): readonly WorkerPoolRecord[];
}>;


type RunSessionRepository = Readonly<{
  list(): readonly RunSessionRecord[];
  setGrouping(sessionId: string, expectedVersion: number, groupInQueue: boolean): RunSessionRecord;

  insert(input: unknown): ImmutableInsertResult<RunSessionRecord>;
  get(sessionId: string): RunSessionRecord | undefined;
  listByWorkflow(workflow: string): readonly RunSessionRecord[];
}>;

type ArtifactOutboxRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<ArtifactOutboxStorageRecord>;
  get(outboxId: string): ArtifactOutboxStorageRecord | undefined;
  listPending(): readonly ArtifactOutboxStorageRecord[];
  markProjected(input: unknown): Readonly<{
    state: "acknowledged" | "already-projected";
    record: ArtifactOutboxStorageRecord;
  }>;
}>;

// Commit sink head and acknowledgement together; acknowledged data must name its recorded workbook hash.
type ArtifactSinkHeadRepository = Readonly<{
  get(sinkId: string): ArtifactSinkHeadRecord | undefined;
  record(input: unknown): ArtifactSinkHeadRecord;
}>;


type IntakeManifestRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof IntakePlanManifestSchema>>;
  get(manifestId: string): z.infer<typeof IntakePlanManifestSchema> | undefined;
  findBySource(sourceSha256: string): readonly z.infer<typeof IntakePlanManifestSchema>[];
}>;


type IntakeSessionRepository = Readonly<{
  create(input: unknown): z.infer<typeof IntakeSessionSchema>;
  get(intakeSessionId: string): z.infer<typeof IntakeSessionSchema> | undefined;
  update(input: unknown): z.infer<typeof IntakeSessionSchema>;
  findActiveBySource(sourceSha256: string): readonly z.infer<typeof IntakeSessionSchema>[];
}>;


type OcrExtractionRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<StoredOcrExtraction>;
  get(extractionId: string):
    StoredOcrExtraction | undefined;
  findBySource(sourceSha256: string): readonly StoredOcrExtraction[];
}>;


export type DuoCeremonyLeaseAcquireOutcome =
  | Readonly<{
    state: "acquired";
    lease: DuoCeremonyLeaseRecord;
    token: DuoCeremonyLeaseToken;
    tookOver: z.infer<typeof DuoCeremonyLeaseTakeoverSchema> | null;
  }>
  | Readonly<{ state: "held"; holder: DuoCeremonyLeaseRecord }>;

export type DuoCeremonyLeaseRepository = Readonly<{
  acquire(input: unknown): DuoCeremonyLeaseAcquireOutcome;
  release(input: Readonly<{ token: unknown; now: string }>): DuoCeremonyLeaseReleaseOutcome;
  get(credentialKey: string): DuoCeremonyLeaseRecord | undefined;
}>;

export type AuthorityRepositories = Readonly<{
  assistantModelPreference: ReturnType<typeof createAssistantModelPreferenceRepository>;
  assistantAuthorization: ReturnType<typeof createAssistantAuthorizationRepository>;
  timelineEvents: TimelineRepository;
  runs: RunRepository;
  failures: FailureRepository;
  runResults: RunResultRepository;
  diagnosticBundles: DiagnosticBundleRepository;
  evidenceReceipts: EvidenceReceiptRepository;
  dryRunScenarioResults: DryRunScenarioResultRepository;
  operatorXlsxExports: OperatorXlsxExportRepository;
  intakeSessions: IntakeSessionRepository;
  intakeManifests: IntakeManifestRepository;
  ocrExtractions: OcrExtractionRepository;
  confirmedTransactionSources: Parameters<typeof createTransactionHistory>[0]["confirmedTransactionSources"];
  failureResolution: ReturnType<typeof createFailureResolutionRepository>;
  startPlans: StartPlanRepository;
  duoCeremonyLeases: DuoCeremonyLeaseRepository;
  exclusiveSessionLeases: ReturnType<typeof createExclusiveSessionLeaseRepository>;
  ocrReviews: ReturnType<typeof createOcrReviewRepository>;
  workerPools: WorkerPoolRepository;
  workerSlots: ReturnType<typeof createWorkerSlotRepository>;
  runSessions: RunSessionRepository;
  deletedRuns: DeletedRunRepository;
  commands: CommandRepository;
  commandAudits: CommandAuditRepository;
  lifecycleJournal: RunLifecycleJournalRepository;
  dependencies: DependencyRepository;
  delegationManifests: ImmutableRepository<z.infer<typeof DelegationManifestSchema>> & Readonly<{
    listByParentRun(parentRunId: string): readonly z.infer<typeof DelegationManifestSchema>[];
  }>;
  gateResults: ImmutableRepository<z.infer<typeof GateResultRecordSchema>> & Readonly<{

    listByRun(runId: string): readonly z.infer<typeof GateResultRecordSchema>[];
  }>;
  runCheckpoints: RunCheckpointRepository;
  notifications: NotificationRepository;
  notificationPublications: ReturnType<typeof createNotificationMetadataRepositories>["notificationPublications"];
  notificationHealth: ReturnType<typeof createNotificationMetadataRepositories>["notificationHealth"];
  configSnapshots: ImmutableRepository<z.infer<typeof ConfigSnapshotRecordSchema>>;
  settingsCurrent: SettingsCurrentRepository;
  runtimeConfig: RuntimeConfigRepository;
  writeIntents: WriteIntentRepository;
  writeAttempts: ReadRepository<z.infer<typeof WriteAttemptRecordSchema>> & Readonly<{
    listByIntent(writeIntentId: string): readonly z.infer<typeof WriteAttemptRecordSchema>[];
  }>;
  generatedArtifacts: ReturnType<typeof createGeneratedArtifactRepository>;
  workbooks: ReturnType<typeof createWorkbookLibraryRepository>;
  artifactOutbox: ArtifactOutboxRepository;
  artifactSinkHeads: ArtifactSinkHeadRepository;
}>;

const JsonRowSchema = z.strictObject({ payload_json: z.string() });
const RecordKeyRowSchema = z.strictObject({ id: z.string() });
const ProtectedSettingsWriteIdLookupSchema = z.strictObject({
  writeId: z.uuid(),
  excludingCommandId: CommandIdSchema,
});

const HeldRunRowSchema = z.strictObject({ run_id: z.string().nullable() });
const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const TextPragmaRowSchema = z.record(z.string(), z.string());
const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  installation_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
});
const TableNameRowSchema = z.strictObject({ name: z.string() });
const TableColumnRowSchema = z.object({ name: z.string() });
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
// SQL max over no rows is NULL, meaning the item has no run attempt.
const MaxAttemptRowSchema = z.strictObject({ attempt: z.number().int().positive().nullable() });
const MaxRunNumberRowSchema = z.strictObject({ run_number: z.number().int().positive().nullable() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });

export type RunSearchAuthorityPage = ReturnType<ReturnType<typeof createRunSearchIndex>["search"]>;



function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readIntPragma(
  database: DatabaseSync,
  name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout" | "data_version",
): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name === "busy_timeout" ? "timeout" : name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function existingDatabaseLocation(path: string): URL | string {
  if (path === ":memory:") return path;
  const location = pathToFileURL(path);
  location.searchParams.set("mode", "rw");
  return location;
}

function readTextPragma(database: DatabaseSync, name: "journal_mode"): string {
  const row = TextPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function inspectionTableNames(database: DatabaseSync): string[] {
  return database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => TableNameRowSchema.parse(row).name);
}

function tableNames(database: DatabaseSync): TableName[] {
  return z.array(z.union([AuthorityTableNameSchema, ProjectionTableNameSchema])).parse(inspectionTableNames(database));
}

function readMetaRow(database: DatabaseSync): z.infer<typeof MetaRowSchema> {
  return MetaRowSchema.parse(database.prepare(readIntPragma(database, "user_version") >= 7
    ? "SELECT schema_version,authority_generation,updated_at,installation_id,profile_id FROM database_states WHERE id=1"
    : "SELECT schema_version,authority_generation,updated_at FROM database_states WHERE id=1").get());
}

function invariantQueries(schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION) { return Object.freeze([
  { name: "run-owner-exclusivity", sql: "SELECT count(*) AS count FROM runs JOIN deleted_runs ON deleted_runs.run_id=runs.id" },
{
    name: "run-completion-revisions",
    sql: `SELECT count(*) AS count FROM runs AS run
      WHERE json_type(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion') IS 'object'
        AND run.version - json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.expectedVersion') - 1 <> (
          SELECT count(DISTINCT json_extract(audit.payload_json, '$.result.appliedVersion')) FROM command_audits AS audit
          WHERE json_extract(audit.payload_json, '$.kind') = 'run-lifecycle'
            AND json_extract(audit.payload_json, '$.result.kind') = 'run'
            AND json_extract(audit.payload_json, '$.result.runId') = run.id
            AND json_extract(audit.payload_json, '$.request.operation') IN ('transition')
            AND json_extract(audit.payload_json, '$.request.fence.kind') = 'version'
            AND json_extract(audit.payload_json, '$.request.fence.expectedVersion') = json_extract(audit.payload_json, '$.result.appliedVersion') - 1
            AND json_extract(audit.payload_json, '$.result.appliedVersion') > json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.expectedVersion') + 1
            AND json_extract(audit.payload_json, '$.result.appliedVersion') <= run.version)` ,
  },
{
    name: "run-completion-consequences",
    sql: `SELECT count(*) AS count FROM runs AS run
      LEFT JOIN run_results AS result ON result.run_id = run.id AND ${schemaVersion >= 20 ? CURRENT_RUN_SETTLEMENT_SQL.replaceAll("settlement.","result.") : "1"}
      LEFT JOIN run_failures AS failure ON failure.run_id = run.id
        ${schemaVersion >= 21 ? "AND failure.id=json_extract(run.lifecycle_json,'$.completion.failureId')" : ""}
      WHERE COALESCE(json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.outcome') IN ('done','failed'), 0)
        IS NOT (json_type(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion') IS 'object')
        OR (json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.kind') = 'done' AND (
          result.run_id IS NULL OR failure.id IS NOT NULL
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.resultDigest') IS NOT result.result_digest))
        OR (json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.kind') = 'failed' AND (
          failure.id IS NULL OR result.run_id IS NULL
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.failureId') IS NOT failure.id
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.errorSummary') IS NOT json_extract(failure.payload_json, '$.summary')
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.diagnosticSafetyVersion') IS NOT json_extract(failure.payload_json, '$.diagnosticSafetyVersion')))` ,
  },
{
    name: "final-runs-bind-result-owner",
    sql: `SELECT count(*) AS count FROM runs AS run
      LEFT JOIN run_results AS result ON result.run_id=run.id AND ${schemaVersion >= 20 ? CURRENT_RUN_SETTLEMENT_SQL.replaceAll("settlement.","result.") : "1"}
      WHERE run.state='terminal' AND run.outcome<>'interrupted' AND result.run_id IS NULL`,
  },
{
    name: "failed-runs-bind-failure",
    sql: `
      SELECT count(*) AS count FROM runs AS run
      WHERE json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM run_failures AS failure
          WHERE failure.id = json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.failureId')
            AND failure.run_id = run.id
        )
    `,
  },
{
    name: "failures-bind-failed-run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN runs AS run ON run.id = failure.run_id
      WHERE ${schemaVersion >= 21 ? `NOT EXISTS (
        SELECT 1 FROM run_results result WHERE result.run_id=run.id
          AND json_extract(result.terminal_run_json,'$.lifecycle.outcome')='failed'
          AND json_extract(result.terminal_run_json,'$.lifecycle.failureId')=failure.id
          AND json_extract(result.terminal_run_json,'$.completion.failureId')=failure.id
          AND json_extract(result.payload_json,'$.result.value.kind')='failed-evidence'
          AND json_extract(result.payload_json,'$.result.value.authorization.failureId')=failure.id
          AND result.settlement_version=json_extract(result.terminal_run_json,'$.completion.expectedVersion')+1
      )` : `json_extract(run.lifecycle_json, '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(run.lifecycle_json, '$.lifecycle.failureId') IS NOT failure.id`}
    `,
  },
{
    name: "failure-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN runs AS run ON run.id = failure.run_id
      WHERE json_extract(failure.payload_json, '$.workflowId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.workflow')
        OR json_extract(failure.payload_json, '$.traceId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.traceId')
        OR json_extract(failure.payload_json, '$.attempt') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.attempt')
    `,
  },
{
    name: "run-result-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN runs AS run ON run.id = result.run_id
      WHERE json_extract(result.payload_json, '$.workflowId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.workflow')
        OR json_extract(result.payload_json, '$.attempt') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.attempt')
        OR json_extract(result.payload_json, '$.descriptorVersion') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.descriptorVersion')
        OR json_extract(result.payload_json, '$.contractFingerprint') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.contractFingerprint')
        OR json_extract(result.payload_json, '$.configFingerprint') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.configFingerprint')
        OR json_extract(result.payload_json, '$.configSnapshotId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.configSnapshotId')
    `,
  },
{
    name: "results-bind-terminal-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN runs AS run ON run.id = result.run_id
      WHERE ${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.state')" : "run.state"} IS NOT 'terminal' OR ${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} IS 'interrupted'
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} = 'done' AND json_extract(result.payload_json,'$.result.value.kind') IN ('failed-evidence','lifecycle-evidence'))
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} = 'failed' AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'failed-evidence')
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} IN ('cancelled','discarded','superseded') AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'lifecycle-evidence')
    `,
  },
{
    // Check one-active-run ownership before claiming; a second active row is a loop defect.
    name: "worker-owns-at-most-one-active-run",
    sql: `
      SELECT count(*) AS count FROM (
        SELECT owner_worker_id FROM runs
        WHERE state IN ('claimed','validating','running')
        GROUP BY owner_worker_id HAVING count(*) > 1
      )
    `,
  },
{
    name: "diagnostic-attachment-binds-its-bundle",
    sql: `
      SELECT count(*) AS count FROM diagnostic_files AS attachment
      LEFT JOIN diagnostic_snapshots AS bundle ON bundle.id = attachment.snapshot_id
      WHERE bundle.id IS NULL
        OR attachment.id IS NOT (attachment.snapshot_id || ':' || attachment.artifact_id)
        OR attachment.snapshot_id IS NOT json_extract(attachment.payload_json, '$.bundleId')
        OR attachment.artifact_id IS NOT json_extract(attachment.payload_json, '$.attachment.artifactId')
        OR attachment.digest IS NOT json_extract(attachment.payload_json, '$.attachment.digest')
    `,
  },
{
    name: "diagnostic-bundle-attachments-are-indexed",
    sql: `
      SELECT count(*) AS count FROM diagnostic_snapshots AS bundle
      WHERE json_array_length(bundle.payload_json, '$.attachments')
        <> (SELECT count(*) FROM diagnostic_files AS attachment WHERE attachment.snapshot_id = bundle.id)
    `,
  },
{
    name: "started-dry-run-scenario-result-binds-run",
    sql: `
      SELECT count(*) AS count FROM dryrun_results AS result
      LEFT JOIN runs AS run ON run.id = result.run_id
      WHERE result.execution_state = 'started' AND (
        run.id IS NULL
        OR result.workflow IS NOT run.workflow
        OR result.trace_id IS NOT json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.traceId')
        OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.dryRun') IS NOT (
          CASE WHEN json_extract(result.payload_json, '$.execution.arm') = 'live-read' THEN 0 ELSE 1 END
        )
      )
    `,
  },
{
    name: "attempting-write-has-current-attempt",
    sql: `
      SELECT count(*) AS count FROM write_intents AS intent
      WHERE intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM write_attempts AS attempt
        WHERE attempt.id = json_extract(intent.payload_json, '$.currentAttemptId')
          AND attempt.intent_id = intent.id
          AND attempt.generation = json_extract(intent.payload_json, '$.generation')
      )
    `,
  }
] as const); }

function invariantViolations(database: DatabaseSync): readonly string[] {
  const violations = invariantQueries(readIntPragma(database,"user_version")).flatMap(({ name, sql }) => {
    const { count } = CountRowSchema.parse(database.prepare(sql).get());
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
  return [...violations, ...commandGroupLinkViolations(database)];
}

/** Validate both declared links and missing links from each immutable parent selection. */
function commandGroupLinkViolations(database: DatabaseSync): readonly string[] {
  const rowSchema = z.strictObject({ id: z.string(), request_json: z.string(), parent_id: z.string().nullable() });
  const rows = database.prepare("SELECT id, request_json, parent_id FROM commands ORDER BY id").all()
    .map((row) => rowSchema.parse(row));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const expected = new Map<string, string>();
  for (const row of rows) {
    const raw: unknown = JSON.parse(row.request_json);
    if (typeof raw !== "object" || raw === null || !("kind" in raw) || raw.kind !== "bulk-parent") continue;
    const parent = BulkParentCommandRecordSchema.parse(raw);
    for (const target of parent.acceptance.request.targets) {
      const child = deriveBulkChildCommand(parent.acceptance.request, target);
      const saved = byId.get(child.commandId);
      if (saved === undefined) continue;
      if (expected.has(child.commandId) && expected.get(child.commandId) !== parent.commandId) return ["command-group ambiguous child ownership"];
      if (canonicalJsonStringify(JSON.parse(saved.request_json) as unknown) !== canonicalJsonStringify(child)) return ["command-group child request mismatch"];
      expected.set(child.commandId, parent.commandId);
    }
  }
  return rows.flatMap((row) => row.parent_id === (expected.get(row.id) ?? null)
    ? [] : ["command-group child linkage mismatch"]);
}

/** How stored runs and commands are read; a stopped store below the custody schema reads both through the predecessor readers. */
type StoredReaders = Readonly<{ run: (raw: unknown) => PredecessorRunRecord; command: (raw: unknown) => ReturnType<typeof commandFromRow>;
  /** A lifecycle request in the current grammar, for checks that parse it with a current request schema. */
  lifecycleRequest: (operation: string, request: unknown) => unknown }>;
const CURRENT_READERS: StoredReaders = { run: runRecordFromRow, command: raw => commandFromRow(raw), lifecycleRequest: (_operation, request) => request };
const PREDECESSOR_CUSTODY_READERS: StoredReaders = { run: predecessorCustodyRunFromRow, command: predecessorCommandFromRow, lifecycleRequest: predecessorLifecycleRequest };

function readTimelineRun(database: DatabaseSync, runId: string, read: StoredReaders = CURRENT_READERS): PredecessorRunRecord | undefined {
  const row = database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  return row === undefined ? undefined : read.run(row);
}

function authenticatedPublicationDeletion(database: DatabaseSync, runId: string, publication: ConfirmationPublication, read: StoredReaders = CURRENT_READERS): boolean {
  const raw = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(runId);
  if (raw === undefined) return false;
  const {receipt} = deletedRunFromRow(raw);
  const facts = publication.ledger;
  const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(receipt.commandId);
  const audits = database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(receipt.commandId);
  if (commandRaw === undefined || audits.length !== 1) throw new Error("confirmed-publication-deletion-command-missing");
  const command = read.command(commandRaw);
  const audit = NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",audits[0]));
  if (receipt.runId !== facts.runId || receipt.workflow !== facts.workflowId || receipt.itemId !== facts.itemId
    || audit.completedAt !== receipt.deletedAt
    || receipt.traceId !== facts.traceId || receipt.attempt < facts.attempt || receipt.deletedAt < facts.confirmedAt
    || receipt.removed.find(entry=>entry.table === "runs")?.rows !== 1
    || !receipt.removed.some(entry=>entry.table === "run_checkpoints" && entry.rows > 0)
    || !receipt.removed.some(entry=>entry.table === "timeline_events" && entry.rows > 0)
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || z.object({state:z.literal("succeeded"),outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
    || !settledRunDeletionIds(audit)?.includes(runId)) throw new Error("confirmed-publication-deletion-settlement-mismatch");
  return true;
}

function readConfirmationPublication(database: DatabaseSync,id:string): ConfirmationPublication | undefined {
  const row = database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
  if (row === undefined) return undefined;
  const intent = WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
  return confirmationPublicationFromRow(intent,Reflect.get(row,"publication_json"));
}

function assertConfirmationPublication(database:DatabaseSync,id:string,read: StoredReaders = CURRENT_READERS): void {
  const publication = readConfirmationPublication(database,id);
  if (publication === undefined) return;
  const owner = readTimelineRun(database,publication.ledger.runId,read);
  const deleted = database.prepare("SELECT 1 FROM deleted_runs WHERE run_id=?").get(publication.ledger.runId) !== undefined;
  if (owner !== undefined && deleted) throw new Error("confirmed-publication-owner-ambiguous");
  if (deleted && !authenticatedPublicationDeletion(database,publication.ledger.runId,publication,read)) throw new Error("confirmed-publication-deletion-unverified");
  const evidence = timelineEvidenceRepositories(database,read);
  reconstructConfirmedOperation(evidence,publication.timeline);
  const raw = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(publication.timeline.eventId);
  if (raw === undefined) {
    if (!authenticatedPublicationDeletion(database,publication.ledger.runId,publication,read)) throw new Error("confirmed-publication-timeline-missing");
    if (readTimelineRun(database,publication.ledger.runId,read) !== undefined) throw new Error("confirmed-publication-deleted-run-still-present");
  } else {
    const timeline = timelineEventFromRow(raw);
    if (timelineAppendContent(timeline) !== canonicalJsonStringify(publication.timeline)) throw new Error("confirmed-publication-timeline-mismatch");
    assertTimelineOwner(database,timeline,false,read);
  }
}

function timelineEvidenceRepositories(database: DatabaseSync, read: StoredReaders = CURRENT_READERS) {
  return {
    workbooks: createWorkbookLibraryRepository({ database, read: work => work(), mutate: () => { throw new Error("timeline-workbook-reader-is-read-only"); } }),
    writeAttempts: {get(id:string) {
      const row=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(id);
      return row === undefined ? undefined : WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",row));
    }},
    writeIntents: {
      getPublication:(id:string)=>readConfirmationPublication(database,id),
      authenticatedDeletion:(runId:string,publication:ConfirmationPublication)=>authenticatedPublicationDeletion(database,runId,publication,read),
      get(id:string) {
      const row=database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
      return row === undefined ? undefined : WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
    }},
    commands: {get(id:string) {
      const row=database.prepare("SELECT * FROM commands WHERE id=?").get(id);
      return row === undefined ? undefined : read.command(row);
    }},
    commandAudits: {get(id:string) {
      const row=database.prepare("SELECT * FROM command_audits WHERE id=?").get(id);
      return row === undefined ? undefined : NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",row));
    }},
    runCheckpoints: {get(workflow:string,itemId:string,nodeId:string,attempt:number,claimGeneration:number) {
      const key=checkpointLookupKey(workflow,itemId,nodeId,attempt,claimGeneration);
      const row=database.prepare("SELECT * FROM run_checkpoints WHERE id=?").get(key);
      return row === undefined ? undefined : RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints",row));
    }},
  };
}

function assertTimelineOwner(database: DatabaseSync, record: TimelineAppend, appending = false, read: StoredReaders = CURRENT_READERS): void {
    if (record.scope.kind !== "run") return;
    const run = readTimelineRun(database, record.scope.runId, read);
    if (run === undefined) throw new Error("timeline-event-owner-missing");
    if (run.envelope.workflow !== record.workflow) throw new Error("timeline-event-owner-mismatch");
    if (record.payload.kind === "workbook-write-recorded") {
      const event = record.payload, repositories = timelineEvidenceRepositories(database, read);
      const entry = repositories.workbooks.runOperations(run.envelope.runId).find(entry => entry.libraryId === event.libraryId && entry.operation.operationId === event.operationId);
      const digest = entry?.operation.source.kind === "run" || entry?.operation.source.kind === "run-reference" ? entry.operation.source.referenceDigest : undefined;
      if (entry === undefined || (entry.operation.source.kind !== "run" && entry.operation.source.kind !== "run-reference") || entry.operation.source.referenceDigest === undefined
        || !run.input.workbookReferences?.some(reference => sha256Hex(canonicalJsonStringify(reference)) === digest)
        || event.runId !== run.envelope.runId || event.workflow !== run.envelope.workflow || event.traceId !== run.envelope.traceId
        || event.attempt > run.envelope.attempt || Number(event.claimGeneration) > Number(run.claimGeneration)
        || event.receiptDigest !== sha256Hex(canonicalJsonStringify(entry.receipt)) || event.at !== entry.receipt.at
        || record.occurredAt !== event.at || record.source.kind !== "native"
        || record.eventId !== deriveStableUuid("run-workbook-write", canonicalJsonStringify({ runId: event.runId, libraryId: event.libraryId, operationId: event.operationId }))) {
        throw new Error("workbook-write-timeline-identity-mismatch");
      }
      if (appending && event.resolvedBy === undefined && (run.lifecycle.state !== "running" || Number(event.claimGeneration) !== Number(run.claimGeneration))) {
        throw new Error("workbook-write-claim-unavailable");
      }
      if (event.resolvedBy !== undefined) {
        const command = repositories.commands.get(event.resolvedBy);
        const change = entry.operation.change;
        if (command === undefined || !("family" in command) || command.family !== "run" || command.type !== "resolve-workbook-row" || command.target.runId !== event.runId
          || command.target.libraryId !== event.libraryId || change.kind !== "patch" || change.resolves?.operationId !== command.target.operationId
          || change.resolves?.receiptDigest !== command.target.receiptDigest || change.selection?.sheetId !== command.payload.sheetId
          || change.selection?.rowId !== command.payload.rowId || change.selection?.expectedVersion !== command.target.workbookVersion
          || entry.receipt.state !== "applied") throw new Error("workbook-write-resolution-timeline-mismatch");
      }
    }
    const recoveryStart = (activityId: string) => {
      const row = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(activityId);
      const start = row === undefined ? undefined : timelineEventFromRow(row);
      if (start?.payload.kind !== "recovery-activity-started") throw new Error("recovery-activity-start-missing");
      return RecoveryActivitySchema.strip().parse(start.payload);
    };
    const recoveryEnd = (activityId: string) => {
      const row = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(deriveStableUuid("recovery-activity-ended", activityId));
      const end = row === undefined ? undefined : timelineEventFromRow(row);
      if (end !== undefined && end.payload.kind !== "recovery-activity-ended") throw new Error("recovery-activity-end-invalid");
      return end?.payload.kind === "recovery-activity-ended" ? end.payload : undefined;
    };
    if (record.payload.kind === "recovery-activity-started" || record.payload.kind === "recovery-activity-ended") {
      const { kind } = record.payload;
      const activity = RecoveryActivitySchema.strip().parse(record.payload);
      const attempt = timelineEvidenceRepositories(database, read).writeAttempts.get(activity.writeAttemptId);
      if (activity.traceId !== run.envelope.traceId || activity.attempt > run.envelope.attempt
        || attempt === undefined || attempt.runId !== activity.runId || attempt.runAttempt !== activity.attempt
        || attempt.writeIntentId !== activity.writeIntentId || attempt.generation !== activity.generation
        || attempt.bindingProof.afterPrepareSpanPath !== `${activity.traceId}/${activity.nodeId}/prepare`) {
        throw new Error("recovery-activity-owner-mismatch");
      }
      if (kind === "recovery-activity-started" && appending) {
        const raw = database.prepare("SELECT * FROM write_intents WHERE id=?").get(activity.writeIntentId);
        const intent = raw === undefined ? undefined : WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", raw));
        if (intent === undefined || intent.status === "observed-present" || intent.currentAttemptId !== activity.writeAttemptId
          || intent.generation !== activity.generation || intent.runId !== activity.runId
          || activity.attempt !== run.envelope.attempt
          || (activity.operation === "parked-write-check" ? intent.status !== "parked" : intent.status !== "attempting")) {
          throw new Error("recovery-activity-authority-changed");
        }
      }
      if (kind === "recovery-activity-ended") {
        if (record.eventId !== deriveStableUuid("recovery-activity-ended", activity.activityId)
          || canonicalJsonStringify(recoveryStart(activity.activityId)) !== canonicalJsonStringify(activity)) {
          throw new Error("recovery-activity-end-mismatch");
        }
      }
    }
    if (record.payload.kind === "operation-confirmed") {
      const facts = record.payload.facts;
      if (facts.traceId !== run.envelope.traceId || facts.itemId !== run.envelope.itemId
        || (appending ? facts.attempt !== run.envelope.attempt : facts.attempt > run.envelope.attempt) || facts.configFingerprint !== run.envelope.configFingerprint
        || facts.instance !== run.envelope.resolvedInstance[facts.system] || run.envelope.dryRun) {
        throw new Error("confirmed-history-run-mismatch");
      }
      // The resolver validates all exact proof/output/attempt references before append.
      reconstructConfirmedOperation(timelineEvidenceRepositories(database, read), record);
    }
    if (record.payload.kind === "checkpoint-replayed" || record.payload.kind === "checkpoint-recorded") {
      const reference = record.payload.checkpoint;
      const checkpoint = timelineEvidenceRepositories(database, read).runCheckpoints.get(reference.workflowId, reference.itemId,
        reference.nodeId, reference.attempt, reference.claimGeneration);
      if ((record.payload.kind === "checkpoint-recorded" && record.eventId !== deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(reference.workflowId, reference.itemId, reference.nodeId, reference.attempt, reference.claimGeneration)))
        || (appending ? record.payload.attempt !== run.envelope.attempt : record.payload.attempt > run.envelope.attempt)
        || (appending && record.payload.kind === "checkpoint-replayed" && Number(record.payload.claimGeneration) !== Number(run.claimGeneration))
        || reference.itemId !== run.envelope.itemId
        || checkpoint === undefined
        || canonicalJsonStringify(timelineCheckpointReference(checkpoint)) !== canonicalJsonStringify(reference)) {
        throw new Error("timeline-checkpoint-reference-mismatch");
      }
    }
    if (record.payload.kind === "write-parked") {
      const event = record.payload;
      if (event.traceId !== run.envelope.traceId || event.attempt > run.envelope.attempt) {
        throw new Error("timeline-parked-write-owner-mismatch");
      }
    }
    if (record.payload.kind === "note") {
      const note = record.payload.note;
      if (!("runId" in note) || note.traceId !== run.envelope.traceId || note.attempt > run.envelope.attempt) {
        throw new Error("timeline-note-owner-mismatch");
      }
      if ("recoveryActivityId" in note && note.recoveryActivityId !== undefined) {
        const activity = recoveryStart(note.recoveryActivityId);
        const end = recoveryEnd(activity.activityId);
        if (activity.runId !== note.runId || activity.workflow !== note.workflow || activity.attempt !== note.attempt
          || activity.traceId !== note.traceId || note.spanPath !== recoveryActivitySpanPath(activity)
          || Date.parse(note.ts) < Date.parse(activity.openedAt)
          || (end !== undefined && (appending || Date.parse(note.ts) > Date.parse(end.endedAt)))) {
          throw new Error("recovery-activity-note-not-open");
        }
      }
    }
    if (record.payload.kind === "span") {
      const event = record.payload.event;
      if (!("runId" in event) || event.traceId !== run.envelope.traceId
        || event.attempt > run.envelope.attempt
        || (event.t === "run.queued" && event.itemId !== run.envelope.itemId)) {
        throw new Error("timeline-event-owner-mismatch");
      }
    }
  }


function nativeTableKey(table: AuthorityTableName | "explorer_overrides" | typeof WORKER_CUSTODY_DROPPED_TABLES[number], database: DatabaseSync): string {
  if (table === "run_results") return readIntPragma(database,"user_version") >= 20 ? "id" : "run_id";
  if (table === "deleted_runs" || table === "run_search") return "run_id";
  if (table === "worker_pools") return "workflow";
  if (table === "workflow_workbook_selections") return "workflow_id";
  if (table === "workbook_library_history") return readIntPragma(database, "user_version") >= 13
    ? "workbook_id,version,name" : "workbook_id,version,payload_json";
  if (table === "workbook_operations") return "sequence";
  if (table === "worker_controls") return "command_id";
  if (table === "auth_leases") return "credential_key";
  if (table === "timeline_events") return "cursor";
  return "id";
}

function authenticateStoredWriteResolution(database: DatabaseSync, input: unknown, read: StoredReaders = CURRENT_READERS): void {
  const intent = WriteIntentRecordSchema.parse(input);
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined) return;
  const attempt = database.prepare("SELECT * FROM write_attempts WHERE id=?").get(intent.resolution.writeAttemptId);
  const command = database.prepare("SELECT * FROM commands WHERE id=?").get(intent.resolution.commandId);
  const audit = database.prepare("SELECT * FROM command_audits WHERE id=?").get(intent.resolution.auditId);
  if (attempt === undefined || command === undefined || audit === undefined) throw new Error("parked-write-resolution-authority-missing");
  authenticateParkedWriteResolution(intent,nativeOrdinaryRecordFromRow("write_attempts",attempt),read.command(command),nativeOrdinaryRecordFromRow("command_audits",audit));
}

function authenticateStoredResolutionAudit(database: DatabaseSync,input:unknown,read: StoredReaders = CURRENT_READERS):void {
  const audit=NativeCommandAuditSchema.parse(input);
  if (!("writeResolution" in audit) || audit.writeResolution === undefined) return;
  const intent=audit.writeResolution;
  if (intent.status !== "parked" && ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined)) throw new Error("parked-write-resolution-audit-authority-missing");
  const attemptId = intent.status === "parked" ? intent.currentAttemptId : intent.resolution?.writeAttemptId;
  if (attemptId === undefined) throw new Error("parked-write-resolution-audit-authority-missing");
  const attempt=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(attemptId);
  const command=database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
  if(attempt === undefined || command === undefined) throw new Error("parked-write-resolution-audit-authority-missing");
  authenticateAuditedParkedWriteResolution(nativeOrdinaryRecordFromRow("write_attempts",attempt),read.command(command),audit);
}

function readDelegationRefreshCommands(database: DatabaseSync, runId: string, read: StoredReaders = CURRENT_READERS) {
  return database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
    AND json_extract(request_json,'$.operation')='delegation-refresh'
    AND json_extract(request_json,'$.request.runId')=? ORDER BY id`).all(RunIdSchema.parse(runId))
    .map(row => RunLifecycleCommandRecordSchema.parse(read.command(row)));
}

function assertRefreshedReceiptSettlement(database: DatabaseSync, record: RunEvidenceReceipt, row: unknown, schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION): void {
  const { settlement_version: version } = z.object({ settlement_version: PositiveIntSchema }).parse(row);
  if (database.prepare("SELECT 1 FROM run_results WHERE run_id=? AND settlement_version<? LIMIT 1").get(record.runId,version) === undefined) return;
  const raw = readRunSettlementRow(database,record.runId,version);
  if (raw === undefined) throw new Error("receipt-settlement-unavailable");
  const run = schemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(raw, PredecessorRunRecordSchema) : runSettlementContext(raw);
  if (record.receiptId !== deriveEvidenceReceiptId(record.runId,record.attempt,version)
    || record.workflowId !== run.envelope.workflow || record.traceId !== run.envelope.traceId || record.attempt !== run.envelope.attempt
    || record.descriptorFingerprint !== run.envelope.contractFingerprint || record.configFingerprint !== run.envelope.configFingerprint
    || run.lifecycle.state !== "terminal" || record.generatedAt !== run.lifecycle.endedAt) throw new Error("receipt-settlement-binding-mismatch");
}

export function assertTerminalEvidenceOwner(database: DatabaseSync, record: RunResultRecord, read: StoredReaders = CURRENT_READERS, retainedRun?: PredecessorRunRecord, refreshPath = new Set<string>(), schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION): void {
  const evidence = terminalEvidenceResult(record);
  const rawRun = database.prepare("SELECT * FROM runs WHERE id=?").get(record.runId);
  if (rawRun === undefined) throw new Error("terminal-evidence-run-missing");
  const current = read.run(rawRun), run = retainedRun ?? current;
  if (run.version > current.version || canonicalJsonStringify(run.input) !== canonicalJsonStringify(current.input)
    || canonicalJsonStringify(run.envelope) !== canonicalJsonStringify({ ...current.envelope, priority: run.envelope.priority })) throw new Error("run-settlement-owner-mismatch");
  if (run.delegationRefresh !== undefined) {
    const key = `${run.envelope.runId}:${run.version}`;
    if (refreshPath.has(key)) throw new Error("delegation-refresh-settlement-cycle");
    const path = new Set(refreshPath).add(key);
    authenticateDelegationRefresh({
      lifecycleJournal: {
        listDelegationRefreshes: runId => readDelegationRefreshCommands(database,runId,read),
        getCommand: commandId => { const row = database.prepare("SELECT * FROM commands WHERE id=?").get(commandId); return row === undefined ? undefined : AuthorityCommandRecordSchema.parse(read.command(row)); },
        findAuditByCommand: commandId => { const row = database.prepare("SELECT * FROM command_audits WHERE command_id=?").get(commandId); return row === undefined ? undefined : AuthorityCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",row)); },
      },
      delegationManifests: { get: manifestId => { const row = database.prepare("SELECT * FROM run_delegations WHERE id=?").get(manifestId); return row === undefined ? undefined : DelegationManifestSchema.parse(nativeOrdinaryRecordFromRow("run_delegations",row)); } },
      runResults: { getSettlement: (runId, version) => {
        const row = readRunSettlementRow(database,runId,version);
        if (row === undefined) return undefined;
        const result = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results",row,schemaVersion)), terminal = schemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(row, PredecessorRunRecordSchema) : runSettlementContext(row);
        assertTerminalEvidenceOwner(database,result,read,terminal,path,schemaVersion);
        return { run: terminal, result };
      } },
    },run);
  }
  if (retainedRun !== undefined && run.completion !== undefined) {
    if (current.completion?.expectedVersion === run.completion.expectedVersion) {
      if (canonicalJsonStringify(current.completion) !== canonicalJsonStringify(run.completion)
        || canonicalJsonStringify(current.delegationRefresh ?? null) !== canonicalJsonStringify(run.delegationRefresh ?? null)) throw new Error("run-settlement-completion-mismatch");
    } else {
      const rows = database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
        AND json_extract(request_json,'$.operation') IN ('terminalize','recover-crash')
        AND json_extract(outcome_json,'$.result.runId')=?
        AND json_extract(outcome_json,'$.result.appliedVersion')=?`).all(record.runId,run.version);
      if (rows.length !== 1 || rows[0] === undefined) throw new Error("run-settlement-native-owner-unavailable");
      const command = RunLifecycleCommandRecordSchema.parse(read.command(rows[0]));
      const rawAudit = database.prepare("SELECT * FROM command_audits WHERE command_id=?").get(command.commandId);
      const audit = RunLifecycleCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",rawAudit));
      if (audit.result.kind !== "run" || audit.result.runId !== record.runId || audit.result.appliedVersion !== run.version
        || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("run-settlement-native-owner-mismatch");
      if (run.completion.kind === "done") {
        const request = z.object({ terminal: SuccessTerminalizationRequestSchema }).parse(command.request);
        if (command.operation !== "terminalize" || canonicalJsonStringify(request.terminal.result) !== canonicalJsonStringify(record)
          || canonicalJsonStringify(completionFromAuthorization(request.terminal.authorization)) !== canonicalJsonStringify(run.completion))
          throw new Error("run-settlement-native-owner-mismatch");
      } else if (evidence?.kind === "failed-evidence" && command.operation === "terminalize") {
        const request = z.object({ terminal: FailureTerminalizationRequestSchema }).parse(command.request);
        if (canonicalJsonStringify(request.terminal.authorization) !== canonicalJsonStringify(evidence.authorization)
          || deriveTerminalFailureDigest(request.terminal.failure) !== evidence.failureDigest)
          throw new Error("run-settlement-native-owner-mismatch");
      } else if (evidence?.kind === "failed-evidence" && command.operation === "recover-crash") {
        const request = CanonicalCrashRecoveryRequestSchema.parse(read.lifecycleRequest(command.operation, command.request));
        if (request.runId !== run.envelope.runId || request.expectedVersion !== evidence.authorization.expectedVersion
          || request.now !== evidence.authorization.authorizedAt || canonicalJsonStringify(request.claim) !== canonicalJsonStringify(evidence.authorization.claim)
          || evidence.authorization.failureId !== FailureIdSchema.parse(lifecycleCommandId("crash-failure",command.commandId)))
          throw new Error("run-settlement-native-owner-mismatch");
      } else throw new Error("run-settlement-native-owner-mismatch");
    }
  }
  if (evidence === undefined) {
    if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") throw new Error("terminal-evidence-payload-required");
    if (run.completion?.kind !== "done" || run.completion.resultDigest !== record.resultDigest) throw new Error("terminal-result-completion-mismatch");
    return;
  }
  if (evidence.kind === "failed-evidence") {
    const raw = database.prepare("SELECT * FROM run_failures WHERE id=?").get(evidence.authorization.failureId);
    const failure = raw === undefined ? undefined : FailureRecordSchema.parse(nativeOrdinaryRecordFromRow("run_failures",raw));
    if (failure === undefined || failure.runId !== record.runId || failure.workflowId !== record.workflowId
      || failure.attempt !== record.attempt || failure.traceId !== run.envelope.traceId
      || deriveTerminalFailureDigest(failure) !== evidence.failureDigest
      || canonicalJsonStringify(run.completion) !== canonicalJsonStringify(completionFromAuthorization(evidence.authorization))) throw new Error("terminal-failure-result-mismatch");
  } else {
    const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(evidence.commandId);
    const auditRaw = database.prepare("SELECT * FROM command_audits WHERE id=?").get(evidence.auditId);
    if (commandRaw === undefined || auditRaw === undefined) throw new Error("terminal-evidence-command-audit-missing");
    const command = RunLifecycleCommandRecordSchema.parse(read.command(commandRaw));
    const audit = RunLifecycleCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",auditRaw));
    const request = z.record(z.string(),z.unknown()).parse(command.request);
    const lifecycle = request.lifecycle === undefined ? undefined : z.record(z.string(),z.unknown()).parse(request.lifecycle);
    const declaredOutcome = command.operation === "transition" ? lifecycle?.outcome : "cancelled";
    const declaredEndedAt = command.operation === "transition" ? lifecycle?.endedAt : command.operation === "requeue" ? audit.result.kind === "run" ? audit.result.terminal?.endedAt : undefined : command.operation === "recover-crash" ? request.now : request.endedAt;
    if (request.runId !== record.runId || request.expectedVersion !== evidence.appliedVersion - 1
      || declaredOutcome !== evidence.outcome || declaredEndedAt !== record.createdAt
      || audit.result.kind !== "run" || audit.result.terminal?.outcome !== evidence.outcome
      || audit.result.terminal.endedAt !== record.createdAt
      || ((command.operation === "requeue" || command.operation === "recover-crash") && run.cancelRequested !== true)
      || (command.operation !== "transition" && command.operation !== "terminalize" && command.operation !== "requeue" && command.operation !== "recover-crash")
      || audit.result.kind !== "run" || audit.result.runId !== record.runId || audit.result.appliedVersion !== evidence.appliedVersion
      || command.requestFingerprint !== evidence.requestFingerprint || audit.auditId !== CommandAuditIdSchema.parse(evidence.commandId)
      || z.object({outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("terminal-evidence-command-audit-mismatch");
  }
  if (canonicalJsonStringify(createRunTerminalEvidenceResult(run,evidence)) !== canonicalJsonStringify(record)) throw new Error("terminal-evidence-result-mismatch");
}

/** Reads runs at a stopped store's own schema; envelopes before 22 carry no build id and are never given one. */
function inspectionRunReader(expectedSchemaVersion: number): (raw: unknown) => PredecessorRunRecord {
  const strict = expectedSchemaVersion >= BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runRecordFromRow : predecessorRunRecordFromRow;
  const read = expectedSchemaVersion >= WORKER_CUSTODY_SCHEMA_VERSION ? strict : (raw: unknown) => strict(predecessorCustodyRunRow(raw));
  return expectedSchemaVersion >= 15 ? read : (raw: unknown) => {
    const row = z.record(z.string(), z.unknown()).parse(raw);
    if (Object.hasOwn(row, "pause_state")) throw new Error("stopped-run-schema-columns-mismatch");
    return read({ ...row, pause_state: null });
  };
}

function validateAuthorityRecordSchemas(database: DatabaseSync, validateSearch = true, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION, workbookPayloads = true): number {
  const predecessorCustody = expectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION;
  const read: StoredReaders = { ...(predecessorCustody ? PREDECESSOR_CUSTODY_READERS : CURRENT_READERS), run: inspectionRunReader(expectedSchemaVersion) };
  const convertPreferences = (table: string, row: unknown) => {
    return expectedSchemaVersion < 16 ? convertPersonPreferencesRow(table, row) : row;
  };
  let validated = 0;
  const searchReady = z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready";
  for (const table of migrationTableNames(expectedSchemaVersion)) {
    // The custody conversion validates the tables it drops.
    if (table.startsWith("workbook_") || table === "explorer_overrides" || isWorkerCustodyDroppedTable(table)) continue;
    if (table === "run_search" && (!validateSearch || !searchReady)) continue;
    const retained = expectedSchemaVersion >= 10 ? "" : table === "commands" ? " WHERE family<>'explorer'"
      : table === "command_audits" ? " WHERE command_id NOT IN (SELECT id FROM commands WHERE family='explorer')" : "";
    for (const raw of database.prepare(`SELECT * FROM ${table}${retained} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      try {
        if (table === "database_states") {
          const row = z.strictObject({id:z.literal(1),schema_version:z.literal(expectedSchemaVersion),authority_generation:z.number().int().nonnegative(),updated_at:IsoInstantSchema,
            search_generation:z.number().int().nonnegative().nullable(),search_state:z.enum(["unbuilt","ready","invalid"]),
            ...(expectedSchemaVersion >= 7 ? { installation_id: z.uuid(), profile_id: z.uuid() } : {}) }).parse(raw);
          if (row.search_state === "ready" && row.search_generation !== row.authority_generation) throw new Error("search-generation-mismatch");
        } else if (table === "runs") read.run(raw);
        else if (table === "commands") {
          if (predecessorCustody && isPredecessorWorkerHistory(raw)) assertPredecessorWorkerHistory(raw);
          else read.command(convertPreferences(table, raw));
        }
        else if (table === "run_search") {
          const id = z.object({run_id:z.string()}).parse(raw).run_id;
          const run = readTimelineRun(database,id,read);
          if (run === undefined) throw new Error("run-search-owner-missing");
          runSearchIndexFromRow(raw,run,z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready");
        }
        else if (table === "deleted_runs") deletedRunFromRow(raw);
        else if (table === "settings") readAppSettings(database, convertPreferences);
        else if (table === "worker_slots") (predecessorCustody ? predecessorWorkerSlotFromRow : workerSlotFromRow)(raw);
        else if (table === "exclusive_session_leases") exclusiveSessionLeaseFromRow(raw);
        else if (table === "timeline_events") assertTimelineOwner(database,timelineEventFromRow(raw),false,read);
        else if (table === "artifacts") {
          const {kind} = z.object({kind:z.enum(["imported","generated","extracted"])}).parse(raw);
          if (kind === "imported") importedArtifactFromRow(raw);
          else if (kind === "generated") generatedArtifactFromRow(raw);
          else if (expectedSchemaVersion < 12) {
            const row = z.object({ id: z.string(), payload_json: z.string() }).parse(raw);
            const extraction: unknown = JSON.parse(row.payload_json);
            extractedArtifactFromRow({ ...raw, payload_json: canonicalJsonStringify({ binding: "unbound-source",
              extractionId: row.id, extraction }) });
          } else extractedArtifactFromRow(raw);
        } else if (table === "command_audits" && predecessorCustody && isPredecessorWorkerHistory(database.prepare("SELECT * FROM commands WHERE id=?").get(String(raw.command_id)))) {
          assertPredecessorWorkerHistory(database.prepare("SELECT * FROM commands WHERE id=?").get(String(raw.command_id)), raw);
        } else if (isNativeOrdinaryTable(table)) {
          let inspected = convertPreferences(table, raw);
          if (table === "run_requests" && expectedSchemaVersion < 6) {
            const row = z.object({ payload_json: z.string() }).parse(raw);
            const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(row.payload_json));
            if (expectedSchemaVersion < 5 && Object.hasOwn(payload, "workers")) throw new Error("pre-v5-start-plan-workers-unexpected");
            if (expectedSchemaVersion === 5) z.union([z.literal("auto"), z.number().int().min(1).max(8)]).parse(payload.workers);
            const { workers: _removed, ...plan } = payload;
            inspected = { ...raw, payload_json: canonicalJsonStringify(plan) };
          }
          const record = nativeOrdinaryRecordFromRow(table,inspected,expectedSchemaVersion);
          if (table === "assistant_grants") {
            const grant = AssistantGrantRecordSchema.parse(record), owner = readMetaRow(database);
            if (grant.profileId !== owner.profile_id) throw new Error("assistant-grant-profile-mismatch");
            const command = CommandRequestSchema.parse(read.command(database.prepare("SELECT * FROM commands WHERE id=?").get(grant.commandId)));
            if (command.type !== "apply-settings" || command.payload.assistantPermission === undefined
              || command.payload.assistantPermission.mode !== grant.policy.mode
              || command.payload.assistantPermission.expectedPolicyRevision !== grant.policy.revision - 1) throw new Error("assistant-grant-command-mismatch");
          }
          if (table === "assistant_chats") {
            if (AssistantChatRecordSchema.parse(record).profileId !== readMetaRow(database).profile_id) throw new Error("assistant-chat-profile-mismatch");
          }
          if (table === "assistant_actions") {
            const action = AssistantActionRecordSchema.parse(record);
            const rawChat = database.prepare("SELECT * FROM assistant_chats WHERE id=?").get(action.chatId);
            const chat = AssistantChatRecordSchema.parse(nativeOrdinaryRecordFromRow("assistant_chats", rawChat));
            if (chat.profileId !== action.binding.profileId || chat.epoch !== action.binding.accountSessionEpoch) throw new Error("assistant-action-chat-mismatch");
          }
          if (table === "run_results") assertTerminalEvidenceOwner(database,RunResultRecordSchema.parse(record),read,expectedSchemaVersion >= 20 ? expectedSchemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(raw, PredecessorRunRecordSchema) : runSettlementContext(raw) : undefined, new Set(), expectedSchemaVersion);
          if (table === "run_receipts" && expectedSchemaVersion >= 20) assertRefreshedReceiptSettlement(database,RunEvidenceReceiptSchema.parse(record),raw,expectedSchemaVersion);
          if (table === "write_intents") { authenticateStoredWriteResolution(database,record,read); assertConfirmationPublication(database,z.object({writeIntentId:z.string()}).parse(record).writeIntentId,read); }
          if (table === "command_audits") {
            const audit = NativeCommandAuditSchema.parse(record);
            authenticateStoredResolutionAudit(database,audit,read);
            const commandRow = database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
            if (commandRow === undefined || canonicalJsonStringify(read.command(convertPreferences("commands", commandRow))) !== canonicalJsonStringify(audit.request)
              || z.object({outcome_json:z.string()}).parse(convertPreferences("commands", commandRow)).outcome_json !== canonicalJsonStringify(audit)) throw new Error("command-audit-settlement-mismatch");
          }
        } else throw new Error("native row admission is undefined");
      } catch (error) { throw new Error(`authority table ${table} failed native record validation: ${errorMessage(error)}`,{cause:error}); }
      validated++;
    }
  }
  if (expectedSchemaVersion >= 8 && database.prepare("SELECT 1 FROM assistant_grants WHERE id='current'").get() === undefined
    && database.prepare("SELECT 1 FROM (SELECT json_extract(request_json,'$.payload.assistantPermission.mode') AS mode FROM commands WHERE state='succeeded' AND json_type(request_json,'$.payload.assistantPermission')='object' ORDER BY rowid DESC LIMIT 1) WHERE ?<11 OR mode IS NULL OR mode NOT IN ('before-submits','without-asking')").get(expectedSchemaVersion) !== undefined) throw new Error("assistant-grant-missing-with-history");
  if (workbookPayloads && expectedSchemaVersion >= 4) validated += validateWorkbookLibrary(database, expectedSchemaVersion >= 13, expectedSchemaVersion >= 18);
  if (expectedSchemaVersion >= 9) createAssistantModelPreferenceRepository({ database, read: work => work(), mutate: () => { throw new Error("assistant-preference-readonly"); } }).get();
  try{readAppSettings(database, convertPreferences);}catch(error){throw new Error(`authority table settings failed native record validation: ${errorMessage(error)}`,{cause:error});}
  return validated;
}

function authorityContentFingerprint(database: DatabaseSync, excludedUpgradeRecord?: string): string {
  const hash = createHash("sha256");
  const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
  for (const table of migrationTableNames(readIntPragma(database, "user_version"))) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      if (table === "database_upgrades" && row.id === excludedUpgradeRecord) continue;
      hash.update(canonicalJsonStringify(rowSchema.parse(row)));
    }
  }
  return hash.digest("hex");
}

const AuthorityRecordFingerprintRowSchema = z.strictObject({ id: z.string(), payload_json: z.string() });

function fixedLayoutUnchangedAuthorityFingerprint(database: DatabaseSync, intent: FixedLayoutActivation): string {
  const initialization = intent.settingsUpdate ?? intent.settingsInitialization;
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const present = new Set(inspectionTableNames(database));
  const hash = createHash("sha256");
  for (const table of AuthorityTableNameSchema.options.filter((name) => present.has(name) && !excluded.has(name))) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      const record = z.record(z.string(), z.unknown()).parse(row);
      if (initialization !== undefined && (table === "commands" && record.id === initialization.commandId
        || table === "command_audits" && record.id === initialization.auditId)) continue;
      hash.update(canonicalJsonStringify(record));
    }
  }
  return hash.digest("hex");
}

function fixedLayoutChangedAuthorityTables(before: DatabaseSync, after: DatabaseSync): readonly string[] {
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const beforeNames = new Set(inspectionTableNames(before));
  const afterNames = new Set(inspectionTableNames(after));
  return AuthorityTableNameSchema.options.filter((table) => !excluded.has(table)).filter((table) => {
    if (beforeNames.has(table) !== afterNames.has(table)) return true;
    if (!beforeNames.has(table)) return false;
    const fingerprint = (database: DatabaseSync): string => {
      const hash = createHash("sha256");
      for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
        hash.update(canonicalJsonStringify(z.record(z.string(), z.unknown()).parse(row)));
      }
      return hash.digest("hex");
    };
    return fingerprint(before) !== fingerprint(after);
  });
}

function assertFixedLayoutPublications(before: DatabaseSync, after: DatabaseSync, sourceGeneration: number, activatedAt: string): void {
  const schema = z.strictObject({ id: z.literal(1), schema_version: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
    authority_generation: z.number().int().nonnegative(), updated_at: z.string(),
    search_generation: z.number().int().nonnegative().nullable(), search_state: z.enum(["unbuilt", "ready", "invalid"]),
    installation_id: z.uuid(), profile_id: z.uuid() });
  const prior = schema.parse(before.prepare("SELECT * FROM database_states WHERE id=1").get());
  const current = schema.parse(after.prepare("SELECT * FROM database_states WHERE id=1").get());
  const ready = prior.search_state === "ready" && prior.search_generation === sourceGeneration;
  const expected = { ...prior, authority_generation: sourceGeneration + 1, updated_at: activatedAt,
    search_generation: ready ? sourceGeneration + 1 : null, search_state: ready ? "ready" : "invalid" };
  if (prior.authority_generation !== sourceGeneration || canonicalJsonStringify(current) !== canonicalJsonStringify(expected)) {
    throw new Error("fixed-layout: search publication differs from activation transaction");
  }
}

const FixedLayoutSettingsSnapshotRowSchema = AuthorityRecordFingerprintRowSchema.extend({
  revision: z.number().int().positive(), fingerprint: FingerprintSchema, captured_at: IsoInstantSchema,
});

function fixedLayoutSettingsSnapshots(database: DatabaseSync): readonly string[] {
  return database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all().map((raw) => {
    const row = FixedLayoutSettingsSnapshotRowSchema.parse(raw);
    const record = ConfigSnapshotRecordSchema.parse(JSON.parse(row.payload_json));
    if (record.configSnapshotId !== row.id || record.capturedAt !== row.captured_at
      || record.revision !== row.revision || record.fingerprint !== row.fingerprint) {
      throw new Error("fixed-layout: snapshot row metadata changed");
    }
    return canonicalJsonStringify(row);
  });
}

function fixedLayoutAppSettings(database: DatabaseSync) {
  const rows = database.prepare("SELECT * FROM settings ORDER BY id").all()
    .map((raw) => AuthorityRecordFingerprintRowSchema.extend({ revision: z.number().int().positive(),
      snapshot_id: z.string(), command_id: z.string(), audit_id: z.string(), updated_at: z.string() }).parse(raw));
  if (rows.length > 1 || rows.some((row) => row.id !== "current")) {
    throw new Error("fixed-layout: app settings membership changed");
  }
  const row = rows[0];
  if (row === undefined) return null;
  const value = AppSettingsSchema.parse(JSON.parse(row.payload_json));
  const authenticated = readAppSettings(database);
  if (canonicalJsonStringify(authenticated) !== canonicalJsonStringify(value)
    || row.revision !== (value.saved?.revision ?? 1)
    || row.snapshot_id !== (value.active?.configSnapshotId ?? value.initialization.configSnapshotId)
    || row.command_id !== (value.saved?.commandId ?? value.initialization.commandId)
    || row.audit_id !== (value.saved?.auditId ?? value.initialization.auditId)
    || row.updated_at !== (value.saved?.committedAt ?? value.active?.activatedAt ?? value.initialization.initializedAt)) {
    throw new Error("fixed-layout: app settings row metadata changed");
  }
  return value;
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE command.family <> 'bulk-parent' AND NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.id)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    providerReservations: 0,
    artifactOutbox: count("SELECT count(*) AS count FROM artifacts f,json_each(f.payload_json,'$.updates') u WHERE f.kind='generated' AND json_extract(u.value,'$.record.state')='pending'"),
  };
}

const expectedNativeSchemas = new Map<string, string>();
function normalizedNativeSchema(database: DatabaseSync): string {
  const schema = z.strictObject({type:z.string(),name:z.string(),table:z.string(),sql:z.string()});
  return canonicalJsonStringify(database.prepare("SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(raw => { const row = schema.parse(raw); return {...row,sql:row.sql.trim().replace(/\s+/gu," ")}; }));
}
function expectedNativeSchema(version: number, withoutRunSearch: boolean): string {
  const key = `${String(version)}:${String(withoutRunSearch)}`;
  const cached = expectedNativeSchemas.get(key);
  if (cached !== undefined) return cached;
  const expected = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) if (migration.version <= version) for (const statement of migration.statements) execMigrationStatement(expected, statement);
    if (withoutRunSearch) expected.exec("DROP TABLE run_search");
    const schema = normalizedNativeSchema(expected);
    expectedNativeSchemas.set(key, schema);
    return schema;
  } finally { expected.close(); }
}
export type StartupFailureClassification = Readonly<{ kind: "damaged" }> | Readonly<{ kind: "missing-run-search-projection" }>
  | Readonly<{ kind: "version-skew"; error: AuthorityFormatUnsupportedError }> | Readonly<{ kind: "intact" }>;

/** SQLite's own verdict: SQLITE_CORRUPT (11) or SQLITE_NOTADB (26), on the error or its direct cause. */
function isSqliteDamage(error: unknown): boolean {
  for (const value of [error, error instanceof Error ? error.cause : undefined]) {
    if (value instanceof Error && "errcode" in value && (value.errcode === 11 || value.errcode === 26)) return true;
  }
  return false;
}

function runSearchDefinitions(): readonly string[] {
  const expected = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) execMigrationStatement(expected, statement);
    return z.array(z.strictObject({ sql: z.string() })).parse(expected.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='run_search' AND sql IS NOT NULL ORDER BY type DESC,name").all()).map(row => row.sql);
  } finally { expected.close(); }
}

function nonProjectionFingerprint(database: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const table of migrationTableNames(readIntPragma(database, "user_version"))) {
    if (table === "run_search") continue;
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
      const record = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(row);
      if (table === "database_states") { delete record.search_generation; delete record.search_state; }
      hash.update(canonicalJsonStringify(record));
    }
  }
  return hash.digest("hex");
}

function assertNativeSchema(database: DatabaseSync, version = CURRENT_AUTHORITY_SCHEMA_VERSION, withoutRunSearch = false): void {
  if (normalizedNativeSchema(database) !== expectedNativeSchema(version, withoutRunSearch)) throw new Error("authority-native-schema-shape-mismatch");
}

export function inspectNativeAuthority(database: DatabaseSync, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas = false,
  missingRunSearch = false, workbookPayloads = true) {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if ((!isSupportedStoppedAuthoritySchemaVersion(expectedSchemaVersion) && expectedSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) || schemaVersion !== expectedSchemaVersion) throw new AuthoritySchemaVersionError(schemaVersion);
  assertNativeSchema(database, schemaVersion, missingRunSearch);
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
  const names = inspectionTableNames(database);
  const expected = [...migrationTableNames(expectedSchemaVersion)].filter(name => !missingRunSearch || name !== "run_search").sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = readMetaRow(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  validateAuthorityRecordSchemas(database, !missingRunSearch, expectedSchemaVersion, workbookPayloads);
  validateNotificationMetadata(database);
  const violations = invariantViolations(database);
  if (violations.length > 0) throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
  if (!missingRunSearch) createRunSearchIndex(database).validateCoverage(inspectionRunReader(expectedSchemaVersion));
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
  const currentTables = AuthorityCopyInspectionSchema.shape.tables;
  const predecessorTables = [...(expectedSchemaVersion < 10 ? ["explorer_overrides" as const] : []),
    ...(expectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION ? WORKER_CUSTODY_DROPPED_TABLES : [])];
  const tables = predecessorTables.length === 0 ? currentTables : z.array(z.union([currentTables.element,
    z.strictObject({ name: z.enum(predecessorTables), classification: z.literal("authority") }),
  ]));
  return AuthorityCopyInspectionSchema.extend({ tables, schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14), z.literal(15), z.literal(16), z.literal(17), z.literal(18), z.literal(19), z.literal(20), z.literal(21), z.literal(22), z.literal(23), z.literal(24), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]), installationId: z.uuid().optional(), profileId: z.uuid().optional() }).parse({
    applicationId,
    schemaVersion,
    installationId: meta.installation_id,
    profileId: meta.profile_id,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    // Without run_search the full fingerprint cannot be read; only startup classification asks for this shape.
    authorityContentFingerprint: missingRunSearch ? nonProjectionFingerprint(database) : authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: expectedSchemaVersion < 10 && name === "explorer_overrides" || isWorkerCustodyDroppedTable(name)
      ? "authority" : tableClassification(AuthorityTableNameSchema.parse(name)) })),
    counts: pendingCounts(database),
  });
}

function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean, workbookPayloads = true): AuthorityCopyInspection {
  return AuthorityCopyInspectionSchema.parse(inspectNativeAuthority(database, CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas, false, workbookPayloads));
}

/** Internal stopped-upgrade barrier; never exported through the repository entrypoint. */
/** Applies every migration after `version` with the data steps that run between its statements; the caller owns the transaction and the version stamp. */
export function applyAuthorityMigrationsAfter(database: DatabaseSync, version: number, input: Readonly<{ now: string;
  binding?: Readonly<{ installationId: string; profileId: string }>; captureFile: Parameters<typeof convertWorkerCustody>[2] }>): void {
  const settleEvidence = (record: Parameters<typeof settlePredecessorRunEvidence>[1], run: Parameters<typeof settlePredecessorRunEvidence>[2]) => settlePredecessorRunEvidence(database, record, run);
  for (const migration of SQLITE_MIGRATIONS.filter(item => item.version > version)) {
    for (const [index, statement] of migration.statements.entries()) {
      if (migration.version === 7 && index === 1) {
        if (input.binding === undefined) throw new Error("authority-migration-binding-required");
        database.prepare("INSERT INTO database_states_bound SELECT id,schema_version,authority_generation,updated_at,search_generation,search_state,?,? FROM database_states")
          .run(input.binding.installationId, input.binding.profileId);
      }
      if (migration.version === BUILD_ID_ENVELOPE_SCHEMA_VERSION && index === 0) deletePreBuildRuns(database, input.now, input.captureFile, settleEvidence);
      if (statement === `SELECT '${WORKER_CUSTODY_CONVERSION_ID}'`) convertWorkerCustody(database, input.now, input.captureFile, settleEvidence);
      execMigrationStatement(database, statement);
      if (migration.version === 16 && index === 2) migratePersonPreferences(database);
      if (statement === `SELECT '${WORKER_CUSTODY_SCAN_ID}'`) assertWorkerCustodyConverted(database);
    }
  }
}

export function inspectNormalAuthority(database: DatabaseSync): AuthorityCopyInspection {
  if (!isCurrentAuthoritySchemaVersion(readIntPragma(database, "user_version"))) throw new Error("normal-authority-schema-mismatch");
  return inspectOpenDatabase(database, false);
}

function readAuthorityUpgradeRecords(database: DatabaseSync) {
  return database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()
    .map(row => AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", row)));
}

const startupLogoutConversionBrand: unique symbol = Symbol("startup-logout-conversion");
export type StartupLogoutConversion = Readonly<{ [startupLogoutConversionBrand]: true }>;
const startupLogoutConversions = new WeakMap<StartupLogoutConversion, {
  admission: RuntimeAdmission; operation: LogoutOperation; next: LogoutOperation;
  verifyBackup: (admission: RuntimeAdmission, path: string) => VerifiedBackup;
}>();

function convertedLogoutOperation(operation: LogoutOperation, sourceFingerprint: string, currentFingerprint: string): LogoutOperation {
  const settlement = operation.settlement;
  if (settlement === undefined) throw new Error("profile-startup-logout-settlement-required");
  if (settlement.after === sourceFingerprint) return LogoutOperationSchema.parse({ ...operation, settlement: { ...settlement, after: currentFingerprint } });
  if (settlement.before !== sourceFingerprint) throw new Error("profile-startup-logout-source-changed");
  const { after: _after, ...prepared } = settlement;
  return LogoutOperationSchema.parse({ ...operation, settlement: { ...prepared, phase: "prepared", before: currentFingerprint } });
}

function migrateStoppedAuthority(database: DatabaseSync, clock: Clock, admission: RuntimeAdmission, path: string, expectedFingerprint?: string, backup?: VerifiedBackup, verifyBackup?: (admission: RuntimeAdmission, manifestPath: string) => VerifiedBackup) {
  requireRuntimeAdmission(admission);
  const version = readIntPragma(database, "user_version");
  if (version === CURRENT_AUTHORITY_SCHEMA_VERSION) return inspectNormalAuthority(database);
  const purpose = admission.assertProfileMigration(path, version);
  const binding = admission.profileBinding;
  if (!isSupportedStoppedAuthoritySchemaVersion(version)) throw new AuthoritySchemaVersionError(version);
  database.exec("BEGIN EXCLUSIVE");
  try {
    admission.assertProfileMigration(path, version);
    if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("authority-application-mismatch");
    inspectNativeAuthority(database, version);
    const meta = readMetaRow(database);
    if (meta.schema_version !== version) throw new Error("authority-schema-metadata-mismatch");
    const fingerprint = authorityContentFingerprint(database);
    admission.assertProfileMigration(path, version, fingerprint);
    if (expectedFingerprint !== undefined && fingerprint !== expectedFingerprint) throw new Error("source-changed: re-plan upgrade");
    if (backup === undefined || expectedFingerprint === undefined) throw new Error("upgrade-verified-backup-required");
    if (purpose === "ready") {
      if (verifyBackup === undefined) throw new Error("stopped-backup-verifier-required");
      const verified = verifyBackup(admission, backup.manifestPath);
      if (canonicalJsonStringify(verified) !== canonicalJsonStringify(backup)
        || verified.manifest.installationId !== binding.installationId || verified.manifest.profileId !== binding.profileId) throw new Error("profile-stopped-upgrade-backup-changed");
    }
    if (backup.manifest.schemaVersion !== version || backup.manifest.authorityContentFingerprint !== fingerprint
      || backup.manifest.authorityGeneration !== meta.authority_generation) throw new Error("source-changed: upgrade backup differs from source");
    const planDigest = deriveAuthorityUpgradePlanDigest(version, fingerprint);
    const logout = admission.stoppedUpgradeLogout();
    if (logout?.settlement !== undefined && fingerprint !== logout.settlement.before && fingerprint !== logout.settlement.after) throw new Error("profile-startup-logout-source-changed");
    applyAuthorityMigrationsAfter(database, version, { now: clock.now().toISOString(), binding, captureFile: ref => inspectArtifactDeletionFile(admission, ref) });
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    const record = AuthorityUpgradeRecordSchema.parse({ recordKey: randomUUID(), upgradeId: fingerprint,
      phase: "settled", fromSchemaVersion: version, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      planDigest, backup: { manifestPath: backup.manifestPath, sha256: backup.manifest.sha256, authorityGeneration: backup.manifest.authorityGeneration },
      ...(logout?.settlement === undefined ? {} : { startupLogout: { operation: logout, postimage: authorityContentFingerprint(database) } }),
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() });
    database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(record.recordKey, record.upgradeId, record.phase, backup.manifest.sha256, canonicalJsonStringify(record), record.recordedAt);
    const inspection = inspectNormalAuthority(database);
    database.exec("COMMIT");
    return { ...inspection, schemaVersion: version, authorityContentFingerprint: fingerprint };
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch (rollbackError) { throw retainAuthoritySourceClosure([error, rollbackError], { database }); }
    throw error;
  }
}

function browserProfileInventory(database: DatabaseSync, inspectedSchemaVersion: number) {
  const convert = inspectedSchemaVersion < 16 ? convertPersonPreferencesRow : (_table: string, row: unknown) => row;
  const settings = readAppSettings(database, convert);
  const settingsAuthority = settings === undefined
    ? Object.freeze({ state: "never-initialized" as const })
    : Object.freeze({ state: "initialized" as const, record: settings });
  const configSnapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
    .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", convert("settings_snapshots", row))));
  // A predecessor slot's pause is its newest lease directive, which the custody migration carries onto the slot.
  const predecessorPaused = (slot: WorkerSlotRecord) => ({ ...slot, paused: database.prepare("SELECT directive FROM worker_leases WHERE worker_id=? ORDER BY lease_generation DESC LIMIT 1").get(slot.workerId)?.directive === "pause" });
  const slots = database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all()
    .map(inspectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION ? row => predecessorPaused(predecessorWorkerSlotFromRow(row)) : workerSlotFromRow);
  return { settingsAuthority, configSnapshots, slots };
}

export function settlePredecessorRunEvidence(database: DatabaseSync, record: RunResultRecord, run: PredecessorRunRecord): void {
  const columns = runSettlementColumns(run, record, PredecessorRunRecordSchema);
  database.prepare(`INSERT INTO run_results (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(() => "?").join(",")})`)
    .run(...Object.values(columns));
  assertTerminalEvidenceOwner(database, record, PREDECESSOR_CUSTODY_READERS, run, new Set(), BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1);
}

function maintenanceInventory(database: DatabaseSync, inspection: ReturnType<typeof inspectNativeAuthority>, artifactRoot: string) {
  const browserProfiles = browserProfileInventory(database, inspection.schemaVersion);
  const runs = database.prepare("SELECT * FROM runs ORDER BY id").all().map(inspectionRunReader(inspection.schemaVersion));
  const writeIntents = database.prepare("SELECT * FROM write_intents ORDER BY id").all().map(row => WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", row)));
  const duoLeases = database.prepare("SELECT * FROM auth_leases ORDER BY credential_key").all().map(row => DuoCeremonyLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("auth_leases", row)));
  const exclusiveSessionLeases = inspection.schemaVersion >= 14 ? database.prepare("SELECT * FROM exclusive_session_leases ORDER BY id").all().map(exclusiveSessionLeaseFromRow) : [];
  const pendingArtifacts = createGeneratedArtifactRepository({ database, mutate: () => { throw new Error("profile-maintenance-mutation-refused"); } }).outbox.listPending();
  return Object.freeze({ authorityGeneration: inspection.authorityGeneration, ...browserProfiles, runs, writeIntents, duoLeases, exclusiveSessionLeases, pendingArtifacts, upgrades: readAuthorityUpgradeRecords(database), artifactReferences: readManagedArtifactReferencesFromDatabase(database, artifactRoot) });
}

function flatQueuedRunCancellationInventory(database: DatabaseSync, artifactRoot: string, assertResourcesClosed: (facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) => void) {
  const inspection = inspectNativeAuthority(database, 6);
  if (inspection.installationId !== undefined || inspection.profileId !== undefined) throw new Error("queued-run-cancellation-binding-refused");
  const facts = maintenanceInventory(database, inspection, artifactRoot);
  const candidates = facts.runs.filter(run => run.lifecycle.state !== "terminal");
  for (const run of candidates) {
    if (run.lifecycle.state !== "queued" || run.claimGeneration !== 0 || runClaim(run) !== undefined
      || run.lifecycle.requeuedFrom !== undefined || run.envelope.parent !== undefined
      || database.prepare("SELECT 1 FROM write_intents WHERE run_id=? LIMIT 1").get(run.envelope.runId) !== undefined
      || database.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=? LIMIT 1").get(run.envelope.runId) !== undefined
      || database.prepare("SELECT 1 FROM run_delegations WHERE parent_run_id=? LIMIT 1").get(run.envelope.runId) !== undefined) {
      throw new Error("queued-run-cancellation-ineligible");
    }
  }
  assertResourcesClosed({ ...facts, runs: facts.runs.filter(run => run.lifecycle.state === "terminal") });
  const { installationId: _installationId, profileId: _profileId, ...nativeInspection } = inspection;
  return { digest: sha256Hex(canonicalJsonStringify({ inspection: nativeInspection, facts })), candidates };
}

function requireStoppedUpgradeSource(admission: RuntimeAdmission, path: string, processLockRoot: string, _clock: Clock, backup = false): void {
  if (backup) requireRuntimeAdmission(admission).assertStoppedAuthorityBackup(path, processLockRoot);
  else requireRuntimeAdmission(admission).assertStoppedProfileUpgrade(path, processLockRoot);
  requireDatabaseSourcePath(path);
  const operation = admission.maintenanceOperation();
  admission.assertOfflineMaintenance(operation);
  assertOfflineMaintenanceForProcessRoot(operation, processLockRoot);
}

function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number, workbookPayloads = true): AuthorityCopyInspection {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const snapshotCopy = createReadonlyAuthoritySnapshot(parsedPath);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    transactionOpen = true;
    const inspection = inspectOpenDatabase(database, false, workbookPayloads);
    database.exec("COMMIT");
    transactionOpen = false;
    return inspection;
  } finally {
    try {
      if (transactionOpen) database.exec("ROLLBACK");
    } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

/** A reader that fails to close keeps its snapshot files with the retained owner. */
function closeSnapshotReader(database: DatabaseSync, snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot>): void {
  try { database.close(); } catch (error) { throw retainAuthoritySourceClosure([error], { snapshot, database }); }
  try { snapshot.assertUnchanged(); } finally { snapshot.dispose(); }
}

/** A direct reader's unproved close stays registered with the admission that ran it, even when a caller folds the error into a report. */
function withDirectReaderAdmission<T>(admission: RuntimeAdmission, read: () => T): T {
  try { return read(); } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

type AuthorityReadIdentitySnapshot = Readonly<{
  authorityGeneration: number;
  authorityContentFingerprint: string;
}>;

function inspectAuthorityReadIdentityReadOnly(
  path: string,
  busyTimeoutMs: number,
  readWithinSnapshot?: (database: DatabaseSync) => void,
): AuthorityReadIdentitySnapshot {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const snapshotCopy = createReadonlyAuthoritySnapshot(parsedPath);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    transactionOpen = true;
    const applicationId = readIntPragma(database, "application_id");
    if (applicationId !== AUTHORITY_APPLICATION_ID) {
      throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
    }
    const schemaVersion = readIntPragma(database, "user_version");
    if (!isCurrentAuthoritySchemaVersion(schemaVersion)) {
      throw new Error(
        `authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`,
      );
    }
    const names = inspectionTableNames(database);
    const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
    if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
      throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
    }
    const meta = readMetaRow(database);
    readWithinSnapshot?.(database);
    const snapshot = Object.freeze({
      authorityGeneration: meta.authority_generation,
      authorityContentFingerprint: FingerprintSchema.parse(authorityContentFingerprint(database)),
    });
    database.exec("COMMIT");
    transactionOpen = false;
    return snapshot;
  } finally {
    try {
      if (transactionOpen) database.exec("ROLLBACK");
    } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

function mismatchSummary(
  field: string,
  spanValue: unknown,
  authorityValue: unknown,
  table: "runs" | "deleted_runs",
): string | undefined {
  const spanJson = canonicalJsonStringify(spanValue);
  const authorityJson = canonicalJsonStringify(authorityValue);
  return spanJson === authorityJson
    ? undefined
    : `span root ${field} ${spanJson} does not match ${table} authority ${authorityJson}`;
}

function liveSpanRootMismatches(root: SpanAuthorityRunRoot, run: RunRecord): readonly string[] {
  const envelope = run.envelope;
  return [
    mismatchSummary("runId", root.runId, envelope.runId, "runs"),
    mismatchSummary("workflow", root.workflow, envelope.workflow, "runs"),
    mismatchSummary("itemId", root.itemId, envelope.itemId, "runs"),
    mismatchSummary("traceId", root.traceId, envelope.traceId, "runs"),
    mismatchSummary("finalAttempt", root.finalAttempt, envelope.attempt, "runs"),
    mismatchSummary("parentRunId", root.parentRunId ?? null, envelope.parent?.runId ?? null, "runs"),
    mismatchSummary("shape", root.shape, envelope.shape, "runs"),
    mismatchSummary("priority", root.priority, envelope.priority, "runs"),
    mismatchSummary("dryRun", root.dryRun, envelope.dryRun, "runs"),
    mismatchSummary("retryOf", root.retryOf ?? null, envelope.retryOf ?? null, "runs"),
    mismatchSummary("descriptorVersion", root.descriptorVersion, envelope.descriptorVersion, "runs"),
    mismatchSummary("contractFingerprint", root.contractFingerprint, envelope.contractFingerprint, "runs"),
    mismatchSummary("resolvedInstance", root.resolvedInstance, envelope.resolvedInstance, "runs"),
    mismatchSummary("configFingerprint", root.configFingerprint, envelope.configFingerprint, "runs"),
    mismatchSummary("configSnapshotId", root.configSnapshotId, envelope.configSnapshotId, "runs"),
    mismatchSummary("queuedAt", root.queuedAt, envelope.enqueuedAt, "runs"),
  ].filter((issue): issue is string => issue !== undefined);
}

function structuralSpanRootIssues(roots: readonly SpanAuthorityRunRoot[]): readonly (readonly string[])[] {
  const issues = roots.map((root) => [...root.streamIssues]);
  const occurrenceCount = new Map<string, number>();
  for (const root of roots) occurrenceCount.set(root.runId, (occurrenceCount.get(root.runId) ?? 0) + 1);
  const lastAttemptByItem = new Map<string, number>();
  for (const [index, root] of roots.entries()) {
    const rootIssues = issues[index];
    if (rootIssues === undefined) throw new Error(`span authority root ${String(index)} has no structural issue bucket`);
    const add = (issue: string): void => {
      if (!rootIssues.includes(issue)) rootIssues.push(issue);
    };
    if ((occurrenceCount.get(root.runId) ?? 0) > 1) {
      add(`duplicate run.queued root for run ${root.runId}`);
    }
    if (root.spanPath !== root.traceId) {
      add("run.queued root spanPath does not equal traceId");
    }
    const itemKey = `${root.workflow}\u0000${root.itemId}`;
    const previousAttempt = lastAttemptByItem.get(itemKey);
    if (previousAttempt !== undefined && root.initialAttempt <= previousAttempt) {
      add(
        `run.queued item attempt ${String(root.initialAttempt)} did not strictly increase after ${String(previousAttempt)}`,
      );
    }
    lastAttemptByItem.set(itemKey, root.initialAttempt);
  }
  return issues;
}

function inspectSpanRunAuthorityReadOnly(path: string, rootsInput: readonly SpanAuthorityRunRoot[], busyTimeoutMs: number): SpanAuthorityReadSnapshot {
  const roots = z.array(SpanAuthorityRunRootSchema).readonly().parse(rootsInput);
  const rootIssues = structuralSpanRootIssues(roots);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error("span-authority-database-missing-or-empty");
  const snapshotCopy = createReadonlyAuthoritySnapshot(path);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path,{readOnly:true,enableForeignKeyConstraints:true,allowExtension:false,timeout:busyTimeoutMs});
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA query_only=ON"); database.exec("BEGIN"); transactionOpen = true;
    if (readIntPragma(database,"application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("span-authority-application-mismatch");
    const version = readIntPragma(database,"user_version");
    if (!isCurrentAuthoritySchemaVersion(version)) throw new AuthoritySchemaVersionError(version);
    assertNativeSchema(database);
    const meta = readMetaRow(database);
    if (meta.schema_version !== version) throw new Error("span-authority-schema-metadata-mismatch");
    const queuedRunIds = new Set(roots.map(root => root.runId));
    const runs = new Map<string,RunRecord>();
    const malformedRecords: Array<z.input<typeof SpanAuthorityReadSnapshotSchema>["malformedRecords"][number]> = [];
    for (const raw of database.prepare("SELECT * FROM runs ORDER BY id").all()) {
      const key = z.object({id:z.string()}).parse(raw).id;
      try { runs.set(key,runRecordFromRow(raw)); }
      catch { malformedRecords.push({state:"malformed-authority",source:"current",recordKey:key,summary:"runs authority failed its strict native row validation"}); }
    }
    const resolutions = roots.map((root,index) => {
      const issues = rootIssues[index];
      if (issues === undefined) throw new Error("span-authority-structural-issues-missing");
      if (issues.length > 0) return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"span_stream",summary:issues.join("; ")});
      const deletedRow = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(root.runId);
      if (deletedRow !== undefined) {
        try {
          const {receipt} = deletedRunFromRow(deletedRow);
          const mismatches = [mismatchSummary("workflow",root.workflow,receipt.workflow,"deleted_runs"),
            mismatchSummary("itemId",root.itemId,receipt.itemId,"deleted_runs"),mismatchSummary("traceId",root.traceId,receipt.traceId,"deleted_runs"),
            mismatchSummary("finalAttempt",root.finalAttempt,receipt.attempt,"deleted_runs")].filter((issue):issue is string=>issue !== undefined);
          if (runs.has(root.runId) || mismatches.length > 0) throw new Error("deleted-run-span-identity-mismatch");
          return SpanAuthorityRunResolutionSchema.parse({state:"deleted",runId:receipt.runId,workflow:receipt.workflow,traceId:receipt.traceId,
            origin:receipt.origin,commandId:receipt.commandId,deletedAt:receipt.deletedAt});
        } catch { return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"deleted_runs",summary:"deletion receipt failed native row or span identity validation"}); }
      }
      if (malformedRecords.some(record=>record.recordKey === root.runId)) return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"runs",summary:"runs authority failed its strict native row validation"});
      const run = runs.get(root.runId);
      if (run === undefined) return SpanAuthorityRunResolutionSchema.parse({state:"missing",runId:root.runId});
      const mismatches = liveSpanRootMismatches(root,run);
      return SpanAuthorityRunResolutionSchema.parse(mismatches.length === 0 ? {state:"live",runId:root.runId}
        : {state:"malformed",runId:root.runId,table:"runs",summary:mismatches.join("; ")});
    });
    const snapshot = SpanAuthorityReadSnapshotSchema.parse({authorityGeneration:meta.authority_generation,authorityContentFingerprint:authorityContentFingerprint(database),
      liveRunCount:runs.size,archivedRunCount:0,tombstoneOrdinalFindings:[],malformedRecords,resolutions,
      missingSpanRunIds:malformedRecords.length === 0 ? [...runs.keys()].filter(id=>!queuedRunIds.has(RunIdSchema.parse(id))).map(id=>RunIdSchema.parse(id)) : []});
    database.exec("COMMIT");transactionOpen = false;
    return Object.freeze(snapshot);
  } finally {
    try { if (transactionOpen) database.exec("ROLLBACK"); } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

export class CredentialContextRequiredError extends Error {
  readonly code = "CREDENTIAL_CONTEXT_REQUIRED";
  constructor() {
    super(ERROR_CATALOG.CREDENTIAL_CONTEXT_REQUIRED.text);
    this.name = "CredentialContextRequiredError";
  }
}

function readManagedArtifactReferencesFromDatabase(database: DatabaseSync, artifactRoot: string, candidate?: ArtifactRef): readonly ArtifactRef[] {
      const references = new Map<string, ArtifactRef>();
      const deletions = database.prepare("SELECT * FROM deleted_runs").all().map(deletedRunFromRow);
      const retainedCandidates = artifactReferencesIn([
        ...deletions.flatMap(deletion => deletion.files.filter(file => file.disposition === "retain" || deletion.cleanupState === "pending").map(file => file.ref)),
        ...(candidate === undefined ? [] : [candidate]),
      ]);
      for (const deletion of deletions) if (deletion.cleanupState === "pending") {
        for (const file of deletion.files) if (file.disposition === "remove") {
          try { fileStatus(join(artifactRoot, `${file.ref.sha256}.artifact`)); }
          catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
            throw error;
          }
          references.set(file.ref.sha256, file.ref);
        }
      }
      const retainedBy = new Map<string, ArtifactRef>(retainedCandidates.map(ref => [ref.sha256, ref])), retainedIn = deletionArtifactReferenceMatcher(retainedCandidates);
      const visit = (value: unknown): void => {
        for (const digest of retainedIn(value)) { const ref = retainedBy.get(digest); if (ref !== undefined) references.set(digest, ref); }
        for (const ref of artifactReferencesIn(value)) references.set(ref.sha256, ref);
      };
      for (const table of AUTHORITY_TABLE_REGISTRY.map(entry => entry.name)) {
        if (table === "deleted_runs") continue;
        const columns = database.prepare(`PRAGMA table_info(${table})`).all()
          .map(raw => TableColumnRowSchema.parse(raw).name)
          .filter(name => name.endsWith("_json"));
        if (columns.length === 0) continue;
        const retained = table === "diagnostic_snapshots" ? " WHERE json_extract(payload_json,'$.availability.state') IS NOT 'purged'"
          : table === "diagnostic_files" ? " WHERE snapshot_id IN (SELECT id FROM diagnostic_snapshots WHERE json_extract(payload_json,'$.availability.state') IS NOT 'purged')" : "";
        for (const raw of database.prepare(`SELECT ${columns.join(",")} FROM ${table}${retained}`).all()) {
          for (const value of Object.values(raw)) {
            if (typeof value === "string") visit(JSON.parse(value));
          }
        }
      }
      // Table scans return rows in storage order, which a rebuild can change; inventories compare this list, so order it by content.
      return Object.freeze([...references.values()].sort((a, b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0).map(reference => Object.freeze(reference)));
}

export function configureWritableConnection(database: DatabaseSync, busyTimeoutMs: number): void {
  database.exec("PRAGMA foreign_keys = ON");
  // Enable secure deletion so freed SQLite pages do not retain deleted run bytes.
  database.exec("PRAGMA secure_delete = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`);
}

export class AuthorityDatabase implements Disposable {
  readonly #admission: RuntimeAdmission;
  readonly #admitMutation: () => void;
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #credentialCommandIds: (commandId: string) => boolean;
  #closed = false;
  #openedFileIdentity: DirectoryIdentity | undefined;
  #coldLogout: Readonly<{ machine: RuntimeAdmission; operationId: string; admission: RuntimeAdmission; restore: OfflineMaintenanceOperation;
    sourcePath: string; owner: RuntimeAdmission; inspection: ReturnType<RuntimeAdmission["capturePendingLogoutSnapshot"]> }> | undefined;
  #logoutCompletion: Readonly<{ admission: RuntimeAdmission; operation: LogoutOperation; path: string; binding: Readonly<{ installationId: string; profileId: string }> }> | undefined;
  #logoutPublication: Readonly<{ admission: RuntimeAdmission; operation: LogoutOperation }> | undefined;
  #logoutBatch: Readonly<{ admission: RuntimeAdmission }> | undefined;
  #validatedExternalDataVersion: number | undefined;
  #snapshotExternalDataVersion: number | undefined;
  #pageCacheChanges = 0;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | "read" | undefined;
  #delegationReadSnapshot: DelegationOperationReads & {
    waits: Map<string, ReturnType<typeof readDelegationWaitState>>;
  } | undefined;
  /** Delegation reads inside one write transaction, valid while total_changes() and the savepoint rollback count stay the same. */
  #transactionDelegationReads: DelegationOperationReads & { changes: number; rollbacks: number } | undefined;
  #savepointRollbacks = 0;
  #authorityDirty = false;
  #writeCommitHooks: AuthorityWriteCommitHooks | undefined;
  #terminalizationHooks: AuthorityTerminalizationHooks | undefined;

  #authorityCommitCallbacks: (() => void)[] = [];
  #lifecycleHooks: AuthorityLifecycleHooks | undefined;

  readonly authority: AuthorityRepositories;

  private constructor(
    admission: RuntimeAdmission,
    input: unknown,
    clock: Clock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
    lifecycleHooks?: AuthorityLifecycleHooks,
    credentials?: CredentialStore,
    purpose: "stopped-startup-recovery" | "stopped-layout-source" | "stopped-layout-target" | "ordinary" | "profile-initialization" | "profile-onboarding-debug" | "stopped-restore-projection" | "stopped-span-root-repair" | "stopped-logout-settlement" | "stopped-logout-inspection" = "ordinary",
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    this.#admission = requireRuntimeAdmission(admission);
    this.#admitMutation = purpose === "stopped-startup-recovery" ? () => this.#admission.assertStoppedStartupRecoveryDatabase(options.path)
      : purpose === "stopped-layout-target" ? () => this.#admission.assertFixedLayoutDatabase(options.path)
      : purpose === "stopped-layout-source" ? () => { throw new Error("fixed-layout-source-read-only-required"); }
      : purpose === "ordinary" ? () => this.#admission.assertWritable()
      : purpose === "profile-initialization" || purpose === "profile-onboarding-debug" ? () => this.#admission.assertProfileInitialization()
      : purpose === "stopped-restore-projection" ? () => this.#admission.assertStoppedRestoreProjection(options.path)
      : purpose === "stopped-span-root-repair" ? () => this.#admission.assertStoppedProfile(this.#admission.maintenanceOperation())
      : purpose === "stopped-logout-settlement" ? () => { this.#admission.assertPendingLogoutSettlementDatabase(options.path); }
      : () => { throw new Error("profile-logout-inspection-read-only-required"); };
    if (purpose === "stopped-startup-recovery") this.#admission.assertStoppedStartupRecoveryDatabase(options.path);
    else if (purpose === "stopped-layout-source") {
      if (options.openMode === "read-write") throw new Error("fixed-layout-source-read-only-required");
      this.#admission.assertReadOnlyAuthorityDatabase(options.path);
    } else if (purpose === "stopped-layout-target") this.#admission.assertFixedLayoutDatabase(options.path);
    else if (purpose === "stopped-logout-inspection") {
      if (options.openMode === "read-write") throw new Error("profile-logout-inspection-read-only-required");
      this.#admission.assertPendingLogoutInspectionDatabase(options.path);
    } else if (purpose === "stopped-logout-settlement") {
      const operation = this.#admission.assertPendingLogoutSettlementDatabase(options.path);
      if (operation.settlement?.phase === "done" && options.openMode === "read-write") throw new Error("profile-logout-settlement-already-done");
    } else if (purpose === "stopped-span-root-repair") this.#admission.assertReadOnlyAuthorityDatabase(options.path);
    else this.#admission.assertAuthorityDatabase(options.path);
    if (credentials !== undefined) assertCredentialStoreOwner(credentials, this.#admission);
    const binding = this.#admission.profileBinding;
    const existed = options.path !== ":memory:" && existsSync(options.path);
    const readOnlyNoMigrate = options.openMode !== "read-write";
    const mayCreate = purpose === "profile-initialization" || options.path === ":memory:";
    if (existed && purpose === "profile-initialization") throw new Error("profile-database-initialization-already-exists");
    if (!existed && !mayCreate && !readOnlyNoMigrate) throw new Error("profile-database-binding-required");
    if (readOnlyNoMigrate && !existed) {
      throw new Error(`${options.openMode} requires an existing authority database`);
    }
    if (existed) {
      requireDatabaseSourcePath(options.path);
      const identity = fileStatus(options.path);
      if (!identity.isFile() || (identity.nlink !== 1 && identity.nlink !== 1n) || privatePathRejects(options.path, identity, "owner")) throw new Error("profile-database-identity-invalid");
      this.#openedFileIdentity = Object.freeze({ device: identity.dev, inode: identity.ino });
    }
    if (existed && statSync(options.path).size === 0) {
      throw new Error(`authority database ${options.path} exists but is empty; refusing to replace it`);
    }
    this.#clock = clock;
    this.#writeCommitHooks = writeCommitHooks;
    this.#terminalizationHooks = terminalizationHooks;
    this.#lifecycleHooks = lifecycleHooks;
    this.#path = options.path;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#database = new DatabaseSync(readOnlyNoMigrate || mayCreate ? options.path : existingDatabaseLocation(options.path), {
      readOnly: readOnlyNoMigrate,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: options.busyTimeoutMs,
      readBigInts: false,
      returnArrays: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      defensive: true,
    });

    const admittedDataVersion = readIntPragma(this.#database, "data_version");
    try {
      if (options.path !== ":memory:") {
        const identity = fileStatus(options.path);
        if (this.#openedFileIdentity !== undefined && (identity.dev !== this.#openedFileIdentity.device || identity.ino !== this.#openedFileIdentity.inode)) throw new Error("profile-database-open-source-changed");
        this.#openedFileIdentity ??= Object.freeze({ device: identity.dev, inode: identity.ino });
      }
      const existingVersion = existed ? this.#admitExistingSchema() : undefined;
      if (existed) {
        const actual = ProfileDatabaseBindingSchema.parse(this.#database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get());
        if (canonicalJsonStringify(actual) !== canonicalJsonStringify(binding)) throw new Error("profile-database-binding-mismatch");
      }
      if (readOnlyNoMigrate) {
        this.#configureReadOnlyConnection();
      } else {
        if (!existed && purpose !== "stopped-restore-projection") this.#initializeSchema(existingVersion, options.migrationOwner);
        this.#configureConnection();
        if (existed && purpose === "ordinary") this.#initializeSchema(existingVersion, options.migrationOwner);
      }
      this.#database.exec("BEGIN");
      if (readOnlyNoMigrate) this.#validateReadOnlyNoMigrateDatabase(existingVersion);
      else this.#validateDatabase();
      readAppSettings(this.#database);
      this.#database.exec("COMMIT");
      this.#credentialCommandIds = commandId => {
        if (purpose === "stopped-startup-recovery") return stoppedProfileOwnsCredentialCommand(this.#admission, "startup-recovery", commandId);
        if (purpose === "stopped-logout-settlement" || purpose === "stopped-layout-target") return stoppedProfileOwnsCredentialCommand(this.#admission, purpose === "stopped-layout-target" ? "layout" : "logout", commandId);
        if (credentials === undefined) throw new CredentialContextRequiredError();
        assertCredentialStoreOwner(credentials, this.#admission);
        return credentials.ownsCommandId(commandId);
      };
    } catch (error) {
      try { this.#database.close(); }
      catch (closeError) {
        throw retainAuthoritySourceClosure([error, closeError], { database: this.#database, admission: this.#admission });
      }
      if (error instanceof AuthoritySchemaVersionError) throw error;
      throw new Error(`failed to open authority database ${options.path}: ${errorMessage(error)}`, { cause: error });
    }

    if (!readOnlyNoMigrate) {
      createRunSearchIndex(this.#database).installTracking();
    }
    if (readIntPragma(this.#database, "data_version") === admittedDataVersion) this.#validatedExternalDataVersion = admittedDataVersion;
    this.authority = this.#buildAuthorityRepositories();
  }

  static open(
    admission: RuntimeAdmission,
    input: unknown,
    clock: Clock = systemClock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
    lifecycleHooks?: AuthorityLifecycleHooks,
    credentials?: CredentialStore,
  ): AuthorityDatabase {
    admission.assertProfileRuntime();
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const database = new AuthorityDatabase(admission, options, clock, writeCommitHooks, terminalizationHooks, lifecycleHooks, credentials);
    if (options.openMode !== "read-write") return database;
    try {
      database.resumeRunDeletionFiles();
      return database;
    } catch (error) {
      try { database.close(); }
      catch (closeError) { throw retainAuthoritySourceClosure([error, closeError], { database, admission }); }
      throw error;
    }
  }

  static readIncompleteOnboardingInventory(admission: RuntimeAdmission) {
    const owner = requireRuntimeAdmission(admission), path = join(owner.stateRoot, "state.db");
    owner.assertStoppedIncompleteProfileInventory();
    return withAuthorityDatabaseReadOnly(owner, path, database => {
      const inspection = inspectNativeAuthority(database, CURRENT_AUTHORITY_SCHEMA_VERSION), binding = owner.profileBinding;
      if (inspection.installationId !== binding.installationId || inspection.profileId !== binding.profileId) throw new Error("profile-incomplete-inventory-binding-mismatch");
      const names = inspectionTableNames(database), expected = AUTHORITY_TABLE_REGISTRY.map(table => table.name).sort();
      if (canonicalJsonStringify(names) !== canonicalJsonStringify(expected)) throw new Error("profile-incomplete-inventory-schema-mismatch");
      const counts = Object.freeze(AUTHORITY_TABLE_REGISTRY.map(table => Object.freeze({ table: table.name,
        count: z.strictObject({ count: z.number().int().safe().nonnegative() }).parse(database.prepare(`SELECT COUNT(*) AS count FROM ${table.name}`).get()).count })));
      const artifactReferenceCount = readManagedArtifactReferencesFromDatabase(database, owner.artifactRoot).length;
      const initialWorkbookTypeOnly = hasOnlyInitialWorkbookType(database);
      const pristineTable = (row: typeof counts[number]) => row.table === "database_states" || row.table === "database_upgrades"
        || (row.table === "workbook_types" ? initialWorkbookTypeOnly : row.count === 0);
      let empty = counts.every(pristineTable) && artifactReferenceCount === 0;
      const initializationTables = new Set<AuthorityTableName>(["settings", "commands", "command_audits", "settings_snapshots"]);
      if (!empty && artifactReferenceCount === 0
        && counts.every(row => pristineTable(row) || initializationTables.has(row.table))
        && counts.every(row => !["settings", "commands", "command_audits"].includes(row.table) || row.count === 1)) {
        const settings = readAppSettings(database), active = settings?.active;
        if (settings !== undefined && settings.saved === null && active != null
          && canonicalJsonStringify(settings.initialization.settings) === canonicalJsonStringify(initialSettingsFileRecord())
          && active.settingsRevision === 1 && active.settingsFingerprint === settings.initialization.settings.settingsFingerprint) {
          const initial = settings.initialization;
          const command = z.object({ parent_id: z.null(), state: z.literal("succeeded"), outcome_json: z.string() })
            .parse(database.prepare("SELECT * FROM commands WHERE id=?").get(initial.commandId));
          const audit = nativeOrdinaryRecordFromRow("command_audits", database.prepare("SELECT * FROM command_audits WHERE id=?").get(initial.auditId));
          if (canonicalJsonStringify(JSON.parse(command.outcome_json)) !== canonicalJsonStringify(audit)) throw new Error("profile-incomplete-inventory-initialization-mismatch");
          const snapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
            .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", row)));
          const endpoints = new Set([initial.configSnapshotId, active.configSnapshotId]);
          for (const snapshot of snapshots) {
            // Intermediate startup snapshots have no retained activation authority.
            if (!endpoints.has(snapshot.configSnapshotId)) throw new Error("profile-incomplete-inventory-snapshot-unbound");
            if (snapshot.revision !== 1 || snapshot.capturedBy !== LOCAL_OPERATOR_ACTOR_ID
              || snapshot.configSnapshotId === initial.configSnapshotId && (snapshot.fingerprint !== initial.configFingerprint || snapshot.capturedAt !== initial.initializedAt)
              || snapshot.configSnapshotId === active.configSnapshotId && (snapshot.fingerprint !== active.configFingerprint || snapshot.capturedAt !== active.activatedAt)) {
              throw new Error("profile-incomplete-inventory-snapshot-mismatch");
            }
          }
          empty = snapshots.length === endpoints.size && active.generation === snapshots.length;
        }
      }
      owner.assertStoppedIncompleteProfileInventory();
      return Object.freeze({ authorityGeneration: inspection.authorityGeneration, counts, artifactReferenceCount, empty });
    });
  }

  static readProfileMaintenanceInventory(admission: RuntimeAdmission) {
    const owner = requireRuntimeAdmission(admission), path = join(owner.stateRoot, "state.db");
    owner.assertLive();
    return withAuthorityDatabaseReadOnly(owner, path, database => {
      const inspection = inspectNativeAuthority(database, owner.profileMaintenanceSchemaVersion());
      const binding = inspection.schemaVersion === 6 ? undefined : owner.profileBinding;
      if (inspection.schemaVersion === 6
        ? inspection.installationId !== undefined || inspection.profileId !== undefined
        : inspection.installationId !== binding?.installationId || inspection.profileId !== binding?.profileId) throw new Error("profile-maintenance-binding-mismatch");
      return maintenanceInventory(database, inspection, owner.artifactRoot);
    });
  }

  static readProfileRestoreBrowserInventory(admission: RuntimeAdmission, processLockRoot: string, restore: OfflineMaintenanceOperation) {
    const owner = requireRuntimeAdmission(admission), path = join(owner.stateRoot, "state.db");
    const assertHeld = () => {
      owner.assertStoppedProfile(restore);
      const context = owner.readInstallationContext();
      if (context === undefined) throw new Error("profile-restore-context-required");
      owner.assertFixedProcessLockRoot(context.workspace, processLockRoot);
      assertOfflineMaintenanceForProcessRoot(restore, processLockRoot);
    };
    assertHeld();
    return withAuthorityDatabaseReadOnly(owner, path, database => {
      const version = readIntPragma(database, "user_version"), meta = readMetaRow(database), binding = owner.profileBinding;
      if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID
        || version !== owner.profileMaintenanceSchemaVersion() || meta.schema_version !== version
        || meta.installation_id !== binding.installationId || meta.profile_id !== binding.profileId) {
        throw new Error("profile-maintenance-binding-mismatch");
      }
      const custody = Object.freeze(browserProfileInventory(database, version));
      assertHeld();
      return custody;
    });
  }

  static readRestoreCandidateInventory(owner: RuntimeAdmission, copy: RuntimeAdmission, path: string, operation: OfflineMaintenanceOperation) {
    owner.assertStoppedProfile(operation); copy.assertReadOnlyAuthorityDatabase(path);
    return withAuthorityDatabaseReadOnly(copy, path, database => {
      const version = readIntPragma(database, "user_version"), meta = readMetaRow(database), binding = owner.profileBinding;
      if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID || !OPENABLE_AUTHORITY_SCHEMA_VERSIONS.includes(version)
        || meta.schema_version !== version || meta.installation_id !== binding.installationId || meta.profile_id !== binding.profileId) throw new Error("restore-candidate-binding-mismatch");
      const facts = Object.freeze(browserProfileInventory(database, version));
      owner.assertStoppedProfile(operation); return facts;
    });
  }

  static readStoppedBrowserInventory(admission: RuntimeAdmission, processLockRoot: string, clock: Clock) {
    const owner=requireRuntimeAdmission(admission),path=join(owner.stateRoot,"state.db");
    owner.assertStoppedAuthorityBackup(path,processLockRoot);
    const expected=AuthorityDatabase.inspectStoppedUpgrade(owner,path,processLockRoot,clock);
    return withAuthorityDatabaseReadOnly(owner,path,database=>{
      const inspection=inspectNativeAuthority(database,expected.schemaVersion);
      if(inspection.authorityGeneration!==expected.authorityGeneration||inspection.authorityContentFingerprint!==expected.authorityContentFingerprint)throw new Error("stopped-browser-source-changed");
      if(inspection.installationId!==undefined&&(inspection.installationId!==owner.profileBinding.installationId||inspection.profileId!==owner.profileBinding.profileId))throw new Error("profile-maintenance-binding-mismatch");
      return Object.freeze(browserProfileInventory(database, inspection.schemaVersion));
    });
  }

  static async readFlatQueuedRunCancellation(path: string) {
    return withReadonlyAuthoritySnapshot(path, database => flatQueuedRunCancellationInventory(database, join(dirname(path), "artifacts"), assertCredentialCopyResourcesClosed));
  }

  // This finite native6 command cannot grant ordinary profile runtime authority.
  static async cancelQueuedRunsNative6(browserClosure: ProfileBrowserClosure, lease: InstallationLease, restore: OfflineMaintenanceOperation, expectedDigest: string, clock: Clock) {
    const { assertInstallationLease: assertLease, inspectFlatOfflineRunMaintenance } = await import("../admission/installation.js");
    const assertInstallationLease: typeof import("../admission/installation.js").assertInstallationLease = assertLease;
    const { probeFlatBrowserInventoryClosed } = await import("../maintenance/profile-inventory.js");
    assertInstallationLease(lease);
    if (lease.mode !== "exclusive") throw new Error("queued-run-cancellation-exclusive-required");
    const workspace = lease.readInstallationContext().workspace;
    const installation = inspectFlatOfflineRunMaintenance(workspace);
    const stateRoot = lease.locator.stateRoot, path = join(stateRoot, "state.db");
    const assertHeld = () => {
      lease.assertHeld(); assertOfflineMaintenanceForProcessRoot(restore, installation.processLockRoot);
      lease.assertOfflineMaintenance(restore);
      if (canonicalJsonStringify(inspectFlatOfflineRunMaintenance(workspace)) !== canonicalJsonStringify(installation)
        || lease.locator.installationId !== installation.installationId) throw new Error("queued-run-cancellation-installation-changed");
    };
    assertHeld(); requireDatabaseSourcePath(path);
    const initial = await AuthorityDatabase.readFlatQueuedRunCancellation(path);
    if (initial.digest !== expectedDigest) throw new Error("queued-run-cancellation-capture-changed");
    await probeFlatBrowserInventoryClosed(lease, restore, stateRoot, clock, browserClosure);
    assertHeld();
    const database = new DatabaseSync(existingDatabaseLocation(path), { enableForeignKeyConstraints: true, allowExtension: false, timeout: 5000 });
    let runIds: string[] | undefined;
    let failure: { error: unknown } | undefined;
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        const inventory = flatQueuedRunCancellationInventory(database, join(dirname(path), "artifacts"), assertCredentialCopyResourcesClosed);
        if (inventory.digest !== expectedDigest) throw new Error("queued-run-cancellation-capture-changed");
        const now = clock.now().toISOString();
        for (const current of inventory.candidates) {
          const commandId = randomUUID();
          const lifecycle = { state: "terminal" as const, outcome: "cancelled" as const, endedAt: now,
            errorSummary: "cancelled offline: stale queued run" };
          const request = { commandId, runId: current.envelope.runId, expectedVersion: current.version, lifecycle };
          const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId, operation: "transition", request,
            requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0transition\0${canonicalJsonStringify(request)}`),
            fence: { kind: "version", expectedVersion: current.version }, recordedAt: now });
          // The terminal transition drops pause, so the paused-run refusal reads the current record.
          if (Object.hasOwn(current, "pause")) throw new Error("queued-run-cancellation-pause-refused");
          const updated = transitionStoredRun(current, PredecessorRunRecordSchema.parse({ ...current, lifecycle }), now, PredecessorRunRecordSchema);
          const entries = Object.entries(runRecordColumns(updated, PredecessorRunRecordSchema)).filter(([key]) => key !== "id" && key !== "pause_state");
          const changes = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
            .run(...entries.map(([, value]) => value), updated.envelope.runId, current.version).changes);
          if (changes !== 1) throw new Error("run-version-fence-lost");
          insertNativeCommand(database, command);
          const audit = RunLifecycleCommandAuditRecordSchema.parse({ kind: "run-lifecycle", auditId: commandId, request: command,
            result: { kind: "run", runId: current.envelope.runId, appliedVersion: updated.version, terminal: { outcome: "cancelled", endedAt: now } }, completedAt: now });
          database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
            .run(commandId, commandId, canonicalJsonStringify(audit), now);
          settleNativeCommand(database, audit);
          const result = createRunTerminalEvidenceResult(updated, { kind: "lifecycle-evidence", outcome: "cancelled", commandId: command.commandId,
            auditId: audit.auditId, requestFingerprint: command.requestFingerprint, appliedVersion: updated.version });
          database.prepare("INSERT INTO run_results(run_id,workflow,attempt,result_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
            .run(result.runId, result.workflowId, result.attempt, result.resultDigest, canonicalJsonStringify(result), result.createdAt);
          createTimelineRepository({ database, read: work => work(), mutate: work => work().result,
            assertOwner: event => { if (event.scope.kind !== "run" || event.scope.runId !== updated.envelope.runId) throw new Error("timeline-lifecycle-owner-mismatch"); } })
            .append({ schemaVersion: 1, eventId: lifecycleCommandId("timeline-lifecycle", commandId), workflow: updated.envelope.workflow,
              scope: { kind: "run", runId: updated.envelope.runId }, occurredAt: now, recordedAt: now, retentionDate: localDatePart(clock.now()),
              source: { kind: "native" }, payload: { kind: "span", event: { t: "span.ended", kind: "run", outcome: "cancelled",
                pid: process.pid, ts: now, workflow: updated.envelope.workflow, runId: updated.envelope.runId, attempt: updated.envelope.attempt,
                traceId: updated.envelope.traceId, spanPath: updated.envelope.traceId } } });
        }
        if (inventory.candidates.length > 0) database.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid',updated_at=? WHERE id=1").run(now);
        inspectNativeAuthority(database, 6); assertHeld();
        database.exec("COMMIT");
        runIds = inventory.candidates.map(run => run.envelope.runId);
      } catch (error) {
        try { database.exec("ROLLBACK"); }
        catch (rollback) { throw retainAuthoritySourceClosure([error, rollback], { database, admission: lease, restore }); }
        throw error;
      }
    } catch (error) { failure = { error }; }
    try { database.close(); }
    catch (error) { throw retainAuthoritySourceClosure(failure === undefined ? [error] : [failure.error, error], { database, admission: lease, restore }); }
    if (failure !== undefined) throw failure.error;
    if (runIds === undefined) throw new Error("queued-run-cancellation-result-unavailable");
    return runIds;
  }

  static readFlatArchiveInventory(path: string, restore: OfflineMaintenanceOperation) {
    const workspace = offlineMaintenanceWorkspace(restore), root = join(workspace, rebuildRuntimeIsolation.stateRoot);
    const assertHeld = () => {
      assertOfflineMaintenanceForProcessRoot(restore, join(workspace, rebuildRuntimeIsolation.processLockRoot));
      if (path !== join(root, "state.db") && (dirname(path) !== join(root, "backups", "authority")
        || !/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite$/u.test(basename(path)))) throw new Error("flat-archive-database-path-refused");
      requireDatabaseSourcePath(path);
    };
    assertHeld();
    return withReadonlyAuthoritySnapshot(path, database => {
      if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID || readIntPragma(database, "user_version") !== 6) throw new Error("flat-backup-schema-refused");
      assertNativeSchema(database, 6);
      QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
      if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) throw new Error("flat-archive-integrity-refused");
      const meta = readMetaRow(database);
      if (meta.schema_version !== 6 || meta.installation_id !== undefined || meta.profile_id !== undefined) throw new Error("flat-backup-schema-refused");
      const settings = readAppSettings(database, convertPersonPreferencesRow);
      const configSnapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
        .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", convertPersonPreferencesRow("settings_snapshots", row))));
      const expectedPaths = { stateRoot: root, artifactRoot: join(root, "artifacts"), browserProfileRoot: join(root, "browsers"),
        duoCredential: join(root, "credentials", "duo-webauthn.json"), reportsDir: join(workspace, "data", "reports"),
        downloadsDir: join(workspace, "data", "downloads"), onboardingDocsDir: join(workspace, "data", "onboarding"),
        i9CheckTrackerPath: join(workspace, "data", "reports", "i9-check-tracker.xlsx") };
      if (configSnapshots.some(snapshot => {
        const { duoExtensionDir: _extension, ...paths } = snapshot.config.paths;
        return canonicalJsonStringify(paths) !== canonicalJsonStringify(expectedPaths);
      }) || settings !== undefined && Object.keys((settings.saved?.settings ?? settings.initialization.settings.settings).paths ?? {}).length !== 0) throw new Error("existing-data-flat-custom-paths-unsupported");
      if (settings !== undefined && (settings.active === null || !configSnapshots.some(snapshot => snapshot.configSnapshotId === settings.active?.configSnapshotId
        && snapshot.fingerprint === settings.active.configFingerprint))) throw new Error("existing-data-flat-settings-unavailable");
      assertHeld();
      return { settings: settings === undefined ? initialSettingsFileRecord().settings : settings.saved?.settings ?? settings.initialization.settings.settings };
    });
  }

  static openStoppedStartupRecovery(admission: RuntimeAdmission, clock: Clock): AuthorityDatabase {
    admission.assertStoppedStartupRecoveryDatabase(join(admission.stateRoot, "state.db"));
    return new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250,
      migrationOwner: "startup-crash-recovery" }, clock, undefined, undefined, undefined, undefined, "stopped-startup-recovery");
  }

  static openFixedLayoutSource(machine: RuntimeAdmission, admission: RuntimeAdmission, clock: Clock): AuthorityDatabase {
    admission.assertReadyStoppedProfileLayoutOwner(machine);
    return new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250,
      migrationOwner: "fixed-layout-source", openMode: "storage-doctor-read-only-no-migrate" }, clock,
      undefined, undefined, undefined, undefined, "stopped-layout-source");
  }

  static publishFixedLayoutActivation(admission: RuntimeAdmission): Readonly<{ state: "activated" | "already-activated"; configSnapshotId: string }> {
    const intent = admission.fixedLayoutActivation(), path = join(admission.stateRoot, "state.db");
    const clock = capturedInstantClock(intent.snapshot.capturedAt);
    admission.assertFixedLayoutDatabase(path);
    const database = new AuthorityDatabase(admission, { path, busyTimeoutMs: 250, migrationOwner: "fixed-layout-target" }, clock,
      undefined, undefined, undefined, undefined, "stopped-layout-target");
    let primary: { error: unknown } | undefined;
    let result: Readonly<{ state: "activated" | "already-activated"; configSnapshotId: string }> | undefined;
    try {
      const backupPath = join(admission.stateRoot, "backups", "authority", intent.backupFileName);
      const prior = database.classifyFixedLayoutActivation(intent, backupPath);
      if (prior === "prestate") {
        database.withAuthorityTransaction(repositories => {
          admission.assertFixedLayoutDatabase(path);
          {
            const app = fixedLayoutAppSettings(database.#database);
            if (app === null) {
              if (intent.settingsInitialization === undefined || intent.priorActive !== null) throw new Error("fixed-layout-settings-missing");
              repositories.runtimeConfig.initialize(intent.snapshot, intent.settingsInitialization);
            } else {
            const update = intent.settingsUpdate === undefined ? undefined : fixedLayoutSettingsUpdate(intent, app.saved?.settings ?? app.initialization.settings.settings);
            if (update !== undefined) repositories.commands.insert(update.request);
            repositories.configSnapshots.insert(intent.snapshot);
            repositories.runtimeConfig.activate({ settingsRevision: intent.snapshot.revision, settingsFingerprint: update?.current.settingsFingerprint ?? intent.settingsFingerprint,
              configSnapshotId: intent.snapshot.configSnapshotId, configFingerprint: intent.snapshot.fingerprint, activatedAt: intent.snapshot.capturedAt });
            if (update !== undefined) {
              repositories.commandAudits.insert(update.audit);
              repositories.settingsCurrent.advance(update.current);
            }
            }
          }
        });
      }
      if (database.classifyFixedLayoutActivation(intent, backupPath) !== "committed") throw new Error("fixed-layout-activation-unproved");
      result = { state: prior === "prestate" ? "activated" : "already-activated", configSnapshotId: intent.snapshot.configSnapshotId };
    } catch (error) { primary = { error }; }
    try { database.close(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { database, admission }); }
    if (primary !== undefined) throw primary.error;
    if (result === undefined) throw new Error("fixed-layout-activation-result-missing");
    return result;
  }

  static openStoppedRestoreProjection(admission: RuntimeAdmission, input: unknown, clock: Clock = systemClock): AuthorityDatabase {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    admission.assertStoppedRestoreProjection(options.path);
    if (options.openMode !== "read-write") throw new Error("profile-restore-projection-mode-refused");
    const inspection = withDirectReaderAdmission(admission, () => inspectExistingDatabaseReadOnly(options.path, options.busyTimeoutMs));
    if (inspection.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-restore-projection-schema-refused");
    admission.assertStoppedRestoreProjection(options.path);
    return new AuthorityDatabase(admission, options, clock, undefined, undefined, undefined, undefined, "stopped-restore-projection");
  }

  static openStoppedSpanRootRepair(admission: RuntimeAdmission, input: unknown, operation: OfflineMaintenanceOperation, clock: Clock = systemClock): AuthorityDatabase {
    admission.assertStoppedProfile(operation);
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    if (options.path !== join(admission.stateRoot, "state.db") || options.openMode !== "read-write") throw new Error("profile-span-root-repair-path-refused");
    return new AuthorityDatabase(admission, options, clock, undefined, undefined, undefined, undefined, "stopped-span-root-repair");
  }

  static initializeProfile(admission: RuntimeAdmission, clock: Clock = systemClock): void {
    admission.assertProfileInitialization();
    const path = join(admission.stateRoot, "state.db");
    if (existsSync(path)) throw new Error("profile-database-initialization-already-exists");
    const database = new AuthorityDatabase(admission, { path, busyTimeoutMs: 250, migrationOwner: "profile-initialization" }, clock, undefined, undefined, undefined, undefined, "profile-initialization");
    database.close();
  }

  static withProfileOnboardingTimeline(admission: RuntimeAdmission, clock: Clock, write: (repository: TimelineRepository) => void): void {
    admission.assertProfileInitialization();
    const database = new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "profile-onboarding-debug" }, clock,
      undefined, undefined, undefined, undefined, "profile-onboarding-debug");
    try { write(database.authority.timelineEvents); }
    finally { database.close(); }
  }

  static sourceDatabaseIdentity(source: AuthorityBackupExpectedSource): string {
    return authoritySourceDatabaseIdentity(source);
  }

  static inspectExistingReadOnly(admission: RuntimeAdmission, path: string, busyTimeoutMs = 250, workbookPayloads = true): AuthorityCopyInspection {
    return withOperationProof(() => {
      requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
      return withDirectReaderAdmission(admission, () => inspectExistingDatabaseReadOnly(path, busyTimeoutMs, workbookPayloads));
    });
  }

  static #registeredPersonPath(machine: RuntimeAdmission, profileId: string): string {
    machine.assertExclusive(); machine.assertOfflineMaintenance(machine.maintenanceOperation());
    const id = z.uuid().parse(profileId);
    if (!machine.readStartupProfileIds().includes(id)) throw new Error("profile-startup-registration-required");
    const path = join(machine.stateRoot, "profiles", id, "state.db");
    machine.assertStateRoot(path);
    return path;
  }

  static #withRegisteredPersonSnapshot<T>(machine: RuntimeAdmission, path: string, work: (database: DatabaseSync, version: number) => T): T {
    try {
      return withReadonlyAuthoritySnapshot(path, database => {
        const version = readIntPragma(database, "user_version");
        if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("profile-startup-foreign-application");
        if (version > CURRENT_AUTHORITY_SCHEMA_VERSION) throw new AuthorityFormatUnsupportedError("STORAGE_PROFILE_NEWER_VERSION", { cause: new AuthoritySchemaVersionError(version) });
        if (!OPENABLE_AUTHORITY_SCHEMA_VERSIONS.includes(version)) {
          throw new AuthorityFormatUnsupportedError("STORAGE_PROFILE_FORMAT_UNSUPPORTED", { cause: new AuthoritySchemaVersionError(version) });
        }
        return work(database, version);
      });
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) { machine.retainSourceClosure(error); throw retainAuthoritySourceClosure([error], { admission: machine }); }
      throw error;
    }
  }

  /**
   * Classifies a person database that failed startup inspection. Only SQLite's own damage verdict admits a restore;
   * a missing run-search projection is rebuilt in place; strict-parse or layout failures over intact SQLite are version skew.
   */
  static classifyStartupFailure(machine: RuntimeAdmission, profileId: string): StartupFailureClassification {
    const path = AuthorityDatabase.#registeredPersonPath(machine, profileId);
    if (!existsSync(path)) throw new Error("profile-startup-database-missing");
    try {
      return AuthorityDatabase.#withRegisteredPersonSnapshot(machine, path, (database, version): StartupFailureClassification => {
        const integrity = z.array(z.strictObject({ integrity_check: z.string() })).parse(database.prepare("PRAGMA integrity_check").all());
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") return { kind: "damaged" };
        const meta = readMetaRow(database);
        if (meta.installation_id !== machine.locator.installationId || meta.profile_id !== profileId) throw new Error("profile-startup-foreign-binding");
        const missingRunSearch = normalizedNativeSchema(database) === expectedNativeSchema(version, true);
        try { inspectNativeAuthority(database, version, false, missingRunSearch); }
        catch (error) {
          if (hasUnprovedSourceClosure(error)) throw error;
          return { kind: "version-skew", error: new AuthorityFormatUnsupportedError("STORAGE_PROFILE_FORMAT_UNSUPPORTED", { cause: error }) };
        }
        return missingRunSearch ? { kind: "missing-run-search-projection" } : { kind: "intact" };
      });
    } catch (error) {
      if (isSqliteDamage(error)) return { kind: "damaged" };
      throw error;
    }
  }

  /** Recreates the exact current run_search table and rebuilds it in one stopped transaction; nothing else may change. */
  static repairMissingRunSearchProjection(admission: RuntimeAdmission, operation: OfflineMaintenanceOperation, clock: Clock): void {
    admission.assertStoppedProfile(operation);
    const path = join(admission.stateRoot, "state.db");
    requireDatabaseSourcePath(path);
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false,
      timeout: 250, readBigInts: false, returnArrays: false, allowBareNamedParameters: false, allowUnknownNamedParameters: false, defensive: true });
    let open = false;
    try {
      database.exec("PRAGMA synchronous=FULL; BEGIN IMMEDIATE"); open = true;
      const version = readIntPragma(database, "user_version");
      if (version !== CURRENT_AUTHORITY_SCHEMA_VERSION || normalizedNativeSchema(database) !== expectedNativeSchema(version, true)) throw new Error("run-search-projection-repair-shape-changed");
      const before = nonProjectionFingerprint(database);
      for (const statement of runSearchDefinitions()) database.exec(statement);
      database.exec("UPDATE database_states SET search_generation=NULL,search_state='invalid' WHERE id=1");
      const index = createRunSearchIndex(database), generation = readMetaRow(database).authority_generation, now = clock.now().toISOString();
      let published = index.rebuild({ restart: true, limit: 500 }, generation, now);
      while (published.state === "building") published = index.rebuild({ limit: 500 }, generation, now);
      if (normalizedNativeSchema(database) !== expectedNativeSchema(version, false) || nonProjectionFingerprint(database) !== before
        || readMetaRow(database).authority_generation !== generation) throw new Error("run-search-projection-repair-mutated-authority");
      database.exec("COMMIT"); open = false;
    } catch (error) {
      if (open) database.exec("ROLLBACK");
      throw error;
    } finally { database.close(); }
  }

  static inspectRegisteredPersonAtStartup(machine: RuntimeAdmission, profileId: string) {
    const id = z.uuid().parse(profileId);
    const path = AuthorityDatabase.#registeredPersonPath(machine, id);
    if (!existsSync(path)) throw new Error("profile-startup-database-missing");
    {
      return AuthorityDatabase.#withRegisteredPersonSnapshot(machine, path, (database, version) => {
        const inspection = inspectNativeAuthority(database, version);
        machine.assertOfflineMaintenance(machine.maintenanceOperation());
        if (inspection.installationId !== machine.locator.installationId || inspection.profileId !== id) throw new Error("profile-startup-foreign-binding");
        const record = readAuthorityUpgradeRecords(database).at(-1);
        const continuation = record !== undefined && "startupLogout" in record ? record.startupLogout : undefined;
        const file = continuation === undefined ? undefined : readPrivateFile(join(machine.stateRoot, "machine", "operations", `${continuation.operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
        const nativeContinuation = file !== undefined && canonicalJsonStringify(LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)))) === canonicalJsonStringify(continuation?.operation);
        const context = machine.readInstallationContext();
        if (context === undefined) throw new Error("profile-startup-installation-required");
        const layout = readFixedLayoutIntent(context.workspace);
        const layoutLogout = layout?.phase === "complete" ? layout.profiles.find(plan => plan.profileId === id)?.logout : undefined;
        const layoutFile = layoutLogout?.settlement === undefined ? undefined : readPrivateFile(join(machine.stateRoot, "machine", "operations", `${layoutLogout.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
        const layoutContinuation = layoutFile !== undefined && canonicalJsonStringify(LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(layoutFile.bytes)))) === canonicalJsonStringify(layoutLogout);
        return { ...inspection, requiresContinuation: nativeContinuation || layoutContinuation };
      });
    }
  }

  static async prepareStartupLogoutConversion(admission: RuntimeAdmission, operation: LogoutOperation): Promise<StartupLogoutConversion | undefined> {
    const { verifyStoppedBackupManifestAtPath } = await import("./backup-service.js");
    const next = AuthorityDatabase.convertStartupUpgradeLogout(admission, operation, verifyStoppedBackupManifestAtPath);
    if (next === undefined) return undefined;
    const conversion: StartupLogoutConversion = Object.freeze({ [startupLogoutConversionBrand]: true });
    startupLogoutConversions.set(conversion, { admission, operation, next, verifyBackup: verifyStoppedBackupManifestAtPath });
    return conversion;
  }

  static consumeStartupLogoutConversion(conversion: StartupLogoutConversion, lease: InstallationLease) {
    const source = startupLogoutConversions.get(conversion);
    if (source === undefined) throw new Error("profile-startup-logout-conversion-unissued");
    source.admission.assertStartupUpgradeLease(lease);
    if (canonicalJsonStringify(AuthorityDatabase.convertStartupUpgradeLogout(source.admission, source.operation, source.verifyBackup)) !== canonicalJsonStringify(source.next)) throw new Error("profile-startup-logout-source-changed");
    startupLogoutConversions.delete(conversion);
    return { expected: source.operation, next: source.next };
  }

  static convertStartupUpgradeLogout(admission: RuntimeAdmission, operation: LogoutOperation, verifyBackup: (admission: RuntimeAdmission, path: string) => VerifiedBackup): LogoutOperation | undefined {
    if (canonicalJsonStringify(admission.stoppedUpgradeLogout()) !== canonicalJsonStringify(operation)) throw new Error("profile-startup-upgrade-required");
    const context = admission.readInstallationContext();
    if (context === undefined) throw new Error("profile-startup-installation-required");
    const layout = readFixedLayoutIntent(context.workspace), plan = layout?.phase === "complete" ? layout.profiles.find(plan => plan.profileId === operation.profileId) : undefined;
    if (plan?.logout?.settlement !== undefined && canonicalJsonStringify(plan.logout) === canonicalJsonStringify(operation)) {
      const backupPath = join(admission.stateRoot, "backups", "authority", plan.backupFileName), manifestPath = `${backupPath}.manifest.json`;
      const backup = verifyBackup(admission, manifestPath);
      if (backup.manifest.sha256 !== plan.backupSha256 || backup.manifest.authorityContentFingerprint !== plan.preAuthorityContentFingerprint) throw new Error("profile-startup-layout-backup-changed");
      const database = new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250,
        migrationOwner: "startup-layout-continuation", openMode: "storage-doctor-read-only-no-migrate" }, systemClock,
        undefined, undefined, undefined, undefined, "stopped-layout-source");
      let result: LogoutOperation | undefined, primary: { error: unknown } | undefined;
      try {
        if (database.classifyFixedLayoutActivation(plan, backupPath, true) !== "committed") throw new Error("profile-startup-layout-uncommitted");
        result = convertedLogoutOperation(operation, plan.preAuthorityContentFingerprint, inspectNativeAuthority(database.#database).authorityContentFingerprint);
      } catch (error) { primary = { error }; }
      try { database.close(); }
      catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { database, admission }); }
      if (primary !== undefined) throw primary.error;
      if (result === undefined) throw new Error("profile-startup-layout-result-missing");
      return result;
    }
    return withAuthorityDatabaseReadOnly(admission, join(admission.stateRoot, "state.db"), database => {
      const inspection = inspectNativeAuthority(database), record = readAuthorityUpgradeRecords(database).at(-1);
      if (record === undefined || !("startupLogout" in record) || record.startupLogout === undefined
        || canonicalJsonStringify(record.startupLogout.operation) !== canonicalJsonStringify(operation)) return undefined;
      const settlement = operation.settlement;
      if (record.phase !== "settled" || record.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || !UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS.includes(record.fromSchemaVersion)
        || settlement === undefined || record.startupLogout.postimage !== authorityContentFingerprint(database, record.recordKey)) throw new Error("profile-startup-logout-postimage-changed");
      const backup = verifyBackup(admission, record.backup.manifestPath);
      if (backup.manifest.sha256 !== record.backup.sha256 || backup.manifest.authorityContentFingerprint !== record.upgradeId
        || record.planDigest !== deriveAuthorityUpgradePlanDigest(record.fromSchemaVersion, record.upgradeId)) throw new Error("profile-startup-logout-backup-changed");
      return convertedLogoutOperation(operation, record.upgradeId, inspection.authorityContentFingerprint);
    });
  }

  static inspectEvidenceSchemaUpgrade(admission: RuntimeAdmission, descriptors: readonly AnyWorkflowDescriptor[]) {
    admission.assertStoppedProtectedSettingsUpgrade();
    return withAuthorityDatabaseReadOnly(admission, join(admission.stateRoot, "state.db"), database => {
      const inspection = inspectNativeAuthority(database);
      const admissions = collectEvidenceSchemaAdmissions({ descriptors,
        runs: database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow),
        writes: database.prepare("SELECT * FROM write_intents ORDER BY id").all().map(row => WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", row))),
        results: database.prepare("SELECT * FROM run_results ORDER BY run_id").all().map(row => RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results", row))),
        gates: database.prepare("SELECT * FROM gate_results ORDER BY run_id,node_id").all().map(row => GateResultRecordSchema.parse(nativeOrdinaryRecordFromRow("gate_results", row))),
        delegations: database.prepare("SELECT * FROM run_delegations ORDER BY id").all().map(row => DelegationManifestSchema.parse(nativeOrdinaryRecordFromRow("run_delegations", row))),
        checkpoints: database.prepare("SELECT * FROM run_checkpoints ORDER BY run_id,node_id").all().map(row => RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints", row))) });
      const records = readAuthorityUpgradeRecords(database).filter(record => "evidenceSchemas" in record && record.evidenceSchemas !== undefined);
      if (records.length > 1) throw new Error("evidence-schema-conversion-duplicate");
      const record = records[0];
      if (record !== undefined && "evidenceSchemas" in record) {
        admission.assertEvidenceSchemaConversion(record);
        const conversion = record.evidenceSchemas;
        if (conversion === undefined || record.phase !== "settled" || record.fromSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
          || record.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || conversion.installationId !== inspection.installationId
          || conversion.profileId !== inspection.profileId || record.planDigest !== sha256Hex(`relay:evidence-schema-conversion:v1\0${record.upgradeId}\0${canonicalJsonStringify(conversion)}`)
          || admissions.some(admission => !conversion.admissions.some(existing => canonicalJsonStringify(existing) === canonicalJsonStringify(admission))))
          throw new Error("evidence-schema-conversion-source-changed");
      }
      return { inspection, admissions, record };
    });
  }

  static convertEvidenceSchemas(admission: RuntimeAdmission, descriptors: readonly AnyWorkflowDescriptor[], processLockRoot: string,
    clock: Clock, expectedFingerprint: string, backup: VerifiedBackup, verifyBackup: (admission: RuntimeAdmission, path: string) => VerifiedBackup): void {
    admission.assertStoppedProtectedSettingsUpgrade();
    const path = join(admission.stateRoot, "state.db");
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
    const plan = AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors);
    if (plan.record !== undefined || plan.admissions.length === 0 || plan.inspection.authorityContentFingerprint !== expectedFingerprint)
      throw new Error("evidence-schema-conversion-source-changed");
    const verified = verifyBackup(admission, backup.manifestPath), binding = admission.profileBinding;
    if (canonicalJsonStringify(verified) !== canonicalJsonStringify(backup) || verified.manifest.installationId !== binding.installationId
      || verified.manifest.profileId !== binding.profileId || verified.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
      || verified.manifest.authorityContentFingerprint !== expectedFingerprint || verified.manifest.authorityGeneration !== plan.inspection.authorityGeneration)
      throw new Error("evidence-schema-conversion-backup-changed");
    const conversion = { id: "profile-name-domain", ...binding, admissions: plan.admissions };
    const statement = AuthorityEvidenceSchemaUpgradeRecordSchema.omit({ evidenceSchemaMac: true }).parse({ recordKey: randomUUID(), upgradeId: expectedFingerprint, phase: "settled",
      fromSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      planDigest: sha256Hex(`relay:evidence-schema-conversion:v1\0${expectedFingerprint}\0${canonicalJsonStringify(conversion)}`),
      evidenceSchemas: conversion, backup: { manifestPath: backup.manifestPath, sha256: backup.manifest.sha256, authorityGeneration: plan.inspection.authorityGeneration },
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() });
    const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse({ ...statement, evidenceSchemaMac: admission.sealStoppedEvidenceSchemaConversion(statement) });
    const database = new DatabaseSync(existingDatabaseLocation(path), { enableForeignKeyConstraints: true, timeout: 250 });
    let primary: { error: unknown } | undefined;
    try {
      database.exec("BEGIN EXCLUSIVE");
      try {
        admission.assertStoppedProtectedSettingsUpgrade();
        if (inspectNativeAuthority(database).authorityContentFingerprint !== expectedFingerprint) throw new Error("evidence-schema-conversion-source-changed");
        database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
          .run(record.recordKey, record.upgradeId, record.phase, backup.manifest.sha256, canonicalJsonStringify(record), record.recordedAt);
        inspectNativeAuthority(database); admission.assertStoppedProtectedSettingsUpgrade();
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); }
        catch (rollback) { throw retainAuthoritySourceClosure([error, rollback], { database, admission }); }
        throw error;
      }
    } catch (error) { primary = { error }; }
    try { database.close(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { database, admission }); }
    if (primary !== undefined) throw primary.error;
  }

  evidenceSchemaHash(owner: EvidenceSchemaOwner, source: unknown, sourceSchemaHash: string, currentSchemaHash: string): string {
    this.#assertOpen();
    if (sourceSchemaHash === currentSchemaHash) return sourceSchemaHash;
    return this.#withReadSnapshot(() => {
      const records = readAuthorityUpgradeRecords(this.#database).filter(record => "evidenceSchemas" in record && record.evidenceSchemas !== undefined);
      if (records.length > 1) throw new Error("evidence-schema-conversion-duplicate");
      const record = records[0], conversion = record !== undefined && "evidenceSchemas" in record ? record.evidenceSchemas : undefined;
      if (conversion === undefined) return sourceSchemaHash;
      this.#admission.assertEvidenceSchemaConversion(record);
      if (record === undefined || !("planDigest" in record) || record.phase !== "settled"
        || record.fromSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || record.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
        || record.planDigest !== sha256Hex(`relay:evidence-schema-conversion:v1\0${record.upgradeId}\0${canonicalJsonStringify(conversion)}`)) throw new Error("evidence-schema-conversion-unproved");
      if (conversion.installationId !== this.#admission.profileBinding.installationId || conversion.profileId !== this.#admission.profileBinding.profileId)
        throw new Error("evidence-schema-conversion-foreign");
      const certificate = conversion.admissions.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
      if (certificate === undefined) return sourceSchemaHash;
      if (certificate.sourceSchemaHash !== sourceSchemaHash || certificate.currentSchemaHash !== currentSchemaHash
        || certificate.sourceDigest !== evidenceSchemaSourceDigest(owner, source)) throw new Error("evidence-schema-admission-source-changed");
      return certificate.currentSchemaHash;
    });
  }

  static inspectStoppedUpgrade(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock) {
    return withOperationProof(() => {
      requireStoppedUpgradeSource(admission, path, processLockRoot, clock, true);
      const snapshot = createReadonlyAuthoritySnapshot(path);
      let database: DatabaseSync | undefined;
      let result: ReturnType<typeof inspectNativeAuthority> | undefined;
      let primary: { error: unknown } | undefined;
      try {
        database = new DatabaseSync(snapshot.path, { enableForeignKeyConstraints: true });
        result = inspectNativeAuthority(database, readIntPragma(database, "user_version"));
      } catch (error) { primary = { error }; }
      const failures: unknown[] = [];
      try { database?.close(); }
      catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { snapshot, ...(database === undefined ? {} : { database }) }); }
      try { snapshot.assertUnchanged(); } catch (error) { failures.push(error); }
      try { snapshot.dispose(); }
      catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [...failures, error] : [primary.error, ...failures, error], { snapshot }); }
      if (failures.length !== 0) {
        if (primary !== undefined) throw new AggregateError([primary.error, ...failures], "authority-source-validation-failed", { cause: primary.error });
        throw failures[0];
      }
      if (primary !== undefined) throw primary.error;
      if (result === undefined) throw new Error("profile-stopped-upgrade-inspection-unavailable");
      return result;
    });
  }

  static upgradeStopped(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock, expectedFingerprint?: string, backup?: VerifiedBackup, verifyBackup?: (admission: RuntimeAdmission, manifestPath: string) => VerifiedBackup) {
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
    const before = AuthorityDatabase.inspectStoppedUpgrade(admission, path, processLockRoot, clock);
    if (before.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) return before;
    const database = new DatabaseSync(existingDatabaseLocation(path), { enableForeignKeyConstraints: true, timeout: 250 });
    let result: ReturnType<typeof migrateStoppedAuthority> | undefined;
    let primary: { error: unknown } | undefined;
    try { result = migrateStoppedAuthority(database, clock, admission, path, expectedFingerprint, backup, verifyBackup); }
    catch (error) { primary = { error }; }
    const failures: unknown[] = [];
    try { database.close(); } catch (error) { failures.push(error); }
    if (failures.length !== 0) throw retainAuthoritySourceClosure(primary === undefined ? failures : [primary.error, ...failures], { database });
    if (primary !== undefined) throw primary.error;
    if (result === undefined) throw new Error("profile-stopped-upgrade-result-unavailable");
    return result;
  }


  readUpgradePhases() {
    return this.withAuthorityReadSnapshot(() => {
      const phases = readAuthorityUpgradeRecords(this.#database).map(record => {
        return { phase: record.phase, fromSchemaVersion: record.fromSchemaVersion,
          toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt };
      });
      return phases.length === 0
        ? { state: "absent" as const, reason: "journal-empty" as const }
        : { state: "available" as const, phases };
    });
  }

  static inspectAuthorityReadIdentityReadOnly(
    admission: RuntimeAdmission,
    path: string,
    busyTimeoutMs = 250,
  ): AuthorityReadIdentitySnapshot {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    return withDirectReaderAdmission(admission, () => inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs));
  }

  static inspectSpanRunAuthorityReadOnly(
    admission: RuntimeAdmission,
    path: string,
    roots: readonly SpanAuthorityRunRoot[],
    busyTimeoutMs = 250,
  ): SpanAuthorityReadSnapshot {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    return withDirectReaderAdmission(admission, () => inspectSpanRunAuthorityReadOnly(path, roots, busyTimeoutMs));
  }

  static inspectTimelinePageReadOnly(admission: RuntimeAdmission, path: string, input: unknown) {
    const request = TimelinePageRequestSchema.parse(input);
    return withAuthorityDatabaseReadOnly(admission, path, database => {
      if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID
        || !isCurrentAuthoritySchemaVersion(readIntPragma(database, "user_version"))) throw new Error("timeline-diagnostic-authority-unsupported");
      const check = database.prepare("PRAGMA quick_check").all();
      if (check.length !== 1 || z.object({ quick_check: z.string() }).parse(check[0]).quick_check !== "ok") throw new Error("timeline-diagnostic-authority-corrupt");
      const names = inspectionTableNames(database);
      const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
      if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) throw new Error("timeline-diagnostic-authority-registry-mismatch");
      if (request.runId !== undefined && readTimelineRun(database, request.runId) === undefined) throw new Error("timeline-event-owner-missing");
      const repository = createTimelineRepository({ database, read: work => work(),
        mutate: () => { throw new Error("timeline-diagnostic-read-only"); }, assertOwner: record => assertTimelineOwner(database, record) });
      const highWaterMark = repository.highWaterMark();
      const through = Math.min(request.through ?? highWaterMark, highWaterMark);
      if (request.after > through) throw new Error("timeline-diagnostic-cursor-out-of-range");
      const scanned = repository.page({ ...request, through });
      for (const record of scanned) assertTimelineOwner(database, record);
      const failureCauses = request.runId === undefined ? [] : database.prepare("SELECT * FROM run_failures WHERE run_id = ? ORDER BY created_at, id").all(request.runId)
        .map(raw => { const failure = FailureRecordSchema.parse(nativeOrdinaryRecordFromRow("run_failures", raw)); return { failureId: failure.failureId, ...failureCauseNames(failure) }; });
      return { records: scanned.filter(record => record.payload.kind === "debug"), failureCauses,
        after: request.after, nextCursor: scanned.at(-1)?.cursor ?? through, through, highWaterMark,
        hasMore: (scanned.at(-1)?.cursor ?? through) < through };
    });
  }

  /** Event evidence and its complete authority identity from one read-only snapshot. */
  static inspectTimelineReadOnly(admission: RuntimeAdmission, path: string, busyTimeoutMs = 250, includeRecoveryEvidence = false) {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    let timeline: ReturnType<typeof readTimelineRecords> | undefined;
    let recoveryEvidence: Readonly<{
      runs: readonly Readonly<{ runId: RunRecord["envelope"]["runId"]; workflow: string; traceId: string; version: number;
        possibleExternalWrite: boolean; attemptIds: readonly string[]; confirmations: readonly string[] }>[];
      deleted: readonly DeletedRunRecord[];
    }> | undefined;
    const identity = withDirectReaderAdmission(admission, () => inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs, (database) => {
      const metrics = z.object({ records: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
        largest: z.number().int().nonnegative(), runs: z.number().int().nonnegative() }).parse(database.prepare(`
        SELECT count(*) AS records, COALESCE(sum(length(CAST(payload_json AS BLOB))),0) AS bytes,
          COALESCE(max(length(CAST(payload_json AS BLOB))),0) AS largest, count(DISTINCT run_id) AS runs
        FROM timeline_events
      `).get());
      if (metrics.records > 100_000) throw new TimelineRecordError("timeline-doctor-record-limit-exceeded: 100000 records");
      if (metrics.bytes > 16 * 1024 * 1024) throw new TimelineRecordError("timeline-doctor-payload-limit-exceeded: 16777216 bytes");
      if (metrics.largest > 256 * 1024) throw new TimelineRecordError("timeline-doctor-event-limit-exceeded: 262144 bytes");
      if (metrics.runs > 10_000) throw new TimelineRecordError("timeline-doctor-run-limit-exceeded: 10000 run IDs");
      const repository = createTimelineRepository({ database, read: (work) => work(),
        mutate: () => { throw new Error("timeline-doctor-read-only"); }, assertOwner: () => {} });
      timeline = readTimelineRecords(repository);
      if (!includeRecoveryEvidence) return;
      const attempts = database.prepare("SELECT * FROM write_attempts").all().map((row) =>
        WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts", row)));
      const attemptsByRun = new Map<string, WriteAttemptRecord[]>();
      for (const attempt of attempts) {
        const owned = attemptsByRun.get(attempt.runId);
        if (owned === undefined) attemptsByRun.set(attempt.runId, [attempt]);
        else owned.push(attempt);
      }
      // Confirmations survive ordinary retention. Compare their immutable content,
      // independently of mutable run versions and database-local delivery cursors.
      const confirmationsByRun = new Map<string, string[]>();
      for (const record of timeline.records) {
        if (record.payload.kind !== "operation-confirmed" || record.scope.kind !== "run") continue;
        const digest = createHash("sha256").update(timelineAppendContent(record)).digest("hex");
        const owned = confirmationsByRun.get(record.scope.runId);
        if (owned === undefined) confirmationsByRun.set(record.scope.runId, [digest]);
        else owned.push(digest);
      }
      const fenced = new Set(timeline.records.flatMap((row) => row.payload.kind === "span"
        && row.payload.event.t === "transaction.fenced" ? [row.payload.event.runId] : []));
      const runs = database.prepare("SELECT * FROM runs ORDER BY id").all().map((raw) => {
        const run = runRecordFromRow(raw);
        const owned = attemptsByRun.get(run.envelope.runId) ?? [];
        return { runId: run.envelope.runId, workflow: run.envelope.workflow, traceId: run.envelope.traceId,
          version: run.version, possibleExternalWrite: owned.length > 0 || fenced.has(run.envelope.runId),
          attemptIds: owned.map((attempt) => attempt.writeAttemptId),
          confirmations: confirmationsByRun.get(run.envelope.runId) ?? [] };
      });
      const deleted = database.prepare("SELECT * FROM deleted_runs").all().map((row) => deletedRunFromRow(row).receipt);
      recoveryEvidence = { runs, deleted };
    }));
    if (timeline === undefined || (includeRecoveryEvidence && recoveryEvidence === undefined)) throw new Error("timeline-read-snapshot-missing");
    return { ...identity, ...timeline, recoveryEvidence };
  }

  /** Recovery evidence of a preserved suspect at any openable schema, from columns every such schema has. */
  static inspectPreservedRecoveryEvidenceReadOnly(admission: RuntimeAdmission, path: string, busyTimeoutMs = 250) {
    return withAuthorityDatabaseReadOnly(admission, path, (database) => {
      if (readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID) throw new TimelineRecordError("preserved authority is not the HR authority store");
      const version = readIntPragma(database, "user_version");
      if (!OPENABLE_AUTHORITY_SCHEMA_VERSIONS.includes(version)) throw new TimelineRecordError(`preserved authority schema ${String(version)} is not openable`);
      const names = inspectionTableNames(database), expected = [...migrationTableNames(version)].sort();
      if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
        throw new TimelineRecordError(`preserved authority tables do not match schema ${String(version)}`);
      }
      const byRun = (rows: readonly Readonly<{ runId: string; value: string }>[]) => {
        const owned = new Map<string, string[]>();
        for (const { runId, value } of rows) owned.set(runId, [...owned.get(runId) ?? [], value]);
        return owned;
      };
      const attempts = byRun(database.prepare("SELECT id, run_id FROM write_attempts ORDER BY id").all().map((raw) => {
        const row = z.object({ id: z.string(), run_id: z.string() }).parse(raw);
        return { runId: row.run_id, value: row.id };
      }));
      // Same digest as the current side: parsed record content without its database-local cursor.
      const confirmations = byRun(database.prepare("SELECT payload_json FROM timeline_events WHERE kind='operation-confirmed' ORDER BY cursor").all().flatMap((raw) => {
        let parsed: ReturnType<typeof TimelineEventRecordSchema.safeParse>;
        try { parsed = TimelineEventRecordSchema.safeParse(JSON.parse(z.object({ payload_json: z.string() }).parse(raw).payload_json)); }
        catch { throw new TimelineRecordError(`preserved confirmation unreadable at schema ${String(version)}`); }
        if (!parsed.success) throw new TimelineRecordError(`preserved confirmation unreadable at schema ${String(version)}`);
        const record = parsed.data;
        return record.scope.kind === "run"
          ? [{ runId: record.scope.runId, value: createHash("sha256").update(timelineAppendContent(record)).digest("hex") }] : [];
      }));
      const fenced = new Set(database.prepare("SELECT json_extract(payload_json,'$.payload.event.runId') AS run_id FROM timeline_events WHERE kind='transaction.fenced'")
        .all().map((raw) => z.object({ run_id: z.string() }).parse(raw).run_id));
      const runs = database.prepare("SELECT id, workflow, trace_id, version FROM runs ORDER BY id").all().map((raw) => {
        const row = z.object({ id: RunIdSchema, workflow: z.string(), trace_id: z.string(), version: z.number().int() }).parse(raw);
        const attemptIds = attempts.get(row.id) ?? [];
        return { runId: row.id, workflow: row.workflow, traceId: row.trace_id, version: row.version,
          possibleExternalWrite: attemptIds.length > 0 || fenced.has(row.id), attemptIds, confirmations: confirmations.get(row.id) ?? [] };
      });
      return { runs };
    }, busyTimeoutMs);
  }

  getSourceDatabaseIdentity(): string {
    this.#assertOpen();
    return AuthorityDatabase.sourceDatabaseIdentity(this.#admission.authorityBackupExpectedSource());
  }

  /** This connection's committed state for its own doctor pass, bound to the file identity it opened; no other connection's commit can fail or change it. */
  serializeCommittedImage(): { readonly identity: DirectoryIdentity; readonly image: Uint8Array } | undefined {
    this.#assertOpen();
    // Inside a transaction serialize() would include uncommitted writes.
    if (this.#database.isTransaction) throw new Error("authority-image-inside-transaction");
    if (this.#openedFileIdentity === undefined) return undefined;
    // Drop cached pages so the image is read from the files and shows damage written beneath this connection.
    this.#database.exec("PRAGMA shrink_memory");
    // shortcut: holds the whole image in memory once; move to a chunked owner backup if state.db reaches hundreds of MB.
    return Object.freeze({ identity: this.#openedFileIdentity, image: this.#database.serialize() });
  }

  async onlineBackupTo(destinationPath: string): Promise<number> {
    this.#assertOpen();
    assertMaintenanceCustodyAvailable("backup");
    const destination = z.string().min(1).parse(destinationPath);
    return sqliteBackup(this.#database, destination, { rate: 100 });
  }

  assertPendingLogoutCompletion(admission: RuntimeAdmission, operation: LogoutOperation): void {
    const state = this.#logoutCompletion;
    if (!this.#closed || state?.admission !== admission || canonicalJsonStringify(state.operation) !== canonicalJsonStringify(operation)) throw new Error("profile-logout-native-completion-required");
    const file = fileStatus(state.path);
    if (!file.isFile() || (file.nlink !== 1 && file.nlink !== 1n) || privatePathRejects(state.path, file, "owner")
      || !sameDirectory({ device: file.dev, inode: file.ino }, operation.source.database)) throw new Error("profile-logout-completion-source-changed");
    const observed = withReadonlyAuthoritySnapshot(state.path, native => inspectNativeAuthority(native, CURRENT_AUTHORITY_SCHEMA_VERSION));
    if (observed.installationId !== state.binding.installationId || observed.profileId !== state.binding.profileId
      || observed.authorityContentFingerprint !== operation.settlement?.after) throw new Error("profile-logout-completion-source-changed");
  }

  async #completePendingLogout(admission: RuntimeAdmission, profileBrowserClosure: ProfileBrowserClosure): Promise<void> {
    try {
      if (this.#logoutCompletion === undefined) {
        const path = join(admission.stateRoot, "state.db"), operation = admission.assertPendingLogoutSettlementDatabase(path);
        if (operation.settlement?.phase !== "done") throw new Error("profile-logout-settlement-incomplete");
        const { probeStoppedProfileBrowsersClosed, enumerateProfileCredentialMembership } = await import("../maintenance/profile-inventory.js");
        assertLogoutResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
        await probeStoppedProfileBrowsersClosed(admission, this.#clock, profileBrowserClosure);
        const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
        assertLogoutResourcesClosed(facts);
        const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
          : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
        const { resolveConfigWithProvenance } = await import("../../app/config/resolve.js");
        const config = resolveConfigWithProvenance(settings, { primaryDisplay: null }, this.#clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
        enumerateProfileCredentialMembership(admission, facts, config.paths.browserProfileRoot, profileBrowserClosure);
        this.#logoutCompletion = { admission, operation, path, binding: { ...admission.profileBinding } };
      }
      this.assertPendingLogoutCompletion(admission, this.#logoutCompletion.operation);
      admission.completePendingLogout(this);
    } catch (error) {
      const failure = hasUnprovedSourceClosure(error) ? error : retainAuthoritySourceClosure([error], { database: this, admission });
      admission.retainSourceClosure(failure); retainUnprovedSourceOwners(failure, { database: this, admission });
      throw failure;
    }
  }

  #logoutContext(admission: RuntimeAdmission, restore: OfflineMaintenanceOperation, profileBrowserClosure: ProfileBrowserClosure) {
    let disposed = false;
    return Object.freeze({ admission, restore, facts: AuthorityDatabase.readProfileMaintenanceInventory(admission),
      complete: async (): Promise<void> => {
        if (disposed) throw new Error("profile-logout-context-released");
        await this.#completePendingLogout(admission, profileBrowserClosure);
      },
      dispose: (): void => {
        if (disposed) return;
        try {
          admission.release(); this.#coldLogout?.owner.release(); restore.release(); disposed = true;
        } catch (error) {
          const failure = hasUnprovedSourceClosure(error) ? error : retainAuthoritySourceClosure([error], { database: this, admission, restore });
          admission.retainSourceClosure(failure); retainUnprovedSourceOwners(failure, { database: this, admission, restore }); throw failure;
        }
      },
    });
  }

  assertPendingLogoutPublication(admission: RuntimeAdmission, input: LogoutOperation): void {
    if (this.#logoutPublication?.admission !== admission || canonicalJsonStringify(this.#logoutPublication.operation) !== canonicalJsonStringify(input)) throw new Error("profile-logout-native-publication-required");
  }

  #publishPendingLogout(admission: RuntimeAdmission, operation: LogoutOperation): void {
    this.#logoutPublication = { admission, operation };
    try { admission.commitPendingLogoutSettlement(operation, this); }
    finally { this.#logoutPublication = undefined; }
  }

  static async resumePendingLogout(machine: RuntimeAdmission, input: LogoutOperation, services: PendingLogoutServices, clock: Clock = systemClock) {
    const operation = LogoutOperationSchema.parse(input), lifetime = machine.lifetime;
    machine.assertColdPendingLogout(operation);
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-logout-cold-controller-required");
    await lifetime.awaitOwnedChildrenClosed(); machine.assertColdPendingLogout(operation);
    const context = machine.readInstallationContext();
    if (context === undefined) throw new Error("profile-logout-cold-controller-required");
    const restore = lifetime.beginOfflineMaintenance(context.workspace);
    let owner: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, copy: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
    let snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot> | undefined;
    let inspection: ReturnType<RuntimeAdmission["capturePendingLogoutSnapshot"]> | undefined;
    try {
      machine.assertColdPendingLogout(operation);
      owner = machine.admitProfileSettlement(operation.operationId);
      admission = machine.forStoppedLogoutSettlement(owner, operation, restore);
      const path = join(admission.stateRoot, "state.db");
      inspection = admission.capturePendingLogoutSnapshot(); snapshot = inspection.snapshot; copy = inspection.admission;
      database = new AuthorityDatabase(copy, { path: snapshot.path, busyTimeoutMs: 250, migrationOwner: "profile-logout-inspection", openMode: "storage-doctor-read-only-no-migrate" }, clock,
        undefined, undefined, undefined, undefined, "stopped-logout-inspection");
      database.#coldLogout = { machine, operationId: operation.operationId, admission, restore, sourcePath: path, owner, inspection };
      const stopped = await database.settlePendingLogout(machine, operation, services);
      return stopped;
    } catch (error) {
      const failure = hasUnprovedSourceClosure(error) ? error : retainAuthoritySourceClosure([error], { admission: { machine, owner, admission, copy }, database, snapshot, restore });
      machine.retainSourceClosure(failure); retainUnprovedSourceOwners(failure, { admission: { machine, owner, admission, copy }, database, snapshot, restore });
      throw failure;
    }
  }

  async settlePendingLogout(machine: RuntimeAdmission, input: LogoutOperation, services: PendingLogoutServices) {
    const operation = LogoutOperationSchema.parse(input), lifetime = machine.lifetime, cold = this.#coldLogout;
    const profileBrowserClosure = services.browserClosure;
    const path = cold?.sourcePath ?? this.#path;
    if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("profile-logout-controller-required");
    await lifetime.awaitOwnedChildrenClosed();
    try {
      if (cold === undefined) this.#admission.assertPendingLogoutNativeClose(machine, operation);
      else if (cold.machine !== machine || cold.operationId !== operation.operationId) throw new Error("profile-logout-cold-owner-changed");
      else machine.assertColdPendingLogout(operation);
    }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) { this.#admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: this.#admission, database: this }); }
      throw error;
    }
    if (cold === undefined && (this.#openedFileIdentity === undefined || !sameDirectory(this.#openedFileIdentity, operation.source.database))) throw new Error("profile-logout-native-source-changed");
    let restore: OfflineMaintenanceOperation | undefined, admission: RuntimeAdmission | undefined, copyAdmission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
    let snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot> | undefined;
    let inspection: ReturnType<RuntimeAdmission["capturePendingLogoutSnapshot"]> | undefined;
    try {
      if (this.#closed || !this.#database.isOpen) throw new Error("profile-logout-native-source-unavailable");
      const observed = inspectNativeAuthority(this.#database, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const source = fileStatus(path);
      if (!sameDirectory({ device: source.dev, inode: source.ino }, operation.source.database)) throw new Error("profile-logout-native-source-changed");
      this.close();
      if (cold === undefined) {
        const context = machine.readInstallationContext();
        if (context === undefined) throw new Error("profile-logout-controller-required");
        restore = lifetime.beginOfflineMaintenance(context.workspace);
        admission = machine.forStoppedLogoutSettlement(this.#admission, operation, restore);
      } else {
        cold.inspection.snapshot.assertUnchanged(); cold.inspection.dispose();
        restore = cold.restore; admission = cold.admission;
      }
      const afterClose = profileAuthorityFileWitnesses(admission.stateRoot);
      const closedSource = fileStatus(path);
      if (!sameDirectory({ device: closedSource.dev, inode: closedSource.ino }, operation.source.database)) throw new Error("profile-logout-native-source-changed");
      const copied = withAuthorityDatabaseReadOnly(admission, path, native => inspectNativeAuthority(native, CURRENT_AUTHORITY_SCHEMA_VERSION));
      if (copied.installationId !== observed.installationId || copied.profileId !== observed.profileId || copied.schemaVersion !== observed.schemaVersion
        || copied.authorityGeneration !== observed.authorityGeneration || copied.authorityContentFingerprint !== observed.authorityContentFingerprint
        || canonicalJsonStringify(profileAuthorityFileWitnesses(admission.stateRoot)) !== canonicalJsonStringify(afterClose)) throw new Error("profile-logout-native-source-changed");
      inspection = admission.capturePendingLogoutSnapshot(); snapshot = inspection.snapshot; copyAdmission = inspection.admission;
      database = new AuthorityDatabase(copyAdmission, { path: snapshot.path, busyTimeoutMs: 250, migrationOwner: "profile-logout-inspection", openMode: "storage-doctor-read-only-no-migrate" }, this.#clock,
        undefined, undefined, undefined, undefined, "stopped-logout-inspection");
      const { probeStoppedProfileBrowsersClosed } = await import("../maintenance/profile-inventory.js");
      await probeStoppedProfileBrowsersClosed(admission, this.#clock, profileBrowserClosure);
      admission.assertPendingLogoutSettlementDatabase(path);
      if (inspectNativeAuthority(database.#database, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint !== copied.authorityContentFingerprint
        || canonicalJsonStringify(profileAuthorityFileWitnesses(admission.stateRoot)) !== canonicalJsonStringify(afterClose)) throw new Error("profile-logout-native-source-changed");
      if (operation.settlement === undefined) {
        const facts = database.readProfileResourceCustody();
        const stoppedAt = this.#clock.now().toISOString();
        const requests = facts.runs.flatMap(run => {
          const claim = runClaim(run);
          return claim === undefined ? [] : [CanonicalCrashRecoveryRequestSchema.parse({ commandId: lifecycleCommandId("logout-crash", { operationId: operation.operationId,
            runId: run.envelope.runId, version: run.version }), runId: run.envelope.runId, expectedVersion: run.version,
            claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: stoppedAt })];
        });
        snapshot.assertUnchanged();
        this.#publishPendingLogout(admission, LogoutOperationSchema.parse({ ...operation, settlement: { phase: "prepared", stoppedAt,
          processId: process.pid, before: copied.authorityContentFingerprint, requests } }));
      }
      if (operation.settlement?.after === copied.authorityContentFingerprint) {
        for (const request of operation.settlement.requests) {
          const command = database.authority.lifecycleJournal.getCommand(request.commandId), audit = database.authority.lifecycleJournal.findAuditByCommand(request.commandId);
          const run = database.authority.runs.get(request.runId);
          if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "recover-crash"
            || canonicalJsonStringify(command.request) !== canonicalJsonStringify(request) || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
            || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command) || audit.result.kind !== "run" || audit.result.runId !== request.runId
            || run === undefined || run.version < audit.result.appliedVersion) throw new Error("profile-logout-recovery-receipt-unproved");
        }
      }
      database.close(); database = undefined;
      snapshot.assertUnchanged(); inspection.dispose(); inspection = undefined; copyAdmission = undefined; snapshot = undefined;
      const prepared = admission.assertPendingLogoutSettlementDatabase(path), settlement = prepared.settlement;
      if (settlement === undefined) throw new Error("profile-logout-settlement-unprepared");
      if (copied.authorityContentFingerprint !== settlement.before && copied.authorityContentFingerprint !== settlement.after) throw new Error("profile-logout-settlement-source-changed");
      if (settlement.phase === "done") {
        if (copied.authorityContentFingerprint !== settlement.after) throw new Error("profile-logout-settlement-source-changed");
        return this.#logoutContext(admission, restore, profileBrowserClosure);
      }
      const clock = capturedInstantClock(settlement.stoppedAt);
      database = new AuthorityDatabase(admission, { path, busyTimeoutMs: 250, migrationOwner: "profile-logout-settlement", openMode: "read-write" }, clock,
        undefined, undefined, undefined, undefined, "stopped-logout-settlement");
      database.#logoutBatch = { admission };
      const sourceDatabase = database;
      database.withAuthorityTransaction(() => services.recover(sourceDatabase, prepared, lifetime));
      database.#logoutBatch = undefined;
      database.close();
      const committed = admission.assertPendingLogoutSettlementDatabase(path), expected = committed.settlement;
      const readback = withAuthorityDatabaseReadOnly(admission, path, native => inspectNativeAuthority(native, CURRENT_AUTHORITY_SCHEMA_VERSION));
      if (expected?.phase !== "commit-intent" || expected.after !== readback.authorityContentFingerprint) throw new Error("profile-logout-settlement-readback-failed");
      database.#publishPendingLogout(admission, LogoutOperationSchema.parse({ ...committed, settlement: { ...expected, phase: "done" } }));
      database = undefined;
      return this.#logoutContext(admission, restore, profileBrowserClosure);
    } catch (error) {
      const failure = hasUnprovedSourceClosure(error) ? error : retainAuthoritySourceClosure([error], { database: { original: this, temporary: database }, admission: { admission, copyAdmission }, snapshot, restore });
      this.#admission.retainSourceClosure(failure); admission?.retainSourceClosure(failure);
      retainUnprovedSourceOwners(failure, { database: { original: this, temporary: database }, admission: { admission, copyAdmission }, snapshot, restore });
      throw failure;
    }
  }

  browserWorkerOwner(admission: RuntimeAdmission, workerId: string, stoppedProcess?: ChildProcess) {
    if (this.#admission !== admission) throw new Error("browser-profile-database-owner-mismatch");
    this.#assertOpen(); admission.assertProfileRuntime();
    const slot = this.authority.workerSlots.get(WorkerIdSchema.parse(workerId));
    if (slot === undefined || slot.retiredAt !== null) throw new Error("browser-profile-worker-owner-mismatch");
    if (stoppedProcess !== undefined) {
      if (!(admission.lifetime instanceof RuntimeLifetimeLock)) throw new Error("browser-profile-worker-owner-mismatch");
      admission.lifetime.assertOwnedChildClosed(stoppedProcess);
    }
    admission.lifetime.assertHeld();
    return Object.freeze({ kind: "worker" as const, workerId: slot.workerId, workflowId: slot.workflow, ordinal: slot.ordinal });
  }


  capturePendingLogoutSource() {
    this.#assertOpen(); this.#admission.assertProfileRuntime();
    if (this.#openedFileIdentity === undefined) throw new Error("profile-logout-native-source-required");
    const identity = fileStatus(this.#path);
    if (!identity.isFile() || (identity.nlink !== 1 && identity.nlink !== 1n) || privatePathRejects(this.#path, identity, "owner")
      || identity.dev !== this.#openedFileIdentity.device || identity.ino !== this.#openedFileIdentity.inode) throw new Error("profile-logout-native-source-changed");
    this.#admission.assertProfileRuntime();
    return Object.freeze({ database: fileIdentityObservation(this.#openedFileIdentity, { preserveSafeNumbers: true }) });
  }

  #failNativeClosure(errors: readonly unknown[]): never {
    const failure = retainAuthoritySourceClosure(errors, { database: this.#database, admission: this.#admission });
    this.#admission.retainSourceClosure(failure);
    throw failure;
  }

  close(): void {
    if (this.#closed) return;
    if (this.#transactionDepth !== 0) throw new Error("cannot close authority database during a transaction");
    try { this.#database.close(); }
    catch (error) { this.#failNativeClosure([error]); }
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  getMeta(): z.infer<typeof AuthorityMetaSchema> {
    this.#assertOpen();
    const row = this.#readMetaRow();
    return AuthorityMetaSchema.parse({
      schemaVersion: row.schema_version,
      installationId: row.installation_id,
      profileId: row.profile_id,
      authorityGeneration: row.authority_generation,
      updatedAt: row.updated_at,
    });
  }

  /** Generation, other connections' commits, and this connection's commits except the run-page cache's own. Reads nothing else. */
  changeKey(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }> {
    this.#assertOpen();
    const key = this.#rawChangeKey();
    return Object.freeze({ ...key, totalChanges: key.totalChanges - this.#pageCacheChanges });
  }

  #rawChangeKey(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }> {
    const totalChanges = z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#database.prepare("SELECT total_changes() AS count").get()).count;
    return { authorityGeneration: this.#readMetaRow().authority_generation, dataVersion: readIntPragma(this.#database, "data_version"), totalChanges };
  }

  readApplicationActivity() {
    this.#assertOpen();
    return this.#withReadSnapshot(() => {
      return Object.freeze({
        runs: this.#database.prepare("SELECT * FROM runs ORDER BY id").all().map((raw): PredecessorRunRecord => runRecordFromRow(raw)),
        writeIntents: this.#database.prepare("SELECT * FROM write_intents ORDER BY id").all()
          .map(row => this.#parseNativeRow("write_intents", row, WriteIntentRecordSchema)),
        duoLeases: this.#database.prepare("SELECT * FROM auth_leases ORDER BY credential_key").all()
          .map(row => this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema)),
        pendingArtifacts: this.authority.artifactOutbox.listPending(),
      });
    });
  }

  readProfileResourceCustody() {
    this.#assertOpen();
    return this.#withReadSnapshot(() => {
      return Object.freeze({
        ...this.readApplicationActivity(),
        authorityGeneration: this.getMeta().authorityGeneration,
        upgrades: readAuthorityUpgradeRecords(this.#database),
        slots: this.authority.workerSlots.list(),
        exclusiveSessionLeases: this.#database.prepare("SELECT * FROM exclusive_session_leases ORDER BY id").all().map(exclusiveSessionLeaseFromRow),
        artifactReferences: this.readManagedArtifactReferences(),
        configSnapshots: this.#database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
          .map(row => this.#parseNativeRow("settings_snapshots", row, ConfigSnapshotRecordSchema)),
      });
    });
  }

  readManagedArtifactReferences(candidate?: ArtifactRef): readonly ArtifactRef[] {
    this.#assertOpen();
    return this.#withReadSnapshot(() => readManagedArtifactReferencesFromDatabase(this.#database, this.#admission.artifactRoot, candidate));
  }

  static reclaimStoppedDiagnostics(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock,
    operation: OfflineMaintenanceOperation): number {
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
    admission.assertOfflineMaintenance(operation);
    return withAuthorityDatabaseReadOnly(admission, path, database => {
      const inspection = inspectNormalAuthority(database), binding = admission.profileBinding;
      if (inspection.installationId !== binding.installationId || inspection.profileId !== binding.profileId) throw new Error("profile-maintenance-binding-mismatch");
      return reclaimDiagnosticStages(admission, ref => readManagedArtifactReferencesFromDatabase(database, admission.artifactRoot, ref).some(reference => reference.id === ref.id || reference.sha256 === ref.sha256), operation);
    });
  }

  sweepOrdinaryDiagnostics(now: string): Readonly<{ purged: readonly string[]; retainedBytes: number }> {
    const instant = IsoInstantSchema.parse(now);
    const due = this.#database.prepare("SELECT * FROM diagnostic_snapshots WHERE retention_kind='ordinary' AND purge_after<=? ORDER BY purge_after,id").all(instant);
    const purged: string[] = [];
    let retainedBytes = 0;
    for (const raw of due) {
      const bundle = this.#parseNativeRow("diagnostic_snapshots", raw, DiagnosticBundleSchema);
      const run = this.authority.runs.get(bundle.runId);
      if (run === undefined) throw new Error("diagnostic-retention-run-missing");
      // Active executions and external-write recovery cannot lose evidence.
      if (run.lifecycle.state !== "terminal" || this.authority.writeIntents.listByRun(bundle.runId).some(intent => intent.status !== "committed")) continue;
      this.#authorityWrite("diagnostic_snapshots", () => {
        const current = this.#readRecord("diagnostic_snapshots", bundle.bundleId, DiagnosticBundleSchema);
        if (current === undefined || current.retention.kind !== "ordinary") throw new Error("diagnostic-retention-owner-changed");
        if (current.availability !== undefined) return { result: undefined, changes: 0 };
        const record = DiagnosticBundleSchema.parse({ ...current, availability: { state: "purged", at: instant, reason: "retention" } });
        const result = this.#database.prepare("UPDATE diagnostic_snapshots SET payload_json=? WHERE id=?").run(canonicalJsonStringify(record), bundle.bundleId);
        return { result: undefined, changes: sqliteChanges(result.changes) };
      });
      for (const attachment of bundle.attachments) {
        const ref = ArtifactRefSchema.parse({ id: attachment.artifactId, sha256: attachment.digest, bytes: attachment.byteLength, mediaType: attachment.mediaType });
        this.#authorityWrite("diagnostic_snapshots", () => {
          const references = [...this.readManagedArtifactReferences(ref), ...pendingDiagnosticArtifacts(this.#admission, false)];
          if (references.some(reference => reference.id === ref.id || reference.sha256 === ref.sha256)) { retainedBytes += ref.bytes; return { result: undefined, changes: 0 }; }
          // An explicit unavailable association survives failed or interrupted byte removal.
          try { removeArtifactDeletionFile(this.#admission, inspectArtifactDeletionFile(this.#admission, ref)); }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
          return { result: undefined, changes: 0 };
        });
      }
      purged.push(bundle.bundleId);
    }
    return Object.freeze({ purged: Object.freeze(purged), retainedBytes });
  }

  private classifyFixedLayoutActivation(intent: FixedLayoutActivation, verifiedBackupPath: string, startup = false): "prestate" | "committed" {
    this.#assertOpen();
    if (startup) this.#admission.assertReadOnlyAuthorityDatabase(this.#path); else this.#admission.assertFixedLayoutDatabase(this.#path);
    if (this.#path !== intent.authorityPath || this.#path !== join(this.#admission.stateRoot, "state.db")
      || verifiedBackupPath !== join(this.#admission.stateRoot, "backups", "authority", intent.backupFileName)) throw new Error("fixed-layout-activation-path-mismatch");
    const copy = this.#admission.verifiedReadOnlyCopy(verifiedBackupPath, intent.backupSha256);
    let retain = false;
    try {
      return withAuthorityDatabaseReadOnly(copy, verifiedBackupPath, baseline => {
        inspectOpenDatabase(baseline, false);
        return this.#withReadSnapshot(() => {
          const before = readMetaRow(baseline), after = readMetaRow(this.#database);
          if (before.schema_version !== CURRENT_AUTHORITY_SCHEMA_VERSION || after.schema_version !== CURRENT_AUTHORITY_SCHEMA_VERSION
            || before.authority_generation !== intent.preAuthorityGeneration
            || authorityContentFingerprint(baseline) !== intent.preAuthorityContentFingerprint) throw new Error("fixed-layout-activation-baseline-changed");
          const baselineApp = fixedLayoutAppSettings(baseline), baselineSettings = baselineApp?.saved ?? initialSettingsFileRecord();
          if (baselineSettings.revision !== intent.settingsRevision || baselineSettings.settingsFingerprint !== intent.settingsFingerprint
            || canonicalJsonStringify(baselineApp?.active ?? null) !== canonicalJsonStringify(intent.priorActive)) throw new Error("fixed-layout-activation-settings-changed");
          let outputPaths: ReturnType<typeof fixedLayoutOutputPaths> = {};
          if (intent.priorActive !== null) {
            const priorSnapshotRow = baseline.prepare("SELECT payload_json FROM settings_snapshots WHERE id=?").get(intent.priorActive.configSnapshotId);
            const priorSnapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(z.strictObject({ payload_json: z.string() }).parse(priorSnapshotRow).payload_json));
            if (priorSnapshot.fingerprint !== intent.priorActive.configFingerprint || priorSnapshot.config.paths.stateRoot !== intent.sourceRoot
              || priorSnapshot.config.paths.artifactRoot !== join(intent.sourceRoot, "artifacts")) throw new Error("fixed-layout-source-snapshot-mismatch");
            outputPaths = fixedLayoutOutputPaths(baselineSettings.settings, priorSnapshot.config.paths, intent.sourceRoot, dirname(intent.authorityPath));
          } else if (baselineApp !== null || fixedLayoutSettingsSnapshots(baseline).length !== 0 || intent.settingsInitialization === undefined) throw new Error("fixed-layout-initialization-not-fresh");
          if (canonicalJsonStringify(intent.settingsUpdate?.outputPaths ?? {}) !== canonicalJsonStringify(outputPaths)
            || baselineSettings.settings.paths?.browserProfileRoot !== intent.settingsUpdate?.previousBrowserRoot) throw new Error("fixed-layout-output-defaults-changed");
          if (authorityContentFingerprint(this.#database) === authorityContentFingerprint(baseline)) return "prestate";
          assertFixedLayoutPublications(baseline, this.#database, before.authority_generation, intent.snapshot.capturedAt);
          if (fixedLayoutUnchangedAuthorityFingerprint(this.#database, intent) !== fixedLayoutUnchangedAuthorityFingerprint(baseline, intent)) {
            throw new Error(`fixed-layout-unrelated-authority-changed: ${fixedLayoutChangedAuthorityTables(baseline, this.#database).join(",")}`);
          }
          const snapshots = fixedLayoutSettingsSnapshots(this.#database), prior = fixedLayoutSettingsSnapshots(baseline);
          const expectedSnapshots = new Map<string, ConfigSnapshotRecord>([intent.snapshot].map(snapshot => [snapshot.configSnapshotId, snapshot]));
          const added = snapshots.filter(row => expectedSnapshots.has(FixedLayoutSettingsSnapshotRowSchema.parse(JSON.parse(row)).id));
          if (added.length !== expectedSnapshots.size || snapshots.length !== prior.length + expectedSnapshots.size
            || canonicalJsonStringify(snapshots.filter(row => !added.includes(row))) !== canonicalJsonStringify(prior)) throw new Error("fixed-layout-snapshot-history-changed");
          for (const row of added) {
            const parsed = FixedLayoutSettingsSnapshotRowSchema.parse(JSON.parse(row));
            if (canonicalJsonStringify(ConfigSnapshotRecordSchema.parse(JSON.parse(parsed.payload_json))) !== canonicalJsonStringify(expectedSnapshots.get(parsed.id))) throw new Error("fixed-layout-snapshot-mismatch");
          }
          const app = fixedLayoutAppSettings(this.#database);
          const update = intent.settingsUpdate === undefined ? undefined : fixedLayoutSettingsUpdate(intent, baselineSettings.settings);
          if (update !== undefined && (canonicalJsonStringify(this.#readRecord("commands", update.request.commandId, CommandRequestSchema)) !== canonicalJsonStringify(update.request)
            || canonicalJsonStringify(this.#readRecord("command_audits", update.audit.auditId, CommandAuditRecordSchema)) !== canonicalJsonStringify(update.audit))) throw new Error("fixed-layout-settings-journal-changed");
          const expected = { generation: (intent.priorActive?.generation ?? 0) + 1, settingsRevision: intent.snapshot.revision,
            settingsFingerprint: update?.current.settingsFingerprint ?? intent.settingsFingerprint, configSnapshotId: intent.snapshot.configSnapshotId,
            configFingerprint: intent.snapshot.fingerprint, activatedAt: intent.snapshot.capturedAt };
          if (app === null || canonicalJsonStringify(app.saved) !== canonicalJsonStringify(update?.current ?? baselineApp?.saved ?? null)
            || canonicalJsonStringify(app.initialization) !== canonicalJsonStringify(intent.settingsInitialization === undefined ? baselineApp?.initialization : {
              ...intent.settingsInitialization, configSnapshotId: intent.snapshot.configSnapshotId, configFingerprint: intent.snapshot.fingerprint,
              initializedAt: intent.snapshot.capturedAt, settings: initialSettingsFileRecord(),
            })
            || canonicalJsonStringify(app.active) !== canonicalJsonStringify(expected)
            || after.authority_generation !== before.authority_generation + 1 || after.updated_at !== intent.snapshot.capturedAt) throw new Error("fixed-layout-activation-state-mismatch");
          return "committed";
        });
      });
    } catch (error) {
      retain = hasUnprovedSourceClosure(error);
      if (retain) throw retainAuthoritySourceClosure([error], { admission: copy });
      throw error;
    } finally { if (!retain) copy.release(); }
  }

  inspectSchema(): z.infer<typeof AuthoritySchemaInspectionSchema> {
    this.#assertOpen();
    const meta = this.getMeta();
    const names = this.#tableNames();
    return AuthoritySchemaInspectionSchema.parse({
      applicationId: this.#readIntPragma("application_id"),
      schemaVersion: meta.schemaVersion,
      authorityGeneration: meta.authorityGeneration,
      pragmas: {
        journalMode: this.#readTextPragma("journal_mode"),
        foreignKeys: this.#readIntPragma("foreign_keys"),
        synchronous: this.#readIntPragma("synchronous"),
        busyTimeoutMs: this.#readIntPragma("busy_timeout"),
      },
      tables: names.map((name) => ({ name, classification: tableClassification(AuthorityTableNameSchema.parse(name)) })),
    });
  }

  listQueueItemAttempts(day: string, input: unknown): readonly RunRecord[] {
    const selectedDay = z.iso.date().parse(day);
    const items = z.array(z.strictObject({ workflowId: WorkflowIdSchema, itemId: ItemIdSchema })).parse(input);
    return this.withAuthorityReadSnapshot(() => {
      this.#validateExternalQuerySources();
      return this.#database.prepare(`SELECT runs.* FROM json_each(?) selected
        JOIN runs ON runs.workflow=json_extract(selected.value,'$.workflowId')
          AND runs.item_id=json_extract(selected.value,'$.itemId')
          AND runs.local_day=?
        ORDER BY runs.workflow,runs.item_id,runs.enqueued_at,runs.id`).all(JSON.stringify(items), selectedDay).map(runRecordFromRow);
    });
  }

  listItemAttemptHistorySources(input: unknown) {
    const request=z.strictObject({workflow:WorkflowIdSchema,itemId:ItemIdSchema,sourceLimit:z.number().int().min(1).max(501)}).parse(input);
    return this.withAuthorityReadSnapshot(()=>{
      const countFor=(table:"runs"|"deleted_runs")=>z.strictObject({count:z.number().int().nonnegative()}).parse(
        this.#database.prepare(`SELECT count(*) AS count FROM ${table} WHERE workflow=? AND item_id=?`).get(request.workflow,request.itemId)).count;
      const live=this.#database.prepare("SELECT * FROM runs WHERE workflow=? AND item_id=? ORDER BY attempt,id LIMIT ?")
        .all(request.workflow,request.itemId,request.sourceLimit).map(runRecordFromRow);
      const deleted=this.#database.prepare("SELECT * FROM deleted_runs WHERE workflow=? AND item_id=? ORDER BY attempt,run_id LIMIT ?")
        .all(request.workflow,request.itemId,request.sourceLimit).map(row=>deletedRunFromRow(row).receipt);
      return Object.freeze({counts:Object.freeze({live:countFor("runs"),deleted:countFor("deleted_runs")}),
        live:Object.freeze(live),deleted:Object.freeze(deleted)});
    });
  }

  summaryWorkflows() {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.authority.dependencies.waitState(run.envelope.runId),
      envelopes => this.authority.dependencies.parents(envelopes)).workflows(this.getMeta().authorityGeneration) });
  }

  queryRunSummaries(query: Parameters<ReturnType<typeof createRunSummaries>["query"]>[1]) {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.authority.dependencies.waitState(run.envelope.runId),
      envelopes => this.authority.dependencies.parents(envelopes)).query(this.getMeta().authorityGeneration,query) });
  }

  queryRunCalendar(query: Parameters<ReturnType<typeof createRunSummaries>["calendar"]>[1]) {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.authority.dependencies.waitState(run.envelope.runId),
      envelopes => this.authority.dependencies.parents(envelopes)).calendar(this.getMeta().authorityGeneration, query) });
  }

  readRunSummaries() {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.authority.dependencies.waitState(run.envelope.runId),
      envelopes => this.authority.dependencies.parents(envelopes)).read(this.getMeta().authorityGeneration) });
  }

  registerRunSearchDeclarations(input: unknown): void {
    this.#withTransaction("projection", () => { createRunSearchIndex(this.#database).register(input, this.#now()); });
  }

  rebuildRunSearchIndex(input: unknown) {
    const request = RunSearchRebuildRequestSchema.parse(input);
    return this.#withTransaction("projection", () => createRunSearchIndex(this.#database).rebuild(request, this.getMeta().authorityGeneration, this.#now()), request.restart ? "none" : "progress");
  }

  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result {
    return this.#withTransaction("authority", () => work(this.authority));
  }

  #assertCommandIdentity(record: z.infer<typeof StoredAuthorityCommandRecordSchema>, parentCommandId?: string): void {
    if (this.#transactionDepth === 0 || this.#transactionMode !== "authority") {
      throw new Error("command identity admission requires an authority transaction");
    }
    const parent = "kind" in record && record.kind === "bulk-parent";
    if (parentCommandId !== undefined) {
      const acceptance = this.authority.commands.getBulk(parentCommandId);
      if (acceptance === undefined || !("family" in record) || record.family !== "run"
        || !acceptance.request.targets.some((target) => canonicalJsonStringify(deriveBulkChildCommand(acceptance.request, target)) === canonicalJsonStringify(record))) {
        throw new CommandIdentityConflictError("command-group invalid parent membership");
      }
    }
    const existingParentId = this.authority.commands.parentId(record.commandId);
    if (existingParentId !== undefined && existingParentId !== (parentCommandId ?? null)) throw new CommandIdentityConflictError("command-group different-parent replay");
    // A reserved derived child cannot enter through the standalone door, even before journaling.
    for (const row of this.#database.prepare("SELECT request_json AS payload_json FROM commands WHERE family = 'bulk-parent'").all()) {
      const accepted = BulkParentCommandRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).payload_json)).acceptance;
      if (accepted.request.targets.some((target) => deriveBulkChildCommandId(accepted.bulkCommandId, target.runId) === record.commandId)
        && parentCommandId !== accepted.bulkCommandId) throw new CommandIdentityConflictError("command-group child identity requires its parent");
    }
    if (parent && this.authority.commands.parentId(record.commandId) === undefined) {
      for (const target of record.acceptance.request.targets) {
        const childId = deriveBulkChildCommandId(record.commandId, target.runId);
        if (childId === record.commandId || this.#credentialCommandIds(childId)
          || this.authority.commands.parentId(childId) !== undefined) throw new CommandIdentityConflictError("command-group parent reserves an existing command identity");
      }
    }
    const protectedCommand = "family" in record && record.family === "settings" && record.type === "apply-protected-settings";
    if (!protectedCommand && this.#credentialCommandIds(record.commandId)) throw new CommandIdentityConflictError();
    const row = this.#database.prepare("SELECT request_json AS payload_json FROM commands WHERE id = ?").get(record.commandId);
    if (row !== undefined && canonicalJsonStringify(JSON.parse(JsonRowSchema.parse(row).payload_json) as unknown) !== canonicalJsonStringify(record)) {
      if ("family" in record && (record.family === "settings" || record.family === "failure-resolution" || record.family === 'assistant-model-preference' || record.family === "ocr-review")) throw new CommandIdentityConflictError();
      throw new Error(`command id ${record.commandId} was reused with different content`);
    }
  }


  afterAuthorityCommit(publish: () => void): void {
    if (this.#transactionDepth === 0) {
      publish();
      return;
    }
    if (this.#transactionMode !== "authority") throw new Error("authority publication requires an authority transaction");
    this.#authorityCommitCallbacks.push(publish);
  }


  canonicalPerson(runId: string) {
    return this.withAuthorityReadSnapshot(() => {
      const run=this.authority.runs.get(runId);
      if(run===undefined) return {state:"unavailable" as const,reason:"canonical-live-run-unavailable"};
      return deriveCanonicalPerson(run,this.authority.runResults.get(runId) ?? null);
    });
  }

  /** Systems whose live Duo ceremony lease this worker holds. */
  heldDuoSystems(workerId: string): readonly string[] {
    return this.withAuthorityReadSnapshot(() => this.#database.prepare("SELECT * FROM auth_leases WHERE holder_worker_id=? AND state='held'").all(workerId)
      .map(row => this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema))
      .filter(lease => isDuoCeremonyLeaseLive(lease, this.#clock.now().getTime())).map(lease => lease.holder.system));
  }

  withAuthorityReadSnapshot<Result>(read: () => Result): Result {
    return this.#withReadSnapshot(read);
  }

  assertPristineQueuedRun(runId: string, expectedVersion: number): void {
    const run = this.#readRunRow(RunIdSchema.parse(runId));
    if (run === undefined || run.version !== expectedVersion || run.lifecycle.state !== "queued" || run.claimGeneration !== 0
      || this.#database.prepare("SELECT 1 FROM write_intents WHERE run_id=? LIMIT 1").get(runId) !== undefined
      || this.#database.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=? LIMIT 1").get(runId) !== undefined) throw new Error("startup-stale-queue-custody-unproved");
  }

  /** Releases the Duo and exclusive-session leases one exited worker held. */
  settleInterruptedWorker(lock: RuntimeLifetimeLock, workerId: string, now: string) {
    return this.#releaseSessionLeases(lock, WorkerIdSchema.parse(workerId), now);
  }

  /** Releases every held lease; only a root holding the port, which proves no holder lives, may call it. */
  releaseHeldSessionLeases(lock: RuntimeLifetimeLock, now: string) {
    return this.#releaseSessionLeases(lock, undefined, now);
  }

  #releaseSessionLeases(lock: RuntimeLifetimeLock, workerId: string | undefined, now: string) {
    if (!(lock instanceof RuntimeLifetimeLock)) throw new Error("crash-recovery-lock-required");
    lock.assertHeld();
    return this.withAuthorityTransaction(repositories => {
      const released: { kind: "duo" | "exclusive-session"; id: string; generation: number }[] = [];
      const duo = workerId === undefined ? this.#database.prepare("SELECT * FROM auth_leases WHERE state='held'").all()
        : this.#database.prepare("SELECT * FROM auth_leases WHERE holder_worker_id=? AND state='held'").all(workerId);
      for (const row of duo) {
        const current = this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema);
        this.#writeDuoCeremonyLease(DuoCeremonyLeaseRecordSchema.parse({ ...current, state: "released", releasedAt: now,
          version: current.version + 1, updatedAt: now }), "update");
        released.push({ kind: "duo", id: current.credentialKey, generation: current.generation });
      }
      for (const lease of workerId === undefined ? repositories.exclusiveSessionLeases.held() : repositories.exclusiveSessionLeases.heldByWorker(workerId)) {
        repositories.exclusiveSessionLeases.release(lease, now);
        released.push({ kind: "exclusive-session", id: lease.identityKey, generation: lease.generation });
      }
      return released;
    });
  }

  recoverCrashedRun(input: unknown, lock: RuntimeLifetimeLock): RunRecord {
    const request = CanonicalCrashRecoveryRequestSchema.parse(input);
    return this.withAuthorityTransaction(repositories => {
      const current = this.#readRunRow(request.runId), claim = current === undefined ? undefined : runClaim(current);
      if (current === undefined || current.version !== request.expectedVersion || claim?.workerId !== request.claim.workerId
        || claim.claimGeneration !== request.claim.claimGeneration || Date.parse(request.now) < Date.parse(current.envelope.enqueuedAt)) throw new Error("crash-recovery-claim-changed");
      if (!(lock instanceof RuntimeLifetimeLock)) throw new Error("crash-recovery-lock-required");
      lock.assertHeld();
      const intents = repositories.writeIntents.listByRun(request.runId);
      const unfinishedIntents = intents.filter(intent => intent.status !== "committed" && intent.status !== "observed-present");
      const unfinished = unfinishedIntents[0];
      if (unfinished !== undefined) {
        if (unfinishedIntents.length !== 1 || unfinished.status !== "attempting" && unfinished.status !== "parked") throw new Error("crash-recovery-write-outcome-unproved");
        const parked = RunRecordSchema.parse({ ...current, version: current.version + 1, updatedAt: request.now,
          lifecycle: { state: "parked-write", writeIntentId: unfinished.writeIntentId, intentGeneration: unfinished.generation,
            parkedAt: request.now, code: "unknown", message: `RUN_CRASH_WRITE_UNRESOLVED: ${ERROR_CATALOG.RUN_CRASH_WRITE_UNRESOLVED.text}` } });
        this.#writeRunRow(parked, "update");
        return parked;
      }
      const code = "RUN_INTERRUPTED_BY_CRASH", summary = ERROR_CATALOG[code].text;
      const failure = FailureRecordSchema.parse({ diagnosticSafetyVersion: 1,
        failureId: lifecycleCommandId("crash-failure", request.commandId),
        fingerprint: sha256Hex(`hrauto:failure-class:v1\0${current.envelope.workflow}\0absent-node\0absent-task\0${code}`),
        runId: current.envelope.runId, traceId: current.envelope.traceId, attempt: current.envelope.attempt,
        workflowId: current.envelope.workflow, code, summary, transient: false,
        writeState: settledWriteState(AuthenticatedRunContinuation.authenticate(repositories, current.envelope)
          .writeRunIds().flatMap(id => repositories.writeIntents.listByRun(id))),
        causeChain: [{ code, summary, role: "primary", transient: false }],
        remediation: [{ kind: "operator-action", message: summary }], occurredAt: request.now });
      const authorization = FailureTerminalAuthorizationRecordSchema.parse({ kind: "failed", runId: current.envelope.runId,
        workflowId: current.envelope.workflow, attempt: current.envelope.attempt, descriptorVersion: current.envelope.descriptorVersion,
        contractFingerprint: current.envelope.contractFingerprint, expectedVersion: current.version, claim: request.claim,
        authorizedAt: request.now, failureId: failure.failureId });
      this.#assertTerminalAuthorizationMatchesRun(authorization, current);
      const { pause: _pause, ...settled } = current;
      const terminal = RunRecordSchema.parse({ ...settled, version: current.version + 1, updatedAt: request.now, completion: completionFromAuthorization(authorization),
        lifecycle: { state: "terminal", outcome: "failed", endedAt: request.now, failureId: failure.failureId,
          errorSummary: summary, diagnosticSafetyVersion: 1 } });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`crash-recovery-transition-refused: ${violation}`);
      this.#insertFailure(failure);
      this.#terminalizationHooks?.afterFailureStorageStep?.("failure");
      this.#insertRunResult(createRunTerminalEvidenceResult(terminal, { kind: "failed-evidence", authorization,
        failureDigest: deriveTerminalFailureDigest(failure) }), terminal);
      this.#terminalizationHooks?.afterFailureStorageStep?.("result");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterFailureStorageStep?.("run");
      this.#assertTerminalAuthorizationConsequence(authorization, terminal);
      return terminal;
    });
  }

  terminalizeFailure(descriptor: AnyWorkflowDescriptor, input: unknown): FailureTerminalizationReport {
    const request = FailureTerminalizationRequestSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.failure.runId);
      if (current === undefined) throw new Error(`run ${request.failure.runId} does not exist`);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#completionAuthorization(current);
      const existing = this.#readRecord("run_failures", request.failure.failureId, FailureRecordSchema);
      const existingResult = this.authority.runResults.get(request.failure.runId);
      if (existingAuthorization !== undefined || existing !== undefined || existingResult !== undefined) {
        if (existingAuthorization === undefined || existing === undefined || existingResult === undefined) {
          throw new Error(`run ${request.failure.runId} has a partial failure terminal settlement`);
        }
        if (canonicalJsonStringify(existingAuthorization)
          !== canonicalJsonStringify(request.authorization)) {
          throw new Error(
            `run ${request.failure.runId} terminal authorization does not match the original pre-terminal claim`,
          );
        }
        if (canonicalJsonStringify(existing) !== canonicalJsonStringify(request.failure)) {
          throw new Error(`failure ${request.failure.failureId} already exists with different content`);
        }
        const expectedResult = createRunTerminalEvidenceResult(current, {
          kind: "failed-evidence", authorization: request.authorization,
          failureDigest: deriveTerminalFailureDigest(request.failure),
        });
        if (canonicalJsonStringify(existingResult) !== canonicalJsonStringify(expectedResult)) throw new Error("terminal-failure-result-mismatch");
        this.#assertTerminalAuthorizationConsequence(existingAuthorization, current);
        if (current.lifecycle.state !== "terminal"
          || current.lifecycle.errorSummary !== request.failure.summary
          || current.lifecycle.diagnosticSafetyVersion !== request.failure.diagnosticSafetyVersion) {
          throw new Error(`failure ${request.failure.failureId} exists without its exact terminal run transition`);
        }
        return FailureTerminalizationReportSchema.parse({
          state: "replayed",
          authorization: existingAuthorization,
          failure: existing,
          result: existingResult,
          run: current,
        });
      }
      if (current.lifecycle.state === "terminal") {
        throw new Error(`run ${request.failure.runId} is already terminal without failure ${request.failure.failureId}`);
      }
      descriptorRuntimeNodes(descriptor);
      this.#assertFailureMatchesRun(request.failure, current, descriptor);
      this.#assertFailureWasCurrentExecution(request.failure, current);
      this.#assertTerminalClaim(
        current,
        request.authorization.expectedVersion,
        request.authorization.claim,
      );

      const { pause: _pause, ...settled } = current;
      const terminal = RunRecordSchema.parse({
        ...settled,
        completion: completionFromAuthorization(request.authorization),
        lifecycle: {
          state: "terminal",
          outcome: "failed",
          endedAt: request.authorization.authorizedAt,
          failureId: request.failure.failureId,
          ...(request.failure.diagnosticSafetyVersion === undefined
            ? {}
            : { diagnosticSafetyVersion: request.failure.diagnosticSafetyVersion }),
          errorSummary: request.failure.summary,
        },
        version: current.version + 1,
        updatedAt: request.authorization.authorizedAt,
      });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`run ${request.failure.runId}: ${violation}`);
      this.#assertTerminalAuthorizationConsequence(request.authorization, terminal);
      this.#insertFailure(request.failure);
      this.#terminalizationHooks?.afterFailureStorageStep?.("failure");
      const result = createRunTerminalEvidenceResult(terminal, {
        kind: "failed-evidence", authorization: request.authorization,
        failureDigest: deriveTerminalFailureDigest(request.failure),
      });
      this.#insertRunResult(result, terminal);
      this.#terminalizationHooks?.afterFailureStorageStep?.("result");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterFailureStorageStep?.("run");
      return FailureTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        failure: request.failure,
        result,
        run: terminal,
      });
    });
  }

  settleLifecycleTerminalEvidence(commandId: string): void {
    this.withAuthorityTransaction((repositories) => {
      const command = RunLifecycleCommandRecordSchema.parse(repositories.lifecycleJournal.getCommand(commandId));
      const audit = RunLifecycleCommandAuditRecordSchema.parse(this.#readRecord("command_audits", commandId, RunLifecycleCommandAuditRecordSchema));
      if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command) || audit.result.kind !== "run") throw new Error("terminal-evidence-command-audit-mismatch");
      const run = this.#readRunRow(audit.result.runId);
      if (run === undefined) throw new Error("terminal-evidence-run-missing");
      if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome === "done" || run.lifecycle.outcome === "failed" || run.lifecycle.outcome === "interrupted") return;
      if (run.version !== audit.result.appliedVersion) throw new Error("terminal-evidence-run-version-mismatch");
      const request = z.record(z.string(), z.unknown()).parse(command.request);
      if (request.runId !== run.envelope.runId || (command.operation !== "transition" && command.operation !== "terminalize" && command.operation !== "requeue" && command.operation !== "recover-crash")) throw new Error("terminal-evidence-command-target-mismatch");
      const result = createRunTerminalEvidenceResult(run, {
        kind: "lifecycle-evidence", outcome: run.lifecycle.outcome,
        commandId: command.commandId, auditId: audit.auditId,
        requestFingerprint: command.requestFingerprint, appliedVersion: audit.result.appliedVersion,
      });
      const existing = this.authority.runResults.get(result.runId);
      if (existing === undefined) this.#insertRunResult(result, RunRecordSchema.parse({ ...run, version: audit.result.appliedVersion, updatedAt: result.createdAt }));
      else if (canonicalJsonStringify(existing) !== canonicalJsonStringify(result)) throw new Error("terminal-evidence-result-mismatch");
      assertTerminalEvidenceOwner(this.#database,result);
    });
  }

  terminalizeSuccess(input: unknown, factoryAuthorization?: object): SuccessTerminalizationReport {
    const request = SuccessTerminalizationRequestSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.result.runId);
      if (current === undefined) throw new Error(`run ${request.result.runId} does not exist`);
      this.#assertResultMatchesRun(request.result, current);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#completionAuthorization(current);
      const existingResult = this.authority.runResults.get(request.result.runId);
      if (existingAuthorization !== undefined || existingResult !== undefined) {
        if (existingAuthorization === undefined || existingResult === undefined) {
          throw new Error(`run ${request.result.runId} has a partial completion/result settlement`);
        }
        if (canonicalJsonStringify(existingAuthorization)
          !== canonicalJsonStringify(request.authorization)) {
          throw new Error(
            `run ${request.result.runId} terminal authorization does not match the original pre-terminal claim`,
          );
        }
        if (canonicalJsonStringify(existingResult) !== canonicalJsonStringify(request.result)) {
          throw new Error(`run result ${request.result.runId} already exists with different content`);
        }
        this.#assertTerminalAuthorizationConsequence(existingAuthorization, current);
        return SuccessTerminalizationReportSchema.parse({
          state: "replayed",
          authorization: existingAuthorization,
          result: existingResult,
          run: current,
        });
      }
      if (current.lifecycle.state === "terminal") {
        throw new Error(`run ${request.result.runId} is already terminal without a result`);
      }
      if (current.lifecycle.state !== "running") {
        throw new Error(`run ${request.result.runId} is ${current.lifecycle.state}; only running may finish done`);
      }
      assertWorkflowRunResultAuthorization(factoryAuthorization, request.result, current);
      this.#assertStoredTerminalDependencies(request.result, current);
      this.#assertTerminalClaim(
        current,
        request.authorization.expectedVersion,
        request.authorization.claim,
      );
      const { pause: _pause, ...settled } = current;
      const terminal = RunRecordSchema.parse({
        ...settled,
        completion: completionFromAuthorization(request.authorization),
        lifecycle: {
          state: "terminal",
          outcome: "done",
          endedAt: request.authorization.authorizedAt,
        },
        version: current.version + 1,
        updatedAt: request.authorization.authorizedAt,
      });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`run ${request.result.runId}: ${violation}`);
      this.#assertTerminalAuthorizationConsequence(request.authorization, terminal);

      this.#insertRunResult(request.result, terminal);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("result");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterSuccessStorageStep?.("run");
      return SuccessTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        result: request.result,
        run: terminal,
      });
    });
  }

  resumeRunDeletionFiles(): number {
    if (this.#transactionDepth !== 0) throw new Error("run-deletion-cleanup-requires-committed-receipt");
    this.#admission.assertWritable();
    const pending = this.#database.prepare("SELECT * FROM deleted_runs WHERE cleanup_state='pending' ORDER BY deleted_at,run_id").all()
      .map(row=>deletedRunFromRow(row).receipt);
    return this.#settleCommittedRunDeletionFiles(pending.map(receipt => ({runId:receipt.runId,commandId:receipt.commandId})));
  }

  settleRunDeletionFiles(input: unknown): "complete" {
    const request = z.strictObject({runIds:z.array(RunIdSchema),commandId:CommandIdSchema}).parse(input);
    this.#settleCommittedRunDeletionFiles(request.runIds.map(runId => ({runId,commandId:request.commandId})));
    return "complete";
  }

  #settleCommittedRunDeletionFiles(requests: readonly Readonly<{runId:string;commandId:string}>[]): number {
    if (this.#transactionDepth !== 0) throw new Error("run-deletion-cleanup-requires-committed-receipt");
    this.#admission.assertWritable();
    if (requests.length === 0) return 0;
    return this.#authorityWrite("deleted_runs",()=>{
      const deletions = requests.map(request => {
        const raw = this.#database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(request.runId);
        if (raw === undefined) throw new Error("run-deletion-cleanup-receipt-missing");
        const deletion = deletedRunFromRow(raw);
        if (deletion.receipt.commandId !== request.commandId) throw new Error("run-deletion-cleanup-command-mismatch");
        const commandRaw = this.#database.prepare("SELECT * FROM commands WHERE id=?").get(request.commandId);
        if (commandRaw === undefined) throw new Error("run-deletion-cleanup-command-missing");
        const command = commandFromRow(commandRaw);
        const auditRows = this.#database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(request.commandId);
        if (auditRows.length !== 1) throw new Error("run-deletion-cleanup-audit-missing");
        const audit = NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",auditRows[0]));
        if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
          || z.object({state:z.literal("succeeded"),outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
          || !settledRunDeletionIds(audit)?.includes(request.runId)) throw new Error("run-deletion-cleanup-settlement-mismatch");
        return deletion;
      });
      const pending = deletions.filter(deletion => deletion.cleanupState === "pending");
      if (pending.length > 0) validateAuthorityRecordSchemas(this.#database);
      const removals = pending.flatMap(deletion => deletion.files.filter(file => file.disposition === "remove").map(file => file.ref));
      const referenced = new Set<string>(), referencesIn = deletionArtifactReferenceMatcher(removals);
      if (removals.length > 0) for (const table of AuthorityTableNameSchema.options.filter(table=>table !== "deleted_runs")) {
        for (const row of this.#database.prepare(`SELECT * FROM ${table}`).iterate()) {
          for (const value of deletionArtifactValues(this.#database, table, row)) for (const digest of referencesIn(value)) referenced.add(digest);
        }
      }
      for (const deletion of pending) {
        for (const file of deletion.files.filter(file=>file.disposition === "remove")) {
          if (referenced.has(file.ref.sha256)) throw new Error("run-deletion-cleanup-file-still-referenced");
          removeArtifactDeletionFile(this.#admission,file);
          this.#lifecycleHooks?.afterDeletionFileRemoved?.({runId:deletion.receipt.runId,digest:file.ref.sha256});
        }
        const changed = this.#database.prepare("UPDATE deleted_runs SET cleanup_state='complete' WHERE run_id=? AND cleanup_state='pending'").run(deletion.receipt.runId);
        if (sqliteChanges(changed.changes) !== 1) throw new Error("run-deletion-cleanup-cas-lost");
      }
      return {result:deletions.length,changes:pending.length};
    });
  }

  commitWriteAttempt(input: unknown, checkpointInput: unknown): AtomicWriteCommitReport {
    const parsed = AtomicWriteCommitInputSchema.parse(input);
    const checkpoint = RunCheckpointRecordSchema.parse(checkpointInput);
    if (checkpoint.writtenAt !== parsed.confirmedAt
      || canonicalJsonStringify(checkpoint.output.value) !== canonicalJsonStringify(parsed.outcome)) {
      throw new Error("confirmed-history-checkpoint-outcome-mismatch");
    }
    return this.withAuthorityTransaction(() => {
      const next = this.#transitionWrite(parsed.writeIntentId, { generation: parsed.generation }, { type: "commit" });
      const { intent: currentIntent, attempt: currentAttempt } = next;
      WriteFenceRecordsSchema.parse({ intent: currentIntent, attempt: currentAttempt });
      this.#assertAtomicCommitMatchesIntent(parsed, currentIntent);
      const run=this.#readRunRow(currentIntent.runId);
      if(run===undefined || checkpoint.runId!==currentIntent.runId || checkpoint.workflowId!==currentIntent.workflowId
        || checkpoint.itemId!==currentIntent.itemId || checkpoint.attempt!==currentIntent.runAttempt
        || run.envelope.workflow!==checkpoint.workflowId || run.envelope.itemId!==checkpoint.itemId
        || run.envelope.attempt!==checkpoint.attempt || Number(run.claimGeneration)!==Number(checkpoint.claimGeneration)
        || run.envelope.descriptorVersion!==checkpoint.descriptorVersion || run.envelope.contractFingerprint!==checkpoint.contractFingerprint
        || run.envelope.traceId!==parsed.transaction.traceId)throw new Error("confirmed-history-checkpoint-owner-mismatch");

      const committedIntent = WriteIntentRecordSchema.parse({
        ...currentIntent,
        status: next.status,
        completionProof: parsed.completionProof,
        confirmedAt: parsed.confirmedAt,
        version: currentIntent.version + 1,
        updatedAt: parsed.confirmedAt,
      });
      const committedAttempt = WriteAttemptRecordSchema.parse({
        ...currentAttempt,
        outcome: {
          state: next.outcome,
          completionProof: parsed.completionProof,
          confirmedAt: parsed.confirmedAt,
        },
        recordedAt: parsed.confirmedAt,
      });

      const history = confirmedOperationTimeline({ ledger: parsed.transaction,
        span: parsed.committedSpan, checkpoint, writeAttemptId: committedAttempt.writeAttemptId,
        recordedAt: this.#clock.now().toISOString() });
      const publication = ConfirmationPublicationSchema.parse({format:1,ledger:parsed.transaction,span:parsed.committedSpan,checkpoint,timeline:history});
      this.#replaceWriteIntent(committedIntent,publication);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      this.#replaceWriteAttempt(committedAttempt);
      this.#writeCommitHooks?.afterStorageStep("attempt-state");
      this.authority.runCheckpoints.insert(checkpoint);
      this.#writeCommitHooks?.afterStorageStep("transaction-checkpoint");
      const reconstructed = reconstructConfirmedOperation(timelineEvidenceRepositories(this.#database), history);
      if (canonicalJsonStringify(reconstructed.ledger) !== canonicalJsonStringify(parsed.transaction)
        || canonicalJsonStringify(reconstructed.span) !== canonicalJsonStringify(parsed.committedSpan)) {
        throw new Error("confirmed-history-lossless-reconstruction-failed");
      }
      this.authority.timelineEvents.append(history);
      this.#writeCommitHooks?.afterStorageStep("timeline-event");
      assertConfirmationPublication(this.#database,history.payload.kind === "operation-confirmed" ? history.payload.facts.writeIntentId : "");

      return AtomicWriteCommitReportSchema.parse({
        state: "committed",
        intent: committedIntent,
        attempt: committedAttempt,
        transaction: parsed.transaction,
        committedSpan: parsed.committedSpan,
      });
    });
  }

  commitRecheckedParkedWrite(input: unknown): AtomicWriteCommitReport {
    const request = ResolvedParkedWriteCommitInputSchema.parse(input);
    const {commit,checkpoint,resolution} = request;
    return this.withAuthorityTransaction(()=>{
      const next = this.#transitionWrite(commit.writeIntentId,{generation:commit.generation,version:request.expectedIntentVersion},{type:"resolve-present",resolution});
      const {intent:current,attempt} = next;
      const run = this.#readRunRow(current.runId);
      if (current.status !== "parked" || run === undefined || run.lifecycle.state !== "running" || current.recheck?.commandId !== resolution.commandId
        || run.envelope.attempt !== current.runAttempt || commit.outcome.proofSource !== "recovery-probe") throw new Error("parked-write-recheck-run-mismatch");
      this.#assertCurrentExecution(current.runId, request.claim);
      authenticateParkedWriteRecheck(current, attempt, this.authority.commands.get(resolution.commandId), this.authority.commandAudits.get(resolution.auditId));
      this.#assertAtomicCommitMatchesIntent(commit,current);
      if (checkpoint.writtenAt !== commit.confirmedAt || checkpoint.runId !== current.runId
        || checkpoint.workflowId !== current.workflowId || checkpoint.itemId !== current.itemId
        || checkpoint.attempt !== current.runAttempt || Number(checkpoint.claimGeneration) !== Number(run.claimGeneration)
        || checkpoint.nodeId !== current.recheck.nodeId || checkpoint.descriptorVersion !== run.envelope.descriptorVersion
        || checkpoint.contractFingerprint !== run.envelope.contractFingerprint || commit.transaction.traceId !== run.envelope.traceId
        || canonicalJsonStringify(checkpoint.output.value) !== canonicalJsonStringify(commit.outcome)) throw new Error("parked-write-resolution-checkpoint-mismatch");
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,recheck:_recheck,...base} = current;
      const intent = WriteIntentRecordSchema.parse({...base,status:next.status,completionProof:commit.completionProof,
        confirmedAt:commit.confirmedAt,version:current.version+1,updatedAt:commit.confirmedAt,resolution});
      authenticateStoredWriteResolution(this.#database,intent);
      const history = confirmedOperationTimeline({ledger:commit.transaction,span:commit.committedSpan,checkpoint,
        writeAttemptId:attempt.writeAttemptId,recordedAt:this.#clock.now().toISOString()});
      const publication = ConfirmationPublicationSchema.parse({format:1,ledger:commit.transaction,span:commit.committedSpan,checkpoint,timeline:history});
      this.#replaceWriteIntent(intent,publication);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      this.authority.runCheckpoints.insert(checkpoint);
      this.#writeCommitHooks?.afterStorageStep("transaction-checkpoint");
      const restored = reconstructConfirmedOperation(timelineEvidenceRepositories(this.#database),history);
      if (canonicalJsonStringify(restored.ledger) !== canonicalJsonStringify(commit.transaction)
        || canonicalJsonStringify(restored.span) !== canonicalJsonStringify(commit.committedSpan)) throw new Error("parked-write-resolution-history-mismatch");
      this.authority.timelineEvents.append(history);
      this.#writeCommitHooks?.afterStorageStep("timeline-event");
      assertConfirmationPublication(this.#database,history.payload.kind === "operation-confirmed" ? history.payload.facts.writeIntentId : "");
      if (canonicalJsonStringify(this.#requireWriteAttempt(attempt.writeAttemptId)) !== canonicalJsonStringify(attempt)) throw new Error("parked-write-resolution-original-attempt-changed");
      return AtomicWriteCommitReportSchema.parse({state:"committed",intent,attempt,transaction:commit.transaction,committedSpan:commit.committedSpan});
    });
  }

  settleResolvedParkedAbsence(input: unknown): WriteIntentRecord {
    const request = ResolvedParkedWriteAbsenceInputSchema.parse(input);
    return this.withAuthorityTransaction(()=>{
      const next = this.#transitionWrite(request.writeIntentId,{generation:request.generation,version:request.expectedIntentVersion},{type:"resolve-absent",resolution:request.resolution});
      const {intent:current,attempt} = next;
      const run = this.#readRunRow(current.runId);
      if (current.status !== "parked" || run === undefined || run.version !== request.resolution.expectedRunVersion
        || run.lifecycle.state !== "parked-write" || run.lifecycle.writeIntentId !== current.writeIntentId
        || run.lifecycle.intentGeneration !== current.generation) throw new Error("parked-write-resolution-run-cas-mismatch");
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,recheck:_recheck,...base} = current;
      const intent = WriteIntentRecordSchema.parse({...base,status:next.status,settlement:request.settlement,
        resolvedAt:request.resolution.resolvedAt,version:current.version+1,updatedAt:request.resolution.resolvedAt,resolution:request.resolution});
      authenticateStoredWriteResolution(this.#database,intent);
      this.#replaceWriteIntent(intent);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      if (canonicalJsonStringify(this.#requireWriteAttempt(attempt.writeAttemptId)) !== canonicalJsonStringify(attempt)) throw new Error("parked-write-resolution-original-attempt-changed");
      return intent;
    });
  }

  assertCurrentExecution(input: unknown): void {
    const request = RunHeartbeatRequestSchema.pick({ runId: true, claim: true }).parse(input);
    this.withAuthorityReadSnapshot(() => this.#assertCurrentExecution(request.runId, request.claim));
  }

  #assertCurrentExecution(runId: string, claim: z.infer<typeof RunClaimTokenSchema>): void {
    const previous = this.#delegationReadSnapshot;
    this.#delegationReadSnapshot ??= { waits: new Map(), memo: newDelegationAuthenticationMemo(), invocations: new Map() };
    try {
      this.#admission.assertProfileRuntime();
      const run = this.#readRunRow(runId), held = run === undefined ? undefined : runClaim(run);
      const slot = this.authority.workerSlots.get(claim.workerId);
      if (run === undefined || held?.workerId !== claim.workerId || held.claimGeneration !== claim.claimGeneration
        || slot === undefined || slot.retiredAt !== null
        || !authenticateDescendantHome(this.authority, run, slot.workflow)) throw new WorkerControlRefusal("worker-execution-lost");

      const visited = new Set<string>();
      let current = run;
      for (;;) {
        if (visited.has(current.envelope.runId)) throw new Error("delegation-ancestry-cycle");
        visited.add(current.envelope.runId);
        if (current.envelope.parent === undefined) break;
        const edge = delegationEdgeForChild(this.authority, current.envelope.parent.runId, current.envelope.runId);
        if (edge.policy.cascadeCancel === "independent") break;
        const parent = this.authority.runs.get(current.envelope.parent.runId);
        if (parent === undefined) throw new Error("delegation-parent-unavailable");
        current = parent;
      }
    } finally { this.#delegationReadSnapshot = previous; }
  }

  #assertTerminalClaim(
    current: RunRecord,
    expectedVersion: number,
    claim: z.infer<typeof RunClaimTokenSchema>,
  ): void {
    if (current.version !== expectedVersion) {
      throw new Error(
        `run ${current.envelope.runId} is at version ${String(current.version)}, not ${String(expectedVersion)}`,
      );
    }
    const held = runClaim(current);
    if (held === undefined
      || held.workerId !== claim.workerId
      || held.claimGeneration !== claim.claimGeneration) {
      throw new Error(
        `run ${current.envelope.runId} is no longer claimed by ${claim.workerId} `
        + `at generation ${String(claim.claimGeneration)}`,
      );
    }
    this.#assertCurrentExecution(current.envelope.runId, claim);
  }

  #assertFailureMatchesRun(
    failure: FailureRecord,
    current: RunRecord,
    descriptor: AnyWorkflowDescriptor,
  ): void {
    const envelope = current.envelope;
    if (failure.runId !== envelope.runId
      || failure.traceId !== envelope.traceId
      || failure.attempt !== envelope.attempt
      || failure.workflowId !== envelope.workflow) {
      throw new Error(`failure ${failure.failureId} identity does not match current run ${envelope.runId}`);
    }
    if (descriptor.id !== envelope.workflow
      || descriptor.version !== envelope.descriptorVersion
      || descriptor.contractFingerprint !== envelope.contractFingerprint) {
      throw new Error(`failure ${failure.failureId} descriptor does not match current run ${envelope.runId}`);
    }
    if (failure.nodeId === undefined) {
      if (failure.taskId !== undefined) {
        throw new Error(`failure ${failure.failureId} carries task ${failure.taskId} without a node`);
      }
      return;
    }
    const node = descriptorRuntimeNodes(descriptor).find(({ id }) => id === failure.nodeId);
    if (node === undefined) {
      throw new Error(`failure ${failure.failureId} names node ${failure.nodeId} absent from descriptor`);
    }
    const allowedTaskIds = node.kind === "task"
      ? [node.uses.id]
      : node.kind === "transaction" ? [node.prepare.uses.id, node.commit.uses.id] : [];
    if (allowedTaskIds.length === 0 && failure.taskId !== undefined) {
      throw new Error(`failure ${failure.failureId} node ${failure.nodeId} owns no task ${failure.taskId}`);
    }
    if (allowedTaskIds.length > 0
      && (failure.taskId === undefined || !allowedTaskIds.includes(failure.taskId))) {
      throw new Error(
        `failure ${failure.failureId} task ${failure.taskId ?? "absent"} does not match `
        + `descriptor node ${failure.nodeId} (${allowedTaskIds.join(" or ")})`,
      );
    }
  }

  #assertFailureWasCurrentExecution(failure: FailureRecord, current: RunRecord): void {
    if (failure.nodeId === undefined) return;
    if (current.lifecycle.state !== "running"
      || current.lifecycle.currentNodeId !== failure.nodeId) {
      throw new Error(
        `failure ${failure.failureId} names node ${failure.nodeId}, `
        + `but run ${failure.runId} is not executing that node`,
      );
    }
  }

  #assertTerminalAuthorizationMatchesRun(
    authorization: TerminalAuthorizationRecord,
    current: RunRecord,
  ): void {
    const envelope = current.envelope;
    if (authorization.runId !== envelope.runId
      || authorization.workflowId !== envelope.workflow
      || authorization.attempt !== envelope.attempt
      || authorization.descriptorVersion !== envelope.descriptorVersion
      || authorization.contractFingerprint !== envelope.contractFingerprint) {
      throw new Error(
        `terminal authorization for ${authorization.runId} does not match current run ${envelope.runId}`,
      );
    }
  }

  #assertTerminalAuthorizationConsequence(
    authorization: TerminalAuthorizationRecord,
    run: RunRecord,
  ): void {
    const exactCommonConsequence = Number(run.version) >= Number(authorization.expectedVersion) + 1
      && Number(run.claimGeneration) === Number(authorization.claim.claimGeneration)
      && run.lifecycle.state === "terminal"
      && run.lifecycle.outcome === authorization.kind
      && run.lifecycle.endedAt === authorization.authorizedAt
      && (run.version > authorization.expectedVersion + 1 || run.updatedAt === authorization.authorizedAt);
    const exactArmConsequence = authorization.kind === "done"
      || (run.lifecycle.state === "terminal"
        && run.lifecycle.outcome === "failed"
        && run.lifecycle.failureId === authorization.failureId);
    if (run.version > authorization.expectedVersion + 1) {
      const query = invariantQueries().find(({ name }) => name === "run-completion-revisions");
      if (query === undefined) throw new Error("missing completion revision invariant");
      if (CountRowSchema.parse(this.#database.prepare(query.sql).get()).count !== 0) {
        throw new Error("run completion has an unaccounted later revision");
      }
    }
    if (!exactCommonConsequence || !exactArmConsequence) {
      throw new Error(
        `run ${authorization.runId} does not match its exact ${authorization.kind} terminal authorization consequence`,
      );
    }
  }

  #assertResultMatchesRun(
    result: RunResultRecord,
    current: RunRecord,
  ): void {
    const envelope = current.envelope;
    if (canonicalJsonStringify(result.continuation ?? null) !== canonicalJsonStringify(envelope.continuation ?? null)) throw new Error("terminal-continuation-binding-mismatch");
    validateRunContinuation(this.authority, envelope);
    if (result.runId !== envelope.runId
      || result.workflowId !== envelope.workflow
      || result.attempt !== envelope.attempt
      || result.descriptorVersion !== envelope.descriptorVersion
      || result.contractFingerprint !== envelope.contractFingerprint
      || result.configFingerprint !== envelope.configFingerprint
      || result.configSnapshotId !== envelope.configSnapshotId) {
      throw new Error(`run result ${result.runId} identity or fingerprint does not match current run ${envelope.runId}`);
    }
  }

  #assertStoredTerminalDependencies(result: RunResultRecord, current: RunRecord, depth = 0, visited = new Set<string>()): void {
    if (depth > 16 || visited.has(result.runId)) throw new Error("terminal-child-dependency-cycle-or-depth");
    visited.add(result.runId);
    const preview = readRunPreviewResult(result);
    if (preview !== undefined && !current.envelope.dryRun) throw new Error("terminal-preview-dry-run-required");
    const continuation = current.envelope.continuation === undefined ? undefined : AuthenticatedRunContinuation.authenticate(this.authority, current.envelope);
    const invocations = currentDelegationManifests(this.authority,current.envelope.runId,current.version).map(manifest => {
      const invocation = this.authority.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
      if (invocation === undefined) throw new Error("delegation-invocation-authority-unavailable");
      return invocation;
    });
    const receipts = result.dependencies.filter(dependency => dependency.state === "child-resolved" || dependency.state === "delegation-resolved");
    const receiptIds = receipts.filter(dependency => dependency.parentRunId === current.envelope.runId).map(dependency => dependency.state === "delegation-resolved" ? dependency.invocationCommandId
      : lifecycleCommandId("delegation-invocation", { runId: current.envelope.runId, attempt: current.envelope.attempt, nodeId: dependency.nodeId }));
    if (canonicalJsonStringify(invocations.map(command => command.commandId).sort()) !== canonicalJsonStringify([...receiptIds].sort())) {
      throw new Error("terminal-delegation-receipt-set-mismatch");
    }
    for (const dependency of result.dependencies) {
      if (dependency.state === "child-resolved" || dependency.state === "delegation-resolved") {
        const evidence = dependency.parentRunId === current.envelope.runId
          ? readDelegationInvocationEvidence(this.authority, dependency.state === "delegation-resolved" ? dependency.invocationCommandId
            : lifecycleCommandId("delegation-invocation", { runId: current.envelope.runId, attempt: current.envelope.attempt, nodeId: dependency.nodeId }),new Set(),dependency)
          : continuation?.delegation(String(dependency.nodeId), String(dependency.edgeId));
        if (evidence === undefined || evidence.parentRunId !== dependency.parentRunId) throw new Error("terminal-continuation-delegation-unavailable");
        if (canonicalJsonStringify(terminalDelegationDependencyRecord(evidence)) !== canonicalJsonStringify(dependency)
          || delegationJoinDisposition(evidence.manifest, evidence.children.map(member => member.run.lifecycle.state === "terminal"
            ? member.run.lifecycle.outcome : "active")) !== "satisfied") throw new Error("terminal-delegation-dependency-canonical-mismatch");
        for (const member of evidence.children) {
          if (readRunPreviewResult(member.result) !== undefined && (!current.envelope.dryRun || !member.run.envelope.dryRun
            || preview?.kind !== "delegated-dry-run-preview"
            || !preview.steps.some(step => step.nodeId === dependency.nodeId && step.state === "delegation-preview"))) throw new Error("terminal-child-preview-accounting-mismatch");
          this.#assertResultMatchesRun(member.result, member.run);
          if (terminalEvidenceResult(member.result) === undefined) this.#assertStoredTerminalDependencies(member.result, member.run, depth + 1, visited);
          else assertTerminalEvidenceOwner(this.#database, member.result);
        }
        continue;
      }
      if (dependency.state === "asserted") {

        const rows = this.#database.prepare(`
          SELECT * FROM run_checkpoints
          WHERE workflow = ? AND item_id = ? AND node_id = ? AND attempt = ? AND run_id = ?
        `).all(result.workflowId, current.envelope.itemId, dependency.nodeId, result.attempt, result.runId);
        const matching = rows.map((row) => this.#parseNativeRow("run_checkpoints",row,RunCheckpointRecordSchema))
          .filter((row) => row.assertion?.step === dependency.step
            && row.output.schemaHash === dependency.outputSchemaHash
            && deriveCheckpointOutputDigest(row.output) === dependency.outputDigest);
        if (matching.length !== 1) {
          throw new Error(
            `terminal dependency ${dependency.nodeId} is marked asserted for step ${dependency.step} `
            + `but ${String(matching.length)} marked checkpoint row(s) bind that assertion at the terminal attempt`,
          );
        }
        continue;
      }
      if (dependency.state === "not-run") {

        const executions = CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM run_checkpoints
          WHERE workflow = ? AND item_id = ? AND node_id = ? AND attempt = ?
        `).get(result.workflowId, current.envelope.itemId, dependency.nodeId, result.attempt));
        if (executions.count > 0) {
          throw new Error(
            `terminal dependency ${dependency.nodeId} is marked ${dependency.reason} `
            + "but has a stored checkpoint for the terminal attempt",
          );
        }
        continue;
      }
      if (dependency.state === "gate-resolved") {
        const gate = readContinuationGate(this.authority, current.envelope, String(dependency.nodeId));
        if (gate === undefined || canonicalJsonStringify(terminalGateDependencyRecord(dependency.nodeId, gate)) !== canonicalJsonStringify(dependency)) {
          throw new Error("terminal-gate-dependency-canonical-mismatch");
        }
        continue;
      }
      const stored = this.#readRecord(
        "run_checkpoints",
        checkpointLookupKey(
          dependency.checkpoint.workflowId,
          dependency.checkpoint.itemId,
          dependency.nodeId,
          dependency.checkpoint.attempt,
          dependency.checkpoint.claimGeneration,
        ),
        RunCheckpointRecordSchema,
      );
      if (stored === undefined) {
        throw new Error(`terminal dependency ${dependency.nodeId} has no exact stored checkpoint`);
      }
      if (stored.runId !== dependency.checkpoint.runId
        || stored.output.schemaHash !== dependency.outputSchemaHash
        || stored.descriptorVersion !== dependency.descriptorVersion
        || stored.contractFingerprint !== dependency.contractFingerprint
        || stored.implFingerprint !== dependency.implFingerprint
        || deriveCheckpointOutputDigest(stored.output) !== dependency.outputDigest
        || deriveCheckpointProvenanceDigest(stored.provenance) !== dependency.provenanceDigest
        || canonicalJsonStringify(stored.operationSources ?? null) !== canonicalJsonStringify(dependency.operationSources ?? null)) {
        throw new Error(`terminal dependency ${dependency.nodeId} does not match its exact stored checkpoint`);
      }
    }
  }

  #completionAuthorization(run: RunRecord): TerminalAuthorizationRecord | undefined {
    if (run.completion === undefined) return undefined;
    const { schemaVersion: _version, ...settlement } = run.completion;
    return TerminalAuthorizationRecordSchema.parse({ ...settlement, runId: run.envelope.runId,
      workflowId: run.envelope.workflow, attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint });
  }

  #insertFailure(record: FailureRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_failures", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_failures (id, run_id, fingerprint, code, resolution_json, resolution_version, payload_json, created_at)
        VALUES (?, ?, ?, ?, '{"status":"unresolved","version":1}', 1, ?, ?)
      `).run(record.failureId, record.runId, record.fingerprint, record.code, json, record.occurredAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertRunResult(record: RunResultRecord, terminal: RunRecord): void {
    const columns = runSettlementColumns(terminal,record);
    this.#authorityWrite("run_results", () => {
      const result = this.#database.prepare(`INSERT INTO run_results (${Object.keys(columns).join(",")})
        VALUES (${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #assertOpen(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
    this.#admission.assertLive();
    const expected = this.#admission.profileBinding;
    const actual = ProfileDatabaseBindingSchema.parse(this.#database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get());
    if (actual.installationId !== expected.installationId || actual.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
  }

  #configureConnection(): void {
    configureWritableConnection(this.#database, this.#busyTimeoutMs);
  }

  #configureReadOnlyConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA query_only = ON");
    this.#database.exec(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
  }

  #admitExistingSchema(): number {
    if (this.#readIntPragma("application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("authority database is not the HR authority store");
    const version = this.#readIntPragma("user_version");
    if (!isCurrentAuthoritySchemaVersion(version)) throw new AuthoritySchemaVersionError(version);
    if (this.#readMetaRow().schema_version !== version) throw new Error("authority schema metadata disagrees with user_version");
    return version;
  }

  #initializeSchema(existingVersion: number | undefined, _migrationOwner: string): void {
    if (existingVersion === undefined) this.#runMigrations();
  }

  #runMigrations(): void {
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) execMigrationStatement(this.#database, statement);
      const now = this.#now();
      this.#database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,?,0,?,0,'ready',?,?)")
        .run(CURRENT_AUTHORITY_SCHEMA_VERSION, now, this.#admission.profileBinding.installationId, this.#admission.profileBinding.profileId);
      const baseline = AuthorityUpgradeRecordSchema.parse({ recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline",
        fromSchemaVersion: 0, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: now });
      this.#database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,NULL,?,?)")
        .run(baseline.recordKey, baseline.upgradeId, baseline.phase, canonicalJsonStringify(baseline), now);
      this.#database.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
      this.#database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #validateReadOnlyNoMigrateDatabase(existingVersion: number | undefined): void {
    if (existingVersion === undefined) throw new Error("read-only admission requires an existing native authority");
    inspectOpenDatabase(this.#database, false);
  }

  #validateDatabase(): void {
    const migrationViolations = auditMigrationTableCoverage();
    if (migrationViolations.length > 0) throw new Error(migrationViolations.join("; "));
    inspectOpenDatabase(this.#database, true);
  }

  #tableNames(): TableName[] {
    return tableNames(this.#database);
  }

  #readMetaRow(): z.infer<typeof MetaRowSchema> {
    return readMetaRow(this.#database);
  }

  #readIntPragma(name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout"): number {
    return readIntPragma(this.#database, name);
  }

  #readTextPragma(name: "journal_mode"): string {
    return readTextPragma(this.#database, name);
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  /** Whole-store validation never runs under the write lock. */
  #validateExternalQuerySources(mode: "selector" | "mutation" = "selector", searchValidation: "all" | "progress" | "none" = "all"): void {
    if (this.#transactionMode === "authority" || this.#transactionMode === "projection") return;
    const observed = readIntPragma(this.#database, "data_version");
    if (observed === this.#validatedExternalDataVersion && observed === this.#snapshotExternalDataVersion) return;
    this.#validatedExternalDataVersion = undefined;
    try {
      validateAuthorityRecordSchemas(this.#database, searchValidation === "all");
      const violations = invariantViolations(this.#database);
      if (violations.length > 0) throw new Error("current composite authority is invalid");
      if (searchValidation !== "none") createRunSearchIndex(this.#database).validateCoverage();
    } catch (error) {
      if (mode === "mutation") throw error;
      throw new Error("run-search-index-rebuild-required", { cause: error });
    }
    this.#validatedExternalDataVersion = searchValidation !== "none" && observed === this.#snapshotExternalDataVersion
      && readIntPragma(this.#database, "data_version") === observed ? observed : undefined;
  }

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result, searchValidation: "all" | "progress" | "none" = "all"): Result {
    return withOperationProof(() => {
      if (this.#transactionDepth === 0) clearOperationProofSlots();
      this.#assertOpen();
      if (this.#transactionDepth > 0) {
        if (this.#transactionMode === "read") throw new Error(`${mode} mutation cannot run inside an authority read snapshot`);
        if (this.#transactionMode === "projection" && mode === "authority") throw new Error("authority mutation cannot run inside a projection transaction");
        const savepoint = `authority_nested_${String(this.#savepointSequence += 1)}`;
        const dirtyBefore = this.#authorityDirty;
        const callbacksBefore = this.#authorityCommitCallbacks.length;
        this.#database.exec(`SAVEPOINT ${savepoint}`);
        this.#transactionDepth += 1;
        try {
          const result = work();
          this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          try {
            this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
          } catch (rollback) { this.#failNativeClosure([error, rollback]); }
          this.#savepointRollbacks += 1;
          this.#authorityDirty = dirtyBefore;
          this.#authorityCommitCallbacks.splice(callbacksBefore);
          throw error;
        } finally { this.#transactionDepth -= 1; }
      }
      this.#admitMutation();
      const witnesses = new Map(outermostOperationProof()?.witnesses);
      if (mode === "projection") this.#withReadSnapshot(() => { this.#validateExternalQuerySources("mutation", searchValidation); });
      this.#snapshotExternalDataVersion = readIntPragma(this.#database, "data_version");
      try { this.#database.exec("BEGIN IMMEDIATE"); }
      catch (error) {
        if (error instanceof Error && "errcode" in error && error.errcode === 5) throw new AuthorityWriterBusyError({ cause: error });
        throw error;
      }
      this.#transactionDepth = 1;
      this.#transactionMode = mode;
      this.#authorityDirty = false;
      let result: Result;
      try {
        const search = createRunSearchIndex(this.#database);
        const priorSearch = search.publication();
        if (this.#logoutBatch !== undefined) {
          const operation = this.#logoutBatch.admission.assertPendingLogoutSettlementDatabase(this.#path), settlement = operation.settlement;
          const before = inspectNativeAuthority(this.#database, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint;
          if (settlement === undefined || (before !== settlement.before && !(settlement.phase === "commit-intent" && before === settlement.after))) throw new Error("profile-logout-settlement-source-changed");
        }
        result = work();
        if (this.#authorityDirty) {
          const update = this.#database.prepare("UPDATE database_states SET authority_generation=authority_generation+1,updated_at=?,search_state='invalid',search_generation=NULL WHERE id=1").run(this.#now());
          if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation singleton is missing");
          search.publishChanges(this.getMeta().authorityGeneration, this.#now(), priorSearch);
        }
        revalidateOperationProof(witnesses);
        this.#admitMutation();
        this.#assertOpen();
        if (this.#logoutBatch !== undefined) {
          const admission = this.#logoutBatch.admission, operation = admission.assertPendingLogoutSettlementDatabase(this.#path), settlement = operation.settlement;
          if (settlement === undefined) throw new Error("profile-logout-settlement-unprepared");
          const after = inspectNativeAuthority(this.#database, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint;
          if (settlement.phase === "prepared") this.#publishPendingLogout(admission, LogoutOperationSchema.parse({ ...operation, settlement: { ...settlement, phase: "commit-intent", after } }));
          else if (settlement.phase !== "commit-intent" || settlement.after !== after) throw new Error("profile-logout-settlement-postimage-changed");
          this.#assertOpen();
        }
        this.#database.exec("COMMIT");
        if (searchValidation === "none") this.#validatedExternalDataVersion = this.#snapshotExternalDataVersion;
      } catch (error) {
        try { this.#database.exec("ROLLBACK"); }
        catch (rollback) { this.#failNativeClosure([error, rollback]); }
        this.#authorityCommitCallbacks.splice(0);
        throw error;
      } finally {
        clearOperationProofSlots();
        this.#transactionDepth = 0;
        this.#transactionMode = undefined;
        this.#transactionDelegationReads = undefined;
        this.#snapshotExternalDataVersion = undefined;
        this.#authorityDirty = false;
      }
      const callbacks = this.#authorityCommitCallbacks.splice(0);
      for (const callback of callbacks) callback();
      return result;
    });
  }

  #readDelegationGroup(manifest: DelegationManifest): ReturnType<typeof authenticateDelegationGroup> {
    const memo = this.#operationDelegationReads()?.memo;
    // The memo shares proofs between authentications, so each caller gets its own copy.
    if (memo === undefined) return authenticateDelegationGroup(this.authority, manifest);
    return structuredClone(memoizedDelegationGroup(memo, manifest) ?? authenticateDelegationGroup(this.authority, manifest, new Set(), memo));
  }

  // Any row change, trigger rows included, advances total_changes() and drops every cached read; a savepoint rollback drops them too.
  #operationDelegationReads(): DelegationOperationReads | undefined {
    if (this.#delegationReadSnapshot !== undefined) return this.#delegationReadSnapshot;
    if (this.#transactionDepth === 0 || this.#transactionMode === "read") return undefined;
    const changes = z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#database.prepare("SELECT total_changes() AS count").get()).count;
    const reads = this.#transactionDelegationReads, rollbacks = this.#savepointRollbacks;
    if (reads?.changes !== changes || reads.rollbacks !== rollbacks) this.#transactionDelegationReads = { changes, rollbacks, memo: newDelegationAuthenticationMemo(), invocations: new Map() };
    return this.#transactionDelegationReads;
  }

  #readDelegationInvocations(key: string, read: () => readonly z.infer<typeof RunLifecycleCommandRecordSchema>[]) {
    const invocations = this.#operationDelegationReads()?.invocations, cached = invocations?.get(key);
    if (cached !== undefined) return structuredClone(cached);
    const commands = read();
    invocations?.set(key, structuredClone(commands));
    return commands;
  }

  #withReadSnapshot<Result>(read: () => Result): Result {
    return withOperationProof(() => {
      if (this.#transactionDepth === 0) clearOperationProofSlots();
      this.#assertOpen();
      if (this.#transactionDepth > 0) return read();

      const witnesses = new Map(outermostOperationProof()?.witnesses);
      this.#snapshotExternalDataVersion = readIntPragma(this.#database, "data_version");
      this.#database.exec("BEGIN");
      this.#transactionDepth = 1;
      this.#transactionMode = "read";
      this.#delegationReadSnapshot = { waits: new Map(), memo: newDelegationAuthenticationMemo(), invocations: new Map() };
      this.#authorityDirty = false;
      try {
        const result = read();
        revalidateOperationProof(witnesses);
        this.#assertOpen();
        this.#database.exec("COMMIT");
        return result;
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      } finally {
        clearOperationProofSlots();
        this.#transactionDepth = 0;
        this.#transactionMode = undefined;
        this.#delegationReadSnapshot = undefined;
        this.#snapshotExternalDataVersion = undefined;
        this.#authorityDirty = false;
      }
    });
  }

  #authorityWrite<Outcome extends Readonly<{ result: unknown; changes: number }>>(
    table: AuthorityTableName,
    operation: () => Outcome,
  ): Outcome["result"] {
    if (table === "database_states") throw new Error("database_states is mutated only by the generation and migration protocols");
    return this.#withTransaction("authority", () => {
      const outcome = operation();
      if (outcome.changes > 0) {
        this.#authorityDirty = true;

      }
      return outcome.result;
    });
  }

  #readRecord<Schema extends z.ZodType>(table: TableName, recordKey: string, schema: Schema): z.output<Schema> | undefined {
    if (table === "commands") {
      const row = this.#database.prepare("SELECT * FROM commands WHERE id = ?").get(recordKey);
      return row === undefined ? undefined : schema.parse(commandFromRow(row));
    }
    if (table === "runs") {
      const row = this.#database.prepare("SELECT * FROM runs WHERE id = ?").get(recordKey);
      if (row === undefined) return undefined;
      const record = runRecordFromRow(row);
      return Object.is(schema, RunRecordSchema) ? structuredClone(record) as z.output<Schema> : schema.parse(record);
    }
    if (table === "run_results") {
      const row = readRunSettlementRow(this.#database,recordKey);
      return row === undefined ? undefined : schema.parse(nativeOrdinaryRecordFromRow("run_results",row));
    }
    const key = table === "deleted_runs" ? "run_id"
      : table === "worker_pools" ? "workflow"
        : table === "auth_leases" ? "credential_key" : "id";
    const row = this.#database.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(recordKey);
    if (row === undefined) return undefined;
    if (table === "deleted_runs") return schema.parse(deletedRunFromRow(row).receipt);
    if (table === "artifacts") {
      const kind = z.object({kind:z.enum(["imported","generated","extracted"])}).parse(row).kind;
      return schema.parse(kind === "imported" ? importedArtifactFromRow(row) : kind === "generated" ? generatedArtifactFromRow(row) : extractedArtifactFromRow(row));
    }
    if (isNativeOrdinaryTable(table)) {
      const record = nativeOrdinaryRecordFromRow(table,row);
      if (table === "run_receipts") assertRefreshedReceiptSettlement(this.#database,RunEvidenceReceiptSchema.parse(record),row);
      if (table === "write_intents") { authenticateStoredWriteResolution(this.#database,record); assertConfirmationPublication(this.#database,recordKey); }
      if (table === "command_audits") authenticateStoredResolutionAudit(this.#database,record);
      return table === "run_checkpoints" && Object.is(schema, RunCheckpointRecordSchema)
        ? structuredClone(record) as z.output<Schema> : schema.parse(record);
    }
    throw new Error(`native reader is undefined for ${table}`);
  }

  #parseNativeRow<Schema extends z.ZodType>(table: NativeOrdinaryTable,row:unknown,schema:Schema):z.infer<Schema> {
    const record=nativeOrdinaryRecordFromRow(table,row);
    if(table === "run_receipts") assertRefreshedReceiptSettlement(this.#database,RunEvidenceReceiptSchema.parse(record),row);
    if(table === "write_intents") { authenticateStoredWriteResolution(this.#database,record); assertConfirmationPublication(this.#database,z.object({writeIntentId:z.string()}).parse(record).writeIntentId); }
    if(table === "command_audits")authenticateStoredResolutionAudit(this.#database,record);
    return table === "run_checkpoints" && Object.is(schema, RunCheckpointRecordSchema)
      ? structuredClone(record) as z.output<Schema> : schema.parse(record);
  }

  #insertSimpleRecord<Schema extends z.ZodType>(
    table: Exclude<AuthorityTableName, "database_states">,
    recordKey: string,
    input: unknown,
    schema: Schema,
    createdAt: string,
  ): ImmutableInsertResult<z.output<Schema>> {
    const record = schema.parse(input);
    const json = canonicalJsonStringify(record);
    return this.#authorityWrite(table, () => {
      const existing = this.#readRecord(table, recordKey, schema);
      if (existing !== undefined) {
        if (canonicalJsonStringify(existing) !== json) throw new Error(`${table} key ${recordKey} already exists with different content`);
        return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
      }
      let columns: Record<string, string | number | null>;
      if (table === "settings_snapshots") {
        const snapshot = ConfigSnapshotRecordSchema.parse(record);
        columns = { id: recordKey, revision: snapshot.revision, fingerprint: snapshot.fingerprint,
          payload_json: json, captured_at: snapshot.capturedAt };
      } else if (table === "run_delegations") {
        const delegation = DelegationManifestSchema.parse(record);
        columns = { id: recordKey, parent_run_id: delegation.parentRunId, payload_json: json, created_at: createdAt };
      } else if (table === "gate_results") {
        const gate = GateResultRecordSchema.parse(record);
        columns = { id: recordKey, run_id: gate.runId, node_id: gate.nodeId, gate_id: gate.gateId,
          payload_json: json, created_at: createdAt };
      } else throw new Error(`native immutable writer is undefined for ${table}`);
      const result = this.#database.prepare(`INSERT INTO ${table} (${Object.keys(columns).join(",")})
        VALUES (${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
      return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
    });
  }

  #listFailures(sql: string, parameter: string): readonly FailureRecord[] {
    const rows = this.#database.prepare(sql).all(parameter);
    return Object.freeze(rows.map((row) => this.#parseNativeRow("run_failures",row,FailureRecordSchema)));
  }

  #buildDiagnosticBundleRepository(): AuthorityRepositories["diagnosticBundles"] {
    const readAttachments = (sql: string, parameter: string): readonly DiagnosticAttachmentStorageRecord[] => {
      const rows = this.#database.prepare(sql).all(parameter);
      return Object.freeze(rows.map((row) => this.#parseNativeRow("diagnostic_files",row,DiagnosticAttachmentStorageRecordSchema)));
    };
    const insert = (input: unknown, publication?: Readonly<{ publish(): DiagnosticBundle; committed(): void }>) => {
        let record = DiagnosticBundleSchema.parse(input);
        let json = canonicalJsonStringify(record);
        return this.#authorityWrite("diagnostic_snapshots", () => {
          const existing = this.#readRecord("diagnostic_snapshots", record.bundleId, DiagnosticBundleSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`diagnostic bundle ${record.bundleId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          if (record.attachments.reduce((total, attachment) => total + attachment.byteLength, 0) > 50 * 1024 * 1024) throw new Error("diagnostic-bundle-size-exceeded");
          if (record.retention.kind === "ordinary") {
            const digests = new Map<string, number>();
            const include = (digest: string, bytes: number) => {
              const prior = digests.get(digest);
              if (prior !== undefined && prior !== bytes) throw new Error("diagnostic-digest-byte-length-mismatch");
              digests.set(digest, bytes);
            };
            for (const raw of this.#database.prepare(`SELECT f.digest, json_extract(f.payload_json,'$.attachment.byteLength') AS bytes
              FROM diagnostic_files f JOIN diagnostic_snapshots s ON s.id=f.snapshot_id
              WHERE s.retention_kind='ordinary' AND json_extract(s.payload_json,'$.availability.state') IS NOT 'purged'`).all()) {
              const row = z.strictObject({ digest: FingerprintSchema, bytes: z.number().int().nonnegative() }).parse(raw);
              include(row.digest, row.bytes);
            }
            for (const ref of pendingDiagnosticArtifacts(this.#admission)) include(ref.sha256, ref.bytes);
            for (const attachment of record.attachments) include(attachment.digest, attachment.byteLength);
            if ([...digests.values()].reduce((total, bytes) => total + bytes, 0) > 1024 * 1024 * 1024) throw new Error("diagnostic-ordinary-cap-exceeded");
          }
          if (publication !== undefined) {
            const prepared = record;
            record = DiagnosticBundleSchema.parse(publication.publish());
            const comparable = ({ contentDigest: _digest, attachments, ...bundle }: DiagnosticBundle) => ({ ...bundle,
              attachments: attachments.map(({ artifactId: _id, ...attachment }) => attachment) });
            if (canonicalJsonStringify(comparable(prepared)) !== canonicalJsonStringify(comparable(record))) throw new Error("diagnostic-publication-payload-mismatch");
            json = canonicalJsonStringify(record);
            this.afterAuthorityCommit(publication.committed);
          }
          const result = this.#database.prepare(`
            INSERT INTO diagnostic_snapshots
              (id, run_id, origin_kind, failure_id, content_digest, retention_kind, purge_after, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.bundleId,
            record.runId,
            record.origin.kind,
            record.origin.kind === "operator-request" ? null : record.origin.failureId,
            record.contentDigest,
            record.retention.kind,
            record.retention.kind === "ordinary" ? record.retention.purgeAfter : null,
            json,
            record.createdAt,
          );
          let changes = sqliteChanges(result.changes);
          for (const attachment of record.attachments) {
            const stored = DiagnosticAttachmentStorageRecordSchema.parse({
              bundleId: record.bundleId,
              attachment,
              createdAt: record.createdAt,
            });
            const inserted = this.#database.prepare(`
              INSERT INTO diagnostic_files
                (id, snapshot_id, artifact_id, kind, digest, sensitivity, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              `${record.bundleId}:${attachment.artifactId}`,
              record.bundleId,
              attachment.artifactId,
              attachment.kind,
              attachment.digest,
              attachment.sensitivity,
              canonicalJsonStringify(stored),
              record.createdAt,
            );
            changes += sqliteChanges(inserted.changes);
          }
          return { result: Object.freeze({ state: "inserted" as const, record }), changes };
        });
      };
    return Object.freeze({
      insert: (input: unknown) => insert(input),
      insertPrepared: (input: unknown, publication: Readonly<{ publish(): DiagnosticBundle; committed(): void }>) => insert(input, publication),
      get: (bundleId: string) => this.#readRecord("diagnostic_snapshots", bundleId, DiagnosticBundleSchema),
      listByRun: (runId: string) => {
        const rows = this.#database.prepare(`
          SELECT * FROM diagnostic_snapshots WHERE run_id = ? ORDER BY created_at, id
        `).all(RunIdSchema.parse(runId));
        return Object.freeze(rows.map((row) => this.#parseNativeRow("diagnostic_snapshots",row,DiagnosticBundleSchema)));
      },
      listAttachments: (bundleId: string) => readAttachments(
        "SELECT * FROM diagnostic_files WHERE snapshot_id = ? ORDER BY id",
        DiagnosticBundleIdSchema.parse(bundleId),
      ),
      findByArtifact: (artifactId: string) => readAttachments(
        "SELECT * FROM diagnostic_files WHERE artifact_id = ? ORDER BY id",
        ArtifactIdSchema.parse(artifactId),
      ),
      listRetentionDue: (now: string) => {
        const rows = this.#database.prepare(`
          SELECT * FROM diagnostic_snapshots
          WHERE retention_kind = 'ordinary' AND purge_after <= ?
          ORDER BY purge_after, id
        `).all(IsoInstantSchema.parse(now));
        return Object.freeze(rows.map((row) => this.#parseNativeRow("diagnostic_snapshots",row,DiagnosticBundleSchema)));
      },
      purge: (bundleId: string, now: string) => {
        const key = DiagnosticBundleIdSchema.parse(bundleId);
        const instant = IsoInstantSchema.parse(now);
        return this.#authorityWrite("diagnostic_snapshots", () => {
          const existing = this.#readRecord("diagnostic_snapshots", key, DiagnosticBundleSchema);
          if (existing === undefined) {
            return { result: DiagnosticPurgeDispositionSchema.parse("absent"), changes: 0 };
          }
          if (existing.retention.kind !== "ordinary") {
            throw new Error(`diagnostic bundle ${key} is pinned for ${existing.retention.reason} and is never purged by retention`);
          }
          if (Date.parse(existing.retention.purgeAfter) > Date.parse(instant)) {
            throw new Error(`diagnostic bundle ${key} is retained until ${existing.retention.purgeAfter}; refusing to purge it at ${instant}`);
          }
          const attachments = this.#database.prepare(
            "DELETE FROM diagnostic_files WHERE snapshot_id = ?",
          ).run(key);
          const bundle = this.#database.prepare(
            "DELETE FROM diagnostic_snapshots WHERE id = ?",
          ).run(key);
          const removed = sqliteChanges(bundle.changes);
          if (removed !== 1) throw new Error(`diagnostic bundle ${key} purge removed ${String(removed)} rows`);
          return {
            result: DiagnosticPurgeDispositionSchema.parse("purged"),
            changes: removed + sqliteChanges(attachments.changes),
          };
        });
      },
    });
  }


  #buildNotificationRepository(): AuthorityRepositories["notifications"] {
    const write = (record: NotificationRecord, mode: "insert" | "update"): void => {
      const json = canonicalJsonStringify(record);
      const result = mode === "insert"
        ? this.#database.prepare(`
            INSERT INTO notifications
              (id, actor_id, dedupe_fingerprint, status, seen_count, version, run_id, payload_json, publications_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
          `).run(
            record.notificationId, record.actorId, record.dedupeFingerprint,
            record.status, record.count, record.version, record.links.find(link => "runId" in link)?.runId ?? null, json, record.createdAt, record.updatedAt,
          )
        : this.#database.prepare(`
            UPDATE notifications
            SET status = ?, seen_count = ?, version = ?, payload_json = ?, updated_at = ?
            WHERE id = ? AND version = ?
          `).run(
            record.status, record.count, record.version, json, record.updatedAt,
            record.notificationId, record.version - 1,
          );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`notification ${record.notificationId} ${mode} affected ${String(changes)} rows`);
    };
    const findByDedupe = (actorId: string, dedupeFingerprint: string): NotificationRecord | undefined => {
      const row = this.#database.prepare(`
        SELECT * FROM notifications WHERE actor_id = ? AND dedupe_fingerprint = ?
      `).get(ActorIdSchema.parse(actorId), FingerprintSchema.parse(dedupeFingerprint));
      if (row === undefined) return undefined;
      return this.#parseNativeRow("notifications",row,NotificationRecordSchema);
    };
    return Object.freeze({
      create: (input: unknown) => {
        const record = NotificationRecordSchema.parse(input);
        const json = canonicalJsonStringify(record);
        return this.#authorityWrite("notifications", () => {
          const existing = this.#readRecord("notifications", record.notificationId, NotificationRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`notification ${record.notificationId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          write(record, "insert");
          return { result: Object.freeze({ state: "inserted" as const, record }), changes: 1 };
        });
      },
      fold: (input: unknown): NotificationRecordOutcome => {
        const request = NotificationFoldRequestSchema.parse(input);
        return this.#authorityWrite("notifications", () => {
          const existing = findByDedupe(request.actorId, request.dedupeFingerprint);
          if (existing === undefined) {
            throw new Error(`notification fold found no row for ${request.actorId} fingerprint ${request.dedupeFingerprint}`);
          }
          requireMutableNotification(existing);
          if (Date.parse(request.seenAt) < Date.parse(existing.lastSeenAt)) {
            throw new Error(`notification ${existing.notificationId} cannot fold an observation older than its last seen instant`);
          }
          const folded = NotificationRecordSchema.parse({
            ...existing,
            title: request.title,
            summary: request.summary,
            // A repeat is news again: the operator has not seen this occurrence.
            status: "unread",
            snooze: existing.snooze,
            count: existing.count + 1,
            lastSeenAt: request.seenAt,
            version: existing.version + 1,
            updatedAt: request.seenAt,
          });
          write(folded, "update");
          return {
            result: NotificationRecordOutcomeSchema.parse({ state: "folded", notification: folded }),
            changes: 1,
          };
        });
      },
      updateState: (input: unknown) => {
        const request = NotificationStateRequestSchema.parse(input);
        return this.#authorityWrite("notifications", () => {
          const existing = this.#readRecord("notifications", request.notificationId, NotificationRecordSchema);
          if (existing === undefined) throw new Error(`notification ${request.notificationId} does not exist`);
          requireMutableNotification(existing);
          if (existing.version !== request.expectedVersion) {
            throw new Error(`notification ${request.notificationId} is at version ${String(existing.version)}, not ${String(request.expectedVersion)}`);
          }
          const updated = NotificationRecordSchema.parse({
            ...existing,
            status: request.status,
            snooze: request.snooze,
            version: existing.version + 1,
            updatedAt: request.updatedAt,
          });
          write(updated, "update");
          return { result: updated, changes: 1 };
        });
      },
      collection: (actorId: string, operation: NotificationCollectionOperation) => notificationCollectionTarget(this.authority.notifications.listByActor(actorId), actorId, operation),
      get: (notificationId: string) => this.#readRecord("notifications", notificationId, NotificationRecordSchema),
      findByDedupe,
      listByActor: (actorId: string, status?: unknown) => {
        const rows = status === undefined
          ? this.#database.prepare(`
              SELECT * FROM notifications WHERE actor_id = ? ORDER BY created_at, id
            `).all(ActorIdSchema.parse(actorId))
          : this.#database.prepare(`
              SELECT * FROM notifications WHERE actor_id = ? AND status = ? ORDER BY created_at, id
            `).all(ActorIdSchema.parse(actorId), NotificationRecordSchema.shape.status.parse(status));
        return Object.freeze(rows.map((row) => this.#parseNativeRow("notifications",row,NotificationRecordSchema)));
      },
    });
  }


  #buildAuthorityRepositories(): AuthorityRepositories {
    const settings = createSettingsActivationRepositories({ database: this.#database,
      mutate: (work) => this.#authorityWrite("settings", work),
      readRecord: (table,key,schema) => this.#readRecord(table,key,schema) });
    const generated = createGeneratedArtifactRepository({ database: this.#database, mutate: (work) => this.#authorityWrite("artifacts", work) });
    const imports = createImportedArtifactRepositories({ database: this.#database,
      mutate: (work) => this.#authorityWrite("artifacts", work) });
    return Object.freeze({
      assistantModelPreference: createAssistantModelPreferenceRepository({ database: this.#database, read: work => this.#withReadSnapshot(work), mutate: (table, work) => this.#authorityWrite(table, work) }),
      assistantAuthorization: createAssistantAuthorizationRepository({ database: this.#database, mutate: (table, work) => this.#authorityWrite(table, work) }),
      workbooks: createWorkbookLibraryRepository({ database: this.#database,
        mutate: work => this.#authorityWrite("workbook_library", work),
        read: work => this.#withReadSnapshot(work) }),
      timelineEvents: createTimelineRepository({
        database: this.#database,
        read: (work) => this.#withReadSnapshot(work),
        mutate: (work) => this.#authorityWrite("timeline_events", work),
        assertOwner: (record, appending) => assertTimelineOwner(this.#database, record, appending),
      }),
      runs: this.#buildRunRepository(),
      failures: Object.freeze({
        get: (failureId: string) => this.#readRecord("run_failures", failureId, FailureRecordSchema),
        listByRun: (runId: string) => this.#listFailures(
          "SELECT * FROM run_failures WHERE run_id = ? ORDER BY created_at, id",
          RunIdSchema.parse(runId),
        ),
        listByFingerprint: (fingerprint: string) => this.#listFailures(
          "SELECT * FROM run_failures WHERE fingerprint = ? ORDER BY created_at, id",
          FailureFingerprintSchema.parse(fingerprint),
        ),
        countByFingerprint: (fingerprint: string) => CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM run_failures WHERE fingerprint = ?
        `).get(FailureFingerprintSchema.parse(fingerprint))).count,
      }),
      diagnosticBundles: this.#buildDiagnosticBundleRepository(),


      intakeSessions: imports.sessions,
      intakeManifests: imports.manifests,

      ocrExtractions: Object.freeze({
        insert: (input: unknown) => {
          const reading = OcrPageReadingSchema.parse(input);
          const stored = StoredOcrExtractionSchema.parse({ ...reading, binding: "source-bound" });
          const record = stored.extraction, key = stored.extractionId;
          const json = canonicalJsonStringify(stored);
          return this.#authorityWrite("artifacts", () => {
            const existing = this.#readRecord("artifacts", key, StoredOcrExtractionSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error("ocr-extraction-replay-conflict");
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO artifacts
                (id, kind, version, form_type, source_sha256, source_page, page_kind, page_fingerprint, source_kind, payload_json, created_at)
              VALUES (?, 'extracted', 1, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              key, record.formType, record.sourceSha256, record.sourcePage,
              record.pageKind, record.pageFingerprint, record.source.kind, json, record.readAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record: stored }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (extractionId: string) =>
          this.#readRecord("artifacts", extractionId, StoredOcrExtractionSchema),
        findBySource: (sourceSha256: string) => this.#database.prepare(`
          SELECT * FROM artifacts WHERE kind='extracted' AND source_sha256 = ? ORDER BY source_page, id
        `).all(sourceSha256).map((row) =>
          extractedArtifactFromRow(row)),
      }),
      evidenceReceipts: Object.freeze({
        insert: (input: unknown) => {
          const record = RunEvidenceReceiptSchema.parse(input);
          const json = canonicalJsonStringify(record);
          const settlement = readRunSettlementRow(this.#database,record.runId);
          if (settlement === undefined) throw new Error("receipt-current-settlement-unavailable");
          const terminal = runSettlementContext(settlement);
          assertRefreshedReceiptSettlement(this.#database,record,settlement);
          return this.#authorityWrite("run_receipts", () => {
            const existing = this.#readRecord("run_receipts", record.receiptId, RunEvidenceReceiptSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`evidence receipt ${record.receiptId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO run_receipts
                (id, run_id, settlement_version, workflow, attempt, result, confidence, failure_id, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.receiptId, record.runId, terminal.version, record.workflowId, record.attempt,
              record.result, record.confidence,
              record.failure.state === "present" ? record.failure.value : null,
              json, record.generatedAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (receiptId: string) => this.#readRecord("run_receipts", receiptId, RunEvidenceReceiptSchema),
        listByRun: (runId: string) => this.#database.prepare(`
          SELECT * FROM run_receipts WHERE run_id = ? ORDER BY id
        `).all(RunIdSchema.parse(runId)).map((row) =>
          this.#parseNativeRow("run_receipts",row,RunEvidenceReceiptSchema)),
        findByRun: (runId: string) => {
          const row = this.#database.prepare(`
            SELECT receipt.* FROM run_receipts receipt JOIN run_results settlement ON settlement.run_id=receipt.run_id
              AND settlement.settlement_version=receipt.settlement_version JOIN runs run ON run.id=settlement.run_id
            WHERE receipt.run_id=? AND ${CURRENT_RUN_SETTLEMENT_SQL}
          `).get(RunIdSchema.parse(runId));
          if (row === undefined) return undefined;
          return this.#parseNativeRow("run_receipts",row,RunEvidenceReceiptSchema);
        },
      }),
      dryRunScenarioResults: Object.freeze({
        insert: (input: unknown) => {
          const record = DryRunScenarioResultSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("dryrun_results", () => {
            const existing = this.#readRecord(
              "dryrun_results",
              record.resultId,
              DryRunScenarioResultSchema,
            );
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`dry-run scenario result ${record.resultId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            if (record.execution.state === "started") {
              const run = this.#readRecord("runs", record.execution.runId, RunRecordSchema);

              const expectedDryRun = record.execution.arm !== "live-read";
              if (run === undefined
                || run.envelope.dryRun !== expectedDryRun
                || run.envelope.workflow !== record.workflow
                || run.envelope.traceId !== record.execution.traceId) {
                throw new Error(
                  `dry-run scenario result ${record.resultId} does not match its dry-run execution`,
                );
              }
            }
            const result = this.#database.prepare(`
              INSERT INTO dryrun_results
                (id, scenario_id, workflow, subject_label, manifest_digest, verdict,
                 execution_state, run_id, trace_id, wall_time_ms, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.resultId, record.scenarioId, record.workflow, record.subjectLabel,
              record.manifestDigest, record.verdict, record.execution.state,
              record.execution.state === "started" ? record.execution.runId : null,
              record.execution.state === "started" ? record.execution.traceId : null,
              record.wallTimeMs, json, record.recordedAt,
            );
            return {
              result: Object.freeze({ state: "inserted" as const, record }),
              changes: sqliteChanges(result.changes),
            };
          });
        },
        get: (resultId: string) => this.#readRecord(
          "dryrun_results",
          resultId,
          DryRunScenarioResultSchema,
        ),
        list: () => Object.freeze(this.#database.prepare(`
          SELECT * FROM dryrun_results ORDER BY created_at, id
        `).all().map((row) =>
          this.#parseNativeRow("dryrun_results",row,DryRunScenarioResultSchema))),
      }),
      operatorXlsxExports: generated.exports,
      confirmedTransactionSources: { select: input => this.withAuthorityReadSnapshot(() => {
        this.#validateExternalQuerySources();
        const selected = selectTransactions(this.#database,input);
        const events = selected.map(record => {
          const raw = this.#database.prepare("SELECT * FROM timeline_events WHERE id=?").get(record.eventId);
          const publication = readConfirmationPublication(this.#database,record.operationId);
          if (publication === undefined) throw new Error("transaction-history-publication-missing");
          if (raw === undefined && (!authenticatedPublicationDeletion(this.#database,record.runId,publication)
            || readTimelineRun(this.#database,record.runId) !== undefined)) throw new Error("transaction-history-selection-missing");
          const event = raw === undefined ? publication.timeline : timelineEventFromRow(raw);
          if (event.payload.kind !== "operation-confirmed" || event.payload.facts.runId !== record.runId
            || event.payload.facts.confirmedAt !== record.confirmedAt || event.payload.facts.system !== record.system) throw new Error("transaction-history-selection-mismatch");
          return event;
        });
        return { events,eventIds:selected.map(record => record.eventId) };
      }) },
      runResults: Object.freeze({
        getInitialSettlement: (runId: string) => {
          const row = this.#database.prepare("SELECT settlement_version FROM run_results WHERE run_id=? ORDER BY settlement_version LIMIT 1").get(RunIdSchema.parse(runId));
          return row === undefined ? undefined : this.authority.runResults.getSettlement(runId,z.object({ settlement_version: PositiveIntSchema }).parse(row).settlement_version);
        },
        refreshedSettlementVersion: (runId: string) => {
          const row = readRunSettlementRow(this.#database,RunIdSchema.parse(runId));
          if (row === undefined) throw new Error("receipt-current-settlement-unavailable");
          const run = runSettlementContext(row);
          const prior = this.#database.prepare("SELECT 1 FROM run_results WHERE run_id=? AND settlement_version<? LIMIT 1").get(runId,run.version);
          return prior === undefined ? undefined : run.version;
        },
        get: (runId: string) => {
          const row = readRunSettlementRow(this.#database,RunIdSchema.parse(runId));
          if (row === undefined) return undefined;
          const record = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results",row));
          assertTerminalEvidenceOwner(this.#database,record,CURRENT_READERS,runSettlementContext(row));
          return record;
        },
        getSettlement: (runId: string, appliedVersion: number) => {
          const row = readRunSettlementRow(this.#database,RunIdSchema.parse(runId),PositiveIntSchema.parse(appliedVersion));
          if (row === undefined) return undefined;
          const result = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results",row));
          const run = runSettlementContext(row);
          assertTerminalEvidenceOwner(this.#database,result,CURRENT_READERS,run);
          return { run, result };
        },
      }),
      failureResolution: createFailureResolutionRepository({ database: this.#database, mutate: (work) => this.#authorityWrite("run_failures", work) }),
      startPlans: this.#buildStartPlanRepository(),
      duoCeremonyLeases: this.#buildDuoCeremonyLeaseRepository(),
      exclusiveSessionLeases: createExclusiveSessionLeaseRepository({ database: this.#database,
        read: work => this.#withReadSnapshot(work), mutate: work => this.#authorityWrite("exclusive_session_leases", work) }),
      ocrReviews: createOcrReviewRepository({ database: this.#database,
        read: work => this.#withReadSnapshot(work), mutate: (table, work) => this.#authorityWrite(table, work) }),
      workerPools: this.#buildWorkerPoolRepository(),
      workerSlots: createWorkerSlotRepository({ database: this.#database, mutate: work => this.#authorityWrite("worker_slots", work) }),
      runSessions: this.#buildRunSessionRepository(),
      commands: Object.freeze({
        listRunResumes: (runId: string, expectedVersion: number) => this.#database.prepare(`SELECT * FROM commands WHERE family='run'
          AND json_extract(request_json,'$.type')='resume' AND json_extract(request_json,'$.target.runId')=?
          AND json_extract(request_json,'$.target.expectedVersion')=? ORDER BY id`).all(RunIdSchema.parse(runId), expectedVersion)
          .map(row => CommandRequestSchema.parse(commandFromRow(row))),
        listRunBumpCommands: (runId: string) => this.#database.prepare(`SELECT * FROM commands WHERE family='run'
          AND json_extract(request_json,'$.type')='bump' AND json_extract(request_json,'$.target.runId')=? ORDER BY id`)
          .all(RunIdSchema.parse(runId)).map(row => CommandRequestSchema.parse(commandFromRow(row))),

        assertIdentity: (input: unknown, parentCommandId?: string) => this.#assertCommandIdentity(AuthorityCommandRecordSchema.parse(input), parentCommandId),
        insert: (input: unknown, parentCommandId?: string) => {
          const record = CommandRequestSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("commands", () => {
            this.#assertCommandIdentity(record, parentCommandId);
            const existing = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command id ${record.commandId} was reused with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = { changes: insertNativeCommand(this.#database, record, parentCommandId) };
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => {
          const record = this.#readRecord("commands", commandId, z.union([CommandRequestSchema, BulkParentCommandRecordSchema]));
          if (record !== undefined && "kind" in record) throw new CommandIdentityConflictError();
          return record;
        },
        getSettingsHistory: (commandId: string) => this.#readRecord("commands", commandId, CommandRequestSchema),
        findProtectedSettingsCommandIdByWriteId: (input: unknown) => {
          const { writeId, excludingCommandId } = ProtectedSettingsWriteIdLookupSchema.parse(input);
          const row = this.#database.prepare(`
            SELECT id FROM commands
            WHERE family = 'settings'
              AND id <> ?
              AND json_extract(request_json, '$.type') = 'apply-protected-settings'
              AND json_extract(request_json, '$.payload.writeId') = ?
            ORDER BY id
            LIMIT 1
          `).get(excludingCommandId, writeId);
          return row === undefined
            ? undefined
            : CommandIdSchema.parse(RecordKeyRowSchema.parse(row).id);
        },
        parentId: (commandId: string) => {
          const row = this.#database.prepare("SELECT parent_id AS parent_id FROM commands WHERE id = ?").get(commandId);
          return row === undefined ? undefined : z.strictObject({ parent_id: z.string().nullable() }).parse(row).parent_id;
        },
        acceptBulk: (input: unknown) => {
          const acceptance = BulkRunCommandAcceptanceRecordSchema.parse(input);
          const parent = BulkParentCommandRecordSchema.parse({ kind: "bulk-parent", commandId: acceptance.bulkCommandId, acceptance });
          return this.#authorityWrite("commands", () => {
            this.#assertCommandIdentity(parent);
            const existing = this.authority.commands.getBulk(parent.commandId);
            if (existing !== undefined) return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            const result = { changes: insertNativeCommand(this.#database, parent) };
            return { result: Object.freeze({ state: "inserted" as const, record: acceptance }), changes: sqliteChanges(result.changes) };
          });
        },
        getBulk: (commandId: string) => {
          const row = this.#database.prepare("SELECT * FROM commands WHERE id = ?").get(commandId);
          if (row === undefined) return undefined;
          const stored=commandFromRow(row);
          if (!("kind" in stored) || stored.kind !== "bulk-parent") throw new CommandIdentityConflictError();
          return BulkParentCommandRecordSchema.parse(stored).acceptance;
        },
        readForNotice: (commandId: string) => {
          const row = this.#database.prepare("SELECT * FROM commands WHERE id = ?").get(CommandIdSchema.parse(commandId));
          if (row === undefined) return undefined;
          const stored = commandFromRow(row);
          if (!("family" in stored)) return undefined;
          const request = CommandRequestSchema.parse(stored);
          const state = z.enum(["admitted", "executing", "succeeded", "refused", "uncertain"]).parse(z.object({ state: z.string() }).parse(row).state);
          const audit = this.authority.commandAudits.findByCommand(request.commandId);
          return audit === undefined ? { request, state } : { request, state, result: audit.result };
        },
        listBulkChildren: (bulkCommandId: string) => this.#database.prepare("SELECT id FROM commands WHERE parent_id = ? ORDER BY id").all(CommandIdSchema.parse(bulkCommandId)).map(row => {
          const child = this.authority.commands.readForNotice(RecordKeyRowSchema.parse(row).id);
          if (child === undefined) throw new Error("bulk-child-notice-missing");
          return child;
        }),
      }),
      commandAudits: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandAuditRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("command_audits", () => {
            const existing = this.#readRecord("command_audits", record.auditId, CommandAuditRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command audit ${record.auditId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO command_audits (id, command_id, code, payload_json, created_at) VALUES (?, ?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, "code" in record.result ? record.result.code : null, json, record.completedAt);
            settleNativeCommand(this.#database, record);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (auditId: string) => this.#readRecord("command_audits", auditId, CommandAuditRecordSchema),
        parkedWriteChecks: (runId: string) => this.#database.prepare(`SELECT * FROM command_audits WHERE json_extract(payload_json,'$.request.type')='check-parked-write'
          AND json_extract(payload_json,'$.request.target.runId')=? ORDER BY created_at, id`).all(RunIdSchema.parse(runId))
          .map(row => this.#parseNativeRow("command_audits", row, CommandAuditRecordSchema)),
        findSettingsHistory: (commandId: string) => {
          const rows = this.#database.prepare("SELECT * FROM command_audits WHERE command_id=? ORDER BY id").all(commandId);
          if (rows.length > 1) throw new Error("historical settings command has ambiguous audits");
          const row = rows[0];
          return row === undefined ? undefined : this.#parseNativeRow("command_audits",row,CommandAuditRecordSchema);
        },
        findByCommand: (commandId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM command_audits WHERE command_id = ? ORDER BY id
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return this.#parseNativeRow("command_audits",row,CommandAuditRecordSchema);
        },
      }),
      lifecycleJournal: Object.freeze({
        findRunResume: (runId: string, throughVersion?: number) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='resume'
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND json_extract(outcome_json,'$.result.appliedVersion')<=?
            ORDER BY CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER) DESC LIMIT 2`)
            .all(RunIdSchema.parse(runId), throughVersion ?? Number.MAX_SAFE_INTEGER);
          const row = rows[0];
          if (row === undefined) return undefined;
          const command = RunLifecycleCommandRecordSchema.parse(commandFromRow(row));
          const audit = this.authority.lifecycleJournal.findAuditByCommand(command.commandId);
          if (audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
            || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
            || z.object({ outcome_json: z.string() }).parse(row).outcome_json !== canonicalJsonStringify(audit)) throw new Error("run-resume-audit-unavailable");
          if (rows[1] !== undefined) {
            const previous = RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[1]));
            const other = this.authority.lifecycleJournal.findAuditByCommand(previous.commandId);
            if (other !== undefined && "kind" in other && other.kind === "run-lifecycle" && other.result.kind === "run" && audit.result.kind === "run"
              && other.result.appliedVersion === audit.result.appliedVersion) throw new Error("run-resume-audit-ambiguous");
          }
          return audit;
        },
        findContinuationIssue: (runId: string, appliedVersion?: number) => {
          const version = z.number().int().positive().optional().parse(appliedVersion) ?? null;
          const row = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('create','retry','resume','recover')
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND json_type(outcome_json,'$.result.continuation')='object'
            AND (? IS NULL OR json_extract(outcome_json,'$.result.appliedVersion')=?)
            ORDER BY CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER) DESC LIMIT 1`).get(RunIdSchema.parse(runId), version, version);
          if (row === undefined) return undefined;
          const command = RunLifecycleCommandRecordSchema.parse(commandFromRow(row));
          const audit = this.authority.lifecycleJournal.findAuditByCommand(command.commandId);
          if (audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
            || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("run-continuation-issue-unavailable");
          return audit;
        },
        findDelegationParentHold: (runId: string, sourceCommandId: string, appliedVersion: number) => {
          const retries = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-retry'
            AND json_extract(request_json,'$.request.sourceCommandId')=?
            AND json_extract(request_json,'$.request.continuationOwner.runId')=?`).all(sourceCommandId,runId);
          for (const row of retries) {
            const retry = RunLifecycleCommandRecordSchema.parse(commandFromRow(row));
            const command = this.authority.lifecycleJournal.getCommand(lifecycleCommandId("delegation-manual-pause",retry.commandId));
            if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "pause") continue;
            const request = CanonicalPauseRequestSchema.parse(command.request);
            const audit = this.authority.lifecycleJournal.findAuditByCommand(command.commandId);
            if (request.runId === runId && request.expectedVersion + 1 === appliedVersion && audit !== undefined && "kind" in audit
              && audit.kind === "run-lifecycle" && audit.result.kind === "run" && audit.result.runId === runId && audit.result.appliedVersion === appliedVersion
              && canonicalJsonStringify(audit.request) === canonicalJsonStringify(command)) return command;
          }
          return undefined;
        },
        findRunOrigin: (runId: string) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('create','retry','recover')
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=? ORDER BY id`).all(RunIdSchema.parse(runId));
          if (rows.length > 1) throw new Error("delegation-root-origin-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        findGatePark: (runId: string, gateId: string, throughVersion: number) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='worker-transition'
            AND json_extract(request_json,'$.request.runId')=?
            AND json_extract(request_json,'$.request.lifecycle.state')='parked-gate'
            AND json_extract(request_json,'$.request.lifecycle.gateId')=?
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER)<=? ORDER BY id`)
            .all(RunIdSchema.parse(runId), GateIdSchema.parse(gateId), RunIdSchema.parse(runId), PositiveIntSchema.parse(throughVersion));
          if (rows.length > 1) throw new Error("delegation-gate-park-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        findCancellation: (runId: string) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('transition','terminalize')
            AND json_extract(request_json,'$.request.runId')=?
            AND json_type(request_json,'$.request.cancellationSource')='object' ORDER BY id`).all(runId);
          if (rows.length > 1) throw new Error("delegation-cancellation-source-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        listDelegationRefreshes: (runId: string) => readDelegationRefreshCommands(this.#database,runId),
        listDelegationInvocations: (parentRunId: string) => this.#readDelegationInvocations(`parent:${parentRunId}`, () => this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
          AND json_extract(request_json,'$.operation')='delegation-invocation'
          AND json_extract(request_json,'$.request.runId')=? ORDER BY id`).all(parentRunId)
          .map(row => RunLifecycleCommandRecordSchema.parse(commandFromRow(row)))),
        findDelegationInvocation: (manifestId: string) => this.#readDelegationInvocations(`manifest:${manifestId}`, () => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-invocation'
            AND json_extract(request_json,'$.request.manifestId')=? ORDER BY id`).all(manifestId);
          if (rows.length > 1) throw new Error("delegation-invocation-ambiguous");
          return rows[0] === undefined ? [] : [RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]))];
        })[0],
        listDelegationAdmissions: (runId: string, claimGeneration: number) => this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle' AND target_id=?
          AND json_extract(request_json,'$.operation')='delegation-admission'
          AND json_extract(request_json,'$.request.claim.claimGeneration')=?
          ORDER BY json_extract(request_json,'$.request.expectedVersion') DESC,id`).all(runId, claimGeneration)
          .map(row => RunLifecycleCommandRecordSchema.parse(commandFromRow(row))),
        findDelegationOwner: (runId: string, claimGeneration: number, throughVersion: number) => {
          const row = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle' AND target_id=?
            AND json_extract(request_json,'$.operation')='worker-transition'
            AND json_extract(request_json,'$.request.claim.claimGeneration')=?
            AND json_extract(request_json,'$.request.lifecycle.state')='running'
            AND json_type(request_json,'$.request.lifecycle.currentNodeId')='text'
            AND json_extract(outcome_json,'$.result.appliedVersion')<=?
            ORDER BY json_extract(outcome_json,'$.result.appliedVersion') DESC LIMIT 1`).get(runId, claimGeneration, throughVersion);
          return row === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(row));
        },
        insertCommand: (input: unknown) => {
          const record = RunLifecycleCommandRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("commands", () => {
            this.#assertCommandIdentity(record);
            const existing = this.#readRecord("commands", record.commandId, AuthorityCommandRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`command id ${record.commandId} was reused with different content`);
              }
              return {
                result: Object.freeze({ state: "existing" as const, record }),
                changes: 0,
              };
            }
            const result = { changes: insertNativeCommand(this.#database, record) };
            return {
              result: Object.freeze({ state: "inserted" as const, record }),
              changes: sqliteChanges(result.changes),
            };
          });
        },
        getCommand: (commandId: string) => this.#readRecord(
          "commands",
          commandId,
          AuthorityCommandRecordSchema,
        ),
        insertAudit: (input: unknown) => {
          const record = RunLifecycleCommandAuditRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("command_audits", () => {
            const existing = this.#readRecord(
              "command_audits",
              record.auditId,
              AuthorityCommandAuditRecordSchema,
            );
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`command audit ${record.auditId} already exists with different content`);
              }
              return {
                result: Object.freeze({ state: "existing" as const, record }),
                changes: 0,
              };
            }
            const result = this.#database.prepare(`
              INSERT INTO command_audits (id, command_id, code, payload_json, created_at) VALUES (?, ?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, null, json, record.completedAt);
            settleNativeCommand(this.#database, record);
            return {
              result: Object.freeze({ state: "inserted" as const, record }),
              changes: sqliteChanges(result.changes),
            };
          });
        },
        findAuditByCommand: (commandId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM command_audits WHERE command_id = ? ORDER BY id
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return this.#parseNativeRow("command_audits",row,AuthorityCommandAuditRecordSchema);
        },
      }),
      dependencies: Object.freeze({
        authenticateGroup: (manifest: DelegationManifest) => this.#readDelegationGroup(manifest),
        parents: (envelopes: readonly RunRecord["envelope"][]) => readQueueParents(this.authority, envelopes),
        groups: (parentRunId: string, selection: "current" | "retained" = "current") => {
          const parent = this.authority.runs.get(parentRunId);
          if (parent === undefined) throw new Error("delegation-parent-unavailable");
          const own = (selection === "retained" ? retainedDelegationManifests : currentDelegationManifests)(this.authority, parentRunId)
            .map(manifest => ({ manifest, group: this.authority.dependencies.authenticateGroup(manifest) }));
          const keys = new Set(own.map(({ group }) => `${group.invocation.nodeId}/${group.invocation.edgeId}`));
          return [...own, ...continuationDelegationGroups(this.authority, parent.envelope)
            .filter(({ group }) => !keys.has(`${group.invocation.nodeId}/${group.invocation.edgeId}`))];
        },
        continuedEvidence: (parentRunId: string, nodeId: string, edgeId: string) => {
          const parent = this.authority.runs.get(parentRunId);
          if (parent === undefined) throw new Error("delegation-parent-unavailable");
          return AuthenticatedRunContinuation.authenticate(this.authority, parent.envelope).delegation(nodeId, edgeId);
        },
        waitState: (parentRunId: string) => {
          const cached = this.#delegationReadSnapshot?.waits.get(parentRunId);
          if (cached !== undefined) return cached === null ? null : { ...cached };
          const state = readDelegationWaitState(this.authority, parentRunId);
          this.#delegationReadSnapshot?.waits.set(parentRunId, state === null ? null : { ...state });
          return state;
        },
        wait: (parentRunId: string, descriptor: AnyWorkflowDescriptor) => {
          const parent = this.authority.runs.get(parentRunId);
          if (parent === undefined) throw new Error("delegation-parent-unavailable");
          return readDelegationWait(this.authority, parent, descriptor);
        },
        evidence: (parentRunId: string, nodeId: string) => readDelegationEvidence(this.authority, parentRunId, nodeId),
        lifecycleEdgeForChild: (parentRunId: string, childRunId: string) => lifecycleChildEdge(this.authority, parentRunId, childRunId),
        edgeForChild: (parentRunId: string, childRunId: string) => delegationEdgeForChild(this.authority, parentRunId, childRunId),
        cancellationOutcome: (runId: string) => readDelegationCancellation(this.authority, runId),
        childHistory: (dependencyId: string) => authenticateDelegationDependency(this.authority, dependencyId).history,
        members: (manifestId: string) => {
          const manifest = this.authority.delegationManifests.get(manifestId);
          if (manifest === undefined) throw new Error("delegation-manifest-unavailable");
          return this.authority.dependencies.authenticateGroup(manifest).children;
        },
        readiness: (parentRunId: string, intent: "join" | "cancel") => readDelegationReadiness(this.authority, parentRunId, intent),
        reconcile: (parentRunId: string, now: string) => this.withAuthorityTransaction(repositories => {
          for (const manifest of retainedDelegationManifests(repositories, parentRunId)) {
            for (const { child, dependency } of repositories.dependencies.members(manifest.manifestId)) {
              const terminal = childTerminalSettlement(child, repositories);
              if (terminal === undefined || dependency.state !== "active") continue;
              const settlement = refreshedRunSettlement(child, terminal.result);
              repositories.dependencies.settle({ commandId: lifecycleCommandId("delegation-settlement", {
                dependencyId: dependency.dependencyId, childRunId: child.envelope.runId, childAttempt: child.envelope.attempt, resultDigest: terminal.result.resultDigest, ...(settlement === undefined ? {} : { settlement }) }),
              dependencyId: dependency.dependencyId, expectedVersion: dependency.version, runId: child.envelope.runId,
              childAttempt: child.envelope.attempt, resultDigest: terminal.result.resultDigest, state: terminal.state, now, ...(settlement === undefined ? {} : { settlement }) });
            }
          }
          settleDelegationRefresh(repositories, parentRunId, now, run => this.#writeRunRow(run, "update"));
        }),
        refreshAfterRetry: (input: unknown, authorization: object, now: string) => this.withAuthorityTransaction(repositories =>
          admitDelegationRefresh(repositories, DelegationRetryRequestSchema.parse(input), authorization, now, run => this.#writeRunRow(run, "update"))),
        activateRetry: (input: unknown, now: string, refreshAuthorization?: object) => this.withAuthorityTransaction(repositories => {
          const request = DelegationRetryRequestSchema.parse(input);
          const previous = repositories.runs.get(request.previousRunId), next = repositories.runs.get(request.replacementRunId);
          if (previous === undefined || next === undefined) throw new Error("delegation-retry-run-unavailable");
          let commandId: string;
          if (request.continuationOwner === undefined) {
            const source = repositories.commands.get(request.sourceCommandId);
            if (source?.family !== "run" || source.type !== "retry" && source.type !== "recover-run") throw new Error("delegation-retry-source-unavailable");
            commandId = lifecycleCommandId(source.type === "recover-run" ? "operator-recover-run" : "operator-retry", request.sourceCommandId);
          } else commandId = lifecycleCommandId("continuation-child-retry", { ownerRunId: request.continuationOwner.runId, previousRunId: request.previousRunId });
          const proof = prepareDelegationRetry(repositories, previous, { sourceCommandId: request.sourceCommandId,
            commandId, refreshAuthorization,
            ...(request.continuationOwner === undefined ? {} : { continuationOwner: request.continuationOwner }) });
          const dependency = proof.child.dependency;
          assertDelegationReplacement(this.authority, proof.child.original, previous, next);
          if (request.commandId !== lifecycleCommandId("delegation-retry", { dependencyId: dependency.dependencyId, previousRunId: previous.envelope.runId })
            || request.expectedVersion !== dependency.version || request.parentVersion !== proof.parent.version
            || request.invocationCommandId !== proof.group.invocation.commandId || request.manifestId !== proof.group.manifest.manifestId
            || request.dependencyId !== dependency.dependencyId || request.originalRunId !== proof.child.original.envelope.runId
            || request.originalAttempt !== proof.child.original.envelope.attempt || request.previousAttempt !== previous.envelope.attempt
            || request.resultDigest !== proof.terminal.result.resultDigest || request.replacementAttempt !== next.envelope.attempt
            || request.planFingerprint !== proof.group.manifest.manifestFingerprint || canonicalJsonStringify(request.policy) !== canonicalJsonStringify(dependency.policy)
            || next.envelope.retryOf !== previous.envelope.runId || next.lifecycle.state !== "queued" || next.version !== 1) throw new Error("delegation-retry-binding-mismatch");
          const { settlement: _settlement, ...withoutSettlement } = dependency;
          const record = DependencyRecordSchema.parse({ ...withoutSettlement, state: "active", version: dependency.version + 1, updatedAt: now });
          this.#authorityWrite("delegation_dependencies", () => {
            const changes = sqliteChanges(this.#database.prepare("UPDATE delegation_dependencies SET payload_json=? WHERE id=? AND payload_json=?")
              .run(canonicalJsonStringify(record), dependency.dependencyId, canonicalJsonStringify(dependency)).changes);
            if (changes !== 1) throw new Error("delegation-dependency-cas-conflict");
            return { result: undefined, changes };
          });
        }),
        settle: (input: unknown) => this.withAuthorityTransaction(repositories => {
          const request = DelegationSettlementRequestSchema.parse(input), current = repositories.dependencies.get(request.dependencyId);
          if (current === undefined) throw new Error("delegation-dependency-unavailable");
          const manifest = repositories.delegationManifests.get(current.manifestId);
          if (manifest === undefined) throw new Error("delegation-manifest-unavailable");
          const selected = repositories.dependencies.authenticateGroup(manifest).children.find(child => child.dependency.dependencyId === request.dependencyId);
          if (selected === undefined || selected.child.envelope.runId !== request.runId || selected.child.envelope.attempt !== request.childAttempt) throw new Error("delegation-settlement-child-mismatch");
          const terminal = childTerminalSettlement(selected.child, repositories);
          if (terminal === undefined || terminal.state !== request.state || terminal.result.resultDigest !== request.resultDigest
            || request.commandId !== lifecycleCommandId("delegation-settlement", { dependencyId: request.dependencyId,
              childRunId: request.runId, childAttempt: request.childAttempt, resultDigest: request.resultDigest, ...(request.settlement === undefined ? {} : { settlement: request.settlement }) })) throw new Error("delegation-settlement-evidence-mismatch");
          const fingerprint = sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-settlement\0${canonicalJsonStringify(request)}`);
          const previous = repositories.lifecycleJournal.getCommand(request.commandId);
          if (previous !== undefined) {
            const audit = repositories.lifecycleJournal.findAuditByCommand(request.commandId);
            if (!("kind" in previous) || previous.kind !== "run-lifecycle" || previous.operation !== "delegation-settlement"
              || previous.requestFingerprint !== fingerprint || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
              || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(previous)
              || current.version !== request.expectedVersion + 1 || current.state !== request.state) throw new Error("delegation-settlement-replay-divergent");
            return current;
          }
          if (current.version !== request.expectedVersion || current.state !== "active") throw new Error("delegation-dependency-cas-conflict");
          const expectedSettlement = refreshedRunSettlement(selected.child, terminal.result);
          if (canonicalJsonStringify(request.settlement ?? null) !== canonicalJsonStringify(expectedSettlement ?? null)) throw new Error("delegation-settlement-version-mismatch");
          const record = DependencyRecordSchema.parse({ ...current, state: request.state, ...(request.settlement === undefined ? {} : { settlement: request.settlement }), version: current.version + 1, updatedAt: request.now });
          this.#authorityWrite("delegation_dependencies", () => {
            const changes = sqliteChanges(this.#database.prepare("UPDATE delegation_dependencies SET payload_json=? WHERE id=? AND payload_json=?")
              .run(canonicalJsonStringify(record), current.dependencyId, canonicalJsonStringify(current)).changes);
            if (changes !== 1) throw new Error("delegation-dependency-cas-conflict");
            return { result: undefined, changes };
          });
          const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", operation: "delegation-settlement", commandId: request.commandId,
            request, requestFingerprint: fingerprint, fence: { kind: "version", expectedVersion: request.expectedVersion }, recordedAt: request.now });
          repositories.lifecycleJournal.insertCommand(command);
          repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId: request.commandId, request: command,
            result: { kind: "run", runId: selected.child.envelope.runId, appliedVersion: selected.child.version }, completedAt: request.now });
          return record;
        }),
        insert: (input: unknown) => {
          const record = DependencyRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("delegation_dependencies", () => {
            const existing = this.#readRecord("delegation_dependencies", record.dependencyId, DependencyRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`dependency ${record.dependencyId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO delegation_dependencies (id, delegation_id, payload_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.dependencyId, record.manifestId, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (dependencyId: string) => this.#readRecord("delegation_dependencies", dependencyId, DependencyRecordSchema),
        listByParentRun: (parentRunId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM delegation_dependencies
            WHERE json_extract(payload_json, '$.parentRunId') = ?
            ORDER BY created_at, id
          `).all(RunIdSchema.parse(parentRunId));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("delegation_dependencies",row,DependencyRecordSchema)));
        },
      }),
      delegationManifests: Object.freeze({
        listByParentRun: (parentRunId: string) => Object.freeze(this.#database.prepare(`SELECT * FROM run_delegations WHERE parent_run_id=? ORDER BY created_at,id`)
          .all(RunIdSchema.parse(parentRunId)).map(row => this.#parseNativeRow("run_delegations", row, DelegationManifestSchema))),
        insert: (input: unknown) => {
          const record = DelegationManifestSchema.parse(input);
          return this.#insertSimpleRecord("run_delegations", record.manifestId, record, DelegationManifestSchema, record.createdAt);
        },
        get: (manifestId: string) => this.#readRecord("run_delegations", manifestId, DelegationManifestSchema),
      }),
      gateResults: Object.freeze({
        insert: (input: unknown) => {
          const record = GateResultRecordSchema.parse(input);
          return this.#insertSimpleRecord("gate_results", `${record.runId}:${record.gateId}`, record, GateResultRecordSchema, record.resolvedAt);
        },
        get: (recordKey: string) => this.#readRecord("gate_results", recordKey, GateResultRecordSchema),
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM gate_results
            WHERE json_extract(payload_json, '$.runId') = ?
            ORDER BY created_at, id
          `).all(RunIdSchema.parse(runId));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("gate_results",row,GateResultRecordSchema)));
        },
      }),
      runCheckpoints: Object.freeze({
        insert: (input: unknown) => {
          const record = RunCheckpointRecordSchema.parse(input);
          const claimGeneration = record.claimGeneration;
          const json = canonicalJsonStringify(record);
          const recordKey = checkpointRecordKey(record);
          return this.#authorityWrite("run_checkpoints", () => {
            const existing = this.#readRecord("run_checkpoints", recordKey, RunCheckpointRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`run checkpoint ${recordKey} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO run_checkpoints
                (id, workflow, item_id, node_id, attempt, claim_generation, run_id, output_digest, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              recordKey, record.workflowId, record.itemId, record.nodeId,
              record.attempt, claimGeneration, record.runId, deriveCheckpointOutputDigest(record.output), json, record.writtenAt,
            );
            const now = this.#clock.now();
            this.authority.timelineEvents.append({ schemaVersion: 1,
              eventId: deriveStableUuid("timeline-checkpoint-recorded", recordKey),
              workflow: record.workflowId, scope: { kind: "run", runId: record.runId },
              occurredAt: record.writtenAt, recordedAt: now.toISOString(), retentionDate: localDatePart(now),
              source: { kind: "native" }, payload: { kind: "checkpoint-recorded", runId: record.runId,
                workflow: record.workflowId, attempt: record.attempt, claimGeneration,
                checkpoint: timelineCheckpointReference(record) },
            });
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (
          workflowId: string,
          itemId: string,
          nodeId: string,
          attempt: number,
          claimGeneration: number,
        ) => this.#readRecord(
          "run_checkpoints",
          checkpointLookupKey(workflowId, itemId, nodeId, attempt, claimGeneration),
          RunCheckpointRecordSchema,
        ),
        latest: (workflowId: string, itemId: string, nodeId: string) => {
          const row = this.#database.prepare(`
            SELECT * FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND node_id = ?
            ORDER BY attempt DESC, claim_generation DESC LIMIT 1
          `).get(workflowId, itemId, nodeId);
          if (row === undefined) return undefined;
          return this.#parseNativeRow("run_checkpoints",row,RunCheckpointRecordSchema);
        },
        /** Every execution of `(item, node, attempt)`, in the order they ran. */
        listByAttempt: (workflowId: string, itemId: string, nodeId: string, attempt: number) => {
          const rows = this.#database.prepare(`
            SELECT * FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND node_id = ? AND attempt = ?
            ORDER BY claim_generation
          `).all(WorkflowIdSchema.parse(workflowId), ItemIdSchema.parse(itemId), nodeId, attempt);
          return Object.freeze(rows.map((row) => this.#parseNativeRow("run_checkpoints",row,RunCheckpointRecordSchema)));
        },
        listByItem: (workflowId: string, itemId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM run_checkpoints
            WHERE workflow = ? AND item_id = ?
            ORDER BY attempt, claim_generation, node_id
          `).all(WorkflowIdSchema.parse(workflowId), ItemIdSchema.parse(itemId));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("run_checkpoints",row,RunCheckpointRecordSchema)));
        },
      }),
      notifications: this.#buildNotificationRepository(),
      ...createNotificationMetadataRepositories({ database: this.#database, mutate: (table, work) => {
        if (this.#transactionDepth === 0 || this.#transactionMode !== "authority") throw new Error("notification-metadata-transaction-required");
        return this.#authorityWrite(table, work);
      } }),
      configSnapshots: Object.freeze({
        insert: (input: unknown) => {
          const record = ConfigSnapshotWriteSchema.parse(input);
          return this.#insertSimpleRecord("settings_snapshots", record.configSnapshotId, record, ConfigSnapshotRecordSchema, record.capturedAt);
        },
        get: (snapshotId: string) => this.#readRecord("settings_snapshots", snapshotId, ConfigSnapshotRecordSchema),
      }),
      settingsCurrent: settings.settingsCurrent,
      runtimeConfig: settings.runtimeConfig,
      deletedRuns: Object.freeze({
        get: (runId: string) => this.#readRecord("deleted_runs", RunIdSchema.parse(runId), DeletedRunRecordSchema),
        list: () => {
          const rows = this.#database.prepare(
            "SELECT * FROM deleted_runs ORDER BY deleted_at, run_id",
          ).all();
          return Object.freeze(rows.map((row) => deletedRunFromRow(row).receipt));
        },
      }),
      writeIntents: Object.freeze({
        getPublication:(id:string)=> { assertConfirmationPublication(this.#database,id); return readConfirmationPublication(this.#database,id); },
        authenticatedDeletion:(runId:string,publication:ConfirmationPublication)=>authenticatedPublicationDeletion(this.#database,runId,publication),
        listByBusinessKey: (system: unknown, digest: unknown) => {
          const rows = this.#database.prepare(`
            SELECT * FROM write_intents WHERE system = ? AND
              (json_extract(payload_json, '$.idempotencyKeyDigest') = ? OR
               json_extract(payload_json, '$.occurrence.businessKeyDigest') = ?)
            ORDER BY id
          `).all(BrowserSystemIdSchema.parse(system), FingerprintSchema.parse(digest), FingerprintSchema.parse(digest));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("write_intents",row,WriteIntentRecordSchema)));
        },
        recordObservedPresent: (input: unknown) => {
          const record = WriteIntentRecordSchema.parse(input);
          if (record.status !== "observed-present") {
            throw new Error(`recordObservedPresent requires observed-present status, received ${record.status}`);
          }
          return this.withAuthorityTransaction(() => {
            this.#assertBusinessWriteAdmission(record);
            const existing = this.#findPermanentWriteIntent(record.system, record.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(record);
            return PermanentWriteResolutionSchema.parse({ state: "recorded-observed-present", intent: record });
          });
        },
        fenceAttempt: (input: unknown) => {
          const { intent, attempt, claim } = WriteFenceInputSchema.parse(input);
          if (intent.status !== "attempting") throw new Error("write fence requires an attempting intent");
          return this.withAuthorityTransaction(() => {
            this.#assertBusinessWriteAdmission(intent);
            const refusal = this.#writeFenceRefusal(intent, claim);
            if (refusal !== undefined) return PermanentWriteResolutionSchema.parse({ state: "refused", refusal });
            const existing = this.#findPermanentWriteIntent(intent.system, intent.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(intent);
            this.#insertWriteAttempt(attempt);
            return PermanentWriteResolutionSchema.parse({ state: "fenced", intent, attempt });
          });
        },
        refenceRetryable: (input: unknown) => {
          const { expectedVersion, intent, attempt, claim } = WriteRefenceInputSchema.parse(input);
          if (intent.status !== "attempting") {
            throw new Error(`re-fence of ${intent.writeIntentId} must present an attempting intent, not ${intent.status}`);
          }
          return this.withAuthorityTransaction(() => {
            const refusal = this.#writeFenceRefusal(intent, claim);
            if (refusal !== undefined) return PermanentWriteResolutionSchema.parse({ state: "refused", refusal });
            const stored = this.#readWrite(intent.writeIntentId, {});
            if (canonicalJsonStringify(stored.intent.status === "observed-present" ? null : stored.intent.occurrence ?? null)
              !== canonicalJsonStringify(intent.occurrence ?? null)) {
              throw new Error("re-fence may not change permanent occurrence authorization");
            }
            this.#assertBusinessWriteAdmission(intent);
            const next = applyWriteTransition(stored.intent, stored.attempt, { type: "refence" });
            const current = next.intent;
            if (current.version !== expectedVersion) {
              throw new Error(`write intent ${intent.writeIntentId} is at version ${String(current.version)}, not ${String(expectedVersion)}; the re-fence is stale`);
            }
            if (intent.status !== next.status || attempt.outcome.state !== next.outcome) {
              throw new Error(`re-fence of ${intent.writeIntentId} must present a ${next.status}/${next.outcome} write`);
            }
            if (intent.generation !== current.generation + 1) {
              throw new Error(`re-fence of ${intent.writeIntentId} must advance generation ${String(current.generation)} by exactly one, not to ${String(intent.generation)}`);
            }
            for (const [field, currentValue, nextValue] of [
              ["system", current.system, intent.system],
              ["idempotencyKey", current.idempotencyKey, intent.idempotencyKey],
              ["idempotencyKeyDigest", current.idempotencyKeyDigest, intent.idempotencyKeyDigest],
              ["workflowId", current.workflowId, intent.workflowId],
              ["itemId", current.itemId, intent.itemId],
              ["taskId", current.taskId, intent.taskId],
              ["createdAt", current.createdAt, intent.createdAt],
            ] as const) {
              if (currentValue !== nextValue) {
                throw new Error(`re-fence of ${intent.writeIntentId} may not change permanent ${field}`);
              }
            }
            if (intent.version !== current.version + 1) {
              throw new Error(`re-fence of ${intent.writeIntentId} must advance version ${String(current.version)} by exactly one`);
            }
            if (canonicalJsonStringify(intent.bindingProof) === canonicalJsonStringify(current.bindingProof)) {
              throw new Error(`re-fence of ${intent.writeIntentId} must carry a FRESH binding proof; reusing generation ${String(current.generation)}'s proof is refused`);
            }
            this.#replaceWriteIntent(intent);
            this.#insertWriteAttempt(attempt);
            return PermanentWriteResolutionSchema.parse({ state: "fenced", intent, attempt });
          });
        },
        requestRecheck: (input: unknown) => {
          const request = WriteRecheckRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const { intent: current, attempt } = this.#readWrite(request.writeIntentId, { generation: request.generation, version: request.expectedVersion });
            if (current.status !== "parked" || current.recheck !== undefined) throw new Error("parked-write-recheck-parked-intent-required");
            const run = this.#readRunRow(current.runId);
            if (run?.lifecycle.state !== "parked-write" || run.version !== request.recheck.expectedRunVersion
              || run.lifecycle.writeIntentId !== current.writeIntentId || run.lifecycle.intentGeneration !== current.generation) throw new Error("parked-write-recheck-run-mismatch");
            const intent = WriteIntentRecordSchema.parse({ ...current, recheck: request.recheck,
              version: current.version + 1, updatedAt: request.recheck.requestedAt });
            authenticateParkedWriteRecheck(intent, attempt,
              this.authority.commands.get(request.recheck.commandId), this.authority.commandAudits.get(request.recheck.auditId));
            this.#replaceWriteIntent(intent);
            return intent;
          });
        },
        parkRecheck: (input: unknown) => {
          const request = WriteRecheckParkRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const { intent: current } = this.#readWrite(request.writeIntentId, { generation: request.generation, version: request.expectedVersion });
            if (current.status !== "parked" || current.recheck?.commandId !== request.commandId) throw new Error("parked-write-recheck-request-mismatch");
            const { recheck: _recheck, ...base } = current;
            const intent = WriteIntentRecordSchema.parse({ ...base, parkedCode: request.code, message: request.message,
              authorityReason: request.authorityReason, version: current.version + 1, updatedAt: request.now });
            this.#replaceWriteIntent(intent);
            return intent;
          });
        },
        parkAttempt: (input: unknown) => {
          const request = WriteIntentParkRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const next = this.#transitionWrite(request.writeIntentId, { generation: request.generation, version: request.expectedVersion },
              { type: "park", code: request.code });
            const { intent: current, attempt: currentAttempt } = next;
            const parked = WriteIntentRecordSchema.parse({
              ...current,
              status: next.status,
              parkedCode: request.code,
              message: request.message,
              authorityReason: request.authorityReason,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const parkedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: {
                state: next.outcome,
                code: request.code,
                message: request.message,
                authorityReason: request.authorityReason,
              },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(parked);
            this.#replaceWriteAttempt(parkedAttempt);
            return parked;
          });
        },
        settleRetryable: (input: unknown) => {
          const request = WriteIntentRetrySettlementRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const next = this.#transitionWrite(request.writeIntentId, { generation: request.generation, version: request.expectedVersion },
              { type: "settle-safe-to-retry" });
            const { intent: current, attempt: currentAttempt } = next;
            const { parkedCode: _parkedCode, message: _message, authorityReason: _authorityReason, ...base } = {
              parkedCode: undefined,
              message: undefined,
              authorityReason: undefined,
              ...current,
            };
            const retryable = WriteIntentRecordSchema.parse({
              ...base,
              status: next.status,
              settlement: request.settlement,
              resolvedAt: request.now,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const settledAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: next.outcome, settlement: request.settlement },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(retryable);
            this.#replaceWriteAttempt(settledAttempt);
            return retryable;
          });
        },
        get: (writeIntentId: string) => this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema),
        findByPermanentKey: (system: unknown, idempotencyKey: unknown) => this.#findPermanentWriteIntent(
          BrowserSystemIdSchema.parse(system),
          IdempotencyKeySchema.parse(idempotencyKey),
        ),
        listAttemptingByItem: (input: unknown) => {
          const request = z.strictObject({ workflowId: WorkflowIdSchema, itemId: ItemIdSchema }).parse(input);
          const rows = this.#database.prepare(`
            SELECT * FROM write_intents
            WHERE status = 'attempting'
              AND json_extract(payload_json, '$.workflowId') = ?
              AND json_extract(payload_json, '$.itemId') = ?
            ORDER BY id
          `).all(request.workflowId, request.itemId);
          return Object.freeze(rows.map((row) => {
            const intent = this.#parseNativeRow("write_intents",row,WriteIntentRecordSchema);
            if (intent.status !== "attempting") throw new Error("attempting intent index disagrees with its record");
            return intent;
          }));
        },
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM write_intents
            WHERE json_extract(payload_json, '$.runId') = ?
            ORDER BY created_at, id
          `).all(RunIdSchema.parse(runId));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("write_intents",row,WriteIntentRecordSchema)));
        },
        countDryRunEvidenceByRun: (runId: string) => {
          const parsedRunId = RunIdSchema.parse(runId);
          const count = (sql: string): number => CountRowSchema.parse(
            this.#database.prepare(sql).get(parsedRunId),
          ).count;
          return DryRunWriteSafetyCountsSchema.parse({
            writeIntents: count(`
              SELECT count(*) AS count FROM write_intents
              WHERE json_extract(payload_json, '$.runId') = ?
            `),
            writeAttempts: count(`
              SELECT count(*) AS count FROM write_attempts AS attempt
              JOIN write_intents AS intent ON intent.id = attempt.intent_id
              WHERE json_extract(intent.payload_json, '$.runId') = ?
            `),
            confirmedOperations: count(`
              SELECT count(*) AS count FROM timeline_events
              WHERE run_id = ? AND json_extract(payload_json, '$.payload.kind') = 'operation-confirmed'
            `),
          });
        },
      }),
      writeAttempts: Object.freeze({
        get: (writeAttemptId: string) => this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema),
        listByIntent: (writeIntentId: string) => {
          const rows = this.#database.prepare(`
            SELECT * FROM write_attempts WHERE intent_id = ? ORDER BY generation
          `).all(WriteIntentIdSchema.parse(writeIntentId));
          return Object.freeze(rows.map((row) => this.#parseNativeRow("write_attempts",row,WriteAttemptRecordSchema)));
        },
      }),

      generatedArtifacts: generated,
      artifactOutbox: generated.outbox,
      artifactSinkHeads: generated.heads,
    });
  }

  #readRunRow(runId: string): RunRecord | undefined {
    return this.#readRecord("runs", runId, RunRecordSchema);
  }


  #nextItemAttempt(workflow: string, itemId: string): number {
    const row = MaxAttemptRowSchema.parse(this.#database.prepare(`
      SELECT max(attempt) AS attempt FROM (
        SELECT attempt FROM runs WHERE workflow = ? AND item_id = ?
        UNION ALL
        SELECT attempt FROM deleted_runs WHERE workflow = ? AND item_id = ?
      )
    `).get(WorkflowIdSchema.parse(workflow), ItemIdSchema.parse(itemId), workflow, itemId));
    const highest = row.attempt;
    if (highest === null) return 1;
    return highest + 1;
  }


  #nextWorkflowRunNumber(workflow: string): number {
    const row = MaxRunNumberRowSchema.parse(this.#database.prepare(`
      SELECT max(run_number) AS run_number FROM (
        SELECT run_number FROM runs WHERE workflow = ?
        UNION ALL
        SELECT run_number FROM deleted_runs WHERE workflow = ?
      )
    `).get(WorkflowIdSchema.parse(workflow), workflow));
    const highest = row.run_number;
    if (highest === null) return 1;
    return highest + 1;
  }

  #writeRunRow(record: RunRecord, mode: "insert" | "update"): void {
    const columns = runRecordColumns(record);
    const entries = Object.entries(columns).filter(([key]) => mode === "insert" || key !== "id");
    const keys = entries.map(([key]) => key);
    const values = entries.map(([, value]) => value);
    this.#authorityWrite("runs", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...values)
        : { changes: updateRunRecord(this.#database, record) };
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`run ${record.envelope.runId} ${mode} affected ${String(changes)} rows`);
      this.#lifecycleHooks?.afterRunWrite?.(record);
      return { result: undefined, changes };
    });
  }


  #mutateRun(
    runId: string,
    expectedVersion: number,
    now: string,
    claim: z.infer<typeof RunClaimTokenSchema> | undefined,
    next: (current: RunRecord) => RunRecord,
  ): RunUpdateOutcome {
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(runId);
      if (current === undefined) throw new Error(`run ${runId} does not exist`);
      if (current.version !== expectedVersion) {
        return RunUpdateOutcomeSchema.parse({
          state: "conflict",
          currentVersion: current.version,
          currentState: current.lifecycle.state,
          message: `run ${runId} is at version ${String(current.version)}, not ${String(expectedVersion)}`,
        });
      }
      if (claim !== undefined) {
        const held = runClaim(current);
        if (held === undefined
          || held.workerId !== claim.workerId
          || held.claimGeneration !== claim.claimGeneration) {
          return RunUpdateOutcomeSchema.parse({
            state: "conflict",
            currentVersion: current.version,
            currentState: current.lifecycle.state,
            message: `run ${runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`,
          });
        }
      }
      const candidate = next(current);
      const updated = transitionRunRecord(current, candidate, now);
      this.#writeRunRow(updated, "update");
      return RunUpdateOutcomeSchema.parse({ state: "applied", run: updated });
    });
  }

  #claimNextRun(input: unknown, canonical: false): RunClaimOutcome;
  #claimNextRun(input: unknown, canonical: true, admit?: (run: RunRecord) => void, eligible?: (run: RunRecord) => boolean): CanonicalRunClaimOutcome;
  #claimNextRun(input: unknown, canonical: boolean, admit?: (run: RunRecord) => void, eligible?: (run: RunRecord) => boolean): CanonicalRunClaimOutcome {
    const request = RunClaimRequestSchema.parse(input);
    if (canonical && request.runtimeConfig === undefined) {
      return { state: "refused", refusal: { reason: "runtime-stale" } };
    }
    return this.withAuthorityTransaction((): CanonicalRunClaimOutcome => {
      if (this.#runAdmission().state !== "open") return { state: "idle" };
      const slot = this.authority.workerSlots.get(request.workerId);
      // A paused worker takes no run; the pause commit and this claim serialize in SQLite.
      if (slot === undefined || slot.retiredAt !== null || slot.workflow !== request.workflow || slot.paused) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-claim-membership-unavailable");
      }
      if (request.runtimeConfig !== undefined) {
        if (!this.authority.runtimeConfig.matchesClaim(request.runtimeConfig)) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error("dashboard runtime settings are stale; restart activation is required");
        }
      }

      const held = HeldRunRowSchema.parse(this.#database.prepare(`
        SELECT id AS run_id FROM runs
        WHERE owner_worker_id = ? AND state IN ('claimed', 'validating', 'running')
        LIMIT 1
      `).get(request.workerId) ?? { run_id: null });
      if (held.run_id !== null) {
        if (canonical) return { state: "refused", refusal: { reason: "worker-busy", runId: RunIdSchema.parse(held.run_id) } };
        throw new Error(`worker ${request.workerId} already holds active run ${held.run_id}`);
      }
      const candidates = eligible === undefined
        ? this.#database.prepare(`SELECT * FROM runs WHERE workflow=? AND state='queued' AND pause_state IS NULL
          ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id`).all(request.workflow)
        : this.#database.prepare(`SELECT * FROM runs WHERE state='queued' AND pause_state IS NULL
          ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id`).all();
      let current: RunRecord | undefined;
      let nextEligibleAt: string | undefined;
      for (const row of candidates) {
        const candidate = runRecordFromRow(row);
        if (eligible !== undefined && (!authenticateDescendantHome(this.authority, candidate, slot.workflow) || !eligible(candidate))) continue;
        if (candidate.envelope.continuation !== undefined && continuationDelegationGroups(this.authority, candidate.envelope)
          .some(({ group }) => group.children.some(({ child }) => child.lifecycle.state !== "terminal"))) continue;
        authenticateDelegationRefresh(this.authority, candidate);
        this.authority.dependencies.reconcile(candidate.envelope.runId, request.now);
        const reconciled = this.authority.runs.get(candidate.envelope.runId);
        if (reconciled?.delegationRefresh?.phase === "waiting") continue;
        if (this.authority.dependencies.readiness(candidate.envelope.runId, candidate.cancelRequested === true ? "cancel" : "join").state !== "ready") continue;
        const notBefore = candidate.lifecycle.state === "queued" ? candidate.lifecycle.notBefore : undefined;
        if (notBefore !== undefined && Date.parse(notBefore) > Date.parse(request.now)) {
          if (nextEligibleAt === undefined || Date.parse(notBefore) < Date.parse(nextEligibleAt)) nextEligibleAt = notBefore;
          continue;
        }
        current = reconciled ?? candidate;
        break;
      }
      if (current === undefined) return RunClaimOutcomeSchema.parse(nextEligibleAt === undefined
        ? { state: "idle" } : { state: "deferred", nextEligibleAt });
      if (request.configFingerprint !== undefined) {
        if (!this.authority.runtimeConfig.matchesRun(request.configFingerprint, current.envelope.configFingerprint)) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error(
            `queued run ${current.envelope.runId} config fingerprint `
            + `${current.envelope.configFingerprint} does not match worker boot `
            + request.configFingerprint,
          );
        }
        const snapshot = this.#readRecord(
          "settings_snapshots",
          current.envelope.configSnapshotId,
          ConfigSnapshotRecordSchema,
        );
        if (snapshot === undefined
          || snapshot.fingerprint !== current.envelope.configFingerprint) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error(
            `queued run ${current.envelope.runId} does not bind an exact stored config snapshot `
            + `${current.envelope.configSnapshotId}`,
          );
        }
      }
      if (canonical) this.#lifecycleHooks?.afterClaimSelection?.();
      admit?.(current);
      const selected = this.#readRunRow(current.envelope.runId);
      if (this.#runAdmission().state !== "open" || selected?.version !== current.version
        || interruptTransition(selected, { kind: "lifecycle", to: "claimed" }).state === "refused") {
        return canonical ? { state: "refused", refusal: { reason: "none-eligible" } } : { state: "idle" };
      }
      const claimed = RunRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "claimed",
          workerId: request.workerId,
          claimedAt: request.now,
          heartbeatAt: request.now,
        },
        claimGeneration: current.claimGeneration + 1,
        version: current.version + 1,
        updatedAt: request.now,
      });
      this.#writeRunRow(claimed, "update");
      return RunClaimOutcomeSchema.parse({ state: "claimed", run: claimed });
    });
  }

  #runAdmission(): RunAdmission {
    const generation = this.authority.runtimeConfig.get()?.generation ?? 0;
    const row = z.strictObject({ commandId: z.uuid(), hold: z.enum(["quit", "update", "shutdown", "logout"]) }).optional().parse(this.#database.prepare(`SELECT id AS commandId,
      CASE family WHEN 'application' THEN 'quit' ELSE json_extract(request_json,'$.request.reason') END AS hold FROM commands held
      WHERE state IN ('executing','succeeded') AND ((${UNRELEASED_QUIT_HOLD_SQL}) OR (family='run-lifecycle'
      AND json_extract(request_json,'$.operation')='application-admission'
      AND json_type(request_json,'$.request.reason')='text'
      AND json_extract(request_json,'$.request.runtimeGeneration')=?)) ORDER BY created_at,id LIMIT 1`).get(generation, generation, generation));
    return row === undefined ? { state: "open" } : { state: "draining", commandId: row.commandId, hold: row.hold };
  }

  #quitAdmission(): string | undefined {
    const generation = this.authority.runtimeConfig.get()?.generation ?? 0;
    return z.strictObject({ commandId: z.uuid() }).optional().parse(this.#database.prepare(`SELECT id AS commandId FROM commands held
      WHERE state IN ('executing','succeeded') AND ${UNRELEASED_QUIT_HOLD_SQL} ORDER BY created_at,id LIMIT 1`).get(generation, generation))?.commandId;
  }

  #insertAdmissionCommand(repositories: AuthorityRepositories, request: z.infer<typeof ApplicationAdmissionRequestSchema>): void {
    const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", operation: "application-admission",
      commandId: request.commandId, request,
      requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0application-admission\0${canonicalJsonStringify(request)}`),
      fence: { kind: "none" }, recordedAt: this.#clock.now().toISOString() });
    repositories.lifecycleJournal.insertCommand(command);
    repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId: request.commandId, request: command,
      result: { kind: "application", runtimeGeneration: request.runtimeGeneration }, completedAt: command.recordedAt });
  }

  #buildRunRepository(): RunRepository {
    return Object.freeze({
      holdAdmission: (input: unknown) => this.withAuthorityTransaction(repositories => {
        const request = ApplicationAdmissionHoldSchema.parse(input);
        if (repositories.runtimeConfig.get()?.generation !== request.runtimeGeneration) throw new Error("application-runtime-stale");
        const current = this.#runAdmission();
        if (current.state !== "open" && current.commandId !== request.commandId) throw new Error("application-admission-held");
        this.#insertAdmissionCommand(repositories, request);
      }),
      releaseQuitAdmission: (input: unknown) => this.withAuthorityTransaction(repositories => {
        const request = ApplicationAdmissionReleaseSchema.parse(input);
        if (repositories.runtimeConfig.get()?.generation !== request.runtimeGeneration) throw new Error("application-runtime-stale");
        const current = this.#runAdmission();
        if (current.state !== "draining" || current.hold !== "quit" || current.commandId !== request.releases) throw new Error("application-quit-admission-not-held");
        this.#insertAdmissionCommand(repositories, request);
      }),
      admission: () => this.#runAdmission(),
      quitAdmission: () => this.#quitAdmission(),
      enqueue: (input: unknown) => {
        const record = RunRecordSchema.parse(input);
        if (record.lifecycle.state !== "queued") {
          throw new Error(`run ${record.envelope.runId} must be enqueued in the queued state, not ${record.lifecycle.state}`);
        }
        const json = canonicalJsonStringify(record);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRunRow(record.envelope.runId);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`run id ${record.envelope.runId} already exists with different content`);
            }
            return Object.freeze({ state: "existing" as const, record: existing });
          }
          if (this.#runAdmission().state !== "open") throw new Error("application-admission-draining");
          const next = this.#nextItemAttempt(record.envelope.workflow, record.envelope.itemId);
          if (record.envelope.attempt < next) {
            throw new Error(
              `run ${record.envelope.runId} is enqueued for ${record.envelope.workflow} item `
              + `${record.envelope.itemId} at attempt ${String(record.envelope.attempt)}, which that item has `
              + `already spent (its next unspent attempt is ${String(next)}); an attempt is the item's, not `
              + "the run's, and no two runs of one item may hold the same one",
            );
          }


          if (record.sessionId !== undefined) {
            const session = this.#readRecord("run_batches", record.sessionId, RunSessionRecordSchema);
            if (session === undefined) {
              throw new Error(
                `run ${record.envelope.runId} names session ${record.sessionId}, which authority never wrote; `
                + "a session row is inserted before its first member, never after",
              );
            }
            if (session.workflow !== record.envelope.workflow) {
              throw new Error(
                `run ${record.envelope.runId} of ${record.envelope.workflow} names session ${record.sessionId}, `
                + `which groups ${session.workflow}; a session groups runs of one workflow`,
              );
            }
          }
          if (record.runNumber !== undefined) {
            const nextNumber = this.#nextWorkflowRunNumber(record.envelope.workflow);
            if (record.runNumber < nextNumber) {
              throw new Error(
                `run ${record.envelope.runId} is enqueued for ${record.envelope.workflow} at run number `
                + `#${String(record.runNumber)}, which that workflow has already spent (its next unspent `
                + `number is #${String(nextNumber)}); an ordinal names one run of a workflow forever, so no `
                + "two runs of one workflow may hold the same one",
              );
            }
          }
          this.#writeRunRow(record, "insert");
          return Object.freeze({ state: "inserted" as const, record });
        });
      },
      get: (runId: string) => this.#readRunRow(runId),
      search: (input: unknown) => this.withAuthorityReadSnapshot(() => {
        this.#validateExternalQuerySources();
        return createRunSearchIndex(this.#database).search(input, this.getMeta().authorityGeneration);
      }),

      listPage: (input: Readonly<{ workflow?: string; offset: number; limit: number }>) => {
        const { workflow, offset, limit } = z.strictObject({ workflow: z.string().optional(),
          offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(1001) }).parse(input);
        this.#validateExternalQuerySources();
        this.#database.exec(`CREATE TEMP TABLE IF NOT EXISTS canonical_run_page(position INTEGER PRIMARY KEY,run_id TEXT NOT NULL UNIQUE);
          CREATE TEMP TABLE IF NOT EXISTS canonical_run_page_state(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL,
            data_version INTEGER NOT NULL,source_changes INTEGER NOT NULL,workflow TEXT);`);
        this.#assertOpen();
        const key = this.#rawChangeKey();
        const state = z.strictObject({ generation: z.number().int(), data_version: z.number().int(), source_changes: z.number().int(),
          workflow: z.string().nullable() }).optional().parse(this.#database.prepare("SELECT generation,data_version,source_changes,workflow FROM canonical_run_page_state WHERE id=1").get());
        if (state?.generation !== key.authorityGeneration || state.data_version !== key.dataVersion || state.source_changes !== key.totalChanges || state.workflow !== (workflow ?? null)) {
          this.#database.exec("DELETE FROM canonical_run_page; DELETE FROM canonical_run_page_state");
          this.#database.prepare(`INSERT INTO canonical_run_page SELECT row_number() OVER (
            ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,julianday(enqueued_at),id),id FROM runs ${workflow === undefined ? "" : "WHERE workflow=?"}`)
            .run(...(workflow === undefined ? [] : [workflow]));
          // The temp-table writes advance total_changes, so the stored count is one past this statement.
          this.#database.prepare(`INSERT INTO canonical_run_page_state VALUES(1,?,?,total_changes()+1,?)`).run(key.authorityGeneration, key.dataVersion, workflow ?? null);
          this.#pageCacheChanges += this.#rawChangeKey().totalChanges - key.totalChanges;
        }
        return Object.freeze(this.#database.prepare(`SELECT r.* FROM canonical_run_page p JOIN runs r ON r.id=p.run_id
          WHERE p.position>? AND p.position<=? ORDER BY p.position`).all(offset,offset+limit).map(runRecordFromRow));
      },
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT * FROM runs WHERE workflow = ? ORDER BY created_at, id
      `).all(workflow).map((row) => runRecordFromRow(row))),
      listActiveOwners: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT owner_worker_id AS workerId, id AS runId FROM runs
        WHERE workflow = ? AND state IN ('claimed', 'validating', 'running')
      `).all(workflow).map((row) => Object.freeze(z.strictObject({
        workerId: z.string(), runId: z.string(),
      }).parse(row)))),
      listCurrentByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT t.* FROM runs AS t
        WHERE t.workflow = ?
          AND 1=1
        ORDER BY t.created_at, t.id
      `).all(workflow).map((row) => runRecordFromRow(row))),
      listByPauseState: (state: "requested" | "paused") => Object.freeze(this.#database.prepare(`
        SELECT * FROM runs WHERE pause_state = ? ORDER BY created_at, id
      `).all(state).map((row) => runRecordFromRow(row))),
      listWorkflows: () => Object.freeze(
        z.array(z.strictObject({ workflow: z.string() })).parse(this.#database.prepare(`
          SELECT DISTINCT workflow AS workflow FROM runs ORDER BY workflow
        `).all()).map(({ workflow }) => workflow),
      ),
      findByTrace: (traceId: string) => {
        const parsed = TraceIdSchema.parse(traceId);
        const rows = this.#database.prepare(`
          SELECT * FROM runs
          WHERE trace_id = ?
          ORDER BY created_at, id
        `).all(parsed);
        if (rows.length === 0) return undefined;
        if (rows.length > 1) {
          // Trace identity is frozen at enqueue; duplicate trace IDs are corruption, not ambiguous lookup.
          throw new Error(`trace ${parsed} identifies ${String(rows.length)} runs; a trace id names exactly one`);
        }
        return runRecordFromRow(rows[0]);
      },
      listByItem: (input: unknown) => {
        const query = RunItemQuerySchema.parse(input);
        const rows = this.#database.prepare(`
          SELECT * FROM runs WHERE workflow = ? AND item_id = ? ORDER BY created_at, id
        `).all(query.workflow, query.itemId);
        return Object.freeze(rows.map((row) => runRecordFromRow(row)));
      },
      nextItemAttempt: (input: unknown) => {
        const query = RunItemQuerySchema.parse(input);
        return this.#nextItemAttempt(query.workflow, query.itemId);
      },
      nextWorkflowRunNumber: (workflow: string) => this.#nextWorkflowRunNumber(workflow),
      listByWorker: (workerId: string) => {
        const rows = this.#database.prepare(`
          SELECT * FROM runs WHERE owner_worker_id = ? ORDER BY created_at, id
        `).all(WorkerIdSchema.parse(workerId));
        return Object.freeze(rows.map((row) => runRecordFromRow(row)));
      },
      listBySession: (sessionId: string) => Object.freeze(this.#database.prepare(`
        SELECT * FROM runs WHERE batch_id = ? ORDER BY created_at, id
      `).all(RunSessionIdSchema.parse(sessionId)).map((row) => runRecordFromRow(row))),

      listParkedAtGate: () => {
        const rows = this.#database.prepare(`
          SELECT * FROM runs WHERE state = 'parked-gate' ORDER BY created_at, id
        `).all();
        return Object.freeze(rows.map((row) => {
          const record = runRecordFromRow(row);
          if (record.lifecycle.state !== "parked-gate") {
            throw new Error(
              `run ${record.envelope.runId} is stored under state 'parked-gate' but its record's lifecycle `
              + `reads ${record.lifecycle.state}; the runs row and its payload_json disagree`,
            );
          }
          return record;
        }));
      },
      assertDeletionAllowed: (input: unknown) => {
        const request = RunDeleteInputSchema.parse(input);
        const run = this.#readRunRow(request.runId);
        if (run === undefined) throw new Error("run-deletion-owner-missing");
        prepareNativeRunDeletion(this.#database,run,request,ref => inspectArtifactDeletionFile(this.#admission,ref),"preflight");
      },
      delete: (input: unknown) => {
        const request = RunDeleteInputSchema.parse(input);
        return this.#authorityWrite("runs", () => {
          const run = this.#readRunRow(request.runId);
          if (run === undefined) throw new Error("run-deletion-owner-missing");
          for (const { id } of this.#database.prepare("SELECT id FROM write_intents WHERE run_id=?").all(request.runId)) assertConfirmationPublication(this.#database, String(id));
          const prepared = prepareNativeRunDeletion(this.#database,run,request,ref => inspectArtifactDeletionFile(this.#admission,ref));
          const record = executeNativeRunDeletion(this.#database,prepared,step => this.#lifecycleHooks?.afterDeleteStep?.({runId:request.runId,step}));
          return {result:record,changes:1 + record.removed.reduce((sum,entry) => sum + entry.rows,0)};
        });
      },
      listChildren: (parentRunId: string) => {
        const rows = this.#database.prepare(`
          SELECT * FROM runs WHERE parent_id = ? ORDER BY created_at, id
        `).all(RunIdSchema.parse(parentRunId));
        return Object.freeze(rows.map((row) => runRecordFromRow(row)));
      },
      claimNext: (input: unknown) => this.#claimNextRun(input, false),
      claimEligible: (input: unknown, admit?: (run: RunRecord) => void, eligible?: (run: RunRecord) => boolean) => this.#claimNextRun(input, true, admit, eligible),
      renewClaim: (input: unknown) => {
        const request = RunHeartbeatRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRunRow(request.runId);
          if (current === undefined) throw new Error(`run ${request.runId} does not exist`);
          const held = runClaim(current);
          if (held === undefined
            || held.workerId !== request.claim.workerId
            || held.claimGeneration !== request.claim.claimGeneration) {
            return RunHeartbeatOutcomeSchema.parse({
              state: "lost",
              message: `run ${request.runId} is ${current.lifecycle.state} at claim generation `
                + `${String(current.claimGeneration)}; ${request.claim.workerId} held generation `
                + `${String(request.claim.claimGeneration)}`,
            });
          }
          const renewed = RunRecordSchema.parse({
            ...current,
            lifecycle: { ...current.lifecycle, heartbeatAt: request.now },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeRunRow(renewed, "update");
          return RunHeartbeatOutcomeSchema.parse({ state: "renewed", run: renewed });
        });
      },
      transition: (input: unknown) => {
        const request = RunTransitionRequestSchema.parse(input);
        if (request.lifecycle.state === "terminal"
          && (request.lifecycle.outcome === "done" || request.lifecycle.outcome === "failed")) {
          throw new Error(
            `run ${request.runId} outcome ${request.lifecycle.outcome} requires atomic terminal authority`,
          );
        }
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          request.claim,
          (current) => RunRecordSchema.parse({ ...current, lifecycle: request.lifecycle }),
        );
      },
      requeue: (input: unknown) => {
        const request = RunRequeueRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          request.claim,
          (current) => RunRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "queued",
              requeuedFrom: request.cause,
              ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
            },
          }),
        );
      },
      resume: (input: unknown) => {
        const request = RunResumeRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {
            if (current.lifecycle.state !== "parked-gate" && current.lifecycle.state !== "parked-write") {
              throw new Error(`run ${request.runId} is ${current.lifecycle.state}; only a parked run resumes`);
            }
            return RunRecordSchema.parse({
              ...current,
              envelope: { ...current.envelope, startAt: request.startAt },
              lifecycle: { state: "queued" },
            });
          },
        );
      },
      requestCancellation: ({ runId, expectedVersion, now, errorSummary, cancellationSource }) => this.#mutateRun(
        RunIdSchema.parse(runId), z.number().int().positive().parse(expectedVersion), IsoInstantSchema.parse(now),
        undefined, (current) => {
          if (runClaim(current) === undefined) {
            if (current.lifecycle.state !== "queued" || cancellationSource === undefined
              || this.authority.delegationManifests.listByParentRun(runId).length === 0) throw new Error(`run ${runId} holds no claim for a cancel request`);
            authenticateCancellationSource(this.authority, current, cancellationSource);
            for (const manifest of this.authority.delegationManifests.listByParentRun(runId)) this.authority.dependencies.authenticateGroup(manifest);
          }
          return RunRecordSchema.parse({ ...current, cancelRequested: true, ...(errorSummary !== undefined && { cancelSummary: errorSummary }) });
        },
      ),
      advanceRevision: ({ runId, expectedVersion, now }) => this.#mutateRun(
        RunIdSchema.parse(runId), z.number().int().positive().parse(expectedVersion), IsoInstantSchema.parse(now),
        undefined, (current) => current,
      ),
      updatePresentation: (input: unknown) => {
        const request = RunPresentationRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {
            const { displayName: _previous, ...rest } = current;
            return RunRecordSchema.parse(request.displayName === null ? rest : { ...rest, displayName: request.displayName });
          },
        );
      },
      setPause: (input: unknown, accountingAuthorization?: object) => {
        const request = z.strictObject({ runId: RunIdSchema, expectedVersion: z.number().int().positive(),
          now: IsoInstantSchema, claim: RunClaimTokenSchema.optional(),
          pause: RunRecordSchema.shape.pause, continuation: RunRecordSchema.shape.envelope.shape.continuation, acknowledge: z.boolean().optional(),
        }).parse(input);
        return this.#mutateRun(request.runId, request.expectedVersion, request.now, request.claim, current => {
          if (accountingAuthorization !== undefined && (workflowDelegationAccounting(accountingAuthorization, current) === undefined
            || request.continuation !== undefined || request.pause !== undefined || current.pause?.state !== "paused"))
            throw new Error("delegation-accounting-resume-envelope-change-refused");
          if (request.acknowledge === true && request.claim === undefined) throw new Error("run-pause-claim-required");
          const next = interruptTransition(current, { kind: request.acknowledge === true ? "acknowledge-pause" : request.pause === undefined ? "resume" : "pause" });
          if (next.state === "refused") throw new Error(`run-pause-refused: ${next.reason}`);
          if (next.interrupt !== (request.pause === undefined ? "none" : request.pause.state === "requested" ? "pause-requested" : "paused")) throw new Error(`run-pause-transition-mismatch: ${next.interrupt}`);
          const { pause: _pause, ...withoutPause } = current;
          return RunRecordSchema.parse({ ...withoutPause, ...(request.pause === undefined ? {} : { pause: request.pause }),
            ...(request.continuation === undefined ? {} : { envelope: { ...current.envelope, continuation: request.continuation } }),
            ...(request.acknowledge ? { lifecycle: { state: "queued", requeuedFrom: "recovery" } } : {}) });
        });
      },
      bumpPriority: (input: unknown) => {
        const request = RunPriorityBumpRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {
            if (current.lifecycle.state !== "queued") {
              throw new Error(
                `run ${request.runId} is ${current.lifecycle.state}; only a queued run's claim order can be bumped`,
              );
            }
            return RunRecordSchema.parse({
              ...current,
              envelope: { ...current.envelope, priority: "interactive" },
            });
          },
        );
      },
      injectCheckpointPatches: (input: unknown) => {
        const request = RunInjectPatchesRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {

            if (runClaim(current) !== undefined) {
              throw new Error(
                `run ${request.runId} resumed while you were editing — your edit was not applied; `
                + "reload the current state",
              );
            }
            if (current.lifecycle.state !== "queued" && current.lifecycle.state !== "parked-gate") {
              throw new Error(
                `run ${request.runId} is ${current.lifecycle.state}; checkpoint corrections apply only `
                + "to a non-executing resumable run",
              );
            }
            const merged = new Map(
              (current.envelope.injected ?? []).map((patch) =>
                [`${String(patch.nodeId)}\0${patch.fieldPath}`, patch] as const),
            );
            for (const patch of request.patches) {
              merged.set(`${String(patch.nodeId)}\0${patch.fieldPath}`, patch);
            }
            return RunRecordSchema.parse({
              ...current,
              envelope: { ...current.envelope, injected: [...merged.values()] },
            });
          },
        );
      },
    });
  }

  #writeStartPlan(record: StartPlanRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_requests", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO run_requests (
            id, workflow, actor_id, consumed_by, expires_at, version, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.startPlanId, record.workflowId, record.plannedBy, record.consumedBy?.commandId ?? null,
          record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE run_requests SET consumed_by = ?, expires_at = ?, version = ?, payload_json = ?
          WHERE id = ? AND version = ?
        `).run(
          record.consumedBy?.commandId ?? null, record.expiresAt, record.version, json,
          record.startPlanId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`start plan ${record.startPlanId} ${mode} affected ${String(changes)} rows`);
      return { result: undefined, changes };
    });
  }

  #buildStartPlanRepository(): StartPlanRepository {
    return Object.freeze({
      create: (input: unknown) => {
        const record = StartPlanRecordSchema.parse(input);
        if (record.consumedBy !== undefined) {
          throw new Error(`start plan ${record.startPlanId} cannot be created already consumed`);
        }
        const json = canonicalJsonStringify(record);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord("run_requests", record.startPlanId, StartPlanRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`start plan id ${record.startPlanId} already exists with different content`);
            }
            return Object.freeze({ state: "existing" as const, record: existing });
          }
          this.#writeStartPlan(record, "insert");
          return Object.freeze({ state: "inserted" as const, record });
        });
      },
      get: (startPlanId: string) => this.#readRecord("run_requests", startPlanId, StartPlanRecordSchema),
      consume: (input: unknown) => {
        const request = StartPlanConsumeRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const plan = this.#readRecord("run_requests", request.startPlanId, StartPlanRecordSchema);
          if (plan === undefined) throw new Error(`start plan ${request.startPlanId} does not exist`);
          const mismatched = [
            ["descriptor", plan.descriptorFingerprint, request.descriptorFingerprint],
            ["config", plan.configFingerprint, request.configFingerprint],
            ["ingress schema", plan.ingressSchemaHash, request.ingressSchemaHash],
            ["canonical-input schema", plan.canonicalInputSchemaHash, request.canonicalInputSchemaHash],
            ["input", plan.inputFingerprint, request.inputFingerprint],
          ].find(([, planned, presented]) => planned !== presented);
          if (mismatched !== undefined) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "fingerprint-mismatch",
              message: `start plan ${request.startPlanId} was planned against a different ${String(mismatched[0])}; re-plan before starting`,
            });
          }
          // Consumption advances the exact reviewed revision once; replay binds the consumed revision.
          const confirmationVersion = plan.consumedBy === undefined ? plan.version : plan.version - 1;
          if (request.expectedVersion !== confirmationVersion) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "version-mismatch",
              message: `start plan ${request.startPlanId} confirmation expected revision ${String(confirmationVersion)} but received ${String(request.expectedVersion)}; re-plan before starting`,
            });
          }
          if (plan.consumedBy !== undefined) {

            return StartPlanConsumeOutcomeSchema.parse(plan.consumedBy.commandId === request.commandId
              ? { state: "already-consumed", plan }
              : {
                state: "refused",
                code: "spent",
                message: `start plan ${request.startPlanId} was already consumed by command ${plan.consumedBy.commandId}`,
              });
          }
          if (isStartPlanExpired(plan, Date.parse(request.now))) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "expired",
              message: `start plan ${request.startPlanId} expired at ${plan.expiresAt}`,
            });
          }
          const consumed = StartPlanRecordSchema.parse({
            ...plan,
            consumedBy: { commandId: request.commandId, consumedAt: request.now },
            version: plan.version + 1,
            updatedAt: request.now,
          });
          this.#writeStartPlan(consumed, "update");
          return StartPlanConsumeOutcomeSchema.parse({ state: "consumed", plan: consumed });
        });
      },
    });
  }

  #readDuoCeremonyLease(credentialKey: string): DuoCeremonyLeaseRecord | undefined {
    return this.#readRecord("auth_leases", credentialKey, DuoCeremonyLeaseRecordSchema);
  }

  #writeDuoCeremonyLease(record: DuoCeremonyLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("auth_leases", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO auth_leases (
            credential_key, generation, holder_worker_id, holder_system, state, expires_at,
            version, payload_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.credentialKey, record.generation, record.holder.workerId ?? null, record.holder.system,
          record.state, record.expiresAt, record.version, json, record.updatedAt,
        )
        : this.#database.prepare(`
          UPDATE auth_leases SET
            generation = ?, holder_worker_id = ?, holder_system = ?, state = ?, expires_at = ?,
            version = ?, payload_json = ?, updated_at = ?
          WHERE credential_key = ? AND version = ?
        `).run(
          record.generation, record.holder.workerId ?? null, record.holder.system, record.state,
          record.expiresAt, record.version, json, record.updatedAt, record.credentialKey, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`Duo ceremony lease generation ${String(record.generation)} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #buildDuoCeremonyLeaseRepository(): DuoCeremonyLeaseRepository {
    return Object.freeze({
      acquire: (input: unknown): DuoCeremonyLeaseAcquireOutcome => {
        const request: DuoCeremonyLeaseAcquireRequest = DuoCeremonyLeaseAcquireRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const nowMs = Date.parse(request.now);
          const existing = this.#readDuoCeremonyLease(request.credentialKey);
          if (existing !== undefined && isDuoCeremonyLeaseLive(existing, nowMs)) {
            return Object.freeze({ state: "held" as const, holder: existing });
          }
          const tookOver = existing !== undefined && existing.state === "held"
            ? DuoCeremonyLeaseTakeoverSchema.parse({ generation: existing.generation, holder: existing.holder })
            : null;
          const lease = DuoCeremonyLeaseRecordSchema.parse({
            credentialKey: request.credentialKey,
            generation: (existing?.generation ?? 0) + 1,
            holder: request.workerId === undefined ? { commandId: request.commandId, system: request.system } : { workerId: request.workerId, system: request.system },
            state: "held",
            acquiredAt: request.now,
            expiresAt: new Date(nowMs + request.ttlMs).toISOString(),
            version: (existing?.version ?? 0) + 1,
            createdAt: existing?.createdAt ?? request.now,
            updatedAt: request.now,
          });
          this.#writeDuoCeremonyLease(lease, existing === undefined ? "insert" : "update");
          const token = mintDuoCeremonyLeaseToken({
            credentialKey: lease.credentialKey,
            generation: lease.generation,
            holder: lease.holder,
            expiresAt: lease.expiresAt,
          });
          return Object.freeze({ state: "acquired" as const, lease, token, tookOver });
        });
      },
      release: (input: Readonly<{ token: unknown; now: string }>): DuoCeremonyLeaseReleaseOutcome => {
        if (!isDuoCeremonyLeaseToken(input.token)) {
          throw new Error("Duo ceremony lease token was not minted by the Duo ceremony lease store; refusing to release");
        }
        const token = input.token;
        const now = IsoInstantSchema.parse(input.now);
        return this.withAuthorityTransaction(() => {
          // Retire FIRST: a token whose release is attempted twice, or whose
          // row has moved on, must refuse at the next helper either way.
          retireDuoCeremonyLeaseToken(token);
          const current = this.#readDuoCeremonyLease(token.credentialKey);
          if (current === undefined) {
            throw new Error(`Duo ceremony lease generation ${String(token.generation)} has no row to release; the token names a lease authority never wrote`);
          }
          if (current.generation !== token.generation || current.state !== "held") {
            return DuoCeremonyLeaseReleaseOutcomeSchema.parse({ state: "superseded", current });
          }
          const released = DuoCeremonyLeaseRecordSchema.parse({
            ...current,
            state: "released",
            releasedAt: now,
            version: current.version + 1,
            updatedAt: now,
          });
          this.#writeDuoCeremonyLease(released, "update");
          return DuoCeremonyLeaseReleaseOutcomeSchema.parse({ state: "released", lease: released });
        });
      },
      get: (credentialKey: string) => this.#readDuoCeremonyLease(FingerprintSchema.parse(credentialKey)),
    });
  }

  #writeWorkerPool(record: WorkerPoolRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("worker_pools", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO worker_pools (workflow, desired_workers, version, payload_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(record.workflow, record.desiredWorkers, record.version, json, record.createdAt, record.updatedAt)
        : this.#database.prepare(`
          UPDATE worker_pools SET desired_workers = ?, version = ?, payload_json = ?, updated_at = ?
          WHERE workflow = ? AND version = ?
        `).run(record.desiredWorkers, record.version, json, record.updatedAt, record.workflow, record.version - 1);
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`worker pool ${record.workflow} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #buildWorkerPoolRepository(): WorkerPoolRepository {
    const read = (workflow: string): WorkerPoolRecord | undefined =>
      this.#readRecord("worker_pools", WorkflowIdSchema.parse(workflow), WorkerPoolRecordSchema);
    return Object.freeze({
      plan: (input: unknown): WorkerPoolPlanOutcome => {
        const request = WorkerPoolPlanRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = read(request.workflow);
          const currentVersion = workerPoolVersion(existing);
          if (currentVersion !== request.expectedVersion) {
            return WorkerPoolPlanOutcomeSchema.parse({
              state: "conflict",
              currentVersion,
              message: existing === undefined
                ? `worker pool ${request.workflow} has no row yet (version 0), not version ${String(request.expectedVersion)}`
                : `worker pool ${request.workflow} is at version ${String(currentVersion)}, not ${String(request.expectedVersion)}`,
            });
          }
          const pool = WorkerPoolRecordSchema.parse({
            workflow: request.workflow,
            desiredWorkers: request.desiredWorkers,
            plannedBy: request.requestedBy,
            plannedAt: request.now,
            version: currentVersion + 1,
            createdAt: existing?.createdAt ?? request.now,
            updatedAt: request.now,
          });
          this.#writeWorkerPool(pool, existing === undefined ? "insert" : "update");
          return WorkerPoolPlanOutcomeSchema.parse({ state: "applied", pool });
        });
      },
      get: read,
      list: () => Object.freeze(this.#database.prepare(`
        SELECT * FROM worker_pools ORDER BY workflow
      `).all().map((row) => this.#parseNativeRow("worker_pools",row,WorkerPoolRecordSchema))),
    });
  }

  #buildRunSessionRepository(): RunSessionRepository {
    return Object.freeze({
      list: () => Object.freeze(this.#database.prepare("SELECT * FROM run_batches ORDER BY id").all().map((row) => this.#parseNativeRow("run_batches",row,RunSessionRecordSchema))),
      setGrouping: (sessionId: string, expectedVersion: number, groupInQueue: boolean) => this.#authorityWrite("run_batches", () => {
        const current = this.#readRecord("run_batches", RunSessionIdSchema.parse(sessionId), RunSessionRecordSchema);
        if (current === undefined) throw new Error(`workflow batch ${sessionId} does not exist`);
        if (current.version !== expectedVersion) throw new Error(`workflow batch ${sessionId} version conflict`);
        const record = RunSessionRecordSchema.parse({ ...current, groupInQueue, version: current.version + 1 });
        const result = this.#database.prepare(`UPDATE run_batches SET group_in_queue = ?, version = ?, payload_json = ? WHERE id = ? AND version = ?`)
          .run(record.groupInQueue ? 1 : 0, record.version, canonicalJsonStringify(record), sessionId, expectedVersion);
        if (sqliteChanges(result.changes) !== 1) throw new Error(`workflow batch ${sessionId} version conflict`);
        return { result: record, changes: 1 };
      }),
      insert: (input: unknown) => {
        const record = RunSessionRecordSchema.parse(input);
        const json = canonicalJsonStringify(record);
        return this.#authorityWrite("run_batches", () => {
          const existing = this.#readRecord("run_batches", record.sessionId, RunSessionRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`run session ${record.sessionId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          const result = this.#database.prepare(`
            INSERT INTO run_batches (id, workflow, started_at, payload_json, created_at, group_in_queue, version)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(record.sessionId, record.workflow, record.startedAt, json, record.createdAt, record.groupInQueue ? 1 : 0, record.version);
          return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
        });
      },
      get: (sessionId: string) =>
        this.#readRecord("run_batches", RunSessionIdSchema.parse(sessionId), RunSessionRecordSchema),
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT * FROM run_batches WHERE workflow = ? ORDER BY started_at, id
      `).all(WorkflowIdSchema.parse(workflow)).map((row) => this.#parseNativeRow("run_batches",row,RunSessionRecordSchema))),
    });
  }

  #requireWriteIntent(writeIntentId: string): WriteIntentRecord {
    const current = this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema);
    if (current === undefined) throw new Error(`write intent ${writeIntentId} does not exist`);
    return current;
  }

  #readWrite(writeIntentId: string, expected: Readonly<{ generation?: number; version?: number }>) {
    const current = this.#requireWriteIntent(writeIntentId);
    if (expected.generation !== undefined && current.generation !== expected.generation) {
      throw new Error(`write intent ${writeIntentId} is at generation ${String(current.generation)}, not ${String(expected.generation)}; the transition is stale`);
    }
    if (expected.version !== undefined && current.version !== expected.version) {
      throw new Error(`write intent ${writeIntentId} is at version ${String(current.version)}, not ${String(expected.version)}; the transition is stale`);
    }
    return Object.freeze({ intent: current,
      attempt: current.status === "observed-present" ? undefined : this.#requireWriteAttempt(current.currentAttemptId) });
  }

  #transitionWrite(writeIntentId: string, expected: Readonly<{ generation?: number; version?: number }>, event: WriteEvent) {
    const { intent, attempt } = this.#readWrite(writeIntentId, expected);
    return applyWriteTransition(intent, attempt, event);
  }

  #requireWriteAttempt(writeAttemptId: string): WriteAttemptRecord {
    const attempt = this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema);
    if (attempt === undefined) throw new Error(`write attempt ${writeAttemptId} does not exist`);
    return attempt;
  }

  #writeFenceRefusal(
    intent: Extract<WriteIntentRecord, { status: "attempting" }>,
    claim: z.infer<typeof RunClaimTokenSchema>,
  ): RunRecordRefusal | undefined {
    const run = this.#readRunRow(intent.runId);
    const held = run === undefined ? undefined : runClaim(run);
    if (held === undefined || held.workerId !== claim.workerId || held.claimGeneration !== claim.claimGeneration) {
      return { reason: "lost" };
    }
    const slot = this.authority.workerSlots.get(claim.workerId);
    if (run?.envelope.parent !== undefined && (slot === undefined || slot.retiredAt !== null
      || !authenticateDescendantHome(this.authority, run, slot.workflow))) return { reason: "lost" };
    if (run?.lifecycle.state !== "running" || run.cancelRequested === true || run.pause?.state === "requested"
      || run.envelope.attempt !== intent.runAttempt) {
      return { reason: "invalid-state" };
    }
    try { this.#assertCurrentExecution(intent.runId, claim); }
    catch (error) {
      if (error instanceof WorkerControlRefusal && error.message === "worker-execution-lost") return { reason: "lost" };
      throw error;
    }
    return undefined;
  }

  #assertBusinessWriteAdmission(intent: WriteIntentRecord): void {
    const businessDigest = intent.status !== "observed-present" && intent.occurrence !== undefined
      ? intent.occurrence.businessKeyDigest : intent.idempotencyKeyDigest;
    const unresolved = this.authority.writeIntents.listByBusinessKey(intent.system, businessDigest)
      .find((other) => other.idempotencyKey !== intent.idempotencyKey
        && (other.status !== "committed" && other.status !== "observed-present"));
    if (unresolved !== undefined) throw new Error("business key has an unresolved write occurrence");
    if (intent.status !== "observed-present" && intent.occurrence !== undefined) {
      const settled = this.authority.writeIntents.listByBusinessKey(intent.system, businessDigest)
        .filter((other) => other.idempotencyKey !== intent.idempotencyKey
          && (other.status === "committed" || other.status === "observed-present"));
      if (settled.length !== intent.occurrence.baselineEvidence.length || settled.some((other) =>
        !intent.occurrence?.baselineEvidence.some((proof) => proof.writeIntentId === other.writeIntentId
          && proof.evidenceDigest === repeatEvidenceDigest(other, intent.occurrence?.protectedBindings)))) {
        throw new Error("confirmation-required: repeat completion evidence changed before fence");
      }
    }
  }

  #findPermanentWriteIntent(system: string, idempotencyKey: string): WriteIntentRecord | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM write_intents WHERE system = ? AND idempotency_key = ?
    `).get(system, idempotencyKey);
    if (row === undefined) return undefined;
    return this.#parseNativeRow("write_intents",row,WriteIntentRecordSchema);
  }

  #insertWriteIntent(record: WriteIntentRecord): void {
    if(record.status === "committed") throw new Error("confirmed-write-publication-required");
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_intents", () => {
      const existingById = this.#readRecord("write_intents", record.writeIntentId, WriteIntentRecordSchema);
      if (existingById !== undefined) throw new Error(`write intent id ${record.writeIntentId} already exists with a different permanent key`);
      const digestCollision = this.#database.prepare(`
        SELECT system, idempotency_key FROM write_intents WHERE idempotency_key_digest = ?
      `).get(record.idempotencyKeyDigest);
      if (digestCollision !== undefined) {
        throw new Error("write intent digest is already bound to a different permanent key");
      }
      const result = this.#database.prepare(`
        INSERT INTO write_intents (
          id, system, idempotency_key, idempotency_key_digest, status, generation, run_id, payload_json, publication_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        record.writeIntentId,
        record.system,
        record.idempotencyKey,
        record.idempotencyKeyDigest,
        record.status,
        record.generation,
        "runId" in record ? record.runId : null,
        json,
        record.createdAt,
        record.updatedAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertWriteAttempt(record: WriteAttemptRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_attempts", () => {
      const result = this.#database.prepare(`
        INSERT INTO write_attempts (
          id, intent_id, generation, run_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(record.writeAttemptId, record.writeIntentId, record.generation, record.runId, json, record.recordedAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #replaceWriteIntent(record: WriteIntentRecord, publication?:ConfirmationPublication): void {
    const publicationJson = publication === undefined ? null : canonicalJsonStringify(publication);
    confirmationPublicationFromRow(record,publicationJson);
    const result = this.#database.prepare(`
      UPDATE write_intents
      SET status = ?, generation = ?, run_id = ?, payload_json = ?, updated_at = ?, publication_json = ?
      WHERE id = ? AND idempotency_key_digest = ? AND json_extract(payload_json,'$.version') = ?
    `).run(record.status, record.generation, "runId" in record ? record.runId : null, canonicalJsonStringify(record), record.updatedAt, publicationJson, record.writeIntentId, record.idempotencyKeyDigest, record.version - 1);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write intent ${record.writeIntentId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #replaceWriteAttempt(record: WriteAttemptRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_attempts SET payload_json = ?, created_at = ?
      WHERE id = ? AND intent_id = ? AND generation = ? AND json_extract(payload_json,'$.outcome.state')='attempting'
    `).run(canonicalJsonStringify(record), record.recordedAt, record.writeAttemptId, record.writeIntentId, record.generation);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write attempt ${record.writeAttemptId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #assertAtomicCommitMatchesIntent(
    input: z.infer<typeof AtomicWriteCommitInputSchema>,
    intent: Exclude<WriteIntentRecord, { status: "observed-present" }>,
  ): void {
    const ledger = { kind: "ledger-entry", entry: input.transaction };
    const span = input.committedSpan;
    if (ledger.kind !== "ledger-entry" || span.kind !== "write-committed-span" || input.outcome.disposition !== "committed") {
      throw new Error("atomic write commit payload arms were not narrowed after strict parsing");
    }
    const expected = {
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
      workflowId: intent.workflowId,
      itemId: intent.itemId,
      system: intent.system,
      idempotencyKey: intent.idempotencyKey,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      bindingProofDigest: intent.bindingProofDigest,
      runId: intent.runId,
      attempt: intent.runAttempt,
    };
    for (const [field, value] of Object.entries(expected)) {
      const ledgerValue = ledger.entry[field as keyof typeof ledger.entry];
      const spanValue = span[field as keyof typeof span];
      if (ledgerValue !== value || spanValue !== value) {
        throw new Error(`atomic confirmed facts ${field} do not match intent ${intent.writeIntentId}`);
      }
    }
    if (ledger.entry.fencedAt !== intent.fencedAt
      || ledger.entry.confirmedAt !== input.confirmedAt
      || ledger.entry.proofSource !== input.outcome.proofSource
      || span.occurredAt !== input.confirmedAt
      || canonicalJsonStringify(ledger.entry.proof) !== canonicalJsonStringify(input.completionProof)) {
      throw new Error(`atomic confirmed facts do not match proof/timing for intent ${intent.writeIntentId}`);
    }
    if (ledger.entry.traceId !== span.traceId) {
      throw new Error(`atomic confirmed facts do not share trace identity for intent ${intent.writeIntentId}`);
    }
    if (intent.bindingProof.kind === "subject-match") {
      if (ledger.entry.subject.state !== "present"
        || canonicalJsonStringify(ledger.entry.subject.value) !== canonicalJsonStringify(intent.bindingProof.expected)) {
        throw new Error(`ledger subject does not match the fenced binding proof for intent ${intent.writeIntentId}`);
      }
    } else if (ledger.entry.subject.state !== "absent") {
      throw new Error(`ledger subject must be absent for unscoped binding proof on intent ${intent.writeIntentId}`);
    }

  }

}
