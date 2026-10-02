import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY } from "../../../../../../src/models/config/authority.js";
import { ArchiveDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { storageRecoveryFixture } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";

// Operator-approved complete inventory: independent literals detect missing and extra tables.
const CURRENT_TABLES = [
  "app_settings", "archive_transfers", "checkpoint_payloads", "command_audits", "commands",
  "database_state", "database_upgrades", "delegation_dependencies", "deleted_runs", "diagnostic_files",
  "diagnostic_snapshots", "dryrun_results", "explorer_overrides", "extracted_artifacts", "generated_artifacts", "imported_artifacts",
  "notification_health", "notification_publications", "notifications", "provider_requests", "provider_usage", "run_checkpoints", "run_delegations", "run_failures",
  "run_operation_attempts", "run_operations", "run_receipts", "run_results", "run_summaries", "settings_snapshots",
  "summary_publication", "timeline_events", "timeline_operation_sources", "version_changes", "worker_auth",
  "worker_pools", "workflow_run_batches", "workflow_run_requests", "workflow_runs", "workflow_workers",
].sort();
const OBSOLETE_TABLES = [
  "archive_relaunches", "activity_person_pseudonyms", "activity_person_pseudonym_generations",
  "artifact_outbox", "artifact_sink_heads", "operator_xlsx_exports", "durable_outbox", "operation_outbox",
  "ledger_partitions", "ledger_projections", "run_terminal_authorizations", "run_terminal_outbox",
  "bulk_command_acceptances", "intake_sessions", "intake_manifests", "provider_admissions", "provider_budget_counters",
  "runtime_config", "settings_current", "spans", "gates", "notes", "ocr_approvals", "knowledge_records", "fix_records",
  "archived_runs", "version_plans", "version_bump_applications", "runs_view", "capture_sessions", "capture_photo_order",
  "capture_finalization_outboxes", "protected_settings_current", "authority_meta", "authority_upgrades", "leases",
  "duo_ceremony_leases", "start_plans", "delegation_manifests", "dependencies", "write_intents", "write_attempts",
  "config_snapshots", "diagnostic_bundles", "diagnostic_attachments", "evidence_receipts", "failures",
  "dry_run_scenario_results", "ocr_extractions", "tasks", "run_sessions",
];
function tables(path: string): string[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => {
    assert.equal(typeof row.name, "string"); return String(row.name);
  }); } finally { database.close(); }
}
it.each([0, 46, 47, 48, 49])("fresh/supported schema %s has the exact current physical inventories", async version => {
  const f = storageRecoveryFixture(version);
  try {
    if (version > 0) await f.backup();
    await f.run();
    const actual = tables(f.path);
    assert.deepEqual(actual, CURRENT_TABLES);
    assert.deepEqual(AUTHORITY_TABLE_REGISTRY.map(row => row.name).sort(), CURRENT_TABLES);
    for (const name of OBSOLETE_TABLES) assert.equal(actual.includes(name), false, `${name} must remain retired`);
    const archivePath = join(f.root, "archive.sqlite"), archive = new ArchiveDatabase(archivePath);
    archive.close();
    assert.deepEqual(tables(archivePath), ["archive_deletions", "archive_records"]);
  } finally { f.dispose(); }
});
