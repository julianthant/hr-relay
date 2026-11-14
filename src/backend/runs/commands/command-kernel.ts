import { preflightRunnerTimeout } from "../../../models/preflight/preflight.js";
import { applyWorkerPoolPlan, WorkerPoolPlanVersionConflict } from "../../storage/sqlite/worker-slots.js";
import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { notificationMatchesCollection,type NotificationCollectionOperation,type NotificationRecord } from "../../../models/notifications/notifications.js";
import { OcrApprovedSnapshotSchema,ocrSnapshotDigest } from "../../../models/ocr/review.js";
import { AssistantActionManifestSchema } from "../../../models/profiles/assistant-permissions.js";
import { isStartPlanExpired } from "../../../models/run/start-plan.js";
import { RunDisplayNameSchema } from "../../../models/run/display-name.js";
import { startSupersedeTargets } from "../../../models/run/start-supersede.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { workerPoolMember,type WorkerPoolMember } from "../../../models/run/worker-slot.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { AssistantModelPreferenceCommandRequestSchema } from "../../../rules/commands/commands.js";
import { PreflightEvidenceExpiredError, PreflightAdmissionRefusal,type PreflightAdmission } from "../../../rules/preflight/preflight-admission.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ASSISTANT_INPUT_PROJECTION_VERSION,assistantKnowledgeArtifact } from "../../assistant/context.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import { requireParkedWriteCheckTarget } from "../../runtime/writes/write-recovery.js";
import { withCanonicalRunCommandScope } from "../../storage/sqlite/command-record-row.js";
import { authenticateDescendantHome,captureDelegationResume,delegationResumeCommandId,currentDelegationManifests,retainedDelegationManifests,selectDelegationGroupForChild } from "../../storage/sqlite/delegation-authority.js";
import { readRunCheckpoint, RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { executeFailureResolution,failureResolutionCapability } from "../lifecycle/failure-resolution.js";
import { assertOcrReviewChildrenCurrent,readOcrReviewAuthority,readOcrSnapshotsAuthority,reviseOcrReview } from "../lifecycle/ocr-review-authority.js";
import { reviewedRunSettingsCurrent,selectNewRunIdentity,selectRunRuntime } from "../settings/run-settings.js";
import { workflowPreflightScope } from "../start/preflight-scope.js";
import { admitProtectedInput,protectedSubjectDisplay } from "../start/protected-input.js";
import { planRunRecovery } from "../start/recovery-plan.js";
import type { CommandApplication } from "./command-application.js";
import { CommandRefusal } from "./command-refusal.js";
import type { NotificationInbox } from "../notifications/inbox.js";
export type { CommandApplication } from "./command-application.js";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { RunExistence,RunRecordRefusal } from "../../../models/config/authority.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH,ProtectedSettingsReadbackSchema,type ProtectedSettingsReadback } from "../../../models/config/protected-settings.js";
import { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
import { SettingsApplyRefusalSchema,type SettingsFileRecord } from "../../../models/config/settings.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { deriveIntakeEnqueuePlan } from "../../../models/intake/enqueue.js";
import type { IntakePlanManifest } from "../../../models/intake/manifest.js";
import { confirmBinding } from "../../../models/intake/mapping.js";
import { IntakeParseSchema,resolveInspectSelection,type IntakeLayout } from "../../../models/intake/parse.js";
import type { IntakeProjection } from "../../../models/intake/projection.js";
import { intakeReviewBinding,resolveIntakeComparison } from "../../../models/intake/review.js";
import { validateIntakeRows } from "../../../models/intake/validate.js";
import { isTerminalRunState,RunRecordSchema,runClaim,type RunRecord } from "../../../models/run/record.js";
import { workerPoolVersion } from "../../../models/run/worker-pool.js";
import { findGateDecision } from "../../../models/trust/gate-decisions.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { checkpointLookupKey,resolveFreshnessBound,type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { deriveGateResultCheckpointFingerprint as deriveGateFingerprint } from "../../../models/workflow/gates.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { COMMAND_FAMILY_REGISTRY,commandAssistantAvailability,CommandIdentityConflictError,CommandRequestSchema,CommandResultSchema,StartCommandRequestSchema,deriveSettingsCommandFingerprint,markSettingsCommand,ParkedWriteCheckAcknowledgementSchema,RunCommandRequestSchema,type ParkedWriteCheckAcknowledgement,type ParkedWriteCheckTarget,type CommandRequest,type CommandResult } from "../../../rules/commands/commands.js";
import { deriveItemId,deriveStableUuid,type IdFactory } from "../../../rules/identity/identifiers.js";
import { FingerprintSchema,IsoInstantSchema,ItemIdSchema } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify,JsonValueSchema,type JsonValue } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { WriteIntentRecordSchema,type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { IntakeParser } from "../../../workflow-kit/intake-parser.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting, descriptorRuntimeNodes,workflowPlanning,type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { assertDelegationRetryUnwritten } from "../../storage/sqlite/delegation-authority.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { activeRunsForItem,fanOutQueuedRuns,requireApplied,runTarget,type TargetReference,type VersionChange } from "../lifecycle/run-fan-out.js";
import { lifecycleCommandId,type RelatedRunChange,type RunMutationOutcome,type RunRecordService } from "../lifecycle/run-record-service.js";
import { dryRunRefusalMessage,resolveInstances,supportsDryRun } from "../start/plan.js";
import { buildRerunPlan,RerunRefusedError } from "../start/rerun.js";
import { bindRunWorkbookReference, parseRunWorkbookReference } from "../../../models/dashboard/workbooks.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { createWorkbookReferenceCapture } from "../../workbooks/workbook-library-service.js";
import { MAX_SELECTED_WORKBOOK_SOURCES } from "../../../rules/spreadsheets/workbook-size.js";

/* ── the arm partition (ref dashboard-surfaces authority) ─────────────── */

const PHASE1_ACTIVE = {
  "ocr-review": ["correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record"],
  application: ["pause-all", "pause-all-and-quit"],
  'assistant-model-preference': ['set-assistant-model-preference'],
  "failure-resolution": ["annotate-failure"],
  "workflow-batch": ["set-batch-grouping"],
  start: ["start-run"],
  "worker-browser": [
    "check-parked-write",
    "plan-worker-count",
    "spawn-worker",
    "stop-worker",
    "remove-worker",
    "retry-worker",
    "pause-worker",
    "resume-worker",
    "refresh-browser",
    "reopen-browser",
  ],
  run: [
    "recover-run",
    "pause",
    "resume",
    "retry",
    "cancel",
    "bump",
    "rename",
    "delete",
    "recheck-write",
    "resolve-write-absent",
    "resolve-workbook-row",
    "resolve-workbook-reference-row",
  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"],

  intake: [
    "inspect-intake",
    "confirm-intake-mapping",
    "correct-intake-row",
    "exclude-intake-row",
    "validate-intake",
    "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],

} as const;

export const PHASE1_ACTIVE_COMMAND_ARMS = deepFreeze(PHASE1_ACTIVE);

function armActions(partition: Readonly<Record<string, readonly string[]>>, family: string): readonly string[] {
  const actions = Object.hasOwn(partition, family) ? partition[family] : undefined;
  if (actions === undefined) return [];
  return actions;
}


for (const { family, actions } of COMMAND_FAMILY_REGISTRY) {
  const active = armActions(PHASE1_ACTIVE, family);
  if (active.length !== actions.length
    || new Set(active).size !== active.length
    || actions.some((action) => !active.includes(action))) {
    throw new Error(`command arm partition does not cover family ${family} exactly`);
  }
}

/* ── injected seams ──────────────────────────────────────────────────────── */

export interface CommandAuthority {
  readonly evidenceSchemaHash?: EvidenceSchemaReader;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface WorkflowDescriptorResolver {
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
}


type RunCommand = Extract<CommandRequest, { family: "run" }>;
type RunBasicCommand = Extract<RunCommand, { type: "retry" | "cancel" | "bump" | "pause" | "resume" | "recover-run" }>;

type RunRecoveryCommand = RunBasicCommand;
type IntakeCommand = Extract<CommandRequest, { family: "intake" }>;
type NotificationCommand = Extract<CommandRequest, { family: "notification" }>;
export type SettingsCommand = Extract<CommandRequest, { family: "settings" }>;
type RunRenameCommand = Extract<RunCommand, { type: "rename" }>;
type RunDeleteCommand = Extract<RunCommand, { type: "delete" }>;
type WriteResolutionCommand = Extract<RunCommand, { type: "recheck-write" | "resolve-write-absent" }>;

export interface WriteResolutionContext {
  readonly command: WriteResolutionCommand;
  readonly run: RunRecord;
  readonly intent: WriteIntentRecord;
  readonly now: string;
  readonly auditId: string;
}

const WriteResolutionOutcomeSchema = z.strictObject({ run: RunRecordSchema, intent: WriteIntentRecordSchema });
interface PreparedWriteResolution {
  readonly outcome: z.infer<typeof WriteResolutionOutcomeSchema>;
  applyAfterAudit(): z.infer<typeof WriteResolutionOutcomeSchema>;
}

export interface WriteResolutionExecutor {
  recheck(repositories: AuthorityRepositories, context: WriteResolutionContext): PreparedWriteResolution;
  resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext): PreparedWriteResolution;
}

const SettingsApplicationRefusalSchemas = SettingsApplyRefusalSchema.options;

const OrdinarySettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    revision: z.number().int().positive(),
    settingsFingerprint: FingerprintSchema,
    settings: EditableSettingsOverrideSchema,
    restartRequired: z.boolean().optional(),
  }),
  ...SettingsApplicationRefusalSchemas,
]);

const ProtectedSettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    readback: ProtectedSettingsReadbackSchema,
  }),
  ...SettingsApplicationRefusalSchemas,
]);

export interface SettingsApplicationExecutor {
  validateRequest(command: SettingsCommand): z.infer<typeof SettingsApplyRefusalSchema> | undefined;
  commitPrivate(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>): z.infer<typeof SettingsApplyRefusalSchema> | undefined;
  applyOrdinary(command: Extract<SettingsCommand, { type: "apply-settings" }>, repositories: AuthorityRepositories, current: SettingsFileRecord): unknown;
  reconcileReplay(command: Extract<SettingsCommand, { type: "apply-protected-settings" }>): unknown;
}

const OrdinarySettingsReplayVerificationSchema = z.strictObject({
  revision: z.number().int().positive(),
  settingsFingerprint: FingerprintSchema,
});

const ProtectedSettingsReplayVerificationSchema = ProtectedSettingsReadbackSchema;


export type WorkerMemberState = "absent" | "starting" | "running" | "stopping" | "exited";

/** The kernel's view of one profile runtime's worker pool; composition binds it to the in-memory WorkerPool. */
export interface WorkerPoolRuntimeSeam {
  /** Runs effect admission (assistant Confirm, and the preflight before any spawn) for this command. */
  admit(commandId: string, options: Readonly<{ preflight: boolean }>): Promise<void>;
  /** Throws a `WORKER_TARGET_STALE` error unless the fence names the member's current lifetime and version (null lifetime: never spawned). */
  assertMember(target: Readonly<{ workerId: string; lifetimeId: string | null; expectedVersion: number }>): WorkerMemberState;
  start(member: WorkerPoolMember): Promise<void>;
  /** Starts the member unless a process for it has not exited. */
  ensure(member: WorkerPoolMember): Promise<void>;
  /** Stops the member if it has a process; resolves once its exit is observed and settled. */
  stop(workerId: string, reason: "operator" | "reset" | "remove"): Promise<void>;
  /** Closes the member's browsers, stops it and deletes its browser profiles. */
  remove(member: WorkerPoolMember): Promise<void>;
  /** Tells a running member its directive changed; the slot already holds it. */
  direct(workerId: string, directive: "run" | "pause"): Promise<void>;
  browser(target: Readonly<{ workerId: string; lifetimeId: string; expectedVersion: number; browserSessionId: string }>, type: "refresh-browser" | "reopen-browser"): Promise<void>;
  checkParkedWrite(target: ParkedWriteCheckTarget, command: CommandRequest): Promise<unknown>;
}

export interface WorkerPoolRuntimeAdoption {
  readonly pool: WorkerPoolRuntimeSeam;
}


export interface IntakeProjectionResolver {
  resolve(workflowId: string): IntakeProjection | undefined;
}


export interface RunConfigIdentity {
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
}

export interface CommandKernelDependencies {
  readonly ensureReceipt?: (runId: string) => unknown;
  readonly workbookRows?: Readonly<{
    resolve(repositories: AuthorityRepositories, command: Extract<CommandRequest, { type: "resolve-workbook-row" }>): unknown;
    resolveReference?(repositories: AuthorityRepositories, command: Extract<CommandRequest, { type: "resolve-workbook-reference-row" }>, capturedAt: string): SchemaBoundCanonicalValue | Readonly<{ state: "pending" }>;
  }>;
  readonly preflight?: PreflightAdmission;
  readonly applicationQuitAvailable?: boolean;
  readonly authority: CommandAuthority;
  readonly lifecycle: RunRecordService;
  readonly clock: Clock;
  readonly ids: IdFactory;

  readonly appVersion: string;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly readableDescriptors?: WorkflowDescriptorResolver;
  readonly writeResolution: WriteResolutionExecutor;
  readonly workerRuntime: WorkerPoolRuntimeAdoption;
  readonly intakeParser: IntakeParser;
  readonly intakeProjections: IntakeProjectionResolver;
  readonly configIdentity: RunConfigIdentity;
  /** The strict settings-file CAS executor. An active settings command cannot exist without it. */
  readonly settings?: SettingsApplicationExecutor;
  readonly authorityProfileId?: string;
  readonly authorityInstallationId?: string;
  readonly prepareAssistantModelPreference?: (request: z.infer<typeof AssistantModelPreferenceCommandRequestSchema>) => Promise<() => true>;
  readonly assistantSurface?: () => readonly Readonly<{ method: string; path: string }>[];
  readonly workflowSources?: Readonly<Record<string, "mock" | "served" | "hidden">>;
  readonly assistantRevalidate?: (command: CommandRequest) => void;
  readonly failureResolution?: Readonly<{execute:typeof executeFailureResolution;capability:typeof failureResolutionCapability}>;
  readonly commandNotices?: Pick<NotificationInbox, "record">;


}

export interface CommandKernel {
  assistantAvailability(): ReturnType<typeof commandAssistantAvailability>;
  assistantManifest(): z.infer<typeof AssistantActionManifestSchema>;
  execute(input: unknown, parentCommandId?: string): CommandResult;

  executeStart(input: unknown): Promise<CommandResult>;
  executeWorkerPool(input: unknown): Promise<CommandResult>;
  executeAssistantModelPreference(input: unknown): Promise<CommandResult>;
}

/* ── internals ───────────────────────────────────────────────────────────── */

// Throwing a typed non-applied result rolls back partial effects while retaining its command outcome.


function workerTarget(workerId: string): TargetReference {
  return { family: "worker-browser", workerId };
}

function reject(request: CommandRequest, code: string, message: string): never {
  throw new CommandRefusal({ state: "rejected", commandId: request.commandId, code, message });
}

// Invalid served proof is a typed rejection that rolls back the transaction, not a transport failure.

function conflict(request: CommandRequest, currentVersion: number, message: string): never {
  throw new CommandRefusal({ state: "conflict", commandId: request.commandId, currentVersion, message });
}

