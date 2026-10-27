import { createAssistantModelPreferenceRepository } from "./assistant-model-preference.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";
import { notificationCollectionTarget, type NotificationCollectionOperation, type NotificationCollectionTarget } from "../../../models/notifications/notifications.js";
import { AssistantActionRecordSchema, AssistantChatRecordSchema, AssistantGrantRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { createAssistantAuthorizationRepository } from "./assistant-authorization.js";
import { createWorkbookLibraryRepository, validateWorkbookLibrary } from "./workbook-library-repository.js";
import { WorkerControlRefusal, WorkerControlRecordSchema, type WorkerResetBinding } from "../../../models/run/worker-control.js";
import { terminalDelegationDependencyRecord } from "../../../models/run/result.js";
import { delegationJoinDisposition } from "../../../rules/workflow/dependencies.js";
import { WorkerSlotRecordSchema, workerPoolMember } from "../../../models/run/worker-slot.js";
import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { authenticateWorkerBirthCustody, authenticateRetainedWorkerCustody, type RuntimeProcessLockHandle, observeRuntimeLockSnapshot, authoritySourceDatabaseIdentity } from "./runtime-process-locks.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { DiagnosticAttachmentSchema } from "../../../models/trust/diagnostic.js";
import { authenticateAuditedParkedWriteResolution, authenticateParkedWriteResolution } from "../../../rules/write-safety/parked-resolution.js";
import { prepareNativeRunDeletion, executeNativeRunDeletion, containsDeletionArtifactReference } from "./native-run-deletion.js";
import { inspectArtifactDeletionFile, removeArtifactDeletionFile, pendingDiagnosticArtifacts, reclaimDiagnosticStages } from "../artifacts/content-addressed-artifact-writer.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { importedArtifactFromRow } from "./imported-artifacts.js";
import { generatedArtifactFromRow } from "./generated-artifacts.js";
import { extractedArtifactFromRow } from "./extracted-artifact-row.js";
import { workerSlotFromRow } from "./worker-slots.js";
import { authenticateWorkerSupervisorEffect, consumeWorkerSupervisorEffect, type WorkerSupervisorEffect, authenticateWorkerControlClosure, consumeWorkerControlClosure, type WorkerControlClosure, assertWorkerResetParkedWrite, workerControlFromRow, workerBrowserFromRow } from "./worker-control.js";
import { readAppSettings } from "./settings-storage.js";
import { isNativeOrdinaryTable, nativeOrdinaryRecordFromRow, type NativeOrdinaryTable } from "./native-record-row.js";
import { requireWorkerPoolRoster, createWorkerSlotRepository, readWorkerReservationCustody } from "./worker-slots.js";
import { NativeCommandAuditSchema, commandFromRow, insertNativeCommand, settleNativeCommand } from "./command-record-row.js";
import { runRecordColumns, runRecordFromRow } from "./run-record-row.js";
import { requireOperationSourceDeclaration } from "../../../models/dashboard/operation-structure.js";
import { requireWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import { selectTransactions } from "./transaction-selection.js";
import { createRunSearchIndex, runSearchIndexFromRow } from "./run-search-index.js";
import { RunSearchRebuildRequestSchema } from "../../../models/dashboard/search-index.js";
import { createWorkerControlRepository, readWorkerControl, validateWorkerControls, type WorkerControlRepository } from "./worker-control.js";
import { WorkerControlBasisSchema } from "../../../models/run/worker.js";
import { createNotificationMetadataRepositories, validateNotificationMetadata } from "./notification-publications.js";
import { createExplorerOverrideRepository, validateExplorerOverrides } from "./explorer-overrides.js";
import { DeclaredActionIdentitySchema } from "../../../rules/workflow/task-provenance.js";
import { deriveCanonicalPerson } from "../../../rules/runs/summary-derivation.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { VerifiedRelocationActivationIntent } from "../admission/installation.js";
import { createRunSummaries } from "./run-summaries.js";
import { createGeneratedArtifactRepository } from "./generated-artifacts.js";
import { createFailureResolutionRepository } from "./failure-resolution.js";
import { createSettingsActivationRepositories } from "./settings-activation.js";
import { createImportedArtifactRepositories } from "./imported-artifacts.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { AppSettingsSchema } from "../../../models/config/app-settings.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { completionFromAuthorization } from "../../../models/run/completion.js";
import { createTransactionHistory } from "./transaction-history.js";
import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../../rules/commands/command-groups.js";
import { ConfirmationPublicationSchema, confirmationPublicationFromRow, type ConfirmationPublication, confirmedOperationTimeline, reconstructConfirmedOperation } from "../../../models/events/confirmed-operation.js";
import { timelineAppendContent, timelineCheckpointReference } from "../../../models/events/timeline.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { createTimelineRepository, timelineEventFromRow, TimelineRecordError } from "./timeline-repository.js";
import { withAuthorityDatabaseReadOnly } from "./readonly-authority-snapshot.js";
import { TimelinePageRequestSchema } from "../../../models/events/timeline.js";
import { readTimelineRecords } from "../events/timeline-reader.js";
import type { TimelineRepository, TimelineAppend } from "../../../models/events/timeline.js";
import { CommandIdentityConflictError } from "../../../rules/commands/commands.js";
import { assertCredentialStoreOwner } from "../configuration/credential-store.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync, lstatSync, openSync, closeSync, fsyncSync, unlinkSync, constants } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { assertWorkflowRunResultAuthorization, descriptorRuntimeNodes, workflowProjections, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { AUTHORITY_TABLE_REGISTRY, AuthorityUpgradeRecordSchema, AuthorityTableNameSchema, ProjectionTableNameSchema, type AuthorityTableName, type TableName, type RunRecordRefusal } from "../../../models/config/authority.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock, localDatePart } from "../../../rules/time/clock.js";
import { AuthorityCommandAuditRecordSchema, AuthorityCommandRecordSchema, StoredAuthorityCommandRecordSchema, BulkParentCommandRecordSchema, BulkRunCommandAcceptanceRecordSchema, CommandAuditRecordSchema, CommandRequestSchema, StorageRelocationCommandRequestSchema, RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema } from "../../../models/config/snapshot.js";
import { type ActiveRuntimeConfigRecord, type RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import { type SettingsCurrentRecord } from "../../../models/config/settings-current.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import type { DelegationReadiness } from "../../../rules/workflow/dependencies.js";
import { DelegationSettlementRequestSchema, DelegationRetryRequestSchema } from "./delegation-contracts.js";
import { authenticateDescendantHome, authenticateDelegationGroup, authenticateDelegationDependency, assertDelegationReplacement, authenticateCancellationSource, delegationEdgeForChild, resetDependencySnapshot, readDelegationCancellation, prepareDelegationRetry, childTerminalSettlement, readDelegationReadiness, retainedDelegationManifests, lifecycleChildEdge, readDelegationEvidence } from "./delegation-authority.js";
import { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import { ActorIdSchema, ArtifactIdSchema, BrowserSystemIdSchema, CommandAuditIdSchema, CommandIdSchema, DiagnosticBundleIdSchema, FailureFingerprintSchema, FingerprintSchema, IsoInstantSchema, ItemIdSchema, LOCAL_OPERATOR_ACTOR_ID, RunIdSchema, RunSessionIdSchema, TraceIdSchema, WorkerIdSchema, WorkflowIdSchema, WriteIntentIdSchema } from "../../../rules/identity/ids.js";




import { RunRecordSchema, runClaim, runTransitionViolation, type RunRecord } from "../../../models/run/record.js";
import { DeletedRunRecordSchema, RunDeleteInputSchema, type DeletedRunRecord } from "../../../models/run/deleted-run.js";
import { RunResultRecordSchema, createRunTerminalEvidenceResult, deriveTerminalFailureDigest, terminalEvidenceResult, deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest, type RunResultRecord } from "../../../models/run/result.js";
import { TerminalAuthorizationRecordSchema, type TerminalAuthorizationRecord } from "../../../models/run/terminal-authorization.js";
import { StartPlanRecordSchema, isStartPlanExpired, type StartPlanRecord } from "../../../models/run/start-plan.js";
import { IntakePlanManifestSchema } from "../../../models/intake/manifest.js";
import { IntakeSessionSchema } from "../../../models/intake/session.js";
import { AdmittedExtractionSchema } from "../../../models/ocr/extraction.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import { LIVE_WORKER_STATES, WorkerLeaseRecordSchema, isLiveWorker, type WorkerLeaseRecord } from "../../../models/run/worker.js";
import { DuoCeremonyLeaseAcquireRequestSchema, DuoCeremonyLeaseRecordSchema, DuoCeremonyLeaseReleaseOutcomeSchema, DuoCeremonyLeaseTakeoverSchema, isDuoCeremonyLeaseLive, type DuoCeremonyLeaseAcquireRequest, type DuoCeremonyLeaseRecord, type DuoCeremonyLeaseReleaseOutcome } from "../../../rules/sessions/duo-ceremony-lease.js";
import { RunSessionRecordSchema, type RunSessionRecord } from "../../../models/run/session.js";
import { WorkerPoolRecordSchema, workerPoolVersion, type WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { isDuoCeremonyLeaseToken, mintDuoCeremonyLeaseToken, retireDuoCeremonyLeaseToken, type DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { CanonicalClaimNextRequestSchema, WorkerStandingRecoveryRequestSchema, WorkerLifetimeBirthSchema, RunClaimOutcomeSchema, RunClaimRequestSchema, RunClaimSweepOutcomeSchema, RunClaimSweepRequestSchema, RunClaimTokenSchema, RunHeartbeatOutcomeSchema, RunHeartbeatRequestSchema, RunItemQuerySchema, RunPresentationRequestSchema, RunInjectPatchesRequestSchema, RunPriorityBumpRequestSchema, RunRequeueRequestSchema, RunResumeRequestSchema, RunTransitionRequestSchema, RunUpdateOutcomeSchema, StartPlanConsumeOutcomeSchema, StartPlanConsumeRequestSchema, WorkerControlRequestSchema, WorkerLifecycleRequestSchema, WorkerPoolPlanOutcomeSchema, WorkerPoolPlanRequestSchema, WorkerStartOutcomeSchema, WorkerStartRequestSchema, WorkerSweepRequestSchema, WorkerUpdateOutcomeSchema, type RunClaimOutcome, type RunHeartbeatOutcome, type RunUpdateOutcome, type StartPlanConsumeOutcome, type WorkerPoolPlanOutcome, type WorkerStartOutcome, type WorkerUpdateOutcome } from "./run-store-contracts.js";
import { FailureTerminalizationReportSchema, FailureTerminalizationRequestSchema, SuccessTerminalizationReportSchema, SuccessTerminalizationRequestSchema, type FailureTerminalizationReport, type FailureTerminalizationStorageStep, type SuccessTerminalizationReport, type SuccessTerminalizationStorageStep } from "./run-terminal-contracts.js";
import { RunCheckpointRecordSchema, checkpointLookupKey, checkpointRecordKey, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { NotificationFoldRequestSchema, NotificationRecordOutcomeSchema, NotificationRecordSchema, NotificationStateRequestSchema, requireMutableNotification, type NotificationRecord, type NotificationRecordOutcome } from "../../../models/notifications/notifications.js";


import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../models/trust/diagnostic.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { DryRunScenarioResultSchema, type DryRunScenarioResult } from "../../../models/trust/dry-run-scenario-result.js";
import { DryRunWriteSafetyCountsSchema } from "../../../models/trust/dry-run-scenario.js";




import { IdempotencyKeySchema, WriteAttemptRecordSchema, WriteIntentRecordSchema, type WriteAttemptRecord, type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, isCurrentAuthoritySchemaVersion, isSupportedStoppedAuthoritySchemaVersion, SQLITE_MIGRATIONS, deriveAuthorityUpgradePlanDigest, auditMigrationTableCoverage, migrationTableNames, tableClassification } from "./migrations.js";
import type { VerifiedBackup } from "./backup-service.js";
import { AuthorityCopyInspectionSchema, SpanAuthorityReadSnapshotSchema, SpanAuthorityRunRootSchema, SpanAuthorityRunResolutionSchema, type AuthorityCopyInspection, type SpanAuthorityReadSnapshot, type SpanAuthorityRunRoot } from "./recovery-contracts.js";
import { DiagnosticAttachmentStorageRecordSchema, type ArtifactOutboxStorageRecord, type ArtifactSinkHeadRecord, type DiagnosticAttachmentStorageRecord } from "./storage-records.js";
import { AtomicWriteCommitInputSchema, AtomicWriteCommitReportSchema, PermanentWriteResolutionSchema, WriteFenceRecordsSchema, WriteFenceInputSchema, WriteIntentParkRequestSchema, WriteIntentRetrySettlementRequestSchema, WriteRefenceInputSchema, ResolvedParkedWriteCommitInputSchema, ResolvedParkedWriteAbsenceInputSchema, type AtomicWriteCommitReport, type AtomicWriteCommitStorageStep, type PermanentWriteResolution } from "./write-commit-contracts.js";


export class AuthoritySchemaVersionError extends Error {
  readonly code = "authority-schema-mismatch";
  constructor(readonly schemaVersion: number) {
    super(`authority schema ${schemaVersion} does not match supported ${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
    this.name = "AuthoritySchemaVersionError";
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

type CommandRepository = Readonly<{
  assertIdentity(input: unknown, parentCommandId?: string): void;
  insert(input: unknown, parentCommandId?: string): ImmutableInsertResult<z.infer<typeof CommandRequestSchema>>;
  acceptBulk(input: unknown): ImmutableInsertResult<z.infer<typeof BulkRunCommandAcceptanceRecordSchema>>;
  getBulk(commandId: string): z.infer<typeof BulkRunCommandAcceptanceRecordSchema> | undefined;
  parentId(commandId: string): string | null | undefined;
  get(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
  getSettingsHistory(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
  findProtectedSettingsCommandIdByWriteId(input: unknown): string | undefined;
  listStorageRelocationCommands(): readonly z.infer<typeof StorageRelocationCommandRequestSchema>[];
  listRunBumpCommands(runId: string): readonly z.infer<typeof CommandRequestSchema>[];
}>;
type CommandAuditRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandAuditRecordSchema>>;
  get(auditId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findByCommand(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findSettingsHistory(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
}>;

type RunLifecycleJournalRepository = Readonly<{
  insertCommand(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandRecordSchema>>;
  getCommand(commandId: string): z.infer<typeof AuthorityCommandRecordSchema> | undefined;
  insertAudit(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandAuditRecordSchema>>;
  findAuditByCommand(commandId: string): z.infer<typeof AuthorityCommandAuditRecordSchema> | undefined;
  findRunOrigin(runId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  findCancellation(runId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
  listDelegationInvocations(parentRunId: string): readonly z.infer<typeof RunLifecycleCommandRecordSchema>[];
  findDelegationInvocation(manifestId: string): z.infer<typeof RunLifecycleCommandRecordSchema> | undefined;
}>;

type RuntimeConfigRepository = Readonly<{
  matchesClaim(input: unknown): boolean;
  matchesRun(configFingerprint: string, runFingerprint: string): boolean;
  hasHistory(): boolean;
  hasAdvancedHistory(): boolean;
  get(): ActiveRuntimeConfigRecord | undefined;
  initialize(input: unknown): ActiveRuntimeConfigRecord;
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
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof DependencyRecordSchema>>;
  get(dependencyId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  listByParentRun(parentRunId: string): readonly z.infer<typeof DependencyRecordSchema>[];
  activateRetry(input: unknown, now: string): void;
  settle(input: unknown): z.infer<typeof DependencyRecordSchema>;
  reconcile(parentRunId: string, now: string): void;
  effectiveChild(dependencyId: string): RunRecord;
  childHistory(dependencyId: string): readonly string[];
  lifecycleEdgeForChild(parentRunId: string, childRunId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  edgeForChild(parentRunId: string, childRunId: string): z.infer<typeof DependencyRecordSchema>;
  resetSnapshot(reset: WorkerResetBinding, childRunId: string): z.infer<typeof DependencyRecordSchema>;
  cancellationOutcome(runId: string): ReturnType<typeof readDelegationCancellation>;
  evidence(parentRunId: string, nodeId: string): ReturnType<typeof readDelegationEvidence>;
  readiness(parentRunId: string, intent: "join" | "cancel"): DelegationReadiness;
}>;

type WriteIntentRepository = Readonly<{
  getPublication(id:string): ConfirmationPublication | undefined;
  authenticatedDeletion(runId:string, publication:ConfirmationPublication): boolean;
  listByBusinessKey(system: unknown, digest: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];

  listAttemptingByItem(input: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];
  recordObservedPresent(input: unknown): PermanentWriteResolution;
  fenceAttempt(input: unknown): PermanentWriteResolution;

  refenceRetryable(input: unknown): PermanentWriteResolution;
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

type RunRepository = Readonly<{
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

  listClaimRecoveryCandidates(input: unknown): readonly RunRecord[];

  listBySession(sessionId: string): readonly RunRecord[];

  listParkedAtGate(): readonly RunRecord[];
  listChildren(parentRunId: string): readonly RunRecord[];

  findByTrace(traceId: string): RunRecord | undefined;

  listByWorkflow(workflow: string): readonly RunRecord[];
  listActiveOwners(workflow: string): readonly Readonly<{ workerId: string; runId: string }>[];
  listPage(input: Readonly<{ workflow?: string; offset: number; limit: number }>): readonly RunRecord[];

  listCurrentByWorkflow(workflow: string): readonly RunRecord[];

  listWorkflows(): readonly string[];
  claimNext(input: unknown): RunClaimOutcome;

  claimEligible(input: unknown, admit?: (run: RunRecord) => void, eligible?: (run: RunRecord) => boolean): CanonicalRunClaimOutcome;
  renewClaim(input: unknown): RunHeartbeatOutcome;
  transition(input: unknown): RunUpdateOutcome;
  requeue(input: unknown): RunUpdateOutcome;
  resume(input: unknown): RunUpdateOutcome;
  updatePresentation(input: unknown): RunUpdateOutcome;
  requestCancellation(input: Readonly<{ runId: string; expectedVersion: number; now: string; cancellationSource?: Readonly<{ commandId: string; rootRunId: string }> }>): RunUpdateOutcome;
  advanceRevision(input: Readonly<{ runId: string; expectedVersion: number; now: string }>): RunUpdateOutcome;

  bumpPriority(input: unknown): RunUpdateOutcome;

  injectCheckpointPatches(input: unknown): RunUpdateOutcome;

  sweepExpiredClaims(input: unknown): readonly z.infer<typeof RunClaimSweepOutcomeSchema>[];
}>;

// Failure fingerprint is a class join key, never inferred message text.
type FailureRepository = Readonly<{
  get(failureId: string): FailureRecord | undefined;
  listByRun(runId: string): readonly FailureRecord[];
  listByFingerprint(fingerprint: string): readonly FailureRecord[];
  countByFingerprint(fingerprint: string): number;
}>;


type DiagnosticBundleRepository = Readonly<{
  validateOperation(input: unknown): void;
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

type WorkerLeaseRepository = Readonly<{
  start(input: unknown): WorkerStartOutcome;
  get(workerId: string): WorkerLeaseRecord | undefined;
  listLive(workflow?: string): readonly WorkerLeaseRecord[];
  reportLifecycle(input: unknown): WorkerUpdateOutcome;
  control(input: unknown): WorkerUpdateOutcome;
  reserveControl(workerId: string, basis: unknown, commandId: string, now: string): WorkerLeaseRecord;
  sweepExpired(input: unknown): readonly WorkerLeaseRecord[];
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
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof AdmittedExtractionSchema>>;
  get(sourceSha256: string, sourcePage: number, formType: string):
    z.infer<typeof AdmittedExtractionSchema> | undefined;
  findByDocument(sourceSha256: string): readonly z.infer<typeof AdmittedExtractionSchema>[];
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
  explorerOverrides: ReturnType<typeof createExplorerOverrideRepository>;
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
  workerLeases: WorkerLeaseRepository;
  workerControls: WorkerControlRepository;
  duoCeremonyLeases: DuoCeremonyLeaseRepository;
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
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
// SQL max over no rows is NULL, meaning the item has no run attempt.
const MaxAttemptRowSchema = z.strictObject({ attempt: z.number().int().positive().nullable() });
const MaxRunNumberRowSchema = z.strictObject({ run_number: z.number().int().positive().nullable() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const AuthorityRecordFingerprintRowSchema = z.strictObject({ id: z.string(), payload_json: z.string() });
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

const INVARIANT_QUERIES = Object.freeze([
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
      LEFT JOIN run_results AS result ON result.run_id = run.id
      LEFT JOIN run_failures AS failure ON failure.run_id = run.id
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
      LEFT JOIN run_results AS result ON result.run_id=run.id
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
      WHERE json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.failureId') IS NOT failure.id
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
      WHERE run.state IS NOT 'terminal' OR run.outcome IS 'interrupted'
        OR (run.outcome = 'done' AND json_extract(result.payload_json,'$.result.value.kind') IN ('failed-evidence','lifecycle-evidence'))
        OR (run.outcome = 'failed' AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'failed-evidence')
        OR (run.outcome IN ('cancelled','discarded','superseded') AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'lifecycle-evidence')
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
] as const);

function invariantViolations(database: DatabaseSync): readonly string[] {
  const violations = INVARIANT_QUERIES.flatMap(({ name, sql }) => {
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

function readTimelineRun(database: DatabaseSync, runId: string): RunRecord | undefined {
  const row = database.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  return row === undefined ? undefined : runRecordFromRow(row);
}

function authenticatedPublicationDeletion(database: DatabaseSync, runId: string, publication: ConfirmationPublication): boolean {
  const raw = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(runId);
  if (raw === undefined) return false;
  const {receipt} = deletedRunFromRow(raw);
  const facts = publication.ledger;
  const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(receipt.commandId);
  const audits = database.prepare("SELECT * FROM command_audits WHERE command_id=?").all(receipt.commandId);
  if (commandRaw === undefined || audits.length !== 1) throw new Error("confirmed-publication-deletion-command-missing");
  const command = commandFromRow(commandRaw);
  const audit = NativeCommandAuditSchema.parse(nativeOrdinaryRecordFromRow("command_audits",audits[0]));
  if (receipt.runId !== facts.runId || receipt.workflow !== facts.workflowId || receipt.itemId !== facts.itemId
    || audit.completedAt !== receipt.deletedAt
    || receipt.traceId !== facts.traceId || receipt.attempt < facts.attempt || receipt.deletedAt < facts.confirmedAt
    || receipt.removed.find(entry=>entry.table === "runs")?.rows !== 1
    || !receipt.removed.some(entry=>entry.table === "run_checkpoints" && entry.rows > 0)
    || !receipt.removed.some(entry=>entry.table === "timeline_events" && entry.rows > 0)
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || z.object({state:z.literal("succeeded"),outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
    || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.request.operation !== "delete"
    || audit.result.kind !== "deletion" || !audit.result.runIds.includes(RunIdSchema.parse(runId))) throw new Error("confirmed-publication-deletion-settlement-mismatch");
  return true;
}

function readConfirmationPublication(database: DatabaseSync,id:string): ConfirmationPublication | undefined {
  const row = database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
  if (row === undefined) return undefined;
  const intent = WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
  return confirmationPublicationFromRow(intent,Reflect.get(row,"publication_json"));
}

function assertConfirmationPublication(database:DatabaseSync,id:string): void {
  const publication = readConfirmationPublication(database,id);
  if (publication === undefined) return;
  const owner = readTimelineRun(database,publication.ledger.runId);
  const deleted = database.prepare("SELECT 1 FROM deleted_runs WHERE run_id=?").get(publication.ledger.runId) !== undefined;
  if (owner !== undefined && deleted) throw new Error("confirmed-publication-owner-ambiguous");
  if (deleted && !authenticatedPublicationDeletion(database,publication.ledger.runId,publication)) throw new Error("confirmed-publication-deletion-unverified");
  const evidence = timelineEvidenceRepositories(database);
  reconstructConfirmedOperation(evidence,publication.timeline);
  const raw = database.prepare("SELECT * FROM timeline_events WHERE id=?").get(publication.timeline.eventId);
  if (raw === undefined) {
    if (!authenticatedPublicationDeletion(database,publication.ledger.runId,publication)) throw new Error("confirmed-publication-timeline-missing");
    if (readTimelineRun(database,publication.ledger.runId) !== undefined) throw new Error("confirmed-publication-deleted-run-still-present");
  } else {
    const timeline = timelineEventFromRow(raw);
    if (timelineAppendContent(timeline) !== canonicalJsonStringify(publication.timeline)) throw new Error("confirmed-publication-timeline-mismatch");
    assertTimelineOwner(database,timeline);
  }
}

function timelineEvidenceRepositories(database: DatabaseSync) {
  return {
    writeAttempts: {get(id:string) {
      const row=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(id);
      return row === undefined ? undefined : WriteAttemptRecordSchema.parse(nativeOrdinaryRecordFromRow("write_attempts",row));
    }},
    writeIntents: {
      getPublication:(id:string)=>readConfirmationPublication(database,id),
      authenticatedDeletion:(runId:string,publication:ConfirmationPublication)=>authenticatedPublicationDeletion(database,runId,publication),
      get(id:string) {
      const row=database.prepare("SELECT * FROM write_intents WHERE id=?").get(id);
      return row === undefined ? undefined : WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents",row));
    }},
    commands: {get(id:string) {
      const row=database.prepare("SELECT * FROM commands WHERE id=?").get(id);
      return row === undefined ? undefined : commandFromRow(row);
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

function assertTimelineOwner(database: DatabaseSync, record: TimelineAppend, appending = false): void {
    if (record.scope.kind !== "run") return;
    const run = readTimelineRun(database, record.scope.runId);
    if (run === undefined) throw new Error("timeline-event-owner-missing");
    if (run.envelope.workflow !== record.workflow) throw new Error("timeline-event-owner-mismatch");
    if (record.payload.kind === "operation-confirmed") {
      const facts = record.payload.facts;
      if (facts.traceId !== run.envelope.traceId || facts.itemId !== run.envelope.itemId
        || (appending ? facts.attempt !== run.envelope.attempt : facts.attempt > run.envelope.attempt) || facts.configFingerprint !== run.envelope.configFingerprint
        || facts.instance !== run.envelope.resolvedInstance[facts.system] || run.envelope.dryRun) {
        throw new Error("confirmed-history-run-mismatch");
      }
      // The resolver validates all exact proof/output/attempt references before append.
      reconstructConfirmedOperation(timelineEvidenceRepositories(database), record);
    }
    if (record.payload.kind === "checkpoint-replayed" || record.payload.kind === "checkpoint-recorded") {
      const reference = record.payload.checkpoint;
      const checkpoint = timelineEvidenceRepositories(database).runCheckpoints.get(reference.workflowId, reference.itemId,
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


function nativeTableKey(table: AuthorityTableName): string {
  if (table === "run_results" || table === "deleted_runs" || table === "run_search") return "run_id";
  if (table === "worker_pools") return "workflow";
  if (table === "workbook_library_history") return "workbook_id,version";
  if (table === "worker_controls") return "command_id";
  if (table === "auth_leases") return "credential_key";
  if (table === "timeline_events") return "cursor";
  return "id";
}

function authenticateStoredWriteResolution(database: DatabaseSync, input: unknown): void {
  const intent = WriteIntentRecordSchema.parse(input);
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined) return;
  const attempt = database.prepare("SELECT * FROM write_attempts WHERE id=?").get(intent.resolution.writeAttemptId);
  const command = database.prepare("SELECT * FROM commands WHERE id=?").get(intent.resolution.commandId);
  const audit = database.prepare("SELECT * FROM command_audits WHERE id=?").get(intent.resolution.auditId);
  if (attempt === undefined || command === undefined || audit === undefined) throw new Error("parked-write-resolution-authority-missing");
  authenticateParkedWriteResolution(intent,nativeOrdinaryRecordFromRow("write_attempts",attempt),commandFromRow(command),nativeOrdinaryRecordFromRow("command_audits",audit));
}

function authenticateStoredResolutionAudit(database: DatabaseSync,input:unknown):void {
  const audit=NativeCommandAuditSchema.parse(input);
  if (!("writeResolution" in audit) || audit.writeResolution === undefined) return;
  const intent=audit.writeResolution;
  if ((intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined) throw new Error("parked-write-resolution-audit-authority-missing");
  const attempt=database.prepare("SELECT * FROM write_attempts WHERE id=?").get(intent.resolution.writeAttemptId);
  const command=database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
  if(attempt === undefined || command === undefined) throw new Error("parked-write-resolution-audit-authority-missing");
  authenticateAuditedParkedWriteResolution(nativeOrdinaryRecordFromRow("write_attempts",attempt),commandFromRow(command),audit);
}

function assertTerminalEvidenceOwner(database: DatabaseSync, record: RunResultRecord): void {
  const evidence = terminalEvidenceResult(record);
  const rawRun = database.prepare("SELECT * FROM runs WHERE id=?").get(record.runId);
  if (rawRun === undefined) throw new Error("terminal-evidence-run-missing");
  const run = runRecordFromRow(rawRun);
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
    const command = RunLifecycleCommandRecordSchema.parse(commandFromRow(commandRaw));
    const audit = RunLifecycleCommandAuditRecordSchema.parse(nativeOrdinaryRecordFromRow("command_audits",auditRaw));
    const request = z.record(z.string(),z.unknown()).parse(command.request);
    const lifecycle = request.lifecycle === undefined ? undefined : z.record(z.string(),z.unknown()).parse(request.lifecycle);
    const declaredOutcome = command.operation === "transition" ? lifecycle?.outcome : "cancelled";
    const declaredEndedAt = command.operation === "transition" ? lifecycle?.endedAt : command.operation === "requeue" ? audit.result.kind === "run" ? audit.result.terminal?.endedAt : undefined : request.endedAt;
    if (request.runId !== record.runId || request.expectedVersion !== evidence.appliedVersion - 1
      || declaredOutcome !== evidence.outcome || declaredEndedAt !== record.createdAt
      || audit.result.kind !== "run" || audit.result.terminal?.outcome !== evidence.outcome
      || audit.result.terminal.endedAt !== record.createdAt
      || (command.operation === "requeue" && run.cancelRequested !== true)
      || (command.operation !== "transition" && command.operation !== "terminalize" && command.operation !== "requeue")
      || audit.result.kind !== "run" || audit.result.runId !== record.runId || audit.result.appliedVersion !== evidence.appliedVersion
      || command.requestFingerprint !== evidence.requestFingerprint || audit.auditId !== CommandAuditIdSchema.parse(evidence.commandId)
      || z.object({outcome_json:z.string()}).parse(commandRaw).outcome_json !== canonicalJsonStringify(audit)
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("terminal-evidence-command-audit-mismatch");
  }
  if (canonicalJsonStringify(createRunTerminalEvidenceResult(run,evidence)) !== canonicalJsonStringify(record)) throw new Error("terminal-evidence-result-mismatch");
}

function validateAuthorityRecordSchemas(database: DatabaseSync, validateSearch = true, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION): number {
  let validated = 0;
  const searchReady = z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready";
  for (const table of migrationTableNames(expectedSchemaVersion)) {
    if (table === "workbook_library" || table === "workbook_library_history") continue;
    if (table === "run_search" && (!validateSearch || !searchReady)) continue;
    for (const raw of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table)}`).iterate()) {
      try {
        if (table === "database_states") {
          const row = z.strictObject({id:z.literal(1),schema_version:z.literal(expectedSchemaVersion),authority_generation:z.number().int().nonnegative(),updated_at:IsoInstantSchema,
            search_generation:z.number().int().nonnegative().nullable(),search_state:z.enum(["unbuilt","ready","invalid"]),
            ...(expectedSchemaVersion >= 7 ? { installation_id: z.uuid(), profile_id: z.uuid() } : {}) }).parse(raw);
          if (row.search_state === "ready" && row.search_generation !== row.authority_generation) throw new Error("search-generation-mismatch");
        } else if (table === "runs") runRecordFromRow(raw);
        else if (table === "commands") commandFromRow(raw);
        else if (table === "run_search") {
          const id = z.object({run_id:z.string()}).parse(raw).run_id;
          const run = readTimelineRun(database,id);
          if (run === undefined) throw new Error("run-search-owner-missing");
          runSearchIndexFromRow(raw,run,z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready");
        }
        else if (table === "deleted_runs") deletedRunFromRow(raw);
        else if (table === "settings") readAppSettings(database);
        else if (table === "worker_slots") workerSlotFromRow(raw);
        else if (table === "worker_controls") workerControlFromRow(raw);
        else if (table === "browser_sessions") workerBrowserFromRow(raw);
        else if (table === "timeline_events") assertTimelineOwner(database,timelineEventFromRow(raw));
        else if (table === "artifacts") {
          const {kind} = z.object({kind:z.enum(["imported","generated","extracted"])}).parse(raw);
          if (kind === "imported") importedArtifactFromRow(raw);
          else if (kind === "generated") generatedArtifactFromRow(raw);
          else extractedArtifactFromRow(raw);
        } else if (isNativeOrdinaryTable(table)) {
          let inspected = raw;
          if (table === "run_requests" && expectedSchemaVersion < 6) {
            const row = z.object({ payload_json: z.string() }).parse(raw);
            const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(row.payload_json));
            if (expectedSchemaVersion < 5 && Object.hasOwn(payload, "workers")) throw new Error("pre-v5-start-plan-workers-unexpected");
            if (expectedSchemaVersion === 5) z.union([z.literal("auto"), z.number().int().min(1).max(8)]).parse(payload.workers);
            const { workers: _removed, ...plan } = payload;
            inspected = { ...raw, payload_json: canonicalJsonStringify(plan) };
          }
          const record = nativeOrdinaryRecordFromRow(table,inspected);
          if (table === "assistant_grants") {
            const grant = AssistantGrantRecordSchema.parse(record), owner = readMetaRow(database);
            if (grant.profileId !== owner.profile_id) throw new Error("assistant-grant-profile-mismatch");
            const command = CommandRequestSchema.parse(commandFromRow(database.prepare("SELECT * FROM commands WHERE id=?").get(grant.commandId)));
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
          if (table === "run_results") assertTerminalEvidenceOwner(database,RunResultRecordSchema.parse(record));
          if (table === "write_intents") { authenticateStoredWriteResolution(database,record); assertConfirmationPublication(database,z.object({writeIntentId:z.string()}).parse(record).writeIntentId); }
          if (table === "command_audits") {
            const audit = NativeCommandAuditSchema.parse(record);
            authenticateStoredResolutionAudit(database,audit);
            const commandRow = database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
            if (commandRow === undefined || canonicalJsonStringify(commandFromRow(commandRow)) !== canonicalJsonStringify(audit.request)
              || z.object({outcome_json:z.string()}).parse(commandRow).outcome_json !== canonicalJsonStringify(audit)) throw new Error("command-audit-settlement-mismatch");
          }
        } else throw new Error("native row admission is undefined");
      } catch (error) { throw new Error(`authority table ${table} failed native record validation: ${errorMessage(error)}`,{cause:error}); }
      validated++;
    }
  }
  if (expectedSchemaVersion >= 8 && database.prepare("SELECT 1 FROM assistant_grants WHERE id='current'").get() === undefined
    && database.prepare("SELECT 1 FROM commands WHERE state='succeeded' AND json_type(request_json,'$.payload.assistantPermission')='object' LIMIT 1").get() !== undefined) throw new Error("assistant-grant-missing-with-history");
  if (expectedSchemaVersion >= 4) validated += validateWorkbookLibrary(database);
  if (expectedSchemaVersion >= 9) createAssistantModelPreferenceRepository({ database, read: work => work(), mutate: () => { throw new Error("assistant-preference-readonly"); } }).get();
  try{readAppSettings(database);}catch(error){throw new Error(`authority table settings failed native record validation: ${errorMessage(error)}`,{cause:error});}
  return validated;
}

function authorityContentFingerprint(database: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const table of migrationTableNames(readIntPragma(database, "user_version"))) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table)}`).iterate()) {
      hash.update(canonicalJsonStringify(z.record(z.string(),z.union([z.string(),z.number(),z.null()])).parse(row)));
    }
  }
  return hash.digest("hex");
}

function relocationUnchangedAuthorityFingerprint(database: DatabaseSync): string {
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const present = new Set(inspectionTableNames(database));
  const hash = createHash("sha256");
  for (const table of AuthorityTableNameSchema.options.filter((name) => present.has(name) && !excluded.has(name))) {
    hash.update(canonicalJsonStringify(table));
    for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table)}`).iterate()) {
      hash.update(canonicalJsonStringify(z.record(z.string(), z.unknown()).parse(row)));
    }
  }
  return hash.digest("hex");
}

