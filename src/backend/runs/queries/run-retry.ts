import type { RunRecord } from "../../../models/run/record.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { authenticateOcrOperator } from "../lifecycle/ocr-review-authority.js";
import { delegationRetryWriteRefusal, childTerminalSettlement } from "../../storage/sqlite/delegation-authority.js";
import { delegationRefreshEligible } from "../../storage/sqlite/delegation-refresh.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting } from "../../../workflow-kit/workflow.js";

export function aggregateMemberRetryAvailable(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">,
  run: RunRecord, resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined): boolean {
  if (run.envelope.parent === undefined || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed"
    || repositories.runs.admission().state !== "open") return false;
  const parent = repositories.runs.get(run.envelope.parent.runId), descriptor = resolve(run.envelope.workflow);
  const owner = parent === undefined ? undefined : resolve(parent.envelope.workflow);
  if (parent === undefined || owner === undefined || descriptor === undefined || parent.cancelRequested === true
    || parent.lifecycle.state === "parked-write" || parent.lifecycle.state === "parked-gate"
    || parent.lifecycle.state === "terminal" && !["done", "failed"].includes(parent.lifecycle.outcome)
    || owner.contractFingerprint !== parent.envelope.contractFingerprint || owner.version !== parent.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint || descriptor.version !== run.envelope.descriptorVersion
    || repositories.runtimeConfig.get()?.configSnapshotId !== run.envelope.configSnapshotId
    || repositories.workerControls.resetForRun(parent.envelope.runId) !== undefined
    || repositories.workerControls.resetForRun(run.envelope.runId) !== undefined) return false;
  const authorization = authorizeWorkflowDelegationRefresh(owner, parent);
  const plan = authorization === undefined ? undefined : workflowDelegationAccounting(authorization, parent);
  if (plan === undefined) return false;
  authenticateOcrOperator(repositories, reader, parent);
  const members = repositories.dependencies.groups(parent.envelope.runId).filter(({ group }) => group.invocation.nodeId === plan.joinNodeId)
    .flatMap(({ group }) => group.children).filter(member => member.child.envelope.runId === run.envelope.runId);
  if (members.length !== 1 || members[0]?.dependency.state !== "failed" || childTerminalSettlement(run, repositories)?.state !== "failed") return false;
  return delegationRetryWriteRefusal(repositories, run, descriptor) === undefined
    && (parent.lifecycle.state !== "terminal" || delegationRefreshEligible(repositories, parent, authorization));
}

export function batchMemberRetryAvailable(repositories: AuthorityRepositories, run: RunRecord,
  descriptor: AnyWorkflowDescriptor | undefined, capabilities?: Readonly<{ retryBatchMembers?: boolean }>): boolean {
  if (capabilities?.retryBatchMembers !== true || run.envelope.parent !== undefined || run.sessionId === undefined
    || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed" || descriptor === undefined
    || descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint || repositories.runs.admission().state !== "open"
    || repositories.workerControls.resetForRun(run.envelope.runId) !== undefined) return false;
  const sourceSnapshot = repositories.configSnapshots.get(run.envelope.configSnapshotId);
  if (sourceSnapshot === undefined || sourceSnapshot.fingerprint !== run.envelope.configFingerprint) throw new Error("run-retry-source-snapshot-mismatch");
  const runtime = repositories.runtimeConfig.get();
  if (runtime === undefined) throw new Error("run-retry-runtime-unavailable");
  const settings = repositories.settingsCurrent.get();
  if (settings !== undefined && (settings.revision !== runtime.settingsRevision || settings.settingsFingerprint !== runtime.settingsFingerprint)) return false;
  const snapshot = repositories.configSnapshots.get(runtime.configSnapshotId);
  if (snapshot === undefined || snapshot.fingerprint !== runtime.configFingerprint) throw new Error("run-retry-runtime-snapshot-mismatch");
  if (descriptor.enqueue === "reject-active" && repositories.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId })
    .some(attempt => attempt.lifecycle.state !== "terminal")) return false;
  const batch = repositories.runSessions.get(run.sessionId);
  if (batch === undefined || batch.workflow !== run.envelope.workflow) throw new Error("run-retry-batch-unavailable");
  return batch.groupInQueue;
}