function applied(
  request: CommandRequest,
  affectedTargets: readonly TargetReference[],
  versionChanges: readonly VersionChange[],
  affectedDependencyIds: readonly string[] = [],
  rollback?: () => void,
  commit?: () => void,
  settingsResult?: Readonly<
    | { kind: "ordinary"; revision: number; settingsFingerprint: string; restartRequired: boolean }
    | { kind: "protected"; readback: ProtectedSettingsReadback }
  >,
): CommandApplication {
  return Object.freeze({
    result: CommandResultSchema.parse({
      state: "applied",
      commandId: request.commandId,
      affectedTargets,
      ...(request.family === "notification" && "members" in request.target && request.target.matchingCount === 0 && affectedTargets.length === 0
        ? { noChange: "no-matching-notifications" } : {}),
      ...(settingsResult?.kind === "ordinary" ? {
        restartRequired: settingsResult.restartRequired,
        settingsRevision: settingsResult.revision,
        settingsFingerprint: settingsResult.settingsFingerprint,
      } : settingsResult?.kind === "protected" ? {
        restartRequired: false,
        revision: settingsResult.readback.revision,
        entries: settingsResult.readback.entries,
      } : {}),
    }),
    versionChanges,
    affectedDependencyIds,
    ...(rollback === undefined ? {} : { rollback }),
    ...(commit === undefined ? {} : { commit }),
  });
}

export function deriveGateResultCheckpointFingerprint(result: unknown): string {
  return deriveGateFingerprint(result);
}

function resolveDescriptorOrReject(
  dependencies: CommandKernelDependencies,
  request: CommandRequest,
  workflowId: string,
): AnyWorkflowDescriptor {
  const descriptor = (request.family === "gate" ? dependencies.readableDescriptors ?? dependencies.descriptors : dependencies.descriptors).resolve(workflowId);
  if (descriptor === undefined) {
    reject(request, "target-not-found", `workflow ${workflowId} is not registered; the command names an unknown target`);
  }
  return descriptor;
}

function requireDescriptorMatchesEnvelope(
  request: CommandRequest,
  descriptor: AnyWorkflowDescriptor,
  run: RunRecord,
): void {
  if (descriptor.version !== run.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `run ${run.envelope.runId} was enqueued under ${run.envelope.workflow} v${String(run.envelope.descriptorVersion)} `
      + `(${run.envelope.contractFingerprint.slice(0, 12)}…) but the registered descriptor is `
      + `v${String(descriptor.version)} (${descriptor.contractFingerprint.slice(0, 12)}…); re-plan instead of acting on a drifted contract`,
    );
  }
}

function requireRun(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  runId: string,
): RunRecord {
  if (repositories.deletedRuns.get(runId) !== undefined) reject(request, "target-deleted", "run was deleted");
  const run = repositories.runs.get(runId);
  if (run === undefined) reject(request, "target-not-found", `run ${runId} does not exist`);
  return run;
}



function lifecycleRefusal(request: CommandRequest, refusal: RunRecordRefusal): never {
  switch (refusal.reason) {
    case "conflict": return conflict(request, refusal.currentVersion, "run version changed");
    case "schema-mismatch": return reject(request, "schema-mismatch", "run schema changed");
    case "source-deleted": case "tombstoned": return reject(request, "target-deleted", "run was deleted");
    case "policy-refused": return reject(request, "policy-refused", "run policy refuses this operation");
    case "shared-checkpoint": return reject(request, "policy-refused", "This run owns a checkpoint still referenced by retained evidence.");
    case "unresolved-write": return reject(request, "policy-refused", "This run has an unresolved external write.");
    case "runtime-stale": return reject(request, "schema-mismatch", "runtime configuration changed");
    case "workflow-unregistered": return reject(request, "target-not-found", "workflow is not registered");
    case "illegal-transition": return reject(request, "invalid-state", refusal.message);
    case "owned-by-worker": case "invalid-state": case "not-terminal":
    case "already-archived": case "is-member": case "tree-non-terminal": case "use-archive-door":
      return reject(request, "invalid-state", `run lifecycle refused: ${refusal.reason}`);
    case "parent-missing": case "retry-of-missing": case "identity-conflict": case "cursor-stale":
    case "lost": case "replay-divergent": case "retention-not-due": case "none-eligible": case "worker-busy":
      throw new Error(`unexpected operator lifecycle refusal: ${refusal.reason}`);
  }
}

function lifecycleRun(request: CommandRequest, outcome: RunMutationOutcome | RunExistence, relatedRunChanges?: RelatedRunChange[]): RunRecord {
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state === "deleted") reject(request, "target-deleted", "run was deleted");
  if (outcome.state === "absent") reject(request, "target-not-found", "run does not exist");
  if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) {
    relatedRunChanges?.push(...outcome.relatedRunChanges ?? []);
    return outcome.run;
  }
  throw new Error(`unexpected operator lifecycle result: ${outcome.state}`);
}

/* ── the arms ────────────────────────────────────────────────────────────── */

function readStartPlan(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
) {
  const descriptor = resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
  const plan = repositories.startPlans.get(request.target.startPlanId);
  if (plan === undefined) {
    reject(request, "target-not-found", `start plan ${request.target.startPlanId} does not exist; plan before starting`);
  }
  if (plan.workflowId !== request.target.workflowId) {
    reject(
      request,
      "invalid-state",
      `start plan ${plan.startPlanId} was planned for ${plan.workflowId}, not ${request.target.workflowId}`,
    );
  }
  if (descriptor.version !== plan.descriptorVersion
    || descriptor.contractFingerprint !== plan.descriptorFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against ${plan.workflowId} v${String(plan.descriptorVersion)} `
      + `but the registered descriptor is v${String(descriptor.version)}; re-plan before starting`,
    );
  }
  const currentIngressHash = deriveSchemaHash(descriptor.input, "input");
  const currentCanonicalHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  if (currentIngressHash !== plan.ingressSchemaHash || currentCanonicalHash !== plan.canonicalInputSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against a different ingress/canonical schema for ${plan.workflowId}; re-plan before starting`,
    );
  }

  const mismatched = [
    ["descriptor", plan.descriptorFingerprint, request.payload.descriptorFingerprint],
    ["config", plan.configFingerprint, request.payload.configFingerprint],
    ["ingress schema", plan.ingressSchemaHash, request.payload.ingressSchemaHash],
    ["canonical-input schema", plan.canonicalInputSchemaHash, request.payload.canonicalInputSchemaHash],
    ["input", plan.inputFingerprint, request.payload.inputFingerprint],
  ].find(([, planned, presented]) => planned !== presented);
  if (mismatched !== undefined) reject(request, "schema-mismatch",
    `start plan ${plan.startPlanId} was planned against a different ${String(mismatched[0])}; re-plan before starting`);
  const confirmationVersion = plan.consumedBy === undefined ? plan.version : plan.version - 1;
  if (request.target.expectedVersion !== confirmationVersion) conflict(request, plan.version,
    `start plan ${plan.startPlanId} confirmation expected revision ${String(confirmationVersion)} but received ${String(request.target.expectedVersion)}; re-plan before starting`);
  if (plan.consumedBy !== undefined) reject(request, "invalid-state",
    `start plan ${plan.startPlanId} was already consumed by command ${plan.consumedBy.commandId}`);
  if (isStartPlanExpired(plan, Date.parse(now))) reject(request, "RUN_START_PLAN_EXPIRED",
    `start plan ${plan.startPlanId} expired at ${plan.expiresAt}`);

  if (!reviewedRunSettingsCurrent(repositories, plan)) {
    reject(request, "replan-required", "Settings changed after this plan was reviewed; review a fresh plan before starting");
  }
  if (plan.rerun !== undefined) {
    let current;
    try {
      current = buildRerunPlan(repositories, descriptor, plan.rerun.source, plan.planned, plan.rerun.acknowledgment, plan.stepOmissions,
        dependencies.authority.evidenceSchemaHash?.bind(dependencies.authority));
    } catch (error) {
      if (!(error instanceof RerunRefusedError)) throw error;
      reject(request, error.code === "source-stale" ? "replan-required" : error.code, error.message);
    }
    if (canonicalJsonStringify(current) !== canonicalJsonStringify(plan.rerun)
      || (current.warnings.length > 0 && current.acknowledgment !== current.warningDigest)) {
      throw new CommandRefusal(CommandResultSchema.parse({ state: "confirmation-required", commandId: request.commandId,
        warningDigest: current.warningDigest, message: "Confirm the current repeat warning before final submission" }));
    }
  }

  if (descriptor.enqueue === "supersede-active") {
    for (const entry of plan.planned) {
      const current = startSupersedeTargets(repositories.runs.listByItem({ workflow: plan.workflowId, itemId: entry.itemId }));
      if (entry.supersedeTargets === undefined || canonicalJsonStringify(entry.supersedeTargets) !== canonicalJsonStringify(current)) {
        reject(request, "replan-required", "Active runs changed after the supersede preview; review a fresh plan before starting");
      }
    }
  }
  const captureReference = createWorkbookReferenceCapture(repositories.workbooks);
  let selectedSources: { libraryId: string; sheetId: string }[] | undefined;
  for (const planned of plan.planned) {
    const captured = planned.workbookReferences ?? [];
    const sources: { libraryId: string; sheetId: string }[] = [];
    const requirement = descriptor.workbookReference;
    if (requirement === undefined ? captured.length !== 0 : captured.length < 1 || captured.length > MAX_SELECTED_WORKBOOK_SOURCES) {
      reject(request, "replan-required", "Workbook source selection changed; review a fresh plan before starting");
    }
    for (const bound of captured) {
      try {
        const reference = parseRunWorkbookReference(bound);
        const snapshot = reference.snapshot;
        const worksheet = snapshot.worksheets[0];
        if (requirement === undefined || snapshot.worksheets.length !== 1 || worksheet === undefined
          || !("versionId" in snapshot) || snapshot.versionId === undefined
          || reference.request.typeId !== requirement.id) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const refreshed = captureReference({
          kind: "selected-source", typeId: requirement.id, keyFieldId: requirement.keyFieldId,
          fields: descriptor.requiredWorkbookFields, writableFields: requirement.writableFields,
          mode: requirement.mode, keys: "mode" in reference.request ? [] : reference.request.keys,
          libraryId: snapshot.libraryId, versionId: snapshot.versionId, sheetId: worksheet.sheetId,
          expectedVersion: snapshot.version,
          ...("selectedRow" in reference.request && reference.request.selectedRow !== undefined
            ? { selectedRow: reference.request.selectedRow } : {}),
        });
        if (canonicalJsonStringify(bindRunWorkbookReference(reference.request, refreshed)) !== canonicalJsonStringify(bound))
          throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
        sources.push({ libraryId: snapshot.libraryId, sheetId: worksheet.sheetId });
        if (new Set(sources.map(source => JSON.stringify([source.libraryId, source.sheetId]))).size !== sources.length) {
          reject(request, "replan-required", "Workbook source selection changed; review a fresh plan before starting");
        }
      } catch (error) {
        if (!(error instanceof WorkbookLibraryError)) throw error;
        reject(request, "replan-required", "Workbook source changed after planning; review a fresh plan before starting");
      }
    }
    if (selectedSources !== undefined && canonicalJsonStringify(sources) !== canonicalJsonStringify(selectedSources)) {
      reject(request, "replan-required", "Workbook source selection differs between planned entries; review a fresh plan before starting");
    }
    selectedSources = sources;
  }
  return { descriptor, plan, selectedSources };
}

function executeStartRun(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
): CommandApplication {
  const { descriptor, plan, selectedSources } = readStartPlan(dependencies, repositories, request, now);
  dependencies.preflight?.assertReady(workflowPreflightScope(descriptor, plan));
  const consumption = repositories.startPlans.consume({
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
    commandId: request.commandId,
    descriptorFingerprint: request.payload.descriptorFingerprint,
    configFingerprint: request.payload.configFingerprint,
    ingressSchemaHash: request.payload.ingressSchemaHash,
    canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
    inputFingerprint: request.payload.inputFingerprint,
    now,
  });
  if (consumption.state === "refused") {
    if (consumption.code === "version-mismatch") conflict(request, plan.version, consumption.message);
    if (consumption.code === "fingerprint-mismatch") reject(request, "schema-mismatch", consumption.message);
    reject(request, consumption.code === "expired" ? "RUN_START_PLAN_EXPIRED" : "invalid-state", consumption.message);
  }
  if (consumption.state !== "consumed") {
    throw new Error(
      `start plan ${plan.startPlanId} reported ${consumption.state} for a first execution of command ${request.commandId}; `
      + "an unjournaled command cannot have consumed a plan",
    );
  }

  const startReference: TargetReference = {
    family: "start",
    workflowId: request.target.workflowId,
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
  };
  const affectedTargets: TargetReference[] = [startReference];
  const versionChanges: VersionChange[] = [{
    target: startReference,
    before: request.target.expectedVersion,
    after: consumption.plan.version,
  }];

  const fanOut = fanOutQueuedRuns(
    repositories,
    dependencies.lifecycle,
    (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
    descriptor,
    {
      commandId: request.commandId, actorId: request.requestedBy,
      ...(plan.rerun === undefined ? {} : { sourceBound: { ...plan.rerun, confirmationCommandId: request.commandId } }),
      workflow: plan.workflowId,
      descriptorVersion: plan.descriptorVersion,
      contractFingerprint: plan.descriptorFingerprint,
      ...(plan.requestedInstance === undefined ? {} : { requestedInstance: plan.requestedInstance }),
      resolvedInstance: plan.resolvedInstance,
      configFingerprint: plan.configFingerprint,
      configSnapshotId: plan.configSnapshotId,
      shape: plan.shape,
      priority: plan.priority,
      dryRun: plan.dryRun,
      ...(plan.recovery === undefined ? {} : { recovery: plan.recovery }),
      ...(plan.browserMode === undefined ? {} : { browserMode: plan.browserMode }),
      ...(plan.captureBrowserScreenshots === undefined
        ? {}
        : { captureBrowserScreenshots: plan.captureBrowserScreenshots }),
      ...(plan.stepOmissions === undefined ? {} : { stepOmissions: plan.stepOmissions }),
      ingressSchemaHash: plan.ingressSchemaHash,
      appVersion: dependencies.appVersion,

      session: {
        sessionId: dependencies.ids.uuid(),
        origin: { kind: "start-plan", startPlanId: plan.startPlanId, actorId: request.requestedBy },
      },
    },
    plan.planned.map((planned) => ({
      itemId: planned.itemId,
      title: planned.title, subtitle: planned.subtitle,
      ...(plan.rerun === undefined || repositories.runs.get(plan.rerun.source.runId)?.envelope.itemId !== planned.itemId
        ? {} : { retryOf: plan.rerun.source.runId }),
      matchKey: planned.matchKey,
      rawInput: planned.rawInput,
      parsedInput: planned.input,
      ...(planned.workbookReferences === undefined ? {} : { workbookReferences: planned.workbookReferences }),
    })),
    now,
    `plan ${plan.startPlanId}`,
  );

  if (fanOut.runs.length > 0 && selectedSources !== undefined && selectedSources.length > 0) {
    repositories.workbooks.rememberLastUsed({
      workflowId: plan.workflowId, acceptedCommandId: request.commandId, usedAt: now, sources: selectedSources,
    });
  }

  return applied(
    request,
    [...affectedTargets, ...fanOut.affectedTargets],
    [...versionChanges, ...fanOut.versionChanges],
  );
}


function executeRecover(
  dependencies: CommandKernelDependencies, repositories: AuthorityRepositories,
  request: RunBasicCommand & { type: "recover-run" },
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  const planning = workflowPlanning(descriptor);
  const publication = { ...protectedSubjectDisplay(retainedRunProtectedBindings(current), () => ({
    title: planning.title(current.input.parsed.value), subtitle: planning.subtitle(current.input.parsed.value),
  })), actorId: request.requestedBy };
  const relatedRunChanges: RelatedRunChange[] = [];
  let record: RunRecord;
  let children: readonly RunRecord[];
  try {
    planRunRecovery(repositories, descriptor, current, request.commandId, dependencies.authority.evidenceSchemaHash?.bind(dependencies.authority));
    record = lifecycleRun(request, dependencies.lifecycle.recover({
      commandId: lifecycleCommandId("operator-recover-run", request.commandId),
      runId: current.envelope.runId, expectedVersion: request.target.expectedVersion,
      runtimeConfig: selectRunRuntime(repositories), appVersion: dependencies.appVersion,
      sourceCommandId: request.commandId,
    }, descriptor, publication), relatedRunChanges);
    children = dependencies.lifecycle.continueDelegations(record, request.commandId, relatedRunChanges);
  } catch (error) {
    if (error instanceof RerunRefusedError || error instanceof RunContinuationRefusedError)
      reject(request, "RUN_CONTINUATION_REFUSED", ERROR_CATALOG.RUN_CONTINUATION_REFUSED.text);
    throw error;
  }
  return recoveryApplication(request, repositories, record, current, children, relatedRunChanges);
}

function executeRetry(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunRecoveryCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.lifecycle.state === "parked-write") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on write intent ${current.lifecycle.writeIntentId}; `
      + "a parked unknown write uses recheck-write/resolve-write-absent, never generic retry",
    );
  }
  if (!isTerminalRunState(current.lifecycle)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a terminal run can be retried`,
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);
  if (descriptor.enqueue === "reject-active") {
    const active = activeRunsForItem(repositories, current.envelope.workflow, current.envelope.itemId);
    if (active.length > 0) {
      reject(
        request,
        "policy-refused",
        `${current.envelope.workflow} item ${current.envelope.itemId} already has an active run `
        + `(${active[0].envelope.traceId}); it must settle before a retry starts`,
      );
    }
  }

  const planning = workflowPlanning(descriptor);
  const value = current.input.parsed?.value;
  if (value === undefined) throw new Error("retry source lacks canonical input");
  const relatedRunChanges: RelatedRunChange[] = [];
  let record: RunRecord;
  let children: readonly RunRecord[] = [];
  try {
    if (current.envelope.parent !== undefined) {
      const parent = repositories.runs.get(current.envelope.parent.runId);
      const parentDescriptor = parent === undefined ? undefined : dependencies.descriptors.resolve(parent.envelope.workflow);
      const authorization = parent === undefined || parentDescriptor === undefined ? undefined : authorizeWorkflowDelegationRefresh(parentDescriptor, parent);
      if (parent !== undefined && parent.lifecycle.state === "terminal" && authorization !== undefined
        && workflowDelegationAccounting(authorization, parent) !== undefined) {
        assertDelegationRetryUnwritten(repositories, current, descriptor);
        if (dependencies.ensureReceipt === undefined) throw new RunContinuationRefusedError("delegation-accounting-receipt-service-unavailable");
        dependencies.ensureReceipt(parent.envelope.runId);
      }
    }
    record = lifecycleRun(request, dependencies.lifecycle.retry({
      commandId: lifecycleCommandId("operator-retry", request.commandId),
      runId: current.envelope.runId, expectedVersion: request.target.expectedVersion,
      runtimeConfig: selectRunRuntime(repositories), appVersion: dependencies.appVersion,
      sourceCommandId: request.commandId,
    }, descriptor, { ...protectedSubjectDisplay(retainedRunProtectedBindings(current), () => ({ title: planning.title(value), subtitle: planning.subtitle(value) })), actorId: request.requestedBy }), relatedRunChanges);
    if (current.envelope.parent !== undefined) children = dependencies.lifecycle.continueDelegations(record, request.commandId, relatedRunChanges);
  } catch (error) {
    if (current.envelope.parent !== undefined && (error instanceof RerunRefusedError || error instanceof RunContinuationRefusedError))
      reject(request, "RUN_CONTINUATION_REFUSED", ERROR_CATALOG.RUN_CONTINUATION_REFUSED.text);
    throw error;
  }
  return recoveryApplication(request, repositories, record, current, children, relatedRunChanges);

}

