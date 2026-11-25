import type { RunExistence, RunRecordRefusal } from "../../../models/config/authority.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import type { RelatedRunChange, RunMutationOutcome } from "../lifecycle/run-record-service.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { conflict, reject } from "./command-refusal.js";

export interface WorkflowDescriptorResolver {
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
}


export type RunCommand = Extract<CommandRequest, { family: "run" }>;

export function resolveDescriptorOrReject(
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

export function requireDescriptorMatchesEnvelope(
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

export function requireRun(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  runId: string,
): RunRecord {
  if (repositories.deletedRuns.get(runId) !== undefined) reject(request, "target-deleted", "run was deleted");
  const run = repositories.runs.get(runId);
  if (run === undefined) reject(request, "target-not-found", `run ${runId} does not exist`);
  return run;
}



export function lifecycleRefusal(request: CommandRequest, refusal: RunRecordRefusal): never {
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

export function lifecycleRun(request: CommandRequest, outcome: RunMutationOutcome | RunExistence, relatedRunChanges?: RelatedRunChange[]): RunRecord {
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state === "deleted") reject(request, "target-deleted", "run was deleted");
  if (outcome.state === "absent") reject(request, "target-not-found", "run does not exist");
  if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) {
    relatedRunChanges?.push(...outcome.relatedRunChanges ?? []);
    return outcome.run;
  }
  throw new Error(`unexpected operator lifecycle result: ${outcome.state}`);
}
