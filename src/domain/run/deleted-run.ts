/**
 * The DELETE tombstone (D308).
 *
 * The operator ruled on 2026-09-01 that *delete means delete*: a terminal run —
 * on the queue or in the Archive — is removed from the authority database with
 * every row it owns, its write ledger included. What survives is exactly ONE
 * row: this tombstone, keyed by the run id, inserted FIRST in the same
 * transaction that removes everything else.
 *
 * It exists for three reasons, none of them nostalgia:
 *
 * 1. **The never-delete triggers are relaxed behind it, not removed.** Schema
 *    v29 rewrites each `*_never_deleted` trigger on a run-owned table to abort
 *    UNLESS a tombstone for that run already exists. A stray `DELETE` from any
 *    other code path still aborts by name; only the delete command, which
 *    writes the tombstone first, can pass.
 * 2. **Timeline rows are owned history.** Deletion removes the run's current
 *    SQLite events. Historical file import uses the tombstone to exclude
 *    deleted roots; retired files cannot resurrect current history.
 * 3. **The idempotency key is gone with the ledger.** `removed` records how
 *    many `run_operations` rows actually left. Shared retry evidence remains
 *    until its last retained owner/reference is deleted; only then is its
 *    permanent key released and counted in that deletion receipt.
 */
import { z } from "zod";
import {
  CommandIdSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

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
  "notifications",
  "dependencies", // Historical deletion receipts.
  "delegation_dependencies",
  "delegation_manifests", // Historical deletion receipts.
  "run_delegations",
  "archive_relaunches",
  "archived_runs",
  "tasks", // Historical deletion receipts retain their original table name.
  "workflow_runs",
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