function recoveryApplication(request: CommandRequest, repositories: AuthorityRepositories, record: RunRecord, original: RunRecord,
  children: readonly RunRecord[], related: readonly RelatedRunChange[]) {
  const targets = new Map([record, original, ...children].map(run => [run.envelope.runId,runTarget(run.envelope.runId)]));
  const changes = new Map<string, VersionChange>();
  for (const run of [record, ...children]) {
    const current = repositories.runs.get(run.envelope.runId);
    if (current === undefined) throw new Error("delegation-recovery-result-unavailable");
    changes.set(run.envelope.runId,{ target: runTarget(run.envelope.runId), before: 0, after: current.version });
  }
  for (const change of related) {
    targets.set(change.runId,runTarget(change.runId));
    const previous = changes.get(change.runId);
    changes.set(change.runId,{ target: runTarget(change.runId), before: previous?.before ?? change.before, after: change.after });
  }
  return applied(request,[...targets.values()],[...changes.values()]);
}

interface CancelTarget {
  readonly run: RunRecord;
  readonly dependencyId?: string;
}

// Cancel cannot change an unresolved fenced write intent.
function refuseCancelOverUnresolvedWrite(
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  targets: readonly CancelTarget[],
  finishFencedWrite: boolean,
): void {
  for (const target of targets) {
    const runId = target.run.envelope.runId;
    for (const intent of repositories.writeIntents.listByRun(runId)) {
      if (intent.status !== "attempting" && intent.status !== "parked") continue;
      // A claimed run is only marked cancel-requested: its fenced write finishes and settles once, then the run ends at its next boundary.
      if (finishFencedWrite && intent.status === "attempting" && runClaim(target.run) !== undefined) continue;
      const scope = runId === request.target.runId
        ? `run ${runId}`
        : `run ${runId}, a cascade-cancelled member of ${request.target.runId},`;
      reject(
        request,
        "invalid-state",
        `${scope} holds ${intent.system} write intent ${intent.writeIntentId} at generation `
        + `${String(intent.generation)}, which is ${intent.status}: a real HR transaction was fenced and `
        + "nobody has said whether it landed. Cancelling would settle the run terminal and take both of "
        + "ref write-safety §4.1's typed resolutions off the surface with it, so nothing was cancelled. Record the "
        + "write present or absent first, then cancel.",
      );
    }
  }
}

function executeCancel(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  now: string,
  finishFencedWrite = false,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before cancelling a tree`,
    );
  }
  if (isTerminalRunState(current.lifecycle)) {
    reject(request, "invalid-state", `run ${request.target.runId} is already terminal; there is nothing to cancel`);
  }


  const targets: CancelTarget[] = [{ run: current }];
  const dependencyIds: string[] = [];
  const visited = new Set<string>([current.envelope.runId]);
  const walk = (parent: RunRecord): void => {
    const groups = retainedDelegationManifests(repositories,parent.envelope.runId).map(manifest => ({ manifest, group: { children: repositories.dependencies.members(manifest.manifestId) } }));
    const currentIds = new Set(currentDelegationManifests(repositories,parent.envelope.runId).map(manifest => String(manifest.manifestId)));
    for (const child of repositories.runs.listChildren(parent.envelope.runId)) {
      const childRunId = child.envelope.runId;
      if (visited.has(childRunId)) {
        throw new Error(`run ${childRunId} appears twice in the dependency tree under ${request.target.runId}`);
      }
      visited.add(childRunId);
      const selected = selectDelegationGroupForChild(groups,currentIds,childRunId);
      const edge = selected?.group.children.find(member => member.history.includes(childRunId))?.dependency;
      if (edge === undefined) throw new Error(`run ${childRunId} is a child of ${parent.envelope.runId} but has no dependency edge in authority; the tree is inconsistent, so no target was cancelled`);
      if (edge.policy.cascadeCancel !== "cascade") continue;
      dependencyIds.push(edge.dependencyId);
      if (!isTerminalRunState(child.lifecycle)) targets.push({ run: child, dependencyId: edge.dependencyId });
      walk(child);
    }
  };
  walk(current);
  refuseCancelOverUnresolvedWrite(repositories, request, targets, finishFencedWrite);

  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  for (const target of [...targets].reverse()) {
    const outcome = dependencies.lifecycle.transition({
      commandId: lifecycleCommandId("operator-cancel", { commandId: request.commandId, runId: target.run.envelope.runId }),
      runId: target.run.envelope.runId,
      expectedVersion: target.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
      cancellationSource: { commandId: request.commandId, rootRunId: request.target.runId },
    });
    const cancelled = lifecycleRun(request, outcome);
    affectedTargets.push(runTarget(target.run.envelope.runId));
    versionChanges.push({
      target: runTarget(target.run.envelope.runId),
      before: target.run.version,
      after: cancelled.version,
    });
  }
  return applied(request, affectedTargets, versionChanges, dependencyIds);
}

function executeDelete(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunDeleteCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before deleting it`,
    );
  }
  if (!isTerminalRunState(current.lifecycle)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a terminal run can be deleted — cancel it first`,
    );
  }
  // Delete a delegated member with its group; deleting it alone would break manifest membership.
  if (current.envelope.parent !== undefined) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is a delegated member of run ${current.envelope.parent.runId}; delete the group`,
    );
  }
  const order = deleteTreeOrder(repositories, request, current);
  const outcome = dependencies.lifecycle.delete({ commandId: lifecycleCommandId("operator-delete", request.commandId),
    runId: current.envelope.runId, expectedVersion: request.target.expectedVersion });
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state !== "deleted" && outcome.state !== "applied-already") throw new Error(`delete: ${outcome.state}`);
  return applied(request, order.map((run) => runTarget(run.envelope.runId)), []);
}


function deleteTreeOrder(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  root: RunRecord,
): readonly RunRecord[] {
  const order: RunRecord[] = [];
  const visited = new Set<string>([root.envelope.runId]);
  const walk = (parent: RunRecord): void => {
    const edges = repositories.dependencies.listByParentRun(parent.envelope.runId);
    for (const child of repositories.runs.listChildren(parent.envelope.runId)) {
      const childRunId = child.envelope.runId;
      if (visited.has(childRunId)) {
        throw new Error(`run ${childRunId} appears twice in the dependency tree under ${root.envelope.runId}`);
      }
      visited.add(childRunId);
      if (edges.length === 0) {
        repositories.dependencies.lifecycleEdgeForChild(parent.envelope.runId, childRunId);
      } else if (!edges.some((candidate) => candidate.childRunId === childRunId)) {
        throw new Error(
          `run ${childRunId} is a child of ${parent.envelope.runId} but has no dependency edge in authority; `
          + "the tree is inconsistent, so nothing was deleted",
        );
      }
      if (!isTerminalRunState(child.lifecycle)) {
        reject(
          request,
          "invalid-state",
          `run ${root.envelope.runId} has a delegated child ${childRunId} that is ${child.lifecycle.state}; `
          + "every member must be terminal before the tree can be deleted",
        );
      }
      walk(child);
      order.push(child);
    }
  };
  walk(root);
  order.push(root);
  return order;
}

function executeBump(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);

  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before bumping it`,
    );
  }
  if (current.lifecycle.state !== "queued") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; the scheduler supports no cooperative yield, `
      + "so only a queued run's claim order can be bumped",
    );
  }
  if (current.envelope.priority === "interactive") {
    return applied(request, [runTarget(request.target.runId)], []);
  }
  const outcome = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-bump", request.commandId),
    priority: "interactive",
    runId: request.target.runId,
    expectedVersion: request.target.expectedVersion,
  });
  requireApplied(outcome, `bumping run ${request.target.runId}`);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}


function intakeTarget(intakeSessionId: string): TargetReference {
  return { family: "intake", intakeSessionId };
}


function executeNotification(
  repositories: AuthorityRepositories,
  request: NotificationCommand,
  now: string,
): CommandApplication {
  if (request.target.actorId !== request.requestedBy) {
    reject(request, "invalid-state", "notification target actor does not match the admitted command actor");
  }
  if ("members" in request.target) {
    const operation: NotificationCollectionOperation = request.type === "notification-read-all" ? "read" : request.type === "notification-unread-all" ? "unread"
      : request.type === "notification-snooze-all" ? "snooze" : "unsnooze";
    const observed = repositories.notifications.collection(request.target.actorId, operation);
    if (canonicalJsonStringify(observed) !== canonicalJsonStringify(request.target)) reject(request, "invalid-state", "notification collection changed; reload the inbox");
    const rows = repositories.notifications.listByActor(request.target.actorId).filter(row => notificationMatchesCollection(row, operation));
    const changes = rows.map(row => applyNotificationState(repositories, row, operation, now));
    return applied(request, changes.map(change => change.target), changes.map(change => change.version));
  }
  const current = repositories.notifications.get(request.target.notificationId);
  if (current === undefined) {
    reject(request, "target-not-found", `notification ${request.target.notificationId} does not exist`);
  }
  if (current.actorId !== request.target.actorId) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} belongs to ${current.actorId}, not ${request.target.actorId}`,
    );
  }
  if (current.trigger === "backfill-gap") {
    reject(
      request,
      "policy-refused",
      "a pinned backfill gap cannot be marked read, marked unread, or snoozed; resnapshot and reconcile the affected work",
    );
  }
  if (current.version !== request.target.expectedVersion) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} moved to version ${String(current.version)} `
      + `(you loaded ${String(request.target.expectedVersion)}); reload the inbox`,
    );
  }
  const operation: NotificationCollectionOperation = request.type === "notification-read" ? "read" : request.type === "notification-unread" ? "unread"
    : request.type === "notification-snooze" ? "snooze" : "unsnooze";
  const change = applyNotificationState(repositories, current, operation, now);
  return applied(request, [change.target], [change.version]);
}

function applyNotificationState(repositories: AuthorityRepositories, current: NotificationRecord, operation: NotificationCollectionOperation, now: string) {
  repositories.notifications.updateState({ notificationId: current.notificationId, expectedVersion: current.version,
    status: operation === "read" ? "read" : operation === "unread" ? "unread" : current.status,
    snooze: operation === "snooze" ? { state: "snoozed", until: new Date(Date.parse(now) + 3_600_000).toISOString() }
      : operation === "unsnooze" ? { state: "not-snoozed" } : current.snooze, updatedAt: now });
  const target: TargetReference = { family: "notification", notificationId: current.notificationId };
  return { target, version: { target, before: current.version, after: current.version + 1 } };
}



