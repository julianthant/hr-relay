import { continuationEvidenceDigest, validateRunContinuation } from "./run-continuation.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";

/** Fresh executions may resume their own checkpoints, never another run's latest row. */
export function readRunCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints"> & Partial<Pick<AuthorityRepositories, "runs" | "gateResults">>, envelope: RunEnvelope, nodeId: string, freshTasks = false) {
  if (envelope.continuation !== undefined) {
    if (repositories.runs === undefined || repositories.gateResults === undefined) throw new Error("run-continuation-authority-unavailable");
    validateRunContinuation({ ...repositories, runs: repositories.runs, gateResults: repositories.gateResults }, envelope);
    const own = repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter(row => row.runId === envelope.runId).at(-1);
    if (own !== undefined) return own;
    const reference = envelope.continuation.checkpoints.find(row => row.nodeId === nodeId);
    if (reference === undefined) return undefined;
    const row = repositories.runCheckpoints.get(envelope.workflow, envelope.itemId, nodeId, reference.attempt, reference.claimGeneration);
    if (row === undefined || row.runId !== reference.runId || continuationEvidenceDigest(row) !== reference.digest) throw new Error("run-continuation-checkpoint-unavailable");
    return row;
  }
  if (envelope.sourceBound !== undefined || freshTasks && envelope.recovery === "restart-from-start") {
    return repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter((checkpoint) => checkpoint.runId === envelope.runId).at(-1);
  }
  return repositories.runCheckpoints.latest(envelope.workflow, envelope.itemId, nodeId);
}
