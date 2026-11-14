import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AUTHORITY_DERIVED_TABLES, AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

// Independent target literals detect missing and extra physical tables.
const CURRENT_TABLES = [
  "artifacts",
  "assistant_actions",
  "assistant_attachments",
  "assistant_chats",
  "assistant_conversations",
  "assistant_messages",
  "assistant_model_preference",
  "auth_leases",
  "command_audits",
  "commands",
  "database_states",
  "database_upgrades",
  "delegation_dependencies",
  "deleted_runs",
  "diagnostic_files",
  "diagnostic_snapshots",
  "dryrun_results",
  "exclusive_session_leases",
  "gate_results",
  "notification_states",
  "notifications",
  "ocr_approved_snapshots",
  "ocr_review_revisions",
  "ocr_source_uploads",
  "run_batches",
  "run_checkpoints",
  "run_delegations",
  "run_failures",
  "run_receipts",
  "run_requests",
  "run_results",
  "run_search",
  "runs",
  "settings",
  "settings_snapshots",
  "timeline_events",
  "workbook_creations",
  "workbook_library",
  "workbook_library_actions",
  "workbook_library_history",
  "workbook_library_snapshots",
  "workbook_library_state",
  "workbook_operations",
  "workbook_types",
  "worker_pools",
  "worker_slots",
  "workflow_workbook_selections",
  "write_attempts",
  "write_intents"
];
it("fresh native authority has the exact current physical inventory", async () => {
  const f = await foundationFixture();
  try {
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const actual = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
      assert.equal(CURRENT_TABLES.length, 49);
      assert.deepEqual(actual, [...CURRENT_TABLES, ...AUTHORITY_DERIVED_TABLES].sort());
      assert.deepEqual(AUTHORITY_TABLE_REGISTRY.map(row => row.name).sort(), CURRENT_TABLES);
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally { raw.close(); }
  } finally { await f.dispose(); }
});