function executeIntake(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: IntakeCommand,
  now: string,
): CommandApplication {
  const sessionId = request.target.intakeSessionId;
  const current = repositories.intakeSessions.get(sessionId);
  if (current === undefined) reject(request, "target-not-found", `intake session ${sessionId} does not exist`);
  if (request.type !== "enqueue-intake-manifest"
    && current.state !== "mapping" && current.state !== "validated") {
    reject(
      request,
      "invalid-state",
      `intake session ${sessionId} is ${current.state}; only an open session accepts mapping commands`,
    );
  }

  const target = intakeTarget(sessionId);
  const noOp = (): CommandApplication => applied(request, [target], []);
  const applyUpdate = (next: unknown): CommandApplication => {
    const updated = repositories.intakeSessions.update(next);
    return applied(request, [target], [{ target, before: current.version, after: updated.version }]);
  };

  const requireProjection = (): IntakeProjection => {
    const projection = dependencies.intakeProjections.resolve(current.workflow);
    if (projection === undefined) {
      reject(
        request,
        "policy-refused",
        `workflow ${current.workflow} declares no intake projection; it is not spreadsheet-capable, `
        + "so no column can be bound to it",
      );
    }
    return projection;
  };

  const parseAt = (sheet: string, headerRowIndex: number | null) => {
    const parse = IntakeParseSchema.parse(dependencies.intakeParser.parse({
      artifact: current.artifact,
      sheet,
      headerRowIndex,
    }));
    if (parse.state === "refused") {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} cannot read its source (${parse.code}): ${parse.message}`,
      );
    }
    return parse;
  };

  // Commands use the settled session header selection; never rediscover an unrecorded header row.
  const currentLayout = (): IntakeLayout => {
    const headerRowIndex = current.headerRowIndex;
    if (headerRowIndex === null) {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} has no settled header row on sheet ${JSON.stringify(current.sheet)}; `
        + "choose one with inspect-intake before mapping",
      );
    }
    const parse = parseAt(current.sheet, headerRowIndex);
    if (parse.layout === null) {
      throw new Error(
        `intake session ${sessionId} names header row ${String(headerRowIndex)} on sheet `
        + `${JSON.stringify(current.sheet)}, but the parser settled no layout for it`,
      );
    }
    return parse.layout;
  };

  const boundedSourceRow = (layout: IntakeLayout, sourceRow: number): void => {
    if (sourceRow > layout.rows.length) {
      reject(
        request,
        "invalid-state",
        `source row ${String(sourceRow)} is beyond the ${String(layout.rows.length)} data rows sheet `
        + `${JSON.stringify(current.sheet)} holds under header row ${String(layout.headerRowIndex)}`,
      );
    }
  };

  switch (request.type) {
    case "inspect-intake": {
      const comparisonManifestId = request.payload.comparisonManifestId ?? current.comparisonManifestId;
      if (request.payload.comparisonManifestId !== undefined) {
        if (current.version !== request.target.expectedVersion) conflict(request, current.version, "the comparison was selected from a stale Intake review");
        try { resolveIntakeComparison({ ...current, comparisonManifestId }, repositories.intakeManifests); }
        catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
      }
      const selection = resolveInspectSelection(current, request.payload);
      const parse = parseAt(selection.sheet, selection.headerRowIndex);
      // Discovery settles the header row when the operator has not chosen one,
      // so the settled index is the parse's, never the request's.
      const settled = parse.layout === null ? null : parse.layout.headerRowIndex;
      if (selection.sheet === current.sheet && settled === current.headerRowIndex) {
        if (comparisonManifestId === current.comparisonManifestId) return noOp();
        return applyUpdate({ ...current, comparisonManifestId, updatedAt: now, version: current.version + 1 });
      }
      return applyUpdate({
        ...current,
        sheet: selection.sheet,
        ...(comparisonManifestId === undefined ? {} : { comparisonManifestId }),
        headerRowIndex: settled,
        bindings: [],
        corrections: [],
        exclusions: [],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "confirm-intake-mapping": {
      const projection = requireProjection();
      const layout = currentLayout();
      if (layout.headerFingerprint !== request.payload.headerFingerprint) {
        reject(
          request,
          "schema-mismatch",
          `this file's layout is ${layout.headerFingerprint.slice(0, 12)}…, not the `
          + `${request.payload.headerFingerprint.slice(0, 12)}… the confirmation was built against; `
          + "reload the mapping grid before confirming a binding",
        );
      }
      if (projection.target(request.payload.targetFieldId) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.targetFieldId}`,
        );
      }
      const column = layout.columns.find((entry) => entry.sourceColumnId === request.payload.sourceColumnId);
      if (column === undefined) {
        reject(
          request,
          "invalid-state",
          `no column with id ${request.payload.sourceColumnId} is present in this file under header row `
          + `${String(layout.headerRowIndex)}`,
        );
      }
      const held = current.bindings.find((entry) => entry.targetFieldId === request.payload.targetFieldId);
      if (held !== undefined && held.sourceColumnId === request.payload.sourceColumnId) return noOp();
      // THE one mint (ref data-intake-and-edit-data ). It re-proves both checks above against the
      // projection and the detected columns; a suggestion cannot reach it.
      const binding = confirmBinding({
        projection,
        detected: layout.columns,
        targetFieldId: request.payload.targetFieldId,
        sourceColumnId: request.payload.sourceColumnId,
        confirmedAt: now,
      });
      return applyUpdate({
        ...current,
        bindings: [
          ...current.bindings.filter((entry) => entry.targetFieldId !== binding.targetFieldId),
          binding,
        ].sort((left, right) => left.targetFieldId.localeCompare(right.targetFieldId)),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "correct-intake-row": {
      const projection = requireProjection();
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      if (projection.target(request.payload.field) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.field}`,
        );
      }
      if (!current.bindings.some((entry) => entry.targetFieldId === request.payload.field)) {
        reject(
          request,
          "invalid-state",
          `${request.payload.field} has no bound column, so there is no cell to correct; `
          + "bind a column first",
        );
      }
      const held = current.corrections.find((entry) =>
        entry.sourceRow === request.payload.sourceRow && entry.field === request.payload.field);
      if (held !== undefined && held.correctedValue === request.payload.correctedValue) return noOp();
      return applyUpdate({
        ...current,
        corrections: [
          ...current.corrections.filter((entry) =>
            entry.sourceRow !== request.payload.sourceRow || entry.field !== request.payload.field),
          {
            sourceRow: request.payload.sourceRow,
            field: request.payload.field,
            correctedValue: request.payload.correctedValue,
            correctedAt: now,
          },
        ],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "exclude-intake-row": {
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      const held = current.exclusions.find((entry) => entry.sourceRow === request.payload.sourceRow);
      if (held !== undefined) {
        if (held.reason === request.payload.reason) return noOp();
        reject(
          request,
          "invalid-state",
          `source row ${String(request.payload.sourceRow)} is already excluded (${held.reason}); `
          + "an exclusion records the reason it was made with",
        );
      }
      return applyUpdate({
        ...current,
        exclusions: [
          ...current.exclusions,
          { sourceRow: request.payload.sourceRow, reason: request.payload.reason, excludedAt: now },
        ].sort((left, right) => left.sourceRow - right.sourceRow),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "validate-intake": {
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      // Re-derive dispositions from retained inputs and `readAt`; never store the result of this pass.
      validateIntakeRows({
        workflow: current.workflow,
        sourceSha256: current.artifact.sha256,
        projection,
        detected: layout.columns,
        bindings: current.bindings,
        rows: layout.rows,
        constants: current.constants,
        corrections: current.corrections,
        excludedRows: current.exclusions.map((entry) => entry.sourceRow),
        readAt: now,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      return applyUpdate({
        ...current,
        state: "validated",
        validation: { state: "validated", validatedAt: now, readAt: now },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "enqueue-intake-manifest": {
      if (current.state === "enqueued") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} already enqueued as manifest ${String(current.intakeManifestId)}; `
          + "a manifest fans out exactly once",
        );
      }
      if (current.state !== "validated" || current.validation.state !== "validated") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} is ${current.state}; the pre-run rejection review is mandatory `
          + "(ref data-intake-and-edit-data §5) — validate this mapping, review what it rejects, then run",
        );
      }

      if (current.version !== request.target.expectedVersion) {
        conflict(
          request,
          current.version,
          `intake session ${sessionId} is at version ${String(current.version)}, not `
          + `${String(request.target.expectedVersion)}; the plan you reviewed has moved — reload before running`,
        );
      }
      const sourceName = current.sourceName;
      if (sourceName === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} retains no source file name, so its manifest could not name the file `
          + "it ran; re-upload the file to start a session that does",
        );
      }
      const reservedManifestId = current.reservedManifestId;
      if (reservedManifestId === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} predates reserved manifest identities and cannot enqueue without one`,
        );
      }
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      if (request.payload.dryRun && !supportsDryRun(descriptor)) {
        reject(request, "policy-refused", dryRunRefusalMessage(descriptor));
      }
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      const canonicalInputSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
      // Re-derived against the RETAINED `readAt`, so the manifest this writes is
      // the plan the operator reviewed — never one the clock moved underneath.
      const plan = deriveIntakeEnqueuePlan({
        session: {
          workflow: current.workflow,
          artifact: current.artifact,
          sourceName,
          sheet: current.sheet,
          bindings: current.bindings,
          constants: current.constants,
          corrections: current.corrections,
          exclusions: current.exclusions,
          readAt: current.validation.readAt,
        },
        projection,
        layout,
        manifestId: reservedManifestId,
        createdAt: now,
        workflowContractFingerprint: descriptor.contractFingerprint,
        canonicalInputSchemaHash,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      if (!plan.readiness.ready) {
        const rows = plan.readiness.unresolvedRows;
        reject(
          request,
          "policy-refused",
          `${plan.readiness.message} [${plan.readiness.reason}${rows.length === 0 ? "" : `: source rows ${rows.join(", ")}`}]`,
        );
      }

      const assigned = new Set([...current.bindings.map(row => row.targetFieldId), ...current.constants.map(row => row.targetFieldId)]);
      if (projection.targets.some(field => field.required && !assigned.has(field.targetFieldId))) {
        reject(request, "policy-refused", "required intake fields are not bound; review the mapping before running");
      }
      let prior: IntakePlanManifest | undefined;
      try { prior = resolveIntakeComparison(current, repositories.intakeManifests); }
      catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
      if (request.payload.reviewBinding === undefined || request.payload.reviewBinding !== intakeReviewBinding(current, plan.manifest, prior)) {
        reject(request, "policy-refused", "the exact current Intake review must be confirmed; reload and review before running");
      }

      // Every enqueued config identity must resolve to its retained snapshot.
      const { configFingerprint, configSnapshotId } = selectNewRunIdentity(repositories, dependencies.configIdentity);
      const snapshot = repositories.configSnapshots.get(configSnapshotId);
      if (snapshot === undefined) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: authority holds no config snapshot ${configSnapshotId}`,
        );
      }
      if (snapshot.fingerprint !== configFingerprint) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: config snapshot ${configSnapshotId} holds fingerprint `
          + `${snapshot.fingerprint.slice(0, 12)}…, not the ${configFingerprint.slice(0, 12)}… this process resolved`,
        );
      }

      const stored = repositories.intakeManifests.insert(plan.manifest);
      if (stored.state !== "inserted") {
        throw new Error(
          `intake session ${sessionId} minted manifest id ${plan.manifest.manifestId}, which already exists; `
          + "refusing to adopt it",
        );
      }

      const fanOut = fanOutQueuedRuns(
        repositories,
        dependencies.lifecycle,
        (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
        descriptor,
        {
          commandId: request.commandId, actorId: request.requestedBy,
          workflow: current.workflow,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
          resolvedInstance: resolveInstances(descriptor, undefined),
          configFingerprint,
          configSnapshotId,

          shape: "single",
          // A spreadsheet fan-out is the definition of bulk, and this is a
          // server stamp rather than a caller claim (ref dashboard-surfaces ).
          priority: "bulk",
          dryRun: request.payload.dryRun,
          ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
          appVersion: dependencies.appVersion,

          session: {
            sessionId: dependencies.ids.uuid(),
            origin: {
              kind: "intake-manifest",
              intakeManifestId: plan.manifest.manifestId,
              actorId: request.requestedBy,
            },
          },
        },
        plan.manifest.validRows.map((row) => {
          let admitted: ReturnType<typeof admitProtectedInput>;
          try { admitted = admitProtectedInput(descriptor, [row.parsedInput]); }
          catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
          if (admitted.length !== 1) throw new Error("intake protected-input admission count mismatch");
          let canonicalInput: unknown;
          try {
            // Parse stored manifests through the current canonical schema, never ingress defaults.
            canonicalInput = planning.parseCanonicalInput(row.parsedInput);
          } catch (error) {
            throw new Error(
              `intake manifest ${plan.manifest.manifestId} source row ${String(row.sourceRow)} does not satisfy `
              + `${current.workflow}'s canonical input schema; nothing was enqueued`,
              { cause: error },
            );
          }
          return {
            itemId: row.itemId,
            title: planning.title(row.parsedInput), subtitle: planning.subtitle(row.parsedInput),
            matchKey: planning.matchKey(row.parsedInput),
            // The manifest's own stored value IS this run's ingress: it is what
            // intake submitted, and `validRows[].inputHash` pins its bytes.
            rawInput: row.parsedInput,
            parsedInput: { schemaHash: canonicalInputSchemaHash, value: canonicalInput, protectedBindings: admitted[0].bindings },
          };
        }),
        now,
        `intake manifest ${plan.manifest.manifestId}`,
      );

      const updated = repositories.intakeSessions.update({
        ...current,
        state: "enqueued",
        intakeManifestId: plan.manifest.manifestId,
        updatedAt: now,
        version: current.version + 1,
      });
      return applied(
        request,
        [target, ...fanOut.affectedTargets],
        [{ target, before: current.version, after: updated.version }, ...fanOut.versionChanges],
      );
    }
  }
}


/** An empty name after trimming clears the rename; anything else must be a valid display name. */
function trimmedDisplayName(request: RunRenameCommand) {
  const name = request.payload.displayName.trim();
  if (name.length === 0) return null;
  const parsed = RunDisplayNameSchema.safeParse(name);
  if (!parsed.success) reject(request, "invalid-value", parsed.error.issues.map(issue => issue.message).join("; "));
  return parsed.data;
}

function executePresentation(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunRenameCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  // Compare the caller revision, never the revision just read from authority.
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before renaming it — the name you are `
      + "holding may not be the name it has",
    );
  }
  const outcome = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-rename", request.commandId),
    runId: request.target.runId,
    expectedVersion: request.target.expectedVersion,
    displayName: trimmedDisplayName(request),
  });
  lifecycleRun(request, outcome);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}

function executeWriteResolution(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WriteResolutionCommand,
  now: string,
  auditId: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the write`,
    );
  }
  if (current.lifecycle.state !== "parked-write") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-write run has a write to resolve`,
    );
  }
  if (current.lifecycle.writeIntentId !== request.target.writeIntentId
    || current.lifecycle.intentGeneration !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on intent ${current.lifecycle.writeIntentId} `
      + `generation ${String(current.lifecycle.intentGeneration)}, not `
      + `${request.target.writeIntentId} generation ${String(request.target.intentGeneration)}; `
      + "the resolution is stale",
    );
  }
  const intent = repositories.writeIntents.get(request.target.writeIntentId);
  if (intent === undefined) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + "which does not exist in authority; refusing to resolve against an inconsistent store",
    );
  }
  if (intent.status !== "parked") {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is ${intent.status}; a ${intent.status} intent has no operator resolution`,
    );
  }
  if (intent.runId !== request.target.runId) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + `but that intent belongs to run ${intent.runId}; refusing to resolve against an inconsistent store`,
    );
  }
  if (intent.generation !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is at generation ${String(intent.generation)}, not `
      + `${String(request.target.intentGeneration)}; the resolution is stale`,
    );
  }

  if (intent.currentAttemptId !== request.target.writeAttemptId || intent.bindingProofDigest !== request.target.bindingProofDigest
    || intent.idempotencyKeyDigest !== request.payload.occurrenceKeyDigest) reject(request,"invalid-state","Resolution must bind the exact original parked attempt and permanent occurrence key");
  const context: WriteResolutionContext = Object.freeze({ command: request, run: current, intent, now, auditId });
  const raw = request.type === "recheck-write"
    ? dependencies.writeResolution.recheck(repositories, context)
    : dependencies.writeResolution.resolveAbsent(repositories, context);
  const outcome = WriteResolutionOutcomeSchema.parse(raw.outcome);
  if (outcome.run.envelope.runId !== request.target.runId) {
    throw new Error(
      `write resolution for run ${request.target.runId} returned run ${outcome.run.envelope.runId}; `
      + "the executor resolved a different target",
    );
  }
  if (outcome.run.version !== current.version + 1) throw new Error("parked-write-resolution-planned-version-mismatch");
  const application = applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: outcome.run.version,
  }]);
  return {...application,writeResolution:outcome.intent,afterAudit:()=>{
    const actual = WriteResolutionOutcomeSchema.parse(raw.applyAfterAudit());
    if (canonicalJsonStringify(actual) !== canonicalJsonStringify(outcome)
      || canonicalJsonStringify(repositories.runs.get(request.target.runId)) !== canonicalJsonStringify(outcome.run)
      || canonicalJsonStringify(repositories.writeIntents.get(request.target.writeIntentId)) !== canonicalJsonStringify(outcome.intent)) throw new Error("parked-write-resolution-acknowledged-effects-mismatch");
  }};
}

