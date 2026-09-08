import { z } from "zod";
import type { RunRecord } from "../../../domain/run/record.js";
import { TargetNotFoundError } from "../../failures.js";
import type { RunFoldRecord } from "../projectors/run-queue-projection.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";

export function requireRun(deps: RunDetailQueryDeps, runId: string): { row: RunFoldRecord; authority: RunRecord } {
  const row = deps.projection.runFold(runId);
  if (row === undefined) {
    throw new TargetNotFoundError(`run ${runId} has no span fold; it was never enqueued through this projection`);
  }
  const authority = deps.authority.getRun(runId);
  if (authority === undefined) {
    throw new TargetNotFoundError(`run ${runId} exists in the span stream but not in authority`);
  }
  return { row, authority };
}

export const SectionNameSchema = z.enum([
  "logs", "receipt", "review", "people", "context-data", "context-evidence", "context-attempts", "failure", "captures",
  "parked-write", "identity-gate",
]);
