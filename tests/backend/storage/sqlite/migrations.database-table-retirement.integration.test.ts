import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";

// Independent target literals detect missing and extra physical tables.
const CURRENT_TABLES = [
  "artifacts",
  "auth_leases",
  "browser_sessions",
  "command_audits",
  "commands",
  "database_states",
  "database_upgrades",
  "delegation_dependencies",
  "deleted_runs",
  "diagnostic_files",
  "diagnostic_snapshots",
  "dryrun_results",
  "explorer_overrides",
  "gate_results",
  "notification_states",
  "notifications",
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
  "workbook_library",
  "workbook_library_history",
  "worker_controls",
  "worker_leases",
  "worker_pools",
  "worker_slots",
  "write_attempts",
  "write_intents"
];
it("fresh native authority has the exact current physical inventory", async () => {
  const f = await foundationFixture();
  try {
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      const actual = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
      assert.equal(CURRENT_TABLES.length, 36);
      assert.deepEqual(actual, CURRENT_TABLES);
      assert.deepEqual(AUTHORITY_TABLE_REGISTRY.map(row => row.name).sort(), CURRENT_TABLES);
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 6);
    } finally { raw.close(); }
  } finally { await f.dispose(); }
});
