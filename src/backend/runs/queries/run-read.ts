import { z } from "zod";
import type { RunRecord } from "../../../models/run/record.js";
import { TargetNotFoundError } from "../commands/refusals.js";
import type { RunFoldRecord } from "../projections/run-queue-projection.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";

/** Admit lifecycle before optional evidence; retained spans never resurrect an absent/deleted run. */
export function requireCanonicalRun(deps: RunDetailQueryDeps, runId: string): { row: RunFoldRecord | undefined; authority: RunRecord } {
  if (deps.runReader === undefined) throw new Error("canonical run reader is required");
  const existence = deps.runReader.read(runId);
  if (existence.state !== "present") throw new TargetNotFoundError(`run ${runId} is ${existence.state}`);
  if (existence.disposition !== "live") throw new TargetNotFoundError(`run ${runId} is archived; use its frozen resource`);
  return { row: deps.projection.runFold(runId), authority: existence.run };
}

export const SectionNameSchema = z.enum([
  "logs", "receipt", "review", "people", "context-data", "context-evidence", "context-attempts", "failure", "captures",
  "parked-write", "identity-gate",
]);
