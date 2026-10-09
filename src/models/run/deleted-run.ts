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
export const DeletedRunOriginSchema = z.enum(["queue", "archive"]);

/** Every table the cascade may touch, so a count can never name a table it did not read. */
export const DeletedRunTableSchema = z.enum([
  "timeline_events",
  "timeline_operation_sources",
  "ledger_projections",
  "operation_outbox",
  "run_operation_attempts",
  "run_operations",
  // Historical receipts retain their original names and bytes.
  "durable_outbox",
  "write_attempts",
  "write_intents",
  "diagnostic_files",
  "diagnostic_snapshots",
  "run_receipts",
  "dryrun_results",
  // Pre-v39 deletion receipts retain the four original names.
  "diagnostic_attachments",
  "diagnostic_bundles",
  "evidence_receipts",
  "dry_run_scenario_results",
  "activity_person_pseudonyms",
  "provider_admissions",
  "provider_requests",
  "failures", // historical tombstones retain their issued fingerprint
  "run_failures",
  "run_terminal_outbox",
  "run_results",
  "run_terminal_authorizations",
  "checkpoint_payloads",
  "run_checkpoints",
  "notifications", "notification_publications",
  "dependencies", // Historical deletion receipts.
  "delegation_dependencies",
  "delegation_manifests", // Historical deletion receipts.
  "run_delegations",
  "archive_relaunches",
  "archived_runs",
  "tasks", // Historical deletion receipts retain their original table name.
  "workflow_runs",
  "archive_transfers",
]);

export const DeletedRunRecordSchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  traceId: TraceIdSchema,
  itemId: ItemIdSchema.nullable().default(null),
  attempt: PositiveIntSchema.nullable().default(null),
  runNumber: PositiveIntSchema.nullable().default(null),
  ordinalSource: z.enum(["tombstone", "span-root-backfill", "unknown"]).default("unknown"),
  origin: DeletedRunOriginSchema,
  /** the journaled command that performed the delete — the tombstone's provenance */
  commandId: CommandIdSchema,
  deletedAt: IsoInstantSchema,
  /** v1 predates checkpoint_payloads; v2 adds it; v3 includes timeline and held shared evidence. */
  tallyVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  /** rows removed per table, in cascade order; a table absent here removed nothing */
  removed: z.array(z.strictObject({
    table: DeletedRunTableSchema,
    rows: z.number().int().nonnegative(),
  })),
});
export type DeletedRunRecord = z.infer<typeof DeletedRunRecordSchema>;

/** The repository's input: the identity facts plus who is deleting and when. */
export const RunDeleteInputSchema = z.strictObject({
  runId: RunIdSchema,
  origin: DeletedRunOriginSchema,
  commandId: CommandIdSchema,
  now: IsoInstantSchema,
});
export type RunDeleteInput = z.infer<typeof RunDeleteInputSchema>;
