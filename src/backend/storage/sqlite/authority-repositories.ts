import type { createWorkerSlotRepository } from "./worker-slots.js";
import { z } from "zod";
import type { RunRecordRefusal } from "../../../models/config/authority.js";
import type { ActiveRuntimeConfigRecord, RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import type { SettingsCurrentRecord } from "../../../models/config/settings-current.js";
import type { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import type { ConfirmationPublication } from "../../../models/events/confirmed-operation.js";
import type { TimelineEventRecord, TimelineRepository } from "../../../models/events/timeline.js";
import type { IntakePlanManifestSchema } from "../../../models/intake/manifest.js";
import type { IntakeSessionSchema } from "../../../models/intake/session.js";
import type { NotificationCollectionOperation, NotificationCollectionTarget, NotificationRecord, NotificationRecordOutcome } from "../../../models/notifications/notifications.js";
import type { StoredOcrExtraction } from "../../../models/ocr/stored-extraction.js";
import type { LogoutOperation } from "../../../models/profiles/profile.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunResultRecord } from "../../../models/run/result.js";
import type { RunSessionRecord } from "../../../models/run/session.js";
import type { StartPlanRecord } from "../../../models/run/start-plan.js";
import type { WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import type { DiagnosticBundle } from "../../../models/trust/diagnostic.js";
import type { CommandRowState } from "../../../rules/commands/command-lifecycle.js";
import type { AuthorityCommandAuditRecordSchema, AuthorityCommandRecordSchema, BulkRunCommandAcceptanceRecordSchema, CommandAuditRecordSchema, CommandRequestSchema, RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import type { DelegationManifestSchema, DependencyRecordSchema, DelegationManifest, DelegationReadiness } from "../../../rules/workflow/dependencies.js";
import type { RuntimeLifetimeLock } from "../admission/lifetime-lock.js";
import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import type { createAssistantAuthorizationRepository } from "./assistant-authorization.js";
import type { createAssistantModelPreferenceRepository } from "./assistant-model-preference.js";
import type { createOcrReviewRepository } from "./ocr-review.js";
import type { createFailureResolutionRepository } from "./failure-resolution.js";
import type { createGeneratedArtifactRepository } from "./generated-artifacts.js";
import type { createNotificationMetadataRepositories } from "./notification-publications.js";
import type { createRunSearchIndex } from "./run-search-index.js";
import type { AuthenticatedRunContinuation, continuationDelegationGroups } from "./run-continuation-delegation.js";
import type { RunClaimOutcome, RunHeartbeatOutcome, RunUpdateOutcome, StartPlanConsumeOutcome, WorkerPoolPlanOutcome, RunAdmission } from "./run-store-contracts.js";
import type { createTransactionHistory } from "./transaction-history.js";
import type { createWorkbookLibraryRepository } from "./workbook-library-repository.js";
import type { DryRunScenarioResult } from "../../../models/trust/dry-run-scenario-result.js";
import type { DryRunWriteSafetyCountsSchema } from "../../../models/trust/dry-run-scenario.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { FailureRecord } from "../../../models/trust/failure.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { GateResultRecordSchema } from "../../../models/workflow/gates.js";
import type { DuoCeremonyLeaseTakeoverSchema, DuoCeremonyLeaseRecord, DuoCeremonyLeaseReleaseOutcome } from "../../../rules/sessions/duo-ceremony-lease.js";
import type { WriteAttemptRecordSchema, WriteIntentRecordSchema, WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { DelegationAuthenticationMemo, authenticateDelegationGroup, readDelegationCancellation, readDelegationEvidence, readQueueParents, readDelegationWait, readDelegationWaitState } from "./delegation-authority.js";
import type { createExclusiveSessionLeaseRepository } from "./exclusive-session-leases.js";
import type { AssistantM1HistoryRepository } from "./assistant-history.js";
import type { AssistantProposalRepository } from "./assistant-proposals.js";
import type { FailureTerminalizationStorageStep, SuccessTerminalizationStorageStep } from "./run-terminal-contracts.js";
import type { ArtifactOutboxStorageRecord, ArtifactSinkHeadRecord, DiagnosticAttachmentStorageRecord } from "./storage-records.js";
import type { AtomicWriteCommitStorageStep, PermanentWriteResolution } from "./write-commit-contracts.js";
import type { AuthorityDatabase } from "./authority-database.js";

export const ImmutableInsertDispositionSchema = z.enum(["inserted", "existing"]);


export const DiagnosticPurgeDispositionSchema = z.enum(["purged", "absent"]);

export type ImmutableInsertResult<RecordValue> = Readonly<{
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
  state: CommandRowState;
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
  /** The open read snapshot's authentications, for the database's own repositories only; undefined in a write transaction and outside a snapshot. */
  snapshotMemo(repositories: AuthorityRepositories): DelegationAuthenticationMemo | undefined;
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

/** Called after an outermost write or read snapshot settles, and only when it took more than 50 ms. */
export type SlowOperationHook = (operation: Readonly<{ name: string; durationMs: number }>) => void;


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
  listByRunAttempt(workflowId: string, itemId: string, runId: string, attempt: number): readonly RunCheckpointRecord[];
  /** Ref operator-trust §2.3: a receipt explains one logical item across every attempt. */
  listByItem(workflowId: string, itemId: string): readonly RunCheckpointRecord[];
}>;



type DeletedRunRepository = Readonly<{
  get(runId: string): DeletedRunRecord | undefined;
  list(): readonly DeletedRunRecord[];
}>;

export type CanonicalRunClaimOutcome = RunClaimOutcome | Readonly<{ state: "refused"; refusal: RunRecordRefusal }>;

export type RunRepository = Readonly<{
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
  listNonTerminal(): readonly RunRecord[];
  countByTerminal(): Readonly<{ finished: number; active: number }>;

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


export type StartPlanRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<StartPlanRecord>;
  get(startPlanId: string): StartPlanRecord | undefined;
  consume(input: unknown): StartPlanConsumeOutcome;
}>;


export type WorkerPoolRepository = Readonly<{
  plan(input: unknown): WorkerPoolPlanOutcome;
  retireMember(input: unknown): WorkerPoolRecord;
  get(workflow: string): WorkerPoolRecord | undefined;
  list(): readonly WorkerPoolRecord[];
}>;


export type RunSessionRepository = Readonly<{
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
  assistantHistory: AssistantM1HistoryRepository;
  assistantProposals: AssistantProposalRepository;
  assistantAppliedEdits: import("./assistant-applied-edits.js").AssistantAppliedEditRepository;
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

export type EarlierRunEvents = (runId: string, beforeCursor: number, each: (record: TimelineEventRecord) => void) => void;

export type RunSearchAuthorityPage = ReturnType<ReturnType<typeof createRunSearchIndex>["search"]>;
