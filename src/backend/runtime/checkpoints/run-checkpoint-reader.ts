import { RunContinuationRefusedError, continuationEvidenceDigest, validateRunContinuation } from "../../storage/sqlite/run-continuation.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";

/** Fresh executions may resume their own checkpoints, never another run's latest row. */
export function readRunCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints"> & { readonly runs?: Pick<AuthorityRepositories["runs"], "get">; readonly lifecycleJournal?: Pick<AuthorityRepositories["lifecycleJournal"], "findContinuationIssue">; readonly gateResults?: AuthorityRepositories["gateResults"] }, envelope: RunEnvelope, nodeId: string, freshTasks = false) {
  if (envelope.continuation !== undefined) {
    if (repositories.runs === undefined || repositories.gateResults === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
    validateRunContinuation({ ...repositories, runs: repositories.runs, gateResults: repositories.gateResults }, envelope);
    const own = repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter(row => row.runId === envelope.runId).at(-1);
    if (own !== undefined) return own;
    const reference = envelope.continuation.checkpoints.find(row => row.nodeId === nodeId);
    if (reference === undefined) return undefined;
    const row = repositories.runCheckpoints.get(envelope.workflow, envelope.itemId, nodeId, reference.attempt, reference.claimGeneration);
    if (row === undefined || row.runId !== reference.runId || continuationEvidenceDigest(row) !== reference.digest) throw new RunContinuationRefusedError("run-continuation-checkpoint-unavailable");
    return row;
  }
  if (envelope.sourceBound !== undefined || freshTasks && envelope.recovery === "restart-from-start") {
    return repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter((checkpoint) => checkpoint.runId === envelope.runId).at(-1);
  }
  return repositories.runCheckpoints.latest(envelope.workflow, envelope.itemId, nodeId);
}
