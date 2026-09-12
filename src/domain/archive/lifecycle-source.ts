import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
import { RunRecordSchema } from "../run/record.js";
// Existing immutable reports retain the historical relaunch group grammar; new capture never emits it.
export const LifecycleSourceSnapshotSchema = z.strictObject({
  run: RunRecordSchema,
  records: z.array(z.strictObject({
    table: z.enum(["provider_requests", "provider_usage", "version_plans", "version_bump_applications", "archive_transactions", "workflow_runs", "run_results", "run_receipts", "run_failures", "timeline_events", "diagnostic_snapshots", "diagnostic_files",
      "run_checkpoints", "run_operations", "run_operation_attempts", "settings_snapshots", "archived_runs", "archive_relaunches",
      "delegation_dependencies", "run_delegations", "dryrun_results", "checkpoint_payloads", "commands", "command_audits", "notes_files"]),
    rows: z.array(z.strictObject({ key: z.string(), json: z.string() })),
  })),
});
export type LifecycleSourceSnapshot = z.infer<typeof LifecycleSourceSnapshotSchema>;
export function lifecycleSourceDigest(snapshot: LifecycleSourceSnapshot): string {
  return sha256Hex(canonicalJsonStringify(LifecycleSourceSnapshotSchema.parse(snapshot)));
}


/** These facts survive transfer under independent owners; reports retain their claim-time values. */
const RETAINED_SHARED_SOURCE_TABLES = new Set<LifecycleSourceSnapshot["records"][number]["table"]>([
  "provider_usage", "run_checkpoints", "run_operations", "run_operation_attempts", "settings_snapshots",
  "commands", "command_audits", "notes_files", "version_plans", "version_bump_applications",
]);
export function lifecycleOwnedSourceDigest(snapshot: LifecycleSourceSnapshot): string {
  return lifecycleSourceDigest({ ...snapshot, records: snapshot.records.filter(group => !RETAINED_SHARED_SOURCE_TABLES.has(group.table)) });
}
