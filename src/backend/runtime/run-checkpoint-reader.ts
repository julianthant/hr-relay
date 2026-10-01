import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";
import type { RunEnvelope } from "../../domain/run/envelope.js";

/** Fresh executions may resume their own checkpoints, never another run's latest row. */
export function readRunCheckpoint(repositories: Pick<AuthorityRepositories, "runCheckpoints">, envelope: RunEnvelope, nodeId: string, freshTasks = false) {
  if (envelope.sourceBound !== undefined || freshTasks && envelope.recovery === "restart-from-start") {
    return repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, nodeId, envelope.attempt)
      .filter((checkpoint) => checkpoint.runId === envelope.runId).at(-1);
  }
  return repositories.runCheckpoints.latest(envelope.workflow, envelope.itemId, nodeId);
}
