import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { RunRecord } from "../../../models/run/record.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { workerPoolVersion } from "../../../models/run/worker-pool.js";
import { workerPoolMember, type WorkerPoolMember } from "../../../models/run/worker-slot.js";
import { type CommandRequest, type CommandResult, CommandResultSchema, type ParkedWriteCheckAcknowledgement, ParkedWriteCheckAcknowledgementSchema, type ParkedWriteCheckTarget, RunCommandRequestSchema } from "../../../rules/commands/commands.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { requireParkedWriteCheckTarget } from "../../runtime/writes/write-recovery.js";
import { WorkerSetupRefusedError } from "../../runtime/workers/worker-pool.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { withCanonicalRunCommandScope } from "../../storage/sqlite/command-record-row.js";
import { authenticateDescendantHome } from "../../storage/sqlite/delegation-authority.js";
import { applyWorkerPoolPlan, WorkerPoolPlanVersionConflict } from "../../storage/sqlite/worker-slots.js";
import { runTarget, type TargetReference, type VersionChange } from "../lifecycle/run-fan-out.js";
import { lifecycleCommandId } from "../lifecycle/run-record-service.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { CommandRefusal, conflict, reject } from "./command-refusal.js";
import { replay } from "./command-replay.js";
import { lifecycleRun, resolveDescriptorOrReject } from "./run-command-context.js";
import { executeCancel, type RunBasicCommand } from "./run-lifecycle-commands.js";

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

function workerTarget(workerId: string): TargetReference {
  return { family: "worker-browser", workerId };
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
  const message = error instanceof WorkerSetupRefusedError ? error.message
    : error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("WORKER_") ? error.code
    : error instanceof WorkerControlRefusal ? error.message : undefined;
  if (message === undefined) return undefined;
  return { result: CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "invalid-state", message }), versionChanges: [], affectedDependencyIds: [] };
}

/**
 * Admission and fences run in one authority transaction, the pool effect runs after it, and the outcome is journaled
 * with its audit in a final transaction. Pause, resume and Reset commit their durable change first and then tell the child.
 */
export async function executeWorkerPoolCommand(
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
        // Retires past the plan ceiling so a historical oversized roster can shrink.
        const retiredPool = repositories.workerPools.retireMember({ workerId: member.workerId, requestedBy: request.requestedBy, now });
        const target = { family: "worker-pool" as const, workflowId: member.workflowId };
        return applied(request, [target, workerTarget(member.workerId)], [{ target, before: retiredPool.version - 1, after: retiredPool.version }]);
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
      const { member, result, releaseClaimHold } = transact(repositories => {
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
        const slot = repositories.workerSlots.get(member.workerId);
        if (slot === undefined) throw new Error("worker-slot-not-found");
        if (!slot.paused) repositories.workerSlots.setPaused({ workerId: member.workerId, paused: true, now });
        return { member, result: auditWorkerCommand(dependencies, repositories, request, reset), releaseClaimHold: !slot.paused };
      });
      try { await pool.stop(member.workerId, "reset"); }
      catch (error) { if (workerEffectRefusal(request, error) === undefined) throw error; return result; }
      // Stop proves the old process exited. Keep any pause that preceded the Reset.
      if (releaseClaimHold) transact(repositories => repositories.workerSlots.setPaused({
        workerId: member.workerId, paused: false, now: dependencies.clock.now().toISOString(),
      }));
      try { await pool.start(member); }
      catch (error) { if (workerEffectRefusal(request, error) === undefined) throw error; }
      return result;
    }
    case "pause-worker":
    case "resume-worker": {
      const paused = request.type === "pause-worker";
      const result = transact(repositories => {
        if (!paused) repositories.runtimeConfig.requireSettingsCurrent();
        const member = requireActiveSlot(repositories, request, request.target.workerId, request.target.workflowId);
        const state = requireMemberFence(pool, request);
        if (!paused && state === "stopping") reject(request, "invalid-state", "WORKER_EXIT_UNOBSERVED");
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

export function workerPoolSerializationKey(request: WorkerBrowserCommand): string {
  return "workflowId" in request.target ? `worker-pool:${request.target.workflowId}` : `worker:${request.target.workerId}`;
}
