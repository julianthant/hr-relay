/**
 * The ONE command kernel — D113 (doc 03 §Phase-1f authority, §2.4; doc 10 §3.9).
 *
 * Every control surface — dashboard, CLI, gate resolvers, recovery — mutates
 * authority through exactly this dispatcher. It is exhaustive over D95's nine
 * family/action shells: Phase-1f activates start-run, the worker/browser arms,
 * run retry/cancel/bump/rename/hide/unhide plus typed write resolution, and
 * gate resolution. Every later arm stays schema-recognized and returns
 * `rejected{code:"capability-unavailable"}` computed with ZERO authority side
 * effects — no journal row, no audit row, no generation advance.
 *
 * **Atomicity model.** An active command runs in ONE outer authority
 * transaction: journal insert, arm effects, and the audit record commit
 * together or not at all. A typed refusal (`rejected`/`conflict`) is raised as
 * a `CommandRefusal`, which unwinds the whole transaction — doc 03's Phase-1f
 * ratification is explicit that drift, expiry, a spent plan, target lookup
 * failure, or a run-insert failure "rolls back plan consumption, command
 * application, supersession, and every proposed run" — and the typed result is
 * returned to the caller with no partial state. Replay of a journaled command
 * returns the recorded result; a same-id different-content replay fails loud.
 *
 * CAS is enforced only for the real race families (cancel-tree, gate
 * resolution, write recovery; edit-vs-resume is a later arm). Every other arm
 * retains the observed version for audit but validates CURRENT authority
 * instead of rejecting on version drift alone.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../base/workflow.js";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import {
  COMMAND_FAMILY_REGISTRY,
  CommandRequestSchema,
  CommandResultSchema,
  type CommandRequest,
  type CommandResult,
} from "../domain/commands.js";
import { deriveTraceId, type IdFactory } from "../domain/identifiers.js";
import { FingerprintSchema, IsoInstantSchema, WorkerIdSchema } from "../domain/ids.js";
import { deepFreeze } from "../domain/immutability.js";
import { isTerminalRunState, runClaim, RunRecordSchema, type RunRecord } from "../domain/run/record.js";
import { RunCheckpointRecordSchema } from "../domain/workflow/checkpoint.js";
import { applyCheckpointPatches } from "./checkpoint-patch.js";
import { isLiveWorker } from "../domain/run/worker.js";
import { deriveSchemaHash, SchemaBoundCanonicalValueSchema } from "../domain/schema-bound-value.js";
import type { WriteIntentRecord } from "../domain/write-safety.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";

/* ── the Phase-1f arm partition (doc 03 §Phase-1f authority) ─────────────── */

const PHASE1_ACTIVE = {
  start: ["start-run"],
  "worker-browser": [
    "plan-worker-count",
    "spawn-worker",
    "stop-worker",
    "pause-worker",
    "resume-worker",
    "refresh-browser",
    "reopen-browser",
  ],
  run: [
    "retry",
    "cancel",
    "bump",
    "rename",
    "hide",
    "unhide",
    "resolve-write-present",
    "resolve-write-absent",
    "edit-checkpoint",
  ],
  gate: ["resolve-gate"],
  // D167: the durable capture core — sessions, photo mutations, and the
  // stable-keyed finalize outbox.
  capture: [
    "capture-upload",
    "capture-replace",
    "capture-reorder",
    "capture-delete",
    "capture-finalize",
    "capture-retry-finalize",
    "capture-discard",
  ],
} as const;

const PHASE1_DEFERRED = {
  intake: [
    "inspect-intake",
    "confirm-intake-mapping",
    "correct-intake-row",
    "exclude-intake-row",
    "validate-intake",
    "enqueue-intake-manifest",
  ],
  settings: ["apply-settings"],
  "version-archive": ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"],
  run: [],
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  capture: [],
} as const;

export const PHASE1_ACTIVE_COMMAND_ARMS = deepFreeze(PHASE1_ACTIVE);
export const PHASE1_DEFERRED_COMMAND_ARMS = deepFreeze(PHASE1_DEFERRED);

