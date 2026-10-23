import { AssistantActionManifestSchema } from "../../../models/profiles/assistant-permissions.js";
import { admitWorkerLifecycle, admitWorkerReset } from "../../storage/sqlite/worker-control.js";
import { admitProtectedInput, protectedSubjectDisplay } from "../start/protected-input.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { requireWorkerPoolRoster, admitWorkerPoolRoster } from "../../storage/sqlite/worker-slots.js";
import { WorkerRetirementProofSchema, type WorkerPoolRosterAdmission } from "../../../models/run/worker-slot.js";
import { PreflightAdmissionRefusal, type PreflightAdmission } from "../../../rules/preflight/preflight-admission.js";
import { workflowPreflightScope } from "../start/preflight-scope.js";
import { startSupersedeTargets } from "../../../models/run/start-supersede.js";
import { WorkerControlRefusal, workerControlScope, WorkerEffectAcknowledgementSchema, type WorkerControlRecord, type WorkerEffectAcknowledgement } from "../../../models/run/worker-control.js";
import { CommandRefusal } from "./command-refusal.js";
import type { StorageRelocationPlanReader } from "../../storage/maintenance/storage-relocation-plans.js";
import type { CommandApplication } from "./command-application.js";
export type { CommandApplication } from "./command-application.js";
import { executeFailureResolution, failureResolutionCapability } from "../lifecycle/failure-resolution.js";
import { selectRunRuntime, selectNewRunIdentity, reviewedRunSettingsCurrent } from "../settings/run-settings.js";
import { localDatePart } from "../../../rules/time/clock.js";