function relocationChangedAuthorityTables(before: DatabaseSync, after: DatabaseSync): readonly string[] {
  const excluded = new Set(["database_states", "settings", "settings_snapshots", "run_search"]);
  const beforeNames = new Set(inspectionTableNames(before));
  const afterNames = new Set(inspectionTableNames(after));
  return AuthorityTableNameSchema.options.filter((table) => !excluded.has(table)).filter((table) => {
    if (beforeNames.has(table) !== afterNames.has(table)) return true;
    if (!beforeNames.has(table)) return false;
    const fingerprint = (database: DatabaseSync): string => {
      const hash = createHash("sha256");
      for (const row of database.prepare(`SELECT * FROM ${table} ORDER BY ${nativeTableKey(table)}`).iterate()) {
        hash.update(canonicalJsonStringify(z.record(z.string(), z.unknown()).parse(row)));
      }
      return hash.digest("hex");
    };
    return fingerprint(before) !== fingerprint(after);
  });
}

function assertRelocationPublications(before: DatabaseSync, after: DatabaseSync, sourceGeneration: number, activatedAt: string): void {
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
    throw new Error("storage-relocation: search publication differs from activation transaction");
  }
}

function assertNoRelocationCopyCompanions(path: string): void {
  if (lstatSync(`${path}-wal`, { throwIfNoEntry: false }) !== undefined
    || lstatSync(`${path}-shm`, { throwIfNoEntry: false }) !== undefined) {
    throw new Error("storage-relocation: stage authority copy has preexisting companion");
  }
}

function removeRelocationCopyInspectionCompanions(path: string): void {
  for (const candidate of [`${path}-wal`, `${path}-shm`]) {
    const info = lstatSync(candidate, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
      || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0
      || (candidate.endsWith("-wal") && info.size !== 0))) {
      throw new Error("storage-relocation: stage authority inspection created unsafe companion");
    }
  }
  for (const candidate of [`${path}-wal`, `${path}-shm`]) {
    if (lstatSync(candidate, { throwIfNoEntry: false }) !== undefined) unlinkSync(candidate);
  }
  const fd = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

const RelocationSettingsSnapshotRowSchema = AuthorityRecordFingerprintRowSchema.extend({
  revision: z.number().int().positive(), fingerprint: FingerprintSchema, captured_at: IsoInstantSchema,
});

function relocationSettingsSnapshots(database: DatabaseSync): readonly string[] {
  return database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all().map((raw) => {
    const row = RelocationSettingsSnapshotRowSchema.parse(raw);
    const record = ConfigSnapshotRecordSchema.parse(JSON.parse(row.payload_json));
    if (record.configSnapshotId !== row.id || record.capturedAt !== row.captured_at
      || record.revision !== row.revision || record.fingerprint !== row.fingerprint) {
      throw new Error("storage-relocation: snapshot row metadata changed");
    }
    return canonicalJsonStringify(row);
  });
}

function relocationAppSettings(database: DatabaseSync) {
  const rows = database.prepare("SELECT * FROM settings ORDER BY id").all()
    .map((raw) => AuthorityRecordFingerprintRowSchema.extend({ revision: z.number().int().positive(),
      snapshot_id: z.string(), command_id: z.string(), audit_id: z.string(), updated_at: z.string() }).parse(raw));
  if (rows.length > 1 || rows.some((row) => row.id !== "current")) {
    throw new Error("storage-relocation: app settings membership changed");
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
    throw new Error("storage-relocation: app settings row metadata changed");
  }
  return value;
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE command.family <> 'bulk-parent' AND NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.id)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    leases: count("SELECT count(*) AS count FROM worker_leases"),
    providerReservations: 0,
    artifactOutbox: count("SELECT count(*) AS count FROM artifacts f,json_each(f.payload_json,'$.updates') u WHERE f.kind='generated' AND json_extract(u.value,'$.record.state')='pending'"),
  };
}

const expectedNativeSchemas = new Map<number, string>();
function normalizedNativeSchema(database: DatabaseSync): string {
  const schema = z.strictObject({type:z.string(),name:z.string(),table:z.string(),sql:z.string()});
  return canonicalJsonStringify(database.prepare("SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(raw => { const row = schema.parse(raw); return {...row,sql:row.sql.trim().replace(/\s+/gu," ")}; }));
}
function assertNativeSchema(database: DatabaseSync, version = CURRENT_AUTHORITY_SCHEMA_VERSION): void {
  if (!expectedNativeSchemas.has(version)) {
    const expected = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS) if (migration.version <= version) for (const statement of migration.statements) expected.exec(statement);
      expectedNativeSchemas.set(version, normalizedNativeSchema(expected));
    } finally { expected.close(); }
  }
  if (normalizedNativeSchema(database) !== expectedNativeSchemas.get(version)) throw new Error("authority-native-schema-shape-mismatch");
}