function armActions(partition: Readonly<Record<string, readonly string[]>>, family: string): readonly string[] {
  const actions = Object.hasOwn(partition, family) ? partition[family] : undefined;
  if (actions === undefined) return [];
  return actions;
}

/* The partition must cover D95 exactly, in both directions, before any command
 * can dispatch. A family/action the registry knows but neither list carries —
 * or one both carry — is a contract bug, not a runtime state. */
for (const { family, actions } of COMMAND_FAMILY_REGISTRY) {
  const active = armActions(PHASE1_ACTIVE, family);
  const deferred = armActions(PHASE1_DEFERRED, family);
  const combined = [...active, ...deferred];
  if (combined.length !== actions.length
    || new Set(combined).size !== combined.length
    || actions.some((action) => !combined.includes(action))) {
    throw new Error(`D113 command arm partition does not cover family ${family} exactly`);
  }
}

const DEFERRED_ARM_KEYS: ReadonlySet<string> = new Set(
  Object.entries(PHASE1_DEFERRED).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── injected seams ──────────────────────────────────────────────────────── */

export interface CommandAuthority {
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface WorkflowDescriptorResolver {
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
}

/**
 * The doc 09 §4.1 seam. The kernel owns everything up to it — command schema,
 * idempotency, run CAS, the parked-write state, and the intent-generation lock
 * — and the write sequencer owns the intent/attempt/outbox/run mutations
 * behind it (beat ⑦ for confirmed-present; retryable + evidence for
 * confirmed-absent). It executes INSIDE the kernel's authority transaction and
 * must return the updated run; a throw unwinds the whole command.
 */
type RunCommand = Extract<CommandRequest, { family: "run" }>;
type RunBasicCommand = Extract<RunCommand, { type: "retry" | "cancel" | "bump" | "hide" | "unhide" }>;
type RunEditCheckpointCommand = Extract<RunCommand, { type: "edit-checkpoint" }>;
type CaptureCommand = Extract<CommandRequest, { family: "capture" }>;
type RunRenameCommand = Extract<RunCommand, { type: "rename" }>;
type WriteResolutionCommand = Extract<RunCommand, { type: "resolve-write-present" | "resolve-write-absent" }>;

export interface WriteResolutionContext {
  readonly command: WriteResolutionCommand;
  readonly run: RunRecord;
  readonly intent: WriteIntentRecord;
  readonly now: string;
}

export const WriteResolutionOutcomeSchema = z.strictObject({ run: RunRecordSchema });

export interface WriteResolutionExecutor {
  resolvePresent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown;
  resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown;
}

/**
 * The worker/browser process seam. Worker leases and their durable directives
 * are authority the kernel writes directly; launching a worker process,
 * reconciling a planned worker count, and refreshing/reopening a live
 * worker-owned browser session are process effects the supervisor owns. The
 * kernel validates the target against authority first, and a thrown executor
 * error unwinds the command.
 */
export interface WorkerRuntimeContext {
  readonly command: Extract<CommandRequest, { family: "worker-browser" }>;
  readonly now: string;
}

export const WorkerRuntimeAcknowledgementSchema = z.strictObject({ state: z.literal("accepted") });

export const WorkerPlanAcknowledgementSchema = z.strictObject({
  state: z.literal("accepted"),
  /** The exact worker ids the plan reconciles toward; never an empty guess. */
  workerIds: z.array(WorkerIdSchema).min(1),
});

export interface WorkerRuntimeExecutor {
  planWorkerCount(context: WorkerRuntimeContext): unknown;
  spawnWorker(context: WorkerRuntimeContext): unknown;
  refreshBrowser(context: WorkerRuntimeContext): unknown;
  reopenBrowser(context: WorkerRuntimeContext): unknown;
}

export interface CommandKernelDependencies {
  readonly authority: CommandAuthority;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly writeResolution: WriteResolutionExecutor;
  readonly workerRuntime: WorkerRuntimeExecutor;
}

export interface CommandKernel {
  execute(input: unknown): CommandResult;
}

/* ── internals ───────────────────────────────────────────────────────────── */

/**
 * A typed non-applied outcome. Throwing it unwinds the authority transaction —
 * every partial arm effect rolls back — while the caller still receives the
 * exact typed result instead of an exception.
 */
class CommandRefusal extends Error {
  readonly result: CommandResult;

  constructor(result: unknown) {
    const parsed = CommandResultSchema.parse(result);
    if (parsed.state !== "conflict" && parsed.state !== "rejected") {
      throw new Error("a command refusal cannot carry an applied result");
    }
    super(`command ${parsed.commandId} ${parsed.state}: ${parsed.message}`);
    this.name = "CommandRefusal";
    this.result = parsed;
  }
}

/** Built loosely, then proven strict by the `CommandResultSchema`/audit parses. */
type TargetReference = Readonly<Record<string, unknown>>;

interface VersionChange {
  readonly target: TargetReference;
  readonly before: number;
  readonly after: number;
}

interface CommandApplication {
  readonly result: CommandResult;
  readonly versionChanges: readonly VersionChange[];
  readonly affectedDependencyIds: readonly string[];
}

function runTarget(runId: string): TargetReference {
  return { family: "run", runId };
}

function workerTarget(workerId: string): TargetReference {
  return { family: "worker-browser", workerId };
}

function reject(request: CommandRequest, code: string, message: string): never {
  throw new CommandRefusal({ state: "rejected", commandId: request.commandId, code, message });
}

function conflict(request: CommandRequest, currentVersion: number, message: string): never {
  throw new CommandRefusal({ state: "conflict", commandId: request.commandId, currentVersion, message });
}

function applied(
  request: CommandRequest,
  affectedTargets: readonly TargetReference[],
  versionChanges: readonly VersionChange[],
  affectedDependencyIds: readonly string[] = [],
): CommandApplication {
  return Object.freeze({
    result: CommandResultSchema.parse({
      state: "applied",
      commandId: request.commandId,
      affectedTargets,
    }),
    versionChanges,
    affectedDependencyIds,
  });
}

export function deriveGateResultCheckpointFingerprint(result: unknown): string {
  const parsed = SchemaBoundCanonicalValueSchema.parse(result);
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:gate-result-checkpoint:v1\0")
    .update(canonicalJsonStringify(parsed))
    .digest("hex"));
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
  const run = repositories.runs.get(runId);
  if (run === undefined) reject(request, "target-not-found", `run ${runId} does not exist`);
  return run;
}

function requireApplied(outcome: { state: string }, what: string): void {
  if (outcome.state !== "applied") {
    throw new Error(`${what} unexpectedly reported ${outcome.state} inside an exclusive authority transaction`);
  }
}

function activeRunsForItem(
  repositories: AuthorityRepositories,
  workflowId: string,
  itemId: string,
): readonly RunRecord[] {
  return repositories.runs
    .listByItem({ workflow: workflowId, itemId })
    .filter((run) => !isTerminalRunState(run.lifecycle));
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

  for (const planned of plan.planned) {
    // An authority read error here aborts the whole command — never "continue
    // and enqueue anyway" (doc 03 §2.4 Enqueue).
    const active = activeRunsForItem(repositories, plan.workflowId, planned.itemId);
    if (descriptor.enqueue === "reject-active" && active.length > 0) {
      reject(
        request,
        "policy-refused",
        `${plan.workflowId} item ${planned.itemId} (${planned.matchKey}) already has an active run `
        + `(${active[0].envelope.traceId}); nothing from plan ${plan.startPlanId} was started`,
      );
    }
    if (descriptor.enqueue === "supersede-active") {
      for (const activeRun of active) {
        const outcome = repositories.runs.transition({
          runId: activeRun.envelope.runId,
          expectedVersion: activeRun.version,
          lifecycle: { state: "terminal", outcome: "superseded", endedAt: now },
          now,
        });
        requireApplied(outcome, `superseding run ${activeRun.envelope.runId}`);
        affectedTargets.push(runTarget(activeRun.envelope.runId));
        versionChanges.push({
          target: runTarget(activeRun.envelope.runId),
          before: activeRun.version,
          after: activeRun.version + 1,
        });
      }
    }

    const record = RunRecordSchema.parse({
      envelope: {
        runId: planned.runId,
        workflow: plan.workflowId,
        itemId: planned.itemId,
        traceId: planned.traceId,
        descriptorVersion: plan.descriptorVersion,
        contractFingerprint: plan.descriptorFingerprint,
        ...(plan.requestedInstance === undefined ? {} : { requestedInstance: plan.requestedInstance }),
        resolvedInstance: plan.resolvedInstance,
        configFingerprint: plan.configFingerprint,
        configSnapshotId: plan.configSnapshotId,
        shape: plan.shape,
        priority: plan.priority,
        dryRun: plan.dryRun,
        attempt: 1,
        enqueuedAt: now,
      },
      input: {
        raw: planned.rawInput,
        parsed: planned.input,
        ingressSchemaHash: plan.ingressSchemaHash,
      },
      lifecycle: { state: "queued" },
      claimGeneration: 0,
      hidden: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const inserted = repositories.runs.enqueue(record);
    if (inserted.state !== "inserted") {
      throw new Error(
        `start plan ${plan.startPlanId} proposed run id ${planned.runId}, which already exists; refusing to adopt it`,
      );
    }
    affectedTargets.push(runTarget(planned.runId));
  }

  return applied(request, affectedTargets, versionChanges);
}

function executeRetry(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  now: string,
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

  const runId = dependencies.ids.uuid();
  const record = RunRecordSchema.parse({
    envelope: {
      runId,
      workflow: current.envelope.workflow,
      itemId: current.envelope.itemId,
      traceId: deriveTraceId(descriptor.code, runId, dependencies.clock),
      descriptorVersion: current.envelope.descriptorVersion,
      contractFingerprint: current.envelope.contractFingerprint,
      ...(current.envelope.requestedInstance === undefined
        ? {}
        : { requestedInstance: current.envelope.requestedInstance }),
      resolvedInstance: current.envelope.resolvedInstance,
      configFingerprint: current.envelope.configFingerprint,
      configSnapshotId: current.envelope.configSnapshotId,
      shape: current.envelope.shape,
      priority: current.envelope.priority,
      dryRun: current.envelope.dryRun,
      retryOf: current.envelope.runId,
      attempt: 1,
      enqueuedAt: now,
    },
    // Immutable parsed input and its exact raw/schema identities are reused;
    // Edit Data is a different, later arm on purpose.
    input: current.input,
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    hidden: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const inserted = repositories.runs.enqueue(record);
  if (inserted.state !== "inserted") {
    throw new Error(`retry of ${request.target.runId} minted run id ${runId}, which already exists`);
  }
  return applied(request, [runTarget(runId), runTarget(request.target.runId)], []);
}

interface CancelTarget {
  readonly run: RunRecord;
  readonly dependencyId?: string;
}

function executeCancel(
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

  // The tree comes from authority alone. A child whose delegation edge cannot
  // be resolved makes the tree inconsistent, and an inconsistent tree cancels
  // NOTHING — the whole transaction unwinds (doc 03 §2.4 Cancel).
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

  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  for (const target of targets) {
    const outcome = repositories.runs.transition({
      runId: target.run.envelope.runId,
      expectedVersion: target.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
      now,
    });
    requireApplied(outcome, `cancelling run ${target.run.envelope.runId}`);
    affectedTargets.push(runTarget(target.run.envelope.runId));
    versionChanges.push({
      target: runTarget(target.run.envelope.runId),
      before: target.run.version,
      after: target.run.version + 1,
    });
  }
  return applied(request, affectedTargets, versionChanges, dependencyIds);
}

function executeBump(
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
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
  const outcome = repositories.runs.bumpPriority({
    runId: request.target.runId,
    expectedVersion: current.version,
    now,
  });
  requireApplied(outcome, `bumping run ${request.target.runId}`);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}

/**
 * Doc 06 §6 (D166): the Edit-Data save. Fail-closed by construction — an
 * unknown or raced state rejects; the resume claim is the fence and the
 * resume WINS; every patch path must be descriptor-allowlisted; and the
 * whole post-patch output must re-parse through the producing contract's
 * full output schema BEFORE anything durable moves. The accepted patches
 * ride `envelope.injected` and become authority only when a resume replays
 * the checkpoint through the same applier.
 */
function executeEditCheckpoint(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunEditCheckpointCommand,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} moved to version ${String(current.version)} while you were editing `
      + `(you loaded ${String(request.target.expectedVersion)}); your edit was not applied — reload the current state`,
    );
  }
  if (runClaim(current) !== undefined) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} resumed while you were editing — your edit was not applied; `
      + "reload the current state",
    );
  }
  if (current.lifecycle.state !== "queued" && current.lifecycle.state !== "parked-gate") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; checkpoint corrections apply only to a `
      + "non-executing resumable run — a running task's checkpoints are being written, and a done run is history",
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);

  const editData = descriptor.capabilities?.editData;
  if (editData === undefined || typeof editData === "boolean") {
    reject(
      request,
      "policy-refused",
      `workflow ${current.envelope.workflow} declares no editable checkpoint fields; the default is `
      + "read-only, never all checkpoint JSON",
    );
  }
  const declared = new Set(editData.fields.map((field) => `${String(field.nodeId)}\0${field.fieldPath}`));
  for (const patch of request.payload.patches) {
    if (!declared.has(`${String(patch.nodeId)}\0${patch.fieldPath}`)) {
      reject(
        request,
        "policy-refused",
        `field ${String(patch.nodeId)}.${patch.fieldPath} is not descriptor-allowlisted for correction`,
      );
    }
  }

  // Prove every patched output re-parses BEFORE anything durable moves.
  const nodes = descriptorRuntimeNodes(descriptor);
  const byNode = new Map<string, typeof request.payload.patches[number][]>();
  for (const patch of request.payload.patches) {
    const existing = byNode.get(String(patch.nodeId));
    if (existing === undefined) byNode.set(String(patch.nodeId), [patch]);
    else existing.push(patch);
  }
  for (const [nodeId, nodePatches] of byNode) {
    const node = nodes.find((candidate) => String(candidate.id) === nodeId);
    if (node === undefined || node.kind !== "task") {
      reject(request, "policy-refused", `node "${nodeId}" is not a correctable task node`);
    }
    const stored = repositories.runCheckpoints.latest(
      current.envelope.workflow,
      current.envelope.itemId,
      nodeId,
    );
    if (stored === undefined) {
      reject(
        request,
        "invalid-state",
        `node "${nodeId}" has no stored checkpoint to correct; a correction supersedes a recorded fact`,
      );
    }
    try {
      applyCheckpointPatches({
        replayed: RunCheckpointRecordSchema.parse(stored),
        patches: nodePatches,
        outputSchema: node.uses.output,
        attempt: current.envelope.attempt,
        runId: current.envelope.runId,
        writtenAt: now,
      });
    } catch (error) {
      reject(
        request,
        "schema-mismatch",
        `the corrected output for node "${nodeId}" does not satisfy the producing contract's schema: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const outcome = repositories.runs.injectCheckpointPatches({
    runId: request.target.runId,
    expectedVersion: current.version,
    patches: request.payload.patches,
    now,
  });
  requireApplied(outcome, `injecting checkpoint corrections into run ${request.target.runId}`);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}