function executeResolveGate(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "gate" }>,
  now: string,
  source: "operator" | "workbook-reference",
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the gate`,
    );
  }
  if (current.lifecycle.state !== "parked-gate") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-gate run has a gate to resolve`,
    );
  }
  if (current.lifecycle.gateId !== request.target.gateId) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on gate ${current.lifecycle.gateId}, not ${request.target.gateId}`,
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);
  const node = descriptorRuntimeNodes(descriptor)
    .find((candidate) => candidate.kind === "gate" && String(candidate.id) === String(request.target.gateId));
  if (node === undefined || node.kind !== "gate") {
    throw new Error(
      `run ${request.target.runId} is parked on gate ${request.target.gateId}, which ${descriptor.id} does not declare; `
      + "the stored park is inconsistent with the descriptor",
    );
  }
  const declaration = findGateDecision(descriptor.id, request.target.gateId);
  if ((declaration !== undefined && declaration.resolution.source !== source)
    || (declaration === undefined && source !== "operator")) {
    reject(request, "policy-refused", "This gate must be resolved through its declared evidence source.");
  }
  if (node.resolvedBy !== "operator") {
    reject(
      request,
      "invalid-state",
      `gate ${request.target.gateId} is resolved by ${node.resolvedBy}; only its registered source may settle it`,
    );
  }
  const expectedSchemaHash = deriveSchemaHash(node.result, "output");
  if (request.payload.result.schemaHash !== expectedSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result is bound to schema ${request.payload.result.schemaHash.slice(0, 12)}…, `
      + `but the descriptor's exact gate schema is ${expectedSchemaHash.slice(0, 12)}…`,
    );
  }
  const parsedValue = node.result.safeParse(request.payload.result.value);
  if (!parsedValue.success) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result does not parse through the descriptor's exact gate schema: `
      + `${parsedValue.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const evidenceScope = gateEvidenceScope(repositories, request, descriptor, current, node);
  if (node.when !== undefined && !evaluateNodeCondition(node.when, evidenceScope)) {
    reject(
      request,
      "invalid-state",
      `gate ${request.target.gateId} on run ${request.target.runId} is now skipped by its declared condition; `
      + "no gate result was recorded",
    );
  }
  verifyGateEvidenceCurrent(request, descriptor, node, evidenceScope, now, current);
  if (current.envelope.workflow === "ocr" && String(node.id) === "approve-records") {
    const approval = request.payload.ocrApproval;
    if (approval === undefined || request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const review = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
    if (review === undefined || review.revision.revision !== approval.expectedRevision || review.digest !== approval.reviewDigest) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const lookupNodes = (["lookup-identities", "lookup-signers"] as const).filter(nodeId =>
      descriptorRuntimeNodes(descriptor).some(node => node.kind === "child-run" && node.id === nodeId));
    assertOcrReviewChildrenCurrent(repositories, request.target.runId, review.revision.seed, lookupNodes);
    const parsed = OcrApprovedSnapshotSchema.safeParse({ snapshotId: request.commandId, sourceRunId: request.target.runId,
      revision: review.revision.revision, reviewDigest: review.digest, selectedRecordIds: approval.selectedRecordIds,
      records: approval.selectedRecordIds.map(id => review.revision.records.find(record => record.recordId === id)),
      approvedBy: request.requestedBy, approvedAt: now });
    if (!parsed.success) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const snapshot = parsed.data;
    if (canonicalJsonStringify(parsedValue.data) !== canonicalJsonStringify({ snapshotId: snapshot.snapshotId,
      sourceRunId: snapshot.sourceRunId, revision: snapshot.revision, digest: ocrSnapshotDigest(snapshot) })) reject(request, "schema-mismatch", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    repositories.ocrReviews.approve(snapshot);
  } else if (request.payload.ocrApproval !== undefined) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
  const result = { schemaHash: expectedSchemaHash, value: parsedValue.data };
  const stored = repositories.gateResults.insert({
    nodeId: node.id,
    runId: request.target.runId,
    gateId: request.target.gateId,
    commandId: request.commandId,
    expectedVersion: request.target.expectedVersion,
    resolvedBy: request.requestedBy,
    resolvedAt: now,
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
    result,
  });
  if (stored.state !== "inserted") {
    throw new Error(
      `gate ${request.target.gateId} on run ${request.target.runId} already holds a stored result `
      + "while the run is still parked; the store is inconsistent",
    );
  }
  repositories.timelineEvents.append({ schemaVersion: 1,
    eventId: lifecycleCommandId("timeline-gate-resolved", request.commandId),
    workflow: current.envelope.workflow, scope: { kind: "run", runId: current.envelope.runId },
    occurredAt: now, recordedAt: now, retentionDate: localDatePart(new Date(now)), source: { kind: "native" },
    payload: { kind: "span", event: { t: "gate.resolved", ts: now, pid: process.pid,
      workflow: current.envelope.workflow, runId: current.envelope.runId, attempt: current.envelope.attempt,
      traceId: current.envelope.traceId, spanPath: current.envelope.traceId, gate: request.target.gateId,
      resolutionKey: "resolved", resultHash: createHash("sha256")
        .update(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(request.payload.result)}`).digest("hex") } },
  });
  const resumed = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-gate", request.commandId),
    lifecycle: { state: "queued" },
    runId: request.target.runId,
    expectedVersion: current.version,
  });
  lifecycleRun(request, resumed);
  const gateReference: TargetReference = {
    family: "gate",
    runId: request.target.runId,
    gateId: request.target.gateId,
  };
  return applied(request, [gateReference, runTarget(request.target.runId)], [{
    target: gateReference,
    before: current.version,
    after: current.version + 1,
  }]);
}

function gateEvidenceScope(
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "gate" }>,
  descriptor: AnyWorkflowDescriptor,
  run: ReturnType<typeof requireRun>,
  gate: Extract<ReturnType<typeof descriptorRuntimeNodes>[number], { kind: "gate" }>,
) {
  const input = JsonValueSchema.parse(descriptor.canonicalInput.parse(run.input.parsed.value));
  const nodes = descriptorRuntimeNodes(descriptor);
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
  const outputs: Record<string, JsonValue> = {};
  const checkpoints = new Map<string, Readonly<{ node: Extract<typeof nodes[number], { kind: "task" }>; record: RunCheckpointRecord }>>();
  const visiting = new Set<string>();
  const buildOutput = (nodeId: string): JsonValue => {
    const ready = outputs[nodeId];
    if (ready !== undefined) return ready;
    const node = nodesById.get(nodeId);
    if (node === undefined) {
      reject(request, "invalid-state", `gate ${gate.id} depends on undeclared node ${nodeId}`);
    }
    if (visiting.has(nodeId)) throw new Error(`workflow graph contains a dependency cycle at ${nodeId}`);
    visiting.add(nodeId);
    const dependencyOutputs: Record<string, JsonValue> = {};
    if (node.kind === "task") {
      const checkpoint = readRunCheckpoint(repositories, run.envelope, String(node.id), true);
      if (checkpoint === undefined) {
        reject(request, "invalid-state", `gate ${gate.id} cannot be resolved because dependency checkpoint ${node.id} is absent`);
      }
      const expectedSchemaHash = deriveSchemaHash(node.uses.output, "output");
      if (checkpoint.workflowId !== descriptor.id || checkpoint.itemId !== run.envelope.itemId
        || checkpoint.nodeId !== nodeId || checkpoint.attempt > run.envelope.attempt
        || checkpoint.descriptorVersion !== descriptor.version
        || checkpoint.contractFingerprint !== descriptor.contractFingerprint
        || checkpoint.implFingerprint !== taskImplFingerprint(node.uses)
        || checkpoint.output.schemaHash !== expectedSchemaHash) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency checkpoint ${nodeId} is not compatible with this run's descriptor`);
      }
      const parsedOutput = node.uses.output.safeParse(checkpoint.output.value);
      if (!parsedOutput.success) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency checkpoint ${nodeId} no longer parses through its task schema`);
      }
      const isCurrentExecution = checkpoint.runId === run.envelope.runId
        && checkpoint.attempt === run.envelope.attempt
        && Number(checkpoint.claimGeneration) === Number(run.claimGeneration);
      const expectedEventId = isCurrentExecution
        ? deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
          checkpoint.workflowId,
          checkpoint.itemId,
          checkpoint.nodeId,
          checkpoint.attempt,
          checkpoint.claimGeneration,
        ))
        : lifecycleCommandId("timeline-checkpoint-replayed", {
          runId: run.envelope.runId,
          nodeId,
          claimGeneration: run.claimGeneration,
        });
      const checkpointEvent = repositories.timelineEvents.get(expectedEventId);
      const expectedReference = timelineCheckpointReference(checkpoint);
      const eventMatches = checkpointEvent?.payload.kind === (isCurrentExecution ? "checkpoint-recorded" : "checkpoint-replayed")
        && checkpointEvent.payload.checkpoint !== undefined
        && canonicalJsonStringify(checkpointEvent.payload.checkpoint) === canonicalJsonStringify(expectedReference)
        && checkpointEvent.payload.workflow === descriptor.id
        && checkpointEvent.payload.runId === run.envelope.runId
        && checkpointEvent.payload.attempt === run.envelope.attempt
        && Number(checkpointEvent.payload.claimGeneration) === Number(run.claimGeneration);
      if (!eventMatches) {
        reject(request, "invalid-state", `gate ${gate.id} dependency checkpoint ${nodeId} is not linked to this run execution`);
      }
      checkpoints.set(nodeId, { node, record: checkpoint });
      outputs[nodeId] = JsonValueSchema.parse(parsedOutput.data);
    } else if (node.kind === "gate") {
      const result = repositories.gateResults.get(`${run.envelope.runId}:${String(node.id)}`);
      if (result === undefined) {
        reject(request, "invalid-state", `gate ${gate.id} cannot be resolved because dependency gate result ${node.id} is absent`);
      }
      const expectedSchemaHash = deriveSchemaHash(node.result, "output");
      if (result.runId !== run.envelope.runId || result.gateId !== nodeId
        || result.result.schemaHash !== expectedSchemaHash) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency gate result ${node.id} is not bound to this run and descriptor`);
      }
      outputs[nodeId] = JsonValueSchema.parse(node.result.parse(result.result.value));
    } else if (node.kind === "branch") {
      for (const dependency of node.dependsOn) buildOutput(String(dependency));
      for (const dependency of node.dependsOn) {
        const output = outputs[String(dependency)];
        if (output !== undefined) dependencyOutputs[String(dependency)] = output;
      }
      const scope = { input, outputs: dependencyOutputs };
      const selected = node.choose(scope);
      if (typeof selected !== "string" || !Object.prototype.hasOwnProperty.call(node.cases, selected)) {
        reject(request, "invalid-state", `gate ${gate.id} dependency branch ${nodeId} selected an undeclared case`);
      }
      outputs[nodeId] = JsonValueSchema.parse({ selected });
    } else {
      reject(request, "invalid-state", `gate ${gate.id} dependency ${node.kind} node ${nodeId} has no checkpoint-backed decision evidence`);
    }
    visiting.delete(nodeId);
    return outputs[nodeId]!;
  };
  for (const dependency of gate.dependsOn) buildOutput(String(dependency));
  return { input, outputs, checkpoints };
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function verifyGateEvidenceCurrent(
  request: Extract<CommandRequest, { family: "gate" }>,
  descriptor: AnyWorkflowDescriptor,
  gate: Extract<ReturnType<typeof descriptorRuntimeNodes>[number], { kind: "gate" }>,
  scope: ReturnType<typeof gateEvidenceScope>,
  now: string,
  run: RunRecord,
): void {
  const declaration = findGateDecision(descriptor.id, request.target.gateId);
  if (declaration?.boundEvidencePath !== undefined) {
    const submitted = valueAtPath(request.payload.result.value, declaration.boundEvidencePath);
    const policy = declaration.resolution;
    const boundInput = policy.source === "workbook-reference" && "boundInputPath" in policy
      && valueAtPath(scope.input, policy.inputCondition.path) === policy.inputCondition.equals
      ? valueAtPath(scope.input, policy.boundInputPath) : undefined;
    const checkpoint = policy.source === "workbook-reference" && "boundNodeId" in policy
      ? scope.checkpoints.get(policy.boundNodeId)?.record : undefined;
    const boundOutput = checkpoint !== undefined && policy.source === "workbook-reference" && "boundOutputPath" in policy
      ? valueAtPath(checkpoint.output.value, policy.boundOutputPath) : undefined;
    const bound = policy.source === "workbook-reference" && "boundNodeId" in policy ? boundOutput : boundInput;
    const currentEvidence = policy.source === "workbook-reference"
      ? (bound === undefined ? [] : [{ nodeId: gate.id, value: bound }])
      : gate.dependsOn.flatMap((nodeId) => {
      const checkpoint = scope.checkpoints.get(String(nodeId))?.record;
      const value = checkpoint === undefined ? undefined : valueAtPath(checkpoint.output.value, declaration.boundEvidencePath!);
      return value === undefined ? [] : [{ nodeId: String(nodeId), value }];
    });
    const retained = currentEvidence[0]?.value;
    const capturedDigests = new Set((run.input.workbookReferences ?? []).map(bound => sha256Hex(canonicalJsonStringify(bound))));
    const sameRetainedSource = retained === submitted
      || (typeof submitted === "string" && typeof retained === "string" && capturedDigests.has(submitted) && capturedDigests.has(retained));
    if (currentEvidence.length !== 1 || !sameRetainedSource) {
      reject(
        request,
        "invalid-state",
        `gate ${request.target.gateId} evidence changed or is unavailable; refresh the packet before deciding`,
      );
    }
  }

  const instant = Date.parse(now);
  for (const nodeId of gate.dependsOn) {
    const checkpoint = scope.checkpoints.get(String(nodeId));
    if (checkpoint === undefined) continue;
    const { node, record } = checkpoint;
    // The run re-reads always-rerun dependencies after the decision.
    if (node.replay === "always-rerun") continue;
    for (const fact of record.provenance) {
      const bound = resolveFreshnessBound(node.uses.freshness, fact.path).maxAgeMs;
      if (!Number.isFinite(bound)) continue;
      const observedAt = fact.source === "derived" ? fact.originalObservedAt : fact.observedAt;
      if (instant - Date.parse(observedAt) > bound) {
        reject(
          request,
          "invalid-state",
          `gate ${request.target.gateId} evidence from checkpoint ${nodeId} expired at `
          + `${observedAt} under its declared ${String(bound)}ms freshness limit`,
        );
      }
    }
  }
}

type WorkerBrowserCommand = Extract<CommandRequest, { family: "worker-browser" }>;
type WorkerMemberCommand = Exclude<WorkerBrowserCommand, { type: "plan-worker-count" | "spawn-worker" }>;

function checkWorkerPoolVersion(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  workflowId: string,
  expectedVersion: number,
): number {
  const current = workerPoolVersion(repositories.workerPools.get(workflowId));
  if (current !== expectedVersion) {
    conflict(
      request,
      current,
      `worker pool ${workflowId} is at version ${String(current)}`
      + `${current === 0 ? " (no worker count has been planned for it yet)" : ""}, not `
      + `${String(expectedVersion)}; re-read the pool before planning or spawning against it`,
    );
  }
  return current;
}

