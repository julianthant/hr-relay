import { completionFromAuthorization } from "../../domain/run/completion.js";
import { HistoricalTerminalOutboxRecordSchema, HistoricalTerminalAuthorizationSchema } from "../../domain/run/completion-history.js";
import { lifecycleCommandId } from "../../domain/identifiers.js";
import { LedgerPartitionRecordSchema, LedgerProjectionRecordSchema } from "../../domain/ledger-projection.js";
import { sha256Hex } from "../../domain/sha256.js";
import { HistoricalOperationSourceSchema, type HistoricalOperationSource } from "../../events/timeline.js";
import { ArchivedRunRecordSchema, ArchivedTransactionsSchema, type ArchivedTransactions } from "../../domain/archive/model.js";
import { createTransactionHistory } from "./transaction-history.js";
import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../domain/command-groups.js";
import { confirmedOperationTimeline, reconstructConfirmedOperation } from "../../events/confirmed-operation.js";
import { timelineAppendContent, timelineCheckpointReference } from "../../events/timeline.js";
import { deriveStableUuid } from "../../domain/identifiers.js";
import { createTimelineRepository, timelineEventFromRow } from "./timeline-repository.js";
import { readTimelineRecords } from "../events/timeline-reader.js";
import type { TimelineRepository, TimelineAppend } from "../../events/timeline.js";
import { SettingsCurrentRecordSchema as HistoricalSettingsCurrentRecordSchema } from "../compat/d331-settings-current.js";
import { HistoricalProtectedSettingsAuditSchema, HistoricalProtectedSettingsCommandSchema, PreFloorCommandSchema, PreFloorSettingsCommandSchema } from "../../domain/commands-history.js";
import { CommandIdentityConflictError } from "../../domain/commands.js";
import { createCredentialStore } from "../config/credential-store.js";
import { repeatEvidenceDigest } from "../../domain/run/rerun.js";
import { archivedRunContentDigest } from "../../domain/archive/model.js";
import { retainedRunProtectedBindings } from "../../domain/protected-input.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  assertWorkflowRunResultAuthorization,
  descriptorRuntimeNodes,
  type AnyWorkflowDescriptor,
} from "../../base/workflow.js";
import type { ProviderAdmissionRepository } from "../../base/providers.js";
import {
  AUTHORITY_TABLE_REGISTRY,
  AuthorityUpgradeRecordSchema,
  ProtectedSettingsCurrentRecordSchema,
  AuthorityTableNameSchema,
  ProjectionTableNameSchema,
  type AuthorityTableName,
  type ProjectionTableName,
  type TableName,
  type RunRecordRefusal,
} from "../../domain/authority.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock, localDatePart } from "../../domain/clock.js";
import {
  AuthorityCommandAuditRecordSchema,
  AuthorityCommandRecordSchema,
  StoredAuthorityCommandRecordSchema,
  BulkParentCommandRecordSchema,
  BulkRunCommandAcceptanceRecordSchema,
  CommandAuditRecordSchema,
  CommandRequestSchema,
  RunLifecycleCommandAuditRecordSchema,
  RunLifecycleCommandRecordSchema,
  deriveSettingsCommandFingerprint,
} from "../../domain/commands.js";
import { providerBudget, type ProviderBudget } from "../../domain/config/schema.js";
import {
  ConfigSnapshotRecordSchema,
  ConfigSnapshotWriteSchema,
  type ConfigSnapshotRecord,
} from "../../domain/config/snapshot.js";
import {
  ActiveRuntimeConfigActivationSchema,
  ActiveRuntimeConfigExpectationSchema,
  ActiveRuntimeConfigRecordSchema,
  RuntimeConfigClaimTokenSchema,
  type ActiveRuntimeConfigRecord,
  type RuntimeConfigClaimToken,
} from "../../domain/config/runtime-generation.js";
import {
  SettingsCurrentRecordSchema,
  type SettingsCurrentRecord,
} from "../../domain/config/settings-current.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  BrowserSystemIdSchema,
  CommandIdSchema,
  DiagnosticBundleIdSchema,
  FailureFingerprintSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  NonNegativeIntSchema,
  ProviderAdmissionIdSchema,
  ProviderCapabilityIdSchema,
  RunIdSchema,
  RunSessionIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
  type RunId,
} from "../../domain/ids.js";
import {
  CROSS_DATE_SEARCH_MATCH_ORDER,
  CROSS_DATE_SEARCH_MAX_MATCH_RANK,
  CROSS_DATE_SEARCH_PAGE_LIMIT,
  CROSS_DATE_SEARCH_QUERY_LIMIT,
  CrossDateSearchDryRunFacetSchema,
  CrossDateSearchScopeSchema,
  CrossDateSearchShapeFacetSchema,
  CrossDateSearchStateFacetSchema,
  CrossDateSearchSystemFacetSchema,
  CrossDateSearchWorkflowFacetSchema,
} from "../../domain/dashboard/search.js";
import {
  OperatorXlsxExportEvidenceSchema,
  OperatorXlsxExportIdSchema,
  type OperatorXlsxExportEvidence,
} from "../../domain/dashboard/xlsx-export.js";
import {
  RunPrioritySchema,
  nextAttemptEnvelope,
} from "../../domain/run/envelope.js";
import {
  RunRecordSchema,
  RunStateSchema,
  runClaim,
  runTransitionViolation,
  type RunRecord,
} from "../../domain/run/record.js";
import {
  DeletedRunRecordSchema,
  RunDeleteInputSchema,
  type DeletedRunRecord,
  type DeletedRunTableSchema,
} from "../../domain/run/deleted-run.js";
import {
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  type RunResultRecord,
} from "../../domain/run/result.js";
import { deriveSchemaHash } from "../../domain/schema-bound-value.js";
import {
  TerminalAuthorizationRecordSchema,
  type TerminalAuthorizationRecord,
} from "../../domain/run/terminal-authorization.js";
import {
  StartPlanRecordSchema,
  isStartPlanExpired,
  type StartPlanRecord,
} from "../../domain/run/start-plan.js";
import { IntakePlanManifestSchema } from "../../domain/intake/manifest.js";
import { IntakeSessionSchema } from "../../domain/intake/session.js";
import { AdmittedExtractionSchema } from "../../domain/ocr/extraction.js";
import { FailureRecordSchema, type FailureRecord } from "../../domain/trust/failure.js";
import {
  LIVE_WORKER_STATES,
  WorkerLeaseRecordSchema,
  isLiveWorker,
  type WorkerLeaseRecord,
} from "../../domain/run/worker.js";
import {
  DuoCeremonyLeaseAcquireRequestSchema,
  DuoCeremonyLeaseRecordSchema,
  DuoCeremonyLeaseReleaseOutcomeSchema,
  DuoCeremonyLeaseTakeoverSchema,
  isDuoCeremonyLeaseLive,
  type DuoCeremonyLeaseAcquireRequest,
  type DuoCeremonyLeaseRecord,
  type DuoCeremonyLeaseReleaseOutcome,
} from "../../domain/duo-ceremony-lease.js";
import { HistoricalRunSessionRecordSchema, RunSessionRecordSchema, type RunSessionRecord } from "../../domain/run/session.js";
import { WorkerPoolRecordSchema, workerPoolVersion, type WorkerPoolRecord } from "../../domain/run/worker-pool.js";
import {
  isDuoCeremonyLeaseToken,
  mintDuoCeremonyLeaseToken,
  retireDuoCeremonyLeaseToken,
  type DuoCeremonyLeaseToken,
} from "../../base/duo-ceremony-lease.js";
import {
  RunClaimOutcomeSchema,
  RunClaimRequestSchema,
  RunClaimSweepOutcomeSchema,
  RunClaimSweepRequestSchema,
  RunClaimTokenSchema,
  RunHeartbeatOutcomeSchema,
  RunHeartbeatRequestSchema,
  RunItemQuerySchema,
  RunPresentationRequestSchema,
  RunInjectPatchesRequestSchema,
  RunPriorityBumpRequestSchema,
  RunRequeueRequestSchema,
  RunResumeRequestSchema,
  RunTransitionRequestSchema,
  RunUpdateOutcomeSchema,
  StartPlanConsumeOutcomeSchema,
  StartPlanConsumeRequestSchema,
  WorkerControlRequestSchema,
  WorkerLifecycleRequestSchema,
  WorkerPoolPlanOutcomeSchema,
  WorkerPoolPlanRequestSchema,
  WorkerStartOutcomeSchema,
  WorkerStartRequestSchema,
  WorkerSweepRequestSchema,
  WorkerUpdateOutcomeSchema,
  type RunClaimOutcome,
  type RunHeartbeatOutcome,
  type RunUpdateOutcome,
  type StartPlanConsumeOutcome,
  type WorkerPoolPlanOutcome,
  type WorkerStartOutcome,
  type WorkerUpdateOutcome,
} from "./run-store-contracts.js";
import {
  FailureTerminalizationReportSchema,
  FailureTerminalizationRequestSchema,
  SuccessTerminalizationReportSchema,
  SuccessTerminalizationRequestSchema,
  SuccessTerminalizationReplayInputSchema,
  type FailureTerminalizationReport,
  type FailureTerminalizationStorageStep,
  type SuccessTerminalizationReport,
  type SuccessTerminalizationStorageStep,
} from "./run-terminal-contracts.js";
import {
  RunCheckpointRecordSchema,
  checkpointLookupKey,
  checkpointRecordKey,
  type RunCheckpointRecord,
} from "../../domain/workflow/checkpoint.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import {
  NotificationFoldRequestSchema,
  NotificationRecordOutcomeSchema,
  NotificationRecordSchema,
  NotificationStateRequestSchema,
  requireMutableNotification,
  type NotificationRecord,
  type NotificationRecordOutcome,
} from "../../domain/notifications.js";


import {
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../domain/trust/diagnostic.js";
import {
  RunEvidenceReceiptSchema,
  type RunEvidenceReceipt,
} from "../../domain/trust/evidence.js";
import {
  DryRunScenarioResultSchema,
  type DryRunScenarioResult,
} from "../../domain/trust/dry-run-scenario-result.js";
import {
  ActivityPersonPseudonymEvidenceSchema,
  ActivityPersonPseudonymGenerationBindingSchema,
  ActivityPersonPseudonymRunSetSchema,
  assertAuthenticActivityPersonPseudonymDomain,
  activityPersonPseudonymEvidenceKey,
  type ActivityPersonPseudonymDomain,
  type ActivityPersonPseudonymEvidence,
} from "../../domain/trust/activity-person-pseudonym.js";
import {
  ActivityPersonPseudonymBackfillOutcomeSchema,
  CurrentSeparationsPseudonymSourceResultSchema,
  type ActivityPersonPseudonymBackfillOutcome,
} from "../../domain/trust/activity-person-pseudonym-backfill.js";
import { DryRunWriteSafetyCountsSchema } from "../../domain/trust/dry-run-scenario.js";
import {
  FixRecordSchema,
  KnowledgeRecordSchema,
  type FixRecord,
  type KnowledgeRecord,
} from "../../domain/trust/knowledge.js";
import {
  ProviderAdmissionDenyRequestSchema,
  ProviderAdmissionInterruptRequestSchema,
  ProviderAdmissionMutationOutcomeSchema,
  ProviderAdmissionRecordSchema,
  ProviderAdmissionReserveOutcomeSchema,
  ProviderAdmissionReserveRequestSchema,
  ProviderAdmissionSettleRequestSchema,
  ProviderAdmissionSweepOutcomeSchema,
  ProviderAdmissionSweepRequestSchema,
  ProviderBudgetCounterSchema,
  ProviderUnavailableReasonSchema,
  isRunNodeExecutionIdentity,
  type ProviderAdmissionRecord,
  type ProviderBudgetCounter,
} from "../../domain/provider-admission.js";
import {
  IdempotencyKeySchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "../../domain/write-safety.js";
import {
  AUTHORITY_APPLICATION_ID,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  databaseStateTable,
  databaseUpgradesTable,
  DATABASE_TABLE_RENAMES,
  INTEGRATED_AUTHORITY_TABLES_BY_VERSION,
  POST_FLOOR_AUTHORITY_TABLES_BY_VERSION,
  SQLITE_MIGRATIONS,
  UPGRADE_FLOOR_SCHEMA_VERSION,
  auditMigrationTableCoverage,
  requiresStoppedSystemAuthorityUpgrade,
  tableClassification,
} from "./migrations.js";
import {
  AuthorityCopyInspectionSchema,
  SpanAuthorityReadSnapshotSchema,
  SpanAuthorityRunRootSchema,
  SpanAuthorityRunResolutionSchema,
  type AuthorityCopyInspection,
  type SpanAuthorityReadSnapshot,
  type SpanAuthorityRunRoot,
  type SpanAuthorityRunResolution,
} from "./recovery-contracts.js";
import {
  ArchivedRunStorageRecordSchema,
  ArchiveRelaunchStorageRecordSchema,
  ArtifactOutboxAckRequestSchema,
  ArtifactOutboxStorageRecordSchema,
  ArtifactSinkHeadRecordRequestSchema,
  ArtifactSinkHeadRecordSchema,
  AUTHORITY_RECORD_SCHEMA_REGISTRY,
  DiagnosticAttachmentStorageRecordSchema,
  OpaqueAuthorityRecordSchema,
  ProjectionStorageRecordSchema,
  VersionBumpApplicationStorageRecordSchema,
  VersionPlanConsumeRequestSchema,
  VersionPlanStorageRecordSchema,
  type ArchivedRunStorageRecord,
  type ArchiveRelaunchStorageRecord,
  type ArtifactOutboxStorageRecord,
  type ArtifactSinkHeadRecord,
  type DiagnosticAttachmentStorageRecord,
  type OpaqueAuthorityRecord,
  type ProjectionStorageRecord,
  type VersionBumpApplicationStorageRecord,
  type VersionPlanConsumeOutcome,
  type VersionPlanStorageRecord,
} from "./storage-records.js";
import {
  AtomicWriteCommitInputSchema,
  AtomicWriteCommitReportSchema,
  PermanentWriteResolutionSchema,
  WriteFenceInputSchema,
  WriteIntentParkRequestSchema,
  WriteIntentReopenRequestSchema,
  WriteIntentRetrySettlementRequestSchema,
  WriteRefenceInputSchema,
  type AtomicWriteCommitReport,
  type AtomicWriteCommitStorageStep,
  type PermanentWriteResolution,
} from "./write-commit-contracts.js";

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

/**
 * Ref operator-trust §2.2's retention sweep result for one bundle. `absent` is a real
 * outcome — two sweeps racing the same due bundle must not both claim a purge —
 * and there is deliberately no "skipped" arm: a bundle that must not be purged
 * throws rather than being reported as quietly handled.
 */
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
  getSettingsHistory(commandId: string): z.infer<typeof CommandRequestSchema> | z.infer<typeof PreFloorSettingsCommandSchema> | z.infer<typeof HistoricalProtectedSettingsCommandSchema> | undefined;
  findProtectedSettingsCommandIdByWriteId(input: unknown): string | undefined;
}>;

/**
 * D113 replay reads the recorded outcome by COMMAND id: one journaled command
 * has exactly one recorded audit, and re-delivery must return that exact
 * result rather than re-executing. Two audits for one command is corruption.
 */
const HistoricalSettingsAuditSchema = CommandAuditRecordSchema.extend({ request: PreFloorSettingsCommandSchema });
type CommandAuditRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandAuditRecordSchema>>;
  get(auditId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findByCommand(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findSettingsHistory(commandId: string): z.infer<typeof CommandAuditRecordSchema> | z.infer<typeof HistoricalSettingsAuditSchema> | z.infer<typeof HistoricalProtectedSettingsAuditSchema> | undefined;
}>;

type RunLifecycleJournalRepository = Readonly<{
  insertCommand(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandRecordSchema>>;
  getCommand(commandId: string): z.infer<typeof AuthorityCommandRecordSchema> | undefined;
  insertAudit(input: unknown): ImmutableInsertResult<z.infer<typeof RunLifecycleCommandAuditRecordSchema>>;
  findAuditByCommand(commandId: string): z.infer<typeof AuthorityCommandAuditRecordSchema> | undefined;
}>;

type RuntimeConfigRepository = Readonly<{
  get(): ActiveRuntimeConfigRecord | undefined;
  activate(input: unknown): ActiveRuntimeConfigRecord;
  requireActive(input: unknown): RuntimeConfigClaimToken;
  requireSettingsCurrent(): void;
}>;

type SettingsCurrentRepository = Readonly<{
  get(): SettingsCurrentRecord | undefined;
  advance(input: unknown): SettingsCurrentRecord;
}>;


/**
 * Cancel-tree resolution (ref dashboard-surfaces §2.4) reads every delegation edge under a
 * parent from authority. A child run whose edge row cannot be found makes the
 * tree inconsistent, and an inconsistent tree cancels nothing.
 */
type DependencyRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof DependencyRecordSchema>>;
  get(dependencyId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  listByParentRun(parentRunId: string): readonly z.infer<typeof DependencyRecordSchema>[];
}>;

type WriteIntentRepository = Readonly<{
  listByBusinessKey(system: unknown, digest: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];
  /** D118 recovery admission includes intents from earlier or missing run rows. */
  listAttemptingByItem(input: unknown): readonly z.infer<typeof WriteIntentRecordSchema>[];
  recordObservedPresent(input: unknown): PermanentWriteResolution;
  fenceAttempt(input: unknown): PermanentWriteResolution;
  /** D111: CAS a `retryable` permanent row to `attempting` generation+1 with a FRESH binding proof. */
  refenceRetryable(input: unknown): PermanentWriteResolution;
  /** Ref write-safety §4 arm 3: CAS `attempting` → `parked` on intent AND current attempt. */
  parkAttempt(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  /** Ref write-safety §4 arm 2 / §4.1.2: CAS `attempting`|`parked` → `retryable` with a typed settlement. */
  settleRetryable(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  /** Ref write-safety §4.1.1: CAS `parked` → `attempting` so beat ⑦ can accept confirmed-present. */
  reopenParkedAttempt(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  get(writeIntentId: string): z.infer<typeof WriteIntentRecordSchema> | undefined;
  findByPermanentKey(system: unknown, idempotencyKey: unknown): z.infer<typeof WriteIntentRecordSchema> | undefined;
  /**
   * Ref operator-trust §2.3/§2.5: what external writes did THIS run fence? `run_operations`
   * has no `run_id` column — an intent outlives the run that created it, which
   * is the point of a permanent key — so the run identity is read out of the
   * record itself. An `observed-present` row carries no `runId` at all and is
   * therefore correctly absent here: no run fenced it.
   */
  listByRun(runId: string): readonly z.infer<typeof WriteIntentRecordSchema>[];
  /**
   * T1b dry-run evidence, scoped through THIS run's intent rows. Attempts and
   * durable outbox rows have no run id of their own, so both counts join via
   * `write_intent_id`; a global table count would make another run's write look
   * like this rehearsal's violation.
   */
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
  afterDeleteStep?(event: Readonly<{
    runId: string;
    step: "tombstone" | "cascade-complete" | "tally-settled";
  }>): void;
}

/**
 * Ref workflow-model §5.7. `latest` answers "latest compatible attempt wins" — it returns
 * the highest-numbered attempt for a logical item's node, and returns
 * `undefined` rather than an empty record when nothing was written, so the
 * caller's discriminated `loadCheckpoint` branch is the only way forward.
 */
type RunCheckpointRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RunCheckpointRecord>;
  /**
   * The exact row. `claimGeneration` names WHICH execution of the attempt
   * (D214); omitting it names a row stored before that component existed, which
   * is the only shape that carries no generation.
   */
  get(
    workflowId: string,
    itemId: string,
    nodeId: string,
    attempt: number,
    claimGeneration?: number,
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

/**
 * Ref execution-and-sessions §3's claim authority. `claimNext` and `renewClaim` are the only ways a
 * worker gains or keeps a row, and both are CAS: the row moves out of `queued`
 * in the same transaction that reads it, and a heartbeat that no longer matches
 * `(workerId, claimGeneration)` reports `lost` instead of quietly succeeding.
 */
/** D308 — the delete tombstones, read-only here: the only writer is `RunRepository.delete`. */
type DeletedRunRepository = Readonly<{
  get(runId: string): DeletedRunRecord | undefined;
  list(): readonly DeletedRunRecord[];
}>;

type CanonicalRunClaimOutcome = RunClaimOutcome | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>;

type RunRepository = Readonly<{
  enqueue(input: unknown): ImmutableInsertResult<RunRecord>;
  /**
   * D308 — remove ONE terminal run and every row it owns, in one transaction,
   * behind a `deleted_runs` tombstone written first. Children must already be
   * gone (the kernel walks the tree); a remaining child refuses by name. The
   * archive rows go too when the run is archived.
   */
  delete(input: unknown): DeletedRunRecord;
  get(runId: string): RunRecord | undefined;
  /** A bounded, keyset-ordered read over exact non-archived run authority. */
  search(input: unknown): RunSearchAuthorityPage;
  listByItem(input: unknown): readonly RunRecord[];
  /**
   * D221 — the attempt a run enqueued for this logical item must take: one past
   * the highest attempt any run of `(workflow, itemId)` has ever held, or 1 for
   * an item with no runs.
   *
   * Callers read it inside the SAME authority transaction that inserts the run,
   * which is what makes it a reservation rather than a guess; `enqueue` refuses
   * a record whose attempt this item has ALREADY spent, so a stale read is loud
   * at the insert instead of a checkpoint collision three nodes later. A gap is
   * allowed — an unspent attempt can collide with nothing — but a re-used one is
   * the defect itself.
   */
  nextItemAttempt(input: unknown): number;
  /**
   * D230 — the ORDINAL a run enqueued for this workflow must take: one past the
   * highest number any run of that workflow has ever held, or 1 for a workflow
   * whose every row predates schema v15.
   *
   * The same reservation discipline as `nextItemAttempt` one scope up — read
   * inside the transaction that inserts the run, refused by `enqueue` if the
   * number has been spent, with `UNIQUE (workflow, run_number)` underneath. A
   * gap is legal: a fan-out refused on its fifth entry leaves nothing behind,
   * and the numbers around the gap still name the runs they always named.
   */
  nextWorkflowRunNumber(workflow: string): number;
  listByWorker(workerId: string): readonly RunRecord[];
  /** Indexed D118/D200 read; the run service owns every resulting mutation. */
  listClaimRecoveryCandidates(input: unknown): readonly RunRecord[];
  /**
   * D269 — the MEMBERSHIP of a run session, derived from the run rows that
   * carry the id (`workflow_runs.session_id`). There is no stored member list to
   * disagree with this; a session IS the set this returns, oldest first.
   */
  listBySession(sessionId: string): readonly RunRecord[];
  /**
   * D262 — every run currently parked at an operator gate.
   *
   * The needs-you notification watch reads this and nothing else: a park is a
   * STANDING authority fact (it does not go away until a human resolves it),
   * so the set of runs waiting on a person is derivable at any later instant by
   * any process, which is what makes a missed publish recoverable rather than
   * lost. Deliberately not a general `listByState` — nothing else needs one,
   * and a query named for its one job cannot be reused for a state whose
   * lifecycle arm carries different fields.
   */
  listParkedAtGate(): readonly RunRecord[];
  listChildren(parentRunId: string): readonly RunRecord[];
  /**
   * Ref operator-trust §2.5: `explain run <traceId|runId>` accepts either identity. The
   * trace id is not a column — it is frozen at enqueue inside the envelope —
   * so this reads it out of the record rather than inventing an index for a
   * single-operator lookup.
   */
  findByTrace(traceId: string): RunRecord | undefined;
  /**
   * D179: every run of one workflow, whatever its state. A version bump has to
   * see the whole set — the terminal rows it would archive AND the non-terminal
   * ones that refuse it — so this deliberately does not filter.
   */
  listByWorkflow(workflow: string): readonly RunRecord[];
  /** D288: current means a task row with no matching archive authority row. */
  listCurrentByWorkflow(workflow: string): readonly RunRecord[];
  /**
   * The distinct workflows that HAVE runs. An application-scope bump reaches
   * every one of them, including workflows whose descriptor has since been
   * retired: their runs are prior-version by definition, and enumerating the
   * live registry instead would leave exactly those rows unsweepable.
   */
  listWorkflows(): readonly string[];
  claimNext(input: unknown): RunClaimOutcome;
  /** D330 service path: dependency and disposition eligibility are mandatory. */
  claimEligible(input: unknown): CanonicalRunClaimOutcome;
  renewClaim(input: unknown): RunHeartbeatOutcome;
  transition(input: unknown): RunUpdateOutcome;
  requeue(input: unknown): RunUpdateOutcome;
  resume(input: unknown): RunUpdateOutcome;
  updatePresentation(input: unknown): RunUpdateOutcome;
  requestCancellation(input: Readonly<{ runId: string; expectedVersion: number; now: string }>): RunUpdateOutcome;
  advanceRevision(input: Readonly<{ runId: string; expectedVersion: number; now: string }>): RunUpdateOutcome;
  /** D95 run-priority `bump`: elevate one QUEUED row's claim class; never a requeue. */
  bumpPriority(input: unknown): RunUpdateOutcome;
  /** Ref data-intake-and-edit-data §6.4 (D166): the Edit-Data save — CAS against the resume fence. */
  injectCheckpointPatches(input: unknown): RunUpdateOutcome;
  /** D118: an `attempting` write intent routes to recovery, never to requeue. */
  sweepExpiredClaims(input: unknown): readonly z.infer<typeof RunClaimSweepOutcomeSchema>[];
}>;

/**
 * Ref operator-trust §2.1/§4.2: a failure fingerprint is a JOIN key, not message text.
 * `listByFingerprint` powers "same failure seen before" and `explain failure`;
 * `countByFingerprint` is what the ref dashboard-surfaces repeat-threshold trigger reads.
 */
type FailureRepository = Readonly<{
  get(failureId: string): FailureRecord | undefined;
  listByRun(runId: string): readonly FailureRecord[];
  listByFingerprint(fingerprint: string): readonly FailureRecord[];
  countByFingerprint(fingerprint: string): number;
}>;

/**
 * Ref operator-trust §2.2. A bundle and its attachment index are written together: an
 * attachment row that outlived its bundle would be an unreachable artifact
 * reference, and a bundle whose attachments were not indexed would make
 * artifact-scoped retention unanswerable.
 */
type DiagnosticBundleRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<DiagnosticBundle>;
  get(bundleId: string): DiagnosticBundle | undefined;
  listByRun(runId: string): readonly DiagnosticBundle[];
  listAttachments(bundleId: string): readonly DiagnosticAttachmentStorageRecord[];
  findByArtifact(artifactId: string): readonly DiagnosticAttachmentStorageRecord[];
  /**
   * Ref operator-trust §2.2's retention floor, read through the
   * `(retention_kind, purge_after)` index v10 created for exactly this query.
   * A pinned bundle is structurally unreachable from here.
   */
  listRetentionDue(now: string): readonly DiagnosticBundle[];
  /**
   * The one authority family with a delete, and it is bounded: an ordinary
   * bundle whose own `purgeAfter` has passed, with its attachment index removed
   * in the same transaction so the boot invariant that ties a bundle's
   * `attachments` array to its indexed rows can never see a half-purged bundle.
   * A pinned bundle throws — retention never silently unpins evidence a
   * knowledge/fix record or a write recovery still depends on.
   */
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

/** D288: immutable keyed pseudonym evidence; rotation appends a generation. */
export type ActivityPersonPseudonymRepository = Readonly<{
  get(runId: string, keyGeneration: string): ActivityPersonPseudonymEvidence | undefined;
  listByRun(runId: string): readonly ActivityPersonPseudonymEvidence[];
  listByRuns(runIds: unknown): readonly ActivityPersonPseudonymEvidence[];
}>;

/**
 * D288's scoped mutation capability. It accepts run identities, never a
 * pseudonym or source identifier, and re-reviews exact terminal authority in
 * the transaction that persists the derived batch.
 */
export type ActivityPersonPseudonymBackfillWriteCapability = Readonly<{
  keyGeneration: ActivityPersonPseudonymEvidence["keyGeneration"];
  reviewAndInsert(runIds: unknown): readonly ActivityPersonPseudonymBackfillOutcome[];
}>;

/** DCR5: insert-only proof binding one selection to exact stored workbook bytes and headers. */
export type OperatorXlsxExportRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<OperatorXlsxExportEvidence>;
  get(exportId: string): OperatorXlsxExportEvidence | undefined;
  listByArtifact(artifactId: string): readonly OperatorXlsxExportEvidence[];
}>;

/**
 * Ref operator-trust §4.1/§4.2. Authored guidance and proven fixes. `list` returns EVERY
 * recorded row, whatever its status: the §4.3 duplicate/supersession audit has
 * to see retired and superseded records too, or a candidate could claim to
 * supersede something that never existed.
 */
type KnowledgeRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<KnowledgeRecord>;
  get(knowledgeId: string): KnowledgeRecord | undefined;
  list(): readonly KnowledgeRecord[];
  listByStatus(status: unknown): readonly KnowledgeRecord[];
}>;

type FixRecordRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<FixRecord>;
  get(fixId: string): FixRecord | undefined;
  list(): readonly FixRecord[];
  listByFailureFingerprint(fingerprint: string): readonly FixRecord[];
}>;

/**
 * Ref dashboard-surfaces §2.6 / ref operator-trust §6. This is the ONE authority repository that updates a
 * row rather than appending: a repeated identical trigger folds into the row
 * its `(actorId, dedupeFingerprint)` already owns, and read/snooze is per-row
 * operator state. Identity, creation instant, and trigger are frozen by SQLite
 * triggers; only `count`, `lastSeenAt`, `status`, `snooze`, `title`, `summary`,
 * `updatedAt`, and a strictly advancing `version` move. A notification is
 * derived operator state — it is NOT the transaction record, and nothing here
 * weakens the ledger's true append-only immutability.
 */
type NotificationRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<NotificationRecord>;
  fold(input: unknown): NotificationRecordOutcome;
  updateState(input: unknown): NotificationRecord;
  get(notificationId: string): NotificationRecord | undefined;
  findByDedupe(actorId: string, dedupeFingerprint: string): NotificationRecord | undefined;
  listByActor(actorId: string, status?: unknown): readonly NotificationRecord[];
}>;

/**
 * Ref write-safety §6's serialized ledger projection authority. Executors never touch
 * these rows; the projector does, one `(system, date)` partition at a time.
 */


type RunResultRepository = Readonly<{
  get(runId: string): RunResultRecord | undefined;
}>;


type StartPlanRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<StartPlanRecord>;
  get(startPlanId: string): StartPlanRecord | undefined;
  consume(input: unknown): StartPlanConsumeOutcome;
}>;

/**
 * D269 (ref execution-and-sessions §11.5): the per-workflow worker POOL
 * declaration. `plan` is a CAS over `(workflow, version)` where a workflow
 * with no row is at version 0 — the first plan creates it — and a stale
 * `expectedVersion` answers `conflict` naming the current version rather than
 * applying over it. Never deleted; `list` is what the day wire serves.
 */
type WorkerPoolRepository = Readonly<{
  plan(input: unknown): WorkerPoolPlanOutcome;
  get(workflow: string): WorkerPoolRecord | undefined;
  list(): readonly WorkerPoolRecord[];
}>;

/**
 * D269 (ref execution-and-sessions §11.1): the durable run SESSION — a
 * dashboard-started group. Immutable identity, versioned presentation and no member list: `runs.listBySession`
 * is the membership, derived from the run rows that carry the id.
 */
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
  sweepExpired(input: unknown): readonly WorkerLeaseRecord[];
}>;

type OpaqueAuthorityRepositories = Readonly<{
  ocrApprovals: ImmutableRepository<OpaqueAuthorityRecord>;
}>;

/**
 * Ref dashboard-surfaces §2.1 (D45) / ref data-intake-and-edit-data §4.1: the stable-keyed local artifact outbox.
 * Insert commits atomically with the producing node's checkpoint (the caller
 * wraps both in one authority transaction); `markProjected` is the sink
 * projector's acknowledgement — a CAS from `pending`, idempotent on an
 * already-projected row so an at-least-once projector can re-acknowledge
 * after a crash without erroring.
 */
type ArtifactOutboxRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<ArtifactOutboxStorageRecord>;
  get(outboxId: string): ArtifactOutboxStorageRecord | undefined;
  listPending(): readonly ArtifactOutboxStorageRecord[];
  markProjected(input: unknown): Readonly<{
    state: "acknowledged" | "already-projected";
    record: ArtifactOutboxStorageRecord;
  }>;
}>;

/**
 * One row per sink, updated under a generation CAS — the notifications
 * discipline (v10's lesson) applied to the projector's recorded workbook
 * hash. The head is what makes a concurrent operator edit DETECTABLE: bytes
 * that do not hash to `contentSha256` were changed by someone else.
 */
type ArtifactSinkHeadRepository = Readonly<{
  get(sinkId: string): ArtifactSinkHeadRecord | undefined;
  record(input: unknown): ArtifactSinkHeadRecord;
}>;