function captureTarget(captureSessionId: string): TargetReference {
  return { family: "capture", captureSessionId };
}

/**
 * Doc 06 §5.1 (D167): the durable capture arms. Every mutation validates the
 * requested refs and state against CURRENT authority — version drift alone
 * is never a CAS conflict, and an inapplicable command rejects by name.
 * Exact phone retries converge through the journal's commandId dedupe;
 * content-level no-ops (the same photo again, the same order again) apply
 * without minting a new version. Only `finalized|discarded|expired` are
 * terminal; `failed` is durable and recoverable through retry-finalize,
 * which mints the NEXT finalization generation over the SAME photo set.
 */
function executeCapture(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CaptureCommand,
  now: string,
): CommandApplication {
  const sessionId = request.target.captureSessionId;
  const current = repositories.captureSessions.get(sessionId);
  if (current === undefined) reject(request, "target-not-found", `capture session ${sessionId} does not exist`);
  const target = captureTarget(sessionId);
  const applyUpdate = (next: unknown): CommandApplication => {
    const updated = repositories.captureSessions.update(next);
    return applied(request, [target], [{
      target,
      before: current.version,
      after: updated.version,
    }]);
  };
  const noOp = (): CommandApplication => applied(request, [target], []);
  const requireState = (allowed: readonly string[], what: string): void => {
    if (!allowed.includes(current.state)) {
      reject(
        request,
        "invalid-state",
        `capture session ${sessionId} is ${current.state}; ${what} applies only to a ${allowed.join("/")} session`,
      );
    }
  };

  switch (request.type) {
    case "capture-upload": {
      requireState(["open"], "uploading a photo");
      const existing = current.photoRefs.find((photo) => String(photo.photoId) === String(request.payload.photoId));
      if (existing !== undefined) {
        if (existing.artifact.sha256 === request.payload.artifact.sha256) return noOp();
        reject(
          request,
          "invalid-state",
          `photo ${String(request.payload.photoId)} already exists with different bytes; `
          + "capture-replace is the arm for changing a photo",
        );
      }
      return applyUpdate({
        ...current,
        photoRefs: [...current.photoRefs, {
          photoId: request.payload.photoId,
          artifact: request.payload.artifact,
          ordinal: current.photoRefs.length + 1,
          originalMediaType: request.payload.originalMediaType,
        }],
        version: current.version + 1,
      });
    }
    case "capture-replace": {
      requireState(["open"], "replacing a photo");
      const existing = current.photoRefs.find((photo) => String(photo.photoId) === String(request.payload.photoId));
      if (existing === undefined) {
        reject(request, "invalid-state", `photo ${String(request.payload.photoId)} does not exist; nothing to replace`);
      }
      if (existing.artifact.sha256 === request.payload.artifact.sha256) return noOp();
      return applyUpdate({
        ...current,
        photoRefs: current.photoRefs.map((photo) =>
          String(photo.photoId) === String(request.payload.photoId)
            ? { ...photo, artifact: request.payload.artifact, originalMediaType: request.payload.originalMediaType }
            : photo),
        version: current.version + 1,
      });
    }
    case "capture-reorder": {
      requireState(["open"], "reordering photos");
      const requested = request.payload.orderedPhotoIds.map((photoId) => String(photoId));
      const held = current.photoRefs.map((photo) => String(photo.photoId));
      if (requested.length !== held.length || new Set(requested).size !== requested.length
        || !held.every((photoId) => requested.includes(photoId))) {
        reject(
          request,
          "invalid-state",
          `the reorder names ${String(requested.length)} photos but the session holds `
          + `${String(held.length)}; a reorder must be an exact permutation`,
        );
      }
      const currentOrder = [...current.photoRefs].sort((a, b) => a.ordinal - b.ordinal)
        .map((photo) => String(photo.photoId));
      if (currentOrder.join("\0") === requested.join("\0")) return noOp();
      return applyUpdate({
        ...current,
        photoRefs: current.photoRefs.map((photo) => ({
          ...photo,
          ordinal: requested.indexOf(String(photo.photoId)) + 1,
        })),
        version: current.version + 1,
      });
    }
    case "capture-delete": {
      requireState(["open"], "deleting a photo");
      const existing = current.photoRefs.find((photo) => String(photo.photoId) === String(request.payload.photoId));
      if (existing === undefined) {
        reject(request, "invalid-state", `photo ${String(request.payload.photoId)} does not exist; nothing to delete`);
      }
      const remaining = [...current.photoRefs]
        .filter((photo) => String(photo.photoId) !== String(request.payload.photoId))
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((photo, index) => ({ ...photo, ordinal: index + 1 }));
      return applyUpdate({ ...current, photoRefs: remaining, version: current.version + 1 });
    }
    case "capture-finalize":
    case "capture-retry-finalize": {
      requireState(
        request.type === "capture-finalize" ? ["open"] : ["failed"],
        request.type === "capture-finalize" ? "finalizing" : "retrying finalization",
      );
      if (current.photoRefs.length === 0) {
        reject(request, "invalid-state", `capture session ${sessionId} holds no photos; there is nothing to finalize`);
      }
      const generation = current.finalizationGeneration + 1;
      const ordered = [...current.photoRefs].sort((a, b) => a.ordinal - b.ordinal);
      const stableKey = FingerprintSchema.parse(createHash("sha256")
        .update("hrauto:capture-finalization:v1\0")
        .update(canonicalJsonStringify({
          sessionId,
          generation,
          photos: ordered.map((photo) => photo.artifact.sha256),
        }))
        .digest("hex"));
      const existingOutbox = repositories.captureFinalizationOutboxes.getByStableKey(stableKey);
      if (existingOutbox === undefined) {
        repositories.captureFinalizationOutboxes.insert({
          outboxId: dependencies.ids.uuid(),
          sessionId,
          generation,
          stableKey,
          orderedPhotoArtifacts: ordered.map((photo) => photo.artifact),
          workflow: current.workflow,
          ...(current.formType === undefined ? {} : { formType: current.formType }),
          state: "pending",
          createdAt: now,
        });
      }
      return applyUpdate({
        ...current,
        state: "finalizing",
        handoff: { state: "pending" },
        finalizationGeneration: generation,
        version: current.version + 1,
      });
    }
    case "capture-discard": {
      requireState(["open", "failed"], "discarding");
      return applyUpdate({ ...current, state: "discarded", version: current.version + 1 });
    }
  }
}