function requireActiveSlot(repositories: AuthorityRepositories, request: CommandRequest, workerId: string, workflowId?: string): WorkerPoolMember {
  const slot = repositories.workerSlots.get(workerId);
  if (slot === undefined) reject(request, "target-not-found", `worker ${workerId} has no slot`);
  if (slot.retiredAt !== null || workflowId !== undefined && slot.workflow !== workflowId) reject(request, "invalid-state", "worker-slot-not-admitted: select a current member");
  return workerPoolMember(slot);
}

/** The member fence is in memory: a card from another lifetime or an older version of this one is stale. */
function requireMemberFence(pool: WorkerPoolRuntimeSeam, request: WorkerMemberCommand): WorkerMemberState {
  const { workerId, lifetimeId, expectedVersion } = request.target;
  try { return pool.assertMember({ workerId, lifetimeId, expectedVersion }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "WORKER_TARGET_STALE") conflict(request, 0, "WORKER_TARGET_STALE");
    throw error;
  }
}

function claimedRunsOf(repositories: AuthorityRepositories, workerId: string): readonly RunRecord[] {
  return repositories.runs.listByWorker(workerId).filter(run => ["claimed", "validating", "running"].includes(run.lifecycle.state));
}

/** Worker Pause holds its claimed run under a claim-derived pause id, so resume-worker resumes only those runs. */
function workerPauseCommandId(workerId: string, run: RunRecord): string {
  return lifecycleCommandId("worker-pause", { workerId, runId: run.envelope.runId, claimGeneration: run.claimGeneration });
}

/** A worker also runs delegated children of other workflows, so its held runs are found by pause id across its descendant home. */
function workerPauseHeldRuns(repositories: AuthorityRepositories, workerId: string, state: "requested" | "paused"): readonly RunRecord[] {
  const workflow = repositories.workerSlots.get(workerId)?.workflow;
  return workflow === undefined ? [] : repositories.runs.listByPauseState(state)
    .filter(run => run.pause?.commandId === workerPauseCommandId(workerId, run) && authenticateDescendantHome(repositories, run, workflow));
}

function auditWorkerCommand(dependencies: CommandKernelDependencies, repositories: AuthorityRepositories, request: WorkerBrowserCommand,
  application: CommandApplication, parkedWriteCheck?: ParkedWriteCheckAcknowledgement): CommandResult {
  repositories.commands.insert(request);
  repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request, result: application.result,
    completedAt: dependencies.clock.now().toISOString(), versionChanges: application.versionChanges, affectedDependencyIds: application.affectedDependencyIds,
    ...(parkedWriteCheck === undefined ? {} : { parkedWriteCheck }) });
  return application.result;
}

/** A pool refusal after admission is the command's recorded outcome; any other failure stays a structured throw. */
function workerEffectRefusal(request: WorkerBrowserCommand, error: unknown): CommandApplication | undefined {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("WORKER_") ? error.code
    : error instanceof WorkerControlRefusal ? error.message : undefined;
  if (code === undefined) return undefined;
  return { result: CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message: code }), versionChanges: [], affectedDependencyIds: [] };
}

/**
 * Admission and fences run in one authority transaction, the pool effect runs after it, and the outcome is journaled
 * with its audit in a final transaction. Pause, resume and Reset commit their durable change first and then tell the child.
 */
async function executeWorkerPoolCommand(
  dependencies: CommandKernelDependencies,
  pool: WorkerPoolRuntimeSeam,
  request: WorkerBrowserCommand,
): Promise<CommandResult> {
  const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
  const transact = <T>(work: (repositories: AuthorityRepositories) => T): T => dependencies.authority.withAuthorityTransaction(work);
  const prior = transact(repositories => {
    repositories.commands.assertIdentity(request);
    return repositories.commandAudits.findByCommand(request.commandId) === undefined ? undefined : replay(dependencies, repositories, request, now);
  });
  if (prior !== undefined) return prior;
  // A stale or missing durable target is refused before admission reaches the process seam (preflight, assistant grant).
  transact(repositories => {
    if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "retry-worker"
      || request.type === "stop-worker" || request.type === "resume-worker") repositories.runtimeConfig.requireSettingsCurrent();
    if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "retry-worker") {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
    }
    if (request.type === "plan-worker-count" || request.type === "spawn-worker") {
      checkWorkerPoolVersion(repositories, request, request.target.workflowId, request.target.expectedVersion);
      if (request.type === "spawn-worker") requireActiveSlot(repositories, request, request.payload.workerId, request.target.workflowId);
    } else requireActiveSlot(repositories, request, request.target.workerId, "workflowId" in request.target ? request.target.workflowId : undefined);
  });
  // A plan preflights its member starts after it applies.
  const preflight = request.type === "spawn-worker" || request.type === "retry-worker" || request.type === "stop-worker";
  try { await pool.admit(request.commandId, { preflight }); }
  catch (error) {
    const refusal = workerEffectRefusal(request, error);
    if (refusal === undefined) throw error;
    return transact(repositories => auditWorkerCommand(dependencies, repositories, request, refusal));
  }
  const settle = async (effect: () => Promise<void>, application: (repositories: AuthorityRepositories) => CommandApplication): Promise<CommandResult> => {
    try { await effect(); }
    catch (error) {
      const refusal = workerEffectRefusal(request, error);
      if (refusal === undefined) throw error;
      return transact(repositories => auditWorkerCommand(dependencies, repositories, request, refusal));
    }
    return transact(repositories => auditWorkerCommand(dependencies, repositories, request, application(repositories)));
  };

  switch (request.type) {
    case "plan-worker-count": {
      const desired = request.payload.desiredWorkers;
      const excess = transact(repositories => {
        repositories.runtimeConfig.requireSettingsCurrent();
        resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
        checkWorkerPoolVersion(repositories, request, request.target.workflowId, request.target.expectedVersion);
        return repositories.workerSlots.active(request.target.workflowId).filter(slot => slot.poolIndex > desired).map(workerPoolMember);
      });
      let members: readonly WorkerPoolMember[] = [];
      const result = await settle(async () => { for (const member of excess) await pool.remove(member); }, repositories => {
        repositories.runtimeConfig.requireSettingsCurrent();
        try {
          const plan = applyWorkerPoolPlan(repositories, request, now, request.target.expectedVersion);
          members = plan.members.map(workerPoolMember);
          return plan.application;
        } catch (error) {
          if (error instanceof WorkerPoolPlanVersionConflict) conflict(request, error.currentVersion,
            "The excess workers ALREADY stopped before the pool changed; re-read the pool before planning again");
          throw error;
        }
      });
      // The plan applies even when preflight refuses its starts; a member that does not start keeps Retry on its card.
      const startable = await pool.admit(request.commandId, { preflight: true }).then(() => true, (error: unknown) => {
        if (workerEffectRefusal(request, error) === undefined) throw error;
        return false;
      });
      if (startable) await Promise.allSettled(members.map(member => pool.ensure(member)));
      return result;
    }
    case "spawn-worker": {
      const member = transact(repositories => {
        repositories.runtimeConfig.requireSettingsCurrent();
        resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
        checkWorkerPoolVersion(repositories, request, request.target.workflowId, request.target.expectedVersion);
        return requireActiveSlot(repositories, request, request.payload.workerId, request.target.workflowId);
      });
      return await settle(() => pool.start(member), () => applied(request, [workerTarget(member.workerId)], []));
    }
    case "retry-worker": {
      const member = transact(repositories => {
        repositories.runtimeConfig.requireSettingsCurrent();
        resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
        return requireActiveSlot(repositories, request, request.target.workerId, request.target.workflowId);
      });
      const state = requireMemberFence(pool, request);
      if (state !== "absent" && state !== "exited") reject(request, "invalid-state", "WORKER_ALREADY_RUNNING");
      return await settle(() => pool.start(member), () => applied(request, [workerTarget(member.workerId)], []));
    }
    case "remove-worker": {
      const member = transact(repositories => requireActiveSlot(repositories, request, request.target.workerId, request.target.workflowId));
      requireMemberFence(pool, request);
      return await settle(() => pool.remove(member), repositories => {
        const current = repositories.workerPools.get(member.workflowId);
        if (current === undefined) throw new Error("worker-pool-missing-for-active-slot");
        const planned = repositories.workerPools.plan({ workflow: member.workflowId, expectedVersion: current.version,
          desiredWorkers: Math.max(0, current.desiredWorkers - 1), requestedBy: request.requestedBy, now });
        if (planned.state !== "applied") throw new Error("worker-pool-plan-conflict-in-transaction");
        repositories.workerSlots.retire({ workerId: member.workerId, now });
        const target = { family: "worker-pool" as const, workflowId: member.workflowId };
        return applied(request, [target, workerTarget(member.workerId)], [{ target, before: current.version, after: planned.pool.version }]);
      });
    }
    case "stop-worker": {
      // Reset: the ordinary run Cancel (version fenced, refused over a parked write, delegation cascade), then a fresh process.
      // The claimed run's fenced write finishes and settles once before the run ends.
      // The Cancel is its own journaled run command, derived from the Reset's id, so cancellation authenticates it.
      const journaledResetCancel = (repositories: AuthorityRepositories, run: RunRecord, held: boolean): CommandApplication => {
        const cancel = RunCommandRequestSchema.parse({ commandId: held
          ? lifecycleCommandId("worker-stop-held-cancel", { commandId: request.commandId, runId: run.envelope.runId })
          : lifecycleCommandId("worker-reset-cancel", request.commandId),
          requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
          family: "run", type: "cancel", target: { runId: run.envelope.runId, expectedVersion: run.version } }) as RunBasicCommand;
        repositories.commands.insert(cancel);
        try {
          const application = withCanonicalRunCommandScope(repositories, cancel, () => executeCancel(dependencies, repositories, cancel, now, !held));
          repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request: cancel, result: application.result, completedAt: now,
            versionChanges: application.versionChanges, affectedDependencyIds: application.affectedDependencyIds });
          return application;
        } catch (error) {
          if (error instanceof CommandRefusal) throw new CommandRefusal({ ...error.result, commandId: request.commandId });
          throw error;
        }
      };
      const { member, result } = transact(repositories => {
        repositories.runtimeConfig.requireSettingsCurrent();
        const member = requireActiveSlot(repositories, request, request.target.workerId, request.target.workflowId);
        requireMemberFence(pool, request);
        const runs = claimedRunsOf(repositories, member.workerId);
        if (runs.length > 1) throw new Error("worker-holds-more-than-one-claimed-run");
        const run = runs[0];
        // Stop also ends the runs this worker's pause holds; their Cancel cascades to cascade-cancel children.
        const cancels = [...(run === undefined ? [] : [journaledResetCancel(repositories, run, false)]),
          ...workerPauseHeldRuns(repositories, member.workerId, "paused").map(held => journaledResetCancel(repositories, held, true))];
        const reset = applied(request, [workerTarget(member.workerId), ...cancels.flatMap(cancel => cancel.result.state === "applied" ? cancel.result.affectedTargets : [])],
          cancels.flatMap(cancel => cancel.versionChanges), cancels.flatMap(cancel => cancel.affectedDependencyIds));
        return { member, result: auditWorkerCommand(dependencies, repositories, request, reset) };
      });
      try { await pool.stop(member.workerId, "reset"); await pool.start(member); }
      catch (error) { if (workerEffectRefusal(request, error) === undefined) throw error; }
      return result;
    }
    case "pause-worker":
    case "resume-worker": {
      const paused = request.type === "pause-worker";
      const result = transact(repositories => {
        if (!paused) repositories.runtimeConfig.requireSettingsCurrent();
        const member = requireActiveSlot(repositories, request, request.target.workerId, request.target.workflowId);
        requireMemberFence(pool, request);
        if (!paused && workerPauseHeldRuns(repositories, member.workerId, "requested").length !== 0) reject(request, "WORKER_PAUSE_SETTLING", ERROR_CATALOG.WORKER_PAUSE_SETTLING.text);
        const slot = repositories.workerSlots.setPaused({ workerId: member.workerId, paused, now });
        // Worker Pause holds its claimed run (the step restarts on Resume); Resume releases only the runs that pause held. A pending cancel wins.
        const held = paused
          ? claimedRunsOf(repositories, member.workerId).filter(run => run.pause === undefined && run.cancelRequested !== true)
          : workerPauseHeldRuns(repositories, member.workerId, "paused");
        const versionChanges: VersionChange[] = held.map(run => {
          const runId = run.envelope.runId;
          const outcome = paused
            ? dependencies.lifecycle.pause({ commandId: workerPauseCommandId(member.workerId, run), runId, expectedVersion: run.version })
            : dependencies.lifecycle.resumePaused({ commandId: lifecycleCommandId("worker-resume", { commandId: request.commandId, runId }), runId, expectedVersion: run.version });
          return { target: runTarget(runId), before: run.version, after: lifecycleRun(request, outcome).version };
        });
        return auditWorkerCommand(dependencies, repositories, request,
          applied(request, [workerTarget(slot.workerId), ...versionChanges.map(change => change.target)], versionChanges));
      });
      // The slot is the authority; the message only ends the child's idle wait now.
      await pool.direct(request.target.workerId, paused ? "pause" : "run");
      return result;
    }
    case "refresh-browser":
    case "reopen-browser": {
      transact(repositories => {
        requireActiveSlot(repositories, request, request.target.workerId);
        if (claimedRunsOf(repositories, request.target.workerId).length !== 0) reject(request, "invalid-state", "WORKER_BUSY");
      });
      requireMemberFence(pool, request);
      return await settle(() => pool.browser(request.target, request.type), () => applied(request, [workerTarget(request.target.workerId)], []));
    }
    case "check-parked-write": {
      const target = request.target;
      transact(repositories => {
        if (request.requestedBy !== "local-operator" || request.source !== "run-detail"
          || dependencies.authorityProfileId !== target.profileId || dependencies.authorityInstallationId !== target.installationId
          || dependencies.workflowSources?.[target.workflowId] !== "served") reject(request, "capability-unavailable", "PARKED_CHECK_UNAVAILABLE");
        requireActiveSlot(repositories, request, target.workerId, target.workflowId);
        if (claimedRunsOf(repositories, target.workerId).length !== 0) reject(request, "invalid-state", "parked-check-worker-unavailable");
        try { requireParkedWriteCheckTarget(repositories, target, dependencies.descriptors.resolve(target.workflowId)); }
        catch (error) { if (error instanceof WorkerControlRefusal) reject(request, "invalid-state", error.message); throw error; }
      });
      if (requireMemberFence(pool, request) !== "running") reject(request, "invalid-state", "parked-check-worker-unavailable");
      let acknowledgement: ParkedWriteCheckAcknowledgement | undefined;
      try { acknowledgement = ParkedWriteCheckAcknowledgementSchema.parse(await pool.checkParkedWrite(target, request)); }
      catch (error) {
        const refusal = workerEffectRefusal(request, error);
        if (refusal === undefined) throw error;
        return transact(repositories => auditWorkerCommand(dependencies, repositories, request, refusal));
      }
      const checked = acknowledgement;
      if (checked.result.commandId !== request.commandId || checked.result.requestedBy !== request.requestedBy
        || canonicalJsonStringify(checked.result.target) !== canonicalJsonStringify(target)) throw new Error("parked-check-result-identity-mismatch");
      return transact(repositories => auditWorkerCommand(dependencies, repositories, request,
        applied(request, [workerTarget(target.workerId), runTarget(target.runId)], []), checked));
    }
  }
}

function workerPoolSerializationKey(request: WorkerBrowserCommand): string {
  return "workflowId" in request.target ? `worker-pool:${request.target.workflowId}` : `worker:${request.target.workerId}`;
}


