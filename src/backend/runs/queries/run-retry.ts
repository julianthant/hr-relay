import type { RunRecord } from "../../../models/run/record.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

export function lookupBatchMemberRetryAvailable(repositories: AuthorityRepositories, run: RunRecord,
  descriptor: AnyWorkflowDescriptor | undefined): boolean {
  if (run.envelope.workflow !== "person-lookup" || run.envelope.parent !== undefined || run.sessionId === undefined
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
