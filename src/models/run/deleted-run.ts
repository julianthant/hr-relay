/** The DELETE tombstone: the ONE row that survives deleting a run, inserted FIRST in the transaction that removes everything else. */
import { z } from "zod";
import {
  CommandIdSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

/** Which door the operator used. The cascade is the same; the admission is not. */
export const DeletedRunOriginSchema = z.literal("queue");

export const DeletedRunTableSchema = z.enum([
  "delegation_dependencies", "run_delegations", "diagnostic_files", "diagnostic_snapshots",
  "run_receipts", "run_results", "run_failures", "timeline_events", "gate_results",
  "run_checkpoints", "dryrun_results", "notifications", "run_search", "runs",
]);

export const DeletedRunRecordSchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  traceId: TraceIdSchema,
  itemId: ItemIdSchema,
  attempt: PositiveIntSchema,
  runNumber: PositiveIntSchema.nullable(),
  ordinalSource: z.literal("tombstone"),
  origin: DeletedRunOriginSchema,
  /** the journaled command that performed the delete — the tombstone's provenance */
  commandId: CommandIdSchema,
  deletedAt: IsoInstantSchema,
  /** Exact native cascade counts, fixed before the tombstone is inserted. */
  tallyVersion: z.literal(3),
  /** rows removed per table, in cascade order; a table absent here removed nothing */
  removed: z.array(z.strictObject({
    table: DeletedRunTableSchema,
    rows: z.number().int().nonnegative(),
  })).superRefine((entries, context) => {
    if (new Set(entries.map(entry => entry.table)).size !== entries.length) context.addIssue({ code: "custom", message: "deletion tally tables must be unique" });
  }),
});
export type DeletedRunRecord = z.infer<typeof DeletedRunRecordSchema>;

/** The repository's input: the identity facts plus who is deleting and when. */
export const RunDeleteInputSchema = z.strictObject({
  runId: RunIdSchema,
  origin: DeletedRunOriginSchema,
  commandId: CommandIdSchema,
  now: IsoInstantSchema,
  cascadeRunIds: z.array(RunIdSchema).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "deletion cascade identities must be unique" });
  }),
});
export type RunDeleteInput = z.infer<typeof RunDeleteInputSchema>;