import { lifecycleCommandId, type RunMutationOutcome, type RunRecordService } from "../lifecycle/run-record-service.js";
import type { RunExistence, RunRecordRefusal } from "../../../models/config/authority.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { activeRunsForItem, fanOutQueuedRuns, requireApplied, runTarget, type TargetReference, type VersionChange } from "../lifecycle/run-fan-out.js";
import { buildRerunPlan, RerunRefusedError } from "../start/rerun.js";
import type { IntakeParser } from "../../../workflow-kit/intake-parser.js";
import type { Clock } from "../../../rules/time/clock.js";
import { LiveWorkerResetRequestSchema, COMMAND_EFFECT_BY_ACTION, COMMAND_FAMILY_REGISTRY, CommandIdentityConflictError, CommandRequestSchema, CommandResultSchema, StorageRelocationCommandRequestSchema, deriveSettingsCommandFingerprint, markSettingsCommand, type CommandRequest, type CommandResult } from "../../../rules/commands/commands.js";
import { deriveItemId, deriveStableUuid, type IdFactory } from "../../../rules/identity/identifiers.js";
import { deriveGateResultCheckpointFingerprint as deriveGateFingerprint } from "../../../models/workflow/gates.js";
import { FingerprintSchema, IsoInstantSchema, ItemIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { EditableSettingsOverrideSchema } from "../../../models/config/schema.js";
import { SettingsApplyRefusalSchema, type SettingsFileRecord } from "../../../models/config/settings.js";
import { readSettings } from "../../runtime/settings/settings-runtime.js";
import { IntakeParseSchema, resolveInspectSelection, type IntakeLayout } from "../../../models/intake/parse.js";
import type { IntakePlanManifest } from "../../../models/intake/manifest.js";
import { intakeReviewBinding, resolveIntakeComparison } from "../../../models/intake/review.js";
import { deriveIntakeEnqueuePlan } from "../../../models/intake/enqueue.js";
import { confirmBinding } from "../../../models/intake/mapping.js";
import type { IntakeProjection } from "../../../models/intake/projection.js";
import { validateIntakeRows } from "../../../models/intake/validate.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { isTerminalRunState, RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import { isLiveWorker } from "../../../models/run/worker.js";
import { workerPoolVersion } from "../../../models/run/worker-pool.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { checkpointLookupKey, resolveFreshnessBound, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { findGateDecision } from "../../../models/trust/gate-decisions.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../workflow-kit/validation/build-manifest.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { readRunCheckpoint } from "../../runtime/checkpoints/run-checkpoint-reader.js";
import { WriteIntentRecordSchema, type WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { dryRunRefusalMessage, resolveInstances, supportsDryRun } from "../start/plan.js";
import { type ExplorerEditApplyRequest, ExplorerEditApplyResultSchema, type ExplorerEditApplyResult } from "../../../models/dashboard/explorer.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsReadbackSchema, type ProtectedSettingsReadback } from "../../../models/config/protected-settings.js";

/* ── the arm partition (ref dashboard-surfaces authority) ─────────────── */

const PHASE1_ACTIVE = {
  "failure-resolution": ["annotate-failure"],
  "workflow-batch": ["set-batch-grouping"],
  start: ["start-run"],
  "worker-browser": [
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
    "retry",

    "restart",
    "cancel",
    "bump",
    "rename",
    "delete",
    "resolve-write-present",
    "resolve-write-absent",
  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"],

  intake: [
    "inspect-intake",
    "confirm-intake-mapping",
    "correct-intake-row",
    "exclude-intake-row",
    "validate-intake",
    "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],
  "storage-relocation": ["plan-storage-relocation", "cancel-storage-relocation"],

  explorer: ["apply-explorer-edit"],
} as const;

const PHASE1_DEFERRED = {
  intake: [],
  settings: [],
  "storage-relocation": [],
  run: [],
  notification: [],
} as const;

export const PHASE1_ACTIVE_COMMAND_ARMS = deepFreeze(PHASE1_ACTIVE);
export const PHASE1_DEFERRED_COMMAND_ARMS = deepFreeze(PHASE1_DEFERRED);

function armActions(partition: Readonly<Record<string, readonly string[]>>, family: string): readonly string[] {
  const actions = Object.hasOwn(partition, family) ? partition[family] : undefined;
  if (actions === undefined) return [];
  return actions;
}


for (const { family, actions } of COMMAND_FAMILY_REGISTRY) {
  const active = armActions(PHASE1_ACTIVE, family);
  const deferred = armActions(PHASE1_DEFERRED, family);
  const combined = [...active, ...deferred];
  if (combined.length !== actions.length
    || new Set(combined).size !== combined.length
    || actions.some((action) => !combined.includes(action))) {
    throw new Error(`command arm partition does not cover family ${family} exactly`);
  }
}

const DEFERRED_ARM_KEYS: ReadonlySet<string> = new Set(
  Object.entries(PHASE1_DEFERRED as Readonly<Record<string, readonly string[]>>).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── injected seams ──────────────────────────────────────────────────────── */

export interface CommandAuthority {
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface WorkflowDescriptorResolver {
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
}


type RunCommand = Extract<CommandRequest, { family: "run" }>;
type RunBasicCommand = Extract<RunCommand, { type: "retry" | "restart" | "cancel" | "bump" }>;

type RunRecoveryCommand = RunBasicCommand;
type IntakeCommand = Extract<CommandRequest, { family: "intake" }>;
type NotificationCommand = Extract<CommandRequest, { family: "notification" }>;
export type SettingsCommand = Extract<CommandRequest, { family: "settings" }>;
type RunRenameCommand = Extract<RunCommand, { type: "rename" }>;
type RunDeleteCommand = Extract<RunCommand, { type: "delete" }>;
type WriteResolutionCommand = Extract<RunCommand, { type: "resolve-write-present" | "resolve-write-absent" }>;

export interface ExplorerEditExecutor {
  apply(input: ExplorerEditApplyRequest, repositories: AuthorityRepositories): Readonly<{ result: ExplorerEditApplyResult }>;
}

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
  resolvePresent(repositories: AuthorityRepositories, context: WriteResolutionContext): PreparedWriteResolution;
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


export interface WorkerRuntimeContext {
  readonly command: Extract<CommandRequest, { family: "worker-browser" }>;
  readonly now: string;
  readonly roster?: WorkerPoolRosterAdmission;
}

export const WorkerRuntimeAcknowledgementSchema = z.strictObject({ state: z.literal("accepted") });

export const WorkerPlanAcknowledgementSchema = z.strictObject({
  state: z.literal("accepted"),
  /** The exact worker ids the plan reconciles toward; never an empty guess. */
  workerIds: z.array(WorkerIdSchema),
  retirements: z.array(WorkerRetirementProofSchema),
});




// Keep the async pool seam structural to avoid importing the worker loop back into its command dependency.
export interface WorkerPoolRuntimeSeam {
  beginLifecycle?(context: WorkerRuntimeContext): void;
  assertLifecycleOwner?(operation: "remove" | "retry", workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  assertResetOwner?(workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  planPoolWorkerCount(context: WorkerRuntimeContext): Promise<unknown>;
  spawnPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  refreshPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  reopenPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  stopPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  pausePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  resumePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
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
  readonly preflight?: PreflightAdmission;
  readonly authority: CommandAuthority;
  readonly lifecycle: RunRecordService;
  readonly clock: Clock;
  readonly ids: IdFactory;

  readonly appVersion: string;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly writeResolution: WriteResolutionExecutor;
  readonly workerRuntime: WorkerPoolRuntimeAdoption;
  readonly intakeParser: IntakeParser;
  readonly intakeProjections: IntakeProjectionResolver;
  readonly configIdentity: RunConfigIdentity;
  /** The strict settings-file CAS executor. An active settings command cannot exist without it. */
  readonly settings?: SettingsApplicationExecutor;
  readonly authorityProfileId?: string;
  readonly assistantRevalidate?: (command: CommandRequest) => void;
  readonly storageRelocationPlans?: StorageRelocationPlanReader;
  readonly failureResolution?: Readonly<{execute:typeof executeFailureResolution;capability:typeof failureResolutionCapability}>;


  readonly explorerEdits?: ExplorerEditExecutor;
}

export interface CommandKernel {
  assistantManifest(): z.infer<typeof AssistantActionManifestSchema>;
  execute(input: unknown, parentCommandId?: string): CommandResult;

  executeWorkerPool(input: unknown): Promise<CommandResult>;
}

/* ── internals ───────────────────────────────────────────────────────────── */

// Throwing a typed non-applied result rolls back partial effects while retaining its command outcome.


function workerPoolTarget(workflowId: string): TargetReference {
  return { family: "worker-pool", workflowId };
}

function workerTarget(workerId: string): TargetReference {
  return { family: "worker-browser", workerId };
}

function reject(request: CommandRequest, code: string, message: string): never {
  throw new CommandRefusal({ state: "rejected", commandId: request.commandId, code, message });
}

// Invalid served proof is a typed rejection that rolls back the transaction, not a transport failure.
export { rejectCommandRequest } from "./command-refusal.js";

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
  const descriptor = dependencies.descriptors.resolve(workflowId);
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
    case "owned-by-worker": case "heartbeat-live": case "invalid-state": case "not-terminal":
    case "already-archived": case "is-member": case "tree-non-terminal": case "use-archive-door":
      return reject(request, "invalid-state", `run lifecycle refused: ${refusal.reason}`);
    case "parent-missing": case "retry-of-missing": case "identity-conflict": case "cursor-stale":
    case "lost": case "replay-divergent": case "retention-not-due": case "none-eligible": case "worker-busy":
      throw new Error(`unexpected operator lifecycle refusal: ${refusal.reason}`);
  }
}

function lifecycleRun(request: CommandRequest, outcome: RunMutationOutcome | RunExistence): RunRecord {
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state === "deleted") reject(request, "target-deleted", "run was deleted");
  if (outcome.state === "absent") reject(request, "target-not-found", "run does not exist");
  if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) return outcome.run;
  throw new Error(`unexpected operator lifecycle result: ${outcome.state}`);
}

/* ── the arms ────────────────────────────────────────────────────────────── */

function executeStartRun(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
): CommandApplication {
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

  if (!reviewedRunSettingsCurrent(repositories, plan)) {
    reject(request, "replan-required", "Settings changed after this plan was reviewed; review a fresh plan before starting");
  }
  if (plan.rerun !== undefined) {
    let current;
    try {
      current = buildRerunPlan(repositories, descriptor, plan.rerun.source, plan.planned, plan.rerun.acknowledgment, plan.stepOmissions);
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
    reject(request, "invalid-state", consumption.message);
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
    })),
    now,
    `plan ${plan.startPlanId}`,
  );

  return applied(
    request,
    [...affectedTargets, ...fanOut.affectedTargets],
    [...versionChanges, ...fanOut.versionChanges],
  );
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
      + "a parked unknown write uses resolve-write-present/resolve-write-absent, never generic retry",
    );
  }
  if (!isTerminalRunState(current.lifecycle)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a terminal run can be retried`,
    );
  }
  if (current.envelope.parent !== undefined) {
    reject(
      request,
      "policy-refused",
      `run ${request.target.runId} is a delegated child of ${current.envelope.parent.runId}; `
      + "child retries route through their delegation edge policy, not generic retry",
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
  const record = lifecycleRun(request, dependencies.lifecycle[request.type === "restart" ? "restart" : "retry"]({
    commandId: lifecycleCommandId(`operator-${request.type}`, request.commandId),
    runId: current.envelope.runId, expectedVersion: request.target.expectedVersion,
    runtimeConfig: selectRunRuntime(repositories), appVersion: dependencies.appVersion,
  }, descriptor, { ...protectedSubjectDisplay(retainedRunProtectedBindings(current), () => ({ title: planning.title(value), subtitle: planning.subtitle(value) })), actorId: request.requestedBy }));
  return applied(request, [runTarget(record.envelope.runId), runTarget(request.target.runId)], [
    { target: runTarget(record.envelope.runId), before: 0, after: record.version },
  ]);

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
): void {
  for (const target of targets) {
    const runId = target.run.envelope.runId;
    for (const intent of repositories.writeIntents.listByRun(runId)) {
      if (intent.status !== "attempting" && intent.status !== "parked") continue;
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
    const edges = repositories.dependencies.listByParentRun(parent.envelope.runId);
    for (const child of repositories.runs.listChildren(parent.envelope.runId)) {
      const childRunId = child.envelope.runId;
      if (visited.has(childRunId)) {
        throw new Error(`run ${childRunId} appears twice in the dependency tree under ${request.target.runId}`);
      }
      visited.add(childRunId);
      const edge = edges.find((candidate) => candidate.childRunId === childRunId);
      if (edge === undefined) {
        throw new Error(
          `run ${childRunId} is a child of ${parent.envelope.runId} but has no dependency edge in authority; `
          + "the tree is inconsistent, so no target was cancelled",
        );
      }
      if (edge.policy.cascadeCancel !== "cascade") continue;
      dependencyIds.push(edge.dependencyId);
      if (!isTerminalRunState(child.lifecycle)) targets.push({ run: child, dependencyId: edge.dependencyId });
      walk(child);
    }
  };
  walk(current);
  refuseCancelOverUnresolvedWrite(repositories, request, targets);

  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  for (const target of [...targets].reverse()) {
    const outcome = dependencies.lifecycle.transition({
      commandId: lifecycleCommandId("operator-cancel", { commandId: request.commandId, runId: target.run.envelope.runId }),
      runId: target.run.envelope.runId,
      expectedVersion: target.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
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
      if (!edges.some((candidate) => candidate.childRunId === childRunId)) {
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
  const snoozeUntil = request.type === "notification-snooze"
    ? new Date(Date.parse(now) + 3_600_000).toISOString()
    : undefined;
  repositories.notifications.updateState({
    notificationId: request.target.notificationId,
    expectedVersion: current.version,
    status: request.type === "notification-read"
      ? "read"
      : request.type === "notification-unread"
        ? "unread"
        : current.status,
    snooze: snoozeUntil !== undefined
      ? { state: "snoozed", until: snoozeUntil }
      : request.type === "notification-unsnooze"
        ? { state: "not-snoozed" }
        : current.snooze,
    updatedAt: now,
  });
  const target: TargetReference = { family: "notification", notificationId: request.target.notificationId };
  return applied(request, [target], [{
    target,
    before: current.version,
    after: current.version + 1,
  }]);
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
    displayName: request.payload.displayName,
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
  const raw = request.type === "resolve-write-present"
    ? dependencies.writeResolution.resolvePresent(repositories, context)
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
  verifyGateEvidenceCurrent(request, descriptor, node, evidenceScope, now);
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
        || checkpoint.implFingerprint !== resolveTaskImplFingerprint(BUILD_MANIFEST, node.uses.id)
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
): void {
  const declaration = findGateDecision(descriptor.id, request.target.gateId);
  if (declaration?.boundEvidencePath !== undefined) {
    const submitted = valueAtPath(request.payload.result.value, declaration.boundEvidencePath);
    const currentEvidence = gate.dependsOn.flatMap((nodeId) => {
      const checkpoint = scope.checkpoints.get(String(nodeId))?.record;
      const value = checkpoint === undefined ? undefined : valueAtPath(checkpoint.output.value, declaration.boundEvidencePath!);
      return value === undefined ? [] : [{ nodeId: String(nodeId), value }];
    });
    if (currentEvidence.length !== 1 || currentEvidence[0]?.value !== submitted) {
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

function requireWorkerControlBasis(repositories: AuthorityRepositories, request: WorkerBrowserCommand): void {
  if (!("workerId" in request.target)) return;
  const lease = repositories.workerLeases.get(request.target.workerId);
  if (lease === undefined) reject(request, "target-not-found", "worker-control-target-not-found");
  if (request.target.controlBasis === undefined || lease.controlRevision === undefined) reject(request, "invalid-state", "worker-control-basis-unavailable: historical evidence cannot authorize a new instruction");
  if (request.target.controlBasis.leaseGeneration !== lease.leaseGeneration || request.target.controlBasis.controlRevision !== lease.controlRevision) conflict(request, lease.controlRevision, "worker-control-basis-conflict: worker lifetime or control revision changed");
}

function requireReservedWorkerControl(repositories: AuthorityRepositories, request: WorkerBrowserCommand): void {
  if (!("workerId" in request.target)) return;
  const lease = repositories.workerLeases.get(request.target.workerId);
  const basis = request.target.controlBasis;
  if (lease === undefined || basis === undefined || lease.leaseGeneration !== basis.leaseGeneration
    || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== request.commandId) {
    throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
  }
}

function validateWorkerPoolCommand(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WorkerBrowserCommand,
): number {
  const workflow = "workflowId" in request.target ? request.target.workflowId : repositories.workerSlots.get(request.target.workerId)?.workflow;
  if (workflow !== undefined && repositories.workerSlots.verifications(workflow).length !== 0) reject(request, "invalid-state", "worker-verification-reserved");
  requireWorkerControlBasis(repositories, request);
  switch (request.type) {
    case "plan-worker-count": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      return checkWorkerPoolVersion(repositories, request, request.target.workflowId, request.target.expectedVersion);
    }
    case "spawn-worker": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      const version = checkWorkerPoolVersion(
        repositories, request, request.target.workflowId, request.target.expectedVersion,
      );
      const slot = repositories.workerSlots.get(request.payload.workerId);
      if (slot === undefined || slot.retiredAt !== null || slot.workflow !== request.target.workflowId) reject(request, "invalid-state", "worker-slot-not-admitted: select a current reserved member");
      requireWorkerPoolRoster(repositories, request.target.workflowId);
      const existing = repositories.workerLeases.get(request.payload.workerId);
      if (existing !== undefined && isLiveWorker(existing)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.payload.workerId} already holds a live lease in state ${existing.lifecycle.state}; `
          + "a second process may not answer to the same worker id",
        );
      }
      return version;
    }
    case "remove-worker":
    case "retry-worker":
      return reject(request, "invalid-state", "worker-lifecycle-dedicated-admission-required");
    case "stop-worker":
    case "pause-worker":
    case "resume-worker": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "a stopped worker starts a new lease generation instead of taking directives",
        );
      }
      return lease.version;
    }
    case "refresh-browser":
    case "reopen-browser": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "it owns no live browser session to act on",
        );
      }
      if (lease.lifecycle.state === "busy" || repositories.runs.listByWorker(lease.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state))) reject(request, "invalid-state", "worker-browser-busy: no deferred control is queued");
      const selected = repositories.workerControls.browsers(lease.workerId).find(value => value.sessionId === request.target.browserSessionId && value.leaseGeneration === lease.leaseGeneration && value.health !== "closed");
      if (selected === undefined) reject(request, "invalid-state", "worker-browser-session-unavailable");
      return lease.version;
    }
  }
}