/** Ref data-intake-and-edit-data §5 — insert-only; a rerun creates a new manifest (D159). */
type IntakeManifestRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof IntakePlanManifestSchema>>;
  get(manifestId: string): z.infer<typeof IntakePlanManifestSchema> | undefined;
  findBySource(sourceSha256: string): readonly z.infer<typeof IntakePlanManifestSchema>[];
}>;

/**
 * Ref data-intake-and-edit-data §2.2's durable in-progress session (2i-E1). Create-in-mapping,
 * version-CAS updates that keep the searchable columns in step with the
 * record, and a by-source lookup so a re-upload of the same bytes can find
 * its open session instead of silently forking a second one.
 */
type IntakeSessionRepository = Readonly<{
  create(input: unknown): z.infer<typeof IntakeSessionSchema>;
  get(intakeSessionId: string): z.infer<typeof IntakeSessionSchema> | undefined;
  update(input: unknown): z.infer<typeof IntakeSessionSchema>;
  findActiveBySource(sourceSha256: string): readonly z.infer<typeof IntakeSessionSchema>[];
}>;

/**
 * D179: a reviewable version-bump plan, consumed exactly once. Insert plus a
 * CAS `planned → applied` — the same shape a start plan has, because it is the
 * same problem: an immutable proposal a later command must not be able to
 * apply twice.
 */
type VersionPlanRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<VersionPlanStorageRecord>;
  get(versionPlanId: string): VersionPlanStorageRecord | undefined;
  list(): readonly VersionPlanStorageRecord[];
  consume(input: unknown): VersionPlanConsumeOutcome;
}>;

/** D179: one self-contained archived run per prior-version run a bump swept. */
type ArchivedRunRepository = Readonly<{
  transactions(runId: string): ArchivedTransactions;
  enrichTransactions(input: unknown): ArchivedTransactions;
  bindingMismatches(input: unknown): readonly string[];
  insert(input: unknown): ImmutableInsertResult<ArchivedRunStorageRecord>;
  get(runId: string): ArchivedRunStorageRecord | undefined;
  isArchived(runId: string): boolean;
  list(): readonly ArchivedRunStorageRecord[];
}>;

/** Ref data-intake-and-edit-data §4.3 — one page, read once, for one form (D159). */
type OcrExtractionRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof AdmittedExtractionSchema>>;
  get(sourceSha256: string, sourcePage: number, formType: string):
    z.infer<typeof AdmittedExtractionSchema> | undefined;
  findByDocument(sourceSha256: string): readonly z.infer<typeof AdmittedExtractionSchema>[];
}>;

/**
 * D267 (ref execution-and-sessions §10): the Duo ceremony lease — ONE ceremony
 * at a time per credential. `acquire` answers `held` naming the live holder,
 * takes over an expired row at the next generation, and is the ONLY minter of
 * the `DuoCeremonyLeaseToken` the SSO helpers require; `release` retires that
 * token whether or not the row still carries the token's generation, and
 * REPORTS supersession rather than writing over a successor.
 */
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
  timelineEvents: TimelineRepository;
  runs: RunRepository;
  failures: FailureRepository;
  runResults: RunResultRepository;
  diagnosticBundles: DiagnosticBundleRepository;
  evidenceReceipts: EvidenceReceiptRepository;
  dryRunScenarioResults: DryRunScenarioResultRepository;
  operatorXlsxExports: OperatorXlsxExportRepository;
  activityPersonPseudonyms: ActivityPersonPseudonymRepository;
  intakeSessions: IntakeSessionRepository;
  intakeManifests: IntakeManifestRepository;
  ocrExtractions: OcrExtractionRepository;
  knowledgeRecords: KnowledgeRepository;
  fixRecords: FixRecordRepository;
  historicalOperationSources: { list(): readonly HistoricalOperationSource[] };
  providerAdmissions: ProviderAdmissionRepository;
  startPlans: StartPlanRepository;
  workerLeases: WorkerLeaseRepository;
  duoCeremonyLeases: DuoCeremonyLeaseRepository;
  workerPools: WorkerPoolRepository;
  runSessions: RunSessionRepository;
  deletedRuns: DeletedRunRepository;
  commands: CommandRepository;
  commandAudits: CommandAuditRepository;
  lifecycleJournal: RunLifecycleJournalRepository;
  dependencies: DependencyRepository;
  delegationManifests: ImmutableRepository<z.infer<typeof DelegationManifestSchema>>;
  gateResults: ImmutableRepository<z.infer<typeof GateResultRecordSchema>> & Readonly<{
    /** Every gate this run resolved, oldest first — the D204 receipt read. */
    listByRun(runId: string): readonly z.infer<typeof GateResultRecordSchema>[];
  }>;
  runCheckpoints: RunCheckpointRepository;
  notifications: NotificationRepository;
  configSnapshots: ImmutableRepository<z.infer<typeof ConfigSnapshotRecordSchema>>;
  settingsCurrent: SettingsCurrentRepository;
  runtimeConfig: RuntimeConfigRepository;
  versionPlans: VersionPlanRepository;
  versionBumpApplications: ImmutableRepository<VersionBumpApplicationStorageRecord> & Readonly<{
    list(): readonly VersionBumpApplicationStorageRecord[];
  }>;
  archivedRuns: ArchivedRunRepository;
  archiveRelaunches: Readonly<{
    insert(input: unknown): ImmutableInsertResult<ArchiveRelaunchStorageRecord>;
    listByArchivedRun(archivedRunId: string): readonly ArchiveRelaunchStorageRecord[];
  }>;
  writeIntents: WriteIntentRepository;
  writeAttempts: ReadRepository<z.infer<typeof WriteAttemptRecordSchema>> & Readonly<{
    listByIntent(writeIntentId: string): readonly z.infer<typeof WriteAttemptRecordSchema>[];
  }>;
  artifactOutbox: ArtifactOutboxRepository;
  artifactSinkHeads: ArtifactSinkHeadRepository;
  opaque: OpaqueAuthorityRepositories;
}>;

type ProjectionRepository = Readonly<{
  upsert(input: unknown): ProjectionStorageRecord;
  get(projectionKey: string): ProjectionStorageRecord | undefined;
  clear(): number;
}>;

export type ProjectionRepositories = Readonly<{
  spans: ProjectionRepository;
  gates: ProjectionRepository;
  notes: ProjectionRepository;
}>;

const OpaqueAuthorityTableSchema = z.enum([
  "ocr_approvals",
]);