function executeSettings(
  dependencies: Pick<CommandKernelDependencies, "settings">,
  repositories: AuthorityRepositories,
  request: SettingsCommand,
  ordinarySnapshot?: SettingsFileRecord,
): CommandApplication {
  if (dependencies.settings === undefined) {
    throw new Error(
      `settings/${request.type} reached a composition with no settings application executor`,
    );
  }
  const requireExpectedRevision = (revision: number): void => {
    if (revision !== request.target.expectedRevision + 1) {
      throw new Error("settings executor did not advance exactly one revision");
    }
  };
  if (request.type === "apply-settings") {
    if (ordinarySnapshot === undefined) throw new Error("settings-ordinary-snapshot-unavailable");
    const outcome = OrdinarySettingsApplicationOutcomeSchema.parse(
      dependencies.settings.applyOrdinary(request, repositories, ordinarySnapshot),
    );
    if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
    if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
    requireExpectedRevision(outcome.revision);
    const target = { family: "settings" as const, revision: outcome.revision };
    const application = applied(
      request,
      [target],
      [{ target, before: request.target.expectedRevision, after: outcome.revision }],
      [],
      undefined,
      undefined,
      { kind: "ordinary", revision: outcome.revision, settingsFingerprint: outcome.settingsFingerprint, restartRequired: outcome.restartRequired ?? true },
    );
    return Object.freeze({
      ...application,
      settingsCurrent: Object.freeze({
        revision: outcome.revision,
        settingsFingerprint: outcome.settingsFingerprint,
        settings: outcome.settings,
        commandFingerprint: deriveSettingsCommandFingerprint(request),
      }),
    });
  }
  const outcome = ProtectedSettingsApplicationOutcomeSchema.parse(
    { state: "applied", readback: dependencies.settings.reconcileReplay(request) },
  );
  if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
  if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
  requireExpectedRevision(outcome.readback.revision);
  const target = { family: "protected-settings" as const, revision: outcome.readback.revision };
  const application = applied(
    request,
    [target],
    [{ target, before: request.target.expectedRevision, after: outcome.readback.revision }],
    [],
    undefined,
    undefined,
    { kind: "protected", readback: outcome.readback },
  );
  return application;
}

/* ── dispatch, journal, and replay ───────────────────────────────────────── */

function dispatchActive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
  auditId: string,
): CommandApplication {
  switch (request.family) {
    case "assistant-model-preference": {
      if (request.requestedBy !== "local-operator" || request.source.startsWith("assistant")
        || repositories.assistantAuthorization.actionByCommand(request.commandId) !== undefined
        || dependencies.authorityProfileId !== request.target.profileId) reject(request, "invalid-state", "assistant-preference-operator-only");
      const prior = repositories.assistantModelPreference.get();
      const revision = prior?.revision ?? 0;
      if (revision !== request.target.expectedRevision) conflict(request, revision, "assistant-preference-cas-conflict");
      const nextRevision = revision + 1;
      const target = { family: "assistant-model-preference" as const, profileId: request.target.profileId, revision: nextRevision };
      return { ...applied(request, [target], [{ target, before: revision, after: nextRevision }]), afterAudit: () => {
        repositories.assistantModelPreference.setByCommand({ format: 1, id: "current", profileId: request.target.profileId,
          revision: nextRevision, preference: request.payload, commandId: request.commandId, auditId, updatedAt: now });
      } };
    }
    case "failure-resolution": return (dependencies.failureResolution?.execute ?? executeFailureResolution)(repositories, request, now);
    case "workflow-batch": {
      const batch = repositories.runSessions.get(request.target.batchId);
      if (batch === undefined) reject(request, "target-not-found", "Workflow batch no longer exists.");
      if (batch.version !== request.target.expectedVersion) conflict(request, batch.version, "Batch presentation changed; reload and try again.");
      const updated = repositories.runSessions.setGrouping(batch.sessionId, batch.version, request.payload.groupInQueue);
      const target = { family: "workflow-batch", batchId: batch.sessionId };
      return applied(request, [target], [{ target, before: batch.version, after: updated.version }]);
    }
    case "application": {
      if (request.type === "pause-all-and-quit" && dependencies.applicationQuitAvailable !== true) reject(request, "capability-unavailable", "Application quit host is unavailable.");
      if (request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", "Application commands require the dashboard operator.");
      if (repositories.runtimeConfig.get()?.generation !== request.target.runtimeGeneration) reject(request, "runtime-stale", "Application runtime changed.");
      const active: RunRecord[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const page = repositories.runs.listPage({ offset, limit: pageSize });
        active.push(...page.filter(run => run.lifecycle.state !== "terminal"));
        if (page.length < pageSize) break;
      }
      if (new Set(request.payload.targets.map(target => target.runId)).size !== request.payload.targets.length
        || active.length !== request.payload.targets.length
        || active.some(run => !request.payload.targets.some(target => target.runId === run.envelope.runId && target.expectedVersion === run.version))) {
        reject(request, "policy-refused", "Active run membership changed; reload before pausing all.");
      }
      const changes: VersionChange[] = [];
      for (const run of active) {
        if (run.lifecycle.state === "parked-write") continue;
        const next = lifecycleRun(request, dependencies.lifecycle.pause({
          commandId: lifecycleCommandId("application-pause", { commandId: request.commandId, runId: run.envelope.runId }),
          runId: run.envelope.runId, expectedVersion: run.version,
        }));
        changes.push({ target: runTarget(run.envelope.runId), before: run.version, after: next.version });
      }
      return applied(request, [{ family: "application", runtimeGeneration: request.target.runtimeGeneration }], changes);
    }
    case "start":
      if (repositories.runs.admission().state !== "open") reject(request, "policy-refused", "Relay is pausing work to quit.");
      repositories.runtimeConfig.requireSettingsCurrent();
      return executeStartRun(dependencies, repositories, request, now);
    case "worker-browser":
      if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return reject(request, "capability-unavailable", "Worker commands require the current asynchronous process owner.");
    case "ocr-review": {
      if (request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      const current = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
      if (current === undefined) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      if (readOcrSnapshotsAuthority(repositories, current).length > 0) throw new OcrReviewRefusedError();
      if (current.revision.revision !== request.target.expectedRevision) conflict(request, current.revision.revision, ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
      const revision = repositories.ocrReviews.append(reviseOcrReview(current.revision, request, now), current.revision.revision);
      const updated = lifecycleRun(request, dependencies.lifecycle.transition({
        commandId: lifecycleCommandId("operator-ocr-review", request.commandId), runId: request.target.runId,
        expectedVersion: current.run.version, ocrReviewRevision: revision.revision, sourceCommandId: request.commandId,
      }));
      const target: TargetReference = { family: "ocr-review", runId: request.target.runId };
      return applied(request, [target, runTarget(request.target.runId)], [{ target, before: current.revision.revision, after: revision.revision },
        { target: runTarget(request.target.runId), before: current.run.version, after: updated.version }]);
    }
    case "gate":
      return executeResolveGate(dependencies, repositories, request, now, "operator");
    case "run": {
      switch (request.type) {
        case "pause":
        case "resume": {
          const current = requireRun(repositories, request, request.target.runId);
          const resumeEvidence = request.type === "resume" ? captureDelegationResume(repositories, current.envelope.runId) : [];
          if (resumeEvidence === undefined) reject(request, "policy-refused", "Child retries must settle before resuming their parent.");
          const next = lifecycleRun(request, dependencies.lifecycle[request.type === "pause" ? "pause" : "resumePaused"]({
            commandId: request.type === "resume" ? delegationResumeCommandId(request.commandId, resumeEvidence)
              : lifecycleCommandId("operator-pause", request.commandId),
            ...request.target,
          }));
          return applied(request, [runTarget(next.envelope.runId)], [{ target: runTarget(next.envelope.runId), before: current.version, after: next.version }]);
        }
        case "recover-run":
          repositories.runtimeConfig.requireSettingsCurrent();
          return executeRecover(dependencies, repositories, request);
        case "retry":
          repositories.runtimeConfig.requireSettingsCurrent();
          return executeRetry(dependencies, repositories, request, now);
        case "cancel": return executeCancel(dependencies, repositories, request, now);
        case "delete": return executeDelete(dependencies, repositories, request, now);
        case "bump": return executeBump(dependencies, repositories, request, now);
        case "rename": return executePresentation(dependencies, repositories, request, now);
        case "resolve-workbook-reference-row": {
          if (dependencies.workbookRows?.resolveReference === undefined) return reject(request, "capability-unavailable", "Workbook reference row choices are unavailable.");
          const result = dependencies.workbookRows.resolveReference(repositories, request, now);
          if ("state" in result) return applied(request, [{ family: "gate", runId: request.target.runId, gateId: request.target.gateId }, runTarget(request.target.runId)], []);
          return executeResolveGate(dependencies, repositories, {
            ...request, family: "gate", type: "resolve-gate",
            target: { runId: request.target.runId, expectedVersion: request.target.expectedVersion, gateId: request.target.gateId },
            payload: { result },
          }, now, "workbook-reference");
        }
        case "resolve-workbook-row": {
          requireRun(repositories, request, request.target.runId);
          if (dependencies.workbookRows === undefined) return reject(request, "capability-unavailable", "Workbook row choices are unavailable.");
          dependencies.workbookRows.resolve(repositories, request);
          return applied(request, [runTarget(request.target.runId)], []);
        }
        case "recheck-write":
        case "resolve-write-absent":
          return executeWriteResolution(dependencies, repositories, request, now, auditId);
      }
      break;
    }
    case "notification":
      return executeNotification(repositories, request, now);
    case "intake":
      if (request.type === "enqueue-intake-manifest") {
        if (repositories.runs.admission().state !== "open") reject(request, "policy-refused", "Relay is pausing work to quit.");
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeIntake(dependencies, repositories, request, now);
    case "settings":
      return executeSettings(dependencies, repositories, request);
  }
  throw new Error("command dispatch fell through an exhaustive family/action switch");
}

function replay(
  dependencies: Pick<CommandKernelDependencies, "settings"> & Partial<Pick<CommandKernelDependencies, "lifecycle">>,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
): CommandResult {
  const audit = repositories.commandAudits.findByCommand(request.commandId);
  if (audit === undefined) {
    throw new Error(
      `command ${request.commandId} is journaled but has no recorded outcome; refusing to guess what it did`,
    );
  }
  if (audit.result.state === "rejected" || audit.result.state === "conflict" || audit.result.state === "confirmation-required") return audit.result;
  if (request.family === "ocr-review" || request.family === "gate" && request.payload.ocrApproval !== undefined) {
    if (dependencies.lifecycle === undefined) throw new OcrReviewRefusedError();
    const review = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
    if (review === undefined) throw new OcrReviewRefusedError();
    if (request.family === "ocr-review") {
      const revision = repositories.ocrReviews.revision(request.target.runId, request.target.expectedRevision + 1);
      if (revision?.origin.kind !== "command" || revision.origin.commandId !== request.commandId) throw new OcrReviewRefusedError();
    } else if (!readOcrSnapshotsAuthority(repositories, review).some(snapshot => snapshot.snapshotId === request.commandId)) throw new OcrReviewRefusedError();
  }
  if (audit.result.state !== "applied") {
    throw new Error(
      `command ${request.commandId} recorded outcome ${audit.result.state}; only applied or refused commands are journaled`,
    );
  }
  if (request.family === "start") {

    const revalidation = repositories.startPlans.consume({
      startPlanId: request.target.startPlanId,
      expectedVersion: request.target.expectedVersion,
      commandId: request.commandId,
      descriptorFingerprint: request.payload.descriptorFingerprint,
      configFingerprint: request.payload.configFingerprint,
      ingressSchemaHash: request.payload.ingressSchemaHash,
      canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
      inputFingerprint: request.payload.inputFingerprint,
      now,
    });
    if (revalidation.state !== "already-consumed") {
      throw new Error(
        `replay of start command ${request.commandId} could not revalidate plan `
        + `${request.target.startPlanId} (${revalidation.state}); the durable record is inconsistent`,
      );
    }
  }
  let settingsVerification:
    | Readonly<{ kind: "ordinary"; value: z.infer<typeof OrdinarySettingsReplayVerificationSchema> }>
    | Readonly<{ kind: "protected"; value: z.infer<typeof ProtectedSettingsReplayVerificationSchema> }>
    | undefined;
  if (request.family === "settings") {
    if (dependencies.settings === undefined) {
      throw new Error(
        `settings/${request.type} replay reached a composition with no settings application executor`,
      );
    }
    if (request.type === "apply-settings"
      && deriveSettingsCommandFingerprint(audit.request) !== deriveSettingsCommandFingerprint(request)) {
      throw new Error(`settings replay ${request.commandId} does not match its immutable result`);
    }
    const verified = request.type === "apply-settings"
      ? OrdinarySettingsReplayVerificationSchema.parse(
          { revision: audit.result.settingsRevision, settingsFingerprint: audit.result.settingsFingerprint },
        )
      : ProtectedSettingsReplayVerificationSchema.parse(
          dependencies.settings.reconcileReplay(request),
        );
    const expectedRevision = request.target.expectedRevision + 1;
    const verifiedRevision = "revision" in verified ? verified.revision : undefined;
    if (("state" in verified && verified.state !== "applied") || verifiedRevision !== expectedRevision) {
      throw new Error(
        `settings replay ${request.commandId} verified revision ${String(verifiedRevision)}; `
        + `exactly ${String(expectedRevision)} was required`,
      );
    }
    settingsVerification = request.type === "apply-settings"
      ? { kind: "ordinary", value: verified as z.infer<typeof OrdinarySettingsReplayVerificationSchema> }
      : { kind: "protected", value: verified as z.infer<typeof ProtectedSettingsReplayVerificationSchema> };
  }
  return CommandResultSchema.parse({
    state: "already-applied",
    commandId: request.commandId,
    affectedTargets: audit.result.affectedTargets,
    ...(audit.result.noChange === undefined ? {} : { noChange: audit.result.noChange }),
    ...(settingsVerification?.kind === "ordinary" ? {
      restartRequired: audit.result.restartRequired,
      settingsRevision: settingsVerification.value.revision,
      settingsFingerprint: settingsVerification.value.settingsFingerprint,
    } : settingsVerification?.kind === "protected" ? {
      restartRequired: false,
      revision: settingsVerification.value.revision,
      entries: settingsVerification.value.entries,
    } : {}),
  });
}

/** The same settings command path is used by the BFF and stopped migration. */
export function executeSettingsCommand(
  dependencies: Pick<CommandKernelDependencies, "authority" | "clock" | "ids" | "settings" | "authorityProfileId">,
  input: unknown,
): CommandResult {
  const request = CommandRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
  if (request.family !== "settings") throw new Error("settings command required");
  const executor = dependencies.settings;
  if (executor === undefined) throw new Error("settings executor unavailable");
  // Request-only validation precedes every database/private-store read.
  if (request.type === "apply-protected-settings" && request.payload.protectedSchemaHash !== PROTECTED_SETTINGS_SCHEMA_HASH) {
    return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
      code: "schema-mismatch", message: "credential schema does not match the current catalog" });
  }
  const refusal = executor.validateRequest(request);
  if (refusal !== undefined) return CommandResultSchema.parse(refusal.state === "conflict"
    ? { state: "conflict", commandId: request.commandId, currentVersion: refusal.currentRevision, message: refusal.message }
    : { ...refusal, commandId: request.commandId });
  let credentialsCommitted = false;
  try {
    const result = dependencies.authority.withAuthorityTransaction((repositories) => {
      const now = dependencies.clock.now().toISOString();
      const journalRequest = markSettingsCommand(request);
      repositories.commands.assertIdentity(journalRequest);
      // Validate ordinary authority before this command becomes retained history.
      // Replays use their existing journal and do not need a new read snapshot.
      const ordinarySnapshot = request.type === "apply-settings" && repositories.commands.get(request.commandId) === undefined
        ? readSettings(repositories) : undefined;
      if (request.type === "apply-settings" && request.payload.assistantPermission !== undefined
        && repositories.commands.get(request.commandId) === undefined) {
        const actualRevision = repositories.assistantAuthorization.grant()?.policy.revision ?? 0;
        if (actualRevision !== request.payload.assistantPermission.expectedPolicyRevision) conflict(request, actualRevision, "assistant policy revision conflict");
      }
      if (request.type === "apply-protected-settings") {
        // BEGIN IMMEDIATE holds identity admission, private commit and audit; SQL rollback cannot undo the private commit.
        const protectedRefusal = executor.commitPrivate(request);
        if (protectedRefusal !== undefined) {
          throw new CommandRefusal(CommandResultSchema.parse(protectedRefusal.state === "conflict"
            ? { state: "conflict", commandId: request.commandId, currentVersion: protectedRefusal.currentRevision, message: protectedRefusal.message }
            : { ...protectedRefusal, commandId: request.commandId }));
        }
        credentialsCommitted = true;
      }
      const journal = repositories.commands.insert(journalRequest);
      if (journal.state === "existing") return replay(dependencies, repositories, request, now);
      const application = executeSettings(dependencies, repositories, request, ordinarySnapshot);
      const auditId = dependencies.ids.uuid();
      repositories.commandAudits.insert({ auditId, request: journalRequest, result: application.result,
        completedAt: now, versionChanges: application.versionChanges, affectedDependencyIds: application.affectedDependencyIds });
      if (application.settingsCurrent !== undefined) repositories.settingsCurrent.advance({
        ...application.settingsCurrent, commandId: request.commandId, auditId, committedAt: now,
      });
      if (request.type === "apply-settings" && application.result.state === "applied") {
        const change = request.payload.assistantPermission;
        if (change !== undefined) {
          const profileId = dependencies.authorityProfileId;
          if (profileId === undefined) throw new Error("assistant-grant-profile-owner-required");
          const revision = change.expectedPolicyRevision + 1;
          repositories.assistantAuthorization.grantBySettings({ id: "current", profileId, commandId: request.commandId, updatedAt: now,
            policy: { revision, mode: change.mode, grant: { grantId: dependencies.ids.uuid(), profileId, policyRevision: revision, mode: change.mode, grantedAt: now } } });
        }
      }
      return application.result;
    });
    return result;
  } catch (error) {
    if (credentialsCommitted) {
      throw new Error("credential-audit-uncertain: credentials committed; retry the exact command to verify its audit", { cause: error });
    }
    if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
    });
    if (error instanceof CommandRefusal) return error.result;
    throw error;
  }
}