type WorkerPoolSettledAcknowledgement = WorkerEffectAcknowledgement;


async function settleWorkerPoolEffect(
  pool: WorkerPoolRuntimeSeam,
  request: WorkerBrowserCommand,
  context: WorkerRuntimeContext,
): Promise<WorkerPoolSettledAcknowledgement> {
  switch (request.type) {
    case "plan-worker-count": {
      const acknowledgement = WorkerPlanAcknowledgementSchema.parse(await pool.planPoolWorkerCount(context));
      return { kind: "plan", workerIds: acknowledgement.workerIds, retirements: acknowledgement.retirements };
    }
    case "spawn-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.spawnPoolWorker(context));
      return { kind: "control" };
    case "remove-worker":
    case "retry-worker":
    case "stop-worker":
      throw new WorkerControlRefusal("worker-reset-settlement-unavailable");
    case "pause-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.pausePoolWorker(context));
      return { kind: "control" };
    case "resume-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.resumePoolWorker(context));
      return { kind: "control" };
    case "refresh-browser":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.refreshPoolBrowser(context));
      return { kind: "control" };
    case "reopen-browser":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.reopenPoolBrowser(context));
      return { kind: "control" };
  }
}


function applyWorkerPoolCommand(
  repositories: AuthorityRepositories,
  request: WorkerBrowserCommand,
  now: string,
  basisVersion: number,
  acknowledgement: WorkerPoolSettledAcknowledgement,
): CommandApplication {
  switch (request.type) {
    case "plan-worker-count": {
      if (acknowledgement.kind !== "plan") {
        throw new Error("plan-worker-count settled without a plan acknowledgement; the pool seam is inconsistent");
      }
      const control = repositories.workerControls.get(request.commandId);
      if (control === undefined) throw new Error("worker-roster-admission-missing");
      const roster = control.roster;
      if (roster === undefined || roster.beforeVersion !== basisVersion
        || canonicalJsonStringify(acknowledgement.workerIds) !== canonicalJsonStringify(roster.selected.map(slot => slot.workerId))
        || acknowledgement.retirements.length !== roster.excess.length) throw new Error("worker-roster-settlement-mismatch");
      for (const original of [...roster.selected, ...roster.excess]) {
        const current = repositories.workerSlots.get(original.workerId);
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(original)) throw new Error("worker-roster-reservation-changed");
      }
      const currentPool = repositories.workerPools.get(request.target.workflowId);
      if (currentPool === undefined) throw new Error("worker-pool-missing-before-settlement");
      if (currentPool.version !== roster.admittedVersion) conflict(request, currentPool.version,
        "The worker effect ALREADY executed before the pool changed; retain this command identity and do not repeat it");
      for (const slot of roster.excess) {
        const proof = acknowledgement.retirements.find(value => value.workerId === slot.workerId);
        if (proof === undefined || proof.membershipRevision !== slot.membershipRevision
          || Date.parse(proof.checkedAt) < Date.parse(control.admittedAt)
          || repositories.workerControls.browsers(slot.workerId).some(browser => browser.health !== "closed")) throw new Error("worker-retirement-not-proved");
        repositories.workerSlots.retire({ workerId: slot.workerId, commandId: request.commandId,
          expectedRevision: slot.membershipRevision, now: proof.checkedAt });
      }
      if (roster.admittedVersion === roster.beforeVersion) {
        const planned = repositories.workerPools.plan({ workflow: request.target.workflowId,
          expectedVersion: roster.beforeVersion, desiredWorkers: request.payload.desiredWorkers,
          requestedBy: request.requestedBy, now });
        if (planned.state !== "applied" || planned.pool.version !== roster.afterVersion) throw new Error("worker-pool-version-conflict");
      } else if (currentPool.desiredWorkers !== request.payload.desiredWorkers) throw new Error("worker-pool-declaration-mismatch");
      requireWorkerPoolRoster(repositories, request.target.workflowId);
      return applied(
        request,
        [
          workerPoolTarget(request.target.workflowId),
          ...acknowledgement.workerIds.map((workerId) => workerTarget(workerId)),
        ],
        [{ target: workerPoolTarget(request.target.workflowId), before: basisVersion, after: basisVersion + 1 }],
      );
    }
    case "spawn-worker":
      // The child's own birth lease IS the authority fact, written by the
      // worker process and proved by the supervisor before it acknowledged.
      return applied(request, [workerTarget(request.payload.workerId)], []);
    case "remove-worker":
    case "retry-worker":
    case "stop-worker":
      throw new WorkerControlRefusal("worker-reset-settlement-unavailable");
    case "pause-worker":
    case "resume-worker": {
      requireReservedWorkerControl(repositories, request);
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        throw new Error(
          `worker lease ${request.target.workerId} vanished after its ${request.type} was attested; `
          + "the durable record is inconsistent",
        );
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "a stopped worker starts a new lease generation instead of taking directives",
        );
      }
      const directive = request.type === "pause-worker" ? "pause" : "run";
      const outcome = repositories.workerLeases.control({
        workerId: request.target.workerId,
        expectedVersion: lease.version,
        commandId: request.commandId,
        control: {
          directive,
          requestedAt: now,
          requestedBy: request.requestedBy,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        },
        now,
      });
      requireApplied(outcome, `${request.type} directive on worker ${request.target.workerId}`);
      return applied(request, [workerTarget(request.target.workerId)], [{
        target: workerTarget(request.target.workerId),
        before: lease.version,
        after: lease.version + 1,
      }]);
    }
    case "refresh-browser":
    case "reopen-browser":
      return applied(request, [workerTarget(request.target.workerId)], []);
  }
}