export function inspectNativeAuthority(database: DatabaseSync, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas = false) {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if ((!isSupportedStoppedAuthoritySchemaVersion(expectedSchemaVersion) && expectedSchemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) || schemaVersion !== expectedSchemaVersion) throw new AuthoritySchemaVersionError(schemaVersion);
  assertNativeSchema(database, schemaVersion);
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
  const names = inspectionTableNames(database);
  const expected = [...migrationTableNames(expectedSchemaVersion)].sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = readMetaRow(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  validateAuthorityRecordSchemas(database, true, expectedSchemaVersion);
  validateExplorerOverrides(database);
  validateNotificationMetadata(database);
  validateWorkerControls(database);
  const violations = invariantViolations(database);
  if (violations.length > 0) throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
  createRunSearchIndex(database).validateCoverage();
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
  return AuthorityCopyInspectionSchema.extend({ schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]), installationId: z.uuid().optional(), profileId: z.uuid().optional() }).parse({
    applicationId,
    schemaVersion,
    installationId: meta.installation_id,
    profileId: meta.profile_id,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    authorityContentFingerprint: authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: tableClassification(AuthorityTableNameSchema.parse(name)) })),
    counts: pendingCounts(database),
  });
}

function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean): AuthorityCopyInspection {
  return AuthorityCopyInspectionSchema.parse(inspectNativeAuthority(database, CURRENT_AUTHORITY_SCHEMA_VERSION, requireOperationalPragmas));
}

/** Internal stopped-upgrade barrier; never exported through the repository entrypoint. */
export function inspectNormalAuthority(database: DatabaseSync): AuthorityCopyInspection {
  if (!isCurrentAuthoritySchemaVersion(readIntPragma(database, "user_version"))) throw new Error("normal-authority-schema-mismatch");
  return inspectOpenDatabase(database, false);
}

function readAuthorityUpgradeRecords(database: DatabaseSync) {
  return database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()
    .map(row => AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", row)));
}

function migrateStoppedAuthority(database: DatabaseSync, clock: Clock, admission: RuntimeAdmission, path: string, expectedFingerprint?: string, backup?: VerifiedBackup, verifyBackup?: (admission: RuntimeAdmission, manifestPath: string, expectedSourceDatabaseIdentity: string) => VerifiedBackup) {
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
      const verified = verifyBackup(admission, backup.manifestPath, AuthorityDatabase.sourceDatabaseIdentity(path));
      if (canonicalJsonStringify(verified) !== canonicalJsonStringify(backup)
        || verified.manifest.installationId !== binding.installationId || verified.manifest.profileId !== binding.profileId) throw new Error("profile-stopped-upgrade-backup-changed");
    }
    if (backup.manifest.schemaVersion !== version || backup.manifest.authorityContentFingerprint !== fingerprint
      || backup.manifest.authorityGeneration !== meta.authority_generation) throw new Error("source-changed: upgrade backup differs from source");
    const planDigest = deriveAuthorityUpgradePlanDigest(version, fingerprint);
    for (const migration of SQLITE_MIGRATIONS.filter(item => item.version > version)) {
      for (const [index, statement] of migration.statements.entries()) {
        if (migration.version === 7 && index === 1) {
          database.prepare("INSERT INTO database_states_bound SELECT id,schema_version,authority_generation,updated_at,search_generation,search_state,?,? FROM database_states")
            .run(binding.installationId, binding.profileId);
        }
        database.exec(statement);
      }
    }
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    const record = AuthorityUpgradeRecordSchema.parse({ recordKey: randomUUID(), upgradeId: fingerprint,
      phase: "settled", fromSchemaVersion: version, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      planDigest, backup: { manifestPath: backup.manifestPath, sha256: backup.manifest.sha256, authorityGeneration: backup.manifest.authorityGeneration },
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: clock.now().toISOString() });
    database.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(record.recordKey, record.upgradeId, record.phase, backup.manifest.sha256, canonicalJsonStringify(record), record.recordedAt);
    const inspection = inspectNormalAuthority(database);
    database.exec("COMMIT");
    return { ...inspection, schemaVersion: version, authorityContentFingerprint: fingerprint };
  } catch (error) {
    const failures: unknown[] = [];
    try { database.exec("ROLLBACK"); } catch (rollbackError) { failures.push(rollbackError); }
    if (failures.length !== 0) throw retainAuthoritySourceClosure([error, ...failures], { database });
    throw error;
  }
}

function requireStoppedUpgradeSource(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock): void {
  requireRuntimeAdmission(admission).assertStoppedProfileUpgrade(path, processLockRoot);
  requireDatabaseSourcePath(path);
  const locks = observeRuntimeLockSnapshot({ processLockRoot,
    sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) }, clock);
  if (Object.values(locks.processLocks).some(lock => lock.state === "active")) throw new Error("runtime-active: stop server, workers and geocode before storage upgrade");
}