/** An exact journaled command with no audit: admitted, and its effect resumes on an exact retry. */
export function isAdmittedUnsettled(repositories: AuthorityRepositories, request: CommandRequest): boolean {
  const journaled = repositories.commands.get(request.commandId);
  return journaled !== undefined && canonicalJsonStringify(journaled) === canonicalJsonStringify(request)
    && repositories.commandAudits.findByCommand(request.commandId) === undefined;
}

export function createCommandKernel(dependencies: CommandKernelDependencies): CommandKernel {
  const availability = () => commandAssistantAvailability((family, action) => {
    if (family === "assistant-model-preference" || family === "application" || family === "run" && action === "recover-run") return false;
    if (family === "settings") return dependencies.settings !== undefined;
    if (family === "failure-resolution") return dependencies.failureResolution?.capability().state === "available";
    if (family === "start" || family === "intake") return dependencies.workflowSources !== undefined
      && Object.entries(dependencies.workflowSources).some(([id, source]) => source === "served" && dependencies.descriptors.resolve(id) !== undefined
        && (family !== "intake" || dependencies.intakeProjections.resolve(id) !== undefined));
    return true;
  });

  // Validated ONCE at composition: a dependency satisfying both seams is a
  // wiring ambiguity, refused before any command can reach it.
  const pool = dependencies.workerRuntime.pool;
  // Serialize admission, asynchronous effects and settlement for each command target.
  const commandTails = new Map<string, Promise<void>>();
  const withCommandSerialization = async (
    key: string,
    work: () => Promise<CommandResult>,
  ): Promise<CommandResult> => {
    const previous = commandTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    commandTails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      return await work();
    } finally {
      if (commandTails.get(key) === current) commandTails.delete(key);
      release();
    }
  };
  const admitCommand = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult | undefined => {
    return dependencies.authority.withAuthorityTransaction((repositories) => {
      preferenceCurrent?.();
      if (request.family === "assistant-model-preference" && (request.requestedBy !== "local-operator"
        || request.source.startsWith("assistant") || dependencies.authorityProfileId !== request.target.profileId
        || repositories.assistantAuthorization.actionByCommand(request.commandId) !== undefined)) {
        reject(request, "invalid-state", "assistant-preference-operator-only");
      }
      repositories.commands.assertIdentity(request, parentCommandId);
      repositories.commands.insert(request, parentCommandId);
      if (repositories.commandAudits.findByCommand(request.commandId) === undefined) return undefined;
      if (request.family === "assistant-model-preference") repositories.assistantModelPreference.get();
      return replay(dependencies, repositories, request, IsoInstantSchema.parse(dependencies.clock.now().toISOString()));
    });
  };
  const failCommand = (error: unknown, request: CommandRequest, admitted: boolean, parentCommandId?: string): CommandResult => {
    if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
    });
    const refusal = error instanceof PreflightAdmissionRefusal ? CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: request.family !== "start" ? "capability-unavailable"
      : preflightRunnerTimeout(error) !== undefined ? "PREFLIGHT_TIMEOUT"
      : error instanceof PreflightEvidenceExpiredError ? "PREFLIGHT_EVIDENCE_EXPIRED"
      : error.reason === "observation-changed" || error.reason === "stale" ? "RUN_START_READINESS_CHANGED"
      : error.reason === "blocked" ? "RUN_START_READINESS_BLOCKED" : "RUN_START_READINESS_UNAVAILABLE", message: error.message })
      : error instanceof CommandRefusal ? error.result
      : error instanceof OcrReviewRefusedError ? CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
        code: error.code, message: ERROR_CATALOG.OCR_REVIEW_REFUSED.text })
      : undefined;
    // A failure during admission or replay leaves no row of this call to settle.
    if (!admitted) {
      if (refusal !== undefined) return refusal;
      throw error;
    }
    try {
      settleUnsettled(request, refusal ?? (parentCommandId === undefined ? undefined
        : CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "bulk-child-errored", message: ERROR_CATALOG.BULK_CHILD_ERRORED.text })),
      parentCommandId);
    } catch (settlementError) {
      throw new AggregateError([error, settlementError], `command ${request.commandId} failed and its outcome could not be recorded`, { cause: settlementError });
    }
    if (refusal !== undefined) return refusal;
    throw error;
  };
  const applyCommand = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult => {
    let rollback: (() => void) | undefined;
    let commit: (() => void) | undefined;
    try {
      const result = dependencies.authority.withAuthorityTransaction((repositories) => {
        preferenceCurrent?.();
        const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
        const journalRequest = request;
        const auditId = dependencies.ids.uuid();
        const application = request.family === "ocr-review" || request.family === "start" || request.family === "run" && (request.type === "retry" || request.type === "recover-run" || request.type === "cancel" || request.type === "resume")
          ? withCanonicalRunCommandScope(repositories, request,
            () => dispatchActive(dependencies, repositories, request, now, auditId), parentCommandId)
          : dispatchActive(dependencies, repositories, request, now, auditId);
        rollback = application.rollback;
        commit = application.commit;
        repositories.commandAudits.insert({
          auditId,
          request: journalRequest,
          result: application.result,
          completedAt: now,
          versionChanges: application.versionChanges,
          affectedDependencyIds: application.affectedDependencyIds,
          ...(application.writeResolution === undefined ? {} : {writeResolution:application.writeResolution}),
        });
        preferenceCurrent?.();
        application.afterAudit?.();
        if (application.settingsCurrent !== undefined) {
          repositories.settingsCurrent.advance({
            ...application.settingsCurrent,
            commandId: request.commandId,
            auditId,
            committedAt: now,
          });
        }
        return application.result;
      });
      const committedSettings = commit;
      rollback = undefined;
      commit = undefined;
      committedSettings?.();
      return result;
    } catch (error) {
      if (rollback !== undefined) {
        try {
          rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `command ${request.commandId} failed and its settings-file rollback also failed`,
            { cause: rollbackError },
          );
        }
      }
      return failCommand(error, request, true, parentCommandId);
    }
  };
  const executeSync = (request: CommandRequest, parentCommandId?: string, preferenceCurrent?: () => true): CommandResult => {
    if (request.family === "assistant-model-preference" && preferenceCurrent === undefined) return CommandResultSchema.parse({
      state: "rejected", commandId: request.commandId, code: "capability-unavailable", message: "assistant-preference-unavailable",
    });
    if (parentCommandId !== undefined && request.family !== "run") throw new Error("command-group children must be run commands");
    if (request.family === "settings") return executeSettingsCommand(dependencies, request);
    try {
      const replayed = admitCommand(request, parentCommandId, preferenceCurrent);
      if (replayed !== undefined) return replayed;
    } catch (error) {
      return failCommand(error, request, false, parentCommandId);
    }
    return applyCommand(request, parentCommandId, preferenceCurrent);
  };
  /** An admitted command settles with its typed refusal, or stays admitted with a recovery notice when its outcome is unknown. */
  const settleUnsettled = (request: CommandRequest, result: CommandResult | undefined, parentCommandId: string | undefined): void => {
    dependencies.authority.withAuthorityTransaction((repositories) => {
      if (!isAdmittedUnsettled(repositories, request)) return;
      if (result !== undefined) repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request, result,
        completedAt: IsoInstantSchema.parse(dependencies.clock.now().toISOString()), versionChanges: [], affectedDependencyIds: [] });
      // A bulk child is reported in its batch notice; notification commands correct themselves on the next read.
      if (parentCommandId !== undefined || request.family === "notification" || dependencies.commandNotices === undefined) return;
      if (result === undefined) dependencies.commandNotices.record({ kind: "command-unknown", commandId: request.commandId });
      else if (result.state === "rejected" || result.state === "conflict") {
        dependencies.commandNotices.record({ kind: "command-refused", commandId: request.commandId, outcome: result.state });
      }
    });
  };
  return Object.freeze({
    assistantAvailability: availability,
    assistantManifest() {
      const entries = availability().filter(entry => entry.availability !== "unavailable" && (
        entry.family === "notification" || entry.family === "workflow-batch"
        || entry.family === "start" && dependencies.assistantRevalidate !== undefined
        || entry.family === "settings" && entry.action !== "apply-protected-settings"
        || entry.family === "worker-browser" && entry.action === "spawn-worker" && dependencies.assistantRevalidate !== undefined
      )).map(entry => ({ family: entry.family, action: entry.action, classification: entry.classification, subject: entry.family === "start" ? "classified" as const : "none" as const }));
      const identity = { commands: availability(), schema: deriveSchemaHash(CommandRequestSchema, "input"),
        surface: dependencies.assistantSurface?.() ?? null,
        projection: ASSISTANT_INPUT_PROJECTION_VERSION, knowledge: assistantKnowledgeArtifact(Object.entries(dependencies.workflowSources ?? {}).flatMap(([id, source]) => {
          const descriptor = dependencies.descriptors.resolve(id);
          return source === "served" && descriptor !== undefined ? [{ id, label: descriptor.label }] : [];
        })).policy.exportSha256,
        workflows: dependencies.workflowSources === undefined ? null : Object.entries(dependencies.workflowSources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
      const revision = Number.parseInt(sha256Hex(canonicalJsonStringify(identity)).slice(0, 12), 16) + 1;
      return AssistantActionManifestSchema.parse({ revision, entries });
    },
    execute(input: unknown, parentCommandId?: string): CommandResult {
      const request = CommandRequestSchema.parse(input);
      if (request.family === "assistant-model-preference") {
        if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("Command request exceeds 256 KiB");
        return executeSync(request, parentCommandId);
      }
      dependencies.assistantRevalidate?.(request);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      if (request.family === "failure-resolution" && (dependencies.failureResolution?.capability ?? failureResolutionCapability)().state === "unavailable") {
        return {state:"rejected",commandId:request.commandId,code:"capability-unavailable",message:"Failure resolution is not available in this build."};
      }
      return executeSync(request, parentCommandId);
    },
    async executeStart(input: unknown): Promise<CommandResult> {
      const request = StartCommandRequestSchema.parse(input);
      if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      return withCommandSerialization(`start:${request.target.startPlanId}`, async () => {
        let admitted = false;
        const assertEffectCurrent = (): true => { dependencies.assistantRevalidate?.(request); return true; };
        try {
          assertEffectCurrent();
          const replayed = admitCommand(request, undefined, assertEffectCurrent);
          if (replayed !== undefined) return replayed;
          admitted = true;
          const scope = dependencies.authority.withAuthorityTransaction(repositories => {
            const { descriptor, plan } = readStartPlan(dependencies, repositories, request, dependencies.clock.now().toISOString());
            return workflowPreflightScope(descriptor, plan);
          });
          if (dependencies.preflight !== undefined) {
            try {
              await dependencies.preflight.prepare(scope, new AbortController().signal);
            } catch (error) {
              if (error instanceof PreflightAdmissionRefusal) throw error;
              throw new PreflightAdmissionRefusal("unavailable", "Preflight detectors could not verify readiness.", { cause: error });
            }
            dependencies.preflight.assertReady(scope);
          }
        } catch (error) {
          return failCommand(error, request, admitted);
        }
        return applyCommand(request, undefined, assertEffectCurrent);
      });
    },
    async executeAssistantModelPreference(input: unknown): Promise<CommandResult> {
      const request = AssistantModelPreferenceCommandRequestSchema.parse(input);
      if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("Command request exceeds 256 KiB");
      if (request.requestedBy !== "local-operator" || request.source.startsWith("assistant")
        || dependencies.authorityProfileId !== request.target.profileId || dependencies.prepareAssistantModelPreference === undefined) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "capability-unavailable", message: "assistant-preference-unavailable",
        });
      const current = await dependencies.prepareAssistantModelPreference(request);
      const assertCurrent = (): true => {
        const value: unknown = current();
        if (value instanceof Promise) void value.catch(() => {});
        if (value !== true) throw new Error("assistant-model-preference-authority-not-current");
        return true;
      };
      assertCurrent();
      const result = executeSync(request, undefined, assertCurrent);
      try { assertCurrent(); }
      catch (error) {
        if (result.state === "applied" || result.state === "already-applied") {
          throw new Error("assistant-model-preference-committed-currentness-unproved", { cause: error });
        }
        throw error;
      }
      return result;
    },
    async executeWorkerPool(input: unknown): Promise<CommandResult> {
      const request = CommandRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      if (request.family !== "worker-browser") {
        throw new Error(
          `executeWorkerPool settles only worker-browser commands; received ${request.family}/${request.type}`,
        );
      }
      try {
        dependencies.assistantRevalidate?.(request);
        return await withCommandSerialization(
          `pool:${workerPoolSerializationKey(request)}`,
          () => {
            dependencies.assistantRevalidate?.(request);
            return executeWorkerPoolCommand(dependencies, pool, request);
          },
        );
      } catch (error) {
        // Typed admission and settlement refusals return results; process-effect failures remain structured throws.
        if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
        });
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
    },
  });
}