function executePresentation(
  repositories: AuthorityRepositories,
  request: RunBasicCommand | RunRenameCommand,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  const outcome = repositories.runs.updatePresentation({
    runId: request.target.runId,
    expectedVersion: current.version,
    ...(request.type === "rename"
      ? { displayName: request.payload.displayName }
      : { hidden: request.type === "hide" }),
    now,
  });
  requireApplied(outcome, `${request.type} on run ${request.target.runId}`);
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
  if (intent.status !== "attempting" && intent.status !== "parked") {
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

  const context: WriteResolutionContext = Object.freeze({ command: request, run: current, intent, now });
  const raw = request.type === "resolve-write-present"
    ? dependencies.writeResolution.resolvePresent(repositories, context)
    : dependencies.writeResolution.resolveAbsent(repositories, context);
  const outcome = WriteResolutionOutcomeSchema.parse(raw);
  if (outcome.run.envelope.runId !== request.target.runId) {
    throw new Error(
      `write resolution for run ${request.target.runId} returned run ${outcome.run.envelope.runId}; `
      + "the executor resolved a different target",
    );
  }
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: outcome.run.version,
  }]);
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
  const result = { schemaHash: expectedSchemaHash, value: parsedValue.data };
  const stored = repositories.gateResults.insert({
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
  const resumed = repositories.runs.resume({
    runId: request.target.runId,
    expectedVersion: current.version,
    startAt: current.lifecycle.resumeAt,
    now,
  });
  requireApplied(resumed, `resuming run ${request.target.runId} after gate ${request.target.gateId}`);
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

function executeWorkerBrowser(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "worker-browser" }>,
  now: string,
): CommandApplication {
  const context: WorkerRuntimeContext = Object.freeze({ command: request, now });
  switch (request.type) {
    case "plan-worker-count": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      const acknowledgement = WorkerPlanAcknowledgementSchema.parse(
        dependencies.workerRuntime.planWorkerCount(context),
      );
      return applied(
        request,
        acknowledgement.workerIds.map((workerId) => workerTarget(workerId)),
        [],
      );
    }
    case "spawn-worker": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      const existing = repositories.workerLeases.get(request.payload.workerId);
      if (existing !== undefined && isLiveWorker(existing)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.payload.workerId} already holds a live lease in state ${existing.lifecycle.state}; `
          + "a second process may not answer to the same worker id",
        );
      }
      WorkerRuntimeAcknowledgementSchema.parse(dependencies.workerRuntime.spawnWorker(context));
      return applied(request, [workerTarget(request.payload.workerId)], []);
    }
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
      const directive = request.type === "stop-worker" ? "stop" : request.type === "pause-worker" ? "pause" : "run";
      const outcome = repositories.workerLeases.control({
        workerId: request.target.workerId,
        expectedVersion: lease.version,
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
      const acknowledgement = request.type === "refresh-browser"
        ? dependencies.workerRuntime.refreshBrowser(context)
        : dependencies.workerRuntime.reopenBrowser(context);
      WorkerRuntimeAcknowledgementSchema.parse(acknowledgement);
      return applied(request, [workerTarget(request.target.workerId)], []);
    }
  }
}

/* ── dispatch, journal, and replay ───────────────────────────────────────── */

function dispatchActive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
): CommandApplication {
  switch (request.family) {
    case "start":
      return executeStartRun(dependencies, repositories, request, now);
    case "worker-browser":
      return executeWorkerBrowser(dependencies, repositories, request, now);
    case "gate":
      return executeResolveGate(dependencies, repositories, request, now);
    case "run": {
      switch (request.type) {
        case "retry": return executeRetry(dependencies, repositories, request, now);
        case "cancel": return executeCancel(repositories, request, now);
        case "bump": return executeBump(repositories, request, now);
        case "rename":
        case "hide":
        case "unhide":
          return executePresentation(repositories, request, now);
        case "resolve-write-present":
        case "resolve-write-absent":
          return executeWriteResolution(dependencies, repositories, request, now);
        case "edit-checkpoint":
          return executeEditCheckpoint(dependencies, repositories, request, now);
      }
      break;
    }
    case "capture":
      return executeCapture(dependencies, repositories, request, now);
    case "intake":
    case "settings":
    case "version-archive":
    case "notification":
      throw new Error(`${request.family}/${request.type} is deferred and must have been rejected before dispatch`);
  }
  throw new Error("command dispatch fell through an exhaustive family/action switch");
}

function replay(
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
  if (audit.result.state !== "applied") {
    throw new Error(
      `command ${request.commandId} recorded outcome ${audit.result.state}; only applied commands are journaled`,
    );
  }
  if (request.family === "start") {
    // D109: the recorded result is returned only after every binding has
    // revalidated against the pre-consume revision the confirmation carried.
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
  return CommandResultSchema.parse({
    state: "already-applied",
    commandId: request.commandId,
    affectedTargets: audit.result.affectedTargets,
  });
}

export function createCommandKernel(dependencies: CommandKernelDependencies): CommandKernel {
  return Object.freeze({
    execute(input: unknown): CommandResult {
      const request = CommandRequestSchema.parse(input);
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
      try {
        return dependencies.authority.withAuthorityTransaction((repositories) => {
          const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
          const journal = repositories.commands.insert(request);
          if (journal.state === "existing") return replay(repositories, request, now);
          const application = dispatchActive(dependencies, repositories, request, now);
          repositories.commandAudits.insert({
            auditId: dependencies.ids.uuid(),
            request,
            result: application.result,
            completedAt: now,
            versionChanges: application.versionChanges,
            affectedDependencyIds: application.affectedDependencyIds,
          });
          return application.result;
        });
      } catch (error) {
        // A typed refusal already unwound the transaction — every partial arm
        // effect, the journal row included, rolled back. Anything else stays a
        // thrown structured error; the kernel never converts an unknown
        // failure into a plausible typed result.
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
    },
  });
}
