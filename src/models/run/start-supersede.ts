import { z } from "zod";
import { NonNegativeIntSchema, PositiveIntSchema, RunIdSchema, TraceIdSchema } from "../../rules/identity/ids.js";
import { isTerminalRunState, type RunRecord } from "./record.js";

/** Exact generations reviewed by a start plan, including an explicitly empty set. */
export const StartSupersedeTargetsSchema = z.array(z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  version: PositiveIntSchema,
  attempt: PositiveIntSchema,
  claimGeneration: NonNegativeIntSchema,
}));
export function startSupersedeTargets(runs: readonly RunRecord[]): z.infer<typeof StartSupersedeTargetsSchema> {
  return StartSupersedeTargetsSchema.parse(runs.filter((run) => !isTerminalRunState(run.lifecycle))
    .map((run) => ({ runId: run.envelope.runId, traceId: run.envelope.traceId, version: run.version,
      attempt: run.envelope.attempt, claimGeneration: run.claimGeneration }))
    .sort((a, b) => a.runId.localeCompare(b.runId)));
}
