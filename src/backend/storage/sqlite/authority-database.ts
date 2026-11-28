import { readStartupFile, type StartupFile } from "./startup-file-proof.js";
import type { LogMutation } from "../events/log-mutations.js";
import type { FileIdentitySchema } from "../../../models/storage/file-identity.js";
import { createWorkerSlotRepository } from "./worker-slots.js";
import { stoppedProfileOwnsCredentialCommand } from "../configuration/protected-settings-upgrade.js";
import { collectEvidenceSchemaAdmissions } from "./evidence-schema-upgrade.js";
import { evidenceSchemaSourceDigest, type EvidenceSchemaConversion, type EvidenceSchemaOwner } from "../../../models/storage/evidence-schema-admission.js";
import { deletionArtifactReferenceMatcher } from "./artifact-references.js";
import { fileStatus } from "../file-identity.js";
import { assertMaintenanceCustodyAvailable } from "../maintenance/custody-availability.js";
import { CURRENT_RUN_SETTLEMENT_SQL, readRunSettlementRow, runSettlementContext, runSettlementColumns } from "./run-settlement-row.js";
import { convertSettingsRecordRow } from "./settings-record-conversion.js";
import { readContinuationGate, validateRunContinuation } from "./run-continuation.js";
import { AuthenticatedRunContinuation } from "./run-continuation-delegation.js";
import type { ChildProcess } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { existsSync,statSync } from "node:fs";
import { basename,dirname,join,resolve } from "node:path";
import { DatabaseSync, backup as sqliteBackup, type SQLTagStore } from "node:sqlite";
import { z } from "zod";
import { ArtifactRefSchema,type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { CHANGE_LOG_SCHEMA_VERSION, singletonChangeKeys, type ChangeEntry } from "./authority-change-log.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityTableNameSchema, CHANGE_LOG_TABLE, RUN_REFERENCES_TABLE, AuthorityEvidenceSchemaUpgradeRecordSchema, AuthorityUpgradeRecordSchema, type AuthorityTableName, type RunRecordRefusal, type TableName } from "../../../models/config/authority.js";
import { authorityUpgradeJournalOf } from "../../../rules/storage/upgrade-journal.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema,type ConfigSnapshotRecord,ConfigSnapshotWriteSchema } from "../../../models/config/snapshot.js";
import { RunSearchRebuildRequestSchema } from "../../../models/dashboard/search-index.js";
import { CalendarStoreQuerySchema, CalendarWireSchema, type CalendarWire } from "../../../models/dashboard/calendar.js";
import { isQueueTopLevel } from "../../../models/dashboard/queue-parent.js";
import { RunEnvelopeSchema } from "../../../models/run/envelope.js";
import { ConfirmationPublicationSchema,confirmationPublicationFromRow,confirmedOperationTimeline,reconstructConfirmedOperation,type ConfirmationPublication } from "../../../models/events/confirmed-operation.js";
import { TimelineEventRecordSchema, TimelinePageRequestSchema, timelineAppendContent, timelineCheckpointReference, type TimelineEventRecord, type TimelineRepository } from "../../../models/events/timeline.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { NotificationFoldRequestSchema, NotificationRecordOutcomeSchema, NotificationRecordSchema, NotificationStateRequestSchema, notificationCollectionTarget, requireMutableNotification, type NotificationCollectionOperation, type NotificationRecord, type NotificationRecordOutcome } from "../../../models/notifications/notifications.js";
import { StoredOcrExtractionSchema } from "../../../models/ocr/stored-extraction.js";
import { OcrPageReadingSchema } from "../../../models/workflows/ocr/page-accounting.js";
import { LogoutOperationSchema,ProfileDatabaseBindingSchema,type LogoutOperation } from "../../../models/profiles/profile.js";
import { completionFromAuthorization } from "../../../models/run/completion.js";
import { DeletedRunRecordSchema,RunDeleteInputSchema,type DeletedRunRecord } from "../../../models/run/deleted-run.js";
import { PredecessorRunRecordSchema,RunRecordSchema,runClaim,runTransitionViolation,type PredecessorRunRecord,type RunRecord } from "../../../models/run/record.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { RunResultRecordSchema, readRunPreviewResult,createRunTerminalEvidenceResult,deriveCheckpointOutputDigest,deriveCheckpointProvenanceDigest,deriveTerminalFailureDigest,terminalDelegationDependencyRecord,terminalGateDependencyRecord,refreshedRunSettlement,terminalEvidenceResult,type RunResultRecord } from "../../../models/run/result.js";
import { RunSessionRecordSchema } from "../../../models/run/session.js";
import { StartPlanRecordSchema,isStartPlanExpired,type StartPlanRecord } from "../../../models/run/start-plan.js";
import { FailureTerminalAuthorizationRecordSchema,TerminalAuthorizationRecordSchema,type TerminalAuthorizationRecord } from "../../../models/run/terminal-authorization.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { WorkerPoolRecordSchema,workerPoolVersion,type WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { CanonicalCrashRecoveryRequestSchema,RunClaimTokenSchema } from "../../../models/run/worker.js";
import { DiagnosticBundleSchema,type DiagnosticBundle } from "../../../models/trust/diagnostic.js";
import { deriveBulkChildCommand,deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import { CommandRowStateSchema } from "../../../rules/commands/command-lifecycle.js";
import { AuthorityCommandAuditRecordSchema, AuthorityCommandRecordSchema, BulkParentCommandRecordSchema, BulkRunCommandAcceptanceRecordSchema, CommandAuditRecordSchema, CommandIdentityConflictError, CommandIdReusedError, CommandRequestSchema, RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema, type StoredAuthorityCommandRecordSchema } from "../../../rules/commands/commands.js";
import { deriveStableUuid,lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { deriveCanonicalPerson } from "../../../rules/runs/summary-derivation.js";
import { interruptTransition } from "../../../rules/runs/run-interrupt.js";
import { capturedInstantClock } from "../../../rules/time/clock.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { DelegationManifestSchema, DependencyRecordSchema, delegationJoinDisposition, type DelegationManifest } from "../../../rules/workflow/dependencies.js";
import { authenticateParkedWriteRecheck } from "../../../rules/write-safety/parked-resolution.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { type InstallationLease } from "../admission/installation.js";
import { RuntimeLifetimeLock,offlineMaintenanceWorkspace,type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { assertOfflineMaintenanceForProcessRoot } from "../admission/process-root.js";
import { inspectArtifactDeletionFile,pendingDiagnosticArtifacts,reclaimDiagnosticStages,removeArtifactDeletionFile } from "../artifacts/content-addressed-artifact-writer.js";
import { fileIdentityObservation,sameDirectory,type DirectoryIdentity, clearOperationProofSlots,outermostOperationProof,readPrivateFile,revalidateOperationProof,withOperationProof } from "../configuration/credential-safe-file.js";
import { assertCredentialStoreOwner } from "../configuration/credential-store.js";
import { stoppedLogoutAuthorityFileWitnesses } from "../maintenance/existing-data-backup-files.js";
import { fixedLayoutOutputPaths,fixedLayoutSettingsUpdate,readFixedLayoutIntent,type FixedLayoutActivation } from "../maintenance/fixed-layout.js";
import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { runtimeProfiles } from "../../../models/config/define-runtime-isolation.js";
import { historyArchivePath, attachHistoryArchive, validateHistoryRead, runIndex } from "./isolated-history-store.js";
import { privatePathRejects } from "../private-path.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { createAssistantAppliedEditRepository } from "./assistant-applied-edits.js";
import { createAssistantAuthorizationRepository } from "./assistant-authorization.js";
import { createAssistantModelPreferenceRepository } from "./assistant-model-preference.js";
import { NativeCommandAuditSchema, commandFromRow, insertNativeCommand, settleNativeCommand, settledRunDeletionIds } from "./command-record-row.js";
import { authoritySourceDatabaseIdentity,type AuthorityBackupExpectedSource } from "./database-identity.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { extractedArtifactFromRow } from "./extracted-artifact-row.js";
import { createOcrReviewRepository } from "./ocr-review.js";
import { createFailureResolutionRepository } from "./failure-resolution.js";
import { createGeneratedArtifactRepository,generatedArtifactFromRow } from "./generated-artifacts.js";
import { createImportedArtifactRepositories,importedArtifactFromRow } from "./imported-artifacts.js";
import { initialFailureColumns, initialNotificationColumns, isNativeOrdinaryTable, nativeOrdinaryRecordFromRow, type NativeOrdinaryTable } from "./native-record-row.js";
import { deletionArtifactValues,executeNativeRunDeletion,prepareNativeRunDeletion } from "./native-run-deletion.js";
import { createNotificationMetadataRepositories,validateNotificationMetadata } from "./notification-publications.js";
import { type createReadonlyAuthoritySnapshot, readonlyAuthorityImage, withAuthorityDatabaseReadOnly, withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { execMigrationStatement } from "./worker-custody-migration.js";
import { withNativeRecordReadScope, runRecordColumns, runRecordFromRow, transitionRunRecord, transitionStoredRun, updateRunRecord } from "./run-record-row.js";
import { createRunSearchIndex } from "./run-search-index.js";
import { continuationDelegationGroups } from "./run-continuation-delegation.js";
import { ApplicationAdmissionHoldSchema, ApplicationAdmissionReleaseSchema, type ApplicationAdmissionRequestSchema, CanonicalPauseRequestSchema, RunClaimOutcomeSchema, RunClaimRequestSchema, RunHeartbeatOutcomeSchema, RunHeartbeatRequestSchema, RunInjectPatchesRequestSchema, RunItemQuerySchema, RunPresentationRequestSchema, RunPriorityBumpRequestSchema, RunRequeueRequestSchema, RunResumeRequestSchema, RunTransitionRequestSchema, RunUpdateOutcomeSchema, StartPlanConsumeOutcomeSchema, StartPlanConsumeRequestSchema, WorkerPoolPlanOutcomeSchema, WorkerPoolPlanRequestSchema, type RunClaimOutcome, type RunUpdateOutcome, type WorkerPoolPlanOutcome, type RunAdmission } from "./run-store-contracts.js";
import { createRunSummaries, listRunWorkflows } from "./run-summaries.js";
import { createSettingsActivationRepositories } from "./settings-activation.js";
import { readAppSettings } from "./settings-storage.js";
import { TimelineRecordError, createTimelineRepository, timelineEventFromRow } from "./timeline-repository.js";
import { selectTransactions } from "./transaction-selection.js";
import { createWorkbookLibraryRepository, hasOnlyInitialWorkbookType } from "./workbook-library-repository.js";
import { DryRunScenarioResultSchema } from "../../../models/trust/dry-run-scenario-result.js";
import { DryRunWriteSafetyCountsSchema } from "../../../models/trust/dry-run-scenario.js";
import { RunEvidenceReceiptSchema } from "../../../models/trust/evidence.js";
import { FailureRecordSchema,failureCauseNames,settledWriteState,type FailureRecord } from "../../../models/trust/failure.js";
import { RunCheckpointRecordSchema, checkpointLookupKey, checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { ActorIdSchema, ArtifactIdSchema, BrowserSystemIdSchema, CommandIdSchema, DiagnosticBundleIdSchema, FailureFingerprintSchema, FingerprintSchema, GateIdSchema, IsoInstantSchema, ItemIdSchema, LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, RunIdSchema, RunSessionIdSchema, TraceIdSchema, WorkerIdSchema, WorkflowIdSchema, WriteIntentIdSchema } from "../../../rules/identity/ids.js";
import { DuoCeremonyLeaseAcquireRequestSchema,DuoCeremonyLeaseRecordSchema,DuoCeremonyLeaseReleaseOutcomeSchema,DuoCeremonyLeaseTakeoverSchema,isDuoCeremonyLeaseLive,type DuoCeremonyLeaseAcquireRequest,type DuoCeremonyLeaseRecord,type DuoCeremonyLeaseReleaseOutcome } from "../../../rules/sessions/duo-ceremony-lease.js";
import { localDatePart,systemClock,type Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { IdempotencyKeySchema,WriteAttemptRecordSchema,WriteIntentRecordSchema,type WriteAttemptRecord,type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { WriteEvent } from "../../../rules/write-safety/write-transitions.js";
import { isDuoCeremonyLeaseToken, mintDuoCeremonyLeaseToken, retireDuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { assertWorkflowRunResultAuthorization,workflowDelegationAccounting,descriptorRuntimeNodes,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { assertCredentialCopyResourcesClosed, assertLogoutResourcesClosed } from "../maintenance/profile-custody.js";
import type { VerifiedBackup } from "./backup-service.js";
import { admitDelegationRefresh, authenticateDelegationRefresh, settleDelegationRefresh } from "./delegation-refresh.js";
import { newDelegationAuthenticationMemo,type DelegationAuthenticationMemo,currentDelegationManifests,assertDelegationReplacement,authenticateCancellationSource,authenticateDelegationDependency,authenticateDelegationGroup,authenticateDescendantHome,memoizedDelegationGroup,childTerminalSettlement,delegationEdgeForChild,lifecycleChildEdge,prepareDelegationRetry,readDelegationCancellation,readDelegationEvidence,readDelegationInvocationEvidence,readDelegationReadiness,readQueueParents,readDelegationWait,readDelegationWaitState,retainedDelegationManifests } from "./delegation-authority.js";
import { DelegationRetryRequestSchema,DelegationSettlementRequestSchema } from "./delegation-contracts.js";
import { createExclusiveSessionLeaseRepository, exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { createAssistantM1HistoryRepository, type AssistantM1HistoryRepository } from "./assistant-history.js";
import { createAssistantProposalRepository, type AssistantProposalRepository } from "./assistant-proposals.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, deriveAuthorityUpgradePlanDigest, isCurrentAuthoritySchemaVersion, migrationTableNames, OPENABLE_AUTHORITY_SCHEMA_VERSIONS, UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS, tableClassification } from "./migrations.js";
import { AuthorityCopyInspectionSchema, type AuthorityCopyInspection, type SpanAuthorityReadSnapshot, type SpanAuthorityRunRoot } from "./recovery-contracts.js";
import { FailureTerminalizationReportSchema, FailureTerminalizationRequestSchema, SuccessTerminalizationReportSchema, SuccessTerminalizationRequestSchema, type FailureTerminalizationReport, type SuccessTerminalizationReport } from "./run-terminal-contracts.js";
import { DiagnosticAttachmentStorageRecordSchema, type ArtifactOutboxStorageRecord, type DiagnosticAttachmentStorageRecord } from "./storage-records.js";
import { applyWriteTransition, AtomicWriteCommitInputSchema, AtomicWriteCommitReportSchema, PermanentWriteResolutionSchema, ResolvedParkedWriteAbsenceInputSchema, ResolvedParkedWriteCommitInputSchema, WriteFenceInputSchema, WriteFenceRecordsSchema, WriteIntentParkRequestSchema, WriteIntentRetrySettlementRequestSchema, WriteRecheckParkRequestSchema, WriteRecheckRequestSchema, WriteRefenceInputSchema, type AtomicWriteCommitReport } from "./write-commit-contracts.js";
import { type ChangeLogReader, changeLogHighWater, CHANGE_LOG_RETAINED_ENTRIES, readAuthorityChanges, validateAuthorityChanges, readSingletonImage, changeLogBaseline, validateAuthorityStore, admitChanges, CHANGE_LOG_PRUNE_INTERVAL_MS } from "./authority-change-admission.js";
import { readIntPragma, AuthorityDatabaseOptionsSchema, type AuthorityDatabaseOpenModeSchema, existingDatabaseLocation, errorMessage, inspectionTableNames, readMetaRow, parseDiagnosticPageCount, readTextPragma, optimizeAuthorityPlanner, AUTHORITY_WAL_SIZE_LIMIT_BYTES, AuthorityMetaSchema, sqliteChanges, AuthoritySchemaInspectionSchema, CountRowSchema, configureWritableConnection, tableNames, type MetaRowSchema } from "./authority-connection.js";
import { inspectStoredData, CredentialContextRequiredError, AuthoritySchemaVersionError, AuthorityFormatUnsupportedError, type StartupFailureClassification, isSqliteDamage, AuthorityWriterBusyError, AuthoritySnapshotChangedError } from "./authority-errors.js";
import { assertNativeSchema, checkSqliteIntegrity, upgradeInspections, type VerifiedUpgradeImage, type NativeInspection, inspectNativeAuthority, QuickCheckRowSchema, assertPublishedAssistantNumbering, normalizedNativeSchema, expectedNativeSchema, nonProjectionFingerprint, runSearchDefinitions, startupImageDigest, authorityContentFingerprint, inspectStoppedTransaction, commitVerifiedUpgrade, inspectNormalAuthority, inspectOpenDatabase, checkInspectionPragmas, observeReadonlyStartupFile, sameStartupFile } from "./authority-inspection.js";
import { type AuthorityRepositories, type AuthorityWriteCommitHooks, type AuthorityTerminalizationHooks, type AuthorityLifecycleHooks, type SlowOperationHook, type EarlierRunEvents, type PendingLogoutServices, type ImmutableInsertResult, DiagnosticPurgeDispositionSchema, type CanonicalRunClaimOutcome, type RunRepository, type StartPlanRepository, type DuoCeremonyLeaseRepository, type DuoCeremonyLeaseAcquireOutcome, type WorkerPoolRepository, type RunSessionRepository } from "./authority-repositories.js";
import { inspectionRunReader, readTimelineRun, assertTimelineOwner, INSPECTED_TIMELINE_KINDS, readRunPages, JsonRowSchema, assertTerminalEvidenceOwner, timelineEvidenceRepositories, assertConfirmationPublication, authenticateStoredWriteResolution, assertRefreshedReceiptSettlement, authenticateStoredResolutionAudit, readConfirmationPublication, authenticatedPublicationDeletion, CURRENT_READERS, readDelegationRefreshCommands } from "./authority-run-evidence.js";
import { readManagedArtifactReferencesFromDatabase, maintenanceInventory, browserProfileInventory, requireStoppedUpgradeSource, flatQueuedRunCancellationInventory, withDirectReaderAdmission, inspectExistingDatabaseReadOnly, type AuthorityReadIdentitySnapshot, inspectAuthorityReadIdentityReadOnly, inspectSpanRunAuthorityReadOnly } from "./authority-stopped-reads.js";
import { type StoredRow, validateAuthorityRecordSchemas, invariantQueries, unreleasedQuitHoldSql } from "./authority-stored-rows.js";
import { fixedLayoutAppSettings, readAuthorityUpgradeJournal, type StartupLogoutConversion, startupLogoutConversionBrand, startupLogoutConversions, convertedLogoutOperation, verifiedEvidenceSchemaRecords, evidenceSchemaPlanDigest, assertAuthorityUpgradeAppend, migrateStoppedAuthority, readAuthorityUpgradeRecords, fixedLayoutSettingsSnapshots, assertFixedLayoutPublications, fixedLayoutUnchangedAuthorityFingerprint, fixedLayoutChangedAuthorityTables, FixedLayoutSettingsSnapshotRowSchema } from "./authority-upgrades.js";

/** Delegation reads one locked operation reuses: group proofs and invocation commands. */
type DelegationOperationReads = {
  memo: DelegationAuthenticationMemo;
  invocations: Map<string, readonly z.infer<typeof RunLifecycleCommandRecordSchema>[]>;
};

const LifecycleLookupSchema = z.strictObject({
  commandId: z.string(), operation: z.string(), targetId: z.string().nullable(),
  requestRunId: z.string().nullable(), resultRunId: z.string().nullable(), resultKind: z.string().nullable(),
  version: PositiveIntSchema.nullable(), continuationKind: z.string().nullable(),
  sourceCommandId: z.string().nullable(), continuationOwnerRunId: z.string().nullable(),
  manifestId: z.string().nullable(), cancellationKind: z.string().nullable(),
  lifecycleState: z.string().nullable(), gateId: z.string().nullable(), currentNodeKind: z.string().nullable(),
  claimGeneration: PositiveIntSchema.nullable(), expectedVersion: z.number().int().nonnegative().nullable(),
});
type LifecycleLookupRow = z.infer<typeof LifecycleLookupSchema> & { row: StoredRow };
type LifecycleCommandBatch = { byRun: Map<string, LifecycleLookupRow[]>; byManifest: Map<string, LifecycleLookupRow[]> };
type ProjectionRowReads = {
  admissions: Map<number, RunAdmission>;
  runs: Map<string, RunRecord>;
  commands: Map<string, z.infer<typeof AuthorityCommandRecordSchema>>;
  audits: Map<string, z.infer<typeof AuthorityCommandAuditRecordSchema>>;
  settlements: Map<string, NonNullable<ReturnType<AuthorityRepositories["runResults"]["getSettlement"]>>>;
};
function lifecycleCommandOrder(left: LifecycleLookupRow, right: LifecycleLookupRow): number {
  return left.commandId < right.commandId ? -1 : left.commandId > right.commandId ? 1 : 0;
}
function lifecycleVersionOrder(left: LifecycleLookupRow, right: LifecycleLookupRow): number {
  return (right.version ?? 0) - (left.version ?? 0);
}

const RecordKeyRowSchema = z.strictObject({ id: z.string() });
const ProtectedSettingsWriteIdLookupSchema = z.strictObject({
  writeId: z.uuid(),
  excludingCommandId: CommandIdSchema,
});

const HeldRunRowSchema = z.strictObject({ run_id: z.string().nullable() });

// SQL max over no rows is NULL, meaning the item has no run attempt.
const MaxAttemptRowSchema = z.strictObject({ attempt: z.number().int().positive().nullable() });
const MaxRunNumberRowSchema = z.strictObject({ run_number: z.number().int().positive().nullable() });

type StartupPosition = Pick<ChangeLogReader, "cursor" | "singleton" | "schemaCookie">;
type StartupCheckpoint = {
  file: StartupFile;
  digest: string;
  inspection?: AuthorityCopyInspection;
  pending?: StartupPosition;
};

const HISTORY_SNAPSHOT_ATTEMPTS = 5;
// A different validator module or runtime lifetime always starts with a full inspection.
const startupCheckpoints = new WeakMap<RuntimeAdmission["lifetime"], Map<string, StartupCheckpoint>>();

function checkpointsFor(admission: RuntimeAdmission) {
  const lifetime = admission.lifetime;
  let checkpoints = startupCheckpoints.get(lifetime);
  if (checkpoints === undefined) {
    checkpoints = new Map<string, StartupCheckpoint>();
    startupCheckpoints.set(lifetime, checkpoints);
  }
  return checkpoints;
}

function matchesStartupCheckpoint(prior: StartupCheckpoint | undefined, file: StartupFile | undefined,
  digest: string | undefined): prior is StartupCheckpoint {
  return prior !== undefined && file !== undefined && prior.digest === digest && sameStartupFile(prior.file, file);
}

function checkStartupChanges(database: DatabaseSync, from: StartupPosition): "proved" | "unproved" {
  if (from.schemaCookie !== readIntPragma(database, "schema_version")) return "unproved";
  let entries: readonly ChangeEntry[];
  try {
    const count = changeLogHighWater(database) - from.cursor;
    if (count <= 0 || count > CHANGE_LOG_RETAINED_ENTRIES) return "unproved";
    entries = readAuthorityChanges(database, from.cursor);
    if (entries.length !== count || !entries.every((entry, i) => entry.seq === from.cursor + i + 1)) return "unproved";
  } catch { return "unproved"; }
  assertNativeSchema(database);
  checkSqliteIntegrity(database);
  inspectStoredData(() => validateAuthorityChanges(database, entries, singletonChangeKeys(from.singleton, readSingletonImage(database))));
  inspectStoredData(() => validateNotificationMetadata(database));
  return "proved";
}

/** (cursor, through] is retained whole, runs forward, and names none of the selected tables; a reversed or pruned interval is unproved. */
function changeLogIntervalClear(database: DatabaseSync, cursor: number, through: number, selected: string): boolean {
  if (cursor === through) return true;
  const first = z.strictObject({ seq: z.number().int().positive().nullable() }).parse(
    database.prepare(`SELECT min(seq) AS seq FROM ${CHANGE_LOG_TABLE}`).get()).seq;
  if (through <= cursor || (first ?? through + 1) > cursor + 1) return false;
  // Every seq in (cursor, through] must still be present: an interior gap may have held a selected table's change.
  const present = z.strictObject({ n: z.number().int().nonnegative() }).parse(
    database.prepare(`SELECT count(*) AS n FROM ${CHANGE_LOG_TABLE} WHERE seq > ? AND seq <= ?`).get(cursor, through)).n;
  return present === through - cursor
    && database.prepare(`SELECT 1 FROM ${CHANGE_LOG_TABLE} WHERE seq > ? AND table_name IN (SELECT value FROM json_each(?)) LIMIT 1`).get(cursor, selected) === undefined;
}

/** Calendar proves run ancestry and delegation evidence. Settings and notification-health writes cannot change that proof. */
function calendarChangeIntervalClear(database: DatabaseSync, from: number, through: number): boolean {
  const count = through - from;
  if (count === 0) return true;
  if (count < 0 || count > 256) return false;
  const changes = readAuthorityChanges(database, from, count);
  return changes.length === count && changes.every((change, index) => {
    if (change.seq !== from + index + 1) return false;
    if (change.table === "settings" || change.table === "notification_states") return change.op === "update";
    if (change.table === "settings_snapshots") return change.op === "insert";
    if (change.table !== "commands" && change.table !== "command_audits") return false;
    const settingsImages = change.keys.filter(key => key === "family:settings").length;
    if (change.keys.some(key => key.startsWith("run:"))) return false;
    return change.op === "insert" ? settingsImages === 1
      : change.table === "commands" && change.op === "update" && settingsImages === 2;
  });
}

const SQLITE_DEFAULT_AUTOCHECKPOINT_PAGES = 1000;

export class AuthorityDatabase implements Disposable {
  static async withUpgradeInspections<T>(work: () => Promise<T>): Promise<T> {
    if (upgradeInspections.getStore()?.active) return work();
    const scope = { active: true, images: new Map<string, VerifiedUpgradeImage>(), backupCopies: new Map<string, NativeInspection>() };
    try { return await upgradeInspections.run(scope, work); }
    finally { scope.active = false; scope.images.clear(); scope.backupCopies.clear(); }
  }

  readonly #admission: RuntimeAdmission;
  readonly #admitMutation: () => void;
  #database: DatabaseSync;
  /** The selected account session epoch the assistant stamps on accepted turns; composition binds it. */
  #assistantEpoch: () => number = () => { throw new Error("assistant-epoch-unbound"); };
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #openMode: z.infer<typeof AuthorityDatabaseOpenModeSchema> = "read-write";
  #credentialCommandIds: (commandId: string) => boolean;
  #optimizeOnClose: boolean;
  #closed = false;
  #historyReader?: AuthorityDatabase;
  #checkpointCustodians = 0;
  #historyOwner?: AuthorityDatabase;
  #historyCursorOffset = 0;
  #calendarCache?: { position: ReturnType<AuthorityDatabase["capturedChangeKey"]>; entries: Map<string, CalendarWire> };
  readonly #dashboardReadSources = new Set<symbol>();
  /** Statements reused across reads: only the run lookup a queue read repeats per row, used with get(), never iterate(). */
  #statements: SQLTagStore;
  #openedFileIdentity: DirectoryIdentity | undefined;
  #coldLogout: Readonly<{ machine: RuntimeAdmission; operationId: string; admission: RuntimeAdmission; restore: OfflineMaintenanceOperation;
    sourcePath: string; owner: RuntimeAdmission; inspection: ReturnType<RuntimeAdmission["capturePendingLogoutSnapshot"]> }> | undefined;
  #logoutCompletion: Readonly<{ admission: RuntimeAdmission; operation: LogoutOperation; path: string; binding: Readonly<{ installationId: string; profileId: string }> }> | undefined;
  #logoutPublication: Readonly<{ admission: RuntimeAdmission; operation: LogoutOperation }> | undefined;
  #logoutBatch: Readonly<{ admission: RuntimeAdmission }> | undefined;
  #validatedExternalDataVersion: number | undefined;
  #snapshotExternalDataVersion: number | undefined;
  #lifecycleCommandReadSnapshot: LifecycleCommandBatch | undefined;
  #projectionRowReads: ProjectionRowReads | undefined;
  /** Absent below schema 31, whose readers run the whole-store check after every peer commit. */
  #changeReader: ChangeLogReader | undefined;
  #polledChange: Readonly<{ dataVersion: number; key: ReturnType<AuthorityDatabase["capturedChangeKey"]> }> | undefined;
  #startupOwner?: { checkpoints: Map<string, StartupCheckpoint>; file: StartupFile;
    digest: string; position: StartupPosition; dataVersion: number; inspection?: AuthorityCopyInspection };
  #lastChangePruneMs: number | undefined;
  #temporaryProjectionChanges = 0;
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
  #logWriteFailure: Error | undefined;
  #logPublisher: ((mutation: LogMutation) => void) | undefined;
  #lifecycleHooks: AuthorityLifecycleHooks | undefined;
  #slowOperation: SlowOperationHook | undefined;
  /** Nonzero while an outermost operation is being timed, and again while its hook runs. */
  #slowOperationDepth = 0;

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
    slowOperation?: SlowOperationHook,
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    this.#admission = requireRuntimeAdmission(admission);
    this.#admission.assertAuthorityOpenMode(options.openMode);
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
    this.#optimizeOnClose = purpose === "profile-initialization";
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
    this.#slowOperation = slowOperation;
    this.#path = options.path;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#openMode = options.openMode;
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
    this.#statements = this.#database.createTagStore(1);

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
        if (options.checkpointOwner === "dashboard-navigation") this.holdCheckpointCustody();
        if (existed && purpose === "ordinary") this.#initializeSchema(existingVersion, options.migrationOwner);
      }
      this.#database.exec("BEGIN");
      if (readOnlyNoMigrate) this.#validateReadOnlyNoMigrateDatabase(existingVersion);
      else this.#validateDatabase(existed && (purpose === "ordinary" || purpose === "stopped-startup-recovery"), admittedDataVersion);
      readAppSettings(this.#database);
      if (readIntPragma(this.#database, "user_version") >= CHANGE_LOG_SCHEMA_VERSION) this.#changeReader ??= changeLogBaseline(this.#database);
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
      if (error instanceof AuthoritySchemaVersionError || error instanceof AuthorityFormatUnsupportedError) throw error;
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
    slowOperation?: SlowOperationHook,
  ): AuthorityDatabase {
    admission.assertProfileRuntime();
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const database = new AuthorityDatabase(admission, options, clock, writeCommitHooks, terminalizationHooks, lifecycleHooks, credentials, "ordinary", slowOperation);
    if (options.openMode !== "read-write") return database;
    try {
      database.resumeRunDeletionFiles();
      database.#optimizeOnClose = options.path !== ":memory:";
      return database;
    } catch (error) {
      database.#takeStartupOwner();
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
    return withOperationProof(() => {
      const owner = requireRuntimeAdmission(admission), path = join(owner.stateRoot, "state.db");
      requireStoppedUpgradeSource(owner, path, processLockRoot, clock, true);
      return withAuthorityDatabaseReadOnly(owner, path, database => {
        const inspection = inspectNativeAuthority(database, readIntPragma(database, "user_version"));
        if (inspection.installationId !== undefined && (inspection.installationId !== owner.profileBinding.installationId
          || inspection.profileId !== owner.profileBinding.profileId)) throw new Error("profile-maintenance-binding-mismatch");
        return Object.freeze(browserProfileInventory(database, inspection.schemaVersion));
      });
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
      const settings = readAppSettings(database, convertSettingsRecordRow);
      const configSnapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
        .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", convertSettingsRecordRow("settings_snapshots", row))));
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

  static openStoppedStartupRecovery(admission: RuntimeAdmission, clock: Clock, slowOperation?: SlowOperationHook): AuthorityDatabase {
    admission.assertStoppedStartupRecoveryDatabase(join(admission.stateRoot, "state.db"));
    return new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250,
      migrationOwner: "startup-crash-recovery" }, clock, undefined, undefined, undefined, undefined, "stopped-startup-recovery", slowOperation);
  }

  static openFixedLayoutSource(machine: RuntimeAdmission, admission: RuntimeAdmission, clock: Clock, slowOperation?: SlowOperationHook): AuthorityDatabase {
    admission.assertReadyStoppedProfileLayoutOwner(machine);
    return new AuthorityDatabase(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250,
      migrationOwner: "fixed-layout-source", openMode: "storage-doctor-read-only-no-migrate" }, clock,
      undefined, undefined, undefined, undefined, "stopped-layout-source", slowOperation);
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

  static openStoppedRestoreProjection(admission: RuntimeAdmission, input: unknown, clock: Clock = systemClock, slowOperation?: SlowOperationHook): AuthorityDatabase {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    admission.assertStoppedRestoreProjection(options.path);
    if (options.openMode !== "read-write") throw new Error("profile-restore-projection-mode-refused");
    const inspection = withDirectReaderAdmission(admission, () => inspectExistingDatabaseReadOnly(options.path, options.busyTimeoutMs));
    if (inspection.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-restore-projection-schema-refused");
    admission.assertStoppedRestoreProjection(options.path);
    return new AuthorityDatabase(admission, options, clock, undefined, undefined, undefined, undefined, "stopped-restore-projection", slowOperation);
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
        assertPublishedAssistantNumbering(database);
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

  /** Recreates the exact source schema’s run_search table and rebuilds it in one stopped transaction; nothing else may change. */
  static repairMissingRunSearchProjection(admission: RuntimeAdmission, operation: OfflineMaintenanceOperation, clock: Clock): void {
    admission.assertStoppedProfile(operation);
    const path = join(admission.stateRoot, "state.db");
    requireDatabaseSourcePath(path);
    const database = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false,
      timeout: 250, readBigInts: false, returnArrays: false, allowBareNamedParameters: false, allowUnknownNamedParameters: false, defensive: true });
    let open = false;
    try {
      database.exec("PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; BEGIN IMMEDIATE"); open = true;
      const version = readIntPragma(database, "user_version");
      if (!OPENABLE_AUTHORITY_SCHEMA_VERSIONS.includes(version) || normalizedNativeSchema(database) !== expectedNativeSchema(version, true)) throw new Error("run-search-projection-repair-shape-changed");
      const before = nonProjectionFingerprint(database);
      for (const statement of runSearchDefinitions(version)) database.exec(statement);
      database.exec("UPDATE database_states SET search_generation=NULL,search_state='invalid' WHERE id=1");
      const index = createRunSearchIndex(database), generation = readMetaRow(database).authority_generation, now = clock.now().toISOString();
      const readRun = inspectionRunReader(version);
      index.installTracking();
      let published = index.rebuild({ restart: true, limit: 500 }, generation, now, readRun);
      while (published.state === "building") published = index.rebuild({ limit: 500 }, generation, now, readRun);
      index.validateCoverage(readRun);
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
    const checkpoints = checkpointsFor(machine);
    const prior = checkpoints.get(path);
    let checkpoint: (StartupCheckpoint & { inspection: AuthorityCopyInspection }) | undefined;
    let guarded: ReturnType<typeof readonlyAuthorityImage>;
    const result = AuthorityDatabase.#withRegisteredPersonSnapshot(machine, path, (database, version) => {
      const observation = version === CURRENT_AUTHORITY_SCHEMA_VERSION ? observeReadonlyStartupFile(database, path) : undefined;
      const source = observation?.state === "observed" ? observation.file : undefined;
      const image = source === undefined ? undefined : startupImageDigest(database);
      const digest = image?.state === "observed" ? image.digest : undefined;
      const cached = matchesStartupCheckpoint(prior, source, digest) ? prior.inspection : undefined;
      const inspection = cached === undefined ? inspectNativeAuthority(database, version) : AuthorityCopyInspectionSchema.parse(cached);
      machine.assertOfflineMaintenance(machine.maintenanceOperation());
      if (inspection.installationId !== machine.locator.installationId || inspection.profileId !== id) throw new Error("profile-startup-foreign-binding");
      const journal = readAuthorityUpgradeJournal(database);
      const continuation = journal.journal === "settled" ? journal.latestForward?.startupLogout : undefined;
      const file = continuation === undefined ? undefined : readPrivateFile(join(machine.stateRoot, "machine", "operations", `${continuation.operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
      const nativeContinuation = file !== undefined && canonicalJsonStringify(LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)))) === canonicalJsonStringify(continuation?.operation);
      const context = machine.readInstallationContext();
      if (context === undefined) throw new Error("profile-startup-installation-required");
      const layout = readFixedLayoutIntent(context.workspace);
      const layoutLogout = layout?.phase === "complete" ? layout.profiles.find(plan => plan.profileId === id)?.logout : undefined;
      const layoutFile = layoutLogout?.settlement === undefined ? undefined : readPrivateFile(join(machine.stateRoot, "machine", "operations", `${layoutLogout.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
      const layoutContinuation = layoutFile !== undefined && canonicalJsonStringify(LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(layoutFile.bytes)))) === canonicalJsonStringify(layoutLogout);
      if (source !== undefined && digest !== undefined) {
        checkpoint = { file: source, digest, inspection: AuthorityCopyInspectionSchema.parse(inspection) };
        guarded = readonlyAuthorityImage(database);
      }
      return { ...inspection, requiresContinuation: nativeContinuation || layoutContinuation };
    });
    if (checkpoint !== undefined) {
      checkpoints.set(path, checkpoint);
      const scope = upgradeInspections.getStore();
      if (scope?.active && guarded !== undefined) {
        scope.images.set(guarded.path, { kind: "snapshot", marker: guarded.marker, digest: checkpoint.digest, source: checkpoint.file,
          inspection: structuredClone(checkpoint.inspection) });
      }
    }
    return result;
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
      const inspection = inspectNativeAuthority(database), journal = readAuthorityUpgradeJournal(database);
      const record = journal.journal === "settled" ? journal.latestForward : undefined;
      if (record?.startupLogout === undefined
        || canonicalJsonStringify(record.startupLogout.operation) !== canonicalJsonStringify(operation)) return undefined;
      const settlement = operation.settlement;
      if (record.toSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || !UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS.includes(record.fromSchemaVersion)
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
      const plan = collectEvidenceSchemaAdmissions({ descriptors,
        runs: database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow),
        writes: database.prepare("SELECT * FROM write_intents ORDER BY id").all().map(row => WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", row))),
        results: database.prepare("SELECT * FROM run_results ORDER BY run_id").all().map(row => RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results", row))),
        gates: database.prepare("SELECT * FROM gate_results ORDER BY run_id,node_id").all().map(row => GateResultRecordSchema.parse(nativeOrdinaryRecordFromRow("gate_results", row))),
        delegations: database.prepare("SELECT * FROM run_delegations ORDER BY id").all().map(row => DelegationManifestSchema.parse(nativeOrdinaryRecordFromRow("run_delegations", row))),
        checkpoints: database.prepare("SELECT * FROM run_checkpoints ORDER BY run_id,node_id").all().map(row => RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints", row))) });
      const records = verifiedEvidenceSchemaRecords(database, admission, { installationId: inspection.installationId, profileId: inspection.profileId });
      const pending: EvidenceSchemaConversion[] = [];
      const recorded = (id: EvidenceSchemaConversion["id"], fresh: readonly unknown[], entries: (conversion: EvidenceSchemaConversion) => readonly unknown[]) => {
        const record = records.get(id);
        if (record === undefined) return fresh.length === 0;
        const existing = entries(record.evidenceSchemas).map(entry => canonicalJsonStringify(entry));
        if (fresh.some(entry => !existing.includes(canonicalJsonStringify(entry)))) throw new Error("evidence-schema-conversion-source-changed");
        return true;
      };
      const binding = { installationId: admission.profileBinding.installationId, profileId: admission.profileBinding.profileId };
      if (!recorded("profile-name-domain", plan.admissions, conversion => conversion.id === "profile-name-domain" ? conversion.admissions : []))
        pending.push({ id: "profile-name-domain", ...binding, admissions: [...plan.admissions] });
      if (!recorded("retired-input-generation", plan.retirements, conversion => conversion.id === "retired-input-generation" ? conversion.retirements : []))
        pending.push({ id: "retired-input-generation", ...binding, retirements: [...plan.retirements] });
      return { inspection, admissions: plan.admissions, retirements: plan.retirements, records: [...records.values()], pending };
    });
  }

  static convertEvidenceSchemas(admission: RuntimeAdmission, descriptors: readonly AnyWorkflowDescriptor[], processLockRoot: string,
    clock: Clock, expectedFingerprint: string, backup: VerifiedBackup, verifyBackup: (admission: RuntimeAdmission, path: string) => VerifiedBackup): void {
    admission.assertStoppedProtectedSettingsUpgrade();
    const path = join(admission.stateRoot, "state.db");
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
    const plan = AuthorityDatabase.inspectEvidenceSchemaUpgrade(admission, descriptors);
    // One record per backed source: the journal keys a settled upgrade by its source fingerprint.
    const conversion = plan.pending[0];
    if (conversion === undefined || plan.inspection.authorityContentFingerprint !== expectedFingerprint)
      throw new Error("evidence-schema-conversion-source-changed");
    const verified = verifyBackup(admission, backup.manifestPath), binding = admission.profileBinding;
    if (canonicalJsonStringify(verified) !== canonicalJsonStringify(backup) || verified.manifest.installationId !== binding.installationId
      || verified.manifest.profileId !== binding.profileId || verified.manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION
      || verified.manifest.authorityContentFingerprint !== expectedFingerprint || verified.manifest.authorityGeneration !== plan.inspection.authorityGeneration)
      throw new Error("evidence-schema-conversion-backup-changed");
    const statement = AuthorityEvidenceSchemaUpgradeRecordSchema.omit({ evidenceSchemaMac: true }).parse({ recordKey: randomUUID(), upgradeId: expectedFingerprint, phase: "settled",
      fromSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      planDigest: evidenceSchemaPlanDigest(expectedFingerprint, conversion),
      evidenceSchemas: conversion, backup: { manifestPath: `backups/authority/${backup.manifest.backupFileName}.manifest.json`, sha256: backup.manifest.sha256, authorityGeneration: plan.inspection.authorityGeneration },
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() });
    const record = AuthorityEvidenceSchemaUpgradeRecordSchema.parse({ ...statement, evidenceSchemaMac: admission.sealStoppedEvidenceSchemaConversion(statement) });
    const database = new DatabaseSync(existingDatabaseLocation(path), { enableForeignKeyConstraints: true, timeout: 250 });
    let primary: { error: unknown } | undefined;
    try {
      database.exec("BEGIN EXCLUSIVE");
      try {
        admission.assertStoppedProtectedSettingsUpgrade();
        if (inspectStoppedTransaction(database, path, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint !== expectedFingerprint)
          throw new Error("evidence-schema-conversion-source-changed");
        assertAuthorityUpgradeAppend(database, { type: "convert-evidence", id: conversion.id }, record.phase);
        database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
          .run(record.recordKey, record.upgradeId, record.phase, backup.manifest.sha256, canonicalJsonStringify(record), record.recordedAt);
        const inspection = inspectNativeAuthority(database);
        admission.assertStoppedProtectedSettingsUpgrade();
        commitVerifiedUpgrade(database, path, inspection);
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
      const records = verifiedEvidenceSchemaRecords(this.#database, this.#admission, this.#admission.profileBinding);
      const retired = records.get("retired-input-generation")?.evidenceSchemas;
      const retirement = retired?.id === "retired-input-generation"
        ? retired.retirements.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner)) : undefined;
      if (retirement !== undefined) {
        if (retirement.sourceSchemaHash !== sourceSchemaHash || retirement.sourceDigest !== evidenceSchemaSourceDigest(owner, source))
          throw new Error("evidence-schema-admission-source-changed");
        return sourceSchemaHash;
      }
      const conversion = records.get("profile-name-domain")?.evidenceSchemas;
      const certificate = conversion?.id === "profile-name-domain"
        ? conversion.admissions.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner)) : undefined;
      if (certificate === undefined) return sourceSchemaHash;
      if (certificate.sourceSchemaHash !== sourceSchemaHash || certificate.currentSchemaHash !== currentSchemaHash
        || certificate.sourceDigest !== evidenceSchemaSourceDigest(owner, source)) throw new Error("evidence-schema-admission-source-changed");
      return certificate.currentSchemaHash;
    });
  }

  static inspectStoppedUpgrade(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock,
    snapshotLifetime: "operation" | "reader" = "operation") {
    return withDirectReaderAdmission(admission, () => withOperationProof(() => {
      requireStoppedUpgradeSource(admission, path, processLockRoot, clock, true);
      return withReadonlyAuthoritySnapshot(path, database => inspectNativeAuthority(database, readIntPragma(database, "user_version")), undefined, snapshotLifetime);
    }));
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

  // Returns the pages a committed upgrade freed to the file system. A store with no free pages is left alone (undefined).
  // A failed compaction leaves a larger file, not an unproved store, so it is reported and never retried.
  static compactStopped(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock,
    expected: Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>): "compacted" | "failed" | undefined {
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
    const database = new DatabaseSync(existingDatabaseLocation(path), { enableForeignKeyConstraints: true, timeout: 250 });
    let outcome: "compacted" | "failed" | undefined;
    let primary: { error: unknown } | undefined;
    try {
      if (readIntPragma(database, "user_version") !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-stopped-compaction-version-refused");
      if (readIntPragma(database, "freelist_count") > 0) {
        try { database.exec("VACUUM"); outcome = "compacted"; } catch { outcome = "failed"; }
      }
    } catch (error) { primary = { error }; }
    const failures: unknown[] = [];
    try { database.close(); } catch (error) { failures.push(error); }
    if (failures.length !== 0) throw retainAuthoritySourceClosure(primary === undefined ? failures : [primary.error, ...failures], { database });
    if (primary !== undefined) throw primary.error;
    if (outcome === undefined) return undefined;
    const after = AuthorityDatabase.inspectStoppedUpgrade(admission, path, processLockRoot, clock);
    if (after.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION || after.authorityGeneration !== expected.authorityGeneration
      || after.authorityContentFingerprint !== expected.authorityContentFingerprint) throw new Error("profile-stopped-compaction-authority-changed");
    return outcome;
  }


  readUpgradePhases() {
    return this.withAuthorityReadSnapshot(() => {
      const records = readAuthorityUpgradeRecords(this.#database);
      if (authorityUpgradeJournalOf(records).journal === "empty") return { state: "absent" as const, reason: "journal-empty" as const };
      const phases = records.map(({ phase, fromSchemaVersion, toSchemaVersion, recordedAt }) => ({ phase, fromSchemaVersion, toSchemaVersion, recordedAt }));
      return { state: "available" as const, phases };
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

  static inspectTimelinePageReadOnly(admission: RuntimeAdmission, path: string, input: unknown, pageCount = 1) {
    const request = TimelinePageRequestSchema.parse(input);
    const pages = parseDiagnosticPageCount(pageCount, request.limit);
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
      const highWaterMark = repository.debugHighWaterMark();
      const through = Math.min(request.through ?? highWaterMark, highWaterMark);
      if (request.after > through) throw new Error("timeline-diagnostic-cursor-out-of-range");
      const records: TimelineEventRecord[] = [];
      let nextCursor = request.after;
      for (let page = 0; page < pages; page += 1) {
        const scanned = repository.debugPage({ ...request, after: nextCursor, through });
        for (const record of scanned) {
          assertTimelineOwner(database, record);
          records.push(record);
        }
        nextCursor = scanned.at(-1)?.cursor ?? through;
        if (nextCursor === through) break;
      }
      const failureCauses = request.runId === undefined ? [] : database.prepare("SELECT * FROM run_failures WHERE run_id = ? ORDER BY created_at, id").all(request.runId)
        .map(raw => { const failure = FailureRecordSchema.parse(nativeOrdinaryRecordFromRow("run_failures", raw)); return { failureId: failure.failureId, ...failureCauseNames(failure) }; });
      return { records, failureCauses, after: request.after, nextCursor, through, highWaterMark, hasMore: nextCursor < through };
    });
  }

  /**
   * Visits, in cursor order, every timeline record except notes, with the
   * complete authority identity of the same read-only snapshot. Records are read a page at a time,
   * so the inspection holds no more than one page however long ordinary retention lets the timeline grow.
   * `earlier` re-reads, from the same snapshot, one run's run-scoped events before a cursor.
   */
  static inspectTimelineReadOnly(admission: RuntimeAdmission, path: string, visit: (record: TimelineEventRecord, earlier: EarlierRunEvents) => void,
    busyTimeoutMs = 250, includeRecoveryEvidence = false) {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    let visited = false;
    let recoveryEvidence: Readonly<{
      runs: readonly Readonly<{ runId: RunRecord["envelope"]["runId"]; workflow: string; traceId: string; version: number;
        possibleExternalWrite: boolean; attemptIds: readonly string[]; confirmations: readonly string[] }>[];
      deleted: readonly DeletedRunRecord[];
    }> | undefined;
    const identity = withDirectReaderAdmission(admission, () => inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs, (database) => {
      const metrics = z.object({ largest: z.number().int().nonnegative() }).parse(database.prepare(`
        SELECT COALESCE(max(length(CAST(payload_json AS BLOB))),0) AS largest
        FROM timeline_events WHERE ${INSPECTED_TIMELINE_KINDS}
      `).get());
      if (metrics.largest > 256 * 1024) throw new TimelineRecordError("timeline-doctor-event-limit-exceeded: 262144 bytes");
      // Confirmations survive ordinary retention. Compare their immutable content,
      // independently of mutable run versions and database-local delivery cursors.
      const confirmationsByRun = new Map<string, string[]>();
      const fenced = new Set<string>();
      const page = database.prepare(`SELECT * FROM timeline_events WHERE cursor > ? AND ${INSPECTED_TIMELINE_KINDS} ORDER BY cursor LIMIT 500`);
      const runPage = database.prepare(`SELECT * FROM timeline_events WHERE run_id = ? AND cursor > ? AND cursor < ?
        AND kind <> 'run.queued' AND ${INSPECTED_TIMELINE_KINDS} ORDER BY cursor LIMIT 500`);
      const earlier: EarlierRunEvents = (runId, before, each) => {
        for (let after = 0; ;) {
          const rows = runPage.all(runId, after, before);
          for (const raw of rows) {
            const record = timelineEventFromRow(raw);
            after = record.cursor;
            each(record);
          }
          if (rows.length < 500) return;
        }
      };
      for (let after = 0; ;) {
        const rows = page.all(after);
        for (const raw of rows) {
          const record = timelineEventFromRow(raw);
          after = record.cursor;
          if (record.payload.kind === "operation-confirmed" && record.scope.kind === "run") {
            const digest = createHash("sha256").update(timelineAppendContent(record)).digest("hex");
            const owned = confirmationsByRun.get(record.scope.runId);
            if (owned === undefined) confirmationsByRun.set(record.scope.runId, [digest]);
            else owned.push(digest);
          } else if (record.payload.kind === "span" && record.payload.event.t === "transaction.fenced") fenced.add(record.payload.event.runId);
          visit(record, earlier);
        }
        if (rows.length < 500) break;
      }
      visited = true;
      if (!includeRecoveryEvidence) return;
      const attempts = database.prepare("SELECT * FROM write_attempts").all().map((row) =>
        WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts", row)));
      const attemptsByRun = new Map<string, WriteAttemptRecord[]>();
      for (const attempt of attempts) {
        const owned = attemptsByRun.get(attempt.runId);
        if (owned === undefined) attemptsByRun.set(attempt.runId, [attempt]);
        else owned.push(attempt);
      }
      const runs = Array.from(readRunPages(database), (raw) => {
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
    if (!visited || (includeRecoveryEvidence && recoveryEvidence === undefined)) throw new Error("timeline-read-snapshot-missing");
    return { ...identity, recoveryEvidence };
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
      const afterClose = stoppedLogoutAuthorityFileWitnesses(admission.stateRoot);
      const closedSource = fileStatus(path);
      if (!sameDirectory({ device: closedSource.dev, inode: closedSource.ino }, operation.source.database)) throw new Error("profile-logout-native-source-changed");
      const copied = withAuthorityDatabaseReadOnly(admission, path, native => inspectNativeAuthority(native, CURRENT_AUTHORITY_SCHEMA_VERSION));
      if (copied.installationId !== observed.installationId || copied.profileId !== observed.profileId || copied.schemaVersion !== observed.schemaVersion
        || copied.authorityGeneration !== observed.authorityGeneration || copied.authorityContentFingerprint !== observed.authorityContentFingerprint
        || canonicalJsonStringify(stoppedLogoutAuthorityFileWitnesses(admission.stateRoot)) !== canonicalJsonStringify(afterClose)) throw new Error("profile-logout-native-source-changed");
      inspection = admission.capturePendingLogoutSnapshot(); snapshot = inspection.snapshot; copyAdmission = inspection.admission;
      database = new AuthorityDatabase(copyAdmission, { path: snapshot.path, busyTimeoutMs: 250, migrationOwner: "profile-logout-inspection", openMode: "storage-doctor-read-only-no-migrate" }, this.#clock,
        undefined, undefined, undefined, undefined, "stopped-logout-inspection");
      const { probeStoppedProfileBrowsersClosed } = await import("../maintenance/profile-inventory.js");
      await probeStoppedProfileBrowsersClosed(admission, this.#clock, profileBrowserClosure);
      admission.assertPendingLogoutSettlementDatabase(path);
      if (inspectNativeAuthority(database.#database, CURRENT_AUTHORITY_SCHEMA_VERSION).authorityContentFingerprint !== copied.authorityContentFingerprint
        || canonicalJsonStringify(stoppedLogoutAuthorityFileWitnesses(admission.stateRoot)) !== canonicalJsonStringify(afterClose)) throw new Error("profile-logout-native-source-changed");
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

  /** The dashboard can read both histories. Workers and command handlers retain this operational store. */
  dashboardHistory(): AuthorityDatabase {
    const owner = this.#admission;
    owner.assertProfileRuntime();
    if (this.#historyReader !== undefined) return this.#historyReader;
    if (!(owner.lifetime instanceof RuntimeLifetimeLock) || owner.lifetime.port === runtimeProfiles.production.lockPort) return this;
    const path = historyArchivePath(owner.stateRoot);
    if (fileStatus(path, true) === undefined) return this;
    const reader = new AuthorityDatabase(owner, { path: this.#path, busyTimeoutMs: this.#busyTimeoutMs,
      migrationOwner: "isolated-dashboard-history", openMode: "storage-doctor-read-only-no-migrate" }, this.#clock);
    try {
      // The native connection opened read-only. Allow TEMP views and paging tables on this connection alone.
      reader.#database.exec("PRAGMA query_only=OFF; PRAGMA trusted_schema=OFF");
      reader.#historyCursorOffset = attachHistoryArchive(reader.#database, path, owner.profileBinding);
      reader.#historyOwner = this;
      this.#historyReader = reader;
      return reader;
    } catch (error) { reader.close(); throw error; }
  }

  /**
   * The read lane's counterpart of dashboardHistory(): the archive its host admitted, attached on a second read-only
   * connection whose validation runs on this one. The archive file and its logical cursor offset must match the host's.
   */
  readLaneHistory(archive: Readonly<{ path: string; identity: Readonly<z.infer<typeof FileIdentitySchema>>; cursorOffset: number }> | undefined): AuthorityDatabase {
    this.#assertOpen();
    const owner = this.#admission;
    owner.assertProfileRuntime();
    if (this.#openMode !== "dashboard-read-worker-read-only-no-migrate" || this.#historyOwner !== undefined) throw new Error("read-lane-history-owner-required");
    if (archive === undefined) return this;
    if (this.#historyReader !== undefined) throw new Error("read-lane-history-already-attached");
    if (archive.path !== historyArchivePath(owner.stateRoot)) throw new Error("read-lane-history-path-refused");
    const admitArchive = () => {
      const status = fileStatus(archive.path);
      if (!status.isFile() || BigInt(status.nlink) !== 1n || privatePathRejects(archive.path, status, "group-write")
        || !sameDirectory({ device: String(status.dev), inode: String(status.ino) }, archive.identity)) throw new Error("read-lane-history-source-changed");
    };
    admitArchive();
    const reader = new AuthorityDatabase(owner, { path: this.#path, busyTimeoutMs: this.#busyTimeoutMs,
      migrationOwner: "dashboard-read-lane-history", openMode: "dashboard-read-worker-read-only-no-migrate" }, this.#clock);
    try {
      // A lane never writes the archive: one that is stale or missing an index is refused, not upgraded.
      reader.#historyCursorOffset = attachHistoryArchive(reader.#database, archive.path, owner.profileBinding, "validate");
      admitArchive();
      if (reader.#historyCursorOffset !== archive.cursorOffset) throw new Error("read-lane-history-cursor-mismatch");
      reader.#historyOwner = this;
      this.#historyReader = reader;
      return reader;
    } catch (error) { reader.close(); throw error; }
  }

  /**
   * Inside a read snapshot: the change log's high water, and whether (since, high water] is proved to touch none of tables.
   * The same interval test trackAuthorityTables runs.
   */
  readChangeInterval(since: number, tables: readonly AuthorityTableName[]): Readonly<{ through: number; clear: boolean }> {
    this.#assertOpen();
    if (this.#transactionMode !== "read") throw new Error("change-interval-read-snapshot-required");
    const through = changeLogHighWater(this.#database);
    return Object.freeze({ through, clear: changeLogIntervalClear(this.#database, since, through, JSON.stringify(z.array(AuthorityTableNameSchema).min(1).parse(tables))) });
  }

  /**
   * A dashboard read host's checkpoint lane takes WAL checkpoints from this writer: its commits stop checkpointing
   * automatically until the returned release restores SQLite's default.
   */
  holdCheckpointCustody(): () => void {
    this.#assertOpen();
    if (this.#checkpointCustodians++ === 0) this.#database.exec("PRAGMA wal_autocheckpoint=0");
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (--this.#checkpointCustodians === 0 && this.#database.isOpen) {
        this.#database.exec(`PRAGMA wal_autocheckpoint=${String(SQLITE_DEFAULT_AUTOCHECKPOINT_PAGES)}`);
      }
    };
  }

  /** The writer's automatic checkpoint interval in pages; 0 while a read host holds checkpoint custody. */
  autoCheckpointPages(): number {
    this.#assertOpen();
    return z.strictObject({ wal_autocheckpoint: z.number().int() }).parse(this.#database.prepare("PRAGMA wal_autocheckpoint").get()).wal_autocheckpoint;
  }

  /** A read lane exits rather than read again from a connection a failed rollback left inside a transaction. */
  hasOpenTransaction(): boolean {
    return this.#database.isOpen && this.#database.isTransaction;
  }

  timelineCursorOffset(): number {
    this.#assertOpen();
    return this.#historyCursorOffset;
  }

  /** Proves this open store is the person's own state.db, opened by exactly this live, exclusive admission. */
  assertOpenedByExclusive(admission: RuntimeAdmission): void {
    if (this.#admission !== admission) throw new Error("authority-database-owner-mismatch");
    this.#assertOpen(); admission.assertExclusive(); admission.assertAuthorityDatabase(this.#path);
    if (resolve(this.#path) !== join(admission.stateRoot, "state.db")) throw new Error("authority-database-owner-mismatch");
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

  #takeStartupOwner() {
    const owner = this.#startupOwner;
    this.#startupOwner = undefined;
    return owner;
  }

  /** Keep the writable WAL connection open until the background reader's native connection has exited. */
  retainDashboardReadSource(admission: RuntimeAdmission, identity: Readonly<z.infer<typeof FileIdentitySchema>>): () => void {
    this.#assertOpen();
    admission.assertProfileRuntime();
    if (admission !== this.#admission || resolve(this.#path) !== join(admission.stateRoot, "state.db")
      || this.#openedFileIdentity === undefined || !sameDirectory(this.#openedFileIdentity, identity)
      || readIntPragma(this.#database, "query_only") !== 0 || readTextPragma(this.#database, "journal_mode") !== "wal") {
      throw new Error("dashboard-background-source-mismatch");
    }
    const reader = Symbol();
    this.#dashboardReadSources.add(reader);
    return () => { this.#dashboardReadSources.delete(reader); };
  }

  close(): void {
    if (this.#closed) return;
    this.#historyReader?.close();
    if (this.#dashboardReadSources.size > 0) throw new Error("dashboard-background-reader-open");
    if (this.#transactionDepth !== 0) throw new Error("cannot close authority database during a transaction");
    let plannerFailure: { error: unknown } | undefined;
    if (this.#logWriteFailure === undefined && this.#optimizeOnClose && !this.#database.isTransaction) {
      let admitted = false;
      try {
        this.#admitMutation();
        const file = fileStatus(this.#path, true);
        admitted = file !== undefined && this.#openedFileIdentity !== undefined
          && sameDirectory(this.#openedFileIdentity, { device: file.dev, inode: file.ino });
      } catch { /* A failed ownership check only skips planner maintenance. */ }
      if (admitted) {
        try { optimizeAuthorityPlanner(this.#database); }
        catch (error) {
          // Another writer can hold the WAL lock during optional shutdown maintenance.
          if (!(error instanceof Error && "errcode" in error && error.errcode === 5)) plannerFailure = { error };
        }
      }
    }
    const owner = this.#takeStartupOwner();
    let checkpoint: StartupCheckpoint | undefined;
    if (owner !== undefined) {
      try {
        const db = this.#database;
        if (!db.isTransaction) {
          db.exec("PRAGMA busy_timeout=0; BEGIN");
          const cookie = readIntPragma(db, "schema_version"); // Pin the snapshot before observing peer commits.
          const observation = readStartupFile(this.#path, owner.file.wal === null ? AUTHORITY_WAL_SIZE_LIMIT_BYTES : undefined);
          const file = observation.state === "observed" ? observation.file : undefined;
          let candidate: StartupCheckpoint | undefined;
          if (file !== undefined && file.identity === owner.file.identity && file.main === owner.file.main && cookie === owner.position.schemaCookie
            && readIntPragma(db, "data_version") === owner.dataVersion) {
            const image = startupImageDigest(db);
            const digest = image.state === "observed" ? image.digest : undefined;
            if (digest === owner.digest && file.wal === owner.file.wal) candidate = { file, digest, inspection: owner.inspection };
            else if (digest !== undefined && owner.file.wal === null && file.wal !== null
              && this.#changeReader !== undefined && this.#changeReader.failed === undefined && this.#changeReader.cursor === changeLogHighWater(db)
              && this.#changeReader.cursor > owner.position.cursor) {
              candidate = { file, digest, pending: owner.position };
            }
          }
          db.exec("ROLLBACK");
          checkpoint = candidate;
        }
      } catch { /* Native close still releases the read transaction. No cache proof was published. */ }
    }
    try { this.#database.close(); }
    catch (error) { this.#failNativeClosure(plannerFailure === undefined ? [error] : [plannerFailure.error, error]); }
    this.#closed = true;
    if (owner !== undefined && checkpoint !== undefined) {
      // The last SQLite close can checkpoint the WAL into the main file.
      const observation = readStartupFile(this.#path);
      const file = observation.state === "observed" ? observation.file : undefined;
      if (file !== undefined && file.identity === checkpoint.file.identity &&
        ((file.main === checkpoint.file.main && file.wal === checkpoint.file.wal) || (file.wal === null && file.main === checkpoint.digest))) {
        owner.checkpoints.set(this.#path, { ...checkpoint, file });
      }
    }
    if (plannerFailure !== undefined) throw plannerFailure.error;
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

  /** Generation, other connections' commits, and this connection's commits excluding temporary projections. */
  changeKey(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }> {
    this.#assertOpen();
    const key = this.#rawChangeKey();
    return Object.freeze({ ...key, totalChanges: key.totalChanges - this.#temporaryProjectionChanges });
  }

  /** What `trackAuthorityTables` revisions read: change-log high water and schema cookie, both still across debug-only commits. */
  capturedChangeKey(): Readonly<{ changeLogSeq: number; schemaCookie: number }> {
    this.#assertOpen();
    return Object.freeze({ changeLogSeq: changeLogHighWater(this.#database), schemaCookie: readIntPragma(this.#database, "schema_version") });
  }

  /** Idle hint only. Read and write paths still admit their own authority access. */
  pollCapturedChangeKey(): ReturnType<AuthorityDatabase["capturedChangeKey"]> {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
    if (this.#database.isTransaction) return this.capturedChangeKey();

    // data_version covers peer commits, and the log and cookie also observe this connection's changes.
    const dataVersion = readIntPragma(this.#database, "data_version");
    const changeLogSeq = changeLogHighWater(this.#database);
    const schemaCookie = readIntPragma(this.#database, "schema_version");
    const previous = this.#polledChange;
    if (previous?.dataVersion === dataVersion && previous.key.changeLogSeq === changeLogSeq && previous.key.schemaCookie === schemaCookie) {
      return previous.key;
    }
    this.#polledChange = undefined;
    this.#assertOpen();
    const key = Object.freeze({ changeLogSeq, schemaCookie });
    this.#polledChange = { dataVersion, key };
    return key;
  }

  /** An independent revision for a reader's authority sources, backed by the retained change log. */
  trackAuthorityTables(tables: readonly AuthorityTableName[], mode: "validated" | "poll-hint" = "validated"): () => number | undefined {
    const selected = JSON.stringify(z.array(AuthorityTableNameSchema).min(1).parse(tables));
    let cursor: number | undefined;
    let revision = 0;
    let schemaCookie: number | undefined;
    return () => {
      if (this.#transactionMode === "authority" || this.#transactionMode === "projection") return undefined;
      if (mode === "poll-hint") {
        const key = this.pollCapturedChangeKey();
        if (cursor === key.changeLogSeq && schemaCookie === key.schemaCookie) return revision;
      }
      return this.#withReadSnapshot(() => {
        if (mode === "validated") this.#validateExternalQuerySources();
        const through = changeLogHighWater(this.#database);
        if (mode === "poll-hint") {
          const cookie = readIntPragma(this.#database, "schema_version");
          // Schema changes and large tails wake the observer without scanning the full log here.
          const uncertain = cursor !== undefined && (cookie !== schemaCookie || through < cursor || through - cursor > 256);
          schemaCookie = cookie;
          if (uncertain) { cursor = through; return ++revision; }
        }
        if (cursor === through) return revision;
        if (cursor !== undefined && !changeLogIntervalClear(this.#database, cursor, through, selected)) revision += 1;
        cursor = through;
        return revision;
      });
    };
  }

  /** Revisions for reads scoped to one run, on tables whose change keys name their owning run. */
  trackAuthorityRuns(tables: readonly AuthorityTableName[]): () => ((id: string) => number) | undefined {
    const selected = new Set<string>(tables);
    const revisions = new Map<string, number>();
    let previous: ReturnType<AuthorityDatabase["capturedChangeKey"]> | undefined;
    let revision = 0;
    const runRevision = (id: string): number => {
      const held = revisions.get(id);
      if (held !== undefined) return held;
      if (revisions.size >= 1024) {
        const oldest = revisions.keys().next().value;
        if (oldest !== undefined) revisions.delete(oldest);
      }
      revisions.set(id, ++revision);
      return revision;
    };
    return () => {
      if (this.#transactionMode === "authority" || this.#transactionMode === "projection") return undefined;
      return this.#withReadSnapshot(() => {
        this.#validateExternalQuerySources();
        const current = this.capturedChangeKey();
        if (previous !== undefined) {
          const count = current.changeLogSeq - previous.changeLogSeq;
          if (current.schemaCookie !== previous.schemaCookie || count < 0 || count > CHANGE_LOG_RETAINED_ENTRIES) revisions.clear();
          else if (count > 0) {
            const changes = readAuthorityChanges(this.#database, previous.changeLogSeq, count);
            if (changes.length !== count) revisions.clear();
            else for (const change of changes) {
              if (!selected.has(change.table)) continue;
              for (const key of change.keys) {
                if (key.startsWith("run:")) revisions.delete(key.slice(4));
              }
            }
          }
        }
        previous = current;
        return runRevision;
      });
    };
  }

  checkQueueDaySources(day: string, previous?: number | Readonly<{
    through: number;
    retryConfigFingerprint: string | undefined;
    runIds: readonly string[];
    timelineRunIds: readonly string[];
    lastWorkerClaims: readonly { workerId: string; cursor: number | null }[];
    relationships: readonly { runId: string; parentId: string | null; workflowId: string; itemId: string; day: string }[];
    month: { from: string; to: string; counts: readonly { day: string; count: number }[] };
  }>): { through: number; kind: "full"; retryConfigFingerprint: string | undefined } | { through: number; kind: "unchanged" }
    | { through: number; kind: "runs"; runIds: readonly string[]; dayRunIds: readonly string[]; countDays: readonly string[] } | undefined {
    if (this.#transactionMode === "authority" || this.#transactionMode === "projection") return undefined;
    return this.#withReadSnapshot(() => {
      this.#validateExternalQuerySources();
      const through = changeLogHighWater(this.#database);
      const retryConfigFingerprint = () => {
        const settings = readAppSettings(this.#database);
        const active = settings?.active;
        if (active == null || settings?.saved != null && (settings.saved.revision !== active.settingsRevision
          || settings.saved.settingsFingerprint !== active.settingsFingerprint)) return undefined;
        return active.configFingerprint;
      };
      const full = () => ({ through, kind: "full" as const, retryConfigFingerprint: retryConfigFingerprint() });
      if (previous === undefined) return full();
      if (typeof previous === "number") return through === previous ? { through, kind: "unchanged" }
        : { through, kind: "full", retryConfigFingerprint: undefined };
      if (through === previous.through) return { through, kind: "unchanged" };
      const retained = z.object({ count: z.number().int().nonnegative() }).parse(
        this.#database.prepare(`SELECT count(*) AS count FROM ${CHANGE_LOG_TABLE} WHERE seq > ?`).get(previous.through));
      if (retained.count !== through - previous.through) return full();

      // Ordinary preferences can advance Settings and append a snapshot while leaving Retry eligibility unchanged.
      const settingsChange = this.#database.prepare(`SELECT op, table_name FROM ${CHANGE_LOG_TABLE}
        WHERE seq > ? AND table_name IN ('settings','settings_snapshots')
        ORDER BY (table_name = 'settings_snapshots' AND op <> 'insert') DESC LIMIT 1`).get(previous.through);
      if (settingsChange !== undefined) {
        const fingerprint = retryConfigFingerprint();
        if (fingerprint === undefined || fingerprint !== previous.retryConfigFingerprint
          || settingsChange.table_name === "settings_snapshots" && settingsChange.op !== "insert") {
          return { through, kind: "full", retryConfigFingerprint: fingerprint };
        }
      }

      const sharedChange = this.#database.prepare(`WITH changed_runs(id) AS (
          SELECT DISTINCT json_extract(row_key,'$[0]') FROM ${CHANGE_LOG_TABLE} WHERE seq > ? AND table_name = 'runs'
        ), new_journal_rows(table_name,row_key) AS (
          SELECT table_name,row_key FROM ${CHANGE_LOG_TABLE}
          WHERE seq > ? AND op='insert' AND table_name IN ('commands','command_audits')
        ),
        observed_runs(id) AS (SELECT value FROM json_each(?)),
        observed_timelines(key) AS (SELECT 'run:' || value FROM json_each(?)),
        observed_claims(worker_id, cursor) AS (
          SELECT json_extract(value, '$.workerId'), json_extract(value, '$.cursor') FROM json_each(?)
        )
        SELECT 1 FROM ${CHANGE_LOG_TABLE} change WHERE seq > ? AND (
        table_name IN ('run_batches','run_delegations','delegation_dependencies','run_checkpoints',
          'gate_results','run_failures','run_receipts','write_intents','write_attempts','dryrun_results',
          'worker_pools','worker_slots','auth_leases','ocr_review_revisions','ocr_approved_snapshots','ocr_source_uploads')
        OR (table_name = 'run_results' AND (
          NOT EXISTS (SELECT 1 FROM json_each(change.keys_json) WHERE value LIKE 'run:%')
          OR EXISTS (SELECT 1 FROM json_each(change.keys_json) WHERE value LIKE 'run:%' AND substr(value,5) NOT IN (SELECT id FROM changed_runs))
        ))
        OR (table_name = 'deleted_runs' AND (json_extract(row_key,'$[0]') NOT IN (SELECT id FROM changed_runs)
          OR json_extract(row_key,'$[0]') NOT IN (SELECT id FROM observed_runs)))
        OR (table_name IN ('commands','command_audits') AND (
          op = 'delete'
          OR EXISTS (SELECT 1 FROM json_each(change.keys_json) key
            LEFT JOIN commands command ON command.id = substr(key.value, length('command:') + 1)
            WHERE key.value LIKE 'command:%' AND (
              command.target_id IN (SELECT id FROM observed_runs)
              OR (command.family = 'application' AND json_extract(command.request_json, '$.type') = 'pause-all-and-quit')
              OR (command.family = 'run-lifecycle' AND json_extract(command.request_json, '$.operation') = 'application-admission')
            ))
          OR EXISTS (SELECT 1 FROM ${RUN_REFERENCES_TABLE} reference
            WHERE reference.table_name = change.table_name AND reference.row_key = change.row_key
              AND reference.run_id IN (SELECT id FROM observed_runs))
        ) AND NOT (op <> 'delete' AND (table_name,row_key) IN (SELECT table_name,row_key FROM new_journal_rows)
          AND (SELECT count(DISTINCT value) FROM json_each(change.keys_json) WHERE value LIKE 'command:%') = 1
          AND NOT EXISTS (SELECT 1 FROM ${RUN_REFERENCES_TABLE} ref WHERE ref.table_name = change.table_name
            AND ref.row_key = change.row_key AND ref.run_id NOT IN (SELECT id FROM changed_runs))
          AND EXISTS (SELECT 1 FROM json_each(change.keys_json) key JOIN commands c ON key.value = 'command:' || c.id
            WHERE (c.family = 'run' AND json_extract(c.request_json,'$.type') = 'rename'
                AND json_extract(c.request_json,'$.target.runId') IN (SELECT id FROM changed_runs))
              OR (c.family = 'run-lifecycle' AND json_extract(c.request_json,'$.operation') IN ('transition','delete')
                AND json_extract(c.request_json,'$.request.runId') IN (SELECT id FROM changed_runs))
        )))
        OR (table_name = 'timeline_events' AND (
          EXISTS (SELECT 1 FROM json_each(change.keys_json) key WHERE key.value IN (SELECT key FROM observed_timelines))
          OR CAST(json_extract(change.row_key, '$[0]') AS INTEGER) IN (SELECT cursor FROM observed_claims)
          OR EXISTS (
            SELECT 1 FROM timeline_events event JOIN observed_claims claim
              ON claim.worker_id = json_extract(event.payload_json, '$.payload.event.workerId')
            WHERE event.cursor = CAST(json_extract(change.row_key, '$[0]') AS INTEGER)
              AND event.kind = 'run.claimed' AND event.cursor > COALESCE(claim.cursor, 0)
          )
        ))
      ) LIMIT 1`).get(previous.through, previous.through, JSON.stringify(previous.runIds), JSON.stringify(previous.timelineRunIds),
        JSON.stringify(previous.lastWorkerClaims), previous.through);
      if (sharedChange !== undefined) return full();

      const changedRuns = this.#database.prepare(`SELECT 1 FROM ${CHANGE_LOG_TABLE}
        WHERE seq > ? AND table_name = 'runs' LIMIT 1`).get(previous.through);
      if (changedRuns === undefined) return { through, kind: "unchanged" };
      // Old observations catch deletions. Current rows also catch arrivals on the day, new descendants,
      // and other attempts whose eligibility is visible on a cached row.
      const relationships = JSON.stringify(previous.relationships);
      const relatedChange = this.#database.prepare(`WITH RECURSIVE changed(id) AS (
          SELECT DISTINCT json_extract(row_key, '$[0]') FROM ${CHANGE_LOG_TABLE} WHERE seq > ? AND table_name = 'runs'
        ), ancestry(id) AS (
          SELECT id FROM changed
          UNION
          SELECT runs.parent_id FROM ancestry JOIN runs ON runs.id = ancestry.id WHERE runs.parent_id IS NOT NULL
        )
        SELECT 1 FROM ancestry JOIN json_each(?) observed ON observed.value = ancestry.id
        UNION ALL
        SELECT 1 FROM changed JOIN runs ON runs.id = changed.id WHERE runs.local_day = ? OR EXISTS (
          SELECT 1 FROM json_each(?) item WHERE runs.workflow = json_extract(item.value, '$.workflowId')
            AND runs.item_id = json_extract(item.value, '$.itemId')
        ) LIMIT 1`).get(previous.through, JSON.stringify(previous.runIds), day, relationships);
      if (relatedChange === undefined) {
        const { from, to, counts } = previous.month;
        const current = this.readQueueDayCounts(from, to);
        if (current.size === counts.length && counts.every(entry => current.get(entry.day) === entry.count)) return { through, kind: "unchanged" };
      }

      // A removed or moved row can still affect its former parent or other attempts of its item.
      // Without the old relationship or an insertion in this interval, only a full read is proven.
      const unknown = this.#database.prepare(`SELECT 1 FROM ${CHANGE_LOG_TABLE}
        WHERE seq > ? AND table_name = 'runs' GROUP BY row_key
        HAVING min(CASE op WHEN 'insert' THEN seq END) IS NOT min(seq)
          AND json_extract(row_key,'$[0]') NOT IN (SELECT json_extract(value,'$.runId') FROM json_each(?))
        LIMIT 1`).get(previous.through, relationships);
      if (unknown !== undefined) return full();

      const rows = this.#database.prepare(`WITH RECURSIVE facts(id,parent,workflow,item) AS (
          SELECT id,parent_id,workflow,item_id FROM runs
          UNION SELECT json_extract(value,'$.runId'),json_extract(value,'$.parentId'),
            json_extract(value,'$.workflowId'),json_extract(value,'$.itemId') FROM json_each(?)
        ), changed(id) AS (
          SELECT DISTINCT json_extract(row_key,'$[0]') FROM ${CHANGE_LOG_TABLE} WHERE seq > ? AND table_name = 'runs'
        ), family(id) AS (
          SELECT id FROM changed
          UNION SELECT f.parent FROM family a JOIN facts f ON f.id=a.id WHERE f.parent IS NOT NULL
          UNION SELECT f.id FROM family a JOIN facts f ON f.parent=a.id
        ), affected(id) AS (
          SELECT id FROM family
          UNION SELECT f.parent FROM affected a JOIN facts f ON f.id=a.id WHERE f.parent IS NOT NULL
          UNION SELECT f.id FROM affected a JOIN facts f ON f.parent=a.id
          UNION SELECT peer.id FROM affected a JOIN facts f ON f.id=a.id JOIN facts peer ON peer.workflow=f.workflow AND peer.item=f.item
        ) SELECT affected.id, runs.local_day, affected.id IN (SELECT id FROM family) AS count_family
          FROM affected LEFT JOIN runs ON runs.id=affected.id`).all(relationships, previous.through);
      const affected = z.array(z.strictObject({ id: RunIdSchema, local_day: z.iso.date().nullable(), count_family: z.union([z.literal(0), z.literal(1)]) })).parse(rows);
      // Only changed physical families can change the calendar. Item peers affect row actions.
      const family = new Set<string>(affected.filter(row => row.count_family === 1).map(row => row.id));
      const countDays = new Set(previous.relationships.filter(row => family.has(row.runId)).map(row => row.day));
      for (const row of affected) if (row.local_day !== null && family.has(row.id)) countDays.add(row.local_day);
      return { through, kind: "runs", countDays: [...countDays], runIds: affected.map(row => row.id), dayRunIds: affected.filter(row => row.local_day === day).map(row => row.id) };
    });
  }

  #rawChangeKey(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }> {
    const totalChanges = z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#database.prepare("SELECT total_changes() AS count").get()).count;
    return { authorityGeneration: this.#readMetaRow().authority_generation, dataVersion: readIntPragma(this.#database, "data_version"), totalChanges };
  }

  #readActiveRuns(): RunRecord[] {
    const pageSize = 500;
    const bounds = this.#database.prepare(`SELECT max(id) AS last, count(*) AS count FROM (
      SELECT id FROM runs WHERE id >= ? ORDER BY id LIMIT ?)`);
    // Only omit a terminal row when a single stored lifecycle state confirms it.
    const active = this.#database.prepare(`SELECT * FROM runs WHERE id BETWEEN ? AND ? AND (
      state <> 'terminal' OR (
        SELECT count(*) = 1 AND min(CASE lifecycle.type WHEN 'object' THEN (
          SELECT count(*) = 1 AND min(state.value IS 'terminal')
          FROM json_each(lifecycle.value) AS state WHERE state.key = 'state'
        ) ELSE 0 END)
        FROM json_each(runs.lifecycle_json) AS lifecycle WHERE lifecycle.key = 'lifecycle'
      ) IS NOT 1
    ) ORDER BY id`);
    const pageBounds = z.strictObject({ last: z.string().nullable(), count: z.number().int().nonnegative() });
    const runs: RunRecord[] = [];
    let after: string | undefined;
    for (;;) {
      const start = after ?? "";
      const { last, count } = pageBounds.parse(bounds.get(start, pageSize));
      if (last === null) return runs;
      for (const row of active.all(start, last)) {
        if (row.id === after) continue;
        if (row.state === "terminal") throw new Error("run row state does not match its whole-record JSON");
        runs.push(runRecordFromRow(row));
      }
      if (count < pageSize) return runs;
      after = last;
    }
  }

  readApplicationActivity(runScope: "non-terminal-runs"): RunRecord[];
  readApplicationActivity(runScope?: "all" | "non-terminal"): Readonly<{
    runs: PredecessorRunRecord[];
    writeIntents: WriteIntentRecord[];
    duoLeases: DuoCeremonyLeaseRecord[];
    pendingArtifacts: readonly ArtifactOutboxStorageRecord[];
  }>;
  readApplicationActivity(runScope: "all" | "non-terminal" | "non-terminal-runs" = "all") {
    this.#assertOpen();
    return this.#withReadSnapshot(() => {
      if (runScope === "non-terminal-runs") return this.#readActiveRuns();
      const runs: PredecessorRunRecord[] = runScope === "all"
        ? this.#database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow)
        : this.#readActiveRuns();
      return Object.freeze({
        runs,
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
    // Active executions and external-write recovery cannot lose evidence; read under each lock that acts on it.
    const evidenceSettled = (runId: string) => {
      const run = this.authority.runs.get(runId);
      if (run === undefined) throw new Error("diagnostic-retention-run-missing");
      return run.lifecycle.state === "terminal" && !this.authority.writeIntents.listByRun(runId).some(intent => intent.status !== "committed");
    };
    const refOf = (attachment: DiagnosticBundle["attachments"][number]) => ArtifactRefSchema.parse({ id: attachment.artifactId,
      sha256: attachment.digest, bytes: attachment.byteLength, mediaType: attachment.mediaType });
    const readOwned = (bundleId: string) => {
      const current = this.#readRecord("diagnostic_snapshots", bundleId, DiagnosticBundleSchema);
      if (current === undefined || current.retention.kind !== "ordinary") throw new Error("diagnostic-retention-owner-changed");
      return current;
    };
    const write = (record: DiagnosticBundle) => sqliteChanges(this.#database.prepare("UPDATE diagnostic_snapshots SET payload_json=? WHERE id=?")
      .run(canonicalJsonStringify(DiagnosticBundleSchema.parse(record)), record.bundleId).changes);
    // Bytes a purged bundle shares stay while that bundle's run is active again.
    const heldByActivePurge = (ref: ArtifactRef, bundleId: string) => this.#database.prepare(`SELECT DISTINCT s.run_id AS runId
      FROM diagnostic_files f JOIN diagnostic_snapshots s ON s.id=f.snapshot_id
      WHERE f.digest=? AND s.id<>? AND json_extract(s.payload_json,'$.availability.state')='purged'`).all(ref.sha256, bundleId)
      .some(row => !evidenceSettled(z.strictObject({ runId: RunIdSchema }).parse(row).runId));
    for (const raw of due) {
      const bundle = this.#parseNativeRow("diagnostic_snapshots", raw, DiagnosticBundleSchema);
      const marked = this.#authorityWrite("diagnostic_snapshots", () => {
        if (!evidenceSettled(bundle.runId)) return { result: undefined, changes: 0 };
        const current = readOwned(bundle.bundleId);
        if (current.availability !== undefined) return { result: "earlier" as const, changes: 0 };
        return { result: "now" as const, changes: write({ ...current, availability: { state: "purged", at: instant, reason: "retention" } }) };
      });
      if (marked === undefined) continue;
      // One lock owns every byte removal of the bundle, so a requeue cannot fall between two attachments.
      const removed = this.#authorityWrite("diagnostic_snapshots", () => {
        if (!evidenceSettled(bundle.runId)) {
          // Only a mark this sweep made is withdrawn; nothing was removed under it. An earlier purge stays refused.
          if (marked === "earlier") return { result: false, changes: 0 };
          const { availability: _marker, ...current } = readOwned(bundle.bundleId);
          return { result: false, changes: write(current) };
        }
        for (const attachment of bundle.attachments) {
          const ref = refOf(attachment);
          const references = [...this.readManagedArtifactReferences(ref), ...pendingDiagnosticArtifacts(this.#admission, false)];
          if (references.some(reference => reference.id === ref.id || reference.sha256 === ref.sha256) || heldByActivePurge(ref, bundle.bundleId)) {
            retainedBytes += ref.bytes;
            continue;
          }
          // An explicit unavailable association survives failed or interrupted byte removal.
          try { removeArtifactDeletionFile(this.#admission, inspectArtifactDeletionFile(this.#admission, ref)); }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        }
        return { result: true, changes: 0 };
      });
      if (removed) purged.push(bundle.bundleId);
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

  readQueueDayCounts(fromDay: string, toDay: string) {
    const date = z.iso.date();
    const from = date.parse(fromDay), to = date.parse(toDay);
    if (from > to) throw new Error("queue-day-count-range-invalid");
    const countRow = z.strictObject({ day: date, count: z.number().int().positive() });
    const memberRow = z.strictObject({ id: RunIdSchema, parent_id: RunIdSchema, day: date, envelope_json: z.string() });
    return this.#withReadSnapshot(() => {
      this.#validateExternalQuerySources();
      const counts = new Map(this.#database.prepare(`SELECT local_day AS day,count(*) AS count FROM runs ${runIndex(this.#database, "runs_day_idx")}
        WHERE local_day BETWEEN ? AND ? AND parent_id IS NULL GROUP BY local_day`).all(from, to)
        .map(raw => { const { day, count } = countRow.parse(raw); return [day, count] as const; }));
      const members = this.#database.prepare(`SELECT id,parent_id,local_day AS day,envelope_json FROM runs ${runIndex(this.#database, "runs_day_idx")}
        WHERE local_day BETWEEN ? AND ? AND parent_id IS NOT NULL`).all(from, to).map(raw => {
        const row = memberRow.parse(raw);
        const envelope = RunEnvelopeSchema.parse(JSON.parse(row.envelope_json));
        if (envelope.runId !== row.id || envelope.parent?.runId !== row.parent_id) throw new Error("queue-parent-source-unavailable");
        return { day: row.day, envelope };
      });
      const parents = this.authority.dependencies.parents(members.map(({ envelope }) => envelope));
      for (const { day, envelope } of members) {
        const parent = parents.get(envelope.runId);
        if (parent === undefined) throw new Error("queue-parent-source-unavailable");
        if (isQueueTopLevel({ parent })) counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      return counts;
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
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.#readDelegationWaitState(run),
      envelopes => this.authority.dependencies.parents(envelopes)).query(this.getMeta().authorityGeneration,query) });
  }

  /** A retained summary read still admits the current source, and never serves from a write transaction. */
  runSummaryReadPosition() {
    if (this.#transactionMode !== "read") return undefined;
    this.#validateExternalQuerySources();
    return { authorityGeneration: this.getMeta().authorityGeneration, ...this.capturedChangeKey() };
  }

  queryRunCalendar(query: Parameters<ReturnType<typeof createRunSummaries>["calendar"]>[1]) {
    return this.withAuthorityReadSnapshot(() => {
      this.#validateExternalQuerySources();
      const authorityGeneration = this.getMeta().authorityGeneration;
      const read = () => createRunSummaries(this.#database, run => this.authority.dependencies.waitState(run.envelope.runId),
        envelopes => this.authority.dependencies.parents(envelopes)).calendar(authorityGeneration, query);
      if (this.#transactionMode !== "read" || this.#changeReader === undefined) return read();
      const { month, day, today } = CalendarStoreQuerySchema.parse(query);
      const key = `${month}|${day}|${today}`;
      const position = this.capturedChangeKey();
      const previous = this.#calendarCache;
      const entries = previous !== undefined && previous.position.schemaCookie === position.schemaCookie
        && calendarChangeIntervalClear(this.#database, previous.position.changeLogSeq, position.changeLogSeq)
        ? previous.entries : new Map<string, CalendarWire>();
      this.#calendarCache = { position, entries };
      const cached = entries.get(key);
      if (cached !== undefined) return CalendarWireSchema.parse({ ...cached, authorityGeneration });
      const wire = read();
      if (entries.size >= 4) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, structuredClone(wire));
      return wire;
    });
  }

  readRunSummaries() {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database, run => this.#readDelegationWaitState(run),
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
      throw new CommandIdReusedError(record.commandId);
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

  bindLogPublisher(publish: (mutation: LogMutation) => void): () => void {
    this.#assertOpen();
    if (this.#logPublisher !== undefined) throw new Error("log-publisher-already-bound");
    this.#logPublisher = publish;
    return () => { if (this.#logPublisher === publish) this.#logPublisher = undefined; };
  }

  refuseWritesAfterLogFailure(error: Error): void { this.#logWriteFailure ??= error; }

  #publishLogAfterCommit(mutation: LogMutation): void {
    const publish = this.#logPublisher;
    if (publish !== undefined) this.afterAuthorityCommit(() => { publish(mutation); });
  }


  canonicalPerson(runId: string) {
    return this.withAuthorityReadSnapshot(() => {
      const run=this.authority.runs.get(runId);
      if(run===undefined) return {state:"unavailable" as const,reason:"canonical-live-run-unavailable"};
      return deriveCanonicalPerson(run,this.authority.runResults.get(runId) ?? null);
    });
  }

  /** Runs an assistant start command created: the commands table is the only record, so one read of its applied outcomes. */
  assistantStartedRunIds(): ReadonlySet<string> {
    return this.#withReadSnapshot(() => new Set(this.#database.prepare(`SELECT DISTINCT json_extract(target.value,'$.runId') AS run_id FROM commands command,
      json_each(command.outcome_json,'$.result.affectedTargets') target WHERE command.family='start' AND json_extract(command.request_json,'$.source')='assistant'
      AND json_extract(command.outcome_json,'$.result.state') IN ('applied','already-applied') AND json_extract(target.value,'$.family')='run'`)
      .all().map(row => z.string().parse(row.run_id))));
  }

  /** Live Duo ceremony leases this worker holds, with their original acquisition times. */
  heldDuoLeases(workerId: string) {
    return this.withAuthorityReadSnapshot(() => this.#database.prepare("SELECT * FROM auth_leases WHERE holder_worker_id=? AND state='held'").all(workerId)
      .map(row => this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema))
      .filter(lease => isDuoCeremonyLeaseLive(lease, this.#clock.now().getTime())).map(lease => ({ system: lease.holder.system, since: lease.acquiredAt })));
  }

  nextDuoLeaseExpiry(nowMs: number): number {
    return this.#withReadSnapshot(() => {
      let next = Infinity;
      for (const row of this.#database.prepare("SELECT * FROM auth_leases WHERE state='held'").all()) {
        const lease = this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema);
        const expiry = Date.parse(lease.expiresAt);
        if (expiry > nowMs) next = Math.min(next, expiry);
      }
      return next;
    });
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
      if (current.status !== "parked" || run?.lifecycle.state !== "running" || run.cancelRequested === true || run.envelope.dryRun
        || run.envelope.attempt !== current.runAttempt || current.recheck?.commandId !== request.resolution.commandId
        || current.recheck.auditId !== request.resolution.auditId || current.recheck.nodeId !== run.envelope.startAt
        || current.recheck.nodeId !== run.lifecycle.currentNodeId) {
        throw new Error("parked-write-resolution-run-cas-mismatch");
      }
      this.#assertCurrentExecution(current.runId, request.claim);
      const checked = authenticateParkedWriteRecheck(current, attempt, this.authority.commands.get(current.recheck.commandId),
        this.authority.commandAudits.get(current.recheck.auditId));
      if (checked.command.type !== "resolve-write-absent") throw new Error("parked-write-absence-request-required");
      if (Date.parse(request.settlement.evidence.observedAt) < Date.parse(run.lifecycle.claimedAt)) {
        throw new Error("parked-write-resolution-absence-proof-mismatch");
      }
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
    const columns = initialFailureColumns(record);
    this.#authorityWrite("run_failures", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_failures (id, run_id, fingerprint, code, resolution_json, resolution_version, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...Object.values(columns));
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

  #assertAdmissionLive(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
    this.#admission.assertLive();
  }

  #assertOpen(): void {
    this.#assertAdmissionLive();
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
    // A read lane pages through TEMP tables and views. Its connection opened read-only, so main and any attachment still refuse writes.
    if (this.#openMode === "dashboard-read-worker-read-only-no-migrate") this.#database.exec("PRAGMA query_only=OFF; PRAGMA trusted_schema=OFF");
  }

  #admitExistingSchema(): number {
    if (this.#readIntPragma("application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("authority database is not the HR authority store");
    const version = this.#readIntPragma("user_version");
    assertPublishedAssistantNumbering(this.#database);
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
      assertAuthorityUpgradeAppend(this.#database, { type: "initialize" }, baseline.phase);
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

  #validateDatabase(useStartupCheckpoint: boolean, dataVersion: number): void {
    const migrationViolations = auditMigrationTableCoverage();
    if (migrationViolations.length > 0) throw new Error(migrationViolations.join("; "));
    const db = this.#database;
    if (!useStartupCheckpoint) { inspectOpenDatabase(db, true); return; }
    const checkpoints = checkpointsFor(this.#admission);
    const prior = checkpoints.get(this.#path);
    checkpoints.delete(this.#path);
    const observation = readStartupFile(this.#path);
    const file = observation.state === "observed" ? observation.file : undefined;
    const image = file === undefined ? undefined : startupImageDigest(db);
    const digest = image?.state === "observed" ? image.digest : undefined;
    let inspection: AuthorityCopyInspection | undefined;
    if (matchesStartupCheckpoint(prior, file, digest)
      && (prior.pending === undefined || checkStartupChanges(db, prior.pending) === "proved")) {
      checkInspectionPragmas(db, true);
      inspection = prior.inspection;
    } else inspection = AuthorityCopyInspectionSchema.parse(inspectStoppedTransaction(db, this.#path, CURRENT_AUTHORITY_SCHEMA_VERSION, true));
    if (file !== undefined && digest !== undefined) {
      this.#changeReader = changeLogBaseline(db);
      // The live reader advances past own writes; attestation needs the position that was actually inspected.
      this.#startupOwner = { checkpoints, file,
        digest, inspection, position: { ...this.#changeReader }, dataVersion };
    }
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

  /**
   * Admits what other connections committed since this connection last validated, before a read or a projection write:
   * the closure of the logged changes from schema 31, the whole-store check below it or after a schema move or log gap.
   * Nothing here runs under the write lock.
   */
  #validateExternalQuerySources(mode: "selector" | "mutation" = "selector", searchValidation: "all" | "progress" | "none" = "all"): void {
    if (this.#transactionMode === "authority" || this.#transactionMode === "projection") return;
    const owner = this.#historyOwner;
    if (owner !== undefined) {
      owner.withAuthorityReadSnapshot(() => {
        owner.#validateExternalQuerySources(mode, searchValidation);
        if (owner.getMeta().authorityGeneration !== this.getMeta().authorityGeneration) throw new AuthoritySnapshotChangedError();
      });
      return;
    }
    const observed = readIntPragma(this.#database, "data_version");
    const reader = this.#changeReader;
    if (observed === this.#validatedExternalDataVersion && observed === this.#snapshotExternalDataVersion && reader?.failed === undefined) return;
    this.#validatedExternalDataVersion = undefined;
    try {
      if (reader === undefined) validateAuthorityStore(this.#database, searchValidation);
      else admitChanges(this.#database, reader, searchValidation, observed);
    } catch (error) {
      if (mode === "mutation") throw error;
      throw new Error("run-search-index-rebuild-required", { cause: error });
    }
    const stable = observed === this.#snapshotExternalDataVersion && readIntPragma(this.#database, "data_version") === observed;
    if (stable && (reader === undefined ? searchValidation !== "none" : searchValidation === "all")) this.#validatedExternalDataVersion = observed;
  }

  /**
   * Inside this connection's write, before COMMIT: when no peer committed since the reader was current, every entry above
   * its cursor is this connection's own, so the cursor can follow its commit. Also prunes the log at most once a minute.
   */
  #prepareChangeLogCommit(mode: "authority" | "projection", searchValidation: "all" | "progress" | "none", insideDataVersion: number): (() => void) | undefined {
    const reader = this.#changeReader;
    if (reader === undefined) return undefined;
    const nowMs = this.#clock.now().getTime();
    if (mode === "authority" && this.#authorityDirty && (this.#lastChangePruneMs === undefined || nowMs - this.#lastChangePruneMs >= CHANGE_LOG_PRUNE_INTERVAL_MS)) {
      this.#database.prepare(`DELETE FROM ${CHANGE_LOG_TABLE} WHERE seq<=?`).run(changeLogHighWater(this.#database) - CHANGE_LOG_RETAINED_ENTRIES);
      this.#lastChangePruneMs = nowMs;
    }
    const restart = mode === "projection" && searchValidation === "none" ? reader.settled : undefined;
    const current = restart === undefined ? reader.failed === undefined && !reader.wholeStore && insideDataVersion === this.#validatedExternalDataVersion
      : insideDataVersion === restart.dataVersion;
    const high = changeLogHighWater(this.#database), singleton = readSingletonImage(this.#database);
    return () => {
      // A restart rebuild replaced the whole projection, so it settles a projection-only failure at the position validated before the lock.
      if (restart !== undefined) Object.assign(reader, { cursor: restart.cursor, failed: undefined, wholeStore: false, settled: undefined });
      if (current) Object.assign(reader, { cursor: high, singleton });
      if (restart !== undefined && current) this.#validatedExternalDataVersion = insideDataVersion;
    };
  }

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result, searchValidation: "all" | "progress" | "none" = "all"): Result {
    if (this.#logWriteFailure !== undefined) throw this.#logWriteFailure;
    if (this.#historyOwner !== undefined) throw new Error("isolated-history-read-only");
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
      const slow = this.#beginSlowOperation(mode === "authority" ? "authority-transaction" : "projection-transaction");
      try {
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
          const insideDataVersion = readIntPragma(this.#database, "data_version");
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
          const settleChangeLog = this.#prepareChangeLogCommit(mode, searchValidation, insideDataVersion);
          this.#database.exec("COMMIT");
          if (searchValidation === "none" && this.#changeReader === undefined) this.#validatedExternalDataVersion = this.#snapshotExternalDataVersion;
          settleChangeLog?.();
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
          slow.settled();
        }
        const callbacks = this.#authorityCommitCallbacks.splice(0);
        for (const callback of callbacks) callback();
        return result;
      } finally { slow.finish(); }
    });
  }

  /**
   * Times one outermost operation. Nested work does not report on its own.
   * The clock stops when the transaction settles, before commit callbacks. The hook runs only after those callbacks,
   * so a hook transaction cannot take them or swallow their errors, and work the hook starts does not report.
   */
  #beginSlowOperation(name: string): { settled(): void; finish(): void } {
    if (this.#slowOperation === undefined || this.#slowOperationDepth > 0) return { settled() {}, finish() {} };
    const startedMs = this.#clock.monotonicMs();
    this.#slowOperationDepth += 1;
    let settled = false;
    let finished = false;
    let durationMs = 0;
    return {
      settled: () => {
        if (settled) return;
        settled = true;
        durationMs = this.#clock.monotonicMs() - startedMs;
        this.#slowOperationDepth -= 1;
      },
      finish: () => {
        if (finished) return;
        finished = true;
        if (!settled) {
          durationMs = this.#clock.monotonicMs() - startedMs;
          this.#slowOperationDepth -= 1;
          settled = true;
        }
        if (durationMs <= 50) return;
        this.#slowOperationDepth += 1;
        try {
          this.#slowOperation?.({ name, durationMs });
        } catch {
          // A hook failure never replaces the transaction result or its error.
        } finally {
          this.#slowOperationDepth -= 1;
        }
      },
    };
  }

  #readDelegationGroup(manifest: DelegationManifest): ReturnType<typeof authenticateDelegationGroup> {
    const memo = this.#operationDelegationReads()?.memo;
    // The memo shares proofs between authentications, so each caller gets its own copy.
    if (memo === undefined) return authenticateDelegationGroup(this.authority, manifest);
    return structuredClone(memoizedDelegationGroup(memo, manifest) ?? authenticateDelegationGroup(this.authority, manifest, new Set(), memo));
  }

  #readDelegationWaitState(run: RunRecord | string) {
    const runId = typeof run === "string" ? run : run.envelope.runId;
    const cached = this.#delegationReadSnapshot?.waits.get(runId);
    if (cached !== undefined) return cached === null ? null : { ...cached };
    const parent = typeof run === "string" ? this.authority.runs.get(runId) : run;
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    const state = readDelegationWaitState(this.authority, parent);
    this.#delegationReadSnapshot?.waits.set(runId, state === null ? null : { ...state });
    return state;
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

  #projectionLifecycleRows(key: string, index: "run" | "manifest" = "run"): readonly LifecycleLookupRow[] | undefined {
    if (this.#transactionMode !== "read" || this.#changeReader === undefined || this.#snapshotExternalDataVersion === undefined
      || this.#validatedExternalDataVersion !== this.#snapshotExternalDataVersion) return undefined;
    if (this.#lifecycleCommandReadSnapshot === undefined) {
      const batch: LifecycleCommandBatch = { byRun: new Map(), byManifest: new Map() };
      const historyOrder = this.#historyOwner === undefined ? "" : " JOIN history_command_order position ON position.command_id=commands.id";
      const commandOrder = this.#historyOwner === undefined ? "commands.rowid" : "position.source,position.ordinal";
      const rows = this.#database.prepare(`SELECT commands.*, json_object(
        'commandId', id, 'operation', json_extract(request_json,'$.operation'), 'targetId', target_id,
        'requestRunId', json_extract(request_json,'$.request.runId'),
        'resultRunId', json_extract(outcome_json,'$.result.runId'), 'resultKind', json_extract(outcome_json,'$.result.kind'),
        'version', json_extract(outcome_json,'$.result.appliedVersion'), 'continuationKind', json_type(outcome_json,'$.result.continuation'),
        'sourceCommandId', json_extract(request_json,'$.request.sourceCommandId'),
        'continuationOwnerRunId', json_extract(request_json,'$.request.continuationOwner.runId'),
        'manifestId', json_extract(request_json,'$.request.manifestId'),
        'cancellationKind', json_type(request_json,'$.request.cancellationSource'),
        'lifecycleState', json_extract(request_json,'$.request.lifecycle.state'),
        'gateId', json_extract(request_json,'$.request.lifecycle.gateId'),
        'currentNodeKind', json_type(request_json,'$.request.lifecycle.currentNodeId'),
        'claimGeneration', json_extract(request_json,'$.request.claim.claimGeneration'),
        'expectedVersion', json_extract(request_json,'$.request.expectedVersion')) AS lookup_json
        FROM commands${historyOrder} WHERE id IN (SELECT json_extract(row_key,'$[0]') FROM ${RUN_REFERENCES_TABLE} WHERE table_name='commands')
        AND family='run-lifecycle' AND json_extract(request_json,'$.operation') IN (
          'create','retry','recover','resume','delegation-retry','worker-transition','transition','terminalize',
          'delegation-refresh','delegation-invocation','delegation-admission') ORDER BY ${commandOrder}`).all();
      for (const { lookup_json, ...row } of rows) {
        const fields = LifecycleLookupSchema.parse(JSON.parse(z.string().parse(lookup_json)));
        const entry = { ...fields, row };
        for (const id of new Set([fields.requestRunId, fields.resultRunId, fields.continuationOwnerRunId, fields.targetId])) {
          if (id === null) continue;
          const group = batch.byRun.get(id) ?? [];
          group.push(entry);
          batch.byRun.set(id, group);
        }
        if (fields.manifestId !== null) {
          const group = batch.byManifest.get(fields.manifestId) ?? [];
          group.push(entry);
          batch.byManifest.set(fields.manifestId, group);
        }
      }
      this.#lifecycleCommandReadSnapshot = batch;
    }
    return (index === "run" ? this.#lifecycleCommandReadSnapshot.byRun : this.#lifecycleCommandReadSnapshot.byManifest).get(key) ?? [];
  }

  #readProjectionRecord<Key, Value>(memo: Map<Key, Value> | undefined, key: Key, read: () => Value): Value {
    if (memo === undefined) return read();
    this.#assertOpen();
    const cached = memo.get(key);
    if (cached !== undefined) return structuredClone(cached);
    const value = read();
    if (value !== undefined) memo.set(key, structuredClone(value));
    return value;
  }

  #withReadSnapshot<Result>(read: () => Result): Result {
    const owner = this.#historyOwner;
    if (owner === undefined || this.#transactionDepth > 0 || owner.#transactionDepth > 0) return this.#withOwnReadSnapshot(read);
    // Pin the native store first, then read history only at that same commit; a worker commit in between starts over.
    for (let attempt = 0; attempt < HISTORY_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const paired = owner.#withOwnReadSnapshot(() => {
        const { authorityGeneration } = owner.getMeta();
        return this.#withOwnReadSnapshot(() => this.getMeta().authorityGeneration === authorityGeneration ? { value: read() } : undefined);
      });
      if (paired !== undefined) return paired.value;
    }
    throw new AuthoritySnapshotChangedError();
  }

  #withOwnReadSnapshot<Result>(read: () => Result): Result {
    return withOperationProof(() => {
      if (this.#transactionDepth > 0) {
        if (this.#transactionMode === "read") this.#assertAdmissionLive();
        else this.#assertOpen();
        return read();
      }
      clearOperationProofSlots();
      this.#assertAdmissionLive();

      const slow = this.#beginSlowOperation("read-snapshot");
      try {
        const witnesses = new Map(outermostOperationProof()?.witnesses);
        this.#snapshotExternalDataVersion = readIntPragma(this.#database, "data_version");
        this.#database.exec("BEGIN");
        this.#transactionDepth = 1;
        this.#transactionMode = "read";
        this.#projectionRowReads = { admissions: new Map(), runs: new Map(), commands: new Map(), audits: new Map(), settlements: new Map() };
        this.#delegationReadSnapshot = { waits: new Map(), memo: newDelegationAuthenticationMemo(), invocations: new Map() };
        this.#authorityDirty = false;
        try {
          this.#assertOpen();
          if (this.#historyOwner !== undefined) validateHistoryRead(this.#database, readIntPragma(this.#database, "data_version"));
          const result = withNativeRecordReadScope(read);
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
          this.#lifecycleCommandReadSnapshot = undefined;
          this.#projectionRowReads = undefined;
          this.#snapshotExternalDataVersion = undefined;
          this.#authorityDirty = false;
          slow.finish();
        }
      } finally { slow.finish(); }
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
      const row = this.#statements.get`SELECT * FROM runs WHERE id = ${recordKey}`;
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
      const result = mode === "insert"
        ? this.#database.prepare(`
            INSERT INTO notifications
              (id, actor_id, dedupe_fingerprint, status, seen_count, version, run_id, payload_json, publications_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(...Object.values(initialNotificationColumns(record)))
        : this.#database.prepare(`
            UPDATE notifications
            SET status = ?, seen_count = ?, version = ?, payload_json = ?, updated_at = ?
            WHERE id = ? AND version = ?
          `).run(
            record.status, record.count, record.version, canonicalJsonStringify(record), record.updatedAt,
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
          const { clearedAt: _cleared, ...uncleared } = existing;
          const folded = NotificationRecordSchema.parse({
            ...uncleared,
            title: request.title,
            summary: request.summary,
            // A repeat is news again: the operator has not seen this occurrence, even one they cleared.
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
            ...(request.clearedAt === undefined ? {} : { clearedAt: request.clearedAt }),
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


  bindAssistantEpoch(epoch: () => number): void { this.#assistantEpoch = epoch; }

  #buildAuthorityRepositories(): AuthorityRepositories {
    const assistantPorts = { database: this.#database, read: <T>(work: () => T) => this.#withReadSnapshot(work),
      mutate: <T>(table: AuthorityTableName, work: () => Readonly<{ result: T; changes: number }>) => this.#authorityWrite(table, work),
      profileId: () => z.object({ profile_id: z.uuid() }).parse(this.#database.prepare("SELECT profile_id FROM database_states WHERE id=1").get()).profile_id };
    // Built on first use: the profile row exists only after the store is bound.
    let history: AssistantM1HistoryRepository | undefined, proposals: AssistantProposalRepository | undefined;
    const assistantAppliedEdits = createAssistantAppliedEditRepository(assistantPorts);
    const assistantHistory = () => history ??= createAssistantM1HistoryRepository({ ...assistantPorts, epoch: () => this.#assistantEpoch(),
      afterCommit: publish => { this.afterAuthorityCommit(publish); } });
    const settings = createSettingsActivationRepositories({ database: this.#database,
      mutate: (work) => this.#authorityWrite("settings", work),
      readRecord: (table,key,schema) => this.#readRecord(table,key,schema) });
    const generated = createGeneratedArtifactRepository({ database: this.#database, mutate: (work) => this.#authorityWrite("artifacts", work) });
    const imports = createImportedArtifactRepositories({ database: this.#database,
      mutate: (work) => this.#authorityWrite("artifacts", work) });
    return Object.freeze({
      assistantModelPreference: createAssistantModelPreferenceRepository({ database: this.#database, read: work => this.#withReadSnapshot(work), mutate: (table, work) => this.#authorityWrite(table, work) }),
      assistantAuthorization: createAssistantAuthorizationRepository({ database: this.#database, mutate: (table, work) => this.#authorityWrite(table, work) }),
      get assistantHistory() { return assistantHistory(); },
      assistantAppliedEdits,
      get assistantProposals() { return proposals ??= createAssistantProposalRepository({ ...assistantPorts, accepted: assistantHistory() }); },
      workbooks: createWorkbookLibraryRepository({ database: this.#database,
        changeKey: () => this.#transactionDepth > 0 && this.#transactionMode !== "read" ? undefined : this.changeKey(),
        mutate: work => this.#authorityWrite("workbook_library", work),
        read: work => this.#withReadSnapshot(work) }),
      timelineEvents: createTimelineRepository({
        cursorOffset: () => this.#historyCursorOffset,
        database: this.#database,
        read: (work) => this.#withReadSnapshot(work),
        mutate: (work) => this.#authorityWrite("timeline_events", work),
        assertOwner: (record, appending) => assertTimelineOwner(this.#database, record, appending),
        publishCommitted: mutation => this.#publishLogAfterCommit(mutation),
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
          const id = RunIdSchema.parse(runId), version = PositiveIntSchema.parse(appliedVersion);
          return this.#readProjectionRecord(this.#projectionRowReads?.settlements, `${id}:${String(version)}`, () => {
            const row = readRunSettlementRow(this.#database,id,version);
            if (row === undefined) return undefined;
            const result = RunResultRecordSchema.parse(nativeOrdinaryRecordFromRow("run_results",row));
            const run = runSettlementContext(row);
            assertTerminalEvidenceOwner(this.#database,result,CURRENT_READERS,run);
            return { run, result };
          });
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
              if (canonicalJsonStringify(existing) !== json) throw new CommandIdReusedError(record.commandId);
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
          const state = CommandRowStateSchema.parse(z.object({ state: z.string() }).parse(row).state);
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
          const id = RunIdSchema.parse(runId), projected = this.#projectionLifecycleRows(id);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='resume'
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND json_extract(outcome_json,'$.result.appliedVersion')<=?
            ORDER BY CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER) DESC LIMIT 2`)
            .all(id, throughVersion ?? Number.MAX_SAFE_INTEGER)
            : projected.filter(entry => entry.operation === "resume" && entry.resultKind === "run" && entry.resultRunId === id
              && entry.version !== null && entry.version <= (throughVersion ?? Number.MAX_SAFE_INTEGER))
              .sort(lifecycleVersionOrder).slice(0, 2).map(entry => entry.row);
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
          const id = RunIdSchema.parse(runId), projected = this.#projectionLifecycleRows(id);
          const row = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('create','retry','resume','recover')
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND json_type(outcome_json,'$.result.continuation')='object'
            AND (? IS NULL OR json_extract(outcome_json,'$.result.appliedVersion')=?)
            ORDER BY CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER) DESC LIMIT 1`).get(id, version, version)
            : projected.filter(entry => ["create", "retry", "resume", "recover"].includes(entry.operation)
              && entry.resultKind === "run" && entry.resultRunId === id && entry.continuationKind === "object"
              && (version === null || entry.version === version)).sort(lifecycleVersionOrder)[0]?.row;
          if (row === undefined) return undefined;
          const command = RunLifecycleCommandRecordSchema.parse(commandFromRow(row));
          const audit = this.authority.lifecycleJournal.findAuditByCommand(command.commandId);
          if (audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
            || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("run-continuation-issue-unavailable");
          return audit;
        },
        findDelegationParentHold: (runId: string, sourceCommandId: string, appliedVersion: number) => {
          const projected = this.#projectionLifecycleRows(runId);
          const retries = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-retry'
            AND json_extract(request_json,'$.request.sourceCommandId')=?
            AND json_extract(request_json,'$.request.continuationOwner.runId')=?`).all(sourceCommandId,runId)
            : projected.filter(entry => entry.operation === "delegation-retry" && entry.sourceCommandId === sourceCommandId
              && entry.continuationOwnerRunId === runId).map(entry => entry.row);
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
          const id = RunIdSchema.parse(runId), projected = this.#projectionLifecycleRows(id);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('create','retry','recover')
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=? ORDER BY id`).all(id)
            : projected.filter(entry => ["create", "retry", "recover"].includes(entry.operation) && entry.resultKind === "run"
              && entry.resultRunId === id).sort(lifecycleCommandOrder).map(entry => entry.row);
          if (rows.length > 1) throw new Error("delegation-root-origin-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        findGatePark: (runId: string, gateId: string, throughVersion: number) => {
          const id = RunIdSchema.parse(runId), gate = GateIdSchema.parse(gateId), version = PositiveIntSchema.parse(throughVersion);
          const projected = this.#projectionLifecycleRows(id);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='worker-transition'
            AND json_extract(request_json,'$.request.runId')=?
            AND json_extract(request_json,'$.request.lifecycle.state')='parked-gate'
            AND json_extract(request_json,'$.request.lifecycle.gateId')=?
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=?
            AND CAST(json_extract(outcome_json,'$.result.appliedVersion') AS INTEGER)<=? ORDER BY id`)
            .all(id, gate, id, version)
            : projected.filter(entry => entry.operation === "worker-transition" && entry.requestRunId === id
              && entry.lifecycleState === "parked-gate" && entry.gateId === gate && entry.resultKind === "run"
              && entry.resultRunId === id && entry.version !== null && entry.version <= version)
              .sort(lifecycleCommandOrder).map(entry => entry.row);
          if (rows.length > 1) throw new Error("delegation-gate-park-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        findCancellation: (runId: string) => {
          const projected = this.#projectionLifecycleRows(runId);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('transition','terminalize')
            AND json_extract(request_json,'$.request.runId')=?
            AND json_type(request_json,'$.request.cancellationSource')='object' ORDER BY id`).all(runId)
            : projected.filter(entry => ["transition", "terminalize"].includes(entry.operation) && entry.requestRunId === runId
              && entry.cancellationKind === "object").sort(lifecycleCommandOrder).map(entry => entry.row);
          if (rows.length > 1) throw new Error("delegation-cancellation-source-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
        },
        listDelegationRefreshes: (runId: string) => {
          const id = RunIdSchema.parse(runId), projected = this.#projectionLifecycleRows(id);
          return projected === undefined ? readDelegationRefreshCommands(this.#database, id)
            : projected.filter(entry => entry.operation === "delegation-refresh" && entry.requestRunId === id)
              .sort(lifecycleCommandOrder).map(entry => RunLifecycleCommandRecordSchema.parse(commandFromRow(entry.row)));
        },
        listDelegationInvocations: (parentRunId: string) => this.#readDelegationInvocations(`parent:${parentRunId}`, () => {
          const projected = this.#projectionLifecycleRows(parentRunId);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-invocation'
            AND json_extract(request_json,'$.request.runId')=? ORDER BY id`).all(parentRunId)
            : projected.filter(entry => entry.operation === "delegation-invocation" && entry.requestRunId === parentRunId)
              .sort(lifecycleCommandOrder).map(entry => entry.row);
          return rows.map(row => RunLifecycleCommandRecordSchema.parse(commandFromRow(row)));
        }),
        findDelegationInvocation: (manifestId: string) => this.#readDelegationInvocations(`manifest:${manifestId}`, () => {
          const projected = this.#projectionLifecycleRows(manifestId, "manifest");
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-invocation'
            AND json_extract(request_json,'$.request.manifestId')=? ORDER BY id`).all(manifestId)
            : projected.filter(entry => entry.operation === "delegation-invocation" && entry.manifestId === manifestId)
              .sort(lifecycleCommandOrder).map(entry => entry.row);
          if (rows.length > 1) throw new Error("delegation-invocation-ambiguous");
          return rows[0] === undefined ? [] : [RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]))];
        })[0],
        listDelegationAdmissions: (runId: string, claimGeneration: number) => {
          const projected = this.#projectionLifecycleRows(runId);
          const rows = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle' AND target_id=?
            AND json_extract(request_json,'$.operation')='delegation-admission'
            AND json_extract(request_json,'$.request.claim.claimGeneration')=?
            ORDER BY json_extract(request_json,'$.request.expectedVersion') DESC,id`).all(runId, claimGeneration)
            : projected.filter(entry => entry.operation === "delegation-admission" && entry.targetId === runId
              && entry.claimGeneration === claimGeneration)
              .sort((left, right) => (right.expectedVersion ?? 0) - (left.expectedVersion ?? 0) || lifecycleCommandOrder(left, right))
              .map(entry => entry.row);
          return rows.map(row => RunLifecycleCommandRecordSchema.parse(commandFromRow(row)));
        },
        findDelegationOwner: (runId: string, claimGeneration: number, throughVersion: number) => {
          const projected = this.#projectionLifecycleRows(runId);
          const row = projected === undefined ? this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle' AND target_id=?
            AND json_extract(request_json,'$.operation')='worker-transition'
            AND json_extract(request_json,'$.request.claim.claimGeneration')=?
            AND json_extract(request_json,'$.request.lifecycle.state')='running'
            AND json_type(request_json,'$.request.lifecycle.currentNodeId')='text'
            AND json_extract(outcome_json,'$.result.appliedVersion')<=?
            ORDER BY json_extract(outcome_json,'$.result.appliedVersion') DESC LIMIT 1`).get(runId, claimGeneration, throughVersion)
            : projected.filter(entry => entry.operation === "worker-transition" && entry.targetId === runId
              && entry.claimGeneration === claimGeneration && entry.lifecycleState === "running" && entry.currentNodeKind === "text"
              && entry.version !== null && entry.version <= throughVersion).sort(lifecycleVersionOrder)[0]?.row;
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
                throw new CommandIdReusedError(record.commandId);
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
        getCommand: (commandId: string) => this.#readProjectionRecord(this.#projectionRowReads?.commands, commandId,
          () => this.#readRecord("commands", commandId, AuthorityCommandRecordSchema)),
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
        findAuditByCommand: (commandId: string) => this.#readProjectionRecord(this.#projectionRowReads?.audits, commandId, () => {
          const rows = this.#database.prepare(`
            SELECT * FROM command_audits WHERE command_id = ? ORDER BY id
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return this.#parseNativeRow("command_audits",row,AuthorityCommandAuditRecordSchema);
        }),
      }),
      dependencies: Object.freeze({
        authenticateGroup: (manifest: DelegationManifest) => this.#readDelegationGroup(manifest),
        snapshotMemo: (repositories: AuthorityRepositories) =>
          repositories === this.authority && this.#transactionMode === "read" ? this.#delegationReadSnapshot?.memo : undefined,
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
        waitState: (parentRunId: string) => this.#readDelegationWaitState(parentRunId),
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
            WHERE parent_run_id = ?
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
            WHERE run_id = ?
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
        listByRunAttempt: (workflowId: string, itemId: string, runId: string, attempt: number) => {
          const rows = this.#database.prepare(`
            SELECT * FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND run_id = ? AND attempt = ?
            ORDER BY claim_generation, node_id
          `).all(WorkflowIdSchema.parse(workflowId), ItemIdSchema.parse(itemId), RunIdSchema.parse(runId), PositiveIntSchema.parse(attempt));
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
    return this.#readProjectionRecord(this.#projectionRowReads?.runs, runId,
      () => this.#readRecord("runs", runId, RunRecordSchema));
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

  /** The one run-row write; an update is refused unless the run transition table allows it from the stored row. */
  #writeRunRow(record: RunRecord, mode: "insert" | "update"): void {
    if (mode === "update") {
      const current = this.#readRunRow(record.envelope.runId);
      const violation = current === undefined ? undefined : runTransitionViolation(current.lifecycle, record.lifecycle, record);
      if (violation !== undefined) throw new Error(`run ${record.envelope.runId}: ${violation}`);
    }
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

  #refreshClaimRoutes(): void {
    const database = this.#database;
    database.exec(`CREATE TEMP TABLE IF NOT EXISTS claim_routes(run_id TEXT PRIMARY KEY,home TEXT);
      CREATE INDEX IF NOT EXISTS temp.claim_routes_home_idx ON claim_routes(home);
      CREATE TEMP TABLE IF NOT EXISTS claim_route_ancestors(ancestor_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES claim_routes(run_id) ON DELETE CASCADE,PRIMARY KEY(ancestor_id,run_id));
      CREATE INDEX IF NOT EXISTS temp.claim_route_ancestors_run_idx ON claim_route_ancestors(run_id);
      CREATE TEMP TABLE IF NOT EXISTS claim_route_state(id INTEGER PRIMARY KEY CHECK(id=1),schema_cookie INTEGER NOT NULL,cursor INTEGER NOT NULL);`);
    const prior = z.strictObject({ schema_cookie: z.number(), cursor: z.number() }).optional()
      .parse(database.prepare("SELECT schema_cookie,cursor FROM temp.claim_route_state WHERE id=1").get());
    const schemaCookie = readIntPragma(database, "schema_version"), high = changeLogHighWater(database);
    if (prior?.schema_cookie === schemaCookie && prior.cursor === high) return;
    if ((prior?.schema_cookie ?? this.#changeReader?.schemaCookie) !== schemaCookie) assertNativeSchema(database);
    const cursor = prior?.schema_cookie === schemaCookie ? prior.cursor : undefined;
    const tail = cursor === undefined ? undefined : z.strictObject({ count: z.number(), newest: z.number().nullable() })
      .parse(database.prepare(`SELECT count(*) AS count,max(seq) AS newest FROM ${CHANGE_LOG_TABLE} WHERE seq>?`).get(cursor));
    const reset = cursor === undefined || tail?.count !== high - cursor || (tail.newest ?? cursor) !== high;
    const before = this.#rawChangeKey().totalChanges;
    try {
      if (reset) database.exec("DELETE FROM temp.claim_routes");
      const affected = reset
        ? database.prepare(`SELECT id FROM runs INDEXED BY runs_owner_idx
            WHERE owner_worker_id IS NULL AND state='queued' AND pause_state IS NULL`).all()
        : database.prepare(`WITH changed(id) AS (
            SELECT DISTINCT json_extract(row_key,'$[0]') FROM ${CHANGE_LOG_TABLE} WHERE seq>? AND table_name='runs'
          ) SELECT id FROM changed UNION SELECT ancestor.run_id FROM changed
            JOIN temp.claim_route_ancestors AS ancestor ON ancestor.ancestor_id=changed.id`).all(cursor);
      const remove = database.prepare("DELETE FROM temp.claim_routes WHERE run_id=?");
      const queued = database.prepare("SELECT * FROM runs WHERE id=? AND state='queued' AND pause_state IS NULL");
      const parent = database.prepare("SELECT * FROM runs WHERE id=?");
      const route = database.prepare("INSERT INTO temp.claim_routes VALUES(?,?)");
      const link = database.prepare("INSERT INTO temp.claim_route_ancestors VALUES(?,?)");
      for (const { id } of z.array(z.strictObject({ id: RunIdSchema })).parse(affected)) {
        if (!reset) remove.run(id);
        const anchor = queued.get(id);
        if (anchor === undefined) continue;
        const ancestors = new Set<string>();
        let row: unknown = anchor, current: string | undefined = id, home: string | null = null;
        while (current !== undefined && ancestors.size < 16 && !ancestors.has(current)) {
          ancestors.add(current);
          if (row === undefined) break;
          let run: RunRecord;
          try { run = runRecordFromRow(row); } catch { break; }
          current = run.envelope.parent?.runId;
          if (current === undefined) home = run.envelope.workflow;
          else if (ancestors.size < 16 && !ancestors.has(current)) row = parent.get(current);
        }
        // Unknown routes stay in every home's ordered candidates and go through the original refusal checks.
        route.run(id, home);
        for (const ancestor of ancestors) link.run(ancestor, id);
      }
      database.prepare("INSERT OR REPLACE INTO temp.claim_route_state VALUES(1,?,?)").run(schemaCookie, high);
    } finally { this.#temporaryProjectionChanges += this.#rawChangeKey().totalChanges - before; }
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
      if (eligible !== undefined) this.#refreshClaimRoutes();
      const candidates = eligible === undefined
        ? this.#database.prepare(`SELECT * FROM runs INDEXED BY runs_queued_idx WHERE workflow=? AND state='queued' AND pause_state IS NULL
          ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id`).all(request.workflow)
        : this.#database.prepare(`SELECT run.* FROM temp.claim_routes AS route INDEXED BY claim_routes_home_idx
          CROSS JOIN runs AS run ON run.id=route.run_id WHERE route.home=? OR route.home IS NULL
          ORDER BY CASE run.priority WHEN 'interactive' THEN 0 ELSE 1 END,run.created_at,run.id`).all(slot.workflow);
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
    return this.#readProjectionRecord(this.#projectionRowReads?.admissions, generation, () => {
      const indexed = this.#transactionMode === "read" && this.#changeReader !== undefined && this.#snapshotExternalDataVersion !== undefined
        && this.#validatedExternalDataVersion === this.#snapshotExternalDataVersion;
      const row = z.strictObject({ commandId: z.uuid(), hold: z.enum(["quit", "update", "shutdown", "logout"]) }).optional().parse(this.#database.prepare(`SELECT id AS commandId,
        CASE family WHEN 'application' THEN 'quit' ELSE json_extract(request_json,'$.request.reason') END AS hold FROM commands held
        WHERE state='succeeded' AND ((${unreleasedQuitHoldSql(indexed)}) OR (family='run-lifecycle'
        ${indexed ? "AND json_extract(request_json,'$.family') IS NULL" : ""}
        AND json_extract(request_json,'$.operation')='application-admission'
        AND json_type(request_json,'$.request.reason')='text'
        AND json_extract(request_json,'$.request.runtimeGeneration')=?)) ORDER BY created_at,id LIMIT 1`).get(generation, generation, generation));
      return row === undefined ? { state: "open" } : { state: "draining", commandId: row.commandId, hold: row.hold };
    });
  }

  #quitAdmission(): string | undefined {
    const generation = this.authority.runtimeConfig.get()?.generation ?? 0;
    return z.strictObject({ commandId: z.uuid() }).optional().parse(this.#database.prepare(`SELECT id AS commandId FROM commands held
      WHERE state='succeeded' AND ${unreleasedQuitHoldSql()} ORDER BY created_at,id LIMIT 1`).get(generation, generation))?.commandId;
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
        return createRunSearchIndex(this.#database).search(input, this.getMeta().authorityGeneration, this.#historyOwner !== undefined);
      }),

      listPage: (input: Readonly<{ workflow?: string; offset: number; limit: number }>) => {
        const { workflow, offset, limit } = z.strictObject({ workflow: z.string().optional(),
          offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(1001) }).parse(input);
        this.#withReadSnapshot(() => { this.#validateExternalQuerySources(); });
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
          this.#temporaryProjectionChanges += this.#rawChangeKey().totalChanges - key.totalChanges;
        }
        return Object.freeze(this.#database.prepare(`SELECT r.* FROM canonical_run_page p CROSS JOIN runs r ON r.id=p.run_id
          WHERE p.position>? AND p.position<=? ORDER BY p.position`).all(offset,offset+limit).map(runRecordFromRow));
      },
      // Either representation can reveal active membership when a row's state has drifted.
      listNonTerminal: () => this.#withReadSnapshot(() => Object.freeze(this.#database.prepare(`SELECT * FROM runs ${runIndex(this.#database, "runs_nonterminal_idx")}
        WHERE state<>'terminal' OR json_extract(lifecycle_json,'$.lifecycle.state') IS NOT 'terminal'
        ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,julianday(enqueued_at),id`).all().map(runRecordFromRow))),
      // Active is the listNonTerminal predicate, so a row whose state column and lifecycle JSON disagree counts as active.
      countByTerminal: () => this.#withReadSnapshot(() => {
        const one = (row: unknown): number => z.strictObject({ n: z.number().int() }).parse(row).n;
        const active = one(this.#database.prepare(`SELECT count(*) AS n FROM runs ${runIndex(this.#database, "runs_nonterminal_idx")}
          WHERE state<>'terminal' OR json_extract(lifecycle_json,'$.lifecycle.state') IS NOT 'terminal'`).get());
        return Object.freeze({ finished: one(this.#database.prepare("SELECT count(*) AS n FROM runs").get()) - active, active });
      }),
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
      listWorkflows: () => Object.freeze(listRunWorkflows(this.#database)),
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
          // Debug entries are diagnostics, not run evidence: they leave with the run and stay out of its deletion receipt.
          this.#database.prepare("DELETE FROM debug_events WHERE run_id=?").run(request.runId);
          this.#publishLogAfterCommit({ kind: "purge-runs", runIds: [request.runId] });
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
    const retirementSchema = z.strictObject({ workerId: WorkerIdSchema, requestedBy: ActorIdSchema, now: IsoInstantSchema });
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
      retireMember: (input: unknown): WorkerPoolRecord => {
        const request = retirementSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const slot = this.authority.workerSlots.retire({ workerId: request.workerId, now: request.now });
          const current = read(slot.workflow);
          if (current === undefined) throw new Error("worker-pool-missing-for-active-slot");
          const pool = WorkerPoolRecordSchema.parse({
            ...current,
            desiredWorkers: current.desiredWorkers - 1,
            plannedBy: request.requestedBy,
            plannedAt: request.now,
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeWorkerPool(pool, "update");
          return pool;
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