const JsonRowSchema = z.strictObject({ record_json: z.string() });
const RecordKeyRowSchema = z.strictObject({ record_key: z.string() });
const ProtectedSettingsWriteIdLookupSchema = z.strictObject({
  writeId: z.uuid(),
  excludingCommandId: CommandIdSchema,
});
const NextEligibleRowSchema = z.strictObject({ next_eligible_at: z.string().nullable() });
const HeldRunRowSchema = z.strictObject({ run_id: z.string().nullable() });
const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const TextPragmaRowSchema = z.record(z.string(), z.string());
const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});
const TableNameRowSchema = z.strictObject({ name: z.string() });
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
const DataVersionRowSchema = z.strictObject({ data_version: z.number().int().nonnegative() });
const RunSearchReadRequestSchema = z.strictObject({
  q: z.string().trim().min(1).max(CROSS_DATE_SEARCH_QUERY_LIMIT).transform((value) => value.toLowerCase()),
  scope: CrossDateSearchScopeSchema,
  facets: z.strictObject({
    workflow: CrossDateSearchWorkflowFacetSchema.optional(),
    day: z.strictObject({
      startsAt: IsoInstantSchema,
      endsBefore: IsoInstantSchema,
    }).refine(
      (day) => Date.parse(day.startsAt) < Date.parse(day.endsBefore),
      { message: "search day must end after it starts" },
    ).optional(),
    state: CrossDateSearchStateFacetSchema.optional(),
    shape: CrossDateSearchShapeFacetSchema.optional(),
    dryRun: CrossDateSearchDryRunFacetSchema.optional(),
    system: CrossDateSearchSystemFacetSchema.optional(),
  }),
  limit: z.number().int().positive().max(CROSS_DATE_SEARCH_PAGE_LIMIT + 1),
  after: z.strictObject({
    matchRank: z.number().int().min(0).max(CROSS_DATE_SEARCH_MAX_MATCH_RANK),
    enqueuedAt: IsoInstantSchema,
    runId: RunIdSchema,
  }).optional(),
});
const RunSearchCorpusRowSchema = z.strictObject({
  record_key: RunIdSchema,
  record_json: z.string(),
  workflow: WorkflowIdSchema,
  state: RunStateSchema,
  priority: RunPrioritySchema,
  created_at: IsoInstantSchema,
  created_at_epoch_ms: z.number().int(),
});
const RunSearchRowSchema = RunSearchCorpusRowSchema.extend({
  match_rank: z.number().int().min(0).max(CROSS_DATE_SEARCH_MAX_MATCH_RANK),
});
const RunSearchPassResultSchema = z.discriminatedUnion("result_kind", [
  z.strictObject({
    result_kind: z.literal("row"),
    payload: z.string(),
    total_matches: z.null(),
    result_order: z.literal(0),
    order_match_rank: z.number().int().min(0).max(CROSS_DATE_SEARCH_MAX_MATCH_RANK),
    order_created_at_epoch_ms: z.number().int(),
    order_record_key: RunIdSchema,
  }),
  z.strictObject({
    result_kind: z.literal("summary"),
    payload: z.null(),
    total_matches: NonNegativeIntSchema,
    result_order: z.literal(1),
    order_match_rank: z.null(),
    order_created_at_epoch_ms: z.null(),
    order_record_key: z.null(),
  }),
]);
/** D221 — `max()` over no rows is SQL NULL, which is "this item has never run". */
const MaxAttemptRowSchema = z.strictObject({ attempt: z.number().int().positive().nullable() });
const MaxRunNumberRowSchema = z.strictObject({ run_number: z.number().int().positive().nullable() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const AuthorityRecordFingerprintRowSchema = z.strictObject({ record_key: z.string(), record_json: z.string() });
const OperatorXlsxExportRowSchema = z.strictObject({
  record_key: OperatorXlsxExportIdSchema,
  selection_kind: z.enum(["search", "activity"]),
  artifact_id: ArtifactIdSchema,
  digest: FingerprintSchema,
  byte_length: z.number().int().positive(),
  media_type: z.string().min(1),
  filename: z.string().min(1),
  requested_by: ActorIdSchema.nullable(),
  record_json: z.string(),
  created_at: IsoInstantSchema,
});
const AuthorityMetaFingerprintRowSchema = z.strictObject({
  singleton_id: z.literal(1),
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});

export type RunSearchAuthorityRow = Readonly<{
  record: RunRecord;
  matchRank: number;
}>;

function operatorXlsxEvidenceFromRow(input: unknown): OperatorXlsxExportEvidence {
  const row = OperatorXlsxExportRowSchema.parse(input);
  const record = parseJsonRecord(OperatorXlsxExportEvidenceSchema, row.record_json);
  const requestedBy = record.workbookVersion === 1 ? null : record.requestedBy;
  if (row.record_key !== record.exportId
    || row.selection_kind !== record.selection.kind
    || row.artifact_id !== record.artifact.id
    || row.digest !== record.download.sha256
    || row.byte_length !== record.download.byteLength
    || row.media_type !== record.download.mediaType
    || row.filename !== record.download.filename
    || row.requested_by !== requestedBy
    || row.created_at !== record.createdAt) {
    throw new Error(
      `operator XLSX export ${record.exportId} mirrored columns disagree with its strict record JSON`,
    );
  }
  return record;
}

export type RunSearchAuthorityPage = Readonly<{
  totalMatches: number;
  rows: readonly RunSearchAuthorityRow[];
}>;

type RunSearchReadRequest = z.infer<typeof RunSearchReadRequestSchema>;
type RunSearchSqlParameter = string | number;
type RunSearchCorpusRow = z.infer<typeof RunSearchCorpusRowSchema>;
type RunSearchCorpusValidation = Readonly<{
  authorityGeneration: number;
  dataVersion: number;
}>;

const RUN_SEARCH_CREATED_AT_EPOCH_MS_SQL =
  "CAST(round((julianday(t.created_at) - 2440587.5) * 86400000.0) AS INTEGER)";

const RUN_SEARCH_FIELD_EXPRESSIONS = Object.freeze({
  run: "lower(t.record_key)",
  trace: "lower(json_extract(t.record_json, '$.envelope.traceId'))",
  workflow: "lower(t.workflow)",
});

function runSearchRankSql(scope: z.infer<typeof CrossDateSearchScopeSchema>): string {
  const clauses = CROSS_DATE_SEARCH_MATCH_ORDER.flatMap((match, rank) => {
    if (scope !== "all" && match.field !== scope) return [];
    const expression = RUN_SEARCH_FIELD_EXPRESSIONS[match.field];
    switch (match.strength) {
      case "exact": return [`WHEN ${expression} = search.q THEN ${String(rank)}`];
      case "prefix": return [
        `WHEN substr(${expression}, 1, length(search.q)) = search.q THEN ${String(rank)}`,
      ];
      case "contains": return [`WHEN instr(${expression}, search.q) > 0 THEN ${String(rank)}`];
    }
  });
  return `CASE ${clauses.join(" ")} ELSE NULL END`;
}

function runSearchFilter(input: RunSearchReadRequest): Readonly<{
  sql: string;
  parameters: readonly RunSearchSqlParameter[];
}> {
  const conditions = [
    "NOT EXISTS (SELECT 1 FROM archived_runs AS archived WHERE archived.record_key = t.record_key)",
  ];
  const parameters: RunSearchSqlParameter[] = [];
  const { facets } = input;
  if (facets.workflow !== undefined) {
    conditions.push("t.workflow = ?");
    parameters.push(facets.workflow);
  }
  if (facets.day !== undefined) {
    conditions.push(
      `${RUN_SEARCH_CREATED_AT_EPOCH_MS_SQL} >= ? AND ${RUN_SEARCH_CREATED_AT_EPOCH_MS_SQL} < ?`,
    );
    parameters.push(
      instantEpochMilliseconds(facets.day.startsAt),
      instantEpochMilliseconds(facets.day.endsBefore),
    );
  }
  if (facets.state !== undefined) {
    const terminalOutcome = ![
      "queued", "claimed", "validating", "running", "parked-gate", "parked-write",
    ].includes(facets.state);
    if (terminalOutcome) {
      conditions.push("t.state = 'terminal' AND json_extract(t.record_json, '$.lifecycle.outcome') = ?");
    } else {
      conditions.push("t.state = ?");
    }
    parameters.push(facets.state);
  }
  if (facets.shape !== undefined) {
    conditions.push("json_extract(t.record_json, '$.envelope.shape') = ?");
    parameters.push(facets.shape);
  }
  if (facets.dryRun !== undefined) {
    conditions.push("json_extract(t.record_json, '$.envelope.dryRun') = ?");
    parameters.push(facets.dryRun ? 1 : 0);
  }
  if (facets.system !== undefined) {
    conditions.push("json_type(t.record_json, ?) IS NOT NULL");
    parameters.push(`$.envelope.resolvedInstance.${facets.system}`);
  }
  return Object.freeze({ sql: conditions.join(" AND "), parameters: Object.freeze(parameters) });
}

function parseJsonRecord<Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> {
  return schema.parse(JSON.parse(text));
}

function activityPseudonymObjectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}


function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function instantEpochMilliseconds(instant: string): number {
  const epochMilliseconds = Date.parse(instant);
  if (!Number.isSafeInteger(epochMilliseconds)) {
    throw new Error(`instant ${instant} cannot be represented as epoch milliseconds`);
  }
  return epochMilliseconds;
}

function canonicalUtcInstant(instant: string): string {
  return new Date(instantEpochMilliseconds(instant)).toISOString();
}

type SearchCorpusDimension = "workflow" | "shape" | "dry-run" | "resolved systems" | "lifecycle/outcome";

function refuseOutsideSearchCorpus(
  runId: string,
  dimension: SearchCorpusDimension,
  observed: string,
): never {
  throw new Error(
    `search corpus run ${runId} has ${dimension} outside the closed D283 corpus`,
    { cause: new Error(`search corpus observed ${dimension}: ${observed}`) },
  );
}

function reconcileRunSearchCorpusRow(row: RunSearchCorpusRow): RunRecord {
  let record: RunRecord;
  try {
    record = parseJsonRecord(RunRecordSchema, row.record_json);
  } catch (error) {
    throw new Error(
      `search corpus run ${row.record_key} failed strict run validation`,
      { cause: error },
    );
  }
  if (record.envelope.runId !== row.record_key) {
    throw new Error(
      `search selected task ${row.record_key} whose strict record names run ${record.envelope.runId}`,
    );
  }
  if (row.workflow !== record.envelope.workflow) {
    throw new Error(
      `search selected run ${row.record_key} whose searchable workflow column ${row.workflow} does not `
      + `equal its durable workflow ${record.envelope.workflow}`,
    );
  }
  if (row.state !== record.lifecycle.state) {
    throw new Error(
      `search selected run ${row.record_key} whose searchable state column ${row.state} does not equal `
      + `its durable state ${record.lifecycle.state}`,
    );
  }
  if (row.priority !== record.envelope.priority) {
    throw new Error(
      `search selected run ${row.record_key} whose searchable priority column ${row.priority} does not `
      + `equal its durable priority ${record.envelope.priority}`,
    );
  }
  const createdAtEpochMs = instantEpochMilliseconds(record.createdAt);
  const enqueuedAtEpochMs = instantEpochMilliseconds(record.envelope.enqueuedAt);
  if (row.created_at_epoch_ms !== createdAtEpochMs || row.created_at_epoch_ms !== enqueuedAtEpochMs) {
    throw new Error(
      `search selected run ${row.record_key} whose authority order instant ${row.created_at} does not equal its `
      + `durable enqueue instant ${record.envelope.enqueuedAt} and created instant ${record.createdAt}`,
    );
  }
  if (!CrossDateSearchWorkflowFacetSchema.safeParse(record.envelope.workflow).success) {
    return refuseOutsideSearchCorpus(row.record_key, "workflow", record.envelope.workflow);
  }
  if (!CrossDateSearchShapeFacetSchema.safeParse(record.envelope.shape).success) {
    return refuseOutsideSearchCorpus(row.record_key, "shape", record.envelope.shape);
  }
  if (!CrossDateSearchDryRunFacetSchema.safeParse(record.envelope.dryRun).success) {
    return refuseOutsideSearchCorpus(row.record_key, "dry-run", String(record.envelope.dryRun));
  }
  const resolvedSystems = Object.keys(record.envelope.resolvedInstance)
    .map((system) => BrowserSystemIdSchema.parse(system))
    .sort((left, right) => left.localeCompare(right));
  if (resolvedSystems.length !== CrossDateSearchSystemFacetSchema.options.length
    || CrossDateSearchSystemFacetSchema.options.some((system) => !resolvedSystems.includes(system))) {
    return refuseOutsideSearchCorpus(row.record_key, "resolved systems", resolvedSystems.join(", "));
  }
  const searchableState = record.lifecycle.state === "terminal"
    ? record.lifecycle.outcome
    : record.lifecycle.state;
  if (!CrossDateSearchStateFacetSchema.safeParse(searchableState).success) {
    return refuseOutsideSearchCorpus(row.record_key, "lifecycle/outcome", searchableState);
  }
  return record;
}

function fixedUtcMinuteStart(instant: string): string {
  const milliseconds = Date.parse(instant);
  return new Date(Math.floor(milliseconds / 60_000) * 60_000).toISOString();
}

function fixedUtcDayStart(instant: string): string {
  const at = new Date(Date.parse(instant));
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
}

function nextFixedWindow(start: string, milliseconds: number): string {
  return new Date(Date.parse(start) + milliseconds).toISOString();
}

function readIntPragma(
  database: DatabaseSync,
  name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout",
): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name === "busy_timeout" ? "timeout" : name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function readTextPragma(database: DatabaseSync, name: "journal_mode"): string {
  const row = TextPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function tableNames(database: DatabaseSync): TableName[] {
  const rows = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return z.array(z.union([AuthorityTableNameSchema, ProjectionTableNameSchema])).parse(
    rows.map((row) => TableNameRowSchema.parse(row).name),
  );
}

function readMetaRow(database: DatabaseSync): z.infer<typeof MetaRowSchema> {
  return MetaRowSchema.parse(database.prepare(`
    SELECT schema_version, authority_generation, updated_at, migration_owner, migration_started_at
    FROM ${databaseStateTable(readIntPragma(database, "user_version"))} WHERE singleton_id = 1
  `).get());
}

const INVARIANT_QUERIES = Object.freeze([
  {
    name: "run-completion-revisions",
    sql: `SELECT count(*) AS count FROM workflow_runs AS run
      WHERE json_type(run.record_json, '$.completion') IS 'object'
        AND run.version - json_extract(run.record_json, '$.completion.expectedVersion') - 1 <> (
          SELECT count(DISTINCT json_extract(audit.record_json, '$.result.appliedVersion')) FROM command_audits AS audit
          WHERE json_extract(audit.record_json, '$.kind') = 'run-lifecycle'
            AND json_extract(audit.record_json, '$.result.kind') = 'run'
            AND json_extract(audit.record_json, '$.result.runId') = run.record_key
            AND json_extract(audit.record_json, '$.request.operation') IN ('transition','archive')
            AND json_extract(audit.record_json, '$.request.fence.kind') = 'version'
            AND json_extract(audit.record_json, '$.request.fence.expectedVersion') = json_extract(audit.record_json, '$.result.appliedVersion') - 1
            AND json_extract(audit.record_json, '$.result.appliedVersion') > json_extract(run.record_json, '$.completion.expectedVersion') + 1
            AND json_extract(audit.record_json, '$.result.appliedVersion') <= run.version)` ,
  },
  {
    name: "run-completion-consequences",
    sql: `SELECT count(*) AS count FROM workflow_runs AS run
      LEFT JOIN run_results AS result ON result.record_key = run.record_key
      LEFT JOIN run_failures AS failure ON failure.run_id = run.record_key
      WHERE COALESCE(json_extract(run.record_json, '$.lifecycle.outcome') IN ('done','failed'), 0)
        IS NOT (json_type(run.record_json, '$.completion') IS 'object')
        OR (json_extract(run.record_json, '$.completion.kind') = 'done' AND (
          result.record_key IS NULL OR failure.record_key IS NOT NULL
          OR json_extract(run.record_json, '$.completion.resultDigest') IS NOT result.result_digest))
        OR (json_extract(run.record_json, '$.completion.kind') = 'failed' AND (
          failure.record_key IS NULL OR result.record_key IS NOT NULL
          OR json_extract(run.record_json, '$.completion.failureId') IS NOT failure.record_key
          OR json_extract(run.record_json, '$.lifecycle.errorSummary') IS NOT json_extract(failure.record_json, '$.summary')
          OR json_extract(run.record_json, '$.lifecycle.diagnosticSafetyVersion') IS NOT json_extract(failure.record_json, '$.diagnosticSafetyVersion')))` ,
  },

  {
    name: "workflow-batch-columns-match-record",
    sql: "SELECT count(*) AS count FROM workflow_run_batches WHERE record_key IS NOT json_extract(record_json, '$.sessionId') OR workflow IS NOT json_extract(record_json, '$.workflow') OR started_at IS NOT json_extract(record_json, '$.startedAt') OR created_at IS NOT json_extract(record_json, '$.createdAt') OR group_in_queue IS NOT json_extract(record_json, '$.groupInQueue') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "settings-current-columns-match-record",
    sql: "SELECT count(*) AS count FROM settings_current WHERE record_key <> 'current' OR revision <> json_extract(record_json, '$.revision') OR settings_fingerprint <> json_extract(record_json, '$.settingsFingerprint') OR command_id <> json_extract(record_json, '$.commandId') OR command_fingerprint <> json_extract(record_json, '$.commandFingerprint') OR audit_id <> json_extract(record_json, '$.auditId') OR created_at <> json_extract(record_json, '$.committedAt')",
  },
  {
    name: "runtime-config-columns-match-record",
    sql: "SELECT count(*) AS count FROM runtime_config WHERE record_key <> 'active' OR generation <> json_extract(record_json, '$.generation') OR settings_revision <> json_extract(record_json, '$.settingsRevision') OR settings_fingerprint <> json_extract(record_json, '$.settingsFingerprint') OR config_snapshot_id <> json_extract(record_json, '$.configSnapshotId') OR config_fingerprint <> json_extract(record_json, '$.configFingerprint') OR created_at <> json_extract(record_json, '$.activatedAt')",
  },
  {
    name: "run-columns-match-record",
    sql: "SELECT count(*) AS count FROM workflow_runs WHERE workflow <> json_extract(record_json, '$.envelope.workflow') OR item_id <> json_extract(record_json, '$.envelope.itemId') OR state <> json_extract(record_json, '$.lifecycle.state') OR priority <> json_extract(record_json, '$.envelope.priority') OR attempt <> json_extract(record_json, '$.envelope.attempt') OR version <> json_extract(record_json, '$.version') OR claim_generation <> json_extract(record_json, '$.claimGeneration') OR run_number IS NOT json_extract(record_json, '$.runNumber') OR session_id IS NOT json_extract(record_json, '$.sessionId')",
  },
  {
    name: "run-claim-owner-matches-record",
    sql: "SELECT count(*) AS count FROM workflow_runs WHERE state IN ('claimed','validating','running') AND (owner_worker_id <> json_extract(record_json, '$.lifecycle.workerId') OR heartbeat_at <> json_extract(record_json, '$.lifecycle.heartbeatAt'))",
  },
  {
    name: "failure-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_failures WHERE run_id <> json_extract(record_json, '$.runId')",
  },
  {
    name: "failed-runs-bind-failure",
    sql: `
      SELECT count(*) AS count FROM workflow_runs AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM run_failures AS failure
          WHERE failure.record_key = json_extract(run.record_json, '$.lifecycle.failureId')
            AND failure.run_id = run.record_key
        )
    `,
  },
  {
    name: "failures-bind-failed-run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN workflow_runs AS run ON run.record_key = failure.run_id
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(run.record_json, '$.lifecycle.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "failure-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN workflow_runs AS run ON run.record_key = failure.run_id
      WHERE json_extract(failure.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(failure.record_json, '$.traceId') <> json_extract(run.record_json, '$.envelope.traceId')
        OR json_extract(failure.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
    `,
  },
  {
    name: "run-result-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_results WHERE workflow <> json_extract(record_json, '$.workflowId') OR attempt <> json_extract(record_json, '$.attempt') OR result_digest <> json_extract(record_json, '$.resultDigest') OR record_key <> json_extract(record_json, '$.runId')",
  },
  {
    name: "run-result-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN workflow_runs AS run ON run.record_key = result.record_key
      WHERE json_extract(result.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(result.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
        OR json_extract(result.record_json, '$.descriptorVersion') <> json_extract(run.record_json, '$.envelope.descriptorVersion')
        OR json_extract(result.record_json, '$.contractFingerprint') <> json_extract(run.record_json, '$.envelope.contractFingerprint')
        OR json_extract(result.record_json, '$.configFingerprint') <> json_extract(run.record_json, '$.envelope.configFingerprint')
        OR json_extract(result.record_json, '$.configSnapshotId') <> json_extract(run.record_json, '$.envelope.configSnapshotId')
    `,
  },
  {
    name: "results-bind-done-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN workflow_runs AS run ON run.record_key = result.record_key
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'done'
    `,
  },
  {
    name: "provider-counter-columns-match-record",
    sql: "SELECT count(*) AS count FROM provider_budget_counters WHERE record_key IS NOT capability OR capability IS NOT json_extract(record_json, '$.capability') OR minute_window_started_at IS NOT json_extract(record_json, '$.minuteWindowStartedAt') OR minute_requests IS NOT json_extract(record_json, '$.minuteRequests') OR day_window_started_at IS NOT json_extract(record_json, '$.dayWindowStartedAt') OR day_requests IS NOT json_extract(record_json, '$.dayRequests') OR day_reserved_cost_usd_micros IS NOT json_extract(record_json, '$.dayReservedCostUsdMicros') OR active_reservations IS NOT json_extract(record_json, '$.activeReservations') OR blocked_by_admission_id IS NOT json_extract(record_json, '$.blockedByAdmissionId') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "provider-admission-columns-match-record",
    sql: "SELECT count(*) AS count FROM provider_admissions WHERE record_key IS NOT json_extract(record_json, '$.admissionId') OR run_id IS NOT json_extract(record_json, '$.execution.runId') OR capability IS NOT json_extract(record_json, '$.capability') OR config_snapshot_id IS NOT json_extract(record_json, '$.configSnapshotId') OR config_fingerprint IS NOT json_extract(record_json, '$.configFingerprint') OR request_fingerprint IS NOT json_extract(record_json, '$.requestFingerprint') OR state IS NOT json_extract(record_json, '$.lifecycle.state') OR reserved_cost_usd_micros IS NOT json_extract(record_json, '$.reservation.maximumCostUsdMicros') OR actual_cost_usd_micros IS NOT json_extract(record_json, '$.lifecycle.actualUsage.costUsdMicros') OR lease_expires_at IS NOT json_extract(record_json, '$.lifecycle.leaseExpiresAt') OR deadline_at IS NOT json_extract(record_json, '$.lifecycle.deadlineAt') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "provider-active-reservations-match",
    sql: "SELECT count(*) AS count FROM provider_budget_counters AS counter WHERE counter.active_reservations <> (SELECT count(*) FROM provider_admissions AS admission WHERE admission.capability = counter.capability AND admission.state = 'reserved')",
  },
  {
    name: "duo-ceremony-lease-columns-match-record",
    sql: "SELECT count(*) AS count FROM worker_auth WHERE record_key <> json_extract(record_json, '$.credentialKey') OR generation <> json_extract(record_json, '$.generation') OR holder_worker_id <> json_extract(record_json, '$.holder.workerId') OR holder_system <> json_extract(record_json, '$.holder.system') OR state <> json_extract(record_json, '$.state') OR expires_at <> json_extract(record_json, '$.expiresAt') OR version <> json_extract(record_json, '$.version')",
  },
  {
    name: "worker-lease-columns-match-record",
    sql: "SELECT count(*) AS count FROM workflow_workers WHERE worker_id <> record_key OR worker_id <> json_extract(record_json, '$.workerId') OR workflow <> json_extract(record_json, '$.workflow') OR lease_generation <> json_extract(record_json, '$.leaseGeneration') OR state <> json_extract(record_json, '$.lifecycle.state') OR directive <> json_extract(record_json, '$.control.directive') OR version <> json_extract(record_json, '$.version')",
  },
  {
    // One worker owns at most one active run (ref execution-and-sessions §0.3). This is the
    // invariant the whole claim protocol exists to hold, so it is checked in
    // the database rather than trusted from the loop that maintains it.
    name: "worker-owns-at-most-one-active-run",
    sql: `
      SELECT count(*) AS count FROM (
        SELECT owner_worker_id FROM workflow_runs
        WHERE state IN ('claimed','validating','running')
        GROUP BY owner_worker_id HAVING count(*) > 1
      )
    `,
  },
  {
    name: "commands-family-column-matches-record",
    sql: `
      SELECT count(*) AS count FROM commands
      WHERE family IS NOT CASE
        WHEN json_extract(record_json, '$.kind') IN ('run-lifecycle', 'bulk-parent') THEN json_extract(record_json, '$.kind')
        ELSE json_extract(record_json, '$.family')
      END
    `,
  },
  {
    name: "command-audit-parent-column-matches-record",
    sql: "SELECT count(*) AS count FROM command_audits WHERE command_id <> json_extract(record_json, '$.request.commandId')",
  },
  {
    name: "bulk-parent-columns-match-record",
    sql: "SELECT count(*) AS count FROM commands WHERE family = 'bulk-parent' AND (parent_command_id IS NOT NULL OR record_key IS NOT json_extract(record_json, '$.commandId') OR created_at IS NOT json_extract(record_json, '$.acceptance.request.requestedAt') OR EXISTS (SELECT 1 FROM command_audits WHERE command_id = commands.record_key))",
  },
  {
    name: "dependency-manifest-column-matches-record",
    sql: "SELECT count(*) AS count FROM delegation_dependencies WHERE manifest_id <> json_extract(record_json, '$.manifestId')",
  },
  {
    name: "write-intent-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_operations WHERE system <> json_extract(record_json, '$.system') OR idempotency_key <> json_extract(record_json, '$.idempotencyKey') OR idempotency_key_digest <> json_extract(record_json, '$.idempotencyKeyDigest') OR status <> json_extract(record_json, '$.status')",
  },
  {
    name: "write-attempt-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_operation_attempts WHERE write_intent_id <> json_extract(record_json, '$.writeIntentId') OR generation <> json_extract(record_json, '$.generation')",
  },

  {
    name: "failure-fingerprint-column-matches-record",
    sql: "SELECT count(*) AS count FROM run_failures WHERE fingerprint IS NOT json_extract(record_json, '$.fingerprint')",
  },
  {
    name: "notification-columns-match-record",
    sql: "SELECT count(*) AS count FROM notifications WHERE record_key IS NOT json_extract(record_json, '$.notificationId') OR actor_id IS NOT json_extract(record_json, '$.actorId') OR dedupe_fingerprint IS NOT json_extract(record_json, '$.dedupeFingerprint') OR status IS NOT json_extract(record_json, '$.status') OR seen_count IS NOT json_extract(record_json, '$.count') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "diagnostic-bundle-columns-match-record",
    sql: "SELECT count(*) AS count FROM diagnostic_snapshots WHERE record_key IS NOT json_extract(record_json, '$.bundleId') OR run_id IS NOT json_extract(record_json, '$.runId') OR origin_kind IS NOT json_extract(record_json, '$.origin.kind') OR failure_id IS NOT json_extract(record_json, '$.origin.failureId') OR content_digest IS NOT json_extract(record_json, '$.contentDigest') OR retention_kind IS NOT json_extract(record_json, '$.retention.kind') OR purge_after IS NOT json_extract(record_json, '$.retention.purgeAfter')",
  },
  {
    name: "diagnostic-attachment-binds-its-bundle",
    sql: `
      SELECT count(*) AS count FROM diagnostic_files AS attachment
      LEFT JOIN diagnostic_snapshots AS bundle ON bundle.record_key = attachment.bundle_id
      WHERE bundle.record_key IS NULL
        OR attachment.record_key IS NOT (attachment.bundle_id || ':' || attachment.artifact_id)
        OR attachment.bundle_id IS NOT json_extract(attachment.record_json, '$.bundleId')
        OR attachment.artifact_id IS NOT json_extract(attachment.record_json, '$.attachment.artifactId')
        OR attachment.digest IS NOT json_extract(attachment.record_json, '$.attachment.digest')
    `,
  },
  {
    name: "diagnostic-bundle-attachments-are-indexed",
    sql: `
      SELECT count(*) AS count FROM diagnostic_snapshots AS bundle
      WHERE json_array_length(bundle.record_json, '$.attachments')
        <> (SELECT count(*) FROM diagnostic_files AS attachment WHERE attachment.bundle_id = bundle.record_key)
    `,
  },
  {
    name: "evidence-receipt-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_receipts WHERE record_key IS NOT json_extract(record_json, '$.receiptId') OR run_id IS NOT json_extract(record_json, '$.runId') OR workflow IS NOT json_extract(record_json, '$.workflowId') OR attempt IS NOT json_extract(record_json, '$.attempt') OR result IS NOT json_extract(record_json, '$.result') OR confidence IS NOT json_extract(record_json, '$.confidence') OR failure_id IS NOT json_extract(record_json, '$.failure.value')",
  },
  {
    name: "dry-run-scenario-result-columns-match-record",
    sql: "SELECT count(*) AS count FROM dryrun_results WHERE record_key IS NOT json_extract(record_json, '$.resultId') OR scenario_id IS NOT json_extract(record_json, '$.scenarioId') OR workflow IS NOT json_extract(record_json, '$.workflow') OR subject_label IS NOT json_extract(record_json, '$.subjectLabel') OR manifest_digest IS NOT json_extract(record_json, '$.manifestDigest') OR verdict IS NOT json_extract(record_json, '$.verdict') OR execution_state IS NOT json_extract(record_json, '$.execution.state') OR run_id IS NOT json_extract(record_json, '$.execution.runId') OR trace_id IS NOT json_extract(record_json, '$.execution.traceId') OR wall_time_ms IS NOT json_extract(record_json, '$.wallTimeMs') OR created_at IS NOT json_extract(record_json, '$.recordedAt')",
  },
  {
    name: "operator-xlsx-export-columns-match-record",
    sql: "SELECT count(*) AS count FROM operator_xlsx_exports WHERE record_key IS NOT json_extract(record_json, '$.exportId') OR selection_kind IS NOT json_extract(record_json, '$.selection.kind') OR artifact_id IS NOT json_extract(record_json, '$.artifact.id') OR digest IS NOT json_extract(record_json, '$.download.sha256') OR byte_length IS NOT json_extract(record_json, '$.download.byteLength') OR media_type IS NOT json_extract(record_json, '$.download.mediaType') OR filename IS NOT json_extract(record_json, '$.download.filename') OR created_at IS NOT json_extract(record_json, '$.createdAt') OR CASE json_extract(record_json, '$.workbookVersion') WHEN 1 THEN requested_by IS NOT NULL OR json_type(record_json, '$.requestedBy') IS NOT NULL WHEN 2 THEN requested_by IS NULL OR requested_by IS NOT json_extract(record_json, '$.requestedBy') ELSE 1 END",
  },
  {
    name: "activity-person-pseudonym-columns-match-record",
    sql: "SELECT count(*) AS count FROM activity_person_pseudonyms WHERE record_key IS NOT (run_id || ':' || key_generation) OR run_id IS NOT json_extract(record_json, '$.runId') OR workflow IS NOT json_extract(record_json, '$.workflowId') OR key_generation IS NOT json_extract(record_json, '$.keyGeneration') OR pseudonym IS NOT json_extract(record_json, '$.pseudonym') OR derivation IS NOT json_extract(record_json, '$.derivation')",
  },
  {
    name: "activity-person-pseudonym-generation-columns-match-record",
    sql: "SELECT count(*) AS count FROM activity_person_pseudonym_generations WHERE record_key IS NOT key_generation OR key_generation IS NOT json_extract(record_json, '$.keyGeneration') OR key_commitment IS NOT json_extract(record_json, '$.keyCommitment') OR derivation IS NOT json_extract(record_json, '$.derivation')",
  },
  {
    name: "activity-person-pseudonym-generation-binds-evidence",
    sql: "SELECT count(*) AS count FROM activity_person_pseudonyms AS evidence LEFT JOIN activity_person_pseudonym_generations AS generation ON generation.key_generation = evidence.key_generation WHERE generation.key_generation IS NULL",
  },
  {
    name: "activity-person-pseudonym-binds-run",
    sql: "SELECT count(*) AS count FROM activity_person_pseudonyms AS evidence LEFT JOIN workflow_runs AS run ON run.record_key = evidence.run_id WHERE run.record_key IS NULL OR evidence.workflow IS NOT json_extract(run.record_json, '$.envelope.workflow')",
  },
  {
    name: "started-dry-run-scenario-result-binds-run",
    sql: `
      SELECT count(*) AS count FROM dryrun_results AS result
      LEFT JOIN workflow_runs AS run ON run.record_key = result.run_id
      WHERE result.execution_state = 'started' AND (
        run.record_key IS NULL
        OR result.workflow IS NOT run.workflow
        OR result.trace_id IS NOT json_extract(run.record_json, '$.envelope.traceId')
        -- D318: a live-read result cites an ordinary run (dryRun 0); a preview
        -- result, and every pre-D318 row (no arm), cites a dry run (dryRun 1).
        OR json_extract(run.record_json, '$.envelope.dryRun') IS NOT (
          CASE WHEN json_extract(result.record_json, '$.execution.arm') = 'live-read' THEN 0 ELSE 1 END
        )
      )
    `,
  },
  {
    name: "knowledge-and-fix-columns-match-record",
    sql: `
      SELECT (
        SELECT count(*) FROM knowledge_records
        WHERE record_key IS NOT json_extract(record_json, '$.id') OR status IS NOT json_extract(record_json, '$.status')
      ) + (
        SELECT count(*) FROM fix_records
        WHERE record_key IS NOT json_extract(record_json, '$.id')
          OR status IS NOT json_extract(record_json, '$.status')
          OR failure_fingerprint IS NOT json_extract(record_json, '$.failureFingerprint')
      ) AS count
    `,
  },





  {
    name: "attempting-write-has-current-attempt",
    sql: `
      SELECT count(*) AS count FROM run_operations AS intent
      WHERE intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM run_operation_attempts AS attempt
        WHERE attempt.record_key = json_extract(intent.record_json, '$.currentAttemptId')
          AND attempt.write_intent_id = intent.record_key
          AND attempt.generation = json_extract(intent.record_json, '$.generation')
      )
    `,
  },
] as const);

function invariantViolations(database: DatabaseSync): readonly string[] {
  const violations = INVARIANT_QUERIES.flatMap(({ name, sql }) => {
    const { count } = CountRowSchema.parse(database.prepare(sql).get());
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
  return [...violations, ...commandGroupLinkViolations(database), ...archiveTransactionIntegrityViolations(database)];
}

/** Frozen transaction presentation is authenticated independently of original archive bytes. */
function archiveTransactionIntegrityViolations(database: DatabaseSync): readonly string[] {
  for (const value of database.prepare("SELECT record_key,record_json,transactions_json,transactions_digest FROM archived_runs").all()) {
    try {
      const row = z.strictObject({ record_key: z.string(), record_json: z.string(), transactions_json: z.string(), transactions_digest: z.string() }).parse(value);
      const archive = ArchivedRunRecordSchema.parse(JSON.parse(row.record_json));
      const section = ArchivedTransactionsSchema.parse(JSON.parse(row.transactions_json));
      if (sha256Hex(row.transactions_json) !== row.transactions_digest || section.runId !== row.record_key || section.contentDigest !== archive.contentDigest) return ["archive-transactions-integrity-mismatch"];
    } catch { return ["archive-transactions-integrity-mismatch"]; }
  }
  return [];
}

/** Validate both declared links and missing links from each immutable parent selection. */
function commandGroupLinkViolations(database: DatabaseSync): readonly string[] {
  const rowSchema = z.strictObject({ record_key: z.string(), record_json: z.string(), parent_command_id: z.string().nullable() });
  const rows = database.prepare("SELECT record_key, record_json, parent_command_id FROM commands ORDER BY record_key").all()
    .map((row) => rowSchema.parse(row));
  const byId = new Map(rows.map((row) => [row.record_key, row]));
  const expected = new Map<string, string>();
  for (const row of rows) {
    const raw: unknown = JSON.parse(row.record_json);
    if (typeof raw !== "object" || raw === null || !("kind" in raw) || raw.kind !== "bulk-parent") continue;
    const parent = BulkParentCommandRecordSchema.parse(raw);
    for (const target of parent.acceptance.request.targets) {
      const child = deriveBulkChildCommand(parent.acceptance.request, target);
      const saved = byId.get(child.commandId);
      if (saved === undefined) continue;
      if (expected.has(child.commandId) && expected.get(child.commandId) !== parent.commandId) return ["command-group ambiguous child ownership"];
      if (canonicalJsonStringify(JSON.parse(saved.record_json) as unknown) !== canonicalJsonStringify(child)) return ["command-group child request mismatch"];
      expected.set(child.commandId, parent.commandId);
    }
  }
  return rows.flatMap((row) => row.parent_command_id === (expected.get(row.record_key) ?? null)
    ? [] : ["command-group child linkage mismatch"]);
}

const HISTORICAL_COMPLETION_INVARIANT_QUERIES = [
  {
    name: "terminal-authorization-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_authorizations WHERE record_key IS NOT json_extract(record_json, '$.runId') OR kind IS NOT json_extract(record_json, '$.kind') OR expected_version IS NOT json_extract(record_json, '$.expectedVersion') OR worker_id IS NOT json_extract(record_json, '$.claim.workerId') OR claim_generation IS NOT json_extract(record_json, '$.claim.claimGeneration') OR created_at IS NOT json_extract(record_json, '$.authorizedAt')",
  },
  {
    name: "failed-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM workflow_runs AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM run_terminal_authorizations AS authorization
          WHERE authorization.record_key = run.record_key
            AND authorization.kind = 'failed'
            AND json_extract(authorization.record_json, '$.failureId')
              = json_extract(run.record_json, '$.lifecycle.failureId')
        )
    `,
  },
  {
    name: "failures-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = failure.run_id
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'failed'
        OR json_extract(authorization.record_json, '$.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "run-terminal-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_outbox WHERE run_id <> json_extract(record_json, '$.payload.runId') OR state <> json_extract(record_json, '$.projection.state')",
  },
  {
    name: "run-terminal-outbox-binds-result",
    sql: `
      SELECT count(*) AS count FROM run_terminal_outbox AS outbox
      LEFT JOIN run_results AS result ON result.record_key = outbox.run_id
      WHERE result.record_key IS NULL
        OR json_extract(outbox.record_json, '$.payload.workflowId') IS NOT json_extract(result.record_json, '$.workflowId')
        OR json_extract(outbox.record_json, '$.payload.attempt') IS NOT json_extract(result.record_json, '$.attempt')
        OR json_extract(outbox.record_json, '$.payload.resultDigest') IS NOT result.result_digest
    `,
  },
  {
    name: "done-runs-bind-result-and-outbox",
    sql: `
      SELECT count(*) AS count FROM workflow_runs AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'done'
        AND NOT EXISTS (
          SELECT 1 FROM run_results AS result
          JOIN run_terminal_outbox AS outbox ON outbox.run_id = result.record_key
          WHERE result.record_key = run.record_key
            AND json_extract(outbox.record_json, '$.payload.resultDigest') = result.result_digest
        )
    `,
  },
  {
    name: "done-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM workflow_runs AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'done'
        AND NOT EXISTS (
          SELECT 1 FROM run_terminal_authorizations AS authorization
          WHERE authorization.record_key = run.record_key
            AND authorization.kind = 'done'
        )
    `,
  },
  {
    name: "results-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = result.record_key
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'done'
        OR json_extract(authorization.record_json, '$.resultDigest') IS NOT result.result_digest
    `,
  },
  {
    name: "terminal-outbox-binds-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM run_terminal_outbox AS outbox
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = outbox.run_id
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'done'
        OR json_extract(authorization.record_json, '$.outboxId') IS NOT outbox.record_key
    `,
  },
  {
    name: "terminal-authorization-binds-exact-terminal-authority",
    sql: `
      SELECT count(*) AS count FROM run_terminal_authorizations AS authorization
      LEFT JOIN workflow_runs AS run ON run.record_key = authorization.record_key
      LEFT JOIN run_failures AS failure
        ON failure.run_id = authorization.record_key
          AND failure.record_key = json_extract(authorization.record_json, '$.failureId')
      LEFT JOIN run_results AS result ON result.record_key = authorization.record_key
      LEFT JOIN run_terminal_outbox AS outbox
        ON outbox.run_id = authorization.record_key
          AND outbox.record_key = json_extract(authorization.record_json, '$.outboxId')
      WHERE run.record_key IS NULL
        OR authorization.created_at IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR json_extract(authorization.record_json, '$.workflowId')
          IS NOT json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(authorization.record_json, '$.attempt')
          IS NOT json_extract(run.record_json, '$.envelope.attempt')
        OR json_extract(authorization.record_json, '$.descriptorVersion')
          IS NOT json_extract(run.record_json, '$.envelope.descriptorVersion')
        OR json_extract(authorization.record_json, '$.contractFingerprint')
          IS NOT json_extract(run.record_json, '$.envelope.contractFingerprint')
        OR run.version < authorization.expected_version + 1
        OR run.claim_generation IS NOT authorization.claim_generation
        OR json_extract(run.record_json, '$.lifecycle.state') IS NOT 'terminal'
        OR json_extract(run.record_json, '$.lifecycle.endedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR (run.version = authorization.expected_version + 1 AND json_extract(run.record_json, '$.updatedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt'))
        OR (authorization.kind = 'failed' AND (
          json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'failed'
          OR json_extract(run.record_json, '$.lifecycle.failureId')
            IS NOT json_extract(authorization.record_json, '$.failureId')
          OR failure.record_key IS NULL
          OR json_extract(run.record_json, '$.lifecycle.errorSummary')
            IS NOT json_extract(failure.record_json, '$.summary')
        ))
        OR (authorization.kind = 'done' AND (
          json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'done'
          OR result.record_key IS NULL
          OR json_extract(authorization.record_json, '$.resultDigest') IS NOT result.result_digest
          OR outbox.record_key IS NULL
        ))
    `,
  },
] as const;

const RETIRED_HISTORY_INVARIANT_QUERIES = [
  {
    // Ref write-safety §6: sequences are dense from zero inside a partition, so
    // `nextSeq` is the count. A gap here means a lost or rewritten entry.
    name: "ledger-partition-sequence-is-dense",
    sql: `
      SELECT count(*) AS count FROM ledger_partitions AS partition
      WHERE partition.next_seq <> (
        SELECT count(*) FROM ledger_projections AS projection
        WHERE projection.partition_key = partition.record_key
      )
      OR partition.next_seq <> COALESCE((
        SELECT max(projection.seq) + 1 FROM ledger_projections AS projection
        WHERE projection.partition_key = partition.record_key
      ), 0)
    `,
  },

  {
    name: "durable-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM operation_outbox WHERE write_intent_id <> json_extract(record_json, '$.aggregate.writeIntentId') OR generation <> json_extract(record_json, '$.aggregate.generation') OR kind <> json_extract(record_json, '$.payload.kind')",
  },
  {
    name: "ledger-partition-columns-match-record",
    sql: "SELECT count(*) AS count FROM ledger_partitions WHERE record_key IS NOT (system || ':' || ledger_date) OR system IS NOT json_extract(record_json, '$.system') OR ledger_date IS NOT json_extract(record_json, '$.date') OR next_seq IS NOT json_extract(record_json, '$.nextSeq') OR lease_holder IS NOT json_extract(record_json, '$.lease.holder') OR lease_expires_at IS NOT json_extract(record_json, '$.lease.expiresAt') OR lease_generation IS NOT json_extract(record_json, '$.leaseGeneration') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "ledger-projection-columns-match-record",
    sql: "SELECT count(*) AS count FROM ledger_projections WHERE record_key IS NOT json_extract(record_json, '$.outboxId') OR partition_key IS NOT (system || ':' || ledger_date) OR system IS NOT json_extract(record_json, '$.system') OR ledger_date IS NOT json_extract(record_json, '$.date') OR seq IS NOT json_extract(record_json, '$.seq') OR state IS NOT json_extract(record_json, '$.lifecycle.state') OR line_digest IS NOT json_extract(record_json, '$.lineDigest') OR assigned_at IS NOT json_extract(record_json, '$.assignedAt') OR appended_at IS NOT json_extract(record_json, '$.lifecycle.appendedAt')",
  },
  {
    name: "ledger-projection-binds-a-ledger-outbox",
    sql: `
      SELECT count(*) AS count FROM ledger_projections AS projection
      LEFT JOIN operation_outbox AS outbox ON outbox.record_key = projection.record_key
      WHERE outbox.record_key IS NULL OR outbox.kind IS NOT 'ledger-entry'
    `,
  },
  {
    name: "projected-ledger-outbox-has-an-appended-line",
    sql: `
      SELECT count(*) AS count FROM operation_outbox AS outbox
      LEFT JOIN ledger_projections AS projection ON projection.record_key = outbox.record_key
      WHERE outbox.kind = 'ledger-entry'
        AND json_extract(outbox.record_json, '$.projection.state') = 'projected'
        AND (projection.record_key IS NULL
          OR projection.state IS NOT 'appended'
          OR projection.line_digest IS NOT json_extract(outbox.record_json, '$.projection.projectionFingerprint'))
    `,
  },
] as const;

const historicalInvariantQueries = new Map<number, readonly { name: string; sql: string }[]>();
/** Historical backups retain every invariant executable in their released DDL.
 * Compile against an empty immutable replay, never against operator state; only
 * absent future tables/columns can omit a query. Runtime current checks are unchanged. */
export function inspectHistoricalAuthorityInvariants(database: DatabaseSync, version: number): void {
  let queries = historicalInvariantQueries.get(version);
  if (queries === undefined) {
    const reference = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.version <= version)) for (const statement of migration.statements) reference.exec(statement);
      const taskColumns = new Set(reference.prepare(`PRAGMA table_info(${version < 33 ? "tasks" : "workflow_runs"})`).all().map((row) => row.name));
      queries = [...INVARIANT_QUERIES.filter((entry) => !entry.name.startsWith("run-completion-")), ...RETIRED_HISTORY_INVARIANT_QUERIES, ...HISTORICAL_COMPLETION_INVARIANT_QUERIES].flatMap((entry) => {
        let sql: string = version < 33
          ? entry.sql.replaceAll("workflow_runs", "tasks").replaceAll("workflow_run_batches", "run_sessions")
          : entry.sql;
        if (version < 35) {
          sql = sql.replaceAll("workflow_workers", "leases")
            .replaceAll("worker_auth", "duo_ceremony_leases")
            .replaceAll("workflow_run_requests", "start_plans");
        }
        if (version < 36) {
          sql = sql.replaceAll("run_operations", "write_intents")
            .replaceAll("run_operation_attempts", "write_attempts")
            .replaceAll("operation_outbox", "durable_outbox");
        }
        if (version < 37) {
          sql = sql.replaceAll("delegation_dependencies", "dependencies").replaceAll("run_delegations", "delegation_manifests");
          if (entry.name === "bulk-parent-columns-match-record") sql = "SELECT count(*) AS count FROM bulk_command_acceptances WHERE record_key <> json_extract(record_json, '$.bulkCommandId') OR request_fingerprint <> json_extract(record_json, '$.requestFingerprint') OR created_at <> json_extract(record_json, '$.request.requestedAt')";
        }
        if (version < 41) sql = sql.replaceAll("run_failures", "failures");
        if (version < 39) {
          for (const [old, current] of Object.entries(DATABASE_TABLE_RENAMES)) sql = sql.replaceAll(current, old);
        }
        if (entry.name === "run-columns-match-record") {
          if (!taskColumns.has("run_number")) sql = sql.replace(" OR run_number IS NOT json_extract(record_json, '$.runNumber')", "");
          if (!taskColumns.has("session_id")) sql = sql.replace(" OR session_id IS NOT json_extract(record_json, '$.sessionId')", "");
        }
        let prepared: ReturnType<DatabaseSync["prepare"]> | undefined;
        try { prepared = reference.prepare(sql); }
        catch (error) {
          if (!(error instanceof Error) || !/^no such (?:table|column): /u.test(error.message)) throw error;
        }
        return prepared === undefined ? [] : [{ name: entry.name, sql }];
      });
      historicalInvariantQueries.set(version, queries);
    } finally { reference.close(); }
  }
  for (const query of queries) {
    const { count } = CountRowSchema.parse(database.prepare(query.sql).get());
    if (count !== 0) throw new Error(`authority-invariant-invalid: ${query.name} (${String(count)} rows)`);
  }
}

/** Exact retained ownership, including retries whose shared evidence outlives its source run. */
function runDeletionEvidence(database: DatabaseSync, deleting: RunRecord) {
  const { runId, workflow, itemId } = deleting.envelope;
  const eligibleOwner = (ownerId: string): boolean => {
    const retained = readTimelineRun(database, ownerId);
    if (retained !== undefined) {
      if (retained.envelope.workflow !== workflow || retained.envelope.itemId !== itemId) throw new Error("run-delete-evidence-owner-mismatch");
      return ownerId === runId;
    }
    const raw = database.prepare("SELECT record_json FROM deleted_runs WHERE record_key = ?").get(ownerId);
    if (raw === undefined) throw new Error("run-delete-evidence-owner-missing");
    const tombstone = parseJsonRecord(DeletedRunRecordSchema, JsonRowSchema.parse(raw).record_json);
    if (tombstone.workflow !== workflow || tombstone.itemId !== itemId) throw new Error("run-delete-evidence-tombstone-mismatch");
    return true;
  };
  // Checkpoints and permanent operation keys are read by workflow/item, before
  // a queued retry materializes an explicit evidence reference. Tombstones do
  // not retain retryOf, so a direct lineage edge cannot protect a later retry.
  // Keep this exact evidence group while any other retained run can read it.
  const retainedPeers = database.prepare(`SELECT record_key, record_json FROM workflow_runs
    WHERE workflow = ? AND item_id = ? AND record_key <> ?`).all(workflow, itemId, runId);
  for (const raw of retainedPeers) {
    const row = AuthorityRecordFingerprintRowSchema.parse(raw);
    const peer = parseJsonRecord(RunRecordSchema, row.record_json);
    if (peer.envelope.runId !== row.record_key || peer.envelope.workflow !== workflow || peer.envelope.itemId !== itemId) {
      throw new Error("run-delete-peer-identity-mismatch");
    }
  }
  const retainedItemPeer = retainedPeers.length > 0;
  const referenced = (ownerId: string): boolean => {
    return retainedItemPeer || database.prepare(`SELECT 1 FROM timeline_events WHERE run_id <> ?
      AND json_extract(record_json, '$.payload.checkpoint.runId') = ? LIMIT 1`).get(runId, ownerId) !== undefined
      || database.prepare(`SELECT 1 FROM run_results, json_each(run_results.record_json, '$.dependencies') AS dependency
        WHERE run_results.record_key <> ? AND json_extract(dependency.value, '$.checkpoint.runId') = ? LIMIT 1`).get(runId, ownerId) !== undefined
      || database.prepare(`SELECT 1 FROM workflow_runs WHERE record_key <> ?
        AND json_extract(record_json, '$.envelope.retryOf') = ? LIMIT 1`).get(runId, ownerId) !== undefined;
  };
  const checkpointKeys: string[] = [];
  for (const raw of database.prepare("SELECT record_key, record_json FROM run_checkpoints WHERE (workflow = ? AND item_id = ?) OR run_id = ?").all(workflow, itemId, runId)) {
    const row = AuthorityRecordFingerprintRowSchema.parse(raw);
    const checkpoint = parseJsonRecord(RunCheckpointRecordSchema, row.record_json);
    if (checkpoint.workflowId !== workflow || checkpoint.itemId !== itemId) throw new Error("run-delete-checkpoint-column-mismatch");
    if (eligibleOwner(checkpoint.runId) && !referenced(checkpoint.runId)) checkpointKeys.push(row.record_key);
  }
  const operationIds: string[] = [];
  for (const raw of database.prepare(`SELECT record_json FROM run_operations
    WHERE (json_extract(record_json, '$.workflowId') = ? AND json_extract(record_json, '$.itemId') = ?)
      OR json_extract(record_json, '$.runId') = ?
      OR record_key IN (SELECT write_intent_id FROM run_operation_attempts WHERE json_extract(record_json, '$.runId') = ?)
    `).all(workflow, itemId, runId, runId)) {
    const operation = parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(raw).record_json);
    if (operation.workflowId !== workflow || operation.itemId !== itemId) throw new Error("run-delete-operation-column-mismatch");
    if (operation.status === "observed-present") continue;
    const owners = new Set([operation.runId]);
    let currentAttemptFound = false;
    for (const row of database.prepare("SELECT record_json FROM run_operation_attempts WHERE write_intent_id = ?").all(operation.writeIntentId)) {
      const attempt = parseJsonRecord(WriteAttemptRecordSchema, JsonRowSchema.parse(row).record_json);
      if (attempt.writeIntentId !== operation.writeIntentId) throw new Error("run-delete-attempt-column-mismatch");
      if (attempt.writeAttemptId === operation.currentAttemptId) {
        if (attempt.runId !== operation.runId || attempt.generation !== operation.generation
          || attempt.runAttempt !== operation.runAttempt) throw new Error("run-delete-current-attempt-mismatch");
        currentAttemptFound = true;
      }
      owners.add(attempt.runId);
    }
    if (!currentAttemptFound) throw new Error("run-delete-current-attempt-missing");
    // Evaluate every owner even after a retained peer is found: corruption is
    // never hidden by short-circuiting to a plausible shared group.
    const ownership = [...owners].map((owner) => ({ eligible: eligibleOwner(owner), referenced: referenced(owner) }));
    if (ownership.every((owner) => owner.eligible && !owner.referenced)) operationIds.push(operation.writeIntentId);
  }
  return { checkpointKeys, operationIds };
}

function readTimelineRun(database: DatabaseSync, runId: string): RunRecord | undefined {
  const row = database.prepare("SELECT record_json FROM workflow_runs WHERE record_key = ?").get(runId);
  return row === undefined ? undefined : parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
}

function timelineEvidenceRepositories(database: DatabaseSync) {
  return {
    writeAttempts: { get(id: string) {
      const row = database.prepare("SELECT record_json FROM run_operation_attempts WHERE record_key = ?").get(id);
      return row === undefined ? undefined : parseJsonRecord(WriteAttemptRecordSchema, JsonRowSchema.parse(row).record_json);
    } },
    runCheckpoints: { get(workflow: string, itemId: string, nodeId: string, attempt: number, claimGeneration?: number) {
      const key = checkpointLookupKey(workflow, itemId, nodeId, attempt, claimGeneration);
      const row = database.prepare("SELECT record_json FROM run_checkpoints WHERE record_key = ?").get(key);
      return row === undefined ? undefined : parseJsonRecord(RunCheckpointRecordSchema, JsonRowSchema.parse(row).record_json);
    } },
  };
}

/** Authenticate even retry-shared sources whose original run timeline was deleted. */
function readHistoricalOperationSource(database: DatabaseSync, json: string): HistoricalOperationSource {
  const source = parseJsonRecord(HistoricalOperationSourceSchema, json);
  if (source.ledgerOutbox.payload.kind !== "ledger-entry" || source.spanOutbox.payload.kind !== "write-committed-span") throw new Error("historical-source-kind-mismatch");
  const ledger = source.ledgerOutbox.payload.entry;
  const span = source.spanOutbox.payload;
  const evidence = timelineEvidenceRepositories(database);
  const eventId = lifecycleCommandId("timeline-operation-confirmed", { writeIntentId: source.operationId, generation: source.generation });
  const rawEvent = database.prepare("SELECT * FROM timeline_events WHERE record_key = ?").get(eventId);
  const attempts = database.prepare("SELECT record_json FROM run_operation_attempts WHERE write_intent_id = ? AND generation = ?")
    .all(source.operationId, source.generation).map((row) => parseJsonRecord(WriteAttemptRecordSchema, JsonRowSchema.parse(row).record_json));
  const attempt = attempts[0];
  if (attempts.length !== 1 || attempt === undefined) throw new Error("historical-source-attempt-mismatch");
  let event;
  if (rawEvent !== undefined) event = timelineEventFromRow(rawEvent);
  else {
    const checkpoints = database.prepare("SELECT record_json FROM run_checkpoints WHERE run_id = ?").all(source.runId)
      .map((row) => parseJsonRecord(RunCheckpointRecordSchema, JsonRowSchema.parse(row).record_json))
      .filter((row) => row.workflowId === ledger.workflowId && row.itemId === ledger.itemId && row.attempt === ledger.attempt
        && row.writtenAt === ledger.confirmedAt && canonicalJsonStringify(row.output.value) === canonicalJsonStringify(span.outcome));
    const checkpoint = checkpoints[0];
    if (checkpoints.length !== 1 || checkpoint === undefined) throw new Error("historical-source-checkpoint-mismatch");
    event = confirmedOperationTimeline({ ledger, span, checkpoint, writeAttemptId: attempt.writeAttemptId, recordedAt: ledger.confirmedAt });
  }
  const restored = reconstructConfirmedOperation(evidence, event);
  if (canonicalJsonStringify(restored.ledger) !== canonicalJsonStringify(ledger)
    || canonicalJsonStringify(restored.span) !== canonicalJsonStringify(span)) throw new Error("historical-source-settlement-disagreement");
  return source;
}

function assertTimelineOwner(database: DatabaseSync, record: TimelineAppend, appending = false): void {
    if (record.scope.kind === "worker") return;
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
      if ((appending ? record.payload.attempt !== run.envelope.attempt : record.payload.attempt > run.envelope.attempt)
        || (appending && record.payload.kind === "checkpoint-replayed" && Number(record.payload.claimGeneration) !== Number(run.claimGeneration))
        || reference.itemId !== run.envelope.itemId
        || checkpoint === undefined
        || canonicalJsonStringify(timelineCheckpointReference(checkpoint)) !== canonicalJsonStringify(reference)) {
        throw new Error("timeline-checkpoint-reference-mismatch");
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


function validateAuthorityRecordSchemas(database: DatabaseSync, presentTables?: ReadonlySet<string>): number {
  let validated = 0;
  for (const [table, schema] of Object.entries({ ...AUTHORITY_RECORD_SCHEMA_REGISTRY,
    ...(readIntPragma(database, "user_version") < 39 ? {
      authority_upgrades: AUTHORITY_RECORD_SCHEMA_REGISTRY.database_upgrades,
      diagnostic_bundles: AUTHORITY_RECORD_SCHEMA_REGISTRY.diagnostic_snapshots,
      diagnostic_attachments: AUTHORITY_RECORD_SCHEMA_REGISTRY.diagnostic_files,
      evidence_receipts: AUTHORITY_RECORD_SCHEMA_REGISTRY.run_receipts,
      config_snapshots: AUTHORITY_RECORD_SCHEMA_REGISTRY.settings_snapshots,
      dry_run_scenario_results: AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results,
    } : {}),
    ...(presentTables?.has("operation_outbox") === true ? { operation_outbox: AtomicOutboxRecordSchema } : {}),
    ...(presentTables?.has("ledger_partitions") === true ? { ledger_partitions: LedgerPartitionRecordSchema, ledger_projections: LedgerProjectionRecordSchema } : {}),
    ...(presentTables?.has("leases") === true ? { leases: WorkerLeaseRecordSchema } : {}),
    ...(presentTables?.has("duo_ceremony_leases") === true ? { duo_ceremony_leases: DuoCeremonyLeaseRecordSchema } : {}),
    ...(presentTables?.has("start_plans") === true ? { start_plans: StartPlanRecordSchema } : {}),
    ...(presentTables?.has("write_intents") === true ? { write_intents: WriteIntentRecordSchema, write_attempts: WriteAttemptRecordSchema, durable_outbox: AtomicOutboxRecordSchema } : {}),
    ...(presentTables?.has("dependencies") === true ? { dependencies: DependencyRecordSchema } : {}),
    ...(presentTables?.has("delegation_manifests") === true ? { delegation_manifests: DelegationManifestSchema } : {}),
    ...(presentTables?.has("bulk_command_acceptances") === true ? {
      bulk_command_acceptances: BulkRunCommandAcceptanceRecordSchema,
    } : {}),
    ...(readIntPragma(database, "user_version") < 37 ? { commands: z.union([AuthorityCommandRecordSchema, PreFloorCommandSchema, HistoricalProtectedSettingsCommandSchema]) } : {}),
    ...(presentTables?.has("tasks") === true ? { tasks: RunRecordSchema } : {}),
    ...(presentTables?.has("run_sessions") === true ? { run_sessions: HistoricalRunSessionRecordSchema } : {}),
    ...(presentTables?.has("protected_settings_current") === true
      ? { settings_current: HistoricalSettingsCurrentRecordSchema, protected_settings_current: ProtectedSettingsCurrentRecordSchema } : {}),
  })) {
    if (presentTables !== undefined && !presentTables.has(table)) continue;
    const rows = database.prepare(`
      SELECT record_key, record_json FROM ${table} ORDER BY record_key
    `).iterate();
    for (const rawRow of rows) {
      const row = AuthorityRecordFingerprintRowSchema.parse(rawRow);
      try {
        if (table === "timeline_events") {
          const event = timelineEventFromRow(database.prepare("SELECT * FROM timeline_events WHERE record_key = ?").get(row.record_key));
          assertTimelineOwner(database, event);
        } else if (table === "timeline_operation_sources") readHistoricalOperationSource(database, row.record_json);
        else parseJsonRecord(schema, row.record_json);
      } catch (error) {
        throw new Error(
          `authority table ${table} record ${row.record_key} failed strict record schema validation: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      validated += 1;
    }
  }
  return validated;
}

function authorityContentFingerprint(database: DatabaseSync): string {
  const hash = createHash("sha256");
  hash.update("[");
  for (const [tableIndex, name] of AuthorityTableNameSchema.options.entries()) {
    if (tableIndex > 0) hash.update(",");
    hash.update(`[${canonicalJsonStringify(name)},`);
    if (name === "database_state") {
      const row = AuthorityMetaFingerprintRowSchema.parse(database.prepare(`
        SELECT singleton_id, schema_version, authority_generation, updated_at,
               migration_owner, migration_started_at
        FROM database_state WHERE singleton_id = 1
      `).get());
      hash.update(canonicalJsonStringify(row));
    } else {
      hash.update("[");
      let rowIndex = 0;
      const schema = name === "commands" ? AuthorityRecordFingerprintRowSchema.extend({ parent_command_id: z.string().nullable() }) : name === "archived_runs" ? AuthorityRecordFingerprintRowSchema.extend({ transactions_json: z.string().nullable(), transactions_digest: z.string().nullable() }) : AuthorityRecordFingerprintRowSchema;
      for (const rawRow of database.prepare(`
        SELECT record_key, record_json${name === "commands" ? ", parent_command_id" : name === "archived_runs" ? ", transactions_json, transactions_digest" : ""} FROM ${name} ORDER BY record_key
      `).iterate()) {
        const row = schema.parse(rawRow);
        if (rowIndex > 0) hash.update(",");
        hash.update(canonicalJsonStringify(row));
        rowIndex += 1;
      }
      hash.update("]");
    }
    hash.update("]");
  }
  hash.update("]");
  return hash.digest("hex");
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE command.family <> 'bulk-parent' AND NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM run_operations WHERE status NOT IN ('committed', 'observed-present')"),
    leases: count("SELECT count(*) AS count FROM workflow_workers"),
    providerReservations: count("SELECT count(*) AS count FROM provider_admissions WHERE state = 'reserved'"),
    artifactOutbox: count("SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
  };
}

function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean): AuthorityCopyInspection {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if (schemaVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
  const names = tableNames(database);
  const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = readMetaRow(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  if (meta.migration_owner !== null || meta.migration_started_at !== null) {
    throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
  }
  validateAuthorityRecordSchemas(database);
  const violations = invariantViolations(database);
  if (violations.length > 0) throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
  return AuthorityCopyInspectionSchema.parse({
    applicationId,
    schemaVersion,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    authorityContentFingerprint: authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    counts: pendingCounts(database),
  });
}

/** Internal stopped-upgrade barrier; never exported through the repository entrypoint. */
export function inspectConvertedAuthority(database: DatabaseSync): void {
  inspectOpenDatabase(database, false);
}

function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number): AuthorityCopyInspection {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const database = new DatabaseSync(parsedPath, {
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
    if (transactionOpen) database.exec("ROLLBACK");
    database.close();
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
  const database = new DatabaseSync(parsedPath, {
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
    if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`,
      );
    }
    const names = tableNames(database);
    const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
    if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
      throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
    }
    const meta = readMetaRow(database);
    const snapshot = Object.freeze({
      authorityGeneration: meta.authority_generation,
      authorityContentFingerprint: FingerprintSchema.parse(authorityContentFingerprint(database)),
    });
    readWithinSnapshot?.(database);
    database.exec("COMMIT");
    transactionOpen = false;
    return snapshot;
  } finally {
    if (transactionOpen) database.exec("ROLLBACK");
    database.close();
  }
}

function mismatchSummary(
  field: string,
  spanValue: unknown,
  authorityValue: unknown,
  table: "workflow_runs" | "archived_runs",
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
    mismatchSummary("runId", root.runId, envelope.runId, "workflow_runs"),
    mismatchSummary("workflow", root.workflow, envelope.workflow, "workflow_runs"),
    mismatchSummary("itemId", root.itemId, envelope.itemId, "workflow_runs"),
    mismatchSummary("traceId", root.traceId, envelope.traceId, "workflow_runs"),
    mismatchSummary("finalAttempt", root.finalAttempt, envelope.attempt, "workflow_runs"),
    mismatchSummary("parentRunId", root.parentRunId ?? null, envelope.parent?.runId ?? null, "workflow_runs"),
    mismatchSummary("shape", root.shape, envelope.shape, "workflow_runs"),
    mismatchSummary("priority", root.priority, envelope.priority, "workflow_runs"),
    mismatchSummary("dryRun", root.dryRun, envelope.dryRun, "workflow_runs"),
    mismatchSummary("retryOf", root.retryOf ?? null, envelope.retryOf ?? null, "workflow_runs"),
    mismatchSummary("descriptorVersion", root.descriptorVersion, envelope.descriptorVersion, "workflow_runs"),
    mismatchSummary("contractFingerprint", root.contractFingerprint, envelope.contractFingerprint, "workflow_runs"),
    mismatchSummary("resolvedInstance", root.resolvedInstance, envelope.resolvedInstance, "workflow_runs"),
    mismatchSummary("configFingerprint", root.configFingerprint, envelope.configFingerprint, "workflow_runs"),
    mismatchSummary("configSnapshotId", root.configSnapshotId, envelope.configSnapshotId, "workflow_runs"),
    mismatchSummary("queuedAt", root.queuedAt, envelope.enqueuedAt, "workflow_runs"),
  ].filter((issue): issue is string => issue !== undefined);
}

function archivedSurfaceKind(root: SpanAuthorityRunRoot): "single" | "preview" | "member" | "operation" {
  if (root.shape === "operation-member") return "member";
  return root.shape;
}

function archivedSpanRootMismatches(
  root: SpanAuthorityRunRoot,
  archived: ArchivedRunStorageRecord,
): readonly string[] {
  const lineageParent = archived.row.lineage.state === "child"
    ? archived.row.lineage.parentRunId
    : null;
  return [
    mismatchSummary("runId", root.runId, archived.runId, "archived_runs"),
    mismatchSummary("workflow", root.workflow, archived.workflowId, "archived_runs"),
    mismatchSummary("itemId", root.itemId, archived.row.itemId, "archived_runs"),
    mismatchSummary("traceId", root.traceId, archived.traceId, "archived_runs"),
    mismatchSummary("finalAttempt", root.finalAttempt, archived.row.attempt, "archived_runs"),
    mismatchSummary("parentRunId", root.parentRunId ?? null, lineageParent, "archived_runs"),
    mismatchSummary("shape", archivedSurfaceKind(root), archived.row.surfaceKind, "archived_runs"),
    mismatchSummary("priority", root.priority, archived.row.priority, "archived_runs"),
    mismatchSummary("dryRun", root.dryRun, archived.row.dryRun, "archived_runs"),
    mismatchSummary("descriptorVersion", root.descriptorVersion, archived.row.descriptorVersion, "archived_runs"),
    mismatchSummary("contractFingerprint", root.contractFingerprint, archived.row.descriptorHash, "archived_runs"),
    mismatchSummary(
      "resolvedInstance",
      Object.entries(root.resolvedInstance).map(([system, instance]) => ({ system, instance })),
      archived.row.resolvedInstances,
      "archived_runs",
    ),
    mismatchSummary("configFingerprint", root.configFingerprint, archived.row.configFingerprint, "archived_runs"),
    mismatchSummary("queuedAt", root.queuedAt, archived.row.startedAt, "archived_runs"),
  ].filter((issue): issue is string => issue !== undefined);
}

type TerminalRunLifecycle = Extract<RunRecord["lifecycle"], { state: "terminal" }>;

function retainedArchiveMismatchSummary(
  retainedField: string,
  retainedValue: unknown,
  archivedField: string,
  archivedValue: unknown,
): string | undefined {
  const retainedJson = canonicalJsonStringify(retainedValue);
  const archivedJson = canonicalJsonStringify(archivedValue);
  return retainedJson === archivedJson
    ? undefined
    : `retained workflow_runs ${retainedField} ${retainedJson} does not match archived_runs ${archivedField} ${archivedJson}`;
}

function archivedFailureIdentityMismatch(
  field: string,
  failureValue: unknown,
  retainedField: string,
  retainedValue: unknown,
  archiveField: string,
  archiveValue: unknown,
): string | undefined {
  const failureJson = canonicalJsonStringify(failureValue);
  const retainedJson = canonicalJsonStringify(retainedValue);
  const archiveJson = canonicalJsonStringify(archiveValue);
  return failureJson === retainedJson && failureJson === archiveJson
    ? undefined
    : `archived failure.${field} ${failureJson} does not match retained workflow_runs ${retainedField} ${retainedJson} `
      + `and archive ${archiveField} ${archiveJson}`;
}

function terminalArchiveStatus(outcome: TerminalRunLifecycle["outcome"]): "done" | "failed" | "cancelled" | "blocked" {
  switch (outcome) {
    case "done": return "done";
    case "failed": return "failed";
    case "cancelled":
    case "discarded":
    case "superseded": return "cancelled";
    case "interrupted": return "blocked";
  }
}

function terminalArchiveDetailOutcome(
  lifecycle: TerminalRunLifecycle,
  dryRun: boolean,
): unknown {
  if (lifecycle.outcome === "interrupted") {
    return { state: "absent", reason: "run interrupted; ref write-safety recovery will requeue or settle it" };
  }
  const result = lifecycle.outcome === "done"
    ? dryRun ? "partial" : "verified-done"
    : lifecycle.outcome === "failed"
      ? "failed"
      : "cancelled";
  return {
    state: "terminal",
    result,
    completedAt: lifecycle.endedAt,
    ...(lifecycle.outcome === "done" && dryRun ? { rehearsal: true } : {}),
  };
}

function archivedTerminalMismatches(
  run: RunRecord,
  lifecycle: TerminalRunLifecycle,
  archived: ArchivedRunStorageRecord,
): readonly string[] {
  const expectedStatus = terminalArchiveStatus(lifecycle.outcome);
  const archivedFailureId = archived.failure.state === "present"
    ? archived.failure.value.failureId
    : null;
  const archivedFailureIdentityMismatches = archived.failure.state === "present"
    ? [archivedFailureIdentityMismatch(
      "runId",
      archived.failure.value.runId,
      "envelope.runId",
      run.envelope.runId,
      "runId",
      archived.runId,
    ), archivedFailureIdentityMismatch(
      "traceId",
      archived.failure.value.traceId,
      "envelope.traceId",
      run.envelope.traceId,
      "traceId",
      archived.traceId,
    ), archivedFailureIdentityMismatch(
      "attempt",
      archived.failure.value.attempt,
      "envelope.attempt",
      run.envelope.attempt,
      "row.attempt",
      archived.row.attempt,
    ), archivedFailureIdentityMismatch(
      "workflowId",
      archived.failure.value.workflowId,
      "envelope.workflow",
      run.envelope.workflow,
      "workflowId",
      archived.workflowId,
    )]
    : [];
  return [
    retainedArchiveMismatchSummary("terminal status", expectedStatus, "row.status", archived.row.status),
    retainedArchiveMismatchSummary(
      "terminal detail header status",
      expectedStatus,
      "detail.header.status",
      archived.detail.header.status,
    ),
    retainedArchiveMismatchSummary(
      "terminal row endedAt",
      { state: "present", value: lifecycle.endedAt },
      "row.endedAt",
      archived.row.endedAt,
    ),
    retainedArchiveMismatchSummary(
      "terminal detail outcome",
      terminalArchiveDetailOutcome(lifecycle, run.envelope.dryRun),
      "detail.outcome",
      archived.detail.outcome,
    ),
    retainedArchiveMismatchSummary(
      "terminal failureId",
      lifecycle.failureId ?? null,
      "failure.failureId",
      archivedFailureId,
    ),
    ...archivedFailureIdentityMismatches,
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

function inspectSpanRunAuthorityReadOnly(
  path: string,
  rootsInput: readonly SpanAuthorityRunRoot[],
  busyTimeoutMs: number,
): SpanAuthorityReadSnapshot {
  const parsedPath = z.string().min(1).parse(path);
  const roots = z.array(SpanAuthorityRunRootSchema).readonly().parse(rootsInput);
  const rootIssues = structuralSpanRootIssues(roots);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const database = new DatabaseSync(parsedPath, {
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
    if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(
        `authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`,
      );
    }
    const names = tableNames(database);
    const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
    if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
      throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
    }
    const meta = readMetaRow(database);
    const authorityFingerprint = authorityContentFingerprint(database);
    const liveRunCount = CountRowSchema.parse(database.prepare("SELECT count(*) AS count FROM workflow_runs").get()).count;
    const archivedRunCount = CountRowSchema.parse(database.prepare("SELECT count(*) AS count FROM archived_runs").get()).count;
    const archivedRunById = database.prepare("SELECT record_json FROM archived_runs WHERE record_key = ?");
    const taskById = database.prepare("SELECT record_json FROM workflow_runs WHERE record_key = ?");
    // D308: the delete cascade removes the `workflow_runs` row (and any `archived_runs`
    // row) but writes ONE tombstone first, and span files are never rewritten
    // (D301). So a root with neither authority row is not yet missing — the
    // tombstone is consulted, in this same read transaction, before absence.
    const deletedRunById = database.prepare("SELECT record_json FROM deleted_runs WHERE record_key = ?");
    // Reverse reconciliation shares this exact read transaction/fingerprint with
    // the forward root lookup. Malformed rows never become absence facts.
    const queuedRunIds = new Set(roots.map(({ runId }) => runId));
    const missingSpanRunIds: RunId[] = [];
    const malformedRecords: Array<z.input<typeof SpanAuthorityReadSnapshotSchema>["malformedRecords"][number]> = [];
    for (const [table, source] of [["workflow_runs", "current"], ["archived_runs", "archived"]] as const) {
      for (const raw of database.prepare(`SELECT record_key, record_json FROM ${table} ORDER BY record_key`).iterate()) {
        const row = AuthorityRecordFingerprintRowSchema.parse(raw);
        const parsedKey = RunIdSchema.safeParse(row.record_key);
        const recordKey = parsedKey.success
          ? parsedKey.data
          : `sha256:${createHash("sha256").update(row.record_key).digest("hex")}`;
        const malformed = (summary: string): void => {
          malformedRecords.push({ state: "malformed-authority", source, recordKey, summary });
        };
        let decoded: unknown;
        try {
          decoded = JSON.parse(row.record_json);
        } catch {
          malformed(`${table} record is not valid JSON`);
          continue;
        }
        const parsed = table === "workflow_runs"
          ? RunRecordSchema.safeParse(decoded)
          : ArchivedRunStorageRecordSchema.safeParse(decoded);
        if (!parsed.success) {
          malformed(`${table} record failed its strict authority schema`);
          continue;
        }
        const runId = "envelope" in parsed.data ? parsed.data.envelope.runId : parsed.data.runId;
        if (runId !== row.record_key) {
          malformed(`${table} record key does not equal its stored run identity`);
          continue;
        }
        if (table === "workflow_runs" && !queuedRunIds.has(runId) && archivedRunById.get(runId) === undefined) {
          missingSpanRunIds.push(runId);
        }
      }
    }
    const resolutions = roots.map((root, index): SpanAuthorityRunResolution => {
      const structuralIssues = rootIssues[index];
      if (structuralIssues === undefined) throw new Error(`span authority root ${String(index)} lost its structural issue bucket`);
      if (structuralIssues.length > 0) {
        return SpanAuthorityRunResolutionSchema.parse({
          state: "malformed",
          runId: root.runId,
          table: "span_stream",
          summary: structuralIssues.join("; "),
        });
      }
      const archivedRow = archivedRunById.get(root.runId);
      const taskRow = taskById.get(root.runId);
      if (archivedRow !== undefined) {
        if (taskRow === undefined) {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "archived_runs",
            summary: "archived_runs authority is missing its required retained workflow_runs authority",
          });
        }
        let retainedRun: RunRecord;
        try {
          retainedRun = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(taskRow).record_json);
          if (retainedRun.envelope.runId !== root.runId) {
            throw new Error(`retained task record names run ${retainedRun.envelope.runId}`);
          }
        } catch {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "workflow_runs",
            summary: "archived_runs authority has retained workflow_runs authority that failed strict record or identity validation",
          });
        }
        const retainedMismatches = liveSpanRootMismatches(root, retainedRun);
        if (retainedMismatches.length > 0) {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "archived_runs",
            summary: "archived_runs authority's required retained workflow_runs tuple contradicts the span root: "
              + retainedMismatches.join("; "),
          });
        }
        if (retainedRun.lifecycle.state !== "terminal") {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "archived_runs",
            summary: "archived_runs authority requires terminal retained workflow_runs authority; retained lifecycle is "
              + retainedRun.lifecycle.state,
          });
        }
        try {
          const archived = parseJsonRecord(ArchivedRunStorageRecordSchema, JsonRowSchema.parse(archivedRow).record_json);
          if (archived.runId !== root.runId) throw new Error(`archived record names run ${archived.runId}`);
          const mismatches = [
            ...archivedSpanRootMismatches(root, archived),
            ...archivedTerminalMismatches(retainedRun, retainedRun.lifecycle, archived),
          ];
          if (mismatches.length > 0) {
            return SpanAuthorityRunResolutionSchema.parse({
              state: "malformed",
              runId: root.runId,
              table: "archived_runs",
              summary: "retained workflow_runs authority matches the span root but archived_runs authority contradicts it: "
                + mismatches.join("; "),
            });
          }
          return SpanAuthorityRunResolutionSchema.parse({
            state: "archived",
            runId: root.runId,
            archivedAt: archived.archivedAt,
          });
        } catch {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "archived_runs",
            summary: "retained workflow_runs authority is valid but archived_runs authority failed strict record or identity validation",
          });
        }
      }
      if (taskRow === undefined) {
        const deletedRow = deletedRunById.get(root.runId);
        if (deletedRow === undefined) {
          return SpanAuthorityRunResolutionSchema.parse({ state: "missing", runId: root.runId, ...(root.possibleExternalWrite === true ? { possibleExternalWrite: true } : {}) });
        }
        let tombstone: DeletedRunRecord;
        try {
          tombstone = parseJsonRecord(DeletedRunRecordSchema, JsonRowSchema.parse(deletedRow).record_json);
          if (tombstone.runId !== root.runId) throw new Error(`tombstone names run ${tombstone.runId}`);
        } catch {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "deleted_runs",
            summary: "deleted_runs tombstone failed its strict record or identity validation",
          });
        }
        // A tombstone that disagrees with the root it would account for is a
        // contradiction, never a `deleted` verdict: name the field.
        const tombstoneMismatches = [
          tombstone.workflow === root.workflow ? undefined : "workflow",
          tombstone.traceId === root.traceId ? undefined : "traceId",
        ].filter((field): field is string => field !== undefined);
        if (tombstoneMismatches.length > 0) {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "deleted_runs",
            summary: `deleted_runs tombstone contradicts the span root: ${tombstoneMismatches.join(", ")}`,
          });
        }
        return SpanAuthorityRunResolutionSchema.parse({
          state: "deleted",
          runId: root.runId,
          workflow: tombstone.workflow,
          traceId: tombstone.traceId,
          origin: tombstone.origin,
          commandId: tombstone.commandId,
          deletedAt: tombstone.deletedAt,
        });
      }
      try {
        const run = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(taskRow).record_json);
        if (run.envelope.runId !== root.runId) throw new Error(`task record names run ${run.envelope.runId}`);
        const mismatches = liveSpanRootMismatches(root, run);
        if (mismatches.length > 0) {
          return SpanAuthorityRunResolutionSchema.parse({
            state: "malformed",
            runId: root.runId,
            table: "workflow_runs",
            summary: mismatches.join("; "),
          });
        }
        return SpanAuthorityRunResolutionSchema.parse({ state: "live", runId: root.runId });
      } catch {
        return SpanAuthorityRunResolutionSchema.parse({
          state: "malformed",
          runId: root.runId,
          table: "workflow_runs",
          summary: "workflow_runs authority failed its strict record or identity validation",
        });
      }
    });
    const tombstoneOrdinalFindings = database.prepare("SELECT record_key, record_json FROM deleted_runs ORDER BY record_key").all().flatMap((row) => {
      // A malformed row already has an explicit span-resolution diagnosis.
      if (resolutions.some((resolution) => resolution.state === "malformed" && resolution.table === "deleted_runs" && resolution.runId === row.record_key)) return [];
      const record = parseJsonRecord(DeletedRunRecordSchema, AuthorityRecordFingerprintRowSchema.parse(row).record_json);
      if (record.runId !== row.record_key) throw new Error("deleted_runs tombstone identity mismatch");
      const missingFields = (["itemId", "attempt", "runNumber"] as const).filter((field) => record[field] === null);
      return missingFields.length === 0 ? [] : [{ code: "tombstone-ordinal-unknown" as const, runId: record.runId, missingFields }];
    });
    const snapshot = SpanAuthorityReadSnapshotSchema.parse({
      tombstoneOrdinalFindings: tombstoneOrdinalFindings,
      authorityGeneration: meta.authority_generation,
      authorityContentFingerprint: authorityFingerprint,
      liveRunCount,
      archivedRunCount,
      missingSpanRunIds: malformedRecords.length === 0 ? missingSpanRunIds : [],
      malformedRecords,
      resolutions,
    });
    database.exec("COMMIT");
    transactionOpen = false;
    return Object.freeze({
      ...snapshot,
      resolutions: Object.freeze(snapshot.resolutions),
      missingSpanRunIds: Object.freeze(snapshot.missingSpanRunIds),
      malformedRecords: Object.freeze(snapshot.malformedRecords),
    });
  } finally {
    if (transactionOpen) database.exec("ROLLBACK");
    database.close();
  }
}


export class AuthorityDatabase implements Disposable {
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #credentialCommandIds: (commandId: string) => boolean;
  #closed = false;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | "read" | undefined;
  #authorityDirty = false;
  #writeCommitHooks: AuthorityWriteCommitHooks | undefined;
  #terminalizationHooks: AuthorityTerminalizationHooks | undefined;
  #runSearchCorpusValidation: RunSearchCorpusValidation | undefined;

  #authorityCommitCallbacks: (() => void)[] = [];
  #lifecycleHooks: AuthorityLifecycleHooks | undefined;

  readonly authority: AuthorityRepositories;
  readonly projections: ProjectionRepositories;

  private constructor(
    input: unknown,
    clock: Clock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
    lifecycleHooks?: AuthorityLifecycleHooks,
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const existed = options.path !== ":memory:" && existsSync(options.path);
    const readOnlyNoMigrate = options.openMode !== "read-write";
    if (readOnlyNoMigrate && !existed) {
      throw new Error(`${options.openMode} requires an existing authority database`);
    }
    if (existed && statSync(options.path).size === 0) {
      throw new Error(`authority database ${options.path} exists but is empty; refusing to replace it`);
    }
    this.#clock = clock;
    this.#writeCommitHooks = writeCommitHooks;
    this.#terminalizationHooks = terminalizationHooks;
    this.#lifecycleHooks = lifecycleHooks;
    this.#path = options.path;
    this.#credentialCommandIds = options.path === ":memory:"
      ? () => { throw new Error("command identity admission requires a durable authority root"); }
      : createCredentialStore({ stateRoot: dirname(resolve(options.path)) }).ownsCommandId;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#database = new DatabaseSync(options.path, {
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

    try {
      const existingVersion = existed ? this.#admitExistingSchema() : undefined;
      if (!readOnlyNoMigrate
        && existingVersion !== undefined
        && requiresStoppedSystemAuthorityUpgrade(existingVersion)) {
        throw new Error(
          `upgrade-required { schemaVersion: ${String(existingVersion)}, floor: ${String(UPGRADE_FLOOR_SCHEMA_VERSION)} }`,
        );
      }
      if (readOnlyNoMigrate) {
        this.#configureReadOnlyConnection();
        this.#validateReadOnlyNoMigrateDatabase(existingVersion);
      } else {
        this.#configureConnection();
        this.#initializeSchema(existingVersion, options.migrationOwner);
        this.#validateDatabase();
      }
    } catch (error) {
      this.#database.close();
      throw new Error(`failed to open authority database ${options.path}: ${errorMessage(error)}`, { cause: error });
    }

    this.authority = this.#buildAuthorityRepositories();
    this.projections = this.#buildProjectionRepositories();
  }

  static open(
    input: unknown,
    clock: Clock = systemClock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
    lifecycleHooks?: AuthorityLifecycleHooks,
  ): AuthorityDatabase {
    return new AuthorityDatabase(input, clock, writeCommitHooks, terminalizationHooks, lifecycleHooks);
  }

  static sourceDatabaseIdentity(path: string): string {
    return createHash("sha256")
      .update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`)
      .digest("hex");
  }

  static inspectExistingReadOnly(path: string, busyTimeoutMs = 250): AuthorityCopyInspection {
    return inspectExistingDatabaseReadOnly(path, busyTimeoutMs);
  }

  /** Read-only D332 phase projection. No private journal fields escape this adapter. */
  readUpgradePhases() {
    return this.withAuthorityReadSnapshot(() => {
      if (this.getMeta().schemaVersion < 30) return { state: "absent" as const, reason: "pre-journal-schema" as const };
      const rows = this.#database.prepare(`SELECT phase, record_json FROM ${databaseUpgradesTable(this.getMeta().schemaVersion)} ORDER BY rowid`).all();
      const phases = rows.map((raw) => {
        const row = z.strictObject({ phase: z.string(), record_json: z.string() }).parse(raw);
        const record = AuthorityUpgradeRecordSchema.parse(JSON.parse(row.record_json));
        if (record.phase !== row.phase) throw new Error("authority upgrade phase differs from its record");
        return { phase: record.phase, fromSchemaVersion: record.fromSchemaVersion,
          toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt };
      });
      return phases.length === 0
        ? { state: "absent" as const, reason: "journal-empty" as const }
        : { state: "available" as const, phases };
    });
  }

  static inspectAuthorityReadIdentityReadOnly(
    path: string,
    busyTimeoutMs = 250,
  ): AuthorityReadIdentitySnapshot {
    return inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs);
  }

  static inspectSpanRunAuthorityReadOnly(
    path: string,
    roots: readonly SpanAuthorityRunRoot[],
    busyTimeoutMs = 250,
  ): SpanAuthorityReadSnapshot {
    return inspectSpanRunAuthorityReadOnly(path, roots, busyTimeoutMs);
  }

  /** Event evidence and its complete authority identity from one read-only snapshot. */
  static inspectTimelineReadOnly(path: string, busyTimeoutMs = 250, includeRecoveryEvidence = false) {
    let timeline: ReturnType<typeof readTimelineRecords> | undefined;
    let recoveryEvidence: Readonly<{
      runs: readonly Readonly<{ runId: RunRecord["envelope"]["runId"]; workflow: string; traceId: string; version: number;
        possibleExternalWrite: boolean; attemptIds: readonly string[]; confirmations: readonly string[] }>[];
      deleted: readonly DeletedRunRecord[];
    }> | undefined;
    const identity = inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs, (database) => {
      const repository = createTimelineRepository({ database, read: (work) => work(),
        mutate: () => { throw new Error("timeline-doctor-read-only"); }, assertOwner: () => {} });
      timeline = readTimelineRecords(repository);
      if (!includeRecoveryEvidence) return;
      const attempts = database.prepare("SELECT record_json FROM run_operation_attempts").all().map((row) =>
        parseJsonRecord(WriteAttemptRecordSchema, JsonRowSchema.parse(row).record_json));
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
      const runs = database.prepare("SELECT record_key, record_json FROM workflow_runs ORDER BY record_key").all().map((raw) => {
        const row = AuthorityRecordFingerprintRowSchema.parse(raw);
        const run = parseJsonRecord(RunRecordSchema, row.record_json);
        if (run.envelope.runId !== row.record_key) throw new Error("restore-evidence-run-identity-mismatch");
        const owned = attemptsByRun.get(run.envelope.runId) ?? [];
        return { runId: run.envelope.runId, workflow: run.envelope.workflow, traceId: run.envelope.traceId,
          version: run.version, possibleExternalWrite: owned.length > 0 || fenced.has(run.envelope.runId),
          attemptIds: owned.map((attempt) => attempt.writeAttemptId),
          confirmations: confirmationsByRun.get(run.envelope.runId) ?? [] };
      });
      const deleted = database.prepare("SELECT record_json FROM deleted_runs").all().map((row) =>
        parseJsonRecord(DeletedRunRecordSchema, JsonRowSchema.parse(row).record_json));
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
      authorityGeneration: row.authority_generation,
      updatedAt: row.updated_at,
    });
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
      tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    });
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
    for (const row of this.#database.prepare("SELECT record_json FROM commands WHERE family = 'bulk-parent'").all()) {
      const accepted = BulkParentCommandRecordSchema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)).acceptance;
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
    const row = this.#database.prepare("SELECT record_json FROM commands WHERE record_key = ?").get(record.commandId);
    if (row !== undefined && canonicalJsonStringify(JSON.parse(JsonRowSchema.parse(row).record_json) as unknown) !== canonicalJsonStringify(record)) {
      if ("family" in record && record.family === "settings") throw new CommandIdentityConflictError();
      throw new Error(`command id ${record.commandId} was reused with different content`);
    }
  }

  /** D330: queue-root publication belongs after the outermost authority commit. */
  afterAuthorityCommit(publish: () => void): void {
    if (this.#transactionDepth === 0) {
      publish();
      return;
    }
    if (this.#transactionMode !== "authority") throw new Error("authority publication requires an authority transaction");
    this.#authorityCommitCallbacks.push(publish);
  }

  /**
   * Issue the only D288 write capability. The public repository remains
   * read-only; this closure owns the authenticated HMAC domain and accepts
   * only run ids. Every source and replay check is repeated under the same
   * authority transaction as the batch insert.
   */
  createActivityPersonPseudonymBackfillWriteCapability(
    pseudonyms: ActivityPersonPseudonymDomain,
  ): ActivityPersonPseudonymBackfillWriteCapability {
    assertAuthenticActivityPersonPseudonymDomain(pseudonyms);
    const currentResultSchemaHash = deriveSchemaHash(
      CurrentSeparationsPseudonymSourceResultSchema,
      "output",
    );
    return Object.freeze({
      keyGeneration: pseudonyms.keyGeneration,
      reviewAndInsert: (runIdsInput: unknown) => {
        const runIds = ActivityPersonPseudonymRunSetSchema.parse(runIdsInput);
        return this.#authorityWrite("activity_person_pseudonyms", () => {
          const generationBinding = pseudonyms.generationBinding;
          const existingGenerationBinding = this.#readRecord(
            "activity_person_pseudonym_generations",
            generationBinding.keyGeneration,
            ActivityPersonPseudonymGenerationBindingSchema,
          );
          if (existingGenerationBinding !== undefined
            && canonicalJsonStringify(existingGenerationBinding)
              !== canonicalJsonStringify(generationBinding)) {
            throw new Error(
              `activity person pseudonym generation ${generationBinding.keyGeneration} `
              + "is already bound to different key material",
            );
          }
          const reviewed = runIds.map((runId): Readonly<{
            outcome: ActivityPersonPseudonymBackfillOutcome;
            evidence?: ActivityPersonPseudonymEvidence;
            existing?: ActivityPersonPseudonymEvidence;
          }> => {
            const unavailable = (
              reason: Extract<ActivityPersonPseudonymBackfillOutcome, { state: "unavailable" }>["reason"],
            ) => ({
              outcome: ActivityPersonPseudonymBackfillOutcomeSchema.parse({
                runId,
                state: "unavailable",
                reason,
              }),
            });
            const run = this.authority.runs.get(runId);
            if (run === undefined) return unavailable("run-not-found");
            if (run.envelope.runId !== runId) return unavailable("run-identity-mismatch");
            if (this.authority.archivedRuns.isArchived(runId)) return unavailable("run-archived");
            if (run.envelope.workflow !== "separations") {
              return unavailable("workflow-not-separations");
            }
            if (run.lifecycle.state !== "terminal") return unavailable("run-not-terminal");
            if (run.lifecycle.outcome !== "done") return unavailable("terminal-outcome-not-done");
            const result = this.authority.runResults.get(runId);
            if (result === undefined) return unavailable("run-result-missing");
            if (result.runId !== runId
              || result.workflowId !== run.envelope.workflow
              || result.attempt !== run.envelope.attempt
              || result.descriptorVersion !== run.envelope.descriptorVersion
              || result.contractFingerprint !== run.envelope.contractFingerprint
              || result.configFingerprint !== run.envelope.configFingerprint
              || result.configSnapshotId !== run.envelope.configSnapshotId) {
              return unavailable("run-result-identity-mismatch");
            }
            if (result.resultSchemaHash !== currentResultSchemaHash
              || result.result.schemaHash !== currentResultSchemaHash) {
              return unavailable("result-schema-not-current");
            }
            const approved = activityPseudonymObjectProperty(result.result.value, "approved");
            if (approved === undefined || approved === null) {
              return unavailable("canonical-subject-missing");
            }
            if (Array.isArray(approved)) return unavailable("canonical-subject-ambiguous");
            const subject = activityPseudonymObjectProperty(approved, "emplId");
            if (subject === undefined || subject === null) {
              return unavailable("canonical-subject-missing");
            }
            if (Array.isArray(subject)) return unavailable("canonical-subject-ambiguous");
            const parsed = CurrentSeparationsPseudonymSourceResultSchema.safeParse(result.result.value);
            if (!parsed.success) return unavailable("canonical-subject-malformed");
            const evidence = pseudonyms.deriveEvidence({
              runId,
              workflowId: run.envelope.workflow,
              canonicalSubject: parsed.data.approved.emplId,
            });
            const existing = this.#readRecord(
              "activity_person_pseudonyms",
              activityPersonPseudonymEvidenceKey(runId, pseudonyms.keyGeneration),
              ActivityPersonPseudonymEvidenceSchema,
            );
            if (existing !== undefined
              && canonicalJsonStringify(existing) !== canonicalJsonStringify(evidence)) {
              throw new Error(
                `activity person pseudonym evidence for run ${runId} generation `
                + `${pseudonyms.keyGeneration} already exists with different content`,
              );
            }
            return {
              outcome: ActivityPersonPseudonymBackfillOutcomeSchema.parse({
                runId,
                state: existing === undefined ? "inserted" : "existing",
                keyGeneration: pseudonyms.keyGeneration,
              }),
              evidence,
              existing,
            };
          });

          let changes = 0;
          if (existingGenerationBinding === undefined
            && reviewed.some(({ evidence }) => evidence !== undefined)) {
            const insertedBinding = this.#database.prepare(`
              INSERT INTO activity_person_pseudonym_generations
                (record_key, key_generation, key_commitment, derivation, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              generationBinding.keyGeneration,
              generationBinding.keyGeneration,
              generationBinding.keyCommitment,
              generationBinding.derivation,
              canonicalJsonStringify(generationBinding),
              this.#now(),
            );
            changes += sqliteChanges(insertedBinding.changes);
          }
          for (const candidate of reviewed) {
            if (candidate.evidence === undefined || candidate.existing !== undefined) continue;
            const evidence = candidate.evidence;
            const inserted = this.#database.prepare(`
              INSERT INTO activity_person_pseudonyms
                (record_key, run_id, workflow, key_generation, pseudonym, derivation, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              activityPersonPseudonymEvidenceKey(evidence.runId, evidence.keyGeneration),
              evidence.runId,
              evidence.workflowId,
              evidence.keyGeneration,
              evidence.pseudonym,
              evidence.derivation,
              canonicalJsonStringify(evidence),
              this.#now(),
            );
            changes += sqliteChanges(inserted.changes);
          }
          return {
            result: Object.freeze(reviewed.map(({ outcome }) => Object.freeze(outcome))),
            changes,
          };
        });
      },
    });
  }

  withAuthorityReadSnapshot<Result>(read: () => Result): Result {
    return this.#withReadSnapshot(read);
  }

  withProjectionTransaction<Result>(work: (repositories: ProjectionRepositories) => Result): Result {
    return this.#withTransaction("projection", () => work(this.projections));
  }

  terminalizeFailure(descriptor: AnyWorkflowDescriptor, input: unknown): FailureTerminalizationReport {
    const request = FailureTerminalizationRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.failure.runId);
      if (current === undefined) throw new Error(`run ${request.failure.runId} does not exist`);
      this.#assertFailureMatchesRun(request.failure, current, descriptor);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#completionAuthorization(current);
      const existing = this.#readRecord("run_failures", request.failure.failureId, FailureRecordSchema);
      if (existingAuthorization !== undefined || existing !== undefined) {
        if (existingAuthorization === undefined || existing === undefined) {
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
          run: current,
        });
      }
      if (current.lifecycle.state === "terminal") {
        throw new Error(`run ${request.failure.runId} is already terminal without failure ${request.failure.failureId}`);
      }
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
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterFailureStorageStep?.("run");
      return FailureTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        failure: request.failure,
        run: terminal,
      });
    });
  }

  terminalizeSuccess(input: unknown, factoryAuthorization?: object): SuccessTerminalizationReport {
    const replayInput = SuccessTerminalizationReplayInputSchema.parse(input);
    const historical = "outbox" in replayInput ? replayInput : undefined;
    const { outboxId: _outboxId, ...authorization } = historical === undefined
      ? { ...replayInput.authorization, outboxId: undefined } : historical.authorization;
    const request = SuccessTerminalizationRequestSchema.parse({ result: replayInput.result, authorization });
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
        if (historical !== undefined) {
          const evidence = current.completion?.historical;
          if (evidence === undefined || evidence.outboxJson === undefined
            || canonicalJsonStringify(historical.authorization) !== canonicalJsonStringify(HistoricalTerminalAuthorizationSchema.parse(JSON.parse(evidence.authorizationJson)))) {
            throw new Error("historical terminal replay authorization differs");
          }
          const receipt = HistoricalTerminalOutboxRecordSchema.parse(JSON.parse(evidence.outboxJson));
          if (canonicalJsonStringify(historical.outbox) !== canonicalJsonStringify({ ...receipt, projection: { state: "pending" } })) {
            throw new Error("historical terminal outbox replay differs");
          }
        } else if (current.completion?.historical !== undefined) {
          throw new Error("historical terminal replay requires its original request identity");
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
      if (historical !== undefined) throw new Error("historical terminal input is replay-only");
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

  commitWriteAttempt(input: unknown, checkpointInput: unknown): AtomicWriteCommitReport {
    const parsed = AtomicWriteCommitInputSchema.parse(input);
    const checkpoint = RunCheckpointRecordSchema.parse(checkpointInput);
    if (checkpoint.writtenAt !== parsed.confirmedAt
      || canonicalJsonStringify(checkpoint.output.value) !== canonicalJsonStringify(parsed.outcome)) {
      throw new Error("confirmed-history-checkpoint-outcome-mismatch");
    }
    return this.withAuthorityTransaction(() => {
      const currentIntent = this.#readRecord("run_operations", parsed.writeIntentId, WriteIntentRecordSchema);
      if (currentIntent === undefined) throw new Error(`write intent ${parsed.writeIntentId} does not exist`);
      if (currentIntent.status !== "attempting") {
        throw new Error(`write intent ${parsed.writeIntentId} is ${currentIntent.status}; only attempting may commit`);
      }
      if (currentIntent.generation !== parsed.generation) {
        throw new Error(`write intent ${parsed.writeIntentId} generation ${String(currentIntent.generation)} does not match commit generation ${String(parsed.generation)}`);
      }
      const currentAttempt = this.#readRecord("run_operation_attempts", currentIntent.currentAttemptId, WriteAttemptRecordSchema);
      if (currentAttempt === undefined) throw new Error(`current write attempt ${currentIntent.currentAttemptId} does not exist`);
      if (currentAttempt.outcome.state !== "attempting") {
        throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only attempting may commit`);
      }
      WriteFenceInputSchema.parse({ intent: currentIntent, attempt: currentAttempt });
      this.#assertAtomicCommitMatchesIntent(parsed, currentIntent);

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

      this.#replaceWriteIntent(committedIntent);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      this.#replaceWriteAttempt(committedAttempt);
      this.#writeCommitHooks?.afterStorageStep("attempt-state");
      this.authority.runCheckpoints.insert(checkpoint);
      this.#writeCommitHooks?.afterStorageStep("transaction-checkpoint");
      const history = confirmedOperationTimeline({ ledger: parsed.transaction,
        span: parsed.committedSpan, checkpoint, writeAttemptId: committedAttempt.writeAttemptId,
        recordedAt: this.#clock.now().toISOString() });
      const reconstructed = reconstructConfirmedOperation(this.authority, history);
      if (canonicalJsonStringify(reconstructed.ledger) !== canonicalJsonStringify(parsed.transaction)
        || canonicalJsonStringify(reconstructed.span) !== canonicalJsonStringify(parsed.committedSpan)) {
        throw new Error("confirmed-history-lossless-reconstruction-failed");
      }
      this.authority.timelineEvents.append(history);
      this.#writeCommitHooks?.afterStorageStep("timeline-event");

      return AtomicWriteCommitReportSchema.parse({
        state: "committed",
        intent: committedIntent,
        attempt: committedAttempt,
        transaction: parsed.transaction,
        committedSpan: parsed.committedSpan,
      });
    });
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

  #assertStoredTerminalDependencies(result: RunResultRecord, current: RunRecord): void {
    for (const dependency of result.dependencies) {
      if (dependency.state === "asserted") {
        // D307 — an assertion is durable as a MARKED checkpoint row: the exact
        // row must exist at the terminal attempt, carry the assertion marker
        // for the same step, and bind the same output schema and digest.
        const rows = this.#database.prepare(`
          SELECT record_json FROM run_checkpoints
          WHERE workflow = ? AND item_id = ? AND node_id = ? AND attempt = ? AND run_id = ?
        `).all(result.workflowId, current.envelope.itemId, dependency.nodeId, result.attempt, result.runId);
        const matching = rows.map((row) => RunCheckpointRecordSchema.parse(JSON.parse(z.strictObject({ record_json: z.string() }).parse(row).record_json)))
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
        /*
         * D214: an attempt can hold SEVERAL executions of one node, so "did this
         * node run at the terminal attempt" is a question about the whole
         * attempt and not about one key. A count is the only reading that stays
         * true once a gate resume can add a second row.
         */
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
        || deriveCheckpointProvenanceDigest(stored.provenance) !== dependency.provenanceDigest) {
        throw new Error(`terminal dependency ${dependency.nodeId} does not match its exact stored checkpoint`);
      }
    }
  }

  #completionAuthorization(run: RunRecord): TerminalAuthorizationRecord | undefined {
    if (run.completion === undefined) return undefined;
    const { schemaVersion: _version, historical: _history, ...settlement } = run.completion;
    return TerminalAuthorizationRecordSchema.parse({ ...settlement, runId: run.envelope.runId,
      workflowId: run.envelope.workflow, attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint });
  }

  #insertFailure(record: FailureRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_failures", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_failures (record_key, run_id, fingerprint, record_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.failureId, record.runId, record.fingerprint, json, record.occurredAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertRunResult(record: RunResultRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_results", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_results
          (record_key, workflow, attempt, result_digest, record_json, created_at)
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
  }

  #configureConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    // D308 — a deleted run's bytes leave the file, not just the b-tree: freed
    // pages are overwritten with zeros rather than kept until reuse.
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
    const applicationId = this.#readIntPragma("application_id");
    if (applicationId !== AUTHORITY_APPLICATION_ID) {
      throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
    }
    const userVersion = this.#readIntPragma("user_version");
    if (userVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`authority schema ${String(userVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    }
    if (userVersion < 1) throw new Error("existing authority database has no recognized schema version");
    const meta = this.#readMetaRow();
    if (meta.schema_version !== userVersion) {
      throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(userVersion)}`);
    }
    if (meta.migration_owner !== null || meta.migration_started_at !== null) {
      throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
    }
    if (userVersion > 18 && userVersion < 30) {
      const existingTables = this.#database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map((row) => TableNameRowSchema.parse(row).name);
      /*
       * D290 admits only the common integrated lineage: the exact table set a
       * database holds at each released version on THIS suffix. v27 is the
       * whole DDL before the phone-capture retirement; v28 is that set with
       * the capture tables dropped (D294). Later tables (D308's
       * `deleted_runs`) are absent from both. Any other set at these versions
       * is a divergent suffix and refuses below.
       */
      const integratedTables = userVersion === 27 || userVersion === 28 || userVersion === 29
        ? INTEGRATED_AUTHORITY_TABLES_BY_VERSION[userVersion]
        : undefined;
      const isExactIntegrated = integratedTables !== undefined
        && existingTables.length === integratedTables.length
        && existingTables.every((name, index) => name === integratedTables[index]);
      if (isExactIntegrated) return userVersion;
      const rows = this.#database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type IN ('table', 'index', 'trigger')
      `).all();
      const names = new Set(rows.map((row) => TableNameRowSchema.parse(row).name));
      const source = names.has("runtime_config")
        ? "DCC1"
        : names.has("explorer_edit_reviews")
          ? "DCC4"
          : names.has("operator_xlsx_exports")
            ? "DCR"
            : "unrecognized";
      throw new Error(
        `D290 divergent post-v18 migration suffix: ${source} v${String(userVersion)}; `
        + "automatic conversion is not authorized",
      );
    }
    return userVersion;
  }

  #initializeSchema(existingVersion: number | undefined, migrationOwner: string): void {
    if (existingVersion === undefined) {
      this.#runMigrations(0, migrationOwner);
      return;
    }
    if (existingVersion < CURRENT_AUTHORITY_SCHEMA_VERSION) {
      this.#runMigrations(existingVersion, migrationOwner);
    }
  }

  #runMigrations(fromVersion: number, migrationOwner: string): void {
    if (requiresStoppedSystemAuthorityUpgrade(fromVersion)) {
      throw new Error(
        `upgrade-required { schemaVersion: ${String(fromVersion)}, floor: ${String(UPGRADE_FLOOR_SCHEMA_VERSION)} }`,
      );
    }
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      const migrations = SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion);
      for (const migration of migrations) {
        for (const statement of migration.statements) this.#database.exec(statement);
        if (fromVersion === 0 && migration.version === CURRENT_AUTHORITY_SCHEMA_VERSION) {
          const baseline = AuthorityUpgradeRecordSchema.parse({
            recordKey: randomUUID(),
            upgradeId: "fresh",
            phase: "baseline",
            fromSchemaVersion: 0,
            toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
            by: LOCAL_OPERATOR_ACTOR_ID,
            recordedAt: this.#now(),
          });
          this.#database.prepare(`
            INSERT INTO database_upgrades (
              record_key, upgrade_id, phase, record_json, created_at
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            baseline.recordKey,
            baseline.upgradeId,
            baseline.phase,
            canonicalJsonStringify(baseline),
            baseline.recordedAt,
          );
        }
        if (migration.version === 1) {
          this.#database.prepare(`
            INSERT INTO authority_meta (
              singleton_id, schema_version, authority_generation, updated_at,
              migration_owner, migration_started_at
            ) VALUES (1, ?, 0, ?, ?, ?)
          `).run(migration.version, this.#now(), migrationOwner, this.#now());
        } else {
          this.#database.prepare(`
            UPDATE ${databaseStateTable(migration.version)}
            SET schema_version = ?, migration_owner = ?, migration_started_at = ?, updated_at = ?
            WHERE singleton_id = 1
          `).run(migration.version, migrationOwner, this.#now(), this.#now());
        }
        this.#database.exec(`PRAGMA user_version = ${String(migration.version)}`);
      }
      this.#database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
      this.#database.prepare(`
        UPDATE database_state
        SET migration_owner = NULL, migration_started_at = NULL, updated_at = ?
        WHERE singleton_id = 1
      `).run(this.#now());
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #validateReadOnlyNoMigrateDatabase(schemaVersion: number | undefined): void {
    if (schemaVersion === undefined) {
      throw new Error("read-only no-migrate admission requires an existing schema version");
    }
    QuickCheckRowSchema.parse(this.#database.prepare("PRAGMA quick_check(1)").get());
    const foreignKeyFailures = this.#database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(
        `authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`,
      );
    }
    const names = this.#database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => TableNameRowSchema.parse(row).name);
    const expected = schemaVersion === 27 || schemaVersion === 28 || schemaVersion === 29
      ? INTEGRATED_AUTHORITY_TABLES_BY_VERSION[schemaVersion]
      : schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION
        ? AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort()
        : POST_FLOOR_AUTHORITY_TABLES_BY_VERSION[schemaVersion];
    if (expected === undefined) throw new Error(`no released layout for authority schema ${String(schemaVersion)}`);
    if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
      throw new Error(
        `authority database tables do not match admitted v${String(schemaVersion)} registry: `
        + `actual=${names.join(",")} expected=${expected.join(",")}`,
      );
    }
    validateAuthorityRecordSchemas(this.#database, new Set(names));
    if (schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION) {
      inspectHistoricalAuthorityInvariants(this.#database, schemaVersion);
      return;
    }
    const violations = invariantViolations(this.#database);
    if (violations.length > 0) {
      throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
    }
    if (this.#readIntPragma("foreign_keys") !== 1) {
      throw new Error("authority database foreign keys are disabled");
    }
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

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) {
      if (this.#transactionMode === "read") {
        throw new Error(`${mode} mutation cannot run inside an authority read snapshot`);
      }
      if (this.#transactionMode === "projection" && mode === "authority") {
        throw new Error("authority mutation cannot run inside a projection transaction");
      }
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
        this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        this.#authorityDirty = dirtyBefore;
        this.#authorityCommitCallbacks.splice(callbacksBefore);
        throw error;
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;
    this.#transactionMode = mode;
    this.#authorityDirty = false;
    let result: Result;
    try {
      result = work();
      if (this.#authorityDirty) {
        const update = this.#database.prepare(`
          UPDATE database_state
          SET authority_generation = authority_generation + 1, updated_at = ?
          WHERE singleton_id = 1
        `).run(this.#now());
        if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation update did not affect the singleton metadata row");
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      this.#authorityCommitCallbacks.splice(0);
      throw error;
    } finally {
      this.#transactionDepth = 0;
      this.#transactionMode = undefined;
      this.#authorityDirty = false;
    }
    const publications = this.#authorityCommitCallbacks.splice(0);
    for (const publish of publications) publish();
    return result;
  }

  #withReadSnapshot<Result>(read: () => Result): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) return read();

    this.#database.exec("BEGIN");
    this.#transactionDepth = 1;
    this.#transactionMode = "read";
    this.#authorityDirty = false;
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
      this.#authorityDirty = false;
    }
  }

  #authorityWrite<Outcome extends Readonly<{ result: unknown; changes: number }>>(
    table: AuthorityTableName,
    operation: () => Outcome,
  ): Outcome["result"] {
    if (table === "database_state") throw new Error("database_state is mutated only by the generation and migration protocols");
    return this.#withTransaction("authority", () => {
      const outcome = operation();
      if (outcome.changes > 0) {
        this.#authorityDirty = true;
        this.#runSearchCorpusValidation = undefined;
      }
      return outcome.result;
    });
  }

  #projectionWrite<Result>(table: ProjectionTableName, operation: () => Result): Result {
    ProjectionTableNameSchema.parse(table);
    return this.#withTransaction("projection", operation);
  }

  #readRecord<Schema extends z.ZodType>(table: TableName, recordKey: string, schema: Schema): z.output<Schema> | undefined {
    const row = this.#database.prepare(`SELECT record_json FROM ${table} WHERE record_key = ?`).get(recordKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(schema, JsonRowSchema.parse(row).record_json);
  }

  /** New value-free seals cannot authenticate private input; compare the independent retained copy. */
  #verifyArchivedPrivateInput(record: ArchivedRunStorageRecord): ArchivedRunStorageRecord {
    const { contentDigest, ...content } = record;
    const bindings = retainedRunProtectedBindings({ envelope: { workflow: record.workflowId }, input: record.input });
    if (bindings.length === 0 || archivedRunContentDigest(content) !== contentDigest) return record;
    const retained = this.#readRunRow(record.runId);
    if (retained === undefined || retained.envelope.workflow !== record.workflowId
      || canonicalJsonStringify(retained.input) !== canonicalJsonStringify(record.input)) {
      throw new Error("archive private input integrity mismatch");
    }
    return record;
  }

  #readOperatorXlsxExport(exportId: string): OperatorXlsxExportEvidence | undefined {
    const row = this.#database.prepare(`
      SELECT record_key, selection_kind, artifact_id, digest, byte_length, media_type,
             filename, requested_by, record_json, created_at
      FROM operator_xlsx_exports WHERE record_key = ?
    `).get(OperatorXlsxExportIdSchema.parse(exportId));
    return row === undefined ? undefined : operatorXlsxEvidenceFromRow(row);
  }

  #insertSimpleRecord<Schema extends z.ZodType>(
    table: Exclude<AuthorityTableName, "database_state">,
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
      const result = this.#database.prepare(`
        INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
      `).run(recordKey, json, createdAt);
      return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
    });
  }

  #listFailures(sql: string, parameter: string): readonly FailureRecord[] {
    const rows = this.#database.prepare(sql).all(parameter);
    return Object.freeze(rows.map((row) => parseJsonRecord(
      FailureRecordSchema,
      JsonRowSchema.parse(row).record_json,
    )));
  }

  #buildDiagnosticBundleRepository(): AuthorityRepositories["diagnosticBundles"] {
    const readAttachments = (sql: string, parameter: string): readonly DiagnosticAttachmentStorageRecord[] => {
      const rows = this.#database.prepare(sql).all(parameter);
      return Object.freeze(rows.map((row) => parseJsonRecord(
        DiagnosticAttachmentStorageRecordSchema,
        JsonRowSchema.parse(row).record_json,
      )));
    };
    return Object.freeze({
      insert: (input: unknown) => {
        const record = DiagnosticBundleSchema.parse(input);
        const json = canonicalJsonStringify(record);
        return this.#authorityWrite("diagnostic_snapshots", () => {
          const existing = this.#readRecord("diagnostic_snapshots", record.bundleId, DiagnosticBundleSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`diagnostic bundle ${record.bundleId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          const result = this.#database.prepare(`
            INSERT INTO diagnostic_snapshots
              (record_key, run_id, origin_kind, failure_id, content_digest, retention_kind, purge_after, record_json, created_at)
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
                (record_key, bundle_id, artifact_id, kind, digest, sensitivity, record_json, created_at)
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
      },
      get: (bundleId: string) => this.#readRecord("diagnostic_snapshots", bundleId, DiagnosticBundleSchema),
      listByRun: (runId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM diagnostic_snapshots WHERE run_id = ? ORDER BY created_at, record_key
        `).all(RunIdSchema.parse(runId));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          DiagnosticBundleSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
      listAttachments: (bundleId: string) => readAttachments(
        "SELECT record_json FROM diagnostic_files WHERE bundle_id = ? ORDER BY record_key",
        DiagnosticBundleIdSchema.parse(bundleId),
      ),
      findByArtifact: (artifactId: string) => readAttachments(
        "SELECT record_json FROM diagnostic_files WHERE artifact_id = ? ORDER BY record_key",
        ArtifactIdSchema.parse(artifactId),
      ),
      listRetentionDue: (now: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM diagnostic_snapshots
          WHERE retention_kind = 'ordinary' AND purge_after <= ?
          ORDER BY purge_after, record_key
        `).all(IsoInstantSchema.parse(now));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          DiagnosticBundleSchema,
          JsonRowSchema.parse(row).record_json,
        )));
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
            "DELETE FROM diagnostic_files WHERE bundle_id = ?",
          ).run(key);
          const bundle = this.#database.prepare(
            "DELETE FROM diagnostic_snapshots WHERE record_key = ?",
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

  /**
   * The one authority repository whose rows are UPDATED. `fold` is a
   * read-modify-write inside the outer authority transaction, so two triggers
   * firing at once cannot both create the `(actor, dedupeFingerprint)` row —
   * the unique index and the transaction agree.
   */
  #buildNotificationRepository(): AuthorityRepositories["notifications"] {
    const write = (record: NotificationRecord, mode: "insert" | "update"): void => {
      const json = canonicalJsonStringify(record);
      const result = mode === "insert"
        ? this.#database.prepare(`
            INSERT INTO notifications
              (record_key, actor_id, dedupe_fingerprint, status, seen_count, version, record_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.notificationId, record.actorId, record.dedupeFingerprint,
            record.status, record.count, record.version, json, record.createdAt,
          )
        : this.#database.prepare(`
            UPDATE notifications
            SET status = ?, seen_count = ?, version = ?, record_json = ?
            WHERE record_key = ? AND version = ?
          `).run(
            record.status, record.count, record.version, json,
            record.notificationId, record.version - 1,
          );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`notification ${record.notificationId} ${mode} affected ${String(changes)} rows`);
    };
    const findByDedupe = (actorId: string, dedupeFingerprint: string): NotificationRecord | undefined => {
      const row = this.#database.prepare(`
        SELECT record_json FROM notifications WHERE actor_id = ? AND dedupe_fingerprint = ?
      `).get(ActorIdSchema.parse(actorId), FingerprintSchema.parse(dedupeFingerprint));
      if (row === undefined) return undefined;
      return parseJsonRecord(NotificationRecordSchema, JsonRowSchema.parse(row).record_json);
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
      get: (notificationId: string) => this.#readRecord("notifications", notificationId, NotificationRecordSchema),
      findByDedupe,
      listByActor: (actorId: string, status?: unknown) => {
        const rows = status === undefined
          ? this.#database.prepare(`
              SELECT record_json FROM notifications WHERE actor_id = ? ORDER BY created_at, record_key
            `).all(ActorIdSchema.parse(actorId))
          : this.#database.prepare(`
              SELECT record_json FROM notifications WHERE actor_id = ? AND status = ? ORDER BY created_at, record_key
            `).all(ActorIdSchema.parse(actorId), NotificationRecordSchema.shape.status.parse(status));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          NotificationRecordSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
    });
  }


  #buildAuthorityRepositories(): AuthorityRepositories {
    const opaque = (tableInput: z.input<typeof OpaqueAuthorityTableSchema>): ImmutableRepository<OpaqueAuthorityRecord> => {
      const table = OpaqueAuthorityTableSchema.parse(tableInput);
      return Object.freeze({
        insert: (input: unknown) => {
          const record = OpaqueAuthorityRecordSchema.parse(input);
          return this.#insertSimpleRecord(table, record.recordId, record, OpaqueAuthorityRecordSchema, record.createdAt);
        },
        get: (recordKey: string) => this.#readRecord(table, recordKey, OpaqueAuthorityRecordSchema),
      });
    };

    return Object.freeze({
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
          "SELECT record_json FROM run_failures WHERE run_id = ? ORDER BY created_at, record_key",
          RunIdSchema.parse(runId),
        ),
        listByFingerprint: (fingerprint: string) => this.#listFailures(
          "SELECT record_json FROM run_failures WHERE fingerprint = ? ORDER BY created_at, record_key",
          FailureFingerprintSchema.parse(fingerprint),
        ),
        countByFingerprint: (fingerprint: string) => CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM run_failures WHERE fingerprint = ?
        `).get(FailureFingerprintSchema.parse(fingerprint))).count,
      }),
      diagnosticBundles: this.#buildDiagnosticBundleRepository(),
      /**
       * Ref data-intake-and-edit-data §5's plan manifest (D159). Insert-only and byte-exact on replay:
       * a manifest proves which file and mapping produced which items, and a
       * run has already fanned out against it, so a differing rebuild is a
       * refusal rather than an overwrite.
       */
      /**
       * Ref data-intake-and-edit-data §2.2's in-progress session (2i-E1): created in `mapping` by the
       * upload route, mutated by the intake command arms under a version CAS.
       * The searchable columns move WITH the record on every update — a
       * column that lagged its own JSON would make "open session for this
       * file" a lie.
       */
      intakeSessions: Object.freeze({
        create: (input: unknown) => {
          const record = IntakeSessionSchema.parse(input);
          if (record.reservedManifestId === undefined) {
            throw new Error(
              `intake session ${record.intakeSessionId} cannot be created with reserved manifest id absent`,
            );
          }
          if (record.state !== "mapping" || record.version !== 1) {
            throw new Error(
              `intake session ${record.intakeSessionId} must be created in mapping state at version 1`,
            );
          }
          return this.#authorityWrite("intake_sessions", () => {
            this.#database.prepare(`
              INSERT INTO intake_sessions
                (record_key, workflow, source_sha256, state, record_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.intakeSessionId, record.workflow, record.artifact.sha256, record.state,
              canonicalJsonStringify(record), record.createdAt, record.updatedAt,
            );
            return { result: record, changes: 1 };
          });
        },
        get: (intakeSessionId: string) =>
          this.#readRecord("intake_sessions", intakeSessionId, IntakeSessionSchema),
        update: (input: unknown) => {
          const record = IntakeSessionSchema.parse(input);
          return this.#authorityWrite("intake_sessions", () => {
            const current = this.#readRecord(
              "intake_sessions",
              record.intakeSessionId,
              IntakeSessionSchema,
            );
            if (
              current !== undefined
              && current.reservedManifestId !== record.reservedManifestId
            ) {
              const currentReservation = current.reservedManifestId === undefined
                ? "absent"
                : current.reservedManifestId;
              const nextReservation = record.reservedManifestId === undefined
                ? "absent"
                : record.reservedManifestId;
              throw new Error(
                `intake session ${record.intakeSessionId} cannot change reserved manifest id from `
                + `${currentReservation} to ${nextReservation}`,
              );
            }
            const outcome = this.#database.prepare(`
              UPDATE intake_sessions SET record_json = ?, state = ?, updated_at = ?
              WHERE record_key = ? AND json_extract(record_json, '$.version') = ?
            `).run(
              canonicalJsonStringify(record), record.state, record.updatedAt,
              record.intakeSessionId, record.version - 1,
            );
            const changes = sqliteChanges(outcome.changes);
            if (changes !== 1) {
              throw new Error(
                `intake session ${record.intakeSessionId} update to version ${String(record.version)} `
                + `raced past its expected predecessor; ${String(changes)} rows changed`,
              );
            }
            return { result: record, changes: 1 };
          });
        },
        /** Open sessions for these exact bytes — a re-upload finds its session instead of forking one. */
        findActiveBySource: (sourceSha256: string) => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM intake_sessions
          WHERE source_sha256 = ? AND state IN ('mapping', 'validated')
          ORDER BY created_at, record_key
        `).all(sourceSha256).map((row) =>
          parseJsonRecord(IntakeSessionSchema, JsonRowSchema.parse(row).record_json))),
      }),
      intakeManifests: Object.freeze({
        insert: (input: unknown) => {
          const record = IntakePlanManifestSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("intake_manifests", () => {
            const existing = this.#readRecord("intake_manifests", record.manifestId, IntakePlanManifestSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`intake manifest ${record.manifestId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO intake_manifests
                (record_key, workflow, source_sha256, workflow_contract_fingerprint, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              record.manifestId, record.workflow, record.source.sha256,
              record.workflowContractFingerprint, json, record.createdAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (manifestId: string) => this.#readRecord("intake_manifests", manifestId, IntakePlanManifestSchema),
        /** "Has this exact file been run before" — a lookup, not a scan. */
        findBySource: (sourceSha256: string) => this.#database.prepare(`
          SELECT record_json FROM intake_manifests WHERE source_sha256 = ? ORDER BY created_at
        `).all(sourceSha256).map((row) =>
          parseJsonRecord(IntakePlanManifestSchema, JsonRowSchema.parse(row).record_json)),
      }),
      /**
       * Ref data-intake-and-edit-data §4.3's admitted page extraction (D159). One page, read once, for
       * one form: a second producer reading the same page is a REPLACEMENT a
       * human decides on, not a second row that silently doubles a person.
       */
      ocrExtractions: Object.freeze({
        insert: (input: unknown) => {
          const record = AdmittedExtractionSchema.parse(input);
          const key = `${record.sourceSha256}#${String(record.sourcePage)}#${record.formType}`;
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("ocr_extractions", () => {
            const existing = this.#readRecord("ocr_extractions", key, AdmittedExtractionSchema);
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
              INSERT INTO ocr_extractions
                (record_key, form_type, source_sha256, source_page, page_kind, page_fingerprint, source_kind, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              key, record.formType, record.sourceSha256, record.sourcePage,
              record.pageKind, record.pageFingerprint, record.source.kind, json, record.readAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (sourceSha256: string, sourcePage: number, formType: string) =>
          this.#readRecord("ocr_extractions", `${sourceSha256}#${String(sourcePage)}#${formType}`, AdmittedExtractionSchema),
        findByDocument: (sourceSha256: string) => this.#database.prepare(`
          SELECT record_json FROM ocr_extractions WHERE source_sha256 = ? ORDER BY source_page
        `).all(sourceSha256).map((row) =>
          parseJsonRecord(AdmittedExtractionSchema, JsonRowSchema.parse(row).record_json)),
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
                (record_key, run_id, workflow, attempt, result, confidence, failure_id, record_json, created_at)
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
          SELECT record_json FROM run_receipts WHERE run_id = ? ORDER BY record_key
        `).all(RunIdSchema.parse(runId)).map((row) =>
          parseJsonRecord(RunEvidenceReceiptSchema, JsonRowSchema.parse(row).record_json)),
        findByRun: (runId: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM run_receipts WHERE run_id = ?
          `).get(RunIdSchema.parse(runId));
          if (row === undefined) return undefined;
          return parseJsonRecord(RunEvidenceReceiptSchema, JsonRowSchema.parse(row).record_json);
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
              const run = this.#readRecord("workflow_runs", record.execution.runId, RunRecordSchema);
              // D318 — a live-read result binds to an ORDINARY run (dryRun
              // false); a preview result (and every pre-D318 row, which
              // carries no arm) binds to a dry run. Neither may cite the other.
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
                (record_key, scenario_id, workflow, subject_label, manifest_digest, verdict,
                 execution_state, run_id, trace_id, wall_time_ms, record_json, created_at)
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
          SELECT record_json FROM dryrun_results ORDER BY created_at, record_key
        `).all().map((row) =>
          parseJsonRecord(DryRunScenarioResultSchema, JsonRowSchema.parse(row).record_json))),
      }),
      operatorXlsxExports: Object.freeze({
        insert: (input: unknown) => {
          const record = OperatorXlsxExportEvidenceSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("operator_xlsx_exports", () => {
            const existing = this.#readOperatorXlsxExport(record.exportId);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`operator XLSX export ${record.exportId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const inserted = this.#database.prepare(`
              INSERT INTO operator_xlsx_exports
                (record_key, selection_kind, artifact_id, digest, byte_length, media_type, filename,
                 requested_by, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.exportId,
              record.selection.kind,
              record.artifact.id,
              record.download.sha256,
              record.download.byteLength,
              record.download.mediaType,
              record.download.filename,
              record.workbookVersion === 1 ? null : record.requestedBy,
              json,
              record.createdAt,
            );
            return {
              result: Object.freeze({ state: "inserted" as const, record }),
              changes: sqliteChanges(inserted.changes),
            };
          });
        },
        get: (exportId: string) => this.#readOperatorXlsxExport(exportId),
        listByArtifact: (artifactId: string) => {
          const selectedArtifactId = ArtifactIdSchema.parse(artifactId);
          const records = this.#database.prepare(`
            SELECT record_key, selection_kind, artifact_id, digest, byte_length, media_type,
                   filename, requested_by, record_json, created_at
            FROM operator_xlsx_exports ORDER BY created_at, record_key
          `).all().map(operatorXlsxEvidenceFromRow);
          return Object.freeze(records.filter((record) => record.artifact.id === selectedArtifactId));
        },
      }),
      activityPersonPseudonyms: Object.freeze({
        get: (runId: string, keyGeneration: string) => this.#readRecord(
          "activity_person_pseudonyms",
          activityPersonPseudonymEvidenceKey(runId, keyGeneration),
          ActivityPersonPseudonymEvidenceSchema,
        ),
        listByRun: (runId: string) => {
          const selectedRunId = RunIdSchema.parse(runId);
          const rows = this.#database.prepare(`
            SELECT record_json FROM activity_person_pseudonyms
            WHERE run_id = ? ORDER BY key_generation
          `).all(selectedRunId);
          return Object.freeze(rows.map((row) => parseJsonRecord(
            ActivityPersonPseudonymEvidenceSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
        listByRuns: (runIds: unknown) => {
          const selectedRunIds = ActivityPersonPseudonymRunSetSchema.parse(runIds);
          if (selectedRunIds.length === 0) return Object.freeze([]);
          const rows = this.#database.prepare(`
            SELECT record_json FROM activity_person_pseudonyms
            WHERE run_id IN (SELECT value FROM json_each(?))
            ORDER BY run_id, key_generation
          `).all(canonicalJsonStringify(selectedRunIds));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            ActivityPersonPseudonymEvidenceSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      knowledgeRecords: Object.freeze({
        insert: (input: unknown) => {
          const record = KnowledgeRecordSchema.parse(input);
          const createdAt = record.verifiedAt ?? this.#now();
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("knowledge_records", () => {
            const existing = this.#readRecord("knowledge_records", record.id, KnowledgeRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`knowledge record ${record.id} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO knowledge_records (record_key, status, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.id, record.status, json, createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (knowledgeId: string) => this.#readRecord("knowledge_records", knowledgeId, KnowledgeRecordSchema),
        list: () => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM knowledge_records ORDER BY created_at, record_key
          `).all();
          return Object.freeze(rows.map((row) => parseJsonRecord(
            KnowledgeRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
        listByStatus: (status: unknown) => {
          const parsed = KnowledgeRecordSchema.shape.status.parse(status);
          const rows = this.#database.prepare(`
            SELECT record_json FROM knowledge_records WHERE status = ? ORDER BY created_at, record_key
          `).all(parsed);
          return Object.freeze(rows.map((row) => parseJsonRecord(
            KnowledgeRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      fixRecords: Object.freeze({
        insert: (input: unknown) => {
          const record = FixRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("fix_records", () => {
            const existing = this.#readRecord("fix_records", record.id, FixRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`fix record ${record.id} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO fix_records (record_key, status, failure_fingerprint, record_json, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(record.id, record.status, record.failureFingerprint ?? null, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (fixId: string) => this.#readRecord("fix_records", fixId, FixRecordSchema),
        list: () => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM fix_records ORDER BY created_at, record_key
          `).all();
          return Object.freeze(rows.map((row) => parseJsonRecord(
            FixRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
        listByFailureFingerprint: (fingerprint: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM fix_records WHERE failure_fingerprint = ? ORDER BY created_at, record_key
          `).all(FailureFingerprintSchema.parse(fingerprint));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            FixRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      historicalOperationSources: { list: () => this.#database.prepare("SELECT record_json FROM timeline_operation_sources ORDER BY record_key").all().map((row) => readHistoricalOperationSource(this.#database, JsonRowSchema.parse(row).record_json)) },
      runResults: Object.freeze({
        get: (runId: string) => this.#readRecord(
          "run_results",
          RunIdSchema.parse(runId),
          RunResultRecordSchema,
        ),
      }),
      providerAdmissions: this.#buildProviderAdmissionRepository(),
      startPlans: this.#buildStartPlanRepository(),
      workerLeases: this.#buildWorkerLeaseRepository(),
      duoCeremonyLeases: this.#buildDuoCeremonyLeaseRepository(),
      workerPools: this.#buildWorkerPoolRepository(),
      runSessions: this.#buildRunSessionRepository(),
      commands: Object.freeze({
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
            const result = this.#database.prepare(`
              INSERT INTO commands (record_key, family, record_json, created_at, parent_command_id) VALUES (?, ?, ?, ?, ?)
            `).run(record.commandId, record.family, json, record.requestedAt, parentCommandId ?? null);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => {
          const record = this.#readRecord("commands", commandId, z.union([CommandRequestSchema, BulkParentCommandRecordSchema]));
          if (record !== undefined && "kind" in record) throw new CommandIdentityConflictError();
          return record;
        },
        getSettingsHistory: (commandId: string) => this.#readRecord("commands", commandId, z.union([CommandRequestSchema, PreFloorSettingsCommandSchema, HistoricalProtectedSettingsCommandSchema])),
        findProtectedSettingsCommandIdByWriteId: (input: unknown) => {
          const { writeId, excludingCommandId } = ProtectedSettingsWriteIdLookupSchema.parse(input);
          const row = this.#database.prepare(`
            SELECT record_key FROM commands
            WHERE family = 'settings'
              AND record_key <> ?
              AND json_extract(record_json, '$.type') = 'apply-protected-settings'
              AND json_extract(record_json, '$.payload.writeId') = ?
            ORDER BY record_key
            LIMIT 1
          `).get(excludingCommandId, writeId);
          return row === undefined
            ? undefined
            : CommandIdSchema.parse(RecordKeyRowSchema.parse(row).record_key);
        },
        parentId: (commandId: string) => {
          const row = this.#database.prepare("SELECT parent_command_id FROM commands WHERE record_key = ?").get(commandId);
          return row === undefined ? undefined : z.strictObject({ parent_command_id: z.string().nullable() }).parse(row).parent_command_id;
        },
        acceptBulk: (input: unknown) => {
          const acceptance = BulkRunCommandAcceptanceRecordSchema.parse(input);
          const parent = BulkParentCommandRecordSchema.parse({ kind: "bulk-parent", commandId: acceptance.bulkCommandId, acceptance });
          return this.#authorityWrite("commands", () => {
            this.#assertCommandIdentity(parent);
            const existing = this.authority.commands.getBulk(parent.commandId);
            if (existing !== undefined) return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            const result = this.#database.prepare("INSERT INTO commands(record_key, family, record_json, created_at) VALUES (?, 'bulk-parent', ?, ?)")
              .run(parent.commandId, canonicalJsonStringify(parent), acceptance.request.requestedAt);
            return { result: Object.freeze({ state: "inserted" as const, record: acceptance }), changes: sqliteChanges(result.changes) };
          });
        },
        getBulk: (commandId: string) => {
          const row = this.#database.prepare("SELECT family, record_json FROM commands WHERE record_key = ?").get(commandId);
          if (row === undefined) return undefined;
          const stored = z.strictObject({ family: z.string(), record_json: z.string() }).parse(row);
          if (stored.family !== "bulk-parent") throw new CommandIdentityConflictError();
          return parseJsonRecord(BulkParentCommandRecordSchema, stored.record_json).acceptance;
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
              INSERT INTO command_audits (record_key, command_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, json, record.completedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (auditId: string) => this.#readRecord("command_audits", auditId, CommandAuditRecordSchema),
        findSettingsHistory: (commandId: string) => {
          const rows = this.#database.prepare("SELECT record_json FROM command_audits WHERE command_id=? ORDER BY record_key").all(commandId);
          if (rows.length > 1) throw new Error("historical settings command has ambiguous audits");
          const row = rows[0];
          return row === undefined ? undefined : parseJsonRecord(z.union([CommandAuditRecordSchema, HistoricalSettingsAuditSchema, HistoricalProtectedSettingsAuditSchema]), JsonRowSchema.parse(row).record_json);
        },
        findByCommand: (commandId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM command_audits WHERE command_id = ? ORDER BY record_key
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return parseJsonRecord(CommandAuditRecordSchema, JsonRowSchema.parse(row).record_json);
        },
      }),
      lifecycleJournal: Object.freeze({
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
            const result = this.#database.prepare(`
              INSERT INTO commands (record_key, family, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.commandId, record.kind, json, record.recordedAt);
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
              INSERT INTO command_audits (record_key, command_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, json, record.completedAt);
            return {
              result: Object.freeze({ state: "inserted" as const, record }),
              changes: sqliteChanges(result.changes),
            };
          });
        },
        findAuditByCommand: (commandId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM command_audits WHERE command_id = ? ORDER BY record_key
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return parseJsonRecord(AuthorityCommandAuditRecordSchema, JsonRowSchema.parse(row).record_json);
        },
      }),
      dependencies: Object.freeze({
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
              INSERT INTO delegation_dependencies (record_key, manifest_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.dependencyId, record.manifestId, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (dependencyId: string) => this.#readRecord("delegation_dependencies", dependencyId, DependencyRecordSchema),
        listByParentRun: (parentRunId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM delegation_dependencies
            WHERE json_extract(record_json, '$.parentRunId') = ?
            ORDER BY created_at, record_key
          `).all(RunIdSchema.parse(parentRunId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            DependencyRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      delegationManifests: Object.freeze({
        insert: (input: unknown) => {
          const record = DelegationManifestSchema.parse(input);
          return this.#insertSimpleRecord("run_delegations", record.manifestId, record, DelegationManifestSchema, record.createdAt);
        },
        get: (manifestId: string) => this.#readRecord("run_delegations", manifestId, DelegationManifestSchema),
      }),
      gateResults: Object.freeze({
        insert: (input: unknown) => {
          const record = GateResultRecordSchema.parse(input);
          return this.#insertSimpleRecord("checkpoint_payloads", `${record.runId}:${record.gateId}`, record, GateResultRecordSchema, record.resolvedAt);
        },
        get: (recordKey: string) => this.#readRecord("checkpoint_payloads", recordKey, GateResultRecordSchema),
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM checkpoint_payloads
            WHERE json_extract(record_json, '$.runId') = ?
            ORDER BY created_at, record_key
          `).all(RunIdSchema.parse(runId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            GateResultRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      runCheckpoints: Object.freeze({
        insert: (input: unknown) => {
          const record = RunCheckpointRecordSchema.parse(input);
          /*
           * D214: the schema makes `claimGeneration` optional so that rows
           * stored before the component existed still PARSE (D133 read-forward).
           * Absence is a fact about history, never a shape a writer may adopt —
           * a new row that does not name the execution which produced it would
           * be indistinguishable from a pre-D214 row and could collide with the
           * next execution exactly as before. Every writer holds the claim it is
           * running under, so this is a refusal and not a default.
           */
          const claimGeneration = record.claimGeneration;
          if (claimGeneration === undefined) {
            throw new Error(
              `run checkpoint ${record.workflowId}/${record.itemId}/${record.nodeId} attempt `
              + `${String(record.attempt)} names no claim generation; every checkpoint written from D214 `
              + "forward records WHICH execution of its attempt produced it",
            );
          }
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
                (record_key, workflow, item_id, node_id, attempt, claim_generation, run_id, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              recordKey, record.workflowId, record.itemId, record.nodeId,
              record.attempt, claimGeneration, record.runId, json, record.writtenAt,
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
          claimGeneration?: number,
        ) => this.#readRecord(
          "run_checkpoints",
          checkpointLookupKey(workflowId, itemId, nodeId, attempt, claimGeneration),
          RunCheckpointRecordSchema,
        ),
        /**
         * D214 — the LATEST EXECUTION, not merely the latest attempt. A NULL
         * `claim_generation` (a pre-D214 row) sorts last under `DESC` in SQLite,
         * which is the honest order: any row that names its execution was
         * written after every row that could not.
         */
        latest: (workflowId: string, itemId: string, nodeId: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND node_id = ?
            ORDER BY attempt DESC, claim_generation DESC LIMIT 1
          `).get(workflowId, itemId, nodeId);
          if (row === undefined) return undefined;
          return parseJsonRecord(RunCheckpointRecordSchema, JsonRowSchema.parse(row).record_json);
        },
        /** Every execution of `(item, node, attempt)`, in the order they ran. */
        listByAttempt: (workflowId: string, itemId: string, nodeId: string, attempt: number) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND node_id = ? AND attempt = ?
            ORDER BY claim_generation
          `).all(WorkflowIdSchema.parse(workflowId), ItemIdSchema.parse(itemId), nodeId, attempt);
          return Object.freeze(rows.map((row) => parseJsonRecord(
            RunCheckpointRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
        listByItem: (workflowId: string, itemId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_checkpoints
            WHERE workflow = ? AND item_id = ?
            ORDER BY attempt, claim_generation, node_id
          `).all(WorkflowIdSchema.parse(workflowId), ItemIdSchema.parse(itemId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            RunCheckpointRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      notifications: this.#buildNotificationRepository(),
      configSnapshots: Object.freeze({
        insert: (input: unknown) => {
          // The WRITE schema, not the read schema: an older generation is read
          // forward, never minted (`src/domain/config/snapshot-generations.ts`).
          const record = ConfigSnapshotWriteSchema.parse(input);
          return this.#insertSimpleRecord("settings_snapshots", record.configSnapshotId, record, ConfigSnapshotRecordSchema, record.capturedAt);
        },
        get: (snapshotId: string) => this.#readRecord("settings_snapshots", snapshotId, ConfigSnapshotRecordSchema),
      }),
      settingsCurrent: Object.freeze({
        get: () => this.#readRecord("settings_current", "current", SettingsCurrentRecordSchema),
        advance: (input: unknown) => {
          const record = SettingsCurrentRecordSchema.parse(input);
          return this.#authorityWrite("settings_current", () => {
            const current = this.#readRecord(
              "settings_current",
              "current",
              SettingsCurrentRecordSchema,
            );
            const expectedRevision = current === undefined ? 2 : current.revision + 1;
            if (record.revision !== expectedRevision) {
              throw new Error(
                `settings current revision ${String(record.revision)} does not exactly advance `
                + `${String(current?.revision ?? 1)} to ${String(expectedRevision)}`,
              );
            }
            const command = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            const audit = this.#readRecord("command_audits", record.auditId, CommandAuditRecordSchema);
            const target = { family: "settings" as const, revision: record.revision };
            if (command === undefined
              || command.family !== "settings"
              || command.type !== "apply-settings"
              || deriveSettingsCommandFingerprint(command) !== record.commandFingerprint
              || audit === undefined
              || audit.request.commandId !== record.commandId
              || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
              || audit.result.state !== "applied"
              || audit.result.commandId !== record.commandId
              || audit.result.restartRequired !== true
              || audit.result.settingsRevision !== record.revision
              || audit.result.settingsFingerprint !== record.settingsFingerprint
              || canonicalJsonStringify(audit.result.affectedTargets)
                !== canonicalJsonStringify([target])
              || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{
                target,
                before: record.revision - 1,
                after: record.revision,
              }])
              || audit.affectedDependencyIds.length !== 0
              || audit.completedAt !== record.committedAt) {
              throw new Error(
                `settings current revision ${String(record.revision)} does not bind its exact command and audit result`,
              );
            }
            const json = canonicalJsonStringify(record);
            const result = current === undefined
              ? this.#database.prepare(`
                  INSERT INTO settings_current
                    (record_key, revision, settings_fingerprint, command_id,
                      command_fingerprint, audit_id, record_json, created_at)
                  VALUES ('current', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  record.revision,
                  record.settingsFingerprint,
                  record.commandId,
                  record.commandFingerprint,
                  record.auditId,
                  json,
                  record.committedAt,
                )
              : this.#database.prepare(`
                  UPDATE settings_current
                  SET revision = ?, settings_fingerprint = ?, command_id = ?,
                    command_fingerprint = ?, audit_id = ?, record_json = ?, created_at = ?
                  WHERE record_key = 'current' AND revision = ?
                `).run(
                  record.revision,
                  record.settingsFingerprint,
                  record.commandId,
                  record.commandFingerprint,
                  record.auditId,
                  json,
                  record.committedAt,
                  current.revision,
                );
            const changes = sqliteChanges(result.changes);
            if (changes !== 1) {
              throw new Error(
                `settings current revision ${String(record.revision)} affected ${String(changes)} rows`,
              );
            }
            return { result: record, changes };
          });
        },
      }),
      runtimeConfig: Object.freeze({
        get: () => this.#readRecord("runtime_config", "active", ActiveRuntimeConfigRecordSchema),
        activate: (input: unknown) => {
          const request = ActiveRuntimeConfigActivationSchema.parse(input);
          return this.#authorityWrite("runtime_config", () => {
            const snapshot = this.#readRecord(
              "settings_snapshots",
              request.configSnapshotId,
              ConfigSnapshotRecordSchema,
            );
            if (snapshot === undefined || snapshot.fingerprint !== request.configFingerprint) {
              throw new Error(
                `runtime config activation does not bind exact snapshot ${request.configSnapshotId} `
                + `at fingerprint ${request.configFingerprint}`,
              );
            }
            const current = this.#readRecord(
              "runtime_config",
              "active",
              ActiveRuntimeConfigRecordSchema,
            );
            const record = ActiveRuntimeConfigRecordSchema.parse({
              ...request,
              generation: current === undefined ? 1 : current.generation + 1,
            });
            const json = canonicalJsonStringify(record);
            const result = current === undefined
              ? this.#database.prepare(`
                  INSERT INTO runtime_config
                    (record_key, generation, settings_revision, settings_fingerprint,
                      config_snapshot_id, config_fingerprint, record_json, created_at)
                  VALUES ('active', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  record.generation,
                  record.settingsRevision,
                  record.settingsFingerprint,
                  record.configSnapshotId,
                  record.configFingerprint,
                  json,
                  record.activatedAt,
                )
              : this.#database.prepare(`
                  UPDATE runtime_config
                  SET generation = ?, settings_revision = ?, settings_fingerprint = ?,
                    config_snapshot_id = ?, config_fingerprint = ?, record_json = ?, created_at = ?
                  WHERE record_key = 'active' AND generation = ?
                `).run(
                  record.generation,
                  record.settingsRevision,
                  record.settingsFingerprint,
                  record.configSnapshotId,
                  record.configFingerprint,
                  json,
                  record.activatedAt,
                  current.generation,
                );
            const changes = sqliteChanges(result.changes);
            if (changes !== 1) {
              throw new Error(`runtime config generation ${String(record.generation)} activation affected ${String(changes)} rows`);
            }
            return { result: record, changes };
          });
        },
        requireActive: (input: unknown) => {
          const request = ActiveRuntimeConfigExpectationSchema.parse(input);
          const current = this.#readRecord(
            "runtime_config",
            "active",
            ActiveRuntimeConfigRecordSchema,
          );
          if (current === undefined) {
            throw new Error("runtime config has no dashboard-activated generation");
          }
          if (current.settingsRevision !== request.settingsRevision
            || current.settingsFingerprint !== request.settingsFingerprint
            || current.configFingerprint !== request.configFingerprint) {
            throw new Error(
              `settings revision ${String(request.settingsRevision)} at ${request.settingsFingerprint} `
              + `and config ${request.configFingerprint} are not dashboard-active; restart activation is required`,
            );
          }
          const snapshot = this.#readRecord(
            "settings_snapshots",
            current.configSnapshotId,
            ConfigSnapshotRecordSchema,
          );
          if (snapshot === undefined || snapshot.fingerprint !== current.configFingerprint) {
            throw new Error(
              `active runtime config generation ${String(current.generation)} does not bind exact `
              + `snapshot ${current.configSnapshotId}`,
            );
          }
          return RuntimeConfigClaimTokenSchema.parse({
            generation: current.generation,
            settingsRevision: current.settingsRevision,
            settingsFingerprint: current.settingsFingerprint,
            configFingerprint: current.configFingerprint,
          });
        },
        requireSettingsCurrent: () => {
          const settingsCurrent = this.#readRecord(
            "settings_current",
            "current",
            SettingsCurrentRecordSchema,
          );
          if (settingsCurrent === undefined) return;
          const runtime = this.#readRecord(
            "runtime_config",
            "active",
            ActiveRuntimeConfigRecordSchema,
          );
          if (runtime === undefined
            || runtime.settingsRevision !== settingsCurrent.revision
            || runtime.settingsFingerprint !== settingsCurrent.settingsFingerprint) {
            throw new Error(
              "dashboard runtime settings are stale; restart activation is required",
            );
          }
          const snapshot = this.#readRecord(
            "settings_snapshots",
            runtime.configSnapshotId,
            ConfigSnapshotRecordSchema,
          );
          if (snapshot === undefined || snapshot.fingerprint !== runtime.configFingerprint) {
            throw new Error(
              `active runtime config generation ${String(runtime.generation)} does not bind exact `
              + `snapshot ${runtime.configSnapshotId}`,
            );
          }
        },
      }),
      versionPlans: Object.freeze({
        insert: (input: unknown) => {
          const record = VersionPlanStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("version_plans", record.versionPlanId, record, VersionPlanStorageRecordSchema, record.createdAt);
        },
        get: (versionPlanId: string) => this.#readRecord("version_plans", versionPlanId, VersionPlanStorageRecordSchema),
        list: () => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM version_plans ORDER BY created_at DESC, record_key
        `).all().map((row) => parseJsonRecord(VersionPlanStorageRecordSchema, JsonRowSchema.parse(row).record_json))),
        /**
         * `planned → applied`, exactly once, under the caller's CAS token —
         * the same discipline `startPlans.consume` follows, and for the same
         * reason: a reviewable proposal that could be applied twice would
         * archive one sweep's runs under two different change records.
         */
        consume: (input: unknown) => {
          const request = VersionPlanConsumeRequestSchema.parse(input);
          return this.#authorityWrite("version_plans", () => {
            const current = this.#readRecord("version_plans", request.versionPlanId, VersionPlanStorageRecordSchema);
            if (current === undefined) {
              return {
                result: Object.freeze({ state: "refused" as const, code: "not-found" as const,
                  message: `version plan ${request.versionPlanId} does not exist` }),
                changes: 0,
              };
            }
            if (current.state === "applied") {
              return { result: Object.freeze({ state: "already-consumed" as const, plan: current }), changes: 0 };
            }
            if (current.version !== request.expectedVersion) {
              return {
                result: Object.freeze({ state: "refused" as const, code: "version-mismatch" as const,
                  message: `version plan ${request.versionPlanId} is at version ${String(current.version)}, `
                    + `not the ${String(request.expectedVersion)} this apply expected` }),
                changes: 0,
              };
            }
            if (current.planFingerprint !== request.planFingerprint) {
              return {
                result: Object.freeze({ state: "refused" as const, code: "fingerprint-mismatch" as const,
                  message: `version plan ${request.versionPlanId} holds fingerprint ${current.planFingerprint.slice(0, 12)}…, `
                    + `not the ${request.planFingerprint.slice(0, 12)}… this apply reviewed` }),
                changes: 0,
              };
            }
            const next = VersionPlanStorageRecordSchema.parse({
              ...current,
              state: "applied",
              version: current.version + 1,
              appliedAt: request.now,
            });
            const outcome = this.#database.prepare(`
              UPDATE version_plans SET record_json = ? WHERE record_key = ?
            `).run(canonicalJsonStringify(next), request.versionPlanId);
            return { result: Object.freeze({ state: "consumed" as const, plan: next }), changes: sqliteChanges(outcome.changes) };
          });
        },
      }),
      /**
       * D179 / ref dashboard-surfaces §10.2 — the archive model's three durable facts. All
       * three are insert-only here AND in SQL: the migration's triggers abort
       * every UPDATE and DELETE, so an archive cannot be quietly rewritten by
       * a future repository method either.
       */
      versionBumpApplications: Object.freeze({
        insert: (input: unknown) => {
          const record = VersionBumpApplicationStorageRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("version_bump_applications", () => {
            const existing = this.#readRecord(
              "version_bump_applications", record.applicationId, VersionBumpApplicationStorageRecordSchema,
            );
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`version bump application ${record.applicationId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const outcome = this.#database.prepare(`
              INSERT INTO version_bump_applications
                (record_key, version_plan_id, scope_kind, target_version, applied_app_version, archived_count, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.applicationId, record.versionPlanId, record.scope.kind, record.targetVersion,
              record.appliedAppVersion, record.archivedRunIds.length, json, record.appliedAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(outcome.changes) };
          });
        },
        get: (applicationId: string) => this.#readRecord(
          "version_bump_applications", applicationId, VersionBumpApplicationStorageRecordSchema,
        ),
        list: () => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM version_bump_applications ORDER BY created_at DESC, record_key
        `).all().map((row) => parseJsonRecord(
          VersionBumpApplicationStorageRecordSchema, JsonRowSchema.parse(row).record_json,
        ))),
      }),
      deletedRuns: Object.freeze({
        get: (runId: string) => this.#readRecord("deleted_runs", RunIdSchema.parse(runId), DeletedRunRecordSchema),
        list: () => {
          const rows = this.#database.prepare(
            "SELECT record_json FROM deleted_runs ORDER BY deleted_at, record_key",
          ).all();
          return Object.freeze(rows.map((row) => parseJsonRecord(DeletedRunRecordSchema, JsonRowSchema.parse(row).record_json)));
        },
      }),
      archivedRuns: Object.freeze({
        transactions: (runId: string) => this.#withReadSnapshot(() => {
          const archive = this.#readRecord("archived_runs", runId, ArchivedRunStorageRecordSchema);
          if (archive === undefined) throw new Error("archive-transactions-owner-missing");
          const raw = z.strictObject({ transactions_json: z.string().nullable(), transactions_digest: z.string().nullable() }).parse(
            this.#database.prepare("SELECT transactions_json,transactions_digest FROM archived_runs WHERE record_key=?").get(runId));
          if (raw.transactions_json === null || raw.transactions_digest === null) throw new Error("archive-transactions-missing");
          const section = ArchivedTransactionsSchema.parse(JSON.parse(raw.transactions_json));
          if (sha256Hex(raw.transactions_json) !== raw.transactions_digest || section.runId !== runId || section.contentDigest !== archive.contentDigest) throw new Error("archive-transactions-integrity-mismatch");
          return section;
        }),
        enrichTransactions: (input: unknown) => this.#authorityWrite("archived_runs", () => {
          const section = ArchivedTransactionsSchema.parse(input);
          const archive = this.#readRecord("archived_runs", section.runId, ArchivedRunStorageRecordSchema);
          if (archive === undefined || archive.contentDigest !== section.contentDigest) throw new Error("archive-transactions-owner-mismatch");
          const raw = z.object({ transactions_json: z.string().nullable() }).parse(this.#database.prepare("SELECT transactions_json FROM archived_runs WHERE record_key=?").get(section.runId));
          const json = canonicalJsonStringify(section);
          if (raw.transactions_json !== null) {
            const existing = this.authority.archivedRuns.transactions(section.runId);
            if (canonicalJsonStringify(existing) !== json) throw new Error("archive-transactions-divergent-enrichment");
            return { result: existing, changes: 0 };
          }
          const result = this.#database.prepare("UPDATE archived_runs SET transactions_json=?,transactions_digest=? WHERE record_key=?").run(json, sha256Hex(json), section.runId);
          return { result: section, changes: sqliteChanges(result.changes) };
        }),
        bindingMismatches: (input: unknown) => {
          const archived = ArchivedRunStorageRecordSchema.parse(input);
          const run = this.#readRunRow(archived.runId);
          if (run === undefined) return ["runId has no retained lifecycle row"];
          if (run.lifecycle.state !== "terminal") return ["retained lifecycle is not terminal"];
          const identityMatches = archived.traceId === run.envelope.traceId
            && archived.workflowId === run.envelope.workflow
            && archived.archivedIdentity.descriptorVersion === run.envelope.descriptorVersion
            && archived.archivedIdentity.contractFingerprint === run.envelope.contractFingerprint
            && Number(archived.row.rowRevision) === Number(run.version)
            && archived.row.attempt === run.envelope.attempt
            && canonicalJsonStringify(archived.input) === canonicalJsonStringify(run.input);
          return [
            ...(identityMatches ? [] : ["archive identity/input/revision differs from the retained run"]),
            ...archivedTerminalMismatches(run, run.lifecycle, archived),
          ];
        },
        insert: (input: unknown) => {
          const record = ArchivedRunStorageRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("archived_runs", () => {
            const existing = this.#readRecord("archived_runs", record.runId, ArchivedRunStorageRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(
                  `run ${record.runId} is already archived under ${existing.applicationId}; refusing to re-archive it `
                  + `with different content under ${record.applicationId}`,
                );
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const outcome = this.#database.prepare(`
              INSERT INTO archived_runs
                (record_key, application_id, workflow, descriptor_version, contract_fingerprint, app_version, content_digest, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.runId, record.applicationId, record.workflowId,
              record.archivedIdentity.descriptorVersion, record.archivedIdentity.contractFingerprint,
              record.appVersion.state === "present" ? record.appVersion.value : null,
              record.contentDigest, json, record.archivedAt,
            );
            this.authority.archivedRuns.enrichTransactions(createTransactionHistory(this.authority).capture(record.runId, record.contentDigest, record.archivedAt, record.evidence.ledgerPartitions));
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(outcome.changes) };
          });
        },
        get: (runId: string) => this.#withReadSnapshot(() => {
          const record = this.#readRecord("archived_runs", runId, ArchivedRunStorageRecordSchema);
          return record === undefined ? undefined : this.#verifyArchivedPrivateInput(record);
        }),
        /**
         * The predicate the ONE run/queue projection asks per row (D81/D80).
         * It reads the index rather than the record so excluding an archived
         * row never costs a JSON parse.
         */
        isArchived: (runId: string) => CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM archived_runs WHERE record_key = ?
        `).get(runId)).count > 0,
        list: () => this.#withReadSnapshot(() => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM archived_runs ORDER BY created_at DESC, record_key
        `).all().map((row) => this.#verifyArchivedPrivateInput(
          parseJsonRecord(ArchivedRunStorageRecordSchema, JsonRowSchema.parse(row).record_json))))),
      }),
      archiveRelaunches: Object.freeze({
        insert: (input: unknown) => {
          const record = ArchiveRelaunchStorageRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("archive_relaunches", () => {
            const existing = this.#readRecord("archive_relaunches", record.runId, ArchiveRelaunchStorageRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`relaunch provenance for run ${record.runId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const outcome = this.#database.prepare(`
              INSERT INTO archive_relaunches (record_key, archived_run_id, record_json, created_at)
              VALUES (?, ?, ?, ?)
            `).run(record.runId, record.archivedRunId, json, record.relaunchedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(outcome.changes) };
          });
        },
        listByArchivedRun: (archivedRunId: string) => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM archive_relaunches WHERE archived_run_id = ? ORDER BY created_at DESC, record_key
        `).all(archivedRunId).map((row) => parseJsonRecord(
          ArchiveRelaunchStorageRecordSchema, JsonRowSchema.parse(row).record_json,
        ))),
      }),
      writeIntents: Object.freeze({
        listByBusinessKey: (system: unknown, digest: unknown) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_operations WHERE system = ? AND
              (json_extract(record_json, '$.idempotencyKeyDigest') = ? OR
               json_extract(record_json, '$.occurrence.businessKeyDigest') = ?)
            ORDER BY record_key
          `).all(BrowserSystemIdSchema.parse(system), FingerprintSchema.parse(digest), FingerprintSchema.parse(digest));
          return Object.freeze(rows.map((row) => parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json)));
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
          const { intent, attempt } = WriteFenceInputSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            this.#assertBusinessWriteAdmission(intent);
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
          const { expectedVersion, intent, attempt } = WriteRefenceInputSchema.parse(input);
          if (intent.status !== "attempting") {
            throw new Error(`re-fence of ${intent.writeIntentId} must present an attempting intent, not ${intent.status}`);
          }
          return this.withAuthorityTransaction(() => {
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
            if (current.status !== "attempting" && current.status !== "parked") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only attempting or parked may settle retryable`);
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
            if (currentAttempt.outcome.state !== "attempting" && currentAttempt.outcome.state !== "parked") {
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
        reopenParkedAttempt: (input: unknown) => {
          const request = WriteIntentReopenRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "parked") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only a parked intent may reopen for resolution`);
            }
            const { parkedCode: _parkedCode, message: _message, authorityReason: _authorityReason, ...base } = current;
            const attempting = WriteIntentRecordSchema.parse({
              ...base,
              status: "attempting",
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireWriteAttempt(current.currentAttemptId);
            if (currentAttempt.outcome.state !== "parked") {
              throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only a parked attempt may reopen`);
            }
            const reopenedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "attempting" },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(attempting);
            this.#replaceWriteAttempt(reopenedAttempt);
            return attempting;
          });
        },
        get: (writeIntentId: string) => this.#readRecord("run_operations", writeIntentId, WriteIntentRecordSchema),
        findByPermanentKey: (system: unknown, idempotencyKey: unknown) => this.#findPermanentWriteIntent(
          BrowserSystemIdSchema.parse(system),
          IdempotencyKeySchema.parse(idempotencyKey),
        ),
        listAttemptingByItem: (input: unknown) => {
          const request = z.strictObject({ workflowId: WorkflowIdSchema, itemId: ItemIdSchema }).parse(input);
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_operations
            WHERE status = 'attempting'
              AND json_extract(record_json, '$.workflowId') = ?
              AND json_extract(record_json, '$.itemId') = ?
            ORDER BY record_key
          `).all(request.workflowId, request.itemId);
          return Object.freeze(rows.map((row) => {
            const intent = parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json);
            if (intent.status !== "attempting") throw new Error("attempting intent index disagrees with its record");
            return intent;
          }));
        },
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_operations
            WHERE json_extract(record_json, '$.runId') = ?
            ORDER BY created_at, record_key
          `).all(RunIdSchema.parse(runId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            WriteIntentRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
        countDryRunEvidenceByRun: (runId: string) => {
          const parsedRunId = RunIdSchema.parse(runId);
          const count = (sql: string): number => CountRowSchema.parse(
            this.#database.prepare(sql).get(parsedRunId),
          ).count;
          return DryRunWriteSafetyCountsSchema.parse({
            writeIntents: count(`
              SELECT count(*) AS count FROM run_operations
              WHERE json_extract(record_json, '$.runId') = ?
            `),
            writeAttempts: count(`
              SELECT count(*) AS count FROM run_operation_attempts AS attempt
              JOIN run_operations AS intent ON intent.record_key = attempt.write_intent_id
              WHERE json_extract(intent.record_json, '$.runId') = ?
            `),
            confirmedOperations: count(`
              SELECT count(*) AS count FROM timeline_events
              WHERE run_id = ? AND json_extract(record_json, '$.payload.kind') = 'operation-confirmed'
            `),
          });
        },
      }),
      writeAttempts: Object.freeze({
        get: (writeAttemptId: string) => this.#readRecord("run_operation_attempts", writeAttemptId, WriteAttemptRecordSchema),
        listByIntent: (writeIntentId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM run_operation_attempts WHERE write_intent_id = ? ORDER BY generation
          `).all(WriteIntentIdSchema.parse(writeIntentId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            WriteAttemptRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),

      artifactOutbox: Object.freeze({
        insert: (input: unknown) => {
          const record = ArtifactOutboxStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("artifact_outbox", record.outboxId, record, ArtifactOutboxStorageRecordSchema, record.createdAt);
        },
        get: (outboxId: string) => this.#readRecord("artifact_outbox", outboxId, ArtifactOutboxStorageRecordSchema),
        listPending: () => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM artifact_outbox
            WHERE json_extract(record_json, '$.state') = 'pending'
            ORDER BY created_at, record_key
          `).all();
          return Object.freeze(rows.map((row) =>
            parseJsonRecord(ArtifactOutboxStorageRecordSchema, JsonRowSchema.parse(row).record_json)));
        },
        markProjected: (input: unknown) => {
          const request = ArtifactOutboxAckRequestSchema.parse(input);
          return this.#authorityWrite("artifact_outbox", () => {
            const existing = this.#readRecord("artifact_outbox", request.outboxId, ArtifactOutboxStorageRecordSchema);
            if (existing === undefined) {
              throw new Error(`artifact outbox row ${request.outboxId} does not exist; nothing to acknowledge`);
            }
            if (existing.state === "projected") {
              return {
                result: Object.freeze({ state: "already-projected" as const, record: existing }),
                changes: 0,
              };
            }
            const projected = ArtifactOutboxStorageRecordSchema.parse({
              ...existing,
              state: "projected",
              projectedAt: request.projectedAt,
            });
            const outcome = this.#database.prepare(`
              UPDATE artifact_outbox SET record_json = ?
              WHERE record_key = ? AND json_extract(record_json, '$.state') = 'pending'
            `).run(canonicalJsonStringify(projected), request.outboxId);
            const changes = sqliteChanges(outcome.changes);
            if (changes !== 1) {
              throw new Error(`artifact outbox ${request.outboxId} acknowledgement affected ${String(changes)} rows`);
            }
            return {
              result: Object.freeze({ state: "acknowledged" as const, record: projected }),
              changes: 1,
            };
          });
        },
      }),
      artifactSinkHeads: Object.freeze({
        get: (sinkId: string) => this.#readRecord("artifact_sink_heads", sinkId, ArtifactSinkHeadRecordSchema),
        record: (input: unknown) => {
          const request = ArtifactSinkHeadRecordRequestSchema.parse(input);
          return this.#authorityWrite("artifact_sink_heads", () => {
            const existing = this.#readRecord("artifact_sink_heads", request.sinkId, ArtifactSinkHeadRecordSchema);
            if (existing === undefined) {
              const head = ArtifactSinkHeadRecordSchema.parse({ ...request, generation: 1 });
              this.#database.prepare(`
                INSERT INTO artifact_sink_heads (record_key, record_json, created_at) VALUES (?, ?, ?)
              `).run(head.sinkId, canonicalJsonStringify(head), head.projectedAt);
              return { result: head, changes: 1 };
            }
            const head = ArtifactSinkHeadRecordSchema.parse({
              ...request,
              generation: existing.generation + 1,
            });
            const outcome = this.#database.prepare(`
              UPDATE artifact_sink_heads SET record_json = ?
              WHERE record_key = ? AND json_extract(record_json, '$.generation') = ?
            `).run(canonicalJsonStringify(head), head.sinkId, existing.generation);
            const changes = sqliteChanges(outcome.changes);
            if (changes !== 1) {
              throw new Error(
                `artifact sink head ${head.sinkId} update raced past generation ${String(existing.generation)}; `
                + `${String(changes)} rows changed`,
              );
            }
            return { result: head, changes: 1 };
          });
        },
      }),
      opaque: Object.freeze({
        ocrApprovals: opaque("ocr_approvals"),
      }),
    });
  }

  #readRunRow(runId: string): RunRecord | undefined {
    return this.#readRecord("workflow_runs", runId, RunRecordSchema);
  }

  /**
   * D221 — the attempt the NEXT run of this logical item must take.
   *
   * The `attempt` column is the envelope's own value (the integrity audit pins
   * the two together). D330 retains spent ordinals in tombstones, so the
   * maximum across live and deleted authority is the history. One past it is the
   * only attempt no execution of that item can already own.
   */
  #nextItemAttempt(workflow: string, itemId: string): number {
    const row = MaxAttemptRowSchema.parse(this.#database.prepare(`
      SELECT max(attempt) AS attempt FROM (
        SELECT attempt FROM workflow_runs WHERE workflow = ? AND item_id = ?
        UNION ALL
        SELECT attempt FROM deleted_runs WHERE workflow = ? AND item_id = ?
      )
    `).get(WorkflowIdSchema.parse(workflow), ItemIdSchema.parse(itemId), workflow, itemId));
    const highest = row.attempt;
    if (highest === null) return 1;
    return highest + 1;
  }

  /**
   * D230: the next unspent ORDINAL for one workflow — the queue footer's `#N`.
   *
   * Same shape as `#nextItemAttempt` one scope up, and for the same reason: the
   * column is the record's own value (the integrity audit pins them together),
   * tombstones retain deleted ordinals, so the two-source maximum is the whole
   * history of numbers that workflow has spent, and one past it is the only
   * number no run of that workflow can already own.
   *
   * A workflow whose every row predates v15 answers `null` and therefore starts
   * at 1. That is the honest start rather than a defect: those rows name no
   * ordinal at all (they are NULL, not 0), so nothing can collide with 1, and
   * back-filling them by `created_at` order to "make room" would mint numbers
   * that were never true of them.
   */
  #nextWorkflowRunNumber(workflow: string): number {
    const row = MaxRunNumberRowSchema.parse(this.#database.prepare(`
      SELECT max(run_number) AS run_number FROM (
        SELECT run_number FROM workflow_runs WHERE workflow = ?
        UNION ALL
        SELECT run_number FROM deleted_runs WHERE workflow = ?
      )
    `).get(WorkflowIdSchema.parse(workflow), workflow));
    const highest = row.run_number;
    if (highest === null) return 1;
    return highest + 1;
  }

  /**
   * Validate the whole searchable authority corpus before SQL can observe a
   * query, facet or trace substring. The cache names exactly one authority
   * generation and SQLite data version; a mismatch rebuilds synchronously,
   * while an in-process authority write invalidates immediately so an outer
   * transaction can never reuse its pre-write validation.
   */
  #assertRunSearchCorpusReconciled(): void {
    const authorityGeneration = this.#readMetaRow().authority_generation;
    const dataVersion = DataVersionRowSchema.parse(
      this.#database.prepare("PRAGMA data_version").get(),
    ).data_version;
    const cached = this.#runSearchCorpusValidation;
    if (cached?.authorityGeneration === authorityGeneration && cached.dataVersion === dataVersion) return;

    const rows = z.array(RunSearchCorpusRowSchema).parse(this.#database.prepare(`
      SELECT t.record_key, t.record_json, t.workflow, t.state, t.priority, t.created_at,
        ${RUN_SEARCH_CREATED_AT_EPOCH_MS_SQL} AS created_at_epoch_ms
      FROM workflow_runs AS t
      WHERE NOT EXISTS (
        SELECT 1 FROM archived_runs AS archived WHERE archived.record_key = t.record_key
      )
      ORDER BY t.record_key
    `).all());
    for (const row of rows) reconcileRunSearchCorpusRow(row);
    this.#runSearchCorpusValidation = Object.freeze({ authorityGeneration, dataVersion });
  }

  #writeRunRow(record: RunRecord, mode: "insert" | "update"): void {
    const claim = runClaim(record);
    const json = canonicalJsonStringify(record);
    const notBefore = record.lifecycle.state === "queued" ? record.lifecycle.notBefore ?? null : null;
    this.#authorityWrite("workflow_runs", () => {
      const statement = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO workflow_runs (
            record_key, workflow, item_id, state, priority, attempt, not_before,
            owner_worker_id, claim_generation, heartbeat_at, parent_run_id, run_number, session_id, version,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        : this.#database.prepare(`
          UPDATE workflow_runs SET
            workflow = ?, item_id = ?, state = ?, priority = ?, attempt = ?, not_before = ?,
            owner_worker_id = ?, claim_generation = ?, heartbeat_at = ?, parent_run_id = ?,
            run_number = ?, session_id = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `);
      const shared = [
        record.envelope.workflow,
        record.envelope.itemId,
        record.lifecycle.state,
        record.envelope.priority,
        record.envelope.attempt,
        notBefore,
        claim?.workerId ?? null,
        record.claimGeneration,
        claim?.heartbeatAt ?? null,
        record.envelope.parent?.runId ?? null,
        // D230: NULL for every run enqueued before schema v15, carried through
        // every later UPDATE unchanged. A row that names no ordinal keeps
        // naming none — an update is not the moment to invent one.
        record.runNumber ?? null,
        // D269: the same read-forward shape — NULL for every run enqueued
        // before schema v17 and for a run no fan-out grouped; never minted on
        // an update.
        record.sessionId ?? null,
        record.version,
      ] as const;
      const result = mode === "insert"
        ? statement.run(record.envelope.runId, ...shared, json, canonicalUtcInstant(record.createdAt))
        : statement.run(...shared, json, record.envelope.runId, record.version - 1);
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`run ${record.envelope.runId} ${mode} affected ${String(changes)} rows`);
      }
      this.#lifecycleHooks?.afterRunWrite?.(record);
      return { result: undefined, changes };
    });
  }

  /**
   * One compare-and-swap over a run row. Every mutation funnels through here so
   * the version check, the claim check, and the legality check cannot be
   * bypassed by a caller that "knows" its update is safe.
   */
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
      const violation = runTransitionViolation(current.lifecycle, candidate.lifecycle);
      if (violation !== undefined) throw new Error(`run ${runId}: ${violation}`);
      const updated = RunRecordSchema.parse({ ...candidate, version: current.version + 1, updatedAt: now });
      this.#writeRunRow(updated, "update");
      return RunUpdateOutcomeSchema.parse({ state: "applied", run: updated });
    });
  }

  #claimNextRun(input: unknown, canonical: false): RunClaimOutcome;
  #claimNextRun(input: unknown, canonical: true): CanonicalRunClaimOutcome;
  #claimNextRun(input: unknown, canonical: boolean): CanonicalRunClaimOutcome {
    const request = RunClaimRequestSchema.parse(input);
    if (canonical && request.runtimeConfig === undefined) {
      return { state: "refused", refusal: { reason: "runtime-stale" } };
    }
    return this.withAuthorityTransaction((): CanonicalRunClaimOutcome => {
      if (request.runtimeConfig !== undefined) {
        const active = this.#readRecord(
          "runtime_config",
          "active",
          ActiveRuntimeConfigRecordSchema,
        );
        const activeToken = active === undefined
          ? undefined
          : RuntimeConfigClaimTokenSchema.parse({
              generation: active.generation,
              settingsRevision: active.settingsRevision,
              settingsFingerprint: active.settingsFingerprint,
              configFingerprint: active.configFingerprint,
            });
        if (activeToken === undefined
          || canonicalJsonStringify(activeToken) !== canonicalJsonStringify(request.runtimeConfig)) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error(
            `worker boot runtime config generation ${String(request.runtimeConfig.generation)} `
            + "is no longer dashboard-active; restart activation is required",
          );
        }
        const settingsCurrent = this.#readRecord(
          "settings_current",
          "current",
          SettingsCurrentRecordSchema,
        );
        if (settingsCurrent !== undefined
          && (settingsCurrent.revision !== request.runtimeConfig.settingsRevision
            || settingsCurrent.settingsFingerprint !== request.runtimeConfig.settingsFingerprint)) {
          if (canonical) return { state: "refused", refusal: { reason: "runtime-stale" } };
          throw new Error(
            "dashboard runtime settings are stale; restart activation is required",
          );
        }
      }
      // One worker, one active item (ref execution-and-sessions §0.3). A worker asking for a
      // second row is a bug in the loop, not a state to serve — and serving
      // it would put two runs and two browser-session sets under one owner.
      const held = HeldRunRowSchema.parse(this.#database.prepare(`
        SELECT record_key AS run_id FROM workflow_runs
        WHERE owner_worker_id = ? AND state IN ('claimed', 'validating', 'running')
        LIMIT 1
      `).get(request.workerId) ?? { run_id: null });
      if (held.run_id !== null) {
        if (canonical) return { state: "refused", refusal: { reason: "worker-busy", runId: RunIdSchema.parse(held.run_id) } };
        throw new Error(`worker ${request.workerId} already holds active run ${held.run_id}`);
      }
      const row = this.#database.prepare(`
        SELECT record_json FROM workflow_runs
        WHERE workflow = ? AND state = 'queued'
          AND (not_before IS NULL OR not_before <= ?)
          AND (? = 0 OR (
            NOT EXISTS (SELECT 1 FROM archived_runs a WHERE a.record_key = workflow_runs.record_key)
            AND NOT EXISTS (
              SELECT 1 FROM delegation_dependencies d
              WHERE json_extract(d.record_json, '$.parentRunId') = workflow_runs.record_key
                AND json_extract(d.record_json, '$.state') <> 'satisfied'
            )
          ))
        ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, created_at, record_key
        LIMIT 1
      `).get(request.workflow, request.now, canonical ? 1 : 0);
      if (row === undefined) {
        const deferred = NextEligibleRowSchema.parse(this.#database.prepare(`
          SELECT min(not_before) AS next_eligible_at FROM workflow_runs
          WHERE workflow = ? AND state = 'queued' AND not_before > ?
            AND (? = 0 OR (
              NOT EXISTS (SELECT 1 FROM archived_runs a WHERE a.record_key = workflow_runs.record_key)
              AND NOT EXISTS (
                SELECT 1 FROM delegation_dependencies d
                WHERE json_extract(d.record_json, '$.parentRunId') = workflow_runs.record_key
                  AND json_extract(d.record_json, '$.state') <> 'satisfied'
              )
            ))
        `).get(request.workflow, request.now, canonical ? 1 : 0));
        if (deferred.next_eligible_at === null) return RunClaimOutcomeSchema.parse({ state: "idle" });
        return RunClaimOutcomeSchema.parse({ state: "deferred", nextEligibleAt: deferred.next_eligible_at });
      }
      const current = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
      if (request.configFingerprint !== undefined) {
        if (current.envelope.configFingerprint !== request.configFingerprint) {
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
          /*
           * D221 — a new run of a logical item takes the item's NEXT attempt.
           *
           * The checkpoint key is `(workflow, item_id, node_id, attempt,
           * claim_generation)` and every one of those components is item-scoped
           * except the two the run supplies, so a second run born at an attempt
           * the item already spent puts its executions under keys the first run
           * owns — which is exactly how a retry of a failed run died on the
           * first `always-rerun` node it reached. The check is here, in the one
           * transaction that can see the whole item, and not at the two call
           * sites that build run records.
           */
          const next = this.#nextItemAttempt(record.envelope.workflow, record.envelope.itemId);
          if (record.envelope.attempt < next) {
            throw new Error(
              `run ${record.envelope.runId} is enqueued for ${record.envelope.workflow} item `
              + `${record.envelope.itemId} at attempt ${String(record.envelope.attempt)}, which that item has `
              + `already spent (its next unspent attempt is ${String(next)}); an attempt is the item's, not `
              + "the run's, and no two runs of one item may hold the same one",
            );
          }
          /*
           * D230 — the same rule one scope up, for the workflow ORDINAL.
           *
           * `UNIQUE (workflow, run_number)` would refuse a repeat anyway, but a
           * constraint violation names an index rather than the mistake, and a
           * caller that read the counter before another transaction spent it
           * deserves the sentence that says so. A record carrying NO number is
           * accepted unconditionally: that is the read-forward shape (a replayed
           * historical row, a fixture built before v15), and a writer that
           * minted one here would be back-filling.
           */
          /*
           * D269 — a run that names a session names a row authority wrote.
           * The fan-out inserts the session BEFORE its first member inside this
           * same transaction, so a member enqueued without it is a caller
           * defect, refused here by name rather than left as a dangling id the
           * session view would have to explain away. A record with NO session
           * is accepted unconditionally: that is the read-forward shape (a
           * replayed pre-v17 row) and the shape of a run no fan-out grouped.
           */
          if (record.sessionId !== undefined) {
            const session = this.#readRecord("workflow_run_batches", record.sessionId, RunSessionRecordSchema);
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
      search: (input: unknown) => {
        const request = RunSearchReadRequestSchema.parse(input);
        return this.withAuthorityReadSnapshot(() => {
          this.#assertRunSearchCorpusReconciled();
          const filter = runSearchFilter(request);
          const afterSql = request.after === undefined ? "" : `
            AND (
              match_rank > ?
              OR (match_rank = ? AND created_at_epoch_ms < ?)
              OR (match_rank = ? AND created_at_epoch_ms = ? AND record_key > ?)
            )
          `;
          const afterParameters: RunSearchSqlParameter[] = request.after === undefined
            ? []
            : [
              request.after.matchRank,
              request.after.matchRank,
              instantEpochMilliseconds(request.after.enqueuedAt),
              request.after.matchRank,
              instantEpochMilliseconds(request.after.enqueuedAt),
              request.after.runId,
            ];
          const passRows = z.array(RunSearchPassResultSchema).parse(this.#database.prepare(`
            WITH search(q) AS (VALUES (?)), ranked AS (
              SELECT t.record_key, t.record_json, t.workflow, t.state, t.priority, t.created_at,
                ${RUN_SEARCH_CREATED_AT_EPOCH_MS_SQL} AS created_at_epoch_ms,
                ${runSearchRankSql(request.scope)} AS match_rank
              FROM workflow_runs AS t CROSS JOIN search
              WHERE ${filter.sql}
            ), matched AS MATERIALIZED (
              SELECT ranked.*, count(*) OVER () AS total_matches
              FROM ranked
              WHERE match_rank IS NOT NULL
            ), page AS MATERIALIZED (
              SELECT * FROM matched
              WHERE 1 = 1 ${afterSql}
              ORDER BY match_rank ASC, created_at_epoch_ms DESC, record_key ASC
              LIMIT ?
            )
            SELECT 'row' AS result_kind,
              json_object(
                'record_key', record_key,
                'record_json', record_json,
                'workflow', workflow,
                'state', state,
                'priority', priority,
                'created_at', created_at,
                'created_at_epoch_ms', created_at_epoch_ms,
                'match_rank', match_rank
              ) AS payload,
              NULL AS total_matches,
              0 AS result_order,
              match_rank AS order_match_rank,
              created_at_epoch_ms AS order_created_at_epoch_ms,
              record_key AS order_record_key
            FROM page
            UNION ALL
            SELECT 'summary', NULL, COALESCE(max(total_matches), 0), 1, NULL, NULL, NULL
            FROM matched
            ORDER BY result_order ASC, order_match_rank ASC,
              order_created_at_epoch_ms DESC, order_record_key ASC
          `).all(request.q, ...filter.parameters, ...afterParameters, request.limit));
          const summaries = passRows.filter((row) => row.result_kind === "summary");
          if (summaries.length !== 1) {
            throw new Error(`search ranked pass returned ${String(summaries.length)} summary rows`);
          }
          const summary = summaries[0];
          if (summary === undefined) throw new Error("search ranked pass omitted its summary row");
          const selected = passRows.flatMap((passRow) => {
            if (passRow.result_kind === "summary") return [];
            const row = parseJsonRecord(RunSearchRowSchema, passRow.payload);
            const record = reconcileRunSearchCorpusRow(row);
            return [Object.freeze({ record, matchRank: row.match_rank })];
          });
          return Object.freeze({ totalMatches: summary.total_matches, rows: Object.freeze(selected) });
        });
      },
      /** D179: the whole set a version bump assesses — terminal and not. */
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM workflow_runs WHERE workflow = ? ORDER BY created_at, record_key
      `).all(workflow).map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json))),
      listCurrentByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT t.record_json FROM workflow_runs AS t
        WHERE t.workflow = ?
          AND NOT EXISTS (
            SELECT 1 FROM archived_runs AS archived WHERE archived.record_key = t.record_key
          )
        ORDER BY t.created_at, t.record_key
      `).all(workflow).map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json))),
      listWorkflows: () => Object.freeze(
        z.array(z.strictObject({ workflow: z.string() })).parse(this.#database.prepare(`
          SELECT DISTINCT workflow AS workflow FROM workflow_runs ORDER BY workflow
        `).all()).map(({ workflow }) => workflow),
      ),
      findByTrace: (traceId: string) => {
        const parsed = TraceIdSchema.parse(traceId);
        const rows = this.#database.prepare(`
          SELECT record_json FROM workflow_runs
          WHERE json_extract(record_json, '$.envelope.traceId') = ?
          ORDER BY created_at, record_key
        `).all(parsed);
        if (rows.length === 0) return undefined;
        if (rows.length > 1) {
          // A trace id is frozen at enqueue and carries the run id's own first
          // four hex digits, so two rows sharing one is corruption — never a
          // "pick the newest" situation.
          throw new Error(`trace ${parsed} identifies ${String(rows.length)} runs; a trace id names exactly one`);
        }
        return parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(rows[0]).record_json);
      },
      listByItem: (input: unknown) => {
        const query = RunItemQuerySchema.parse(input);
        const rows = this.#database.prepare(`
          SELECT record_json FROM workflow_runs WHERE workflow = ? AND item_id = ? ORDER BY created_at, record_key
        `).all(query.workflow, query.itemId);
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
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
          SELECT record_json FROM workflow_runs
          WHERE state IN ('claimed', 'validating', 'running')
            ${clauses.map((clause) => `AND ${clause}`).join(" ")}
          ORDER BY heartbeat_at, record_key
        `).all(...bindings);
        return Object.freeze(rows.map((row) => {
          const run = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
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
          SELECT record_json FROM workflow_runs WHERE owner_worker_id = ? ORDER BY created_at, record_key
        `).all(WorkerIdSchema.parse(workerId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      listBySession: (sessionId: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM workflow_runs WHERE session_id = ? ORDER BY created_at, record_key
      `).all(RunSessionIdSchema.parse(sessionId)).map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json))),
      /**
       * D262. `tasks_heartbeat_idx ON workflow_runs(state, heartbeat_at)` leads on
       * `state`, so this is an index scan over a set that is almost always
       * empty. The parsed record is re-checked against the column the scan
       * selected on: the two are written together by `#writeRunRow`, and a row
       * whose column and lifecycle disagree is an integrity defect that must
       * name the run rather than quietly publish a notification about a gate
       * the record does not hold.
       */
      listParkedAtGate: () => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM workflow_runs WHERE state = 'parked-gate' ORDER BY created_at, record_key
        `).all();
        return Object.freeze(rows.map((row) => {
          const record = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
          if (record.lifecycle.state !== "parked-gate") {
            throw new Error(
              `run ${record.envelope.runId} is stored under state 'parked-gate' but its record's lifecycle `
              + `reads ${record.lifecycle.state}; the workflow_runs row and its record_json disagree`,
            );
          }
          return record;
        }));
      },
      delete: (input: unknown) => {
        const { runId, origin, commandId, now } = RunDeleteInputSchema.parse(input);
        return this.#authorityWrite("workflow_runs", () => {
          const run = this.#readRunRow(runId);
          if (run === undefined) throw new Error(`run ${runId} does not exist; nothing to delete`);
          if (run.lifecycle.state !== "terminal") {
            throw new Error(`run ${runId} is ${run.lifecycle.state}, not terminal; only a terminal run can be deleted`);
          }
          const remainingChildren = CountRowSchema.parse(
            this.#database.prepare("SELECT count(*) AS count FROM workflow_runs WHERE parent_run_id = ?").get(runId),
          ).count;
          if (remainingChildren > 0) {
            throw new Error(
              `run ${runId} still has ${String(remainingChildren)} child run(s) in authority; delete the tree `
              + "leaves first",
            );
          }
          const archived = this.#readRecord("archived_runs", runId, ArchivedRunStorageRecordSchema);
          if (origin === "archive" && archived === undefined) {
            throw new Error(`run ${runId} is not archived; the archive door cannot delete it`);
          }
          if (origin === "queue" && archived !== undefined) {
            throw new Error(`run ${runId} is archived; delete it from the Archive, not the queue`);
          }
          const evidence = runDeletionEvidence(this.#database, run);
          const removed: { table: z.infer<typeof DeletedRunTableSchema>; rows: number }[] = [];
          const tombstone = (rows: readonly { table: z.infer<typeof DeletedRunTableSchema>; rows: number }[]) =>
            DeletedRunRecordSchema.parse({
              runId,
              workflow: run.envelope.workflow,
              traceId: run.envelope.traceId,
              itemId: run.envelope.itemId,
              attempt: run.envelope.attempt,
              runNumber: run.runNumber ?? null,
              ordinalSource: "tombstone",
              tallyVersion: 3,
              origin,
              commandId,
              deletedAt: now,
              removed: rows,
            });
          /*
           * The tombstone goes in FIRST with an empty tally: every relaxed
           * never-delete trigger reads it, so nothing below can pass without
           * it. Its one admitted UPDATE is the one-way settle at the end of
           * this transaction — empty tally to final tally, once; the trigger
           * aborts anything else.
           */
          const inserted = this.#database.prepare(`
            INSERT INTO deleted_runs
              (record_key, workflow, trace_id, origin, command_id, deleted_at, record_json, created_at,
               item_id, attempt, run_number, ordinal_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            runId, run.envelope.workflow, run.envelope.traceId, origin, commandId, now,
            canonicalJsonStringify(tombstone([])), now,
            run.envelope.itemId, run.envelope.attempt, run.runNumber ?? null, "tombstone",
          );
          if (sqliteChanges(inserted.changes) !== 1) throw new Error(`deleted_runs tombstone for ${runId} was not written`);
          this.#lifecycleHooks?.afterDeleteStep?.({ runId, step: "tombstone" });
          const remove = (table: z.infer<typeof DeletedRunTableSchema>, sql: string, ...params: readonly string[]): void => {
            const rows = sqliteChanges(this.#database.prepare(sql).run(...params).changes);
            if (rows > 0) {
              const prior = removed.find((entry) => entry.table === table);
              if (prior === undefined) removed.push({ table, rows });
              else prior.rows += rows;
            }
          };
          remove("timeline_events", "DELETE FROM timeline_events WHERE run_id = ?", runId);
          // Keep an entire operation group while another retained retry owns or
          // references its evidence. The last owner collects the held group.
          for (const operationId of evidence.operationIds) {
            remove("timeline_operation_sources", "DELETE FROM timeline_operation_sources WHERE json_extract(record_json, '$.operationId') = ?", operationId);
            remove("run_operation_attempts", "DELETE FROM run_operation_attempts WHERE write_intent_id = ?", operationId);
            remove("run_operations", "DELETE FROM run_operations WHERE record_key = ?", operationId);
          }
          // Evidence and diagnostics.
          remove("diagnostic_files", `
            DELETE FROM diagnostic_files WHERE bundle_id IN (
              SELECT record_key FROM diagnostic_snapshots WHERE run_id = ?
            )`, runId);
          remove("diagnostic_snapshots", "DELETE FROM diagnostic_snapshots WHERE run_id = ?", runId);
          remove("run_receipts", "DELETE FROM run_receipts WHERE run_id = ?", runId);
          remove("dryrun_results", "DELETE FROM dryrun_results WHERE run_id = ?", runId);
          remove("activity_person_pseudonyms", "DELETE FROM activity_person_pseudonyms WHERE run_id = ?", runId);
          remove("provider_admissions", "DELETE FROM provider_admissions WHERE run_id = ?", runId);
          remove("run_failures", "DELETE FROM run_failures WHERE run_id = ?", runId);
          // Terminal authority.
          remove("run_results", "DELETE FROM run_results WHERE record_key = ?", runId);
          remove("checkpoint_payloads", "DELETE FROM checkpoint_payloads WHERE json_extract(record_json, '$.runId') = ?", runId);
          for (const key of evidence.checkpointKeys) remove("run_checkpoints", "DELETE FROM run_checkpoints WHERE record_key = ?", key);
          // Inbox items that would otherwise link to a run nobody can open.
          remove("notifications", `
            DELETE FROM notifications WHERE EXISTS (
              SELECT 1 FROM json_each(record_json, '$.links') AS link WHERE json_extract(link.value, '$.runId') = ?
            )`, runId);
          // Delegation edges in either direction, then the manifests this run authored.
          remove("delegation_dependencies", `
            DELETE FROM delegation_dependencies
            WHERE json_extract(record_json, '$.parentRunId') = ? OR json_extract(record_json, '$.childRunId') = ?`, runId, runId);
          remove("run_delegations", "DELETE FROM run_delegations WHERE json_extract(record_json, '$.parentRunId') = ?", runId);
          // Relaunch lineage belongs to the new run; deleting its source preserves it.
          remove("archive_relaunches", "DELETE FROM archive_relaunches WHERE record_key = ?", runId);
          remove("archived_runs", "DELETE FROM archived_runs WHERE record_key = ?", runId);
          // Last, the run itself.
          const task = sqliteChanges(this.#database.prepare("DELETE FROM workflow_runs WHERE record_key = ?").run(runId).changes);
          if (task !== 1) throw new Error(`deleting run ${runId} removed ${String(task)} workflow_runs rows, not exactly one`);
          removed.push({ table: "workflow_runs", rows: task });
          this.#lifecycleHooks?.afterDeleteStep?.({ runId, step: "cascade-complete" });
          const record = tombstone(removed);
          // The one-way settle: the trigger admits exactly this transition.
          const restamped = sqliteChanges(this.#database.prepare(
            "UPDATE deleted_runs SET record_json = ? WHERE record_key = ? AND record_json = ?",
          ).run(canonicalJsonStringify(record), runId, canonicalJsonStringify(tombstone([]))).changes);
          if (restamped !== 1) throw new Error(`deleted_runs tombstone for ${runId} could not carry its tally`);
          this.#lifecycleHooks?.afterDeleteStep?.({ runId, step: "tally-settled" });
          return { result: record, changes: 1 + removed.reduce((sum, entry) => sum + entry.rows, 0) };
        });
      },
      listChildren: (parentRunId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM workflow_runs WHERE parent_run_id = ? ORDER BY created_at, record_key
        `).all(RunIdSchema.parse(parentRunId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      claimNext: (input: unknown) => this.#claimNextRun(input, false),
      claimEligible: (input: unknown) => this.#claimNextRun(input, true),
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
            // A new attempt drops every single-resume affordance: a freshness
            // override authorized ONE attempt (ref workflow-model §5.5), and injected
            // patches have already been persisted as checkpoints by the
            // executor that applied them. D221: the attempt it advances INTO is
            // the item's next one, never this run's `+ 1` — a sibling run of the
            // same item may already hold that.
            envelope: nextAttemptEnvelope(
              current.envelope,
              this.#nextItemAttempt(current.envelope.workflow, current.envelope.itemId),
            ),
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
      requestCancellation: ({ runId, expectedVersion, now }) => this.#mutateRun(
        RunIdSchema.parse(runId), z.number().int().positive().parse(expectedVersion), IsoInstantSchema.parse(now),
        undefined, (current) => {
          if (runClaim(current) === undefined) throw new Error(`run ${runId} holds no claim for a cancel request`);
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
            // §6.4: the resume claim is the fence, and the resume wins. The
            // version CAS already catches the race (a claim bumps the
            // version); these arms make a stale-but-lucky caller loud too.
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
          /*
           * The request's schema already refused everything but exactly one
           * proof of death (D200), so the scan differs ONLY in that predicate.
           * Everything after it — the D118 write-intent gate, the park/requeue
           * routing, the transition legality check — is one code path for both,
           * which is the point: a startup self-sweep is the ordinary sweep
           * pointed at one worker id, not a second recovery path.
           */
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
            SELECT record_json FROM workflow_runs
            WHERE state IN ('claimed', 'validating', 'running')
              ${clauses.map((clause) => `AND ${clause}`).join(" ")}
            ORDER BY heartbeat_at, record_key
          `).all(...bindings);
          const outcomes: z.infer<typeof RunClaimSweepOutcomeSchema>[] = [];
          for (const row of rows) {
            const current = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
            // D118 (ref execution-and-sessions §3): before any queued/claimable transition, check
            // the authoritative write-intent set for this logical item. An
            // unfinished `attempting` intent means a write may have landed —
            // the run routes to ref write-safety recovery, never to ordinary requeue.
            // The lookup runs inside this same transaction; if it throws, the
            // whole sweep unwinds rather than defaulting to "no unfinished
            // write".
            const intents = this.#database.prepare(`
              SELECT record_json FROM run_operations
              WHERE status = 'attempting'
                AND json_extract(record_json, '$.workflowId') = ?
                AND json_extract(record_json, '$.itemId') = ?
              ORDER BY record_key
            `).all(current.envelope.workflow, current.envelope.itemId);
            const attempting = intents.map((intentRow) =>
              parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(intentRow).record_json));
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
              // A claimed/validating row has no legal parked-write edge; it
              // stays under its expired claim — unclaimable, loud in the
              // report — until recovery resolves the intent.
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
              envelope: nextAttemptEnvelope(
                current.envelope,
                this.#nextItemAttempt(current.envelope.workflow, current.envelope.itemId),
              ),
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

  #readProviderCounter(capability: string): ProviderBudgetCounter | undefined {
    return this.#readRecord(
      "provider_budget_counters",
      ProviderCapabilityIdSchema.parse(capability),
      ProviderBudgetCounterSchema,
    );
  }

  #writeProviderCounter(record: ProviderBudgetCounter, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("provider_budget_counters", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO provider_budget_counters (
            record_key, capability, minute_window_started_at, minute_requests,
            day_window_started_at, day_requests, day_reserved_cost_usd_micros,
            active_reservations, blocked_by_admission_id, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.capability, record.capability, record.minuteWindowStartedAt,
          record.minuteRequests, record.dayWindowStartedAt, record.dayRequests,
          record.dayReservedCostUsdMicros, record.activeReservations,
          record.blockedByAdmissionId ?? null, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE provider_budget_counters SET
            minute_window_started_at = ?, minute_requests = ?,
            day_window_started_at = ?, day_requests = ?,
            day_reserved_cost_usd_micros = ?, active_reservations = ?,
            blocked_by_admission_id = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.minuteWindowStartedAt, record.minuteRequests,
          record.dayWindowStartedAt, record.dayRequests,
          record.dayReservedCostUsdMicros, record.activeReservations,
          record.blockedByAdmissionId ?? null, record.version, json,
          record.capability, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`provider counter ${record.capability} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #writeProviderAdmission(record: ProviderAdmissionRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    const lifecycle = record.lifecycle;
    const actualCost = lifecycle.state === "settled" ? lifecycle.actualUsage.costUsdMicros : null;
    const leaseExpiresAt = lifecycle.state === "reserved" ? lifecycle.leaseExpiresAt : null;
    const deadlineAt = lifecycle.state === "reserved" ? lifecycle.deadlineAt : null;
    this.#authorityWrite("provider_admissions", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO provider_admissions (
            record_key, run_id, capability, config_snapshot_id, config_fingerprint,
            request_fingerprint, state, reserved_cost_usd_micros,
            actual_cost_usd_micros, lease_expires_at, deadline_at, version,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.admissionId, record.execution.runId, record.capability,
          record.configSnapshotId, record.configFingerprint, record.requestFingerprint,
          lifecycle.state, record.reservation.maximumCostUsdMicros, actualCost,
          leaseExpiresAt, deadlineAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE provider_admissions SET
            state = ?, actual_cost_usd_micros = ?, lease_expires_at = ?,
            deadline_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          lifecycle.state, actualCost, leaseExpiresAt, deadlineAt,
          record.version, json, record.admissionId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`provider admission ${record.admissionId} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #providerAdmissionContext(request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
    | z.infer<typeof ProviderAdmissionDenyRequestSchema>): ConfigSnapshotRecord {
    const run = this.#readRunRow(request.execution.runId);
    if (run === undefined) throw new Error(`provider admission run ${request.execution.runId} does not exist`);
    if (run.envelope.attempt !== request.execution.attempt
      || run.envelope.configSnapshotId !== request.configSnapshotId
      || run.envelope.configFingerprint !== request.configFingerprint) {
      throw new Error(`provider admission ${request.admissionId} does not match run ${request.execution.runId} execution/config identity`);
    }
    // A run-NODE admission must be the node the run is executing right now.
    // An operator-advisory admission (D178) deliberately makes no such claim:
    // ref operator-trust §4.4's advisory reads FINISHED authority on the presentation lane,
    // so requiring a live node would either make the feature impossible or
    // force it to name a node the descriptor never reached. What it still
    // binds is everything that is true — the run's identity, its retained
    // attempt, and its own config snapshot, all checked directly above.
    if (isRunNodeExecutionIdentity(request.execution)
      && (run.lifecycle.state !== "running" || run.lifecycle.currentNodeId !== request.execution.nodeId)) {
      throw new Error(`provider admission ${request.admissionId} run ${request.execution.runId} is not executing node ${request.execution.nodeId}`);
    }
    const snapshot = this.#readRecord(
      "settings_snapshots",
      request.configSnapshotId,
      ConfigSnapshotRecordSchema,
    );
    if (snapshot === undefined) throw new Error(`provider config snapshot ${request.configSnapshotId} does not exist`);
    if (snapshot.fingerprint !== request.configFingerprint) {
      throw new Error(`provider config snapshot ${request.configSnapshotId} fingerprint mismatch`);
    }
    return snapshot;
  }

  #assertProviderAdmissionRequestMatches(
    existing: ProviderAdmissionRecord,
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
  ): void {
    const expected = {
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      estimate: request.estimate,
    };
    const actual = {
      admissionId: existing.admissionId,
      execution: existing.execution,
      capability: existing.capability,
      configSnapshotId: existing.configSnapshotId,
      configFingerprint: existing.configFingerprint,
      requestFingerprint: existing.requestFingerprint,
      estimate: existing.estimate,
    };
    if (canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) {
      throw new Error(`provider admission id ${request.admissionId} was reused with different content`);
    }
  }

  #createProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const record = ProviderBudgetCounterSchema.parse({
      capability,
      minuteWindowStartedAt: fixedUtcMinuteStart(now),
      minuteRequests: 0,
      dayWindowStartedAt: fixedUtcDayStart(now),
      dayRequests: 0,
      dayReservedCostUsdMicros: 0,
      activeReservations: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.#writeProviderCounter(record, "insert");
    return record;
  }

  #rollProviderCounter(counter: ProviderBudgetCounter, now: string): ProviderBudgetCounter {
    const minuteWindowStartedAt = fixedUtcMinuteStart(now);
    const dayWindowStartedAt = fixedUtcDayStart(now);
    const minuteRolled = minuteWindowStartedAt !== counter.minuteWindowStartedAt;
    const dayRolled = dayWindowStartedAt !== counter.dayWindowStartedAt;
    if (!minuteRolled && !dayRolled) return counter;
    const rolled = ProviderBudgetCounterSchema.parse({
      ...counter,
      minuteWindowStartedAt,
      minuteRequests: minuteRolled ? 0 : counter.minuteRequests,
      dayWindowStartedAt,
      dayRequests: dayRolled ? 0 : counter.dayRequests,
      dayReservedCostUsdMicros: dayRolled ? 0 : counter.dayReservedCostUsdMicros,
      ...(dayRolled ? { blockedByAdmissionId: undefined } : {}),
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(rolled, "update");
    return rolled;
  }

  #expireProviderLeases(counter: ProviderBudgetCounter, now: string): {
    readonly counter: ProviderBudgetCounter;
    readonly expired: readonly ProviderAdmissionRecord[];
  } {
    const rows = this.#database.prepare(`
      SELECT record_json FROM provider_admissions
      WHERE capability = ? AND state = 'reserved' AND lease_expires_at <= ?
      ORDER BY lease_expires_at, record_key
    `).all(counter.capability, now);
    if (rows.length === 0) return { counter, expired: Object.freeze([]) };
    const expired: ProviderAdmissionRecord[] = [];
    for (const row of rows) {
      const current = parseJsonRecord(
        ProviderAdmissionRecordSchema,
        JsonRowSchema.parse(row).record_json,
      );
      const record = ProviderAdmissionRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "lease-expired",
          expiredAt: now,
          accounting: "full-reservation-retained",
        },
        version: current.version + 1,
        updatedAt: now,
      });
      this.#writeProviderAdmission(record, "update");
      expired.push(record);
    }
    if (counter.activeReservations < expired.length) {
      throw new Error(`provider counter ${counter.capability} cannot release ${String(expired.length)} expired leases from ${String(counter.activeReservations)} active reservations`);
    }
    const updated = ProviderBudgetCounterSchema.parse({
      ...counter,
      activeReservations: counter.activeReservations - expired.length,
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(updated, "update");
    return { counter: updated, expired: Object.freeze(expired) };
  }

  #prepareProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const initial = this.#readProviderCounter(capability) ?? this.#createProviderCounter(capability, now);
    const expired = this.#expireProviderLeases(initial, now).counter;
    return this.#rollProviderCounter(expired, now);
  }

  #providerBudgetDenial(
    counter: ProviderBudgetCounter,
    budget: ProviderBudget,
    estimate: number,
  ): z.infer<typeof ProviderUnavailableReasonSchema> | undefined {
    if (counter.activeReservations >= budget.concurrency) {
      const row = this.#database.prepare(`
        SELECT MIN(lease_expires_at) AS next_eligible_at FROM provider_admissions
        WHERE capability = ? AND state = 'reserved'
      `).get(counter.capability);
      const retryAt = NextEligibleRowSchema.parse(row).next_eligible_at;
      if (retryAt === null) throw new Error(`provider counter ${counter.capability} reports exhausted concurrency without an active lease`);
      return ProviderUnavailableReasonSchema.parse({
        code: "concurrency-exhausted",
        message: `${counter.capability} concurrency is exhausted`,
        retryAt,
      });
    }
    if (counter.minuteRequests >= budget.requestsPerMinute) {
      return ProviderUnavailableReasonSchema.parse({
        code: "rate-exhausted",
        message: `${counter.capability} fixed UTC-minute request budget is exhausted`,
        retryAt: nextFixedWindow(counter.minuteWindowStartedAt, 60_000),
      });
    }
    if (counter.dayRequests >= budget.dailyRequestLimit) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-request-exhausted",
        message: `${counter.capability} fixed UTC-day request budget is exhausted`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    if (counter.blockedByAdmissionId !== undefined
      || counter.dayReservedCostUsdMicros + estimate > budget.costLimitUsdMicros) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-cost-exhausted",
        message: counter.blockedByAdmissionId === undefined
          ? `${counter.capability} fixed UTC-day cost budget is exhausted`
          : `${counter.capability} admission ${counter.blockedByAdmissionId} breached its maximum cost estimate`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    return undefined;
  }

  #newProviderAdmission(
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
    snapshot: ConfigSnapshotRecord,
    lifecycle: ProviderAdmissionRecord["lifecycle"],
  ): ProviderAdmissionRecord {
    const budget = providerBudget(snapshot.config, request.capability);
    return ProviderAdmissionRecordSchema.parse({
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      budget,
      estimate: request.estimate,
      reservation: { requestCount: 1, maximumCostUsdMicros: request.estimate.maximumCostUsdMicros },
      lifecycle,
      version: 1,
      createdAt: request.now,
      updatedAt: request.now,
    });
  }

  #buildProviderAdmissionRepository(): ProviderAdmissionRepository {
    return Object.freeze({
      reserve: (input: unknown) => {
        const request = ProviderAdmissionReserveRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord(
            "provider_admissions",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          let counter = this.#prepareProviderCounter(request.capability, request.now);
          const budget = providerBudget(snapshot.config, request.capability);
          const denial = this.#providerBudgetDenial(
            counter,
            budget,
            request.estimate.maximumCostUsdMicros,
          );
          if (denial !== undefined) {
            const admission = this.#newProviderAdmission(request, snapshot, {
              state: "denied", deniedAt: request.now, reason: denial,
            });
            this.#writeProviderAdmission(admission, "insert");
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
          }
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            minuteRequests: counter.minuteRequests + 1,
            dayRequests: counter.dayRequests + 1,
            dayReservedCostUsdMicros:
              counter.dayReservedCostUsdMicros + request.estimate.maximumCostUsdMicros,
            activeReservations: counter.activeReservations + 1,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "reserved",
            reservedAt: request.now,
            leaseExpiresAt: request.leaseExpiresAt,
            deadlineAt: request.deadlineAt,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "reserved", admission, counter });
        });
      },
      deny: (input: unknown) => {
        const request = ProviderAdmissionDenyRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord(
            "provider_admissions",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            if (existing.lifecycle.state !== "denied"
              || canonicalJsonStringify(existing.lifecycle.reason) !== canonicalJsonStringify(request.reason)) {
              throw new Error(`provider admission id ${request.admissionId} was reused with a different denial`);
            }
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          const counter = this.#prepareProviderCounter(request.capability, request.now);
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "denied", deniedAt: request.now, reason: request.reason,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
        });
      },
      settle: (input: unknown) => {
        const request = ProviderAdmissionSettleRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRecord(
            "provider_admissions", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "settled") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.adapterDisposition === request.adapterDisposition
              && canonicalJsonStringify(current.lifecycle.actualUsage) === canonicalJsonStringify(request.actualUsage)
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.settledAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} settlement replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (request.actualUsage.costUsdMicros > current.estimate.maximumCostUsdMicros) {
            throw new Error(`provider admission ${request.admissionId} actual cost exceeds its conservative maximum estimate`);
          }
          const sameDay = fixedUtcDayStart(current.lifecycle.reservedAt) === counter.dayWindowStartedAt;
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to settle`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            dayReservedCostUsdMicros: sameDay
              ? counter.dayReservedCostUsdMicros
                - (current.estimate.maximumCostUsdMicros - request.actualUsage.costUsdMicros)
              : counter.dayReservedCostUsdMicros,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "settled",
              settledAt: request.now,
              adapterDisposition: request.adapterDisposition,
              actualUsage: request.actualUsage,
              evidence: request.evidence,
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      interrupt: (input: unknown) => {
        const request = ProviderAdmissionInterruptRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRecord(
            "provider_admissions", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "interrupted") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.code === request.code
              && current.lifecycle.message === request.message
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.interruptedAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} interruption replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to interrupt`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            ...(request.code === "cost-estimate-breach"
              ? { blockedByAdmissionId: current.admissionId }
              : {}),
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "interrupted",
              interruptedAt: request.now,
              code: request.code,
              message: request.message,
              accounting: "full-reservation-retained",
              ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      sweepExpired: (input: unknown) => {
        const request = ProviderAdmissionSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM provider_budget_counters ORDER BY capability
          `).all();
          const expired: ProviderAdmissionRecord[] = [];
          const counters: ProviderBudgetCounter[] = [];
          for (const row of rows) {
            const initial = parseJsonRecord(
              ProviderBudgetCounterSchema,
              JsonRowSchema.parse(row).record_json,
            );
            const swept = this.#expireProviderLeases(initial, request.now);
            expired.push(...swept.expired);
            counters.push(this.#rollProviderCounter(swept.counter, request.now));
          }
          return ProviderAdmissionSweepOutcomeSchema.parse({ expired, counters });
        });
      },
      get: (admissionId: string) => this.#readRecord(
        "provider_admissions",
        ProviderAdmissionIdSchema.parse(admissionId),
        ProviderAdmissionRecordSchema,
      ),
      getCounter: (capability: string) => this.#readProviderCounter(capability),
    });
  }

  #writeStartPlan(record: StartPlanRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("workflow_run_requests", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO workflow_run_requests (
            record_key, workflow, consumed_by, expires_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.startPlanId, record.workflowId, record.consumedBy?.commandId ?? null,
          record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE workflow_run_requests SET consumed_by = ?, expires_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
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
          const existing = this.#readRecord("workflow_run_requests", record.startPlanId, StartPlanRecordSchema);
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
      get: (startPlanId: string) => this.#readRecord("workflow_run_requests", startPlanId, StartPlanRecordSchema),
      consume: (input: unknown) => {
        const request = StartPlanConsumeRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const plan = this.#readRecord("workflow_run_requests", request.startPlanId, StartPlanRecordSchema);
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
          /*
           * Consuming advances the durable record from its confirmation revision
           * by exactly one. A retry must present that original revision so it
           * confirms the same body, while an unconsumed plan uses its current
           * revision normally.
           */
          const confirmationVersion = plan.consumedBy === undefined ? plan.version : plan.version - 1;
          if (request.expectedVersion !== confirmationVersion) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "version-mismatch",
              message: `start plan ${request.startPlanId} confirmation expected revision ${String(confirmationVersion)} but received ${String(request.expectedVersion)}; re-plan before starting`,
            });
          }
          if (plan.consumedBy !== undefined) {
            // The same command retrying is idempotent; a different one is a
            // second start wearing the first confirmation's clothes. This runs
            // only after all immutable confirmation bindings revalidated.
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

  #readWorkerLease(workerId: string): WorkerLeaseRecord | undefined {
    return this.#readRecord("workflow_workers", workerId, WorkerLeaseRecordSchema);
  }

  #writeWorkerLease(record: WorkerLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    const heartbeatAt = "heartbeatAt" in record.lifecycle ? record.lifecycle.heartbeatAt : null;
    this.#authorityWrite("workflow_workers", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO workflow_workers (
            record_key, worker_id, workflow, lease_generation, state, directive,
            heartbeat_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.workerId, record.workerId, record.workflow, record.leaseGeneration,
          record.lifecycle.state, record.control.directive, heartbeatAt, record.version,
          json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE workflow_workers SET
            workflow = ?, lease_generation = ?, state = ?, directive = ?,
            heartbeat_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.workflow, record.leaseGeneration, record.lifecycle.state,
          record.control.directive, heartbeatAt, record.version, json,
          record.workerId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`worker lease ${record.workerId} ${mode} affected ${String(changes)} rows`);
      return { result: undefined, changes };
    });
  }

  #readDuoCeremonyLease(credentialKey: string): DuoCeremonyLeaseRecord | undefined {
    return this.#readRecord("worker_auth", credentialKey, DuoCeremonyLeaseRecordSchema);
  }

  #writeDuoCeremonyLease(record: DuoCeremonyLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("worker_auth", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO worker_auth (
            record_key, generation, holder_worker_id, holder_system, state, expires_at,
            version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.credentialKey, record.generation, record.holder.workerId, record.holder.system,
          record.state, record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE worker_auth SET
            generation = ?, holder_worker_id = ?, holder_system = ?, state = ?, expires_at = ?,
            version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.generation, record.holder.workerId, record.holder.system, record.state,
          record.expiresAt, record.version, json, record.credentialKey, record.version - 1,
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
          INSERT INTO worker_pools (record_key, desired_workers, version, record_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(record.workflow, record.desiredWorkers, record.version, json, record.createdAt)
        : this.#database.prepare(`
          UPDATE worker_pools SET desired_workers = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(record.desiredWorkers, record.version, json, record.workflow, record.version - 1);
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
        SELECT record_json FROM worker_pools ORDER BY record_key
      `).all().map((row) => parseJsonRecord(WorkerPoolRecordSchema, JsonRowSchema.parse(row).record_json))),
    });
  }

  #buildRunSessionRepository(): RunSessionRepository {
    return Object.freeze({
      list: () => Object.freeze(this.#database.prepare("SELECT record_json FROM workflow_run_batches ORDER BY record_key").all().map((row) => parseJsonRecord(RunSessionRecordSchema, JsonRowSchema.parse(row).record_json))),
      setGrouping: (sessionId: string, expectedVersion: number, groupInQueue: boolean) => this.#authorityWrite("workflow_run_batches", () => {
        const current = this.#readRecord("workflow_run_batches", RunSessionIdSchema.parse(sessionId), RunSessionRecordSchema);
        if (current === undefined) throw new Error(`workflow batch ${sessionId} does not exist`);
        if (current.version !== expectedVersion) throw new Error(`workflow batch ${sessionId} version conflict`);
        const record = RunSessionRecordSchema.parse({ ...current, groupInQueue, version: current.version + 1 });
        const result = this.#database.prepare(`UPDATE workflow_run_batches SET group_in_queue = ?, version = ?, record_json = ? WHERE record_key = ? AND version = ?`)
          .run(record.groupInQueue ? 1 : 0, record.version, canonicalJsonStringify(record), sessionId, expectedVersion);
        if (sqliteChanges(result.changes) !== 1) throw new Error(`workflow batch ${sessionId} version conflict`);
        return { result: record, changes: 1 };
      }),
      insert: (input: unknown) => {
        const record = RunSessionRecordSchema.parse(input);
        const json = canonicalJsonStringify(record);
        return this.#authorityWrite("workflow_run_batches", () => {
          const existing = this.#readRecord("workflow_run_batches", record.sessionId, RunSessionRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`run session ${record.sessionId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          const result = this.#database.prepare(`
            INSERT INTO workflow_run_batches (record_key, workflow, started_at, record_json, created_at, group_in_queue, version)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(record.sessionId, record.workflow, record.startedAt, json, record.createdAt, record.groupInQueue ? 1 : 0, record.version);
          return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
        });
      },
      get: (sessionId: string) =>
        this.#readRecord("workflow_run_batches", RunSessionIdSchema.parse(sessionId), RunSessionRecordSchema),
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM workflow_run_batches WHERE workflow = ? ORDER BY started_at, record_key
      `).all(WorkflowIdSchema.parse(workflow)).map((row) => parseJsonRecord(RunSessionRecordSchema, JsonRowSchema.parse(row).record_json))),
    });
  }

  #buildWorkerLeaseRepository(): WorkerLeaseRepository {
    return Object.freeze({
      start: (input: unknown) => {
        const request = WorkerStartRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readWorkerLease(request.workerId);
          if (existing !== undefined && isLiveWorker(existing)) {
            return WorkerStartOutcomeSchema.parse({
              state: "conflict",
              lease: existing,
              message: `worker ${request.workerId} already holds a live lease in state ${existing.lifecycle.state}`,
            });
          }
          const lease = WorkerLeaseRecordSchema.parse({
            workerId: request.workerId,
            workflow: request.workflow,
            browserSystems: request.browserSystems,
            processId: request.processId,
            leaseGeneration: (existing?.leaseGeneration ?? 0) + 1,
            lifecycle: { state: "starting", startedAt: request.now },
            control: { directive: "run", requestedAt: request.now, requestedBy: request.requestedBy },
            version: (existing?.version ?? 0) + 1,
            createdAt: existing?.createdAt ?? request.now,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(lease, existing === undefined ? "insert" : "update");
          return WorkerStartOutcomeSchema.parse({ state: "started", lease });
        });
      },
      get: (workerId: string) => this.#readWorkerLease(workerId),
      listLive: (workflow?: string) => {
        const states = LIVE_WORKER_STATES.map(() => "?").join(", ");
        const rows = workflow === undefined
          ? this.#database.prepare(`
            SELECT record_json FROM workflow_workers WHERE state IN (${states}) ORDER BY record_key
          `).all(...LIVE_WORKER_STATES)
          : this.#database.prepare(`
            SELECT record_json FROM workflow_workers WHERE state IN (${states}) AND workflow = ? ORDER BY record_key
          `).all(...LIVE_WORKER_STATES, WorkflowIdSchema.parse(workflow));
        return Object.freeze(rows.map((row) => parseJsonRecord(WorkerLeaseRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      reportLifecycle: (input: unknown) => {
        const request = WorkerLifecycleRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readWorkerLease(request.workerId);
          if (current === undefined) throw new Error(`worker lease ${request.workerId} does not exist`);
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
            // A worker reporting that it has stopped also settles the directive:
            // a stopped lease carrying "run" would read as a worker that should
            // be running and is not.
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
      control: (input: unknown) => {
        const request = WorkerControlRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
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
            SELECT record_json FROM workflow_workers
            WHERE state IN (${states}) AND heartbeat_at IS NOT NULL AND heartbeat_at < ?
            ORDER BY record_key
          `).all(...LIVE_WORKER_STATES, request.staleBefore);
          const expired: WorkerLeaseRecord[] = [];
          for (const row of rows) {
            const current = parseJsonRecord(WorkerLeaseRecordSchema, JsonRowSchema.parse(row).record_json);
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
    const current = this.#readRecord("run_operations", writeIntentId, WriteIntentRecordSchema);
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
    const attempt = this.#readRecord("run_operation_attempts", writeAttemptId, WriteAttemptRecordSchema);
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
      SELECT record_json FROM run_operations WHERE system = ? AND idempotency_key = ?
    `).get(system, idempotencyKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #insertWriteIntent(record: WriteIntentRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_operations", () => {
      const existingById = this.#readRecord("run_operations", record.writeIntentId, WriteIntentRecordSchema);
      if (existingById !== undefined) throw new Error(`write intent id ${record.writeIntentId} already exists with a different permanent key`);
      const digestCollision = this.#database.prepare(`
        SELECT system, idempotency_key FROM run_operations WHERE idempotency_key_digest = ?
      `).get(record.idempotencyKeyDigest);
      if (digestCollision !== undefined) {
        throw new Error("write intent digest is already bound to a different permanent key");
      }
      const result = this.#database.prepare(`
        INSERT INTO run_operations (
          record_key, system, idempotency_key, idempotency_key_digest, status, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.writeIntentId,
        record.system,
        record.idempotencyKey,
        record.idempotencyKeyDigest,
        record.status,
        json,
        record.createdAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertWriteAttempt(record: WriteAttemptRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_operation_attempts", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_operation_attempts (
          record_key, write_intent_id, generation, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.writeAttemptId, record.writeIntentId, record.generation, json, record.recordedAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #replaceWriteIntent(record: WriteIntentRecord): void {
    const result = this.#database.prepare(`
      UPDATE run_operations
      SET status = ?, record_json = ?
      WHERE record_key = ? AND idempotency_key_digest = ?
    `).run(record.status, canonicalJsonStringify(record), record.writeIntentId, record.idempotencyKeyDigest);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write intent ${record.writeIntentId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #replaceWriteAttempt(record: WriteAttemptRecord): void {
    const result = this.#database.prepare(`
      UPDATE run_operation_attempts SET record_json = ?
      WHERE record_key = ? AND write_intent_id = ? AND generation = ?
    `).run(canonicalJsonStringify(record), record.writeAttemptId, record.writeIntentId, record.generation);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write attempt ${record.writeAttemptId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #assertAtomicCommitMatchesIntent(
    input: z.infer<typeof AtomicWriteCommitInputSchema>,
    intent: Extract<WriteIntentRecord, { status: "attempting" }>,
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

  #buildProjectionRepositories(): ProjectionRepositories {
    const repository = (table: ProjectionTableName): ProjectionRepository => Object.freeze({
      upsert: (input: unknown) => {
        const record = ProjectionStorageRecordSchema.parse(input);
        return this.#projectionWrite(table, () => {
          this.#database.prepare(`
            INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
            ON CONFLICT(record_key) DO UPDATE SET
              record_json = excluded.record_json,
              created_at = excluded.created_at
          `).run(record.projectionKey, canonicalJsonStringify(record), record.updatedAt);
          return record;
        });
      },
      get: (projectionKey: string) => this.#readRecord(table, projectionKey, ProjectionStorageRecordSchema),
      clear: () => this.#projectionWrite(table, () => {
        const result = this.#database.prepare(`DELETE FROM ${table}`).run();
        return sqliteChanges(result.changes);
      }),
    });
    return Object.freeze({
      spans: repository("spans"),
      gates: repository("gates"),
      notes: repository("notes"),
    });
  }
}
