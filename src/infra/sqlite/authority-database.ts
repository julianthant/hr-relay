import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
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
  AuthorityTableNameSchema,
  ProjectionTableNameSchema,
  type AuthorityTableName,
  type ProjectionTableName,
  type TableName,
} from "../../domain/authority.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../domain/commands.js";
import {
  deriveExplorerAppliedCompiledFingerprint,
  deriveExplorerEditFingerprint,
  ExplorerEditProjectionAckRequestSchema,
  ExplorerEditProjectionOutboxRecordSchema,
  ExplorerEditReviewConsumeRequestSchema,
  ExplorerEditReviewTokenRecordSchema,
  type ExplorerEditProjectionOutboxRecord,
  type ExplorerEditReviewTokenRecord,
} from "../../domain/dashboard/explorer-edit.js";
import { providerBudget, type ProviderBudget } from "../../domain/config/schema.js";
import {
  ConfigSnapshotRecordSchema,
  ConfigSnapshotWriteSchema,
  type ConfigSnapshotRecord,
} from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  BrowserSystemIdSchema,
  DiagnosticBundleIdSchema,
  FailureFingerprintSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  OutboxIdSchema,
  ProviderAdmissionIdSchema,
  ProviderCapabilityIdSchema,
  RunIdSchema,
  RunSessionIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "../../domain/ids.js";