/** Durable admission precedes every async effect; settlement precedes the final audit. */
async function executeWorkerPoolCommand(
  dependencies: CommandKernelDependencies,
  pool: WorkerPoolRuntimeSeam,
  request: WorkerBrowserCommand,
): Promise<CommandResult> {
  const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
  if (request.type === "stop-worker") {
    if (!LiveWorkerResetRequestSchema.safeParse(request).success) return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message: "worker-reset-authority-unavailable" });
    let replacement: WorkerRuntimeContext | undefined;
    let result: CommandResult;
    try { result = dependencies.authority.withAuthorityTransaction(repositories => {
      repositories.commands.assertIdentity(request);
      const prior = repositories.workerControls.get(request.commandId);
      if (prior !== undefined) {
        if (prior.reset === undefined) return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message: "worker-reset-authority-unavailable" });
        if (repositories.commandAudits.findByCommand(request.commandId) !== undefined) return replay(dependencies, repositories, request, now);
        return CommandResultSchema.parse({ state: "pending", commandId: request.commandId });
      }
      try {
        const live = LiveWorkerResetRequestSchema.parse(request);
        const lease = repositories.workerLeases.get(live.target.workerId), slot = repositories.workerSlots.get(live.target.workerId);
        if (lease === undefined || slot === undefined) throw new WorkerControlRefusal("worker-reset-owner-unavailable");
        const lifetime = { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt };
        let descriptor: AnyWorkflowDescriptor | undefined;
        if (lease.lifecycle.state === "stopped") {
          if (pool.assertLifecycleOwner === undefined || pool.beginLifecycle === undefined) throw new WorkerControlRefusal("worker-reset-replacement-owner-unavailable");
          descriptor = dependencies.descriptors.resolve(slot.workflow);
          if (descriptor === undefined) throw new WorkerControlRefusal("worker-reset-replacement-descriptor-unavailable");
          selectNewRunIdentity(repositories, dependencies.configIdentity);
        } else {
          if (pool.assertResetOwner === undefined) throw new WorkerControlRefusal("worker-reset-owner-unavailable");
          pool.assertResetOwner(live.target.workerId, live.target.membershipRevision, lifetime);
        }
        const record = admitWorkerReset(repositories, request, dependencies.ids.uuid(), now, descriptor);
        if (record.lifecycle !== undefined) {
          repositories.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: now });
          dependencies.lifecycle.settleResetWork(record.reset);
          if (pool.assertLifecycleOwner === undefined) throw new WorkerControlRefusal("worker-reset-replacement-owner-unavailable");
          pool.assertLifecycleOwner("retry", live.target.workerId, live.target.membershipRevision, lifetime);
          replacement = { command: request, now };
        }
      } catch (error) {
        if (error instanceof CommandIdentityConflictError) throw error;
        throw new WorkerControlRefusal(error instanceof Error ? error.message : "worker-reset-authority-unavailable");
      }
      return CommandResultSchema.parse({ state: "pending", commandId: request.commandId });
    }); } catch (error) {
      if (error instanceof WorkerControlRefusal) return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId,
        code: "invalid-state", message: error.message });
      throw error;
    }
    if (replacement !== undefined) {
      try { pool.beginLifecycle?.(replacement); }
      catch (error) {
        const current = dependencies.authority.withAuthorityTransaction(repositories => repositories.workerControls.get(request.commandId));
        if (current?.phase.state === "executing") {
          const startedAt = current.phase.startedAt;
          dependencies.authority.withAuthorityTransaction(repositories => repositories.workerControls.transition(request.commandId, "executing", {
            state: "uncertain", startedAt, observedAt: now, message: "worker-reset-replacement-dispatch-unproved" }));
        }
        throw error;
      }
    }
    return result;
  }
  if (request.type === "remove-worker" || request.type === "retry-worker") {
    let context: WorkerRuntimeContext | undefined;
    let admitted: CommandResult;
    try {
      admitted = dependencies.authority.withAuthorityTransaction(repositories => {
        repositories.commands.assertIdentity(request);
        const prior = repositories.workerControls.get(request.commandId);
        if (prior !== undefined) return repositories.commandAudits.findByCommand(request.commandId) === undefined
          ? CommandResultSchema.parse({ state: "pending", commandId: request.commandId }) : replay(dependencies, repositories, request, now);
        const lease = repositories.workerLeases.get(request.target.workerId);
        if (lease === undefined || pool.assertLifecycleOwner === undefined || pool.beginLifecycle === undefined) throw new WorkerControlRefusal("worker-lifecycle-owner-unavailable");
        pool.assertLifecycleOwner(request.type === "remove-worker" ? "remove" : "retry", request.target.workerId, request.target.membershipRevision,
          { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt });
        const descriptor = dependencies.descriptors.resolve(request.target.workflowId);
        if (descriptor === undefined) throw new WorkerControlRefusal("worker-lifecycle-descriptor-unavailable");
        selectNewRunIdentity(repositories, dependencies.configIdentity);
        const record = admitWorkerLifecycle(repositories, request, dependencies.ids.uuid(), now, { descriptor, mode: "initialize" });
        context = { command: request, now };
        repositories.workerControls.transition(record.commandId, "admitted", { state: "executing", startedAt: now });
        return CommandResultSchema.parse({ state: "pending", commandId: request.commandId });
      });
    } catch (error) {
      if (error instanceof CommandIdentityConflictError) throw error;
      return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message: error instanceof Error ? error.message : "worker-lifecycle-authority-unavailable" });
    }
    if (context !== undefined) {
      try { pool.beginLifecycle?.(context); }
      catch (error) {
        dependencies.authority.withAuthorityTransaction(repositories => {
          const current = repositories.workerControls.get(request.commandId);
          if (current?.phase.state === "executing") repositories.workerControls.transition(request.commandId, "executing", { state: "uncertain", startedAt: current.phase.startedAt,
            observedAt: dependencies.clock.now().toISOString(), message: "worker-lifecycle-dispatch-unproved" });
        });
        throw error;
      }
    }
    return admitted;
  }
  const browser = request.type === "refresh-browser" || request.type === "reopen-browser";
  const controls = dependencies.authority.withAuthorityTransaction(repositories => repositories.workerControls);
  const pre = dependencies.authority.withAuthorityTransaction((repositories) => {
    repositories.commands.assertIdentity(request);
    if (repositories.commandAudits.findByCommand(request.commandId) !== undefined) {
      return { kind: "replay" as const, result: replay(dependencies, repositories, request, now) };
    }
    const prior = repositories.workerControls.get(request.commandId);
    if (prior !== undefined) return { kind: "retained" as const, record: prior };
    if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") repositories.runtimeConfig.requireSettingsCurrent();
    const basisVersion = validateWorkerPoolCommand(dependencies, repositories, request);
    const scope = workerPoolSerializationKey(request);
    if (repositories.workerControls.pending(scope).length > 0) reject(request, "invalid-state", "worker-control-unresolved-effect: reconcile the exact previous command before another effect");
    if ("workerId" in request.target) repositories.workerLeases.reserveControl(request.target.workerId, request.target.controlBasis, request.commandId, now);
    repositories.commands.insert(request);
    const roster = request.type === "plan-worker-count" ? admitWorkerPoolRoster(repositories, request, now) : undefined;
    const record = repositories.workerControls.admit({ ...(roster === undefined ? {} : { roster }), commandId: request.commandId, request, scope,
      executorId: dependencies.ids.uuid(), admittedAt: now,
      expiresAt: new Date(Date.parse(now) + 180_000).toISOString(), basisVersion, phase: { state: "admitted" } });
    return { kind: "admitted" as const, record };
  });
  if (pre.kind === "replay") return pre.result;
  let record: WorkerControlRecord = pre.record;
  if (pre.kind === "admitted") {
    try {
      if (!browser) record = controls.transition(request.commandId, "admitted", { state: "executing", startedAt: now });
      const context: WorkerRuntimeContext = Object.freeze({ command: request, now, ...(pre.record.roster === undefined ? {} : { roster: pre.record.roster }) });
      const acknowledgement = WorkerEffectAcknowledgementSchema.parse(await settleWorkerPoolEffect(pool, request, context));
      if (!browser) record = dependencies.authority.withAuthorityTransaction(repositories => {
        if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") repositories.runtimeConfig.requireSettingsCurrent();
        const application = applyWorkerPoolCommand(repositories, request, now, pre.record.basisVersion, acknowledgement);
        return repositories.workerControls.transition(request.commandId, "executing", {
          state: "succeeded", startedAt: now, completedAt: dependencies.clock.now().toISOString(), acknowledgement, application,
        });
      });
      else {
        const observed = controls.get(request.commandId);
        if (observed === undefined || observed.phase.state !== "succeeded") throw new Error("worker-browser-outcome-not-observed");
        record = observed;
      }
    } catch (error) {
      const current = controls.get(request.commandId);
      if (current === undefined) throw new Error("worker-control-evidence-missing", { cause: error });
      const observedAt = dependencies.clock.now().toISOString();
      if (current.phase.state === "admitted" || current.phase.state === "ready" || current.phase.state === "executing") {
        const phase = error instanceof WorkerControlRefusal
          ? { state: "refused", completedAt: observedAt, message: error.message }
          : current.phase.state === "executing"
            ? { state: "uncertain", startedAt: current.phase.startedAt, observedAt, message: "worker-control-effect-uncertain" }
            : { state: "refused", completedAt: observedAt, message: "worker-control-delivery-refused" };
        record = controls.transition(request.commandId, current.phase.state, phase);
      } else record = current;
      if (record.phase.state !== "succeeded" && !(error instanceof WorkerControlRefusal)) throw error;
    }
  }
  return dependencies.authority.withAuthorityTransaction((repositories) => {
    const retained = repositories.workerControls.get(request.commandId);
    if (retained === undefined) throw new Error("worker-control-evidence-missing");
    record = retained;
    if ((record.phase.state === "admitted" || record.phase.state === "ready") && Date.parse(record.expiresAt) <= dependencies.clock.nowMs()) {
      record = repositories.workerControls.transition(request.commandId, record.phase.state,
        { state: "refused", completedAt: dependencies.clock.now().toISOString(), message: "worker-control-expired-before-effect" });
    }
    if (record.phase.state === "executing" && Date.parse(record.expiresAt) <= dependencies.clock.nowMs()) {
      record = repositories.workerControls.transition(request.commandId, "executing", { state: "uncertain", startedAt: record.phase.startedAt,
        observedAt: dependencies.clock.now().toISOString(), message: "worker-control-effect-uncertain: owner did not retain an outcome before expiry" });
    }
    if (record.phase.state !== "succeeded" && record.phase.state !== "refused") {
      return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state",
        message: `worker-control-${record.phase.state}: no repeated effect is authorized; retain this command identity` });
    }
    repositories.commands.assertIdentity(request);
    repositories.commands.insert(request);
    if (repositories.commandAudits.findByCommand(request.commandId) !== undefined) return replay(dependencies, repositories, request, now);
    const application = record.phase.state === "succeeded"
      ? record.phase.application ?? applyWorkerPoolCommand(repositories, request, record.admittedAt, record.basisVersion, record.phase.acknowledgement)
      : { result: CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message: record.phase.message }), versionChanges: [], affectedDependencyIds: [] };
    repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request, result: application.result,
      completedAt: dependencies.clock.now().toISOString(), versionChanges: application.versionChanges, affectedDependencyIds: application.affectedDependencyIds });
    repositories.workerControls.audit(request.commandId, dependencies.clock.now().toISOString());
    return application.result;
  });
}


