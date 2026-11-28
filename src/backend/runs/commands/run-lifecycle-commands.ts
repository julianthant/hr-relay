import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { RunDisplayNameSchema } from "../../../models/run/display-name.js";
import { isTerminalRunState, runClaim, type RunRecord } from "../../../models/run/record.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting, workflowPlanning } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { assertDelegationRetryUnwritten, currentDelegationManifests, retainedDelegationManifests, selectDelegationGroupForChild } from "../../storage/sqlite/delegation-authority.js";
import { RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { activeRunsForItem, requireApplied, runTarget, type TargetReference, type VersionChange } from "../lifecycle/run-fan-out.js";
import { lifecycleCommandId, type RelatedRunChange } from "../lifecycle/run-record-service.js";
import { selectRunRuntime } from "../settings/run-settings.js";
import { protectedSubjectDisplay } from "../start/protected-input.js";
import { RerunRefusedError } from "../start/rerun.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { conflict, reject } from "./command-refusal.js";
import { lifecycleRefusal, lifecycleRun, requireDescriptorMatchesEnvelope, requireRun, resolveDescriptorOrReject, type RunCommand } from "./run-command-context.js";

export type RunBasicCommand = Extract<RunCommand, { type: "retry" | "cancel" | "bump" | "pause" | "resume" }>;

type RunRecoveryCommand = RunBasicCommand;

type RunRenameCommand = Extract<RunCommand, { type: "rename" }>;
type RunDeleteCommand = Extract<RunCommand, { type: "delete" }>;

export function executeRetry(
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

export function executeCancel(
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

export function executeDelete(
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

export function executeBump(
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


/** An empty name after trimming clears the rename; anything else must be a valid display name. */
function trimmedDisplayName(request: RunRenameCommand) {
  const name = request.payload.displayName.trim();
  if (name.length === 0) return null;
  const parsed = RunDisplayNameSchema.safeParse(name);
  if (!parsed.success) reject(request, "invalid-value", parsed.error.issues.map(issue => issue.message).join("; "));
  return parsed.data;
}

export function executePresentation(
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