import {
  CaptureFinalizationOutboxSchema,
  CaptureSessionSchema,
  type CaptureFinalizationOutbox,
  type CaptureSession,
} from "../../domain/capture.js";
import { nextAttemptEnvelope } from "../../domain/run/envelope.js";
import {
  RunRecordSchema,
  runClaim,
  runTransitionViolation,
  type RunRecord,
} from "../../domain/run/record.js";
import {
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  type RunResultRecord,
} from "../../domain/run/result.js";
import {
  TerminalAuthorizationRecordSchema,
  type TerminalAuthorizationRecord,
} from "../../domain/run/terminal-authorization.js";
import {
  StartPlanRecordSchema,
  isStartPlanExpired,
  type StartPlanRecord,
} from "../../domain/run/start-plan.js";
import {
  RunTerminalOutboxRecordSchema,
  type RunTerminalOutboxRecord,
} from "../../domain/run/terminal-outbox.js";
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
import { RunSessionRecordSchema, type RunSessionRecord } from "../../domain/run/session.js";
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
  LedgerLeaseOutcomeSchema,
  LedgerPartitionRecordSchema,
  LedgerProjectionRecordSchema,
  ledgerPartitionRecordKey,
  type LedgerLeaseOutcome,
  type LedgerPartitionRecord,
  type LedgerProjectionRecord,
} from "../../domain/ledger-projection.js";
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
import { DryRunWriteSafetyCountsSchema } from "../../domain/trust/dry-run-scenario.js";
import {
  FixRecordSchema,
  KnowledgeRecordSchema,
  type FixRecord,
  type KnowledgeRecord,
} from "../../domain/trust/knowledge.js";
import {
  LedgerLeaseRequestSchema,
  LedgerReleaseRequestSchema,
  LedgerSequenceAssignmentSchema,
  LedgerAppendConfirmationSchema,
} from "./ledger-projection-contracts.js";
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
  SQLITE_MIGRATIONS,
  auditMigrationTableCoverage,
  tableClassification,
} from "./migrations.js";
import {
  AuthorityCopyInspectionSchema,
  type AuthorityCopyInspection,
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

export const AuthorityDatabaseOptionsSchema = z.strictObject({
  path: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  migrationOwner: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
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
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandRequestSchema>>;
  get(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
}>;

/**
 * D113 replay reads the recorded outcome by COMMAND id: one journaled command
 * has exactly one recorded audit, and re-delivery must return that exact
 * result rather than re-executing. Two audits for one command is corruption.
 */
type CommandAuditRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandAuditRecordSchema>>;
  get(auditId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findByCommand(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
}>;

export type ExplorerEditReviewConsumeOutcome =
  | Readonly<{ state: "consumed" | "already-consumed"; record: ExplorerEditReviewTokenRecord }>
  | Readonly<{
    state: "refused";
    code: "not-found" | "expired" | "draft-mismatch" | "provenance-mismatch" | "already-consumed";
    message: string;
  }>;

export type ExplorerEditReviewRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<ExplorerEditReviewTokenRecord>;
  get(reviewTokenId: string): ExplorerEditReviewTokenRecord | undefined;
  consume(input: unknown): ExplorerEditReviewConsumeOutcome;
}>;

export type ExplorerEditOutboxRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<ExplorerEditProjectionOutboxRecord>;
  get(commandId: string): ExplorerEditProjectionOutboxRecord | undefined;
  latestForWorkflow(workflowId: string): ExplorerEditProjectionOutboxRecord | undefined;
  listPending(): readonly ExplorerEditProjectionOutboxRecord[];
  listProjectedCurrent(): readonly ExplorerEditProjectionOutboxRecord[];
  /** Read only after proving command, audit, token, and outbox identity agree. */
  requireJournaled(commandId: string): ExplorerEditProjectionOutboxRecord;
  markProjected(input: unknown): Readonly<{
    state: "acknowledged" | "already-projected";
    record: ExplorerEditProjectionOutboxRecord;
  }>;
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
   * Ref operator-trust §2.3/§2.5: what external writes did THIS run fence? `write_intents`
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
type RunRepository = Readonly<{
  enqueue(input: unknown): ImmutableInsertResult<RunRecord>;
  get(runId: string): RunRecord | undefined;
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
  /**
   * D269 — the MEMBERSHIP of a run session, derived from the run rows that
   * carry the id (`tasks.session_id`). There is no stored member list to
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
  /**
   * The distinct workflows that HAVE runs. An application-scope bump reaches
   * every one of them, including workflows whose descriptor has since been
   * retired: their runs are prior-version by definition, and enumerating the
   * live registry instead would leave exactly those rows unsweepable.
   */
  listWorkflows(): readonly string[];
  claimNext(input: unknown): RunClaimOutcome;
  renewClaim(input: unknown): RunHeartbeatOutcome;
  transition(input: unknown): RunUpdateOutcome;
  requeue(input: unknown): RunUpdateOutcome;
  resume(input: unknown): RunUpdateOutcome;
  updatePresentation(input: unknown): RunUpdateOutcome;
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
}>;

/** Ref guards-and-tests §10.6. Citable scenario evidence is insert-only. */
type DryRunScenarioResultRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<DryRunScenarioResult>;
  get(resultId: string): DryRunScenarioResult | undefined;
  list(): readonly DryRunScenarioResult[];
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
type LedgerProjectionRepository = Readonly<{
  listPendingOutbox(): readonly z.infer<typeof AtomicOutboxRecordSchema>[];
  getOutbox(outboxId: string): z.infer<typeof AtomicOutboxRecordSchema> | undefined;
  listLedgerOutboxByWriteIntent(writeIntentId: string): readonly z.infer<typeof AtomicOutboxRecordSchema>[];
  acquireLease(input: unknown): LedgerLeaseOutcome;
  releaseLease(input: unknown): LedgerPartitionRecord;
  getPartition(system: string, date: string): LedgerPartitionRecord | undefined;
  assignSequence(input: unknown): LedgerProjectionRecord;
  markAppended(input: unknown): LedgerProjectionRecord;
  getProjection(outboxId: string): LedgerProjectionRecord | undefined;
  listProjections(system: string, date: string): readonly LedgerProjectionRecord[];
  listUnappendedProjections(): readonly LedgerProjectionRecord[];
}>;

type RunResultRepository = Readonly<{
  get(runId: string): RunResultRecord | undefined;
}>;

type RunTerminalOutboxRepository = Readonly<{
  get(outboxId: string): RunTerminalOutboxRecord | undefined;
  findByRun(runId: string): RunTerminalOutboxRecord | undefined;
}>;

type TerminalAuthorizationRepository = Readonly<{
  get(runId: string): TerminalAuthorizationRecord | undefined;
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
 * dashboard-started group. Insert-only and member-less: `runs.listBySession`
 * is the membership, derived from the run rows that carry the id.
 */
type RunSessionRepository = Readonly<{
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
  capturePhotoOrder: ImmutableRepository<OpaqueAuthorityRecord>;
}>;

/**
 * Ref data-intake-and-edit-data §5.1 (D167): the durable capture session. One row per session,
 * updated under a version CAS — an open session survives a restart because
 * this row IS the session, not a projection of an in-memory one.
 */
type CaptureSessionRepository = Readonly<{
  create(input: unknown): CaptureSession;
  get(sessionId: string): CaptureSession | undefined;
  /** Whole-record write; commits only when `version` is exactly current+1. */
  update(input: unknown): CaptureSession;
  /** `open`/`finalizing`/`failed` — what a restarted dashboard must reload. */
  listActive(): readonly CaptureSession[];
  /**
   * The phone presents a token; the row holds only its DIGEST (D167), so this
   * is how a token becomes a session. It looks in EVERY state on purpose: a
   * finalized session still has to tell the phone "Sent", and a discarded or
   * expired one still has to be refused with the SAME answer an unknown token
   * gets (D174) — which the caller can only produce if it can tell them apart.
   */
  findByTokenDigest(tokenDigest: string): CaptureSession | undefined;
}>;

/**
 * Ref data-intake-and-edit-data §5.1 (D167): the stable-keyed finalize outbox. A crash at any
 * boundary replays the same row; `settle` is a `pending → done|failed` CAS
 * idempotent on an already-settled row, and `getByStableKey` is how a
 * duplicate finalize converges instead of minting a second handoff.
 */
type CaptureFinalizationOutboxRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<CaptureFinalizationOutbox>;
  get(outboxId: string): CaptureFinalizationOutbox | undefined;
  getByStableKey(stableKey: string): CaptureFinalizationOutbox | undefined;
  listPending(): readonly CaptureFinalizationOutbox[];
  settle(input: unknown): Readonly<{
    state: "settled" | "already-settled";
    record: CaptureFinalizationOutbox;
  }>;
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
  runs: RunRepository;
  terminalAuthorizations: TerminalAuthorizationRepository;
  failures: FailureRepository;
  runResults: RunResultRepository;
  runTerminalOutbox: RunTerminalOutboxRepository;
  diagnosticBundles: DiagnosticBundleRepository;
  evidenceReceipts: EvidenceReceiptRepository;
  dryRunScenarioResults: DryRunScenarioResultRepository;
  intakeSessions: IntakeSessionRepository;
  intakeManifests: IntakeManifestRepository;
  ocrExtractions: OcrExtractionRepository;
  knowledgeRecords: KnowledgeRepository;
  fixRecords: FixRecordRepository;
  ledgerProjection: LedgerProjectionRepository;
  providerAdmissions: ProviderAdmissionRepository;
  startPlans: StartPlanRepository;
  workerLeases: WorkerLeaseRepository;
  duoCeremonyLeases: DuoCeremonyLeaseRepository;
  workerPools: WorkerPoolRepository;
  runSessions: RunSessionRepository;
  commands: CommandRepository;
  commandAudits: CommandAuditRepository;
  explorerEditReviews: ExplorerEditReviewRepository;
  explorerEditOutbox: ExplorerEditOutboxRepository;
  dependencies: DependencyRepository;
  delegationManifests: ImmutableRepository<z.infer<typeof DelegationManifestSchema>>;
  gateResults: ImmutableRepository<z.infer<typeof GateResultRecordSchema>> & Readonly<{
    /** Every gate this run resolved, oldest first — the D204 receipt read. */
    listByRun(runId: string): readonly z.infer<typeof GateResultRecordSchema>[];
  }>;
  runCheckpoints: RunCheckpointRepository;
  notifications: NotificationRepository;
  configSnapshots: ImmutableRepository<z.infer<typeof ConfigSnapshotRecordSchema>>;
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
  durableOutbox: ReadRepository<z.infer<typeof AtomicOutboxRecordSchema>>;
  artifactOutbox: ArtifactOutboxRepository;
  artifactSinkHeads: ArtifactSinkHeadRepository;
  captureSessions: CaptureSessionRepository;
  captureFinalizationOutboxes: CaptureFinalizationOutboxRepository;
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
  runsView: ProjectionRepository;
}>;

const OpaqueAuthorityTableSchema = z.enum([
  "ocr_approvals",
  "capture_photo_order",
]);

const JsonRowSchema = z.strictObject({ record_json: z.string() });
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
/** D221 — `max()` over no rows is SQL NULL, which is "this item has never run". */
const MaxAttemptRowSchema = z.strictObject({ attempt: z.number().int().positive().nullable() });
const MaxRunNumberRowSchema = z.strictObject({ run_number: z.number().int().positive().nullable() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const AuthorityRecordFingerprintRowSchema = z.strictObject({ record_key: z.string(), record_json: z.string() });
const AuthorityMetaFingerprintRowSchema = z.strictObject({
  singleton_id: z.literal(1),
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});

function parseJsonRecord<Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> {
  return schema.parse(JSON.parse(text));
}

function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    FROM authority_meta WHERE singleton_id = 1
  `).get());
}

const INVARIANT_QUERIES = Object.freeze([
  {
    name: "run-columns-match-record",
    sql: "SELECT count(*) AS count FROM tasks WHERE workflow <> json_extract(record_json, '$.envelope.workflow') OR item_id <> json_extract(record_json, '$.envelope.itemId') OR state <> json_extract(record_json, '$.lifecycle.state') OR priority <> json_extract(record_json, '$.envelope.priority') OR attempt <> json_extract(record_json, '$.envelope.attempt') OR version <> json_extract(record_json, '$.version') OR claim_generation <> json_extract(record_json, '$.claimGeneration') OR run_number IS NOT json_extract(record_json, '$.runNumber') OR session_id IS NOT json_extract(record_json, '$.sessionId')",
  },
  {
    name: "run-claim-owner-matches-record",
    sql: "SELECT count(*) AS count FROM tasks WHERE state IN ('claimed','validating','running') AND (owner_worker_id <> json_extract(record_json, '$.lifecycle.workerId') OR heartbeat_at <> json_extract(record_json, '$.lifecycle.heartbeatAt'))",
  },
  {
    name: "failure-columns-match-record",
    sql: "SELECT count(*) AS count FROM failures WHERE run_id <> json_extract(record_json, '$.runId')",
  },
  {
    name: "terminal-authorization-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_authorizations WHERE record_key IS NOT json_extract(record_json, '$.runId') OR kind IS NOT json_extract(record_json, '$.kind') OR expected_version IS NOT json_extract(record_json, '$.expectedVersion') OR worker_id IS NOT json_extract(record_json, '$.claim.workerId') OR claim_generation IS NOT json_extract(record_json, '$.claim.claimGeneration') OR created_at IS NOT json_extract(record_json, '$.authorizedAt')",
  },
  {
    name: "failed-runs-bind-failure",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM failures AS failure
          WHERE failure.record_key = json_extract(run.record_json, '$.lifecycle.failureId')
            AND failure.run_id = run.record_key
        )
    `,
  },
  {
    name: "failures-bind-failed-run",
    sql: `
      SELECT count(*) AS count FROM failures AS failure
      JOIN tasks AS run ON run.record_key = failure.run_id
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(run.record_json, '$.lifecycle.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "failure-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM failures AS failure
      JOIN tasks AS run ON run.record_key = failure.run_id
      WHERE json_extract(failure.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(failure.record_json, '$.traceId') <> json_extract(run.record_json, '$.envelope.traceId')
        OR json_extract(failure.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
    `,
  },
  {
    name: "failed-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
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
      SELECT count(*) AS count FROM failures AS failure
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = failure.run_id
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'failed'
        OR json_extract(authorization.record_json, '$.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "run-result-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_results WHERE workflow <> json_extract(record_json, '$.workflowId') OR attempt <> json_extract(record_json, '$.attempt') OR result_digest <> json_extract(record_json, '$.resultDigest') OR record_key <> json_extract(record_json, '$.runId')",
  },
  {
    name: "run-terminal-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_outbox WHERE run_id <> json_extract(record_json, '$.payload.runId') OR state <> json_extract(record_json, '$.projection.state')",
  },
  {
    name: "run-result-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN tasks AS run ON run.record_key = result.record_key
      WHERE json_extract(result.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(result.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
        OR json_extract(result.record_json, '$.descriptorVersion') <> json_extract(run.record_json, '$.envelope.descriptorVersion')
        OR json_extract(result.record_json, '$.contractFingerprint') <> json_extract(run.record_json, '$.envelope.contractFingerprint')
        OR json_extract(result.record_json, '$.configFingerprint') <> json_extract(run.record_json, '$.envelope.configFingerprint')
        OR json_extract(result.record_json, '$.configSnapshotId') <> json_extract(run.record_json, '$.envelope.configSnapshotId')
    `,
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
      SELECT count(*) AS count FROM tasks AS run
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
    name: "results-bind-done-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN tasks AS run ON run.record_key = result.record_key
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'done'
    `,
  },
  {
    name: "done-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
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
      LEFT JOIN tasks AS run ON run.record_key = authorization.record_key
      LEFT JOIN failures AS failure
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
        OR run.version IS NOT authorization.expected_version + 1
        OR run.claim_generation IS NOT authorization.claim_generation
        OR json_extract(run.record_json, '$.lifecycle.state') IS NOT 'terminal'
        OR json_extract(run.record_json, '$.lifecycle.endedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR json_extract(run.record_json, '$.updatedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt')
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
    sql: "SELECT count(*) AS count FROM duo_ceremony_leases WHERE record_key <> json_extract(record_json, '$.credentialKey') OR generation <> json_extract(record_json, '$.generation') OR holder_worker_id <> json_extract(record_json, '$.holder.workerId') OR holder_system <> json_extract(record_json, '$.holder.system') OR state <> json_extract(record_json, '$.state') OR expires_at <> json_extract(record_json, '$.expiresAt') OR version <> json_extract(record_json, '$.version')",
  },
  {
    name: "worker-lease-columns-match-record",
    sql: "SELECT count(*) AS count FROM leases WHERE worker_id <> record_key OR worker_id <> json_extract(record_json, '$.workerId') OR workflow <> json_extract(record_json, '$.workflow') OR lease_generation <> json_extract(record_json, '$.leaseGeneration') OR state <> json_extract(record_json, '$.lifecycle.state') OR directive <> json_extract(record_json, '$.control.directive') OR version <> json_extract(record_json, '$.version')",
  },
  {
    // One worker owns at most one active run (ref execution-and-sessions §0.3). This is the
    // invariant the whole claim protocol exists to hold, so it is checked in
    // the database rather than trusted from the loop that maintains it.
    name: "worker-owns-at-most-one-active-run",
    sql: `
      SELECT count(*) AS count FROM (
        SELECT owner_worker_id FROM tasks
        WHERE state IN ('claimed','validating','running')
        GROUP BY owner_worker_id HAVING count(*) > 1
      )
    `,
  },
  {
    name: "commands-family-column-matches-record",
    sql: "SELECT count(*) AS count FROM commands WHERE family <> json_extract(record_json, '$.family')",
  },
  {
    name: "command-audit-parent-column-matches-record",
    sql: "SELECT count(*) AS count FROM command_audits WHERE command_id <> json_extract(record_json, '$.request.commandId')",
  },
  {
    name: "dependency-manifest-column-matches-record",
    sql: "SELECT count(*) AS count FROM dependencies WHERE manifest_id <> json_extract(record_json, '$.manifestId')",
  },
  {
    name: "write-intent-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_intents WHERE system <> json_extract(record_json, '$.system') OR idempotency_key <> json_extract(record_json, '$.idempotencyKey') OR idempotency_key_digest <> json_extract(record_json, '$.idempotencyKeyDigest') OR status <> json_extract(record_json, '$.status')",
  },
  {
    name: "write-attempt-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_attempts WHERE write_intent_id <> json_extract(record_json, '$.writeIntentId') OR generation <> json_extract(record_json, '$.generation')",
  },
  {
    name: "durable-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM durable_outbox WHERE write_intent_id <> json_extract(record_json, '$.aggregate.writeIntentId') OR generation <> json_extract(record_json, '$.aggregate.generation') OR kind <> json_extract(record_json, '$.payload.kind')",
  },
  {
    name: "failure-fingerprint-column-matches-record",
    sql: "SELECT count(*) AS count FROM failures WHERE fingerprint IS NOT json_extract(record_json, '$.fingerprint')",
  },
  {
    name: "notification-columns-match-record",
    sql: "SELECT count(*) AS count FROM notifications WHERE record_key IS NOT json_extract(record_json, '$.notificationId') OR actor_id IS NOT json_extract(record_json, '$.actorId') OR dedupe_fingerprint IS NOT json_extract(record_json, '$.dedupeFingerprint') OR status IS NOT json_extract(record_json, '$.status') OR seen_count IS NOT json_extract(record_json, '$.count') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "diagnostic-bundle-columns-match-record",
    sql: "SELECT count(*) AS count FROM diagnostic_bundles WHERE record_key IS NOT json_extract(record_json, '$.bundleId') OR run_id IS NOT json_extract(record_json, '$.runId') OR origin_kind IS NOT json_extract(record_json, '$.origin.kind') OR failure_id IS NOT json_extract(record_json, '$.origin.failureId') OR content_digest IS NOT json_extract(record_json, '$.contentDigest') OR retention_kind IS NOT json_extract(record_json, '$.retention.kind') OR purge_after IS NOT json_extract(record_json, '$.retention.purgeAfter')",
  },
  {
    name: "diagnostic-attachment-binds-its-bundle",
    sql: `
      SELECT count(*) AS count FROM diagnostic_attachments AS attachment
      LEFT JOIN diagnostic_bundles AS bundle ON bundle.record_key = attachment.bundle_id
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
      SELECT count(*) AS count FROM diagnostic_bundles AS bundle
      WHERE json_array_length(bundle.record_json, '$.attachments')
        <> (SELECT count(*) FROM diagnostic_attachments AS attachment WHERE attachment.bundle_id = bundle.record_key)
    `,
  },
  {
    name: "evidence-receipt-columns-match-record",
    sql: "SELECT count(*) AS count FROM evidence_receipts WHERE record_key IS NOT json_extract(record_json, '$.receiptId') OR run_id IS NOT json_extract(record_json, '$.runId') OR workflow IS NOT json_extract(record_json, '$.workflowId') OR attempt IS NOT json_extract(record_json, '$.attempt') OR result IS NOT json_extract(record_json, '$.result') OR confidence IS NOT json_extract(record_json, '$.confidence') OR failure_id IS NOT json_extract(record_json, '$.failure.value')",
  },
  {
    name: "dry-run-scenario-result-columns-match-record",
    sql: "SELECT count(*) AS count FROM dry_run_scenario_results WHERE record_key IS NOT json_extract(record_json, '$.resultId') OR scenario_id IS NOT json_extract(record_json, '$.scenarioId') OR workflow IS NOT json_extract(record_json, '$.workflow') OR subject_label IS NOT json_extract(record_json, '$.subjectLabel') OR manifest_digest IS NOT json_extract(record_json, '$.manifestDigest') OR verdict IS NOT json_extract(record_json, '$.verdict') OR execution_state IS NOT json_extract(record_json, '$.execution.state') OR run_id IS NOT json_extract(record_json, '$.execution.runId') OR trace_id IS NOT json_extract(record_json, '$.execution.traceId') OR wall_time_ms IS NOT json_extract(record_json, '$.wallTimeMs') OR created_at IS NOT json_extract(record_json, '$.recordedAt')",
  },
  {
    name: "started-dry-run-scenario-result-binds-run",
    sql: `
      SELECT count(*) AS count FROM dry_run_scenario_results AS result
      LEFT JOIN tasks AS run ON run.record_key = result.run_id
      WHERE result.execution_state = 'started' AND (
        run.record_key IS NULL
        OR result.workflow IS NOT run.workflow
        OR result.trace_id IS NOT json_extract(run.record_json, '$.envelope.traceId')
        OR json_extract(run.record_json, '$.envelope.dryRun') IS NOT 1
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
    name: "ledger-partition-columns-match-record",
    sql: "SELECT count(*) AS count FROM ledger_partitions WHERE record_key IS NOT (system || ':' || ledger_date) OR system IS NOT json_extract(record_json, '$.system') OR ledger_date IS NOT json_extract(record_json, '$.date') OR next_seq IS NOT json_extract(record_json, '$.nextSeq') OR lease_holder IS NOT json_extract(record_json, '$.lease.holder') OR lease_expires_at IS NOT json_extract(record_json, '$.lease.expiresAt') OR lease_generation IS NOT json_extract(record_json, '$.leaseGeneration') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "ledger-projection-columns-match-record",
    sql: "SELECT count(*) AS count FROM ledger_projections WHERE record_key IS NOT json_extract(record_json, '$.outboxId') OR partition_key IS NOT (system || ':' || ledger_date) OR system IS NOT json_extract(record_json, '$.system') OR ledger_date IS NOT json_extract(record_json, '$.date') OR seq IS NOT json_extract(record_json, '$.seq') OR state IS NOT json_extract(record_json, '$.lifecycle.state') OR line_digest IS NOT json_extract(record_json, '$.lineDigest') OR assigned_at IS NOT json_extract(record_json, '$.assignedAt') OR appended_at IS NOT json_extract(record_json, '$.lifecycle.appendedAt')",
  },
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
    name: "ledger-projection-binds-a-ledger-outbox",
    sql: `
      SELECT count(*) AS count FROM ledger_projections AS projection
      LEFT JOIN durable_outbox AS outbox ON outbox.record_key = projection.record_key
      WHERE outbox.record_key IS NULL OR outbox.kind IS NOT 'ledger-entry'
    `,
  },
  {
    name: "projected-ledger-outbox-has-an-appended-line",
    sql: `
      SELECT count(*) AS count FROM durable_outbox AS outbox
      LEFT JOIN ledger_projections AS projection ON projection.record_key = outbox.record_key
      WHERE outbox.kind = 'ledger-entry'
        AND json_extract(outbox.record_json, '$.projection.state') = 'projected'
        AND (projection.record_key IS NULL
          OR projection.state IS NOT 'appended'
          OR projection.line_digest IS NOT json_extract(outbox.record_json, '$.projection.projectionFingerprint'))
    `,
  },
  {
    name: "attempting-write-has-current-attempt",
    sql: `
      SELECT count(*) AS count FROM write_intents AS intent
      WHERE intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM write_attempts AS attempt
        WHERE attempt.record_key = json_extract(intent.record_json, '$.currentAttemptId')
          AND attempt.write_intent_id = intent.record_key
          AND attempt.generation = json_extract(intent.record_json, '$.generation')
      )
    `,
  },
] as const);

function invariantViolations(database: DatabaseSync): readonly string[] {
  return INVARIANT_QUERIES.flatMap(({ name, sql }) => {
    const { count } = CountRowSchema.parse(database.prepare(sql).get());
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
}

function validateAuthorityRecordSchemas(database: DatabaseSync): number {
  let validated = 0;
  for (const [table, schema] of Object.entries(AUTHORITY_RECORD_SCHEMA_REGISTRY)) {
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${table} ORDER BY record_key
    `).all());
    for (const row of rows) {
      try {
        parseJsonRecord(schema, row.record_json);
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
  const authorityRows = AuthorityTableNameSchema.options.map((name) => {
    if (name === "authority_meta") {
      const row = AuthorityMetaFingerprintRowSchema.parse(database.prepare(`
        SELECT singleton_id, schema_version, authority_generation, updated_at,
               migration_owner, migration_started_at
        FROM authority_meta WHERE singleton_id = 1
      `).get());
      return [name, row] as const;
    }
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${name} ORDER BY record_key
    `).all());
    return [name, rows] as const;
  });
  return createHash("sha256").update(canonicalJsonStringify(authorityRows)).digest("hex");
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    leases: count("SELECT count(*) AS count FROM leases"),
    durableOutbox: count("SELECT count(*) AS count FROM durable_outbox WHERE json_extract(record_json, '$.projection.state') = 'pending'"),
    runTerminalOutbox: count("SELECT count(*) AS count FROM run_terminal_outbox WHERE state = 'pending'"),
    providerReservations: count("SELECT count(*) AS count FROM provider_admissions WHERE state = 'reserved'"),
    artifactOutbox: count("SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
    captureFinalizationOutboxes: count("SELECT count(*) AS count FROM capture_finalization_outboxes"),
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
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    return inspectOpenDatabase(database, false);
  } finally {
    database.close();
  }
}

export class AuthorityDatabase implements Disposable {
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #closed = false;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | undefined;
  #authorityDirty = false;
  #writeCommitHooks: AuthorityWriteCommitHooks | undefined;
  #terminalizationHooks: AuthorityTerminalizationHooks | undefined;

  readonly authority: AuthorityRepositories;
  readonly projections: ProjectionRepositories;

  private constructor(
    input: unknown,
    clock: Clock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const existed = options.path !== ":memory:" && existsSync(options.path);
    if (existed && statSync(options.path).size === 0) {
      throw new Error(`authority database ${options.path} exists but is empty; refusing to replace it`);
    }
    this.#clock = clock;
    this.#writeCommitHooks = writeCommitHooks;
    this.#terminalizationHooks = terminalizationHooks;
    this.#path = options.path;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#database = new DatabaseSync(options.path, {
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
      this.#configureConnection();
      this.#initializeSchema(existed, options.migrationOwner);
      this.#validateDatabase();
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
  ): AuthorityDatabase {
    return new AuthorityDatabase(input, clock, writeCommitHooks, terminalizationHooks);
  }

  static sourceDatabaseIdentity(path: string): string {
    return createHash("sha256")
      .update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`)
      .digest("hex");
  }

  static inspectExistingReadOnly(path: string, busyTimeoutMs = 250): AuthorityCopyInspection {
    return inspectExistingDatabaseReadOnly(path, busyTimeoutMs);
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
      const existingAuthorization = this.#readRecord(
        "run_terminal_authorizations",
        request.failure.runId,
        TerminalAuthorizationRecordSchema,
      );
      const existing = this.#readRecord("failures", request.failure.failureId, FailureRecordSchema);
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
          || current.lifecycle.errorSummary !== request.failure.summary) {
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
        lifecycle: {
          state: "terminal",
          outcome: "failed",
          endedAt: request.authorization.authorizedAt,
          failureId: request.failure.failureId,
          errorSummary: request.failure.summary,
        },
        version: current.version + 1,
        updatedAt: request.authorization.authorizedAt,
      });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`run ${request.failure.runId}: ${violation}`);
      this.#assertTerminalAuthorizationConsequence(request.authorization, terminal);
      this.#insertTerminalAuthorization(request.authorization);
      this.#terminalizationHooks?.afterFailureStorageStep?.("authorization");
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
    const request = SuccessTerminalizationRequestSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.result.runId);
      if (current === undefined) throw new Error(`run ${request.result.runId} does not exist`);
      this.#assertResultMatchesRun(request.result, request.outbox, current);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#readRecord(
        "run_terminal_authorizations",
        request.result.runId,
        TerminalAuthorizationRecordSchema,
      );
      const existingResult = this.#readRecord("run_results", request.result.runId, RunResultRecordSchema);
      const existingOutbox = this.#findRunTerminalOutboxByRun(request.result.runId);
      if (existingAuthorization !== undefined || existingResult !== undefined || existingOutbox !== undefined) {
        if (existingAuthorization === undefined || existingResult === undefined || existingOutbox === undefined) {
          throw new Error(`run ${request.result.runId} has a partial terminal authorization/result/outbox settlement`);
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
        if (canonicalJsonStringify(existingOutbox) !== canonicalJsonStringify(request.outbox)) {
          throw new Error(`run terminal outbox for ${request.result.runId} already exists with different content`);
        }
        this.#assertTerminalAuthorizationConsequence(existingAuthorization, current);
        return SuccessTerminalizationReportSchema.parse({
          state: "replayed",
          authorization: existingAuthorization,
          result: existingResult,
          outbox: existingOutbox,
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

      this.#insertTerminalAuthorization(request.authorization);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("authorization");
      this.#insertRunResult(request.result);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("result");
      this.#insertRunTerminalOutbox(request.outbox);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("outbox");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterSuccessStorageStep?.("run");
      return SuccessTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        result: request.result,
        outbox: request.outbox,
        run: terminal,
      });
    });
  }

  commitWriteAttempt(input: unknown): AtomicWriteCommitReport {
    const parsed = AtomicWriteCommitInputSchema.parse(input);
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
      this.#insertDurableOutbox(parsed.ledgerOutbox);
      this.#writeCommitHooks?.afterStorageStep("ledger-outbox");
      this.#insertDurableOutbox(parsed.terminalSpanOutbox);
      this.#writeCommitHooks?.afterStorageStep("terminal-span-outbox");

      return AtomicWriteCommitReportSchema.parse({
        state: "committed",
        intent: committedIntent,
        attempt: committedAttempt,
        ledgerOutbox: parsed.ledgerOutbox,
        terminalSpanOutbox: parsed.terminalSpanOutbox,
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
    const exactCommonConsequence = Number(run.version) === Number(authorization.expectedVersion) + 1
      && Number(run.claimGeneration) === Number(authorization.claim.claimGeneration)
      && run.lifecycle.state === "terminal"
      && run.lifecycle.outcome === authorization.kind
      && run.lifecycle.endedAt === authorization.authorizedAt
      && run.updatedAt === authorization.authorizedAt;
    const exactArmConsequence = authorization.kind === "done"
      || (run.lifecycle.state === "terminal"
        && run.lifecycle.outcome === "failed"
        && run.lifecycle.failureId === authorization.failureId);
    if (!exactCommonConsequence || !exactArmConsequence) {
      throw new Error(
        `run ${authorization.runId} does not match its exact ${authorization.kind} terminal authorization consequence`,
      );
    }
  }

  #assertResultMatchesRun(
    result: RunResultRecord,
    outbox: RunTerminalOutboxRecord,
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
    if (outbox.payload.runId !== result.runId
      || outbox.payload.workflowId !== result.workflowId
      || outbox.payload.attempt !== result.attempt
      || outbox.payload.resultDigest !== result.resultDigest
      || outbox.projection.state !== "pending") {
      throw new Error(`run terminal outbox ${outbox.outboxId} does not bind the exact result for ${result.runId}`);
    }
  }

  #assertStoredTerminalDependencies(result: RunResultRecord, current: RunRecord): void {
    for (const dependency of result.dependencies) {
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

  #insertTerminalAuthorization(record: TerminalAuthorizationRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_terminal_authorizations", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_terminal_authorizations
          (record_key, kind, expected_version, worker_id, claim_generation, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.runId,
        record.kind,
        record.expectedVersion,
        record.claim.workerId,
        record.claim.claimGeneration,
        json,
        record.authorizedAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertFailure(record: FailureRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("failures", () => {
      const result = this.#database.prepare(`
        INSERT INTO failures (record_key, run_id, fingerprint, record_json, created_at)
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

  #insertRunTerminalOutbox(record: RunTerminalOutboxRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_terminal_outbox", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_terminal_outbox
          (record_key, run_id, state, record_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.outboxId, record.payload.runId, record.projection.state, json, record.createdAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #findRunTerminalOutboxByRun(runId: string): RunTerminalOutboxRecord | undefined {
    const row = this.#database.prepare(`
      SELECT record_json FROM run_terminal_outbox WHERE run_id = ?
    `).get(RunIdSchema.parse(runId));
    if (row === undefined) return undefined;
    return parseJsonRecord(RunTerminalOutboxRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #assertOpen(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
  }

  #configureConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#database.exec(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
  }

  #initializeSchema(existed: boolean, migrationOwner: string): void {
    if (!existed) {
      this.#runMigrations(0, migrationOwner);
      return;
    }
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
    if (userVersion < CURRENT_AUTHORITY_SCHEMA_VERSION) this.#runMigrations(userVersion, migrationOwner);
  }

  #runMigrations(fromVersion: number, migrationOwner: string): void {
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      const migrations = SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion);
      for (const migration of migrations) {
        for (const statement of migration.statements) this.#database.exec(statement);
        if (migration.version === 1) {
          this.#database.prepare(`
            INSERT INTO authority_meta (
              singleton_id, schema_version, authority_generation, updated_at,
              migration_owner, migration_started_at
            ) VALUES (1, ?, 0, ?, ?, ?)
          `).run(migration.version, this.#now(), migrationOwner, this.#now());
        } else {
          this.#database.prepare(`
            UPDATE authority_meta
            SET schema_version = ?, migration_owner = ?, migration_started_at = ?, updated_at = ?
            WHERE singleton_id = 1
          `).run(migration.version, migrationOwner, this.#now(), this.#now());
        }
        this.#database.exec(`PRAGMA user_version = ${String(migration.version)}`);
      }
      this.#database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
      this.#database.prepare(`
        UPDATE authority_meta
        SET migration_owner = NULL, migration_started_at = NULL, updated_at = ?
        WHERE singleton_id = 1
      `).run(this.#now());
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
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
      if (this.#transactionMode === "projection" && mode === "authority") {
        throw new Error("authority mutation cannot run inside a projection transaction");
      }
      const savepoint = `authority_nested_${String(this.#savepointSequence += 1)}`;
      const dirtyBefore = this.#authorityDirty;
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
        throw error;
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;
    this.#transactionMode = mode;
    this.#authorityDirty = false;
    try {
      const result = work();
      if (this.#authorityDirty) {
        const update = this.#database.prepare(`
          UPDATE authority_meta
          SET authority_generation = authority_generation + 1, updated_at = ?
          WHERE singleton_id = 1
        `).run(this.#now());
        if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation update did not affect the singleton metadata row");
      }
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
    if (table === "authority_meta") throw new Error("authority_meta is mutated only by the generation and migration protocols");
    return this.#withTransaction("authority", () => {
      const outcome = operation();
      if (outcome.changes > 0) this.#authorityDirty = true;
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

  #insertSimpleRecord<Schema extends z.ZodType>(
    table: Exclude<AuthorityTableName, "authority_meta">,
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
        return this.#authorityWrite("diagnostic_bundles", () => {
          const existing = this.#readRecord("diagnostic_bundles", record.bundleId, DiagnosticBundleSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`diagnostic bundle ${record.bundleId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          const result = this.#database.prepare(`
            INSERT INTO diagnostic_bundles
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
              INSERT INTO diagnostic_attachments
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
      get: (bundleId: string) => this.#readRecord("diagnostic_bundles", bundleId, DiagnosticBundleSchema),
      listByRun: (runId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM diagnostic_bundles WHERE run_id = ? ORDER BY created_at, record_key
        `).all(RunIdSchema.parse(runId));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          DiagnosticBundleSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
      listAttachments: (bundleId: string) => readAttachments(
        "SELECT record_json FROM diagnostic_attachments WHERE bundle_id = ? ORDER BY record_key",
        DiagnosticBundleIdSchema.parse(bundleId),
      ),
      findByArtifact: (artifactId: string) => readAttachments(
        "SELECT record_json FROM diagnostic_attachments WHERE artifact_id = ? ORDER BY record_key",
        ArtifactIdSchema.parse(artifactId),
      ),
      listRetentionDue: (now: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM diagnostic_bundles
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
        return this.#authorityWrite("diagnostic_bundles", () => {
          const existing = this.#readRecord("diagnostic_bundles", key, DiagnosticBundleSchema);
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
            "DELETE FROM diagnostic_attachments WHERE bundle_id = ?",
          ).run(key);
          const bundle = this.#database.prepare(
            "DELETE FROM diagnostic_bundles WHERE record_key = ?",
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

  #buildLedgerProjectionRepository(): AuthorityRepositories["ledgerProjection"] {
    const readPartition = (system: string, date: string): LedgerPartitionRecord | undefined => this.#readRecord(
      "ledger_partitions",
      ledgerPartitionRecordKey(system, date),
      LedgerPartitionRecordSchema,
    );
    const writePartition = (record: LedgerPartitionRecord, mode: "insert" | "update"): void => {
      const key = ledgerPartitionRecordKey(record.system, record.date);
      const json = canonicalJsonStringify(record);
      const holder = record.lease.state === "held" ? record.lease.holder : null;
      const expiresAt = record.lease.state === "held" ? record.lease.expiresAt : null;
      const result = mode === "insert"
        ? this.#database.prepare(`
            INSERT INTO ledger_partitions
              (record_key, system, ledger_date, next_seq, lease_holder, lease_expires_at, lease_generation, version, record_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            key, record.system, record.date, record.nextSeq, holder, expiresAt,
            record.leaseGeneration, record.version, json, record.createdAt,
          )
        : this.#database.prepare(`
            UPDATE ledger_partitions
            SET next_seq = ?, lease_holder = ?, lease_expires_at = ?, lease_generation = ?, version = ?, record_json = ?
            WHERE record_key = ? AND version = ?
          `).run(
            record.nextSeq, holder, expiresAt, record.leaseGeneration,
            record.version, json, key, record.version - 1,
          );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`ledger partition ${key} ${mode} affected ${String(changes)} rows`);
    };
    const assertHeldLease = (
      partition: LedgerPartitionRecord | undefined,
      projectorId: string,
      leaseGeneration: number,
      key: string,
    ): LedgerPartitionRecord => {
      if (partition === undefined) throw new Error(`ledger partition ${key} does not exist`);
      if (partition.lease.state !== "held"
        || partition.lease.holder !== projectorId
        || partition.leaseGeneration !== leaseGeneration) {
        throw new Error(`ledger partition ${key} is not leased to ${projectorId} at generation ${String(leaseGeneration)}`);
      }
      return partition;
    };
    return Object.freeze({
      listPendingOutbox: () => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM durable_outbox
          WHERE kind = 'ledger-entry'
            AND json_extract(record_json, '$.projection.state') = 'pending'
          ORDER BY created_at, record_key
        `).all();
        return Object.freeze(rows.map((row) => parseJsonRecord(
          AtomicOutboxRecordSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
      getOutbox: (outboxId: string) => this.#readRecord(
        "durable_outbox",
        OutboxIdSchema.parse(outboxId),
        AtomicOutboxRecordSchema,
      ),
      /**
       * Every LEDGER outbox row one write intent produced, oldest first.
       *
       * This is what lets the archive name the ledger LINES a run filed
       * without copying them: the sweep walks the run's intents, this walks
       * each intent's outbox rows, and `getProjection` turns each into a
       * `(system, date, seq)` pointer. `durable_outbox_intent_id_idx` is the
       * index it rides. `kind` is filtered here rather than by the caller
       * because a `write-committed-span` row is not a ledger line and a
       * pointer to one would name a partition that does not exist.
       */
      listLedgerOutboxByWriteIntent: (writeIntentId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM durable_outbox
          WHERE write_intent_id = ? AND kind = 'ledger-entry'
          ORDER BY created_at, record_key
        `).all(WriteIntentIdSchema.parse(writeIntentId));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          AtomicOutboxRecordSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
      acquireLease: (input: unknown): LedgerLeaseOutcome => {
        const request = LedgerLeaseRequestSchema.parse(input);
        return this.#authorityWrite("ledger_partitions", () => {
          const current = readPartition(request.system, request.date);
          if (current === undefined) {
            const created = LedgerPartitionRecordSchema.parse({
              system: request.system,
              date: request.date,
              nextSeq: 0,
              lease: { state: "held", holder: request.projectorId, expiresAt: request.expiresAt },
              leaseGeneration: 1,
              version: 1,
              createdAt: request.now,
              updatedAt: request.now,
            });
            writePartition(created, "insert");
            return {
              result: LedgerLeaseOutcomeSchema.parse({ state: "acquired", partition: created }),
              changes: 1,
            };
          }
          const live = current.lease.state === "held"
            && Date.parse(current.lease.expiresAt) > Date.parse(request.now);
          if (live && current.lease.state === "held" && current.lease.holder !== request.projectorId) {
            return {
              result: LedgerLeaseOutcomeSchema.parse({ state: "held", partition: current }),
              changes: 0,
            };
          }
          const renewed = LedgerPartitionRecordSchema.parse({
            ...current,
            lease: { state: "held", holder: request.projectorId, expiresAt: request.expiresAt },
            leaseGeneration: current.leaseGeneration + 1,
            version: current.version + 1,
            updatedAt: request.now,
          });
          writePartition(renewed, "update");
          return {
            result: LedgerLeaseOutcomeSchema.parse({ state: "acquired", partition: renewed }),
            changes: 1,
          };
        });
      },
      releaseLease: (input: unknown) => {
        const request = LedgerReleaseRequestSchema.parse(input);
        const key = ledgerPartitionRecordKey(request.system, request.date);
        return this.#authorityWrite("ledger_partitions", () => {
          const current = assertHeldLease(
            readPartition(request.system, request.date),
            request.projectorId,
            request.leaseGeneration,
            key,
          );
          const released = LedgerPartitionRecordSchema.parse({
            ...current,
            lease: { state: "unleased" },
            version: current.version + 1,
            updatedAt: request.now,
          });
          writePartition(released, "update");
          return { result: released, changes: 1 };
        });
      },
      getPartition: (system: string, date: string) => readPartition(system, date),
      assignSequence: (input: unknown) => {
        const request = LedgerSequenceAssignmentSchema.parse(input);
        const key = ledgerPartitionRecordKey(request.system, request.date);
        return this.#authorityWrite("ledger_projections", () => {
          const current = assertHeldLease(
            readPartition(request.system, request.date),
            request.projectorId,
            request.leaseGeneration,
            key,
          );
          const existing = this.#readRecord("ledger_projections", request.outboxId, LedgerProjectionRecordSchema);
          if (existing !== undefined) {
            // Idempotent by outbox id. A second assignment for the same entry
            // would mint a second sequence for one filed transaction.
            if (existing.lineDigest !== request.lineDigest) {
              throw new Error(`ledger outbox ${request.outboxId} was already assigned sequence ${String(existing.seq)} with a different line`);
            }
            return { result: existing, changes: 0 };
          }
          const outbox = this.#readRecord("durable_outbox", request.outboxId, AtomicOutboxRecordSchema);
          if (outbox === undefined || outbox.payload.kind !== "ledger-entry") {
            throw new Error(`ledger outbox ${request.outboxId} is not a durable ledger-entry row`);
          }
          const record = LedgerProjectionRecordSchema.parse({
            outboxId: request.outboxId,
            system: request.system,
            date: request.date,
            seq: current.nextSeq,
            lineDigest: request.lineDigest,
            projectedBy: request.projectorId,
            lifecycle: { state: "assigned" },
            assignedAt: request.assignedAt,
          });
          const inserted = this.#database.prepare(`
            INSERT INTO ledger_projections
              (record_key, partition_key, system, ledger_date, seq, state, line_digest, assigned_at, appended_at, record_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            record.outboxId, key, record.system, record.date, record.seq,
            record.lifecycle.state, record.lineDigest, record.assignedAt,
            canonicalJsonStringify(record), record.assignedAt,
          );
          if (sqliteChanges(inserted.changes) !== 1) {
            throw new Error(`ledger projection ${request.outboxId} insertion affected no rows`);
          }
          writePartition(LedgerPartitionRecordSchema.parse({
            ...current,
            nextSeq: current.nextSeq + 1,
            version: current.version + 1,
            updatedAt: request.assignedAt,
          }), "update");
          return { result: record, changes: 1 };
        });
      },
      markAppended: (input: unknown) => {
        const request = LedgerAppendConfirmationSchema.parse(input);
        const key = ledgerPartitionRecordKey(request.system, request.date);
        return this.#authorityWrite("ledger_projections", () => {
          assertHeldLease(
            readPartition(request.system, request.date),
            request.projectorId,
            request.leaseGeneration,
            key,
          );
          const existing = this.#readRecord("ledger_projections", request.outboxId, LedgerProjectionRecordSchema);
          if (existing === undefined) throw new Error(`ledger projection ${request.outboxId} has no assigned sequence`);
          if (existing.lineDigest !== request.lineDigest) {
            throw new Error(`ledger projection ${request.outboxId} appended a line that does not match its assignment`);
          }
          if (existing.lifecycle.state === "appended" && existing.lifecycle.appendedAt !== request.appendedAt) {
            throw new Error(`ledger projection ${request.outboxId} was already appended at ${existing.lifecycle.appendedAt}`);
          }
          const appended = LedgerProjectionRecordSchema.parse({
            ...existing,
            lifecycle: { state: "appended", appendedAt: request.appendedAt },
          });
          let changes = 0;
          if (existing.lifecycle.state === "assigned") {
            const updated = this.#database.prepare(`
              UPDATE ledger_projections
              SET state = 'appended', appended_at = ?, record_json = ?
              WHERE record_key = ? AND state = 'assigned'
            `).run(request.appendedAt, canonicalJsonStringify(appended), request.outboxId);
            if (sqliteChanges(updated.changes) !== 1) {
              throw new Error(`ledger projection ${request.outboxId} append confirmation affected no rows`);
            }
            changes += 1;
          }
          // Marking the outbox is separate and separately idempotent: the crash
          // window between the line landing and the outbox flipping is exactly
          // what recovery has to be able to close without re-appending.
          const outbox = this.#readRecord("durable_outbox", request.outboxId, AtomicOutboxRecordSchema);
          if (outbox === undefined) throw new Error(`ledger outbox ${request.outboxId} disappeared before projection`);
          if (outbox.projection.state === "projected") {
            if (outbox.projection.projectionFingerprint !== request.lineDigest) {
              throw new Error(`ledger outbox ${request.outboxId} was already projected with a different line`);
            }
            return { result: appended, changes };
          }
          const projected = AtomicOutboxRecordSchema.parse({
            ...outbox,
            projection: {
              state: "projected",
              projectedAt: request.appendedAt,
              projectionFingerprint: request.lineDigest,
            },
          });
          const marked = this.#database.prepare(`
            UPDATE durable_outbox SET record_json = ? WHERE record_key = ?
          `).run(canonicalJsonStringify(projected), request.outboxId);
          if (sqliteChanges(marked.changes) !== 1) {
            throw new Error(`ledger outbox ${request.outboxId} projection marking affected no rows`);
          }
          return { result: appended, changes: changes + 1 };
        });
      },
      getProjection: (outboxId: string) => this.#readRecord(
        "ledger_projections",
        OutboxIdSchema.parse(outboxId),
        LedgerProjectionRecordSchema,
      ),
      listProjections: (system: string, date: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM ledger_projections WHERE partition_key = ? ORDER BY seq
        `).all(ledgerPartitionRecordKey(system, date));
        return Object.freeze(rows.map((row) => parseJsonRecord(
          LedgerProjectionRecordSchema,
          JsonRowSchema.parse(row).record_json,
        )));
      },
      /** The crash window: a sequence was handed out, the line never landed. */
      listUnappendedProjections: () => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM ledger_projections WHERE state = 'assigned' ORDER BY partition_key, seq
        `).all();
        return Object.freeze(rows.map((row) => parseJsonRecord(
          LedgerProjectionRecordSchema,
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
      runs: this.#buildRunRepository(),
      terminalAuthorizations: Object.freeze({
        get: (runId: string) => this.#readRecord(
          "run_terminal_authorizations",
          RunIdSchema.parse(runId),
          TerminalAuthorizationRecordSchema,
        ),
      }),
      failures: Object.freeze({
        get: (failureId: string) => this.#readRecord("failures", failureId, FailureRecordSchema),
        listByRun: (runId: string) => this.#listFailures(
          "SELECT record_json FROM failures WHERE run_id = ? ORDER BY created_at, record_key",
          RunIdSchema.parse(runId),
        ),
        listByFingerprint: (fingerprint: string) => this.#listFailures(
          "SELECT record_json FROM failures WHERE fingerprint = ? ORDER BY created_at, record_key",
          FailureFingerprintSchema.parse(fingerprint),
        ),
        countByFingerprint: (fingerprint: string) => CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM failures WHERE fingerprint = ?
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
          return this.#authorityWrite("evidence_receipts", () => {
            const existing = this.#readRecord("evidence_receipts", record.receiptId, RunEvidenceReceiptSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`evidence receipt ${record.receiptId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO evidence_receipts
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
        get: (receiptId: string) => this.#readRecord("evidence_receipts", receiptId, RunEvidenceReceiptSchema),
        findByRun: (runId: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM evidence_receipts WHERE run_id = ?
          `).get(RunIdSchema.parse(runId));
          if (row === undefined) return undefined;
          return parseJsonRecord(RunEvidenceReceiptSchema, JsonRowSchema.parse(row).record_json);
        },
      }),
      dryRunScenarioResults: Object.freeze({
        insert: (input: unknown) => {
          const record = DryRunScenarioResultSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("dry_run_scenario_results", () => {
            const existing = this.#readRecord(
              "dry_run_scenario_results",
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
              const run = this.#readRecord("tasks", record.execution.runId, RunRecordSchema);
              if (run === undefined
                || run.envelope.dryRun !== true
                || run.envelope.workflow !== record.workflow
                || run.envelope.traceId !== record.execution.traceId) {
                throw new Error(
                  `dry-run scenario result ${record.resultId} does not match its dry-run execution`,
                );
              }
            }
            const result = this.#database.prepare(`
              INSERT INTO dry_run_scenario_results
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
          "dry_run_scenario_results",
          resultId,
          DryRunScenarioResultSchema,
        ),
        list: () => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM dry_run_scenario_results ORDER BY created_at, record_key
        `).all().map((row) =>
          parseJsonRecord(DryRunScenarioResultSchema, JsonRowSchema.parse(row).record_json))),
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
      ledgerProjection: this.#buildLedgerProjectionRepository(),
      runResults: Object.freeze({
        get: (runId: string) => this.#readRecord(
          "run_results",
          RunIdSchema.parse(runId),
          RunResultRecordSchema,
        ),
      }),
      runTerminalOutbox: Object.freeze({
        get: (outboxId: string) => this.#readRecord(
          "run_terminal_outbox",
          outboxId,
          RunTerminalOutboxRecordSchema,
        ),
        findByRun: (runId: string) => this.#findRunTerminalOutboxByRun(runId),
      }),
      providerAdmissions: this.#buildProviderAdmissionRepository(),
      startPlans: this.#buildStartPlanRepository(),
      workerLeases: this.#buildWorkerLeaseRepository(),
      duoCeremonyLeases: this.#buildDuoCeremonyLeaseRepository(),
      workerPools: this.#buildWorkerPoolRepository(),
      runSessions: this.#buildRunSessionRepository(),
      explorerEditReviews: Object.freeze({
        insert: (input: unknown) => {
          const record = ExplorerEditReviewTokenRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("explorer_edit_reviews", () => {
            const existing = this.#readRecord(
              "explorer_edit_reviews",
              record.reviewTokenId,
              ExplorerEditReviewTokenRecordSchema,
            );
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`Explorer review token ${record.reviewTokenId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO explorer_edit_reviews
                (record_key, workflow, draft_fingerprint, state, expires_at, consumed_by, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.reviewTokenId,
              record.draft.workflowId,
              record.draftFingerprint,
              record.state,
              record.expiresAt,
              record.consumedBy ?? null,
              json,
              record.issuedAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (reviewTokenId: string) => this.#readRecord(
          "explorer_edit_reviews",
          reviewTokenId,
          ExplorerEditReviewTokenRecordSchema,
        ),
        consume: (input: unknown): ExplorerEditReviewConsumeOutcome => {
          const request = ExplorerEditReviewConsumeRequestSchema.parse(input);
          return this.#authorityWrite("explorer_edit_reviews", () => {
            const current = this.#readRecord(
              "explorer_edit_reviews",
              request.reviewTokenId,
              ExplorerEditReviewTokenRecordSchema,
            );
            if (current === undefined) {
              return { result: Object.freeze({ state: "refused" as const, code: "not-found" as const,
                message: `Explorer review token ${request.reviewTokenId} does not exist` }), changes: 0 };
            }
            if (current.requestedBy !== request.requestedBy || current.source !== request.source) {
              return { result: Object.freeze({ state: "refused" as const, code: "provenance-mismatch" as const,
                message: `Explorer review token ${request.reviewTokenId} does not match the command's reviewer provenance` }),
              changes: 0 };
            }
            const sameDraft = current.draftFingerprint === deriveExplorerEditFingerprint(request.draft)
              && canonicalJsonStringify(current.draft) === canonicalJsonStringify(request.draft);
            if (current.state === "consumed") {
              if (current.consumedBy === request.commandId && sameDraft) {
                return { result: Object.freeze({ state: "already-consumed" as const, record: current }), changes: 0 };
              }
              return { result: Object.freeze({ state: "refused" as const, code: "already-consumed" as const,
                message: `Explorer review token ${request.reviewTokenId} was already consumed` }), changes: 0 };
            }
            if (request.now >= current.expiresAt) {
              return { result: Object.freeze({ state: "refused" as const, code: "expired" as const,
                message: `Explorer review token ${request.reviewTokenId} expired at ${current.expiresAt}` }), changes: 0 };
            }
            if (!sameDraft) {
              return { result: Object.freeze({ state: "refused" as const, code: "draft-mismatch" as const,
                message: `Explorer review token ${request.reviewTokenId} does not authorize this draft` }), changes: 0 };
            }
            const next = ExplorerEditReviewTokenRecordSchema.parse({
              ...current,
              state: "consumed",
              consumedBy: request.commandId,
              consumedAt: request.now,
            });
            const result = this.#database.prepare(`
              UPDATE explorer_edit_reviews
              SET state = 'consumed', consumed_by = ?, record_json = ?
              WHERE record_key = ? AND state = 'issued'
            `).run(request.commandId, canonicalJsonStringify(next), request.reviewTokenId);
            if (sqliteChanges(result.changes) !== 1) {
              throw new Error(`Explorer review token ${request.reviewTokenId} consumption lost its CAS`);
            }
            return { result: Object.freeze({ state: "consumed" as const, record: next }), changes: 1 };
          });
        },
      }),
      explorerEditOutbox: Object.freeze({
        insert: (input: unknown) => {
          const record = ExplorerEditProjectionOutboxRecordSchema.parse(input);
          if (record.override.compiledFingerprint !== deriveExplorerAppliedCompiledFingerprint(record.override)) {
            throw new Error(`Explorer outbox ${record.commandId} has a compiled fingerprint mismatch`);
          }
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("explorer_edit_outbox", () => {
            const command = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            const token = this.#readRecord(
              "explorer_edit_reviews",
              record.reviewTokenId,
              ExplorerEditReviewTokenRecordSchema,
            );
            if (command?.family !== "explorer-edit"
              || command.payload.reviewTokenId !== record.reviewTokenId
              || token?.state !== "consumed"
              || token.consumedBy !== record.commandId
              || token.requestedBy !== command.requestedBy
              || token.source !== command.source
              || canonicalJsonStringify(token.draft) !== canonicalJsonStringify(command.payload.draft)
              || canonicalJsonStringify(token.draft) !== canonicalJsonStringify({
                draftVersion: 1,
                workflowId: record.override.workflowId,
                baseDescriptorVersion: record.override.baseDescriptorVersion,
                baseContractFingerprint: record.override.baseContractFingerprint,
                baseOverrideRevision: record.override.revision - 1,
                changes: record.override.changes,
              })) {
              throw new Error(`Explorer outbox ${record.commandId} is not backed by its exact consumed review and command`);
            }
            const existing = this.#readRecord(
              "explorer_edit_outbox",
              record.commandId,
              ExplorerEditProjectionOutboxRecordSchema,
            );
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`Explorer outbox ${record.commandId} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO explorer_edit_outbox
                (record_key, review_token_id, workflow, revision, state, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              record.commandId,
              record.reviewTokenId,
              record.override.workflowId,
              record.override.revision,
              record.state,
              json,
              record.createdAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => this.#readRecord(
          "explorer_edit_outbox",
          commandId,
          ExplorerEditProjectionOutboxRecordSchema,
        ),
        latestForWorkflow: (workflowId: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM explorer_edit_outbox
            WHERE workflow = ? ORDER BY revision DESC LIMIT 1
          `).get(WorkflowIdSchema.parse(workflowId));
          if (row === undefined) return undefined;
          return parseJsonRecord(ExplorerEditProjectionOutboxRecordSchema, JsonRowSchema.parse(row).record_json);
        },
        listPending: () => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM explorer_edit_outbox
          WHERE state = 'pending' ORDER BY workflow, revision
        `).all().map((row) => parseJsonRecord(
          ExplorerEditProjectionOutboxRecordSchema,
          JsonRowSchema.parse(row).record_json,
        ))),
        listProjectedCurrent: () => Object.freeze(this.#database.prepare(`
          SELECT current.record_json FROM explorer_edit_outbox AS current
          WHERE current.state = 'projected'
            AND NOT EXISTS (
              SELECT 1 FROM explorer_edit_outbox AS newer
              WHERE newer.workflow = current.workflow
                AND newer.state = 'projected'
                AND newer.revision > current.revision
            )
          ORDER BY current.workflow
        `).all().map((row) => parseJsonRecord(
          ExplorerEditProjectionOutboxRecordSchema,
          JsonRowSchema.parse(row).record_json,
        ))),
        requireJournaled: (commandId: string) => {
          const outbox = this.#readRecord(
            "explorer_edit_outbox",
            commandId,
            ExplorerEditProjectionOutboxRecordSchema,
          );
          const command = this.#readRecord("commands", commandId, CommandRequestSchema);
          const auditRows = this.#database.prepare(`
            SELECT record_json FROM command_audits WHERE command_id = ? ORDER BY record_key
          `).all(commandId);
          if (auditRows.length !== 1) {
            throw new Error(`Explorer projection ${commandId} requires exactly one command audit`);
          }
          const auditRow = auditRows[0];
          if (auditRow === undefined) throw new Error(`Explorer projection ${commandId} has no command audit`);
          const audit = parseJsonRecord(
            CommandAuditRecordSchema,
            JsonRowSchema.parse(auditRow).record_json,
          );
          if (outbox === undefined || command?.family !== "explorer-edit") {
            throw new Error(`Explorer projection ${commandId} lacks its outbox or Explorer command`);
          }
          const token = this.#readRecord(
            "explorer_edit_reviews",
            outbox.reviewTokenId,
            ExplorerEditReviewTokenRecordSchema,
          );
          const target = {
            family: "explorer-edit",
            workflowId: outbox.override.workflowId,
            revision: outbox.override.revision,
          };
          if (command.payload.reviewTokenId !== outbox.reviewTokenId
            || token?.state !== "consumed"
            || token.consumedBy !== commandId
            || token.requestedBy !== command.requestedBy
            || token.source !== command.source
            || canonicalJsonStringify(token.draft) !== canonicalJsonStringify(command.payload.draft)
            || audit.result.state !== "applied"
            || !audit.result.affectedTargets.some((candidate) =>
              canonicalJsonStringify(candidate) === canonicalJsonStringify(target))) {
            throw new Error(`Explorer projection ${commandId} does not match its journal, audit, and review authority`);
          }
          return outbox;
        },
        markProjected: (input: unknown) => {
          const request = ExplorerEditProjectionAckRequestSchema.parse(input);
          return this.#authorityWrite("explorer_edit_outbox", () => {
            const current = this.#readRecord(
              "explorer_edit_outbox",
              request.commandId,
              ExplorerEditProjectionOutboxRecordSchema,
            );
            if (current === undefined) throw new Error(`Explorer outbox ${request.commandId} does not exist`);
            if (current.state === "projected") {
              return { result: Object.freeze({ state: "already-projected" as const, record: current }), changes: 0 };
            }
            const next = ExplorerEditProjectionOutboxRecordSchema.parse({
              ...current,
              state: "projected",
              projectedAt: request.projectedAt,
            });
            const result = this.#database.prepare(`
              UPDATE explorer_edit_outbox SET state = 'projected', record_json = ?
              WHERE record_key = ? AND state = 'pending'
            `).run(canonicalJsonStringify(next), request.commandId);
            if (sqliteChanges(result.changes) !== 1) throw new Error(`Explorer outbox ${request.commandId} ack lost its CAS`);
            return { result: Object.freeze({ state: "acknowledged" as const, record: next }), changes: 1 };
          });
        },
      }),
      commands: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandRequestSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("commands", () => {
            const existing = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command id ${record.commandId} was reused with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO commands (record_key, family, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.commandId, record.family, json, record.requestedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => this.#readRecord("commands", commandId, CommandRequestSchema),
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
      dependencies: Object.freeze({
        insert: (input: unknown) => {
          const record = DependencyRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("dependencies", () => {
            const existing = this.#readRecord("dependencies", record.dependencyId, DependencyRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`dependency ${record.dependencyId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO dependencies (record_key, manifest_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.dependencyId, record.manifestId, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (dependencyId: string) => this.#readRecord("dependencies", dependencyId, DependencyRecordSchema),
        listByParentRun: (parentRunId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM dependencies
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
          return this.#insertSimpleRecord("delegation_manifests", record.manifestId, record, DelegationManifestSchema, record.createdAt);
        },
        get: (manifestId: string) => this.#readRecord("delegation_manifests", manifestId, DelegationManifestSchema),
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
          return this.#insertSimpleRecord("config_snapshots", record.configSnapshotId, record, ConfigSnapshotRecordSchema, record.capturedAt);
        },
        get: (snapshotId: string) => this.#readRecord("config_snapshots", snapshotId, ConfigSnapshotRecordSchema),
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
      archivedRuns: Object.freeze({
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
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(outcome.changes) };
          });
        },
        get: (runId: string) => this.#readRecord("archived_runs", runId, ArchivedRunStorageRecordSchema),
        /**
         * The predicate the ONE run/queue projection asks per row (D81/D80).
         * It reads the index rather than the record so excluding an archived
         * row never costs a JSON parse.
         */
        isArchived: (runId: string) => CountRowSchema.parse(this.#database.prepare(`
          SELECT count(*) AS count FROM archived_runs WHERE record_key = ?
        `).get(runId)).count > 0,
        list: () => Object.freeze(this.#database.prepare(`
          SELECT record_json FROM archived_runs ORDER BY created_at DESC, record_key
        `).all().map((row) => parseJsonRecord(ArchivedRunStorageRecordSchema, JsonRowSchema.parse(row).record_json))),
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
        recordObservedPresent: (input: unknown) => {
          const record = WriteIntentRecordSchema.parse(input);
          if (record.status !== "observed-present") {
            throw new Error(`recordObservedPresent requires observed-present status, received ${record.status}`);
          }
          return this.withAuthorityTransaction(() => {
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
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireAttemptingWriteAttempt(current.currentAttemptId);
            const parkedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "parked", code: request.code, message: request.message },
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
            const { parkedCode: _parkedCode, message: _message, ...base } = {
              parkedCode: undefined,
              message: undefined,
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
            const { parkedCode: _parkedCode, message: _message, ...base } = current;
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
        get: (writeIntentId: string) => this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema),
        findByPermanentKey: (system: unknown, idempotencyKey: unknown) => this.#findPermanentWriteIntent(
          BrowserSystemIdSchema.parse(system),
          IdempotencyKeySchema.parse(idempotencyKey),
        ),
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM write_intents
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
              SELECT count(*) AS count FROM write_intents
              WHERE json_extract(record_json, '$.runId') = ?
            `),
            writeAttempts: count(`
              SELECT count(*) AS count FROM write_attempts AS attempt
              JOIN write_intents AS intent ON intent.record_key = attempt.write_intent_id
              WHERE json_extract(intent.record_json, '$.runId') = ?
            `),
            durableOutbox: count(`
              SELECT count(*) AS count FROM durable_outbox AS outbox
              JOIN write_intents AS intent ON intent.record_key = outbox.write_intent_id
              WHERE json_extract(intent.record_json, '$.runId') = ?
            `),
          });
        },
      }),
      writeAttempts: Object.freeze({
        get: (writeAttemptId: string) => this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema),
        listByIntent: (writeIntentId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM write_attempts WHERE write_intent_id = ? ORDER BY generation
          `).all(WriteIntentIdSchema.parse(writeIntentId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            WriteAttemptRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      durableOutbox: Object.freeze({
        get: (outboxId: string) => this.#readRecord("durable_outbox", outboxId, AtomicOutboxRecordSchema),
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
      captureSessions: Object.freeze({
        create: (input: unknown) => {
          const record = CaptureSessionSchema.parse(input);
          if (record.state !== "open" || record.version !== 1) {
            throw new Error(`capture session ${record.sessionId} must be created open at version 1`);
          }
          return this.#authorityWrite("capture_sessions", () => {
            this.#database.prepare(`
              INSERT INTO capture_sessions (record_key, record_json, created_at) VALUES (?, ?, ?)
            `).run(record.sessionId, canonicalJsonStringify(record), record.createdAt);
            return { result: record, changes: 1 };
          });
        },
        get: (sessionId: string) => this.#readRecord("capture_sessions", sessionId, CaptureSessionSchema),
        update: (input: unknown) => {
          const record = CaptureSessionSchema.parse(input);
          return this.#authorityWrite("capture_sessions", () => {
            const outcome = this.#database.prepare(`
              UPDATE capture_sessions SET record_json = ?
              WHERE record_key = ? AND json_extract(record_json, '$.version') = ?
            `).run(canonicalJsonStringify(record), record.sessionId, record.version - 1);
            const changes = sqliteChanges(outcome.changes);
            if (changes !== 1) {
              throw new Error(
                `capture session ${record.sessionId} update to version ${String(record.version)} raced `
                + `past its expected predecessor; ${String(changes)} rows changed`,
              );
            }
            return { result: record, changes: 1 };
          });
        },
        listActive: () => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM capture_sessions
            WHERE json_extract(record_json, '$.state') IN ('open', 'finalizing', 'failed')
            ORDER BY created_at, record_key
          `).all();
          return Object.freeze(rows.map((row) =>
            parseJsonRecord(CaptureSessionSchema, JsonRowSchema.parse(row).record_json)));
        },
        findByTokenDigest: (tokenDigest: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM capture_sessions
            WHERE json_extract(record_json, '$.tokenDigest') = ?
            ORDER BY created_at, record_key
          `).all(FingerprintSchema.parse(tokenDigest));
          const records = rows.map((row) =>
            parseJsonRecord(CaptureSessionSchema, JsonRowSchema.parse(row).record_json));
          if (records.length > 1) {
            throw new Error(
              `${String(records.length)} capture sessions share one token digest; refusing to guess which one `
              + "a phone is holding",
            );
          }
          return records[0];
        },
      }),
      captureFinalizationOutboxes: Object.freeze({
        insert: (input: unknown) => {
          const record = CaptureFinalizationOutboxSchema.parse(input);
          return this.#insertSimpleRecord("capture_finalization_outboxes", record.outboxId, record, CaptureFinalizationOutboxSchema, record.createdAt);
        },
        get: (outboxId: string) =>
          this.#readRecord("capture_finalization_outboxes", outboxId, CaptureFinalizationOutboxSchema),
        getByStableKey: (stableKey: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM capture_finalization_outboxes
            WHERE json_extract(record_json, '$.stableKey') = ?
            ORDER BY created_at, record_key
          `).get(FingerprintSchema.parse(stableKey));
          if (row === undefined) return undefined;
          return parseJsonRecord(CaptureFinalizationOutboxSchema, JsonRowSchema.parse(row).record_json);
        },
        listPending: () => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM capture_finalization_outboxes
            WHERE json_extract(record_json, '$.state') = 'pending'
            ORDER BY created_at, record_key
          `).all();
          return Object.freeze(rows.map((row) =>
            parseJsonRecord(CaptureFinalizationOutboxSchema, JsonRowSchema.parse(row).record_json)));
        },
        settle: (input: unknown) => {
          const record = CaptureFinalizationOutboxSchema.parse(input);
          if (record.state === "pending") {
            throw new Error(`capture finalization ${record.outboxId} cannot settle back to pending`);
          }
          return this.#authorityWrite("capture_finalization_outboxes", () => {
            const existing = this.#readRecord("capture_finalization_outboxes", record.outboxId, CaptureFinalizationOutboxSchema);
            if (existing === undefined) {
              throw new Error(`capture finalization ${record.outboxId} does not exist; nothing to settle`);
            }
            if (existing.state !== "pending") {
              return {
                result: Object.freeze({ state: "already-settled" as const, record: existing }),
                changes: 0,
              };
            }
            const outcome = this.#database.prepare(`
              UPDATE capture_finalization_outboxes SET record_json = ?
              WHERE record_key = ? AND json_extract(record_json, '$.state') = 'pending'
            `).run(canonicalJsonStringify(record), record.outboxId);
            const changes = sqliteChanges(outcome.changes);
            if (changes !== 1) {
              throw new Error(`capture finalization ${record.outboxId} settle affected ${String(changes)} rows`);
            }
            return { result: Object.freeze({ state: "settled" as const, record }), changes: 1 };
          });
        },
      }),
      opaque: Object.freeze({
        ocrApprovals: opaque("ocr_approvals"),
        capturePhotoOrder: opaque("capture_photo_order"),
      }),
    });
  }

  #readRunRow(runId: string): RunRecord | undefined {
    return this.#readRecord("tasks", runId, RunRecordSchema);
  }

  /**
   * D221 — the attempt the NEXT run of this logical item must take.
   *
   * The `attempt` column is the envelope's own value (the integrity audit pins
   * the two together), and runs are never deleted, so the maximum over the item
   * is the whole history of attempts that item has spent. One past it is the
   * only attempt no execution of that item can already own.
   */
  #nextItemAttempt(workflow: string, itemId: string): number {
    const row = MaxAttemptRowSchema.parse(this.#database.prepare(`
      SELECT max(attempt) AS attempt FROM tasks WHERE workflow = ? AND item_id = ?
    `).get(WorkflowIdSchema.parse(workflow), ItemIdSchema.parse(itemId)));
    const highest = row.attempt;
    if (highest === null) return 1;
    return highest + 1;
  }

  /**
   * D230: the next unspent ORDINAL for one workflow — the queue footer's `#N`.
   *
   * Same shape as `#nextItemAttempt` one scope up, and for the same reason: the
   * column is the record's own value (the integrity audit pins them together),
   * runs are never deleted, so the maximum over the workflow is the whole
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
      SELECT max(run_number) AS run_number FROM tasks WHERE workflow = ?
    `).get(WorkflowIdSchema.parse(workflow)));
    const highest = row.run_number;
    if (highest === null) return 1;
    return highest + 1;
  }

  #writeRunRow(record: RunRecord, mode: "insert" | "update"): void {
    const claim = runClaim(record);
    const json = canonicalJsonStringify(record);
    const notBefore = record.lifecycle.state === "queued" ? record.lifecycle.notBefore ?? null : null;
    this.#authorityWrite("tasks", () => {
      const statement = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO tasks (
            record_key, workflow, item_id, state, priority, attempt, not_before,
            owner_worker_id, claim_generation, heartbeat_at, parent_run_id, run_number, session_id, version,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        : this.#database.prepare(`
          UPDATE tasks SET
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
        ? statement.run(record.envelope.runId, ...shared, json, record.createdAt)
        : statement.run(...shared, json, record.envelope.runId, record.version - 1);
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`run ${record.envelope.runId} ${mode} affected ${String(changes)} rows`);
      }
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
            const session = this.#readRecord("run_sessions", record.sessionId, RunSessionRecordSchema);
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
      /** D179: the whole set a version bump assesses — terminal and not. */
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM tasks WHERE workflow = ? ORDER BY created_at, record_key
      `).all(workflow).map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json))),
      listWorkflows: () => Object.freeze(
        z.array(z.strictObject({ workflow: z.string() })).parse(this.#database.prepare(`
          SELECT DISTINCT workflow AS workflow FROM tasks ORDER BY workflow
        `).all()).map(({ workflow }) => workflow),
      ),
      findByTrace: (traceId: string) => {
        const parsed = TraceIdSchema.parse(traceId);
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks
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
          SELECT record_json FROM tasks WHERE workflow = ? AND item_id = ? ORDER BY created_at, record_key
        `).all(query.workflow, query.itemId);
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      nextItemAttempt: (input: unknown) => {
        const query = RunItemQuerySchema.parse(input);
        return this.#nextItemAttempt(query.workflow, query.itemId);
      },
      nextWorkflowRunNumber: (workflow: string) => this.#nextWorkflowRunNumber(workflow),
      listByWorker: (workerId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE owner_worker_id = ? ORDER BY created_at, record_key
        `).all(WorkerIdSchema.parse(workerId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      listBySession: (sessionId: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM tasks WHERE session_id = ? ORDER BY created_at, record_key
      `).all(RunSessionIdSchema.parse(sessionId)).map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json))),
      /**
       * D262. `tasks_heartbeat_idx ON tasks(state, heartbeat_at)` leads on
       * `state`, so this is an index scan over a set that is almost always
       * empty. The parsed record is re-checked against the column the scan
       * selected on: the two are written together by `#writeRunRow`, and a row
       * whose column and lifecycle disagree is an integrity defect that must
       * name the run rather than quietly publish a notification about a gate
       * the record does not hold.
       */
      listParkedAtGate: () => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE state = 'parked-gate' ORDER BY created_at, record_key
        `).all();
        return Object.freeze(rows.map((row) => {
          const record = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
          if (record.lifecycle.state !== "parked-gate") {
            throw new Error(
              `run ${record.envelope.runId} is stored under state 'parked-gate' but its record's lifecycle `
              + `reads ${record.lifecycle.state}; the tasks row and its record_json disagree`,
            );
          }
          return record;
        }));
      },
      listChildren: (parentRunId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE parent_run_id = ? ORDER BY created_at, record_key
        `).all(RunIdSchema.parse(parentRunId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      claimNext: (input: unknown) => {
        const request = RunClaimRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          // One worker, one active item (ref execution-and-sessions §0.3). A worker asking for a
          // second row is a bug in the loop, not a state to serve — and serving
          // it would put two runs and two browser-session sets under one owner.
          const held = HeldRunRowSchema.parse(this.#database.prepare(`
            SELECT record_key AS run_id FROM tasks
            WHERE owner_worker_id = ? AND state IN ('claimed', 'validating', 'running')
            LIMIT 1
          `).get(request.workerId) ?? { run_id: null });
          if (held.run_id !== null) {
            throw new Error(`worker ${request.workerId} already holds active run ${held.run_id}`);
          }
          const row = this.#database.prepare(`
            SELECT record_json FROM tasks
            WHERE workflow = ? AND state = 'queued'
              AND (not_before IS NULL OR not_before <= ?)
            ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, created_at, record_key
            LIMIT 1
          `).get(request.workflow, request.now);
          if (row === undefined) {
            const deferred = NextEligibleRowSchema.parse(this.#database.prepare(`
              SELECT min(not_before) AS next_eligible_at FROM tasks
              WHERE workflow = ? AND state = 'queued' AND not_before > ?
            `).get(request.workflow, request.now));
            if (deferred.next_eligible_at === null) return RunClaimOutcomeSchema.parse({ state: "idle" });
            return RunClaimOutcomeSchema.parse({ state: "deferred", nextEligibleAt: deferred.next_eligible_at });
          }
          const current = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
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
      },
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
            SELECT record_json FROM tasks
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
              SELECT record_json FROM write_intents
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
      "config_snapshots",
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
    this.#authorityWrite("start_plans", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO start_plans (
            record_key, workflow, consumed_by, expires_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.startPlanId, record.workflowId, record.consumedBy?.commandId ?? null,
          record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE start_plans SET consumed_by = ?, expires_at = ?, version = ?, record_json = ?
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
          const existing = this.#readRecord("start_plans", record.startPlanId, StartPlanRecordSchema);
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
      get: (startPlanId: string) => this.#readRecord("start_plans", startPlanId, StartPlanRecordSchema),
      consume: (input: unknown) => {
        const request = StartPlanConsumeRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const plan = this.#readRecord("start_plans", request.startPlanId, StartPlanRecordSchema);
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
    return this.#readRecord("leases", workerId, WorkerLeaseRecordSchema);
  }

  #writeWorkerLease(record: WorkerLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    const heartbeatAt = "heartbeatAt" in record.lifecycle ? record.lifecycle.heartbeatAt : null;
    this.#authorityWrite("leases", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO leases (
            record_key, worker_id, workflow, lease_generation, state, directive,
            heartbeat_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.workerId, record.workerId, record.workflow, record.leaseGeneration,
          record.lifecycle.state, record.control.directive, heartbeatAt, record.version,
          json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE leases SET
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
    return this.#readRecord("duo_ceremony_leases", credentialKey, DuoCeremonyLeaseRecordSchema);
  }

  #writeDuoCeremonyLease(record: DuoCeremonyLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("duo_ceremony_leases", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO duo_ceremony_leases (
            record_key, generation, holder_worker_id, holder_system, state, expires_at,
            version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.credentialKey, record.generation, record.holder.workerId, record.holder.system,
          record.state, record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE duo_ceremony_leases SET
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
      insert: (input: unknown) => {
        const record = RunSessionRecordSchema.parse(input);
        const json = canonicalJsonStringify(record);
        return this.#authorityWrite("run_sessions", () => {
          const existing = this.#readRecord("run_sessions", record.sessionId, RunSessionRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`run session ${record.sessionId} already exists with different content`);
            }
            return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
          }
          const result = this.#database.prepare(`
            INSERT INTO run_sessions (record_key, workflow, started_at, record_json, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(record.sessionId, record.workflow, record.startedAt, json, record.createdAt);
          return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
        });
      },
      get: (sessionId: string) =>
        this.#readRecord("run_sessions", RunSessionIdSchema.parse(sessionId), RunSessionRecordSchema),
      listByWorkflow: (workflow: string) => Object.freeze(this.#database.prepare(`
        SELECT record_json FROM run_sessions WHERE workflow = ? ORDER BY started_at, record_key
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
            SELECT record_json FROM leases WHERE state IN (${states}) ORDER BY record_key
          `).all(...LIVE_WORKER_STATES)
          : this.#database.prepare(`
            SELECT record_json FROM leases WHERE state IN (${states}) AND workflow = ? ORDER BY record_key
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
            SELECT record_json FROM leases
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

  #findPermanentWriteIntent(system: string, idempotencyKey: string): WriteIntentRecord | undefined {
    const row = this.#database.prepare(`
      SELECT record_json FROM write_intents WHERE system = ? AND idempotency_key = ?
    `).get(system, idempotencyKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #insertWriteIntent(record: WriteIntentRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_intents", () => {
      const existingById = this.#readRecord("write_intents", record.writeIntentId, WriteIntentRecordSchema);
      if (existingById !== undefined) throw new Error(`write intent id ${record.writeIntentId} already exists with a different permanent key`);
      const digestCollision = this.#database.prepare(`
        SELECT system, idempotency_key FROM write_intents WHERE idempotency_key_digest = ?
      `).get(record.idempotencyKeyDigest);
      if (digestCollision !== undefined) {
        throw new Error(`write intent digest ${record.idempotencyKeyDigest} is already bound to a different permanent key`);
      }
      const result = this.#database.prepare(`
        INSERT INTO write_intents (
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
    this.#authorityWrite("write_attempts", () => {
      const result = this.#database.prepare(`
        INSERT INTO write_attempts (
          record_key, write_intent_id, generation, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.writeAttemptId, record.writeIntentId, record.generation, json, record.recordedAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #replaceWriteIntent(record: WriteIntentRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_intents
      SET status = ?, record_json = ?
      WHERE record_key = ? AND idempotency_key_digest = ?
    `).run(record.status, canonicalJsonStringify(record), record.writeIntentId, record.idempotencyKeyDigest);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write intent ${record.writeIntentId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #replaceWriteAttempt(record: WriteAttemptRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_attempts SET record_json = ?
      WHERE record_key = ? AND write_intent_id = ? AND generation = ?
    `).run(canonicalJsonStringify(record), record.writeAttemptId, record.writeIntentId, record.generation);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write attempt ${record.writeAttemptId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #insertDurableOutbox(record: z.infer<typeof AtomicOutboxRecordSchema>): void {
    const json = canonicalJsonStringify(record);
    const result = this.#database.prepare(`
      INSERT INTO durable_outbox (
        record_key, write_intent_id, generation, kind, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.outboxId, record.aggregate.writeIntentId, record.aggregate.generation, record.payload.kind, json, record.createdAt);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`durable outbox ${record.outboxId} insertion affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #assertAtomicCommitMatchesIntent(
    input: z.infer<typeof AtomicWriteCommitInputSchema>,
    intent: Extract<WriteIntentRecord, { status: "attempting" }>,
  ): void {
    const ledger = input.ledgerOutbox.payload;
    const span = input.terminalSpanOutbox.payload;
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
        throw new Error(`atomic write outboxes ${field} do not match intent ${intent.writeIntentId}`);
      }
    }
    if (ledger.entry.fencedAt !== intent.fencedAt
      || ledger.entry.confirmedAt !== input.confirmedAt
      || ledger.entry.proofSource !== input.outcome.proofSource
      || span.occurredAt !== input.confirmedAt
      || canonicalJsonStringify(ledger.entry.proof) !== canonicalJsonStringify(input.completionProof)) {
      throw new Error(`atomic write outboxes do not match proof/timing for intent ${intent.writeIntentId}`);
    }
    if (ledger.entry.traceId !== span.traceId) {
      throw new Error(`atomic write outboxes do not share trace identity for intent ${intent.writeIntentId}`);
    }
    if (intent.bindingProof.kind === "subject-match") {
      if (ledger.entry.subject.state !== "present"
        || canonicalJsonStringify(ledger.entry.subject.value) !== canonicalJsonStringify(intent.bindingProof.expected)) {
        throw new Error(`ledger subject does not match the fenced binding proof for intent ${intent.writeIntentId}`);
      }
    } else if (ledger.entry.subject.state !== "absent") {
      throw new Error(`ledger subject must be absent for unscoped binding proof on intent ${intent.writeIntentId}`);
    }
    if (input.ledgerOutbox.projection.state !== "pending"
      || input.terminalSpanOutbox.projection.state !== "pending"
      || input.ledgerOutbox.createdAt !== input.confirmedAt
      || input.terminalSpanOutbox.createdAt !== input.confirmedAt) {
      throw new Error(`atomic write outboxes must begin pending at confirmation time for intent ${intent.writeIntentId}`);
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
      runsView: repository("runs_view"),
    });
  }
}