function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number): AuthorityCopyInspection {
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
    const inspection = inspectOpenDatabase(database, false);
    database.exec("COMMIT");
    transactionOpen = false;
    return inspection;
  } finally {
    try {
      if (transactionOpen) database.exec("ROLLBACK");
    } finally {
      try { database.close(); } finally {
        try { snapshotCopy.assertUnchanged(); } finally { snapshotCopy.dispose(); }
      }
    }
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
      try { database.close(); } finally {
        try { snapshotCopy.assertUnchanged(); } finally { snapshotCopy.dispose(); }
      }
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
      try { database.close(); } finally {
        try { snapshotCopy.assertUnchanged(); } finally { snapshotCopy.dispose(); }
      }
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

function readManagedArtifactReferencesFromDatabase(database: DatabaseSync, candidate?: ArtifactRef): readonly ArtifactRef[] {
      const references = new Map<string, ArtifactRef>();
      const visit = (value: unknown): void => {
        if (value === null || typeof value !== "object") return;
        if (candidate !== undefined && containsDeletionArtifactReference(value, candidate)) references.set(candidate.sha256, candidate);
        const full = ArtifactRefSchema.safeParse(value);
        if (full.success) references.set(full.data.sha256, full.data);
        if (Array.isArray(value)) { for (const member of value) visit(member); return; }
        const object = value as Record<string, unknown>;
        if (typeof object.preparationJson === "string") visit(JSON.parse(object.preparationJson));
        const attachment = DiagnosticAttachmentSchema.safeParse(value);
        if (attachment.success) {
          const row = attachment.data;
          const ref = ArtifactRefSchema.parse({ id: row.artifactId, sha256: row.digest, bytes: row.byteLength, mediaType: row.mediaType });
          references.set(ref.sha256, ref);
        }
        for (const member of Object.values(object)) visit(member);
      };
      for (const table of AUTHORITY_TABLE_REGISTRY.map(entry => entry.name)) {
        const columns = database.prepare(`PRAGMA table_info(${table})`).all()
          .map(raw => z.object({ name: z.string() }).parse(raw).name)
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
      return Object.freeze([...references.values()].map(reference => Object.freeze(reference)));
}

export class AuthorityDatabase implements Disposable {
  readonly #admission: RuntimeAdmission;
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #credentialCommandIds: (commandId: string) => boolean;
  #closed = false;
  #validatedExternalDataVersion: number | undefined;
  #snapshotExternalDataVersion: number | undefined;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | "read" | undefined;
  #authorityDirty = false;
  #explorerOverridesDirty = false;
  #workerMembershipChanges = new Set<string>();
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
    purpose: "ordinary" | "profile-initialization" | "stopped-restore-projection" = "ordinary",
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    this.#admission = requireRuntimeAdmission(admission);
    this.#admission.assertAuthorityDatabase(options.path);
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
      const identity = lstatSync(options.path);
      if (!identity.isFile() || identity.nlink !== 1 || (process.getuid !== undefined && identity.uid !== process.getuid())) throw new Error("profile-database-identity-invalid");
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
      const existingVersion = existed ? this.#admitExistingSchema() : undefined;
      if (existed) {
        const actual = ProfileDatabaseBindingSchema.parse(this.#database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get());
        if (canonicalJsonStringify(actual) !== canonicalJsonStringify(binding)) throw new Error("profile-database-binding-mismatch");
      }
      if (readOnlyNoMigrate) {
        this.#configureReadOnlyConnection();
        this.#validateReadOnlyNoMigrateDatabase(existingVersion);
      } else {
        if (!existed && purpose !== "stopped-restore-projection") this.#initializeSchema(existingVersion, options.migrationOwner);
        this.#configureConnection();
        if (existed && purpose === "ordinary") this.#initializeSchema(existingVersion, options.migrationOwner);
        this.#validateDatabase();
      }
      readAppSettings(this.#database);
      this.#credentialCommandIds = commandId => {
        if (credentials === undefined) throw new CredentialContextRequiredError();
        assertCredentialStoreOwner(credentials, this.#admission);
        return credentials.ownsCommandId(commandId);
      };
    } catch (error) {
      this.#database.close();
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
    return new AuthorityDatabase(admission, input, clock, writeCommitHooks, terminalizationHooks, lifecycleHooks, credentials);
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
      const artifactReferenceCount = readManagedArtifactReferencesFromDatabase(database).length;
      const empty = counts.every(row => row.table === "database_states" || row.table === "database_upgrades" || row.count === 0) && artifactReferenceCount === 0;
      owner.assertStoppedIncompleteProfileInventory();
      return Object.freeze({ authorityGeneration: inspection.authorityGeneration, counts, artifactReferenceCount, empty });
    });
  }

  static readProfileMaintenanceInventory(admission: RuntimeAdmission) {
    const owner = requireRuntimeAdmission(admission), path = join(owner.stateRoot, "state.db");
    owner.assertLive();
    return withAuthorityDatabaseReadOnly(owner, path, database => {
      const inspection = inspectNativeAuthority(database, owner.profileMaintenanceSchemaVersion());
      const binding = owner.profileBinding;
      if (inspection.installationId !== binding.installationId || inspection.profileId !== binding.profileId) throw new Error("profile-maintenance-binding-mismatch");
      const settings = readAppSettings(database);
      const settingsAuthority = settings === undefined
        ? Object.freeze({ state: "never-initialized" as const })
        : Object.freeze({ state: "initialized" as const, record: settings });
      const configSnapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
        .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", row)));
      const slots = database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all().map(workerSlotFromRow);
      const browsers = database.prepare("SELECT * FROM browser_sessions ORDER BY id").all().map(workerBrowserFromRow);
      const leases = database.prepare("SELECT * FROM worker_leases ORDER BY id").all().map(row => WorkerLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("worker_leases", row)));
      const controls = database.prepare("SELECT * FROM worker_controls ORDER BY command_id").all().map(row => {
        const record = workerControlFromRow(row), authenticated = readWorkerControl(database, record.commandId);
        if (authenticated === undefined) throw new Error("worker-control-command-binding-mismatch");
        return authenticated;
      });
      const reservations = readWorkerReservationCustody(database, slots, controls);
      const runs = database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow);
      const writeIntents = database.prepare("SELECT * FROM write_intents ORDER BY id").all().map(row => WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", row)));
      const duoLeases = database.prepare("SELECT * FROM auth_leases ORDER BY credential_key").all().map(row => DuoCeremonyLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("auth_leases", row)));
      const pendingArtifacts = createGeneratedArtifactRepository({ database, mutate: () => { throw new Error("profile-maintenance-mutation-refused"); } }).outbox.listPending();
      return Object.freeze({ authorityGeneration: inspection.authorityGeneration, settingsAuthority, configSnapshots, slots, reservations, browsers, leases, controls, runs, writeIntents, duoLeases, pendingArtifacts, upgrades: readAuthorityUpgradeRecords(database), artifactReferences: readManagedArtifactReferencesFromDatabase(database) });
    });
  }

  static openStoppedRestoreProjection(admission: RuntimeAdmission, input: unknown, clock: Clock = systemClock): AuthorityDatabase {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    admission.assertStoppedRestoreProjection(options.path);
    if (options.openMode !== "read-write") throw new Error("profile-restore-projection-mode-refused");
    const inspection = inspectExistingDatabaseReadOnly(options.path, options.busyTimeoutMs);
    if (inspection.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error("profile-restore-projection-schema-refused");
    admission.assertStoppedRestoreProjection(options.path);
    return new AuthorityDatabase(admission, options, clock, undefined, undefined, undefined, undefined, "stopped-restore-projection");
  }

  static initializeProfile(admission: RuntimeAdmission, clock: Clock = systemClock): void {
    admission.assertProfileInitialization();
    const path = join(admission.stateRoot, "state.db");
    if (existsSync(path)) throw new Error("profile-database-initialization-already-exists");
    const database = new AuthorityDatabase(admission, { path, busyTimeoutMs: 250, migrationOwner: "profile-initialization" }, clock, undefined, undefined, undefined, undefined, "profile-initialization");
    database.close();
  }

  static sourceDatabaseIdentity(path: string): string {
    return authoritySourceDatabaseIdentity(path);
  }

  static inspectExistingReadOnly(admission: RuntimeAdmission, path: string, busyTimeoutMs = 250): AuthorityCopyInspection {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    return inspectExistingDatabaseReadOnly(path, busyTimeoutMs);
  }

  static inspectStoppedUpgrade(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock) {
    requireStoppedUpgradeSource(admission, path, processLockRoot, clock);
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
  }

  static upgradeStopped(admission: RuntimeAdmission, path: string, processLockRoot: string, clock: Clock, expectedFingerprint?: string, backup?: VerifiedBackup, verifyBackup?: (admission: RuntimeAdmission, manifestPath: string, expectedSourceDatabaseIdentity: string) => VerifiedBackup) {
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
    return inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs);
  }

  static inspectSpanRunAuthorityReadOnly(
    admission: RuntimeAdmission,
    path: string,
    roots: readonly SpanAuthorityRunRoot[],
    busyTimeoutMs = 250,
  ): SpanAuthorityReadSnapshot {
    requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
    return inspectSpanRunAuthorityReadOnly(path, roots, busyTimeoutMs);
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
      return { records: scanned.filter(record => record.payload.kind === "debug"),
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
    const identity = inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs, (database) => {
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
    });
    if (timeline === undefined || (includeRecoveryEvidence && recoveryEvidence === undefined)) throw new Error("timeline-read-snapshot-missing");
    return { ...identity, ...timeline, recoveryEvidence };
  }

  getSourceDatabaseIdentity(): string {
    return AuthorityDatabase.sourceDatabaseIdentity(this.#path);
  }

  async onlineBackupTo(destinationPath: string): Promise<number> {
    this.#assertOpen();
    const destination = z.string().min(1).parse(destinationPath);
    return sqliteBackup(this.#database, destination, { rate: 100 });
  }

  close(): void {
    if (this.#closed) return;
    if (this.#transactionDepth !== 0) throw new Error("cannot close authority database during a transaction");
    this.#database.close();
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

  readProfileResourceCustody() {
    this.#assertOpen();
    return this.#withReadSnapshot(() => {
      const slots = this.authority.workerSlots.list();
      const controls = this.authority.workerControls.list().map(record => {
        const authenticated = this.authority.workerControls.get(record.commandId);
        if (authenticated === undefined) throw new Error("worker-control-command-binding-mismatch");
        return authenticated;
      });
      return Object.freeze({
        authorityGeneration: this.getMeta().authorityGeneration,
        upgrades: readAuthorityUpgradeRecords(this.#database),
        slots,
        reservations: readWorkerReservationCustody(this.#database, slots, controls),
        leases: this.#database.prepare("SELECT * FROM worker_leases ORDER BY id").all()
          .map(row => this.#parseNativeRow("worker_leases", row, WorkerLeaseRecordSchema)),
        controls,
        browsers: this.#database.prepare("SELECT * FROM browser_sessions ORDER BY id").all().map(workerBrowserFromRow),
        runs: this.#database.prepare("SELECT * FROM runs ORDER BY id").all().map(runRecordFromRow),
        writeIntents: this.#database.prepare("SELECT * FROM write_intents ORDER BY id").all()
          .map(row => this.#parseNativeRow("write_intents", row, WriteIntentRecordSchema)),
        duoLeases: this.#database.prepare("SELECT * FROM auth_leases ORDER BY credential_key").all()
          .map(row => this.#parseNativeRow("auth_leases", row, DuoCeremonyLeaseRecordSchema)),
        pendingArtifacts: this.authority.artifactOutbox.listPending(),
        artifactReferences: this.readManagedArtifactReferences(),
        configSnapshots: this.#database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
          .map(row => this.#parseNativeRow("settings_snapshots", row, ConfigSnapshotRecordSchema)),
      });
    });
  }

  readManagedArtifactReferences(candidate?: ArtifactRef): readonly ArtifactRef[] {
    this.#assertOpen();
    return this.#withReadSnapshot(() => readManagedArtifactReferencesFromDatabase(this.#database, candidate));
  }

  reclaimPendingDiagnostics(): number {
    return this.withAuthorityTransaction(() => reclaimDiagnosticStages(this.#admission,
      ref => this.readManagedArtifactReferences(ref).length > 0));
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

  classifyRelocationActivation(intent: VerifiedRelocationActivationIntent, verifiedStageBackupPath = intent.stageAuthority.backupPath): "prestate" | "committed" {
    this.#assertOpen();
    this.#admission.assertExclusive();
    if (this.#path !== intent.nativeDestinationPath
      || this.#path !== join(intent.destination.stateRoot, "state.db")) {
      throw new Error("storage-relocation: activation authority path mismatch");
    }
    const copyAdmission = this.#admission.verifiedReadOnlyCopy(verifiedStageBackupPath,
      intent.stageAuthority.backupSha256);
    try {
      copyAdmission.assertReadOnlyAuthorityDatabase(verifiedStageBackupPath);
      assertNoRelocationCopyCompanions(verifiedStageBackupPath);
      const baseline = new DatabaseSync(verifiedStageBackupPath, { readOnly: true,
        enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false,
        timeout: 5000, defensive: true });
      try {
        inspectOpenDatabase(baseline, false);
        return this.#withReadSnapshot(() => {
        const before = readMetaRow(baseline);
        const after = readMetaRow(this.#database);
        if (before.schema_version !== CURRENT_AUTHORITY_SCHEMA_VERSION
          || after.schema_version !== CURRENT_AUTHORITY_SCHEMA_VERSION
          || before.authority_generation !== intent.preAuthorityGeneration
          || authorityContentFingerprint(baseline) !== intent.preAuthorityContentFingerprint) {
          throw new Error("storage-relocation: activation native baseline changed");
        }
        const baselineApp = relocationAppSettings(baseline);
        const baselineSettings = baselineApp?.saved ?? initialSettingsFileRecord();
        if (baselineSettings.revision !== intent.settingsRevision
          || baselineSettings.settingsFingerprint !== intent.settingsFingerprint) {
          throw new Error("storage-relocation: activation settings identity changed");
        }
        if (canonicalJsonStringify(baselineApp?.active ?? null) !== canonicalJsonStringify(intent.priorActive)) {
          throw new Error("storage-relocation: activation prior runtime mismatch");
        }
        if (authorityContentFingerprint(this.#database) === authorityContentFingerprint(baseline)) return "prestate";
        assertRelocationPublications(baseline, this.#database, before.authority_generation, intent.snapshot.capturedAt);
        if (relocationUnchangedAuthorityFingerprint(this.#database)
          !== relocationUnchangedAuthorityFingerprint(baseline)) {
          throw new Error(`storage-relocation: unrelated authority rows changed during activation: ${relocationChangedAuthorityTables(baseline, this.#database).join(",")}`);
        }
        const snapshots = relocationSettingsSnapshots(this.#database);
        const priorSnapshots = relocationSettingsSnapshots(baseline);
        const added = snapshots.filter((row) =>
          RelocationSettingsSnapshotRowSchema.parse(JSON.parse(row)).id === intent.snapshot.configSnapshotId);
        if (added.length !== 1 || snapshots.length !== priorSnapshots.length + 1
          || canonicalJsonStringify(snapshots.filter((row) => !added.includes(row))) !== canonicalJsonStringify(priorSnapshots)) {
          throw new Error("storage-relocation: activation snapshot history changed");
        }
        const addedRow = added[0];
        if (addedRow === undefined) throw new Error("storage-relocation: activation snapshot missing");
        const addedRecord = RelocationSettingsSnapshotRowSchema.parse(JSON.parse(addedRow));
        if (canonicalJsonStringify(ConfigSnapshotRecordSchema.parse(JSON.parse(addedRecord.payload_json)))
          !== canonicalJsonStringify(intent.snapshot)) throw new Error("storage-relocation: activation snapshot differs from intent");
        const app = relocationAppSettings(this.#database);
        const expectedActive = { generation: (intent.priorActive?.generation ?? 0) + 1,
          settingsRevision: intent.settingsRevision, settingsFingerprint: intent.settingsFingerprint,
          configSnapshotId: intent.snapshot.configSnapshotId, configFingerprint: intent.snapshot.fingerprint,
          activatedAt: intent.snapshot.capturedAt };
        if (app === null || canonicalJsonStringify(app.saved) !== canonicalJsonStringify(baselineApp?.saved ?? null)
          || canonicalJsonStringify(app.active) !== canonicalJsonStringify(expectedActive)
          || after.authority_generation !== before.authority_generation + 1
          || after.updated_at !== intent.snapshot.capturedAt
) {
          throw new Error("storage-relocation: activation state differs from intent");
        }
        return "committed";
        });
      } finally { baseline.close(); removeRelocationCopyInspectionCompanions(verifiedStageBackupPath); }
    } finally { copyAdmission.release(); }
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
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database).workflows(this.getMeta().authorityGeneration) });
  }

  queryRunSummaries(query: Parameters<ReturnType<typeof createRunSummaries>["query"]>[1]) {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database).query(this.getMeta().authorityGeneration,query) });
  }

  queryRunCalendar(query: Parameters<ReturnType<typeof createRunSummaries>["calendar"]>[1]) {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database).calendar(this.getMeta().authorityGeneration, query) });
  }

  readRunSummaries() {
    return this.withAuthorityReadSnapshot(() => { this.#validateExternalQuerySources(); return createRunSummaries(this.#database).read(this.getMeta().authorityGeneration) });
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
    {
      const control = this.authority.workerControls.get(record.commandId);
      if (control !== undefined && canonicalJsonStringify(control.request) !== canonicalJsonStringify(record)) throw new CommandIdentityConflictError();
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
      if ("family" in record && (record.family === "settings" || record.family === "failure-resolution" || record.family === 'assistant-model-preference')) throw new CommandIdentityConflictError();
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

  withAuthorityReadSnapshot<Result>(read: () => Result): Result {
    return this.#withReadSnapshot(read);
  }

  terminalizeFailure(descriptor: AnyWorkflowDescriptor, input: unknown): FailureTerminalizationReport {
    const request = FailureTerminalizationRequestSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.failure.runId);
      if (current === undefined) throw new Error(`run ${request.failure.runId} does not exist`);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#completionAuthorization(current);
      const existing = this.#readRecord("run_failures", request.failure.failureId, FailureRecordSchema);
      const existingResult = this.#readRecord("run_results", request.failure.runId, RunResultRecordSchema);
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

      const terminal = RunRecordSchema.parse({
        ...current,
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
      this.#insertRunResult(result);
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
      if (request.runId !== run.envelope.runId || (command.operation !== "transition" && command.operation !== "terminalize" && command.operation !== "requeue")) throw new Error("terminal-evidence-command-target-mismatch");
      const result = createRunTerminalEvidenceResult(run, {
        kind: "lifecycle-evidence", outcome: run.lifecycle.outcome,
        commandId: command.commandId, auditId: audit.auditId,
        requestFingerprint: command.requestFingerprint, appliedVersion: audit.result.appliedVersion,
      });
      const existing = this.#readRecord("run_results", result.runId, RunResultRecordSchema);
      if (existing === undefined) this.#insertRunResult(result);
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
      const existingResult = this.#readRecord("run_results", request.result.runId, RunResultRecordSchema);
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
      const terminal = RunRecordSchema.parse({
        ...current,
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

      this.#insertRunResult(request.result);
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

  resumeRunDeletionFiles(): void {
    if (this.#transactionDepth !== 0) throw new Error("run-deletion-cleanup-requires-committed-receipt");
    this.#admission.assertWritable();
    const pending = this.#database.prepare("SELECT * FROM deleted_runs WHERE cleanup_state='pending' ORDER BY deleted_at,run_id").all()
      .map(row=>deletedRunFromRow(row).receipt);
    for (const receipt of pending) this.settleRunDeletionFiles({runId:receipt.runId,commandId:receipt.commandId});
  }

  settleRunDeletionFiles(input: unknown): "complete" {
    const request = z.strictObject({runId:RunIdSchema,commandId:CommandIdSchema}).parse(input);
    if (this.#transactionDepth !== 0) throw new Error("run-deletion-cleanup-requires-committed-receipt");
    this.#admission.assertWritable();
    return this.#authorityWrite("deleted_runs",()=>{
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
        || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.request.operation !== "delete"
        || audit.result.kind !== "deletion" || !audit.result.runIds.includes(request.runId)) throw new Error("run-deletion-cleanup-settlement-mismatch");
      if (deletion.cleanupState === "complete") return {result:"complete" as const,changes:0};
      validateAuthorityRecordSchemas(this.#database);
      for (const file of deletion.files.filter(file=>file.disposition === "remove")) {
        for (const table of AuthorityTableNameSchema.options.filter(table=>table !== "deleted_runs")) {
          for (const row of this.#database.prepare(`SELECT * FROM ${table}`).iterate()) {
            for (const [column,value] of Object.entries(row)) {
              if (column.endsWith("_json") && typeof value === "string"
                && containsDeletionArtifactReference(JSON.parse(value) as unknown,file.ref)) throw new Error("run-deletion-cleanup-file-still-referenced");
            }
          }
        }
        removeArtifactDeletionFile(this.#admission,file);
        this.#lifecycleHooks?.afterDeletionFileRemoved?.({runId:request.runId,digest:file.ref.sha256});
      }
      const changed = this.#database.prepare("UPDATE deleted_runs SET cleanup_state='complete' WHERE run_id=? AND cleanup_state='pending'").run(request.runId);
      if (sqliteChanges(changed.changes) !== 1) throw new Error("run-deletion-cleanup-cas-lost");
      return {result:"complete" as const,changes:1};
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
      const currentIntent = this.#readRecord("write_intents", parsed.writeIntentId, WriteIntentRecordSchema);
      if (currentIntent === undefined) throw new Error(`write intent ${parsed.writeIntentId} does not exist`);
      if (currentIntent.status !== "attempting") {
        throw new Error(`write intent ${parsed.writeIntentId} is ${currentIntent.status}; only attempting may commit`);
      }
      if (currentIntent.generation !== parsed.generation) {
        throw new Error(`write intent ${parsed.writeIntentId} generation ${String(currentIntent.generation)} does not match commit generation ${String(parsed.generation)}`);
      }
      const currentAttempt = this.#readRecord("write_attempts", currentIntent.currentAttemptId, WriteAttemptRecordSchema);
      if (currentAttempt === undefined) throw new Error(`current write attempt ${currentIntent.currentAttemptId} does not exist`);
      if (currentAttempt.outcome.state !== "attempting") {
        throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only attempting may commit`);
      }
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
        status: "committed",
        completionProof: parsed.completionProof,
        confirmedAt: parsed.confirmedAt,
        version: currentIntent.version + 1,
        updatedAt: parsed.confirmedAt,
      });
      const committedAttempt = WriteAttemptRecordSchema.parse({
        ...currentAttempt,
        outcome: {
          state: "committed",
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

  commitResolvedParkedWrite(input: unknown): AtomicWriteCommitReport {
    const request = ResolvedParkedWriteCommitInputSchema.parse(input);
    const {commit,checkpoint,resolution} = request;
    return this.withAuthorityTransaction(()=>{
      const current = this.#requireAttemptBearingWriteIntent(commit.writeIntentId,commit.generation,request.expectedIntentVersion);
      if (current.status !== "parked") throw new Error("parked-write-resolution-parked-intent-required");
      const attempt = this.#requireWriteAttempt(current.currentAttemptId);
      if (attempt.outcome.state !== "parked") throw new Error("parked-write-resolution-original-attempt-required");
      const run = this.#readRunRow(current.runId);
      if (run === undefined || run.version !== resolution.expectedRunVersion || run.lifecycle.state !== "parked-write"
        || run.lifecycle.writeIntentId !== current.writeIntentId || run.lifecycle.intentGeneration !== current.generation) throw new Error("parked-write-resolution-run-cas-mismatch");
      this.#assertAtomicCommitMatchesIntent(commit,current);
      if (checkpoint.writtenAt !== commit.confirmedAt || checkpoint.runId !== current.runId
        || checkpoint.workflowId !== current.workflowId || checkpoint.itemId !== current.itemId
        || checkpoint.attempt !== current.runAttempt || Number(checkpoint.claimGeneration) !== Number(run.claimGeneration)
        || canonicalJsonStringify(checkpoint.output.value) !== canonicalJsonStringify(commit.outcome)) throw new Error("parked-write-resolution-checkpoint-mismatch");
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base} = current;
      const intent = WriteIntentRecordSchema.parse({...base,status:"committed",completionProof:commit.completionProof,
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
      const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId,request.generation,request.expectedIntentVersion);
      if (current.status !== "parked") throw new Error("parked-write-resolution-parked-intent-required");
      const attempt = this.#requireWriteAttempt(current.currentAttemptId);
      const run = this.#readRunRow(current.runId);
      if (attempt.outcome.state !== "parked" || run === undefined || run.version !== request.resolution.expectedRunVersion
        || run.lifecycle.state !== "parked-write" || run.lifecycle.writeIntentId !== current.writeIntentId
        || run.lifecycle.intentGeneration !== current.generation) throw new Error("parked-write-resolution-run-cas-mismatch");
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base} = current;
      const intent = WriteIntentRecordSchema.parse({...base,status:"retryable",settlement:request.settlement,
        resolvedAt:request.resolution.resolvedAt,version:current.version+1,updatedAt:request.resolution.resolvedAt,resolution:request.resolution});
      authenticateStoredWriteResolution(this.#database,intent);
      this.#replaceWriteIntent(intent);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      if (canonicalJsonStringify(this.#requireWriteAttempt(attempt.writeAttemptId)) !== canonicalJsonStringify(attempt)) throw new Error("parked-write-resolution-original-attempt-changed");
      return intent;
    });
  }

  assertCurrentExecution(input: unknown, allowAdmittedReset = false): void {
    const request = RunHeartbeatRequestSchema.pick({ runId: true, claim: true }).parse(input);
    this.withAuthorityReadSnapshot(() => this.#assertCurrentExecution(request.runId, request.claim, allowAdmittedReset));
  }

  #assertCurrentExecution(runId: string, claim: z.infer<typeof RunClaimTokenSchema>, allowAdmittedReset = false): void {
    this.#admission.assertProfileRuntime();
    const run = this.#readRunRow(runId), held = run === undefined ? undefined : runClaim(run);
    const lifetime = run !== undefined && "workerLifetime" in run.lifecycle ? run.lifecycle.workerLifetime : undefined;
    const slot = this.authority.workerSlots.get(claim.workerId), lease = this.authority.workerLeases.get(claim.workerId);
    if (run === undefined || held?.workerId !== claim.workerId || held.claimGeneration !== claim.claimGeneration
      || lifetime === undefined || slot === undefined || slot.retiredAt !== null || lease === undefined
      || lifetime.membershipRevision !== slot.membershipRevision || lifetime.leaseGeneration !== lease.leaseGeneration
      || lease.workflow !== slot.workflow || lease.processId !== process.pid || lease.birthCommandId === undefined
      || !isLiveWorker(lease) || lease.lifecycle.state === "stopping"
      || (!allowAdmittedReset && this.authority.workerControls.resetForWorker(claim.workerId) !== undefined)
      || this.authority.workerControls.lifecycleForWorker(claim.workerId) !== undefined
      || this.authority.workerControls.initializingForWorker(claim.workerId, lease.leaseGeneration) !== undefined
      || this.authority.workerSlots.recovery(claim.workerId) !== undefined
      || this.authority.workerSlots.verification(claim.workerId) !== undefined
      || !authenticateDescendantHome(this.authority, run, slot.workflow)) throw new WorkerControlRefusal("worker-execution-lost");
    const custody = this.workerLifetimeCustody(claim.workerId);
    if (custody.state !== "alive" || custody.birth.owner.pid !== process.pid) throw new WorkerControlRefusal("worker-execution-lost");
    const visited = new Set<string>();
    let current = run;
    for (;;) {
      if (visited.has(current.envelope.runId)) throw new Error("delegation-ancestry-cycle");
      visited.add(current.envelope.runId);
      if (!allowAdmittedReset && this.authority.workerControls.resetForRun(current.envelope.runId) !== undefined) throw new WorkerControlRefusal("worker-execution-lost");
      if (current.envelope.parent === undefined) break;
      const edge = delegationEdgeForChild(this.authority, current.envelope.parent.runId, current.envelope.runId);
      if (edge.policy.cascadeCancel === "independent") break;
      const parent = this.authority.runs.get(current.envelope.parent.runId);
      if (parent === undefined) throw new Error("delegation-parent-unavailable");
      current = parent;
    }
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
      const query = INVARIANT_QUERIES.find(({ name }) => name === "run-completion-revisions");
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
    const invocations = this.authority.lifecycleJournal.listDelegationInvocations(current.envelope.runId);
    const receipts = result.dependencies.filter(dependency => dependency.state === "child-resolved" || dependency.state === "delegation-resolved");
    const receiptIds = receipts.map(dependency => dependency.state === "delegation-resolved" ? dependency.invocationCommandId
      : lifecycleCommandId("delegation-invocation", { runId: current.envelope.runId, attempt: current.envelope.attempt, nodeId: dependency.nodeId }));
    if (canonicalJsonStringify(invocations.map(command => command.commandId).sort()) !== canonicalJsonStringify([...receiptIds].sort())) {
      throw new Error("terminal-delegation-receipt-set-mismatch");
    }
    for (const dependency of result.dependencies) {
      if (dependency.state === "child-resolved" || dependency.state === "delegation-resolved") {
        const evidence = readDelegationEvidence(this.authority, current.envelope.runId, dependency.nodeId);
        if (canonicalJsonStringify(terminalDelegationDependencyRecord(evidence)) !== canonicalJsonStringify(dependency)
          || delegationJoinDisposition(evidence.manifest, evidence.children.map(member => member.run.lifecycle.state === "terminal"
            ? member.run.lifecycle.outcome : "active")) !== "satisfied") throw new Error("terminal-delegation-dependency-canonical-mismatch");
        for (const member of evidence.children) {
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

  #insertRunResult(record: RunResultRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_results", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_results
          (run_id, workflow, attempt, result_digest, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        record.runId, record.workflowId, record.attempt,
        record.resultDigest, json, record.createdAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #assertOpen(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
    const expected = this.#admission.profileBinding;
    const actual = ProfileDatabaseBindingSchema.parse(this.#database.prepare("SELECT installation_id AS installationId,profile_id AS profileId FROM database_states WHERE id=1").get());
    if (actual.installationId !== expected.installationId || actual.profileId !== expected.profileId) throw new Error("profile-database-binding-mismatch");
  }

  #configureConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    // Enable secure deletion so freed SQLite pages do not retain deleted run bytes.
    this.#database.exec("PRAGMA secure_delete = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#database.exec(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
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
      for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) this.#database.exec(statement);
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

  #validateExternalQuerySources(mode: "selector" | "mutation" = "selector", searchValidation: "all" | "progress" | "none" = "all"): void {
    const observed = readIntPragma(this.#database, "data_version");
    if (observed === this.#validatedExternalDataVersion && observed === this.#snapshotExternalDataVersion) return;
    try {
      validateAuthorityRecordSchemas(this.#database, searchValidation === "all");
      const violations = invariantViolations(this.#database);
      if (violations.length > 0) throw new Error("current composite authority is invalid");
      if (searchValidation !== "none") createRunSearchIndex(this.#database).validateCoverage();
    } catch (error) {
      this.#validatedExternalDataVersion = undefined;
      if (mode === "mutation") throw error;
      throw new Error("run-search-index-rebuild-required", { cause: error });
    }
    this.#validatedExternalDataVersion = searchValidation !== "none" && observed === this.#snapshotExternalDataVersion
      && readIntPragma(this.#database, "data_version") === observed ? observed : undefined;
  }

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result, searchValidation: "all" | "progress" | "none" = "all"): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) {
      if (this.#transactionMode === "read") throw new Error(`${mode} mutation cannot run inside an authority read snapshot`);
      if (this.#transactionMode === "projection" && mode === "authority") throw new Error("authority mutation cannot run inside a projection transaction");
      const savepoint = `authority_nested_${String(this.#savepointSequence += 1)}`;
      const dirtyBefore = this.#authorityDirty;
      const explorerDirtyBefore = this.#explorerOverridesDirty;
      const workerMembershipBefore = new Set(this.#workerMembershipChanges);
      const callbacksBefore = this.#authorityCommitCallbacks.length;
      this.#database.exec(`SAVEPOINT ${savepoint}`);
      this.#transactionDepth += 1;
      try {
        const result = work();
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        this.#authorityDirty = dirtyBefore;
        this.#explorerOverridesDirty = explorerDirtyBefore;
        this.#workerMembershipChanges = workerMembershipBefore;
        this.#authorityCommitCallbacks.splice(callbacksBefore);
        throw error;
      } finally { this.#transactionDepth -= 1; }
    }
    this.#snapshotExternalDataVersion = readIntPragma(this.#database, "data_version");
    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;
    this.#transactionMode = mode;
    this.#authorityDirty = false;
    this.#explorerOverridesDirty = false;
    this.#workerMembershipChanges.clear();
    let result: Result;
    try {
      this.#validateExternalQuerySources("mutation", searchValidation);
      const search = createRunSearchIndex(this.#database);
      const priorSearch = search.publication();
      result = work();
      for (const workflow of this.#workerMembershipChanges) requireWorkerPoolRoster(this.authority, workflow);
      if (this.#authorityDirty) {
        const update = this.#database.prepare("UPDATE database_states SET authority_generation=authority_generation+1,updated_at=?,search_state='invalid',search_generation=NULL WHERE id=1").run(this.#now());
        if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation singleton is missing");
        search.publishChanges(this.getMeta().authorityGeneration, this.#now(), priorSearch);
      }
      if (this.#explorerOverridesDirty) validateExplorerOverrides(this.#database);
      this.#database.exec("COMMIT");
      if (searchValidation === "none") this.#validatedExternalDataVersion = this.#snapshotExternalDataVersion;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#authorityCommitCallbacks.splice(0);
      throw error;
    } finally {
      this.#transactionDepth = 0;
      this.#transactionMode = undefined;
      this.#snapshotExternalDataVersion = undefined;
      this.#authorityDirty = false;
      this.#explorerOverridesDirty = false;
      this.#workerMembershipChanges.clear();
    }
    const callbacks = this.#authorityCommitCallbacks.splice(0);
    for (const callback of callbacks) callback();
    return result;
  }

  #withReadSnapshot<Result>(read: () => Result): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) return read();

    this.#snapshotExternalDataVersion = readIntPragma(this.#database, "data_version");
    this.#database.exec("BEGIN");
    this.#transactionDepth = 1;
    this.#transactionMode = "read";
    this.#authorityDirty = false;
    this.#explorerOverridesDirty = false;
    try {
      const result = read();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth = 0;
      this.#transactionMode = undefined;
      this.#snapshotExternalDataVersion = undefined;
      this.#authorityDirty = false;
      this.#explorerOverridesDirty = false;
      }
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
        if (table === "explorer_overrides") this.#explorerOverridesDirty = true;

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
      return row === undefined ? undefined : schema.parse(runRecordFromRow(row));
    }
    const key = table === "run_results" || table === "deleted_runs" ? "run_id"
      : table === "worker_pools" ? "workflow" : table === "worker_controls" ? "command_id"
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
      if (table === "write_intents") { authenticateStoredWriteResolution(this.#database,record); assertConfirmationPublication(this.#database,recordKey); }
      if (table === "command_audits") authenticateStoredResolutionAudit(this.#database,record);
      return schema.parse(record);
    }
    throw new Error(`native reader is undefined for ${table}`);
  }

  #parseNativeRow<Schema extends z.ZodType>(table: NativeOrdinaryTable,row:unknown,schema:Schema):z.infer<Schema> {
    const record=nativeOrdinaryRecordFromRow(table,row);
    if(table === "write_intents") { authenticateStoredWriteResolution(this.#database,record); assertConfirmationPublication(this.#database,z.object({writeIntentId:z.string()}).parse(record).writeIntentId); }
    if(table === "command_audits")authenticateStoredResolutionAudit(this.#database,record);
    return schema.parse(record);
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
    const validateOperation = (input: unknown): void => {
      const identity = DeclaredActionIdentitySchema.parse(input);
      const run = readTimelineRun(this.#database, identity.runId);
      if (run === undefined || identity.attempt !== run.envelope.attempt
        || Number(identity.claimGeneration) !== Number(run.claimGeneration)
        || identity.definitionFingerprint !== run.envelope.contractFingerprint) throw new Error("diagnostic-operation-owner-execution-mismatch");
      const definition = requireWorkflowOperationDisplaySnapshot(run.envelope.operationDisplaySnapshot, { workflowId: run.envelope.workflow, definitionFingerprint: run.envelope.contractFingerprint });
      requireOperationSourceDeclaration(definition, identity);
      if (run.envelope.parent === undefined ? identity.childInvocation !== undefined : identity.childInvocation?.parentRunId !== run.envelope.parent.runId || identity.childInvocation.edgeId !== run.envelope.parent.edgeId) throw new Error("diagnostic-operation-child-identity-mismatch");
      const expected = canonicalJsonStringify(identity);
      let cursor = 0;
      for (;;) {
        const rows = this.#database.prepare("SELECT * FROM timeline_events WHERE run_id=? AND cursor>? ORDER BY cursor LIMIT 500").all(identity.runId, cursor);
        for (const raw of rows) {
          const record = timelineEventFromRow(raw);
          cursor = record.cursor;
          if (record.payload.kind !== "note") continue;
          const note = record.payload.note;
          const occurrence = note.action?.operation;
          if (occurrence === undefined) continue;
          const { value: _value, ...retained } = occurrence;
          if (canonicalJsonStringify(retained) !== expected) continue;
          if (!("runId" in note) || note.runId !== identity.runId || note.workflow !== run.envelope.workflow || note.attempt !== identity.attempt || note.traceId !== run.envelope.traceId) throw new Error("diagnostic-operation-note-owner-mismatch");
          return;
        }
        if (rows.length < 500) break;
      }
      throw new Error("diagnostic-operation-exact-occurrence-not-retained");
    };
    const insert = (input: unknown, publication?: Readonly<{ publish(): DiagnosticBundle; committed(): void }>) => {
        let record = DiagnosticBundleSchema.parse(input);
        if (record.operation !== undefined) validateOperation(record.operation);
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
      validateOperation,
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
      explorerOverrides: createExplorerOverrideRepository({ database: this.#database, mutate: (work) => {
        if (this.#transactionDepth === 0 || this.#transactionMode !== "authority") throw new Error("explorer-override-command-transaction-required");
        return this.#authorityWrite("explorer_overrides", work);
      } }),
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
          const record = AdmittedExtractionSchema.parse(input);
          const key = `${record.sourceSha256}#${String(record.sourcePage)}#${record.formType}`;
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("artifacts", () => {
            const existing = this.#readRecord("artifacts", key, AdmittedExtractionSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(
                  `page ${String(record.sourcePage)} of ${record.sourceSha256} was already read for `
                  + `${record.formType} with a different result; replacing it is an explicit decision`,
                );
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
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (sourceSha256: string, sourcePage: number, formType: string) =>
          this.#readRecord("artifacts", `${sourceSha256}#${String(sourcePage)}#${formType}`, AdmittedExtractionSchema),
        findByDocument: (sourceSha256: string) => this.#database.prepare(`
          SELECT * FROM artifacts WHERE kind='extracted' AND source_sha256 = ? ORDER BY source_page
        `).all(sourceSha256).map((row) =>
          AdmittedExtractionSchema.parse(extractedArtifactFromRow(row))),
      }),
      evidenceReceipts: Object.freeze({
        insert: (input: unknown) => {
          const record = RunEvidenceReceiptSchema.parse(input);
          const json = canonicalJsonStringify(record);
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
                (id, run_id, workflow, attempt, result, confidence, failure_id, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.receiptId, record.runId, record.workflowId, record.attempt,
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
            SELECT * FROM run_receipts WHERE run_id = ?
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
        get: (runId: string) => {
          const record = this.#readRecord("run_results", RunIdSchema.parse(runId), RunResultRecordSchema);
          if (record === undefined) return undefined;
          assertTerminalEvidenceOwner(this.#database,record);
          return record;
        },
      }),
      failureResolution: createFailureResolutionRepository({ database: this.#database, mutate: (work) => this.#authorityWrite("run_failures", work) }),
      startPlans: this.#buildStartPlanRepository(),
      workerLeases: this.#buildWorkerLeaseRepository(),
      workerControls: createWorkerControlRepository({ database: this.#database,
        edgeForChild: (parentRunId, childRunId) => delegationEdgeForChild(this.authority, parentRunId, childRunId),
        resetSnapshot: (reset, childRunId) => resetDependencySnapshot(this.authority, reset, childRunId),
        mutate: (table, work) => {
        return this.withAuthorityTransaction(() => this.#authorityWrite(table, work));
      } }),
      duoCeremonyLeases: this.#buildDuoCeremonyLeaseRepository(),
      workerPools: this.#buildWorkerPoolRepository(),
      workerSlots: createWorkerSlotRepository({ database: this.#database, admission: this.#admission, clock: this.#clock, mutate: work => this.#authorityWrite("worker_slots", () => {
        const outcome = work();
        if (outcome.changes > 0) this.#workerMembershipChanges.add(outcome.result.workflow);
        return outcome;
      }) }),
      runSessions: this.#buildRunSessionRepository(),
      commands: Object.freeze({
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
        listStorageRelocationCommands: () => this.#database.prepare(`
          SELECT * FROM commands WHERE family = 'storage-relocation' ORDER BY rowid
        `).all().map(row => StorageRelocationCommandRequestSchema.parse(commandFromRow(row))),
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
        findRunOrigin: (runId: string) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation') IN ('create','retry','restart')
            AND json_extract(outcome_json,'$.result.kind')='run'
            AND json_extract(outcome_json,'$.result.runId')=? ORDER BY id`).all(RunIdSchema.parse(runId));
          if (rows.length > 1) throw new Error("delegation-root-origin-ambiguous");
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
        listDelegationInvocations: (parentRunId: string) => this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
          AND json_extract(request_json,'$.operation')='delegation-invocation'
          AND json_extract(request_json,'$.request.runId')=? ORDER BY id`).all(parentRunId)
          .map(row => RunLifecycleCommandRecordSchema.parse(commandFromRow(row))),
        findDelegationInvocation: (manifestId: string) => {
          const rows = this.#database.prepare(`SELECT * FROM commands WHERE family='run-lifecycle'
            AND json_extract(request_json,'$.operation')='delegation-invocation'
            AND json_extract(request_json,'$.request.manifestId')=? ORDER BY id`).all(manifestId);
          if (rows.length > 1) throw new Error("delegation-invocation-ambiguous");
          return rows[0] === undefined ? undefined : RunLifecycleCommandRecordSchema.parse(commandFromRow(rows[0]));
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
        evidence: (parentRunId: string, nodeId: string) => readDelegationEvidence(this.authority, parentRunId, nodeId),
        lifecycleEdgeForChild: (parentRunId: string, childRunId: string) => lifecycleChildEdge(this.authority, parentRunId, childRunId),
        edgeForChild: (parentRunId: string, childRunId: string) => delegationEdgeForChild(this.authority, parentRunId, childRunId),
        resetSnapshot: (reset: WorkerResetBinding, childRunId: string) => resetDependencySnapshot(this.authority, reset, childRunId),
        cancellationOutcome: (runId: string) => readDelegationCancellation(this.authority, runId),
        childHistory: (dependencyId: string) => authenticateDelegationDependency(this.authority, dependencyId).history,
        effectiveChild: (dependencyId: string) => authenticateDelegationDependency(this.authority, dependencyId).child,
        readiness: (parentRunId: string, intent: "join" | "cancel") => readDelegationReadiness(this.authority, parentRunId, intent),
        reconcile: (parentRunId: string, now: string) => this.withAuthorityTransaction(repositories => {
          for (const manifest of retainedDelegationManifests(repositories, parentRunId)) {
            const group = authenticateDelegationGroup(repositories, manifest);
            for (const { child, dependency } of group.children) {
              const terminal = childTerminalSettlement(child, repositories);
              if (terminal === undefined || dependency.state !== "active") continue;
              repositories.dependencies.settle({ commandId: lifecycleCommandId("delegation-settlement", {
                dependencyId: dependency.dependencyId, childRunId: child.envelope.runId, childAttempt: child.envelope.attempt, resultDigest: terminal.result.resultDigest }),
              dependencyId: dependency.dependencyId, expectedVersion: dependency.version, runId: child.envelope.runId,
              childAttempt: child.envelope.attempt, resultDigest: terminal.result.resultDigest, state: terminal.state, now });
            }
          }
        }),
        activateRetry: (input: unknown, now: string) => this.withAuthorityTransaction(repositories => {
          const request = DelegationRetryRequestSchema.parse(input);
          const previous = repositories.runs.get(request.previousRunId), next = repositories.runs.get(request.replacementRunId);
          if (previous === undefined || next === undefined) throw new Error("delegation-retry-run-unavailable");
          const proof = prepareDelegationRetry(repositories, previous, { sourceCommandId: request.sourceCommandId,
            commandId: lifecycleCommandId("operator-retry", request.sourceCommandId) });
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
          const record = DependencyRecordSchema.parse({ ...dependency, state: "active", version: dependency.version + 1, updatedAt: now });
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
          const selected = authenticateDelegationGroup(repositories, manifest).children.find(child => child.dependency.dependencyId === request.dependencyId);
          if (selected === undefined || selected.child.envelope.runId !== request.runId || selected.child.envelope.attempt !== request.childAttempt) throw new Error("delegation-settlement-child-mismatch");
          const terminal = childTerminalSettlement(selected.child, repositories);
          if (terminal === undefined || terminal.state !== request.state || terminal.result.resultDigest !== request.resultDigest
            || request.commandId !== lifecycleCommandId("delegation-settlement", { dependencyId: request.dependencyId,
              childRunId: request.runId, childAttempt: request.childAttempt, resultDigest: request.resultDigest })) throw new Error("delegation-settlement-evidence-mismatch");
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
          const record = DependencyRecordSchema.parse({ ...current, state: request.state, version: current.version + 1, updatedAt: request.now });
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
            const current = this.#requireWriteIntent(intent.writeIntentId);
            if (canonicalJsonStringify(current.status === "observed-present" ? null : current.occurrence ?? null)
              !== canonicalJsonStringify(intent.occurrence ?? null)) {
              throw new Error("re-fence may not change permanent occurrence authorization");
            }
            this.#assertBusinessWriteAdmission(intent);
            if (current.status !== "retryable") {
              throw new Error(`write intent ${intent.writeIntentId} is ${current.status}; only a retryable intent may re-fence`);
            }
            if (current.version !== expectedVersion) {
              throw new Error(`write intent ${intent.writeIntentId} is at version ${String(current.version)}, not ${String(expectedVersion)}; the re-fence is stale`);
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
        parkAttempt: (input: unknown) => {
          const request = WriteIntentParkRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "attempting") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only an attempting intent may park`);
            }
            const parked = WriteIntentRecordSchema.parse({
              ...current,
              status: "parked",
              parkedCode: request.code,
              message: request.message,
              authorityReason: request.authorityReason,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireAttemptingWriteAttempt(current.currentAttemptId);
            const parkedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: {
                state: "parked",
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
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "attempting") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only attempting may settle retryable`);
            }
            const { parkedCode: _parkedCode, message: _message, authorityReason: _authorityReason, ...base } = {
              parkedCode: undefined,
              message: undefined,
              authorityReason: undefined,
              ...current,
            };
            const retryable = WriteIntentRecordSchema.parse({
              ...base,
              status: "retryable",
              settlement: request.settlement,
              resolvedAt: request.now,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireWriteAttempt(current.currentAttemptId);
            if (currentAttempt.outcome.state !== "attempting") {
              throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; it cannot settle retryable`);
            }
            const settledAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "safe-to-retry", settlement: request.settlement },
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
        : this.#database.prepare(`UPDATE runs SET ${keys.map(key => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
          .run(...values, record.envelope.runId, record.version - 1);
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
      if ("workerId" in current.lifecycle && "workerId" in candidate.lifecycle
        && canonicalJsonStringify(current.lifecycle.workerLifetime ?? null) !== canonicalJsonStringify(candidate.lifecycle.workerLifetime ?? null)) throw new Error("run-claim-lifetime-immutable");
      const violation = runTransitionViolation(current.lifecycle, candidate.lifecycle);
      if (violation !== undefined) throw new Error(`run ${runId}: ${violation}`);
      const updated = RunRecordSchema.parse({ ...candidate, version: current.version + 1, updatedAt: now });
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
      const slot = this.authority.workerSlots.get(request.workerId);
      const lease = this.authority.workerLeases.get(request.workerId);
      if (slot === undefined || slot.retiredAt !== null || slot.workflow !== request.workflow
        || request.workerLifetime !== undefined && (slot.membershipRevision !== request.workerLifetime.membershipRevision
          || lease?.leaseGeneration !== request.workerLifetime.leaseGeneration || !isLiveWorker(lease))) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-claim-membership-unavailable");
      }
      if (request.runtimeConfig !== undefined) {
        if (!this.authority.runtimeConfig.matchesClaim(request.runtimeConfig)) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error("dashboard runtime settings are stale; restart activation is required");
        }
      }

      if (this.authority.workerControls.pending(`worker-pool:${request.workflow}`).some(record => record.request.type === "stop-worker" && record.reset === undefined)) throw new Error("worker-reset-authority-unavailable");
      if (lease !== undefined && this.authority.workerControls.initializingForWorker(request.workerId, lease.leaseGeneration) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-initialization-pending");
      }
      if (this.authority.workerControls.lifecycleForWorker(request.workerId) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-lifecycle-reserved");
      }
      if (this.authority.workerControls.resetForWorker(request.workerId) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-reset-reserved");
      }
      if (this.authority.workerSlots.recovery(request.workerId) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-standing-recovery-reserved");
      }
      if (this.authority.workerSlots.verification(request.workerId) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-verification-reserved");
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
      if (request.workerLifetime === undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-claim-membership-unavailable");
      }
      const candidates = eligible === undefined
        ? this.#database.prepare(`SELECT * FROM runs WHERE workflow=? AND state='queued'
          ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id`).all(request.workflow)
        : this.#database.prepare(`SELECT * FROM runs WHERE state='queued'
          ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id`).all();
      let current: RunRecord | undefined;
      let nextEligibleAt: string | undefined;
      for (const row of candidates) {
        const candidate = runRecordFromRow(row);
        if (candidate.envelope.parent !== undefined && (request.workerLifetime === undefined || lease?.workflow !== slot.workflow)) continue;
        if (eligible !== undefined && (!authenticateDescendantHome(this.authority, candidate, slot.workflow) || !eligible(candidate))) continue;
        this.authority.dependencies.reconcile(candidate.envelope.runId, request.now);
        if (this.authority.dependencies.readiness(candidate.envelope.runId, candidate.cancelRequested === true ? "cancel" : "join").state !== "ready") continue;
        const notBefore = candidate.lifecycle.state === "queued" ? candidate.lifecycle.notBefore : undefined;
        if (notBefore !== undefined && Date.parse(notBefore) > Date.parse(request.now)) {
          if (nextEligibleAt === undefined || Date.parse(notBefore) < Date.parse(nextEligibleAt)) nextEligibleAt = notBefore;
          continue;
        }
        current = candidate;
        break;
      }
      if (current === undefined) return RunClaimOutcomeSchema.parse(nextEligibleAt === undefined
        ? { state: "idle" } : { state: "deferred", nextEligibleAt });
      if (this.authority.workerControls.resetForRun(current.envelope.runId) !== undefined) {
        if (canonical) return { state: "refused", refusal: { reason: "none-eligible" } };
        throw new Error("worker-reset-cascade-reserved");
      }
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
      const claimed = RunRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "claimed",
          workerId: request.workerId,
          ...(request.workerLifetime === undefined ? {} : { workerLifetime: request.workerLifetime }),
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

  #buildRunRepository(): RunRepository {
    return Object.freeze({
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
        const generation = this.getMeta().authorityGeneration;
        const dataVersion = readIntPragma(this.#database, "data_version");
        const changes = z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#database.prepare("SELECT total_changes() AS count").get()).count;
        const state = z.strictObject({ generation: z.number().int(), data_version: z.number().int(), source_changes: z.number().int(),
          workflow: z.string().nullable() }).optional().parse(this.#database.prepare("SELECT generation,data_version,source_changes,workflow FROM canonical_run_page_state WHERE id=1").get());
        if (state?.generation !== generation || state.data_version !== dataVersion || state.source_changes !== changes || state.workflow !== (workflow ?? null)) {
          this.#database.exec("DELETE FROM canonical_run_page; DELETE FROM canonical_run_page_state");
          this.#database.prepare(`INSERT INTO canonical_run_page SELECT row_number() OVER (
            ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END,julianday(enqueued_at),id),id FROM runs ${workflow === undefined ? "" : "WHERE workflow=?"}`)
            .run(...(workflow === undefined ? [] : [workflow]));
          this.#database.prepare(`INSERT INTO canonical_run_page_state VALUES(1,?,?,total_changes()+1,?)`).run(generation,dataVersion,workflow ?? null);
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
      listClaimRecoveryCandidates: (input: unknown) => {
        const request = RunClaimSweepRequestSchema.parse(input);
        const clauses: string[] = [];
        const bindings: string[] = [];
        if (request.staleBefore !== undefined) {
          clauses.push("heartbeat_at < ?");
          bindings.push(request.staleBefore);
        }
        if (request.workerId !== undefined) {
          clauses.push("owner_worker_id = ?");
          bindings.push(request.workerId);
        }
        if (request.workflow !== undefined) {
          clauses.push("workflow = ?");
          bindings.push(request.workflow);
        }
        const rows = this.#database.prepare(`
          SELECT * FROM runs
          WHERE state IN ('claimed', 'validating', 'running')
            ${clauses.map((clause) => `AND ${clause}`).join(" ")}
          ORDER BY heartbeat_at, id
        `).all(...bindings);
        return Object.freeze(rows.map((row) => {
          const run = runRecordFromRow(row);
          const claim = runClaim(run);
          if (claim === undefined
            || (request.workerId !== undefined && claim.workerId !== request.workerId)
            || (request.workflow !== undefined && run.envelope.workflow !== request.workflow)
            || (request.staleBefore !== undefined && Date.parse(claim.heartbeatAt) >= Date.parse(request.staleBefore))) {
            throw new Error("claim recovery index disagrees with its run record");
          }
          return run;
        }));
      },
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
      requestCancellation: ({ runId, expectedVersion, now, cancellationSource }) => this.#mutateRun(
        RunIdSchema.parse(runId), z.number().int().positive().parse(expectedVersion), IsoInstantSchema.parse(now),
        undefined, (current) => {
          if (runClaim(current) === undefined) {
            if (current.lifecycle.state !== "queued" || cancellationSource === undefined
              || this.authority.delegationManifests.listByParentRun(runId).length === 0) throw new Error(`run ${runId} holds no claim for a cancel request`);
            authenticateCancellationSource(this.authority, current, cancellationSource);
            for (const manifest of this.authority.delegationManifests.listByParentRun(runId)) authenticateDelegationGroup(this.authority, manifest);
          }
          return RunRecordSchema.parse({ ...current, cancelRequested: true });
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
          (current) => RunRecordSchema.parse({ ...current, displayName: request.displayName }),
        );
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
      sweepExpiredClaims: (input: unknown) => {
        const request = RunClaimSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {

          const clauses: string[] = [];
          const bindings: string[] = [];
          if (request.staleBefore !== undefined) {
            clauses.push("heartbeat_at < ?");
            bindings.push(request.staleBefore);
          }
          if (request.workerId !== undefined) {
            clauses.push("owner_worker_id = ?");
            bindings.push(request.workerId);
          }
          if (request.workflow !== undefined) {
            clauses.push("workflow = ?");
            bindings.push(request.workflow);
          }
          const rows = this.#database.prepare(`
            SELECT * FROM runs
            WHERE state IN ('claimed', 'validating', 'running')
              ${clauses.map((clause) => `AND ${clause}`).join(" ")}
            ORDER BY heartbeat_at, id
          `).all(...bindings);
          const outcomes: z.infer<typeof RunClaimSweepOutcomeSchema>[] = [];
          for (const row of rows) {
            const current = runRecordFromRow(row);

            const intents = this.#database.prepare(`
              SELECT * FROM write_intents
              WHERE status = 'attempting'
                AND json_extract(payload_json, '$.workflowId') = ?
                AND json_extract(payload_json, '$.itemId') = ?
              ORDER BY id
            `).all(current.envelope.workflow, current.envelope.itemId);
            const attempting = intents.map((intentRow) =>
              this.#parseNativeRow("write_intents",intentRow,WriteIntentRecordSchema));
            const unfinished = attempting[0];
            if (unfinished !== undefined) {
              if (unfinished.status !== "attempting") {
                throw new Error(
                  `write intent ${unfinished.writeIntentId} matched the attempting scan as ${unfinished.status}; `
                  + "the intent index is inconsistent and the sweep refuses to requeue over it",
                );
              }
              const message = `run ${current.envelope.runId} (${current.envelope.workflow}) has an unfinished `
                + `attempting write intent ${unfinished.writeIntentId} (generation `
                + `${String(unfinished.generation)}, task ${unfinished.taskId}); ref write-safety recovery must settle it `
                + "before this run can be released";
              if (current.lifecycle.state === "running") {
                const parked = RunRecordSchema.parse({
                  ...current,
                  lifecycle: {
                    state: "parked-write",
                    writeIntentId: unfinished.writeIntentId,
                    intentGeneration: unfinished.generation,
                    parkedAt: request.now,
                    code: "unknown",
                    message,
                  },
                  version: current.version + 1,
                  updatedAt: request.now,
                });
                const violation = runTransitionViolation(current.lifecycle, parked.lifecycle);
                if (violation !== undefined) {
                  throw new Error(`run ${current.envelope.runId}: ${violation}`);
                }
                this.#writeRunRow(parked, "update");
                outcomes.push(RunClaimSweepOutcomeSchema.parse({
                  state: "recovery-required",
                  run: parked,
                  writeIntentId: unfinished.writeIntentId,
                  intentGeneration: unfinished.generation,
                  parked: true,
                  message,
                }));
                continue;
              }

              outcomes.push(RunClaimSweepOutcomeSchema.parse({
                state: "recovery-required",
                run: current,
                writeIntentId: unfinished.writeIntentId,
                intentGeneration: unfinished.generation,
                parked: false,
                message,
              }));
              continue;
            }
            const requeued = RunRecordSchema.parse({
              ...current,
              lifecycle: { state: "queued", requeuedFrom: "recovery" },
              version: current.version + 1,
              updatedAt: request.now,
            });
            this.#writeRunRow(requeued, "update");
            outcomes.push(RunClaimSweepOutcomeSchema.parse({ state: "requeued", run: requeued }));
          }
          return Object.freeze(outcomes);
        });
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

  completeFailedWorkerReset(commandId: string, handle: RuntimeProcessLockHandle, descriptor: AnyWorkflowDescriptor, now: string) {
    return this.withAuthorityTransaction(repositories => {
      const record = repositories.workerControls.get(commandId), binding = record?.lifecycle, reset = record?.reset;
      if (record?.request.type !== "stop-worker" || reset === undefined || binding?.operation.kind !== "retry"
        || binding.operation.mode !== "browserless" || record.auditedAt !== undefined
        || !["executing", "uncertain"].includes(record.phase.state)) throw new Error("worker-reset-replacement-authority-unavailable");
      this.#assertRetainedWorkerLifecycleEffect(record);
      repositories.workerControls.assertResetGraph(reset);
      const lease = this.#readWorkerLease(binding.member.workerId), slot = repositories.workerSlots.get(binding.member.workerId);
      const pool = repositories.workerPools.get(binding.member.workflowId), active = repositories.runtimeConfig.get();
      if (lease?.lifecycle.state !== "starting" || lease.leaseGeneration !== binding.lifetime.leaseGeneration + 1
        || lease.controlRevision !== 1 || lease.controlCommandId !== undefined || lease.control.directive !== "run"
        || slot === undefined || slot.retiredAt !== null || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(binding.member)
        || pool?.version !== binding.poolVersion || pool.desiredWorkers !== binding.desiredWorkers
        || active?.configSnapshotId !== binding.operation.configSnapshotId || active.configFingerprint !== binding.operation.configFingerprint
        || descriptor.id !== binding.member.workflowId || descriptor.version !== binding.operation.descriptorVersion
        || descriptor.contractFingerprint !== binding.operation.contractFingerprint) throw new Error("worker-reset-replacement-birth-conflict");
      const owner = authenticateWorkerBirthCustody(handle, lease.workerId, lease.processId, this.#path, true), birth = this.workerLifetimeCustody(lease.workerId);
      if (birth.state !== "alive" || birth.birth.admissionCommandId !== commandId
        || canonicalJsonStringify(owner.owner) !== canonicalJsonStringify(birth.birth.owner)) throw new Error("worker-reset-replacement-owner-unavailable");
      const members = reset.work.kind === "absent" ? [] : [reset.work.current, ...reset.work.cascade];
      for (const member of members) {
        const run = repositories.runs.get(member.runId);
        if (run === undefined || run.envelope.attempt !== member.attempt || runClaim(run) !== undefined
          || !["terminal", "parked-write"].includes(run.lifecycle.state)
          || repositories.writeIntents.listByRun(member.runId).some(intent => intent.status === "attempting")) throw new Error("worker-reset-run-release-unproved");
        if (run.lifecycle.state === "parked-write") assertWorkerResetParkedWrite(repositories, run);
      }
      this.assertWorkerLifecycleRelease(lease.workerId);
      const observations = repositories.workerControls.browsers(lease.workerId);
      if (observations.some(browser => browser.health !== "closed") || observations.some(browser => browser.leaseGeneration === lease.leaseGeneration)) throw new Error("worker-reset-replacement-browser-unproved");
      const idle = WorkerLeaseRecordSchema.parse({ ...lease, lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now },
        version: lease.version + 1, updatedAt: now });
      this.#writeWorkerLease(idle, "update");
      const target = { family: "worker-browser", workerId: lease.workerId };
      const application = { result: { state: "applied", commandId, affectedTargets: [target] },
        versionChanges: [{ target, before: record.basisVersion, after: idle.version }], affectedDependencyIds: [] };
      const settled = WorkerControlRecordSchema.parse({ ...record, auditedAt: now, phase: { state: "succeeded",
        startedAt: "startedAt" in record.phase ? record.phase.startedAt : record.admittedAt, completedAt: now,
        acknowledgement: { kind: "reset-replacement", commandId, oldLeaseGeneration: reset.lifetime.leaseGeneration,
          leaseGeneration: lease.leaseGeneration, oldControlRevision: reset.reservedControlRevision, controlRevision: lease.controlRevision,
          membershipRevision: reset.member.membershipRevision, idleAt: now,
          closedSessionIds: observations.filter(browser => browser.leaseGeneration === reset.lifetime.leaseGeneration).map(browser => browser.sessionId),
          browsersClosed: true, duoReleased: true }, application } });
      this.#writeWorkerControl(settled, record);
      repositories.commandAudits.insert({ auditId: randomUUID(), request: record.request, ...application, completedAt: now });
      return settled;
    });
  }

  settleWorkerReset(commandId: string, proof: WorkerControlClosure, now: string, auditId: string) {
    return this.withAuthorityTransaction(repositories => {
      const record = repositories.workerControls.get(commandId);
      if (record?.reset === undefined || record.request.type !== "stop-worker") throw new Error("worker-reset-authority-unavailable");
      const reset = record.reset;
      repositories.workerControls.assertResetGraph(reset);
      const sessions = authenticateWorkerControlClosure(proof, reset);
      const lease = this.#readWorkerLease(reset.member.workerId);
      if (lease === undefined || lease.lifecycle.state === "stopped" || lease.lifecycle.state === "stopping"
        || lease.leaseGeneration !== reset.lifetime.leaseGeneration || lease.processId !== reset.lifetime.processId
        || lease.lifecycle.startedAt !== reset.lifetime.startedAt || lease.controlRevision !== reset.reservedControlRevision
        || lease.controlCommandId !== commandId) throw new Error("worker-reset-lifetime-conflict");
      const members = reset.work.kind === "absent" ? [] : [reset.work.current, ...reset.work.cascade];
      for (const member of members) {
        const run = repositories.runs.get(member.runId);
        if (run === undefined || run.envelope.attempt !== member.attempt || runClaim(run) !== undefined
          || !["terminal", "parked-write"].includes(run.lifecycle.state)
          || repositories.writeIntents.listByRun(member.runId).some(intent => intent.status === "attempting")) throw new Error("worker-reset-run-release-unproved");
        if (run.lifecycle.state === "parked-write") assertWorkerResetParkedWrite(repositories, run);
      }
      const idle = WorkerLeaseRecordSchema.parse({ ...lease, version: lease.version + 1, updatedAt: now,
        lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now },
        control: { directive: "run", requestedBy: record.request.requestedBy, requestedAt: now } });
      const initialization = repositories.workerControls.initializingForWorker(lease.workerId, lease.leaseGeneration);
      if (initialization !== undefined) this.#writeWorkerControl(WorkerControlRecordSchema.parse({ ...initialization,
        readiness: { state: "cancelled", leaseGeneration: lease.leaseGeneration, observedAt: now } }), initialization);
      this.#writeWorkerLease(idle, "update");
      const target = { family: "worker-browser", workerId: lease.workerId };
      const result = { state: "applied", commandId, affectedTargets: [target] };
      const application = { result, versionChanges: [{ target, before: lease.version, after: idle.version }], affectedDependencyIds: [] };
      const slot = repositories.workerSlots.get(lease.workerId);
      if (slot === undefined || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(reset.member)
        || record.auditedAt !== undefined || !["executing", "uncertain"].includes(record.phase.state)) throw new Error("worker-reset-settlement-owner-unavailable");
      const observations = repositories.workerControls.browsers(lease.workerId).filter(value => value.leaseGeneration === lease.leaseGeneration);
      if (observations.some(value => value.health !== "closed") || sessions.some(id => !observations.some(value => value.sessionId === id && value.health === "closed"))
        || this.#database.prepare("SELECT 1 FROM auth_leases WHERE holder_worker_id=? AND state='held'").get(lease.workerId) !== undefined
        || this.#database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=?").get(lease.workerId) !== undefined) throw new Error("worker-reset-release-unproved");
      const settled = WorkerControlRecordSchema.parse({ ...record, auditedAt: now, phase: { state: "succeeded",
        startedAt: record.phase.state === "executing" || record.phase.state === "uncertain" ? record.phase.startedAt : record.admittedAt, completedAt: now,
        acknowledgement: { kind: "reset", commandId, leaseGeneration: lease.leaseGeneration,
          controlRevision: lease.controlRevision, membershipRevision: reset.member.membershipRevision, idleAt: now,
          closedSessionIds: observations.map(value => value.sessionId), browsersClosed: true, duoReleased: true }, application } });
      this.#authorityWrite("worker_controls", () => {
        const changes = this.#database.prepare("UPDATE worker_controls SET phase='succeeded',audited_at=?,payload_json=? WHERE command_id=? AND payload_json=?")
          .run(now, canonicalJsonStringify(settled), commandId, canonicalJsonStringify(record)).changes;
        if (changes !== 1) throw new Error("worker-reset-settlement-conflict");
        return { result: settled, changes };
      });
      repositories.commandAudits.insert({ auditId, request: record.request, ...application, completedAt: now });
      this.afterAuthorityCommit(() => { consumeWorkerControlClosure(proof); });
      return settled;
    });
  }

  observeWorkerRetirementClosure(commandId: string, proof: WorkerControlClosure, now: string): void {
    this.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId), binding = current?.lifecycle;
      if (current === undefined || binding?.operation.kind !== "remove" || !["executing", "uncertain"].includes(current.phase.state)
        || current.auditedAt !== undefined) throw new Error("worker-retirement-owner-unavailable");
      const sessions = authenticateWorkerControlClosure(proof, binding);
      const lease = this.#readWorkerLease(binding.member.workerId);
      if (lease === undefined || lease.leaseGeneration !== binding.lifetime.leaseGeneration || lease.processId !== binding.lifetime.processId
        || lease.lifecycle.startedAt !== binding.lifetime.startedAt || lease.controlRevision !== binding.reservedControlRevision
        || lease.controlCommandId !== commandId) throw new Error("worker-retirement-lifetime-conflict");
      const observations = repositories.workerControls.browsers(lease.workerId).filter(value => value.leaseGeneration === lease.leaseGeneration);
      if (observations.some(value => value.health !== "closed") || sessions.some(id => !observations.some(value => value.sessionId === id && value.health === "closed"))
        || this.#database.prepare("SELECT 1 FROM auth_leases WHERE holder_worker_id=? AND state='held'").get(lease.workerId) !== undefined
        || this.#database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=?").get(lease.workerId) !== undefined) throw new Error("worker-retirement-release-unproved");
      this.#writeWorkerControl(WorkerControlRecordSchema.parse({ ...current, closure: { observedAt: now, closedSessionIds: observations.map(value => value.sessionId) } }), current);
      this.afterAuthorityCommit(() => { consumeWorkerControlClosure(proof); });
    });
  }

  reconcileWorkerControlMilestones(now: string): void {
    for (const record of this.authority.workerControls.list()) {
      if (record.auditedAt !== undefined) continue;
      if ((record.request.type === "stop-worker" || record.lifecycle !== undefined) && ["admitted", "ready", "executing"].includes(record.phase.state)
        && Date.parse(record.expiresAt) <= Date.parse(now)) this.authority.workerControls.transition(record.commandId, record.phase.state, {
          state: "uncertain", startedAt: "startedAt" in record.phase ? record.phase.startedAt : record.admittedAt,
          observedAt: now, message: "worker-control-recovery-effect-or-custody-unproved" });
      if (record.effect === undefined || record.lifecycle === undefined) continue;
      try {
        if (record.effect.observation.kind === "remove") this.settleWorkerRemoval(record.commandId, undefined, now, randomUUID());
        else if (record.request.type === "retry-worker") this.settleWorkerRetry(record.commandId, undefined, now, randomUUID());
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("worker-")) throw error;
        const current = this.authority.workerControls.get(record.commandId);
        if (current?.phase.state === "executing") this.authority.workerControls.transition(record.commandId, "executing", {
          state: "uncertain", startedAt: current.phase.startedAt, observedAt: now, message: error.message });
      }
    }
  }

  #assertRetainedWorkerLifecycleEffect(record: z.infer<typeof WorkerControlRecordSchema>): void {
    const binding = record.lifecycle, effect = record.effect;
    if (binding === undefined || effect === undefined || effect.oldBirthCommandId === undefined) throw new Error("worker-lifecycle-recovery-custody-unavailable");
    const old = this.#retainedWorkerBirth(effect.oldBirthCommandId, binding.member, binding.lifetime);
    if (old.state !== "dead" && old.state !== "released") throw new Error("worker-lifecycle-recovery-death-unproved");
    const browsers = this.authority.workerControls.browsers(binding.member.workerId).filter(value => value.leaseGeneration === binding.lifetime.leaseGeneration);
    if (browsers.some(value => value.health !== "closed")
      || record.closure?.closedSessionIds.some(id => !browsers.some(value => value.sessionId === id && value.health === "closed"))) throw new Error("worker-lifecycle-recovery-closure-unproved");
    if (effect.observation.kind === "retry") {
      const lease = this.#readWorkerLease(binding.member.workerId);
      if (effect.newBirthCommandId === undefined || lease?.birthCommandId !== effect.newBirthCommandId) throw new Error("worker-lifecycle-recovery-birth-unproved");
      const born = this.#retainedWorkerBirth(effect.newBirthCommandId, binding.member, effect.observation);
      if (born.state !== "alive" || born.birth.admissionCommandId !== record.commandId) throw new Error("worker-lifecycle-recovery-birth-unproved");
    }
  }

  observeWorkerLifecycleEffect(commandId: string, proof: WorkerSupervisorEffect, now: string): void {
    this.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId), binding = current?.lifecycle;
      if (current === undefined || binding === undefined || current.effect !== undefined || current.auditedAt !== undefined
        || !["executing", "uncertain"].includes(current.phase.state)) throw new Error("worker-lifecycle-effect-unavailable");
      const observation = authenticateWorkerSupervisorEffect(proof, binding);
      const lease = this.#readWorkerLease(binding.member.workerId);
      const slot = repositories.workerSlots.get(binding.member.workerId);
      if (lease === undefined || slot === undefined || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(binding.member)) throw new Error("worker-lifecycle-effect-member-conflict");
      this.assertWorkerLifecycleRelease(binding.member.workerId);
      if (observation.kind === "remove" ? lease.lifecycle.state !== "stopped" || lease.leaseGeneration !== binding.lifetime.leaseGeneration
        || lease.processId !== binding.lifetime.processId || lease.lifecycle.startedAt !== binding.lifetime.startedAt
        || current.closure === undefined : lease.lifecycle.state !== "starting" || lease.leaseGeneration !== binding.lifetime.leaseGeneration + 1
          || lease.leaseGeneration !== observation.leaseGeneration || lease.processId !== observation.processId
          || lease.lifecycle.startedAt !== observation.startedAt) throw new Error("worker-lifecycle-effect-lifetime-conflict");
      this.#writeWorkerControl(WorkerControlRecordSchema.parse({ ...current, effect: { observedAt: now, observation,
        ...(binding.birthCommandId === undefined ? {} : { oldBirthCommandId: binding.birthCommandId }),
        ...(observation.kind !== "retry" || lease.birthCommandId === undefined ? {} : { newBirthCommandId: lease.birthCommandId }) } }), current);
      this.afterAuthorityCommit(() => { consumeWorkerSupervisorEffect(proof); });
    });
  }

  settleWorkerRemoval(commandId: string, effect: WorkerSupervisorEffect | undefined, now: string, auditId: string) {
    if (effect !== undefined) this.observeWorkerLifecycleEffect(commandId, effect, now);
    return this.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId), binding = current?.lifecycle;
      if (current === undefined || binding?.operation.kind !== "remove" || current.closure === undefined || current.auditedAt !== undefined
        || !["executing", "uncertain"].includes(current.phase.state)) throw new Error("worker-removal-authority-unavailable");
      this.assertWorkerLifecycleRelease(binding.member.workerId);
      if (effect === undefined) this.#assertRetainedWorkerLifecycleEffect(current);
      const observation = current.effect?.observation;
      if (observation?.kind !== "remove") throw new Error("worker-removal-effect-kind-mismatch");
      const proof = observation.retirement;
      const slot = repositories.workerSlots.get(binding.member.workerId), lease = this.#readWorkerLease(binding.member.workerId);
      const pool = repositories.workerPools.get(binding.member.workflowId);
      if (slot === undefined || slot.retiredAt !== null || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(binding.member)
        || pool?.version !== binding.poolVersion || pool.desiredWorkers !== binding.desiredWorkers
        || proof.workerId !== slot.workerId || proof.membershipRevision !== slot.membershipRevision
        || lease?.lifecycle.state !== "stopped" || lease.leaseGeneration !== binding.lifetime.leaseGeneration
        || lease.processId !== binding.lifetime.processId || lease.lifecycle.startedAt !== binding.lifetime.startedAt
        || lease.controlRevision !== binding.reservedControlRevision || lease.controlCommandId !== commandId
        || repositories.workerControls.browsers(slot.workerId).some(value => value.health !== "closed")
        || this.#database.prepare("SELECT 1 FROM auth_leases WHERE holder_worker_id=? AND state='held'").get(slot.workerId) !== undefined
        || this.#database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=?").get(slot.workerId) !== undefined) throw new Error("worker-removal-release-unproved");
      const retired = WorkerSlotRecordSchema.parse({ ...slot, membershipRevision: slot.membershipRevision + 1, retiredAt: now, retirementCommandId: commandId, updatedAt: now });
      this.#authorityWrite("worker_slots", () => {
        const changes = this.#database.prepare("UPDATE worker_slots SET membership_revision=?,retired_at=?,retirement_command_id=?,payload_json=?,updated_at=? WHERE id=? AND membership_revision=? AND retired_at IS NULL")
          .run(retired.membershipRevision, now, commandId, canonicalJsonStringify(retired), now, slot.workerId, slot.membershipRevision).changes;
        if (changes !== 1) throw new Error("worker-removal-slot-conflict");
        this.#workerMembershipChanges.add(slot.workflow);
        return { result: undefined, changes };
      });
      const nextPool = WorkerPoolRecordSchema.parse({ ...pool, desiredWorkers: pool.desiredWorkers - 1, version: pool.version + 1,
        updatedAt: now, plannedAt: now, plannedBy: current.request.requestedBy });
      this.#writeWorkerPool(nextPool, "update");
      const target = { family: "worker-pool", workflowId: pool.workflow };
      const application = { result: { state: "applied", commandId, affectedTargets: [{ family: "worker-browser", workerId: slot.workerId }, target] },
        versionChanges: [{ target, before: pool.version, after: nextPool.version }], affectedDependencyIds: [] };
      const settled = WorkerControlRecordSchema.parse({ ...current, auditedAt: now, phase: { state: "succeeded", startedAt: current.phase.state === "executing" || current.phase.state === "uncertain" ? current.phase.startedAt : current.admittedAt,
        completedAt: now, acknowledgement: { kind: "remove", retirement: proof, beforePoolVersion: pool.version, afterPoolVersion: nextPool.version,
          beforeCount: pool.desiredWorkers, afterCount: nextPool.desiredWorkers }, application } });
      this.#writeWorkerControl(settled, current);
      repositories.commandAudits.insert({ auditId, request: current.request, ...application, completedAt: now });
      return settled;
    });
  }

  settleWorkerRetry(commandId: string, effect: WorkerSupervisorEffect | undefined, now: string, auditId: string) {
    if (effect !== undefined) this.observeWorkerLifecycleEffect(commandId, effect, now);
    return this.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId), binding = current?.lifecycle;
      if (current === undefined || current.request.type !== "retry-worker" || binding?.operation.kind !== "retry" || !["executing", "uncertain"].includes(current.phase.state) || current.auditedAt !== undefined) throw new Error("worker-retry-authority-unavailable");
      this.assertWorkerLifecycleRelease(binding.member.workerId);
      if (effect === undefined) this.#assertRetainedWorkerLifecycleEffect(current);
      const observation = current.effect?.observation;
      if (observation?.kind !== "retry") throw new Error("worker-retry-effect-kind-mismatch");
      const lease = this.#readWorkerLease(binding.member.workerId), slot = repositories.workerSlots.get(binding.member.workerId);
      const pool = repositories.workerPools.get(binding.member.workflowId);
      if (lease?.lifecycle.state !== "starting" || lease.leaseGeneration !== binding.lifetime.leaseGeneration + 1
        || lease.leaseGeneration !== observation.leaseGeneration || lease.processId !== observation.processId || lease.lifecycle.startedAt !== observation.startedAt
        || slot === undefined || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(binding.member)
        || pool?.version !== binding.poolVersion || pool.desiredWorkers !== binding.desiredWorkers
        || this.#database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=?").get(lease.workerId) !== undefined) throw new Error("worker-retry-birth-unproved");
      const target = { family: "worker-browser", workerId: lease.workerId };
      const application = { result: { state: "applied", commandId, affectedTargets: [target] }, versionChanges: [{ target, before: current.basisVersion, after: lease.version }], affectedDependencyIds: [] };
      const settled = WorkerControlRecordSchema.parse({ ...current, auditedAt: now, readiness: { state: "initializing", leaseGeneration: lease.leaseGeneration }, phase: { state: "succeeded", startedAt: "startedAt" in current.phase ? current.phase.startedAt : current.admittedAt,
        completedAt: now, acknowledgement: { kind: "retry", oldLeaseGeneration: binding.lifetime.leaseGeneration, leaseGeneration: lease.leaseGeneration,
          processId: lease.processId, startedAt: lease.lifecycle.startedAt }, application } });
      this.#writeWorkerControl(settled, current);
      repositories.commandAudits.insert({ auditId, request: current.request, ...application, completedAt: now });
      return settled;
    });
  }

  completeWorkerInitialization(commandId: string, generation: number, descriptor: AnyWorkflowDescriptor, now: string): void {
    this.withAuthorityTransaction(repositories => {
      const current = repositories.workerControls.get(commandId), binding = current?.lifecycle;
      if (current?.phase.state !== "succeeded" || current.readiness?.state !== "initializing" || current.readiness.leaseGeneration !== generation
        || binding?.operation.kind !== "retry") throw new Error("worker-initialization-authority-unavailable");
      const lease = this.#readWorkerLease(binding.member.workerId);
      if (lease?.leaseGeneration !== generation || lease.lifecycle.state !== "starting") throw new Error("worker-initialization-lifetime-conflict");
      const acknowledgement = current.phase.acknowledgement, member = repositories.workerSlots.get(binding.member.workerId), active = repositories.runtimeConfig.get();
      if (acknowledgement.kind !== "retry" || acknowledgement.processId !== lease.processId || acknowledgement.startedAt !== lease.lifecycle.startedAt
        || member === undefined || member.retiredAt !== null || canonicalJsonStringify(workerPoolMember(member)) !== canonicalJsonStringify(binding.member)
        || active?.configSnapshotId !== binding.operation.configSnapshotId || active.configFingerprint !== binding.operation.configFingerprint
        || lease.controlRevision !== 1 || lease.controlCommandId !== undefined || lease.control.directive !== "run") throw new Error("worker-initialization-current-authority-changed");
      if (repositories.workerControls.resetForWorker(lease.workerId, generation) !== undefined) throw new Error("worker-initialization-reset-reserved");
      const browsers = repositories.workerControls.browsers(lease.workerId).filter(value => value.leaseGeneration === generation);
      const registered = workflowProjections(descriptor).systems;
      if (descriptor.id !== binding.member.workflowId || descriptor.version !== binding.operation.descriptorVersion
        || descriptor.contractFingerprint !== binding.operation.contractFingerprint || canonicalJsonStringify(registered) !== canonicalJsonStringify(binding.operation.systems)) throw new Error("worker-initialization-descriptor-conflict");
      const required = binding.operation.mode === "browserless" ? [] : registered;
      const fingerprint = binding.operation.configFingerprint;
      if (required.some(system => !browsers.some(value => value.system === system && value.health === "authenticated" && value.configFingerprint === fingerprint))
        || browsers.some(value => value.health !== "closed" && (!required.includes(value.system) || value.health !== "authenticated" || value.configFingerprint !== fingerprint))) throw new Error("worker-initialization-browser-proof-unavailable");
      this.#writeWorkerControl(WorkerControlRecordSchema.parse({ ...current, readiness: { state: "ready", leaseGeneration: generation, observedAt: now } }), current);
      this.#writeWorkerLease(WorkerLeaseRecordSchema.parse({ ...lease, version: lease.version + 1, updatedAt: now,
        lifecycle: { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now } }), "update");
    });
  }

  assertWorkerLifecycleRelease(workerId: string): void {
    this.withAuthorityTransaction(repositories => {
      if (this.#database.prepare("SELECT 1 FROM auth_leases WHERE holder_worker_id=? AND state='held'").get(workerId) !== undefined
        || this.#database.prepare("SELECT 1 FROM runs WHERE owner_worker_id=?").get(workerId) !== undefined) throw new Error("worker-lifecycle-release-unproved");
      const slot = repositories.workerSlots.get(workerId);
      if (slot === undefined) throw new Error("worker-lifecycle-member-unavailable");
      for (const run of repositories.runs.listByWorkflow(slot.workflow)) {
        const writes = repositories.writeIntents.listByRun(run.envelope.runId);
        if (writes.some(intent => intent.status === "attempting") && runClaim(run) === undefined) throw new Error("worker-lifecycle-write-custody-unavailable");
        if (run.lifecycle.state === "parked-write") assertWorkerResetParkedWrite(repositories, run);
      }
      const descendants = this.#database.prepare(`
        SELECT DISTINCT runs.* FROM runs JOIN write_intents ON write_intents.run_id=runs.id
        WHERE runs.workflow<>? AND runs.owner_worker_id IS NULL
          AND write_intents.status IN ('attempting','parked')
      `).all(slot.workflow).map(runRecordFromRow);
      for (const run of descendants) {
        if (run.envelope.parent === undefined || runClaim(run) !== undefined) continue;
        if (!this.#workerOwnsUnsettledDescendantWrite(workerId, run)) continue;
        if (repositories.writeIntents.listByRun(run.envelope.runId).some(intent => intent.status === "attempting")) {
          throw new Error("worker-lifecycle-write-custody-unavailable");
        }
        assertWorkerResetParkedWrite(repositories, run);
      }
    });
  }

  #workerOwnsUnsettledDescendantWrite(workerId: string, run: RunRecord): boolean {
    const unavailable = () => new Error("worker-lifecycle-write-ownership-unavailable");
    try {
      const events = this.#database.prepare(`
        SELECT * FROM timeline_events WHERE kind='run.claimed' AND run_id=?
          AND json_extract(payload_json,'$.payload.event.attempt')=?
          AND json_extract(payload_json,'$.payload.event.claimGeneration')=?
      `).all(run.envelope.runId, run.envelope.attempt, run.claimGeneration).map(timelineEventFromRow);
      if (events.length === 0) {
        const slot = this.authority.workerSlots.get(workerId);
        if (slot !== undefined && authenticateDescendantHome(this.authority, run, slot.workflow)) throw unavailable();
        return false;
      }
      const home = this.authority.workerSlots.get(workerId);
      if (home !== undefined && !authenticateDescendantHome(this.authority, run, home.workflow)
        && events.every(event => event.payload.kind === "span" && event.payload.event.t === "run.claimed"
          && event.payload.event.workerId !== workerId)) return false;
      if (events.length !== 1 || events[0] === undefined) throw unavailable();
      const event = events[0];
      if (event.source.kind !== "native" || event.scope.kind !== "run" || event.scope.runId !== run.envelope.runId
        || event.workflow !== run.envelope.workflow || event.payload.kind !== "span" || event.payload.event.t !== "run.claimed") throw unavailable();
      const claimed = event.payload.event;
      const rows = this.#database.prepare(`
        SELECT * FROM commands WHERE family='run-lifecycle'
          AND json_extract(request_json,'$.operation')='claim-next'
          AND json_extract(outcome_json,'$.result.kind')='run'
          AND json_extract(outcome_json,'$.result.runId')=?
      `).all(run.envelope.runId);
      const commands = rows.map(row => ({ raw: row, command: RunLifecycleCommandRecordSchema.parse(commandFromRow(row)) }))
        .filter(({ command }) => lifecycleCommandId("timeline-lifecycle", command.commandId) === event.eventId);
      if (commands.length !== 1 || commands[0] === undefined) throw unavailable();
      const { raw, command } = commands[0];
      const request = CanonicalClaimNextRequestSchema.parse(command.request);
      const storedAudit = this.authority.lifecycleJournal.findAuditByCommand(command.commandId);
      const audit = RunLifecycleCommandAuditRecordSchema.parse(storedAudit);
      const expectedFingerprint = sha256Hex(`hrauto:run-lifecycle-command:v1\0claim-next\0${canonicalJsonStringify(request)}`);
      if (command.operation !== "claim-next" || command.fence.kind !== "none" || command.commandId !== request.commandId
        || command.requestFingerprint !== expectedFingerprint || canonicalJsonStringify(command.request) !== canonicalJsonStringify(request)
        || String(audit.auditId) !== String(command.commandId) || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
        || z.object({ outcome_json: z.string() }).parse(raw).outcome_json !== canonicalJsonStringify(audit)
        || audit.result.kind !== "run" || audit.result.runId !== run.envelope.runId || audit.result.appliedVersion > run.version
        || claimed.runId !== run.envelope.runId || claimed.attempt !== run.envelope.attempt
        || claimed.claimGeneration !== run.claimGeneration || claimed.workerId !== request.workerId
        || claimed.workflow !== run.envelope.workflow || claimed.traceId !== run.envelope.traceId
        || request.workerLifetime === undefined) throw unavailable();
      if (request.workerId !== workerId) return false;
      const slot = this.authority.workerSlots.get(workerId), lease = this.authority.workerLeases.get(workerId);
      if (slot === undefined || lease === undefined || slot.retiredAt !== null) throw unavailable();
      if (request.workerLifetime.membershipRevision !== slot.membershipRevision
        || request.workerLifetime.leaseGeneration !== lease.leaseGeneration) return false;
      const custody = this.workerLifetimeCustody(workerId);
      if (request.workflow !== slot.workflow || lease.workflow !== slot.workflow
        || custody.birth.owner.pid !== claimed.pid || lease.processId !== claimed.pid
        || !authenticateDescendantHome(this.authority, run, slot.workflow)) throw unavailable();
      const intents = this.authority.writeIntents.listByRun(run.envelope.runId)
        .filter(intent => intent.status === "attempting" || intent.status === "parked");
      if (intents.length === 0) throw unavailable();
      for (const intent of intents) {
        if (intent.status !== "attempting" && intent.status !== "parked") throw unavailable();
        const attempt = this.#requireWriteAttempt(intent.currentAttemptId);
        if (intent.workflowId !== run.envelope.workflow || intent.itemId !== run.envelope.itemId
          || intent.runId !== run.envelope.runId || intent.runAttempt !== run.envelope.attempt
          || attempt.runId !== intent.runId || attempt.runAttempt !== intent.runAttempt
          || attempt.writeIntentId !== intent.writeIntentId || attempt.generation !== intent.generation
          || attempt.leaseId !== intent.bindingProof.leaseId || attempt.fencedAt !== intent.fencedAt
          || attempt.bindingProofDigest !== intent.bindingProofDigest
          || canonicalJsonStringify(attempt.bindingProof) !== canonicalJsonStringify(intent.bindingProof)
          || (intent.status === "attempting" ? attempt.outcome.state !== "attempting" : attempt.outcome.state !== "parked")
            || audit.result.appliedVersion >= run.version) throw unavailable();
      }
      return true;
    } catch (error) {
      throw new Error("worker-lifecycle-write-ownership-unavailable", { cause: error });
    }
  }

  #writeWorkerControl(record: import("../../../models/run/worker-control.js").WorkerControlRecord, prior: import("../../../models/run/worker-control.js").WorkerControlRecord): void {
    this.#authorityWrite("worker_controls", () => {
      const changes = this.#database.prepare("UPDATE worker_controls SET phase=?,audited_at=?,payload_json=? WHERE command_id=? AND payload_json=?")
        .run(record.phase.state, record.auditedAt ?? null, canonicalJsonStringify(record), record.commandId, canonicalJsonStringify(prior)).changes;
      if (changes !== 1) throw new Error("worker-control-settlement-conflict");
      return { result: undefined, changes };
    });
  }

  #readWorkerLease(workerId: string): WorkerLeaseRecord | undefined {
    return this.#readRecord("worker_leases", workerId, WorkerLeaseRecordSchema);
  }

  #writeWorkerLease(record: WorkerLeaseRecord, mode: "insert" | "update"): void {
    if (record.lifecycle.state !== "stopped" && record.lifecycle.state !== "stopping" && record.control.directive !== "stop") {
      record.recoveryBasis = { state: record.lifecycle.state, directive: record.control.directive, observedAt: record.updatedAt };
    } else {
      const retained = mode === "insert" ? undefined : this.#readWorkerLease(record.workerId)?.recoveryBasis;
      if (retained === undefined) delete record.recoveryBasis;
      else record.recoveryBasis = retained;
    }
    const json = canonicalJsonStringify(record);
    const heartbeatAt = "heartbeatAt" in record.lifecycle ? record.lifecycle.heartbeatAt : null;
    this.#authorityWrite("worker_leases", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO worker_leases (
            id, worker_id, workflow, lease_generation, control_revision, state, directive,
            heartbeat_at, version, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.workerId, record.workerId, record.workflow, record.leaseGeneration, record.controlRevision,
          record.lifecycle.state, record.control.directive, heartbeatAt, record.version,
          json, record.createdAt, record.updatedAt,
        )
        : this.#database.prepare(`
          UPDATE worker_leases SET
            workflow = ?, lease_generation = ?, control_revision = ?, state = ?, directive = ?,
            heartbeat_at = ?, version = ?, payload_json = ?, updated_at = ?
          WHERE id = ? AND version = ?
        `).run(
          record.workflow, record.leaseGeneration, record.controlRevision, record.lifecycle.state,
          record.control.directive, heartbeatAt, record.version, json, record.updatedAt,
          record.workerId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`worker lease ${record.workerId} ${mode} affected ${String(changes)} rows`);
      return { result: undefined, changes };
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
          record.credentialKey, record.generation, record.holder.workerId, record.holder.system,
          record.state, record.expiresAt, record.version, json, record.updatedAt,
        )
        : this.#database.prepare(`
          UPDATE auth_leases SET
            generation = ?, holder_worker_id = ?, holder_system = ?, state = ?, expires_at = ?,
            version = ?, payload_json = ?, updated_at = ?
          WHERE credential_key = ? AND version = ?
        `).run(
          record.generation, record.holder.workerId, record.holder.system, record.state,
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
            holder: { workerId: request.workerId, system: request.system },
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
          if (this.authority.workerControls.pending(`worker-pool:${request.workflow}`).some(record => record.request.type === "stop-worker" || record.lifecycle !== undefined)) throw new Error("worker-reset-reserved");
          if (this.authority.workerSlots.recoveries(request.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
          if (this.authority.workerSlots.verifications(request.workflow).length !== 0) throw new Error("worker-verification-reserved");
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

  startOwnedWorker(input: unknown, custody: RuntimeProcessLockHandle): WorkerStartOutcome {
    return this.#startWorkerLease(input, custody);
  }

  reserveStandingWorkerRecovery(workerId: string, descriptor: AnyWorkflowDescriptor, now: string) {
    return this.withAuthorityTransaction(repositories => {
      const slot = repositories.workerSlots.get(workerId), lease = this.#readWorkerLease(workerId);
      const active = repositories.runtimeConfig.get();
      if (slot === undefined || slot.retiredAt !== null || lease?.lifecycle.state !== "stopped"
        || lease.birthCommandId === undefined || lease.recoveryBasis === undefined
        || !["idle", "paused"].includes(lease.recoveryBasis.state) || descriptor.id !== slot.workflow
        || active === undefined) throw new Error("worker-standing-recovery-ineligible");
      const member = workerPoolMember(slot);
      this.assertRetainedWorkerDeath(member, { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt }, lease.birthCommandId);
      requireWorkerPoolRoster(repositories, slot.workflow);
      const pool = repositories.workerPools.get(slot.workflow);
      if (pool === undefined) throw new Error("worker-standing-recovery-pool-unavailable");
      if (repositories.workerControls.pending(`worker-pool:${slot.workflow}`).length !== 0
        || repositories.workerSlots.verifications(slot.workflow).length !== 0 || repositories.workerSlots.recoveries(slot.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
      const commandId = randomUUID();
      const request = WorkerStandingRecoveryRequestSchema.parse({ commandId, now, previous: lease.recoveryBasis,
        binding: { commandId, birthCommandId: lease.birthCommandId, member,
          lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt },
          basis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision }, reservedControlRevision: lease.controlRevision + 1,
          poolVersion: pool.version, desiredWorkers: pool.desiredWorkers, operation: { kind: "retry", mode: "browserless",
            systems: workflowProjections(descriptor).systems, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
            configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } } });
      const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId, operation: "worker-standing-recovery",
        request, fence: { kind: "none" }, recordedAt: now,
        requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-standing-recovery\0${canonicalJsonStringify(request)}`) });
      repositories.lifecycleJournal.insertCommand(command);
      this.#writeWorkerLease(WorkerLeaseRecordSchema.parse({ ...lease, controlCommandId: commandId, controlRevision: lease.controlRevision + 1,
        version: lease.version + 1, updatedAt: now }), "update");
      this.#writeWorkerSlotReservation(slot, commandId, now);
      return request;
    });
  }

  completeStandingWorkerRecovery(commandId: string, handle: RuntimeProcessLockHandle, descriptor: AnyWorkflowDescriptor, now: string) {
    return this.withAuthorityTransaction(repositories => {
      const command = repositories.lifecycleJournal.getCommand(commandId);
      if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "worker-standing-recovery") throw new Error("worker-standing-recovery-authority-unavailable");
      const request = WorkerStandingRecoveryRequestSchema.parse(command.request), binding = request.binding;
      const prior = repositories.lifecycleJournal.findAuditByCommand(commandId);
      if (prior !== undefined) return prior;
      const slot = repositories.workerSlots.get(binding.member.workerId), lease = this.#readWorkerLease(binding.member.workerId);
      const active = repositories.runtimeConfig.get(), pool = repositories.workerPools.get(binding.member.workflowId);
      if (slot === undefined || slot.reservationCommandId !== commandId || slot.retiredAt !== null
        || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(binding.member)
        || lease?.lifecycle.state !== "starting" || lease.leaseGeneration !== binding.lifetime.leaseGeneration + 1
        || lease.birthCommandId === undefined || lease.controlRevision !== 1 || lease.controlCommandId !== undefined
        || pool?.version !== binding.poolVersion || pool.desiredWorkers !== binding.desiredWorkers
        || binding.operation.kind !== "retry" || binding.operation.mode !== "browserless"
        || descriptor.id !== binding.member.workflowId || descriptor.version !== binding.operation.descriptorVersion
        || descriptor.contractFingerprint !== binding.operation.contractFingerprint
        || active?.configSnapshotId !== binding.operation.configSnapshotId || active.configFingerprint !== binding.operation.configFingerprint) throw new Error("worker-standing-recovery-birth-conflict");
      const actual = authenticateWorkerBirthCustody(handle, lease.workerId, lease.processId, this.#path, true);
      const birth = this.workerLifetimeCustody(lease.workerId);
      if (birth.state !== "alive" || birth.birth.admissionCommandId !== commandId
        || canonicalJsonStringify(actual.owner) !== canonicalJsonStringify(birth.birth.owner)
        || binding.birthCommandId === undefined) throw new Error("worker-standing-recovery-owner-unavailable");
      const old = this.#retainedWorkerBirth(binding.birthCommandId, binding.member, binding.lifetime);
      if (old.state !== "dead" && old.state !== "released") throw new Error("worker-standing-recovery-death-unproved");
      this.assertWorkerLifecycleRelease(lease.workerId);
      if (repositories.workerControls.browsers(lease.workerId).some(browser => browser.health !== "closed")) throw new Error("worker-standing-recovery-browser-unproved");
      const paused = request.previous.state === "paused" || request.previous.directive === "pause";
      this.#writeWorkerLease(WorkerLeaseRecordSchema.parse({ ...lease, lifecycle: paused
        ? { state: "paused", startedAt: lease.lifecycle.startedAt, heartbeatAt: now, pausedAt: now }
        : { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now },
        control: { directive: paused ? "pause" : "run", requestedAt: now, requestedBy: lease.control.requestedBy },
        version: lease.version + 1, updatedAt: now }), "update");
      const audit = RunLifecycleCommandAuditRecordSchema.parse({ kind: "run-lifecycle", auditId: randomUUID(), request: command,
        result: { kind: "worker-recovery", workerId: lease.workerId, oldLeaseGeneration: binding.lifetime.leaseGeneration,
          leaseGeneration: lease.leaseGeneration, phase: paused ? "paused" : "idle", settledAt: now }, completedAt: now });
      repositories.lifecycleJournal.insertAudit(audit);
      this.#writeWorkerSlotReservation(slot, null, now);
      return audit;
    });
  }

  #writeWorkerSlotReservation(slot: z.infer<typeof WorkerSlotRecordSchema>, commandId: string | null, now: string): void {
    const updated = WorkerSlotRecordSchema.parse({ ...slot, reservationCommandId: commandId, updatedAt: now });
    this.#authorityWrite("worker_slots", () => {
      const changes = this.#database.prepare("UPDATE worker_slots SET reservation_command_id=?,payload_json=?,updated_at=? WHERE id=? AND payload_json=?")
        .run(commandId, canonicalJsonStringify(updated), now, slot.workerId, canonicalJsonStringify(slot)).changes;
      if (changes !== 1) throw new Error("worker-standing-recovery-slot-conflict");
      return { result: undefined, changes };
    });
  }

  assertRetainedWorkerDeath(member: ReturnType<typeof workerPoolMember>,
    lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>, birthCommandId?: string): void {
    const slot = this.authority.workerSlots.get(member.workerId), lease = this.#readWorkerLease(member.workerId);
    if (slot === undefined || slot.retiredAt !== null || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(member)
      || lease?.lifecycle.state !== "stopped" || lease.leaseGeneration !== lifetime.leaseGeneration
      || lease.processId !== lifetime.processId || lease.lifecycle.startedAt !== lifetime.startedAt
      || lease.birthCommandId === undefined || birthCommandId !== undefined && lease.birthCommandId !== birthCommandId) throw new Error("worker-recovery-lifetime-unavailable");
    const custody = this.#retainedWorkerBirth(lease.birthCommandId, member, lifetime);
    if (custody.state !== "dead" && custody.state !== "released") throw new Error("worker-recovery-death-unproved");
    this.assertWorkerLifecycleRelease(member.workerId);
    if (this.authority.workerControls.browsers(member.workerId).some(value => value.health !== "closed")) throw new Error("worker-recovery-browser-closure-unproved");
  }

  settleDeadWorkerLifetime(workerId: string, now: string): WorkerLeaseRecord | undefined {
    return this.withAuthorityTransaction(() => {
      const lease = this.#readWorkerLease(workerId);
      if (lease === undefined || lease.lifecycle.state === "stopped") return lease;
      const custody = this.workerLifetimeCustody(workerId);
      if (custody.state === "alive") return lease;
      if (custody.state !== "dead" && custody.state !== "released") throw new Error("worker-recovery-death-unproved");
      this.assertWorkerLifecycleRelease(workerId);
      if (this.authority.workerControls.browsers(workerId).some(browser => browser.health !== "closed")) throw new Error("worker-recovery-browser-closure-unproved");
      const stopped = WorkerLeaseRecordSchema.parse({ ...lease, lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt,
        stoppedAt: now, reason: "crashed" }, control: { ...lease.control, directive: "stop", requestedAt: now },
        version: lease.version + 1, updatedAt: now });
      this.#writeWorkerLease(stopped, "update");
      return stopped;
    });
  }

  workerLifetimeCustody(workerId: string) {
    const lease = this.authority.workerLeases.get(workerId);
    const slot = this.authority.workerSlots.get(workerId);
    if (lease?.birthCommandId === undefined || slot === undefined || slot.retiredAt !== null) throw new Error("worker-birth-authority-unavailable");
    return this.#retainedWorkerBirth(lease.birthCommandId, workerPoolMember(slot), { leaseGeneration: lease.leaseGeneration,
      processId: lease.processId, startedAt: lease.lifecycle.startedAt });
  }

  #retainedWorkerBirth(commandId: string, member: ReturnType<typeof workerPoolMember>,
    lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>) {
    const audit = this.authority.lifecycleJournal.findAuditByCommand(commandId);
    if (audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
      || audit.request.operation !== "worker-lifetime-birth" || audit.result.kind !== "worker-birth") throw new Error("worker-birth-authority-unavailable");
    const command = this.authority.lifecycleJournal.getCommand(commandId);
    if (canonicalJsonStringify(command) !== canonicalJsonStringify(audit.request)) throw new Error("worker-birth-authority-mismatch");
    const birth = WorkerLifetimeBirthSchema.parse(audit.request.request);
    if (birth.commandId !== commandId || audit.result.workerId !== member.workerId || audit.result.leaseGeneration !== lifetime.leaseGeneration
      || birth.leaseGeneration !== lifetime.leaseGeneration || birth.processId !== lifetime.processId
      || birth.startedAt !== lifetime.startedAt || birth.authorityPath !== resolve(this.#path)
      || canonicalJsonStringify(birth.member) !== canonicalJsonStringify(member)) throw new Error("worker-birth-authority-mismatch");
    return Object.freeze({ birth, state: authenticateRetainedWorkerCustody(birth) });
  }

  #startWorkerLease(input: unknown, custody?: RuntimeProcessLockHandle): WorkerStartOutcome {
  const request = WorkerStartRequestSchema.parse(input);
  return this.withAuthorityTransaction(() => {
    const member = this.authority.workerSlots.get(request.workerId);
    if (member === undefined || member.retiredAt !== null || member.workflow !== request.workflow) throw new Error("worker-lease-membership-unavailable");
    const standing = this.authority.workerSlots.recovery(request.workerId);
    if (standing !== undefined && (standing.command.commandId !== request.commandId || custody === undefined)) throw new Error("worker-standing-recovery-reserved");
    const replacement = this.authority.workerControls.lifecycleForWorker(request.workerId);
    if (replacement !== undefined && (request.commandId !== replacement.commandId || replacement.lifecycle?.operation.kind !== "retry"
      || replacement.phase.state !== "executing")) throw new Error("worker-lifecycle-reserved");
    if (this.authority.workerControls.resetForWorker(request.workerId) !== undefined
      && (replacement?.request.type !== "stop-worker" || replacement.lifecycle?.operation.kind !== "retry"
        || replacement.lifecycle.operation.mode !== "browserless" || request.commandId !== replacement.commandId || custody === undefined)) throw new Error("worker-reset-reserved");
    if (this.authority.workerSlots.verification(request.workerId) !== undefined) throw new Error("worker-verification-reserved");
    const existing = this.#readWorkerLease(request.workerId);
    if (replacement?.lifecycle !== undefined || standing !== undefined) {
      const binding = replacement?.lifecycle ?? standing?.request.binding;
      if (binding === undefined) throw new Error("worker-replacement-authority-unavailable");
      const config = this.authority.runtimeConfig.get();
      if (standing !== undefined) this.assertRetainedWorkerDeath(binding.member, binding.lifetime, binding.birthCommandId);
      this.assertWorkerLifecycleRelease(request.workerId);
      if (binding.operation.kind !== "retry" || existing?.lifecycle.state !== "stopped"
        || existing.leaseGeneration !== binding.lifetime.leaseGeneration || existing.processId !== binding.lifetime.processId
        || existing.lifecycle.startedAt !== binding.lifetime.startedAt || existing.controlRevision !== binding.reservedControlRevision
        || existing.controlCommandId !== binding.commandId || canonicalJsonStringify(workerPoolMember(member)) !== canonicalJsonStringify(binding.member)
        || config?.configSnapshotId !== binding.operation.configSnapshotId || config.configFingerprint !== binding.operation.configFingerprint
        || canonicalJsonStringify(request.browserSystems) !== canonicalJsonStringify(binding.operation.systems)) throw new Error("worker-retry-birth-binding-conflict");
    } else if (existing !== undefined && this.authority.workerControls.initializingForWorker(request.workerId, existing.leaseGeneration) !== undefined) throw new Error("worker-initialization-pending");
    if (existing !== undefined && isLiveWorker(existing)) {
      return WorkerStartOutcomeSchema.parse({
        state: "conflict",
        lease: existing,
        message: `worker ${request.workerId} already holds a live lease in state ${existing.lifecycle.state}`,
      });
    }
    let birthCommandId: string | undefined;
    if (custody !== undefined) {
      const held = authenticateWorkerBirthCustody(custody, request.workerId, request.processId, this.#path);
      birthCommandId = randomUUID();
      const birth = WorkerLifetimeBirthSchema.parse({ commandId: birthCommandId, ...(request.commandId === undefined ? {} : { admissionCommandId: request.commandId }), member: workerPoolMember(member),
        leaseGeneration: (existing?.leaseGeneration ?? 0) + 1, processId: request.processId,
        startedAt: request.now, authorityPath: resolve(this.#path), ...held });
      const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: birthCommandId,
        operation: "worker-lifetime-birth", request: birth, fence: { kind: "none" }, recordedAt: request.now,
        requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-lifetime-birth\0${canonicalJsonStringify(birth)}`) });
      this.authority.lifecycleJournal.insertCommand(command);
      this.authority.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId: randomUUID(), request: command,
        result: { kind: "worker-birth", workerId: request.workerId, leaseGeneration: birth.leaseGeneration }, completedAt: request.now });
    }
    const lease = WorkerLeaseRecordSchema.parse({
      ...(birthCommandId === undefined ? {} : { birthCommandId }),
      workerId: request.workerId,
      workflow: request.workflow,
      browserSystems: request.browserSystems,
      processId: request.processId,
      leaseGeneration: (existing?.leaseGeneration ?? 0) + 1,
      controlRevision: 1,
      lifecycle: { state: "starting", startedAt: request.now },
      control: { directive: "run", requestedAt: request.now, requestedBy: request.requestedBy },
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? request.now,
      updatedAt: request.now,
    });
    this.#writeWorkerLease(lease, existing === undefined ? "insert" : "update");
    return WorkerStartOutcomeSchema.parse({ state: "started", lease });
  });
  }

  #buildWorkerLeaseRepository(): WorkerLeaseRepository {
    return Object.freeze({
      start: (input: unknown) => {
        return this.#startWorkerLease(input);
      },
      get: (workerId: string) => this.#readWorkerLease(workerId),
      listLive: (workflow?: string) => {
        const states = LIVE_WORKER_STATES.map(() => "?").join(", ");
        const rows = workflow === undefined
          ? this.#database.prepare(`
            SELECT * FROM worker_leases WHERE state IN (${states}) ORDER BY id
          `).all(...LIVE_WORKER_STATES)
          : this.#database.prepare(`
            SELECT * FROM worker_leases WHERE state IN (${states}) AND workflow = ? ORDER BY id
          `).all(...LIVE_WORKER_STATES, WorkflowIdSchema.parse(workflow));
        return Object.freeze(rows.map((row) => this.#parseNativeRow("worker_leases",row,WorkerLeaseRecordSchema)));
      },
      reportLifecycle: (input: unknown) => {
        const request = WorkerLifecycleRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readWorkerLease(request.workerId);
          if (current === undefined) throw new Error(`worker lease ${request.workerId} does not exist`);
          const standing = this.authority.workerSlots.recovery(request.workerId);
          if (standing !== undefined && (current.leaseGeneration === standing.request.binding.lifetime.leaseGeneration
            || !["starting", "stopping", "stopped"].includes(request.lifecycle.state))) throw new Error("worker-standing-recovery-reserved");
          if (current.leaseGeneration !== request.leaseGeneration) {
            return WorkerUpdateOutcomeSchema.parse({
              state: "conflict",
              currentVersion: current.version,
              message: `worker ${request.workerId} lease generation is ${String(current.leaseGeneration)}, `
                + `not ${String(request.leaseGeneration)}`,
            });
          }
          const updated = WorkerLeaseRecordSchema.parse({
            ...current,
            lifecycle: request.lifecycle,

            control: request.lifecycle.state === "stopped" && current.control.directive === "run"
              ? { ...current.control, directive: "stop", requestedAt: request.now }
              : current.control,
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(updated, "update");
          return WorkerUpdateOutcomeSchema.parse({ state: "applied", lease: updated });
        });
      },
      reserveControl: (workerId, input, commandId, now) => this.withAuthorityTransaction(() => {
        const slot = this.authority.workerSlots.get(workerId);
        if (slot !== undefined && this.authority.workerSlots.recoveries(slot.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
        if (this.authority.workerControls.resetForWorker(workerId) !== undefined) throw new Error("worker-reset-reserved");
        const basis = WorkerControlBasisSchema.parse(input);
        const current = this.#readWorkerLease(workerId);
        const command = this.authority.commands.get(commandId);
        const failedRetry = command !== undefined && "type" in command && (command.type === "retry-worker" || command.type === "stop-worker")
          && command.target.workerId === workerId && current?.lifecycle.state === "stopped";
        if (current === undefined || !isLiveWorker(current) && !failedRetry) throw new Error("worker-control-target-unavailable");
        if (current.leaseGeneration !== basis.leaseGeneration || current.controlRevision !== basis.controlRevision) throw new Error("worker-control-basis-conflict");
        const updated = WorkerLeaseRecordSchema.parse({ ...current, controlRevision: basis.controlRevision + 1,
          controlCommandId: commandId, version: current.version + 1, updatedAt: now });
        this.#writeWorkerLease(updated, "update");
        return updated;
      }),
      control: (input: unknown) => {
        const request = WorkerControlRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const member = this.authority.workerSlots.get(request.workerId);
          if (member !== undefined && this.authority.workerSlots.recoveries(member.workflow).length !== 0) throw new Error("worker-standing-recovery-reserved");
          const retirement = this.authority.workerControls.lifecycleForWorker(request.workerId);
          if (retirement !== undefined && (retirement.commandId !== request.commandId || retirement.lifecycle?.operation.kind !== "remove"
            || retirement.closure === undefined || request.control.directive !== "stop")) throw new Error("worker-lifecycle-reserved");
          if (this.authority.workerControls.resetForWorker(request.workerId) !== undefined) throw new Error("worker-reset-reserved");
          const current = this.#readWorkerLease(request.workerId);
          if (current === undefined) throw new Error(`worker lease ${request.workerId} does not exist`);
          if (current.version !== request.expectedVersion) {
            return WorkerUpdateOutcomeSchema.parse({
              state: "conflict",
              currentVersion: current.version,
              message: `worker ${request.workerId} is at version ${String(current.version)}, not ${String(request.expectedVersion)}`,
            });
          }
          const updated = WorkerLeaseRecordSchema.parse({
            ...current,
            control: request.control,
            ...(current.controlRevision === undefined ? {} : {
              controlRevision: request.commandId !== undefined && request.commandId === current.controlCommandId ? current.controlRevision : current.controlRevision + 1,
            }),
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(updated, "update");
          return WorkerUpdateOutcomeSchema.parse({ state: "applied", lease: updated });
        });
      },
      sweepExpired: (input: unknown) => {
        const request = WorkerSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const states = LIVE_WORKER_STATES.map(() => "?").join(", ");
          const rows = this.#database.prepare(`
            SELECT * FROM worker_leases
            WHERE state IN (${states}) AND heartbeat_at IS NOT NULL AND heartbeat_at < ?
            ORDER BY id
          `).all(...LIVE_WORKER_STATES, request.staleBefore);
          const expired: WorkerLeaseRecord[] = [];
          for (const row of rows) {
            const current = this.#parseNativeRow("worker_leases",row,WorkerLeaseRecordSchema);
            const stopped = WorkerLeaseRecordSchema.parse({
              ...current,
              lifecycle: {
                state: "stopped",
                startedAt: current.lifecycle.startedAt,
                stoppedAt: request.now,
                reason: "lease-expired",
              },
              control: { ...current.control, directive: "stop", requestedAt: request.now },
              version: current.version + 1,
              updatedAt: request.now,
            });
            this.#writeWorkerLease(stopped, "update");
            expired.push(stopped);
          }
          return Object.freeze(expired);
        });
      },
    });
  }

  #requireWriteIntent(writeIntentId: string): WriteIntentRecord {
    const current = this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema);
    if (current === undefined) throw new Error(`write intent ${writeIntentId} does not exist`);
    return current;
  }

  #requireAttemptBearingWriteIntent(
    writeIntentId: string,
    generation: number,
    expectedVersion: number,
  ): Exclude<WriteIntentRecord, { status: "observed-present" }> {
    const current = this.#requireWriteIntent(writeIntentId);
    if (current.status === "observed-present") {
      throw new Error(`write intent ${writeIntentId} is observed-present; it carries no automation attempt to transition`);
    }
    if (current.generation !== generation) {
      throw new Error(`write intent ${writeIntentId} is at generation ${String(current.generation)}, not ${String(generation)}; the transition is stale`);
    }
    if (current.version !== expectedVersion) {
      throw new Error(`write intent ${writeIntentId} is at version ${String(current.version)}, not ${String(expectedVersion)}; the transition is stale`);
    }
    return current;
  }

  #requireWriteAttempt(writeAttemptId: string): WriteAttemptRecord {
    const attempt = this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema);
    if (attempt === undefined) throw new Error(`write attempt ${writeAttemptId} does not exist`);
    return attempt;
  }

  #requireAttemptingWriteAttempt(writeAttemptId: string): WriteAttemptRecord {
    const attempt = this.#requireWriteAttempt(writeAttemptId);
    if (attempt.outcome.state !== "attempting") {
      throw new Error(`write attempt ${writeAttemptId} is ${attempt.outcome.state}; only an attempting attempt may transition`);
    }
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
    const slot = this.authority.workerSlots.get(claim.workerId), lease = this.authority.workerLeases.get(claim.workerId);
    if (run?.envelope.parent !== undefined && (slot === undefined || lease === undefined || slot.retiredAt !== null
      || !isLiveWorker(lease) || lease.workflow !== slot.workflow || !("workerLifetime" in run.lifecycle)
      || run.lifecycle.workerLifetime?.leaseGeneration !== lease.leaseGeneration
      || run.lifecycle.workerLifetime.membershipRevision !== slot.membershipRevision
      || !authenticateDescendantHome(this.authority, run, slot.workflow))) return { reason: "lost" };
    if (this.authority.workerControls.pending(`worker-pool:${intent.workflowId}`).some(record => record.request.type === "stop-worker" && record.reset === undefined)) throw new Error("worker-reset-authority-unavailable");
    if (this.authority.workerControls.lifecycleForWorker(claim.workerId) !== undefined) return { reason: "invalid-state" };
    if (this.authority.workerSlots.recovery(claim.workerId) !== undefined) return { reason: "invalid-state" };
    const reset = this.authority.workerControls.resetForWorker(claim.workerId);
    if (reset !== undefined) {
      const binding = reset.reset;
      if (binding === undefined) throw new Error("worker-reset-authority-unavailable");
      const runs = binding.work.kind === "absent" ? [] : [binding.work.current, ...binding.work.cascade];
      if (runs.some(member => member.runId === intent.runId)) return { reason: "invalid-state" };
      throw new Error("worker-reset-current-run-conflict");
    }
    if (run?.lifecycle.state !== "running" || run.cancelRequested === true || run.envelope.attempt !== intent.runAttempt) {
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
    intent: Extract<WriteIntentRecord, { status: "attempting" | "parked" }>,
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