const workerPoolSerializationKey = workerControlScope;


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

function executeExplorerEdit(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "explorer" }>,
): CommandApplication {
  const executor = dependencies.explorerEdits;
  if (executor === undefined) {
    throw new Error("explorer/apply-explorer-edit is active but no Explorer edit executor is composed");
  }
  const execution = executor.apply(request, repositories);
  const outcome = ExplorerEditApplyResultSchema.parse(execution.result);
  if (outcome.state === "conflict") {
    conflict(request, outcome.currentOverrideRevision, outcome.message);
  }
  if (outcome.state === "refused") {
    reject(request, "policy-refused", outcome.message);
  }
  if (outcome.state === "code-change-required") {
    reject(request, "policy-refused", outcome.brief.reason);
  }
  const override = outcome.override;
  const persisted = repositories.explorerOverrides.read(request.target.workflowId);
  if (persisted === undefined
    || String(override.workflowId) !== String(request.target.workflowId)
    || override.descriptorVersion !== request.target.expectedVersion
    || override.contractFingerprint !== request.target.contractFingerprint
    || override.revision !== request.target.expectedOverrideRevision + 1
    || canonicalJsonStringify(override) !== canonicalJsonStringify(outcome.readback)
    || canonicalJsonStringify(override) !== canonicalJsonStringify(persisted)) {
    throw new Error(
      `Explorer edit executor returned a readback that does not exactly advance command ${request.commandId}'s target`,
    );
  }
  const target: TargetReference = {
    family: "explorer",
    workflowId: override.workflowId,
    revision: override.revision,
  };
  const application = applied(request, [target], [{
    target,
    before: request.target.expectedOverrideRevision,
    after: override.revision,
  }]);
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
    case "failure-resolution": return (dependencies.failureResolution?.execute ?? executeFailureResolution)(repositories, request, now);
    case "workflow-batch": {
      const batch = repositories.runSessions.get(request.target.batchId);
      if (batch === undefined) reject(request, "target-not-found", "Workflow batch no longer exists.");
      if (batch.version !== request.target.expectedVersion) conflict(request, batch.version, "Batch presentation changed; reload and try again.");
      const updated = repositories.runSessions.setGrouping(batch.sessionId, batch.version, request.payload.groupInQueue);
      const target = { family: "workflow-batch", batchId: batch.sessionId };
      return applied(request, [target], [{ target, before: batch.version, after: updated.version }]);
    }
    case "start":
      repositories.runtimeConfig.requireSettingsCurrent();
      return executeStartRun(dependencies, repositories, request, now);
    case "worker-browser":
      if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return reject(request, "capability-unavailable", "Worker commands require the current asynchronous process owner.");
    case "gate":
      return executeResolveGate(dependencies, repositories, request, now);
    case "run": {
      switch (request.type) {
        case "retry":
        case "restart":
          repositories.runtimeConfig.requireSettingsCurrent();
          return executeRetry(dependencies, repositories, request, now);
        case "cancel": return executeCancel(dependencies, repositories, request, now);
        case "delete": return executeDelete(dependencies, repositories, request, now);
        case "bump": return executeBump(dependencies, repositories, request, now);
        case "rename": return executePresentation(dependencies, repositories, request, now);
        case "resolve-write-present":
        case "resolve-write-absent":
          return executeWriteResolution(dependencies, repositories, request, now, auditId);
      }
      break;
    }
    case "notification":
      return executeNotification(repositories, request, now);
    case "intake":
      if (request.type === "enqueue-intake-manifest") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeIntake(dependencies, repositories, request, now);
    case "explorer":
      return executeExplorerEdit(dependencies, repositories, request);
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
  if (request.family === "worker-browser" && audit.result.state === "rejected") return audit.result;
  if (audit.result.state !== "applied") {
    throw new Error(
      `command ${request.commandId} recorded outcome ${audit.result.state}; only applied commands are journaled`,
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

/** Plan intent is journaled here; runtime activation is a separate offline operation. */
export function executeStorageRelocationCommand(
  dependencies: Pick<CommandKernelDependencies, "authority" | "clock" | "ids" | "storageRelocationPlans">,
  input: unknown,
): CommandResult {
  const plans = dependencies.storageRelocationPlans;
  if (plans === undefined) throw new Error("storage-relocation-plan: producer unavailable");
  const request = StorageRelocationCommandRequestSchema.parse(input);
  plans.validate(request);
  return dependencies.authority.withAuthorityTransaction((repositories) => {
    const current = plans.project(repositories);
    repositories.commands.assertIdentity(request);
    const existing = repositories.commands.get(request.commandId);
    if (existing !== undefined) {
      if (canonicalJsonStringify(existing) !== canonicalJsonStringify(request)) throw new CommandIdentityConflictError();
      const audit = repositories.commandAudits.findByCommand(request.commandId);
      if (audit === undefined || audit.result.state !== "applied") throw new Error("storage-relocation-plan: replay has no settled audit");
      return audit.result;
    }
    if (repositories.commands.listStorageRelocationCommands().some((previous) => previous.payload.writeId === request.payload.writeId)) {
      throw new Error("storage-relocation-plan: write id reused");
    }
    if (request.target.expectedRevision !== current.revision) return CommandResultSchema.parse({
      state: "conflict", commandId: request.commandId, currentVersion: current.revision,
      message: "storage relocation plan revision changed; reread before saving",
    });
    if (request.type === "cancel-storage-relocation"
      && (current.pending === null || current.pending.commandId !== request.payload.cancelledPlanCommandId
        || current.pending.desiredDigest !== request.payload.cancelledPlanDigest)) {
      throw new Error("storage-relocation-plan: cancel does not match current plan");
    }
    const nextRevision = current.revision + 1;
    const target = { family: "storage-relocation", revision: nextRevision };
    const result = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [target] });
    const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
    repositories.commands.insert(request);
    repositories.commandAudits.insert({ auditId: dependencies.ids.uuid(), request, result, completedAt: now,
      versionChanges: [{ target, before: current.revision, after: nextRevision }], affectedDependencyIds: [] });
    return result;
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

export function createCommandKernel(dependencies: CommandKernelDependencies): CommandKernel {
  // Validated ONCE at composition: a dependency satisfying both seams is a
  // wiring ambiguity, refused before any command can reach it.
  const pool = dependencies.workerRuntime.pool;
  // Serialize the entire per-workflow pool request across admission, process effects and settlement.
  const poolCommandTails = new Map<string, Promise<void>>();
  const withPoolCommandSerialization = async (
    key: string,
    work: () => Promise<CommandResult>,
  ): Promise<CommandResult> => {
    const previous = poolCommandTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    poolCommandTails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      return await work();
    } finally {
      if (poolCommandTails.get(key) === current) poolCommandTails.delete(key);
      release();
    }
  };
  const executeSync = (request: CommandRequest, parentCommandId?: string): CommandResult => {
      if (parentCommandId !== undefined && request.family !== "run") throw new Error("command-group children must be run commands");
      if (request.family === "settings") return executeSettingsCommand(dependencies, request);
      if (request.family === "storage-relocation") {
        if (dependencies.storageRelocationPlans === undefined) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "capability-unavailable",
          message: "storage relocation plan reader is unavailable",
        });
        return executeStorageRelocationCommand(dependencies, request);
      }
      if (DEFERRED_ARM_KEYS.has(`${request.family}/${request.type}`)) {
        // Computed purely: no journal row, no audit row, no generation advance.
        return CommandResultSchema.parse({
          state: "rejected",
          commandId: request.commandId,
          code: "capability-unavailable",
          message: `${request.family}/${request.type} is schema-recognized but its owning later milestone `
            + "has not activated it; no authority state was changed",
        });
      }
      let rollback: (() => void) | undefined;
      let commit: (() => void) | undefined;
      try {
        const result = dependencies.authority.withAuthorityTransaction((repositories) => {
          repositories.commands.assertIdentity(request, parentCommandId);
          const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
          const journalRequest = request;
          const journal = repositories.commands.insert(journalRequest, parentCommandId);
          if (journal.state === "existing") return replay(dependencies, repositories, request, now);
          const auditId = dependencies.ids.uuid();
          const application = dispatchActive(dependencies, repositories, request, now, auditId);
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
        if (error instanceof CommandIdentityConflictError) return CommandResultSchema.parse({
          state: "rejected", commandId: request.commandId, code: "command-divergent", message: error.message,
        });
        if (error instanceof PreflightAdmissionRefusal) return CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "capability-unavailable", message: error.message });
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
  };
  return Object.freeze({
    assistantManifest() {
      const entries: z.infer<typeof AssistantActionManifestSchema>["entries"] = [];
      for (const family of COMMAND_FAMILY_REGISTRY) {
        if (family.family === "worker-browser" && dependencies.assistantRevalidate !== undefined) entries.push({
          family: family.family, action: "spawn-worker", classification: COMMAND_EFFECT_BY_ACTION["spawn-worker"], subject: "none",
        });
        if (family.family !== "notification" && family.family !== "workflow-batch" && family.family !== "settings") continue;
        for (const action of family.actions) {
          if (DEFERRED_ARM_KEYS.has(`${family.family}/${action}`) || action === "apply-protected-settings"
            || (family.family === "settings" && dependencies.settings === undefined)) continue;
          entries.push({ family: family.family, action, classification: COMMAND_EFFECT_BY_ACTION[action], subject: "none" });
        }
      }
      return AssistantActionManifestSchema.parse({ revision: 1, entries });
    },
    execute(input: unknown, parentCommandId?: string): CommandResult {
      const request = CommandRequestSchema.parse(input);
      dependencies.assistantRevalidate?.(request);
  if (Buffer.byteLength(JSON.stringify(request)) > 256 * 1024) throw new Error("command-envelope-size-exceeded");
      if (request.family === "failure-resolution" && (dependencies.failureResolution?.capability ?? failureResolutionCapability)().state === "unavailable") {
        return {state:"rejected",commandId:request.commandId,code:"capability-unavailable",message:"Failure resolution is not available in this build."};
      }
      return executeSync(request, parentCommandId);
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
        return await withPoolCommandSerialization(
          workerPoolSerializationKey(request),
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
