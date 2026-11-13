import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { z } from "zod";
import { inspectNativeAuthority, validateAuthorityStore } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";
import { seedCheckClosureStore } from "../../../support/fixtures/storage/check-closure-store.js";

const POPULATED_TABLES = [
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
  "write_intents",
];

it("seeds one authority store that passes the whole-store check", async () => {
  const store = await seedCheckClosureStore();
  const raw = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    expect(() => validateAuthorityStore(raw)).not.toThrow();
    expect(() => inspectNativeAuthority(raw)).not.toThrow();
    const populated = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).filter(name =>
      z.object({ n: z.number().int() }).parse(raw.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()).n > 0).sort();
    expect(populated).toEqual(POPULATED_TABLES);
  } finally { raw.close(); store.closeDatabase(); await store.cleanup(); }
});
