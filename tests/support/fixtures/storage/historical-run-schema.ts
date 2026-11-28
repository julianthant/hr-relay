import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { COMMAND_ROW_STATE_MIGRATION, CURRENT_AUTHORITY_SCHEMA_VERSION, LIST_INDEXES, SCHEMA_37_QUERY_INDEXES, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { CHANGE_LOG_OBJECTS } from "../../../../src/backend/storage/sqlite/authority-change-log.js";
import { ASSISTANT_HISTORY_MIGRATION, ASSISTANT_M1_HISTORY_STATEMENTS } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { predecessorRunRecordFromRow, runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { PredecessorRunRecordSchema, type PredecessorRunRecord } from "../../../../src/models/run/record.js";
import { SavedWorkbookWireSchema } from "../../../../src/models/dashboard/workbooks.js";
import { WorkbookLibrarySnapshotSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { migrateWorkbookPayloads, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_MIGRATION, WORKBOOK_PAYLOAD_TABLE } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";

/** Returns `commands` to its schema-32 table, keeping every row: `executing` allowed, state not tied to outcome, an errored bulk child held as `refused`. The schema version is left to the caller. */
function restoreSchema32CommandTable(database: DatabaseSync): void {
  const table = /CREATE TABLE commands \([^;]+?\) STRICT/u.exec(SQLITE_MIGRATIONS[0].statements.join("\n"))?.[0];
  assert.ok(table);
  const owned = COMMAND_ROW_STATE_MIGRATION.statements.filter(statement => /^CREATE (?:INDEX|TRIGGER) /u.test(statement));
  database.exec(`PRAGMA defer_foreign_keys=ON; CREATE TEMP TABLE commands_capture AS SELECT * FROM commands; DROP TABLE commands; ${table};
    INSERT INTO commands SELECT * FROM commands_capture; DROP TABLE commands_capture;
    UPDATE commands SET state='refused' WHERE state='uncertain' AND json_extract(outcome_json,'$.result.code')='bulk-child-errored'`);
  for (const statement of owned) database.exec(statement);
}

const PAYLOAD_TABLES = [["workbook_library", SavedWorkbookWireSchema], ["workbook_creations", SavedWorkbookWireSchema],
  ["workbook_library_history", SavedWorkbookWireSchema], ["workbook_library_snapshots", WorkbookLibrarySnapshotSchema]] as const;
/** The three guards that refuse rewriting retained workbook rows, as migration 38 recreates them. */
const RETAINED_GUARDS = WORKBOOK_PAYLOAD_MIGRATION.statements.filter(statement => statement.startsWith("CREATE TRIGGER workbook_") && !statement.startsWith("CREATE TRIGGER workbook_payloads_"));
function withoutRetainedGuards(database: DatabaseSync, work: () => void): void {
  assert.equal(RETAINED_GUARDS.length, 3);
  for (const statement of RETAINED_GUARDS) database.exec(`DROP TRIGGER ${String(/^CREATE TRIGGER (\w+)/u.exec(statement)?.[1])}`);
  work();
  for (const statement of RETAINED_GUARDS) database.exec(statement);
}

/** Embeds every stored workbook in its rows again, byte for byte as schemas 18 to 37 wrote them, and drops workbook_payloads; the schema version is left to the caller. */
function embedWorkbookPayloads(database: DatabaseSync): void {
  withoutRetainedGuards(database, () => {
    for (const [table, schema] of PAYLOAD_TABLES) {
      for (const raw of database.prepare(`SELECT rowid AS row_id,payload_json FROM ${table}`).all()) {
        const row = z.object({ row_id: z.number(), payload_json: z.string() }).parse(raw);
        const { workbookDigest, ...envelope } = z.looseObject({ workbookDigest: z.string() }).parse(JSON.parse(row.payload_json));
        const workbook = z.object({ payload_json: z.string() }).parse(database.prepare("SELECT payload_json FROM workbook_payloads WHERE digest=?").get(workbookDigest)).payload_json;
        const payload = schema.parse({ ...envelope, workbook: z.json().parse(JSON.parse(workbook)) });
        database.prepare(`UPDATE ${table} SET payload_json=? WHERE rowid=?`).run(JSON.stringify(payload), row.row_id);
      }
    }
  });
  database.exec("DROP TABLE workbook_payloads");
}

/** Creates workbook_payloads in a store whose rows embed their workbooks and moves each workbook into it, as migration 38 does. */
export function moveWorkbookPayloads(database: DatabaseSync): void {
  for (const statement of WORKBOOK_PAYLOAD_TABLE.statements) database.exec(statement);
  withoutRetainedGuards(database, () => migrateWorkbookPayloads(database));
}

const hasSyncStatusColumn = (database: DatabaseSync) => database.prepare("SELECT 1 FROM pragma_table_info('workbook_library_state') WHERE name='sync_json'").get() !== undefined;

/**
 * Runs current workbook repository work against a store of schema 18 to 37: its workbooks move into workbook_payloads for the work
 * and are embedded back afterwards, and a store before schema 36 has the sync column only for the work, so the store keeps its own layout.
 */
export function withCurrentWorkbookLayout<T>(database: DatabaseSync, work: () => T): T {
  const addsSyncStatus = !hasSyncStatusColumn(database);
  if (addsSyncStatus) for (const statement of WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements) database.exec(statement);
  moveWorkbookPayloads(database);
  try { return work(); } finally {
    embedWorkbookPayloads(database);
    if (addsSyncStatus) dropSchema36WorkbookSyncStatusColumn(database);
  }
}

/** Removes the empty edit table to construct a populated schema-46 copy. */
export function restoreSchema46AssistantEdits(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
  assert.equal(database.prepare("SELECT count(*) AS count FROM assistant_applied_edits").get()?.count, 0);
  database.exec("DROP TABLE assistant_applied_edits; UPDATE database_states SET schema_version=46; PRAGMA user_version=46");
}

export function dropRunSearchFts(database: DatabaseSync): void {
  database.exec(`DROP TRIGGER run_search_fts_insert; DROP TRIGGER run_search_fts_delete; DROP TRIGGER run_search_fts_update;
    DROP TABLE run_search_fts`);
}

export function inventoryRowOrder(table: string): string {
  if (table === "run_search_fts_idx") return "segid,term";
  if (table === "run_search_fts_config") return "k";
  return "rowid";
}

/** Steps an authority back to schema 45, before the derived full-text index. */
export function restoreSchema45RunSearch(database: DatabaseSync): void {
  if (database.prepare("PRAGMA user_version").get()?.user_version === CURRENT_AUTHORITY_SCHEMA_VERSION) restoreSchema46AssistantEdits(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 46);
  dropRunSearchFts(database);
  database.exec("UPDATE database_states SET schema_version=45; PRAGMA user_version=45");
}

/** Steps an authority back to schema 43: every unrecorded text-part message is stored as `{text}` again. */
export function restoreSchema43AssistantPayloads(database: DatabaseSync): void {
  const current = database.prepare("PRAGMA user_version").get()?.user_version;
  if (typeof current === "number" && current >= 46) restoreSchema45RunSearch(database);
  const version = database.prepare("PRAGMA user_version").get()?.user_version;
  assert.ok(version === 44 || version === 45); // The Settings-only step has the same physical layout.
  database.exec(`DROP TRIGGER assistant_messages_settle_only;
    UPDATE assistant_messages SET payload_json=json_object('text',COALESCE(json_extract(payload_json,'$.parts[0].runs[0].text'),''))
      WHERE json_extract(payload_json,'$.recording.kind')='unrecorded';
    ${ASSISTANT_M1_HISTORY_STATEMENTS[1]}; UPDATE database_states SET schema_version=43; PRAGMA user_version=43`);
}

/** Removes the empty phase-1 assistant tables and restores the schema-42 message trigger. */
export function restoreSchema42AssistantStorage(database: DatabaseSync): void {
  const version = database.prepare("PRAGMA user_version").get()?.user_version;
  if (typeof version === "number" && version >= 44) restoreSchema43AssistantPayloads(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 43);
  for (const table of ["assistant_session_claims", "assistant_proposal_rows", "assistant_proposals"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    database.exec(`DROP TABLE ${table}`);
  }
  const trigger = ASSISTANT_HISTORY_MIGRATION.statements.find(statement => statement.startsWith("CREATE TRIGGER assistant_messages_settle_only"));
  assert.ok(trigger);
  // Schema 42 stored every message as `{text}`; a turn-accounting row keeps the text of its first run.
  database.exec(`DROP TRIGGER assistant_messages_settle_only;
    UPDATE assistant_messages SET payload_json=json_object('text',COALESCE(json_extract(payload_json,'$.parts[0].runs[0].text'),'')) WHERE json_type(payload_json,'$.recording') IS NOT NULL;
    ${trigger}; UPDATE database_states SET schema_version=42; PRAGMA user_version=42`);
}

/** Steps an authority back to schema 40, which has no OCR terms in the search projection. */
export function restoreSchema40OcrSearchTerms(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 43) restoreSchema42AssistantStorage(database);
  const version = database.prepare("PRAGMA user_version").get()?.user_version;
  assert.ok(version === 41 || version === 42);
  database.exec("ALTER TABLE run_search DROP COLUMN ocr_subject_terms; UPDATE database_states SET schema_version=40; PRAGMA user_version=40");
}

/** Steps an authority back to schema 39: none of the list indexes and no generated dependency parent column. */
export function restoreSchema39ListIndexes(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 41) restoreSchema40OcrSearchTerms(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 40);
  dropListIndexObjects(database);
  database.exec("UPDATE database_states SET schema_version=39; PRAGMA user_version=39");
}

function dropListIndexObjects(database: DatabaseSync): void {
  for (const name of Object.keys(LIST_INDEXES)) database.exec(`DROP INDEX ${name}`);
  database.exec("ALTER TABLE delegation_dependencies DROP COLUMN parent_run_id");
}

/**
 * Steps a current authority back to schema 38: debug entries back in the timeline, after its own events in the timeline's
 * cursor space, and no debug table.
 */
export function restoreSchema38DebugEvents(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 40) restoreSchema39ListIndexes(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 39);
  database.exec(`CREATE TEMP TABLE debug_capture AS SELECT row_number() OVER (ORDER BY cursor)
      + COALESCE((SELECT seq FROM sqlite_sequence WHERE name='timeline_events'),0) AS timeline_cursor, * FROM debug_events;
    INSERT INTO timeline_events(cursor,id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
      SELECT timeline_cursor,id,workflow,run_id,worker_id,'debug',occurred_at,recorded_at,retention_date,
        CASE pinned WHEN 1 THEN 'protected' ELSE 'ordinary' END,json_set(payload_json,'$.cursor',timeline_cursor) FROM debug_capture ORDER BY cursor;
    DROP TABLE debug_capture;
    DROP TABLE debug_events;
    UPDATE database_states SET schema_version=38;
    PRAGMA user_version=38`);
}

/** Restores the embedded workbooks and run indexes of schema 37. */
export function restoreSchema37WorkbookPayloads(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 39) restoreSchema38DebugEvents(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 38);
  embedWorkbookPayloads(database);
  database.exec(`DROP INDEX runs_workflow_day_idx;
    DROP INDEX runs_nonterminal_idx;
    DROP INDEX runs_queued_idx;
    CREATE INDEX runs_queued_idx ON runs(created_at,id) WHERE state='queued';
    UPDATE database_states SET schema_version=37;
    PRAGMA user_version=37`);
}

/** Steps a current authority back to schema 36: none of the query indexes, and checkpoint replay keeps its own index. */
export function restoreSchema36QueryIndexes(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 38) restoreSchema37WorkbookPayloads(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 37);
  const replay = SQLITE_MIGRATIONS[0].statements.join("\n").match(/CREATE INDEX checkpoints_replay_idx [^;]+/u)?.[0];
  assert.ok(replay);
  for (const name of Object.keys(SCHEMA_37_QUERY_INDEXES)) database.exec(`DROP INDEX ${name}`);
  database.exec(`${replay}; UPDATE database_states SET schema_version=36; PRAGMA user_version=36`);
}

/** Drops the library state's last SharePoint sync column that schema 36 added; the schema version is left to the caller. */
export function dropSchema36WorkbookSyncStatusColumn(database: DatabaseSync): void {
  database.exec("ALTER TABLE workbook_library_state DROP COLUMN sync_json");
}

/** Steps a current authority back to schema 35: schema 36 added the library state's last SharePoint sync column. */
export function removeSchema36WorkbookSyncStatus(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 37) restoreSchema36QueryIndexes(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 36);
  dropSchema36WorkbookSyncStatusColumn(database);
  database.exec("UPDATE database_states SET schema_version=35; PRAGMA user_version=35");
}

/** Steps a current authority back to schema 34: schema 35 converts settings records in place and keeps the same layout. */
export function regressSchema35SendShortcut(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 36) removeSchema36WorkbookSyncStatus(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 35);
  database.exec("UPDATE database_states SET schema_version=34; PRAGMA user_version=34");
}

/** Steps a current authority back to schema 33: schema 34 strips failure notes from stored commands in place and keeps the same layout. */
export function regressSchema34FailureNotes(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 35) regressSchema35SendShortcut(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 34);
  database.exec("UPDATE database_states SET schema_version=33; PRAGMA user_version=33");
}

/** Steps a current authority back to schema 32. */
export function restoreSchema32CommandRows(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 34) regressSchema34FailureNotes(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 33);
  const nested = database.isTransaction;
  if (!nested) database.exec("BEGIN");
  restoreSchema32CommandTable(database);
  database.exec("UPDATE database_states SET schema_version=32; PRAGMA user_version=32");
  if (!nested) database.exec("COMMIT");
}

/** Steps a current authority back to schema 30: the change log, its run references, its triggers and indexes did not exist. Schema 32 changed no table, index or trigger. */
export function removeSchema31ChangeLog(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 33) restoreSchema32CommandRows(database);
  if (database.prepare("PRAGMA user_version").get()?.user_version === 32) database.exec("UPDATE database_states SET schema_version=31; PRAGMA user_version=31");
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 31);
  const objects = z.array(z.object({ type: z.string(), name: z.string() })).parse(database.prepare("SELECT type,name FROM sqlite_schema").all())
    .filter(({ name }) => CHANGE_LOG_OBJECTS.includes(name));
  for (const type of ["trigger", "index", "table"]) for (const object of objects) if (object.type === type) database.exec(`DROP ${type} ${object.name}`);
  database.exec("DELETE FROM sqlite_sequence WHERE name='authority_changes'; UPDATE database_states SET schema_version=30; PRAGMA user_version=30");
}

/** Removes schema 30's pin and tags from every library state and recorded action result; the schema version is left to the caller. */
function removeSchema30WorkbookPinTags(database: DatabaseSync): void {
  const guard = SQLITE_MIGRATIONS.find(migration => migration.version === 30)?.statements
    .find(statement => statement.startsWith("CREATE TRIGGER workbook_library_actions_update"));
  assert.ok(guard);
  database.exec(`DROP TRIGGER workbook_library_actions_update;
    UPDATE workbook_library_state SET payload_json=json_remove(payload_json,'$.pinned','$.tags');
    UPDATE workbook_library_actions SET payload_json=json_remove(payload_json,'$.result.pinned','$.result.tags');
    ${guard}`);
}

/** Steps a current authority back to schema 29: library states and recorded actions carried no pin or tags. */
export function restoreSchema29WorkbookPinTags(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 31) removeSchema31ChangeLog(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 30);
  removeSchema30WorkbookPinTags(database);
  database.exec("UPDATE database_states SET schema_version=29; PRAGMA user_version=29");
}

/** Steps an empty current authority back to schema 28: the empty operator grant table still existed. */
export function restoreSchema28AssistantGrants(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 30) restoreSchema29WorkbookPinTags(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 29);
  const ddl = SQLITE_MIGRATIONS.find(migration => migration.version === 8)?.statements.join("\n");
  const table = ddl?.match(/CREATE TABLE assistant_grants \([\s\S]*?\n\) STRICT;/u)?.[0], trigger = ddl?.match(/CREATE TRIGGER assistant_grants_revision[\s\S]*?END;/u)?.[0];
  assert.ok(table && trigger);
  database.exec(`${table}\n${trigger}`);
  database.exec("UPDATE database_states SET schema_version=28; PRAGMA user_version=28");
}

/** Steps an empty schema-28 authority back to schema 27: the attachments table did not exist yet. */
export function removeEmptySchema28Attachments(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 29) restoreSchema28AssistantGrants(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 28);
  assert.equal(database.prepare("SELECT count(*) AS count FROM assistant_attachments").get()?.count, 0);
  database.exec("DROP TABLE assistant_attachments");
  database.exec("UPDATE database_states SET schema_version=27; PRAGMA user_version=27");
}

/** Steps a schema-27 authority back to schema 26: schema 27 converts stored efforts in place and keeps the same layout. */
export function regressSchema27EffortScale(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 28) removeEmptySchema28Attachments(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 27);
  database.exec("UPDATE database_states SET schema_version=26; PRAGMA user_version=26");
}

/** Steps an empty current authority back to schema 25: the two assistant history tables did not exist yet. */
export function removeEmptySchema26AssistantHistory(database: DatabaseSync): void {
  if (Number(database.prepare("PRAGMA user_version").get()?.user_version) >= 27) regressSchema27EffortScale(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 26);
  for (const table of ["assistant_messages", "assistant_conversations"]) assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  database.exec("DROP TABLE assistant_messages; DROP TABLE assistant_conversations");
  database.exec("UPDATE database_states SET schema_version=25; PRAGMA user_version=25");
}

/** Returns a current store to the schema-22 worker custody DDL, keeping each worker slot in its predecessor row shape; the schema version is left to the caller. */
export function restoreSchema22WorkerCustodyFixture(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
  dropRunSearchFts(database);
  database.exec("ALTER TABLE run_search DROP COLUMN ocr_subject_terms");
  // The dependency table goes back to its old DDL in place, so the comparison below keeps its rows.
  dropListIndexObjects(database);
  embedWorkbookPayloads(database);
  dropSchema36WorkbookSyncStatusColumn(database);
  removeSchema30WorkbookPinTags(database);
  // The schema comparison below drops every changed table; `commands` goes back first so its rows stay.
  restoreSchema32CommandTable(database);
  // Rebuilding worker_slots briefly orphans the Duo and exclusive-session leases that reference it; the caller's transaction checks them at commit.
  database.exec("PRAGMA defer_foreign_keys=ON");
  const slots = z.array(z.object({ id: z.string(), workflow: z.string(), ordinal: z.number(), pool_index: z.number(), retired_at: z.string().nullable(),
    created_at: z.string(), updated_at: z.string() })).parse(database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all());
  const reference = new DatabaseSync(":memory:");
  const objects = (source: DatabaseSync) => new Map(source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
    .map(row => [`${String(row.type)}:${String(row.name)}`, { type: String(row.type), name: String(row.name), sql: String(row.sql) }]));
  let prior: ReturnType<typeof objects>;
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(item => item.version <= 22)) for (const statement of migration.statements) reference.exec(statement);
    prior = objects(reference);
  } finally { reference.close(); }
  const current = objects(database);
  const changed = (key: string) => current.get(key)?.sql !== prior.get(key)?.sql;
  // Newest tables first, so a child table goes before the parent its foreign keys name.
  for (const [key, object] of [...current].reverse()) if (changed(key) && object.type === "table") database.exec(`DROP TABLE ${object.name}`);
  for (const [key, object] of objects(database)) if (changed(key)) database.exec(`DROP ${object.type.toUpperCase()} ${object.name}`);
  for (const type of ["table", "index", "trigger"]) {
    for (const [key, object] of prior) if (object.type === type && !objects(database).has(key)) database.exec(object.sql);
  }
  for (const slot of slots) {
    const row = { workerId: slot.id, workflow: slot.workflow, ordinal: slot.ordinal, poolIndex: slot.pool_index, membershipRevision: 1, phase: "idle",
      retiredAt: slot.retired_at, retirementCommandId: null, reservationCommandId: null, createdAt: slot.created_at, updatedAt: slot.updated_at };
    database.prepare("INSERT INTO worker_slots(id,workflow,ordinal,membership_revision,phase,retired_at,retirement_command_id,reservation_command_id,payload_json,created_at,updated_at) VALUES(?,?,?,1,'idle',?,NULL,NULL,?,?,?)")
      .run(row.workerId, row.workflow, row.ordinal, row.retiredAt, canonicalJsonStringify(row), row.createdAt, row.updatedAt);
  }
}

/** Returns a current store to the schema-23 shape: schema 22 plus the worker-claim index; the schema version is left to the caller. */
export function restoreSchema23WorkerCustodyFixture(database: DatabaseSync): void {
  restoreSchema22WorkerCustodyFixture(database);
  for (const statement of SQLITE_MIGRATIONS.find(migration => migration.version === 23)?.statements ?? []) database.exec(statement);
}

export function restoreSchema20CompletionFixture(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
  database.exec("DROP TABLE IF EXISTS workflow_workbook_selections");
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='worker_leases'").get() === undefined) restoreSchema22WorkerCustodyFixture(database);
  const trigger = SQLITE_MIGRATIONS.find(migration => migration.version === 20)?.statements
    .find(statement => statement.startsWith("CREATE TRIGGER runs_completion_immutable"));
  assert.ok(trigger);
  database.exec(`DROP INDEX IF EXISTS timeline_worker_claim_idx; DROP TRIGGER runs_completion_immutable; ${trigger}`);
  database.exec("UPDATE database_states SET schema_version=20; PRAGMA user_version=20");
}

export function restoreSchema19RunSettlementFixture(database: DatabaseSync): void {
  if (database.prepare("PRAGMA user_version").get()?.user_version !== 20) restoreSchema20CompletionFixture(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 20);
  assert.equal(database.prepare("SELECT count(*) AS count FROM (SELECT run_id FROM run_results GROUP BY run_id HAVING count(*)>1)").get()?.count, 0);
  database.exec("DROP TRIGGER runs_completion_immutable");
  for (const table of ["run_receipts", "run_results"]) for (const suffix of ["no_replace", "immutable", "owner_delete"]) database.exec(`DROP TRIGGER ${table}_${suffix}`);
  database.exec("ALTER TABLE run_receipts RENAME TO fixture_run_receipts; ALTER TABLE run_results RENAME TO fixture_run_results");
  const baseline = SQLITE_MIGRATIONS[0].statements[0];
  for (const table of ["run_results", "run_receipts"]) {
    const definition = baseline.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\) STRICT;`))?.[0];
    assert.ok(definition);
    database.exec(definition);
  }
  database.exec(`INSERT INTO run_results SELECT run_id,workflow,attempt,result_digest,payload_json,created_at FROM fixture_run_results;
    INSERT INTO run_receipts SELECT id,run_id,workflow,attempt,result,confidence,failure_id,payload_json,created_at FROM fixture_run_receipts;
    DROP TABLE fixture_run_receipts; DROP TABLE fixture_run_results`);
  for (const table of ["run_results", "run_receipts"]) for (const suffix of ["no_replace", "immutable", "owner_delete"]) {
    const definition = baseline.match(new RegExp(`CREATE TRIGGER ${table}_${suffix}[\\s\\S]*?END;`))?.[0];
    assert.ok(definition);
    database.exec(definition);
  }
  const completionTrigger = baseline.match(/CREATE TRIGGER runs_completion_immutable[\s\S]*?END;/)?.[0];
  assert.ok(completionTrigger);
  database.exec(completionTrigger);
  database.exec("UPDATE database_states SET schema_version=19; PRAGMA user_version=19");
}

export function restoreSchema18WorkbookReferenceFixture(database: DatabaseSync): void {
  restoreSchema19RunSettlementFixture(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 19);
  assert.equal(database.prepare("SELECT schema_version FROM database_states WHERE id=1").get()?.schema_version, 19);
  assert.equal(database.prepare("UPDATE database_states SET schema_version=18 WHERE id=1").run().changes, 1);
  database.exec("PRAGMA user_version=18");
}

export function removeEmptySchema18WorkbookCatalog(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 18);
  for (const table of ["workbook_library_actions", "workbook_library_snapshots", "workbook_library_state"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  }
  for (const table of ["workbook_library_actions", "workbook_library_snapshots", "workbook_library_state"]) database.exec(`DROP TABLE ${table}`);
  database.exec("UPDATE database_states SET schema_version=17; PRAGMA user_version=17");
}

export function removeEmptySchema17OcrReview(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 17);
  for (const table of ["ocr_approved_snapshots", "ocr_review_revisions", "ocr_source_uploads"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  }
  for (const table of ["ocr_approved_snapshots", "ocr_review_revisions", "ocr_source_uploads"]) database.exec(`DROP TABLE ${table}`);
  database.exec("UPDATE database_states SET schema_version=16; PRAGMA user_version=16");
}

export function removeSchema15RunPause(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 15);
  assert.equal(database.prepare("SELECT count(*) AS count FROM runs WHERE json_type(lifecycle_json,'$.pause') IS NOT NULL").get()?.count, 0);
  database.exec("DROP TRIGGER run_pause_insert; DROP TRIGGER run_pause_update; ALTER TABLE runs DROP COLUMN pause_state");
}

export function removeEmptyExclusiveSessionLeaseFixture(database: DatabaseSync): void {
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exclusive_session_leases").get()?.count, 0);
  database.exec("DROP TABLE exclusive_session_leases");
}

export function readNative6RunRecord(database: DatabaseSync, input: unknown): PredecessorRunRecord {
  inspectNativeAuthority(database, 6);
  const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(input);
  assert.equal(Object.hasOwn(row, "pause_state"), false);
  return predecessorRunRecordFromRow({ ...row, pause_state: null });
}

export function updateNative6RunFixture(database: DatabaseSync, record: PredecessorRunRecord): void {
  inspectNativeAuthority(database, 6);
  assert.equal(Object.hasOwn(record, "pause"), false);
  const entries = Object.entries(runRecordColumns(record, PredecessorRunRecordSchema)).filter(([key]) => key !== "id" && key !== "pause_state");
  const changes = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
    .run(...entries.map(([, value]) => value), record.envelope.runId, record.version - 1).changes);
  assert.equal(changes, 1, "native6 fixture run-version-fence-lost");
}

export function assertUpgradedRunSettlementRows(table: "run_results" | "run_receipts", actual: readonly Record<string, unknown>[],
  prior: Readonly<Record<string, readonly Record<string, unknown>[]>>): void {
  const versionFor = (runId: unknown) => {
    const row = prior.runs?.find(run => run.id === runId), result = prior.run_results?.find(result => result.run_id === runId);
    assert.ok(row && result);
    const context = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(row.lifecycle_json)));
    const payload = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(result.payload_json)));
    const completion = context.completion === undefined ? undefined : z.object({ expectedVersion: z.number() }).parse(context.completion);
    return z.number().int().positive().parse(completion === undefined
      ? z.object({ result: z.object({ value: z.object({ appliedVersion: z.number() }) }) }).parse(payload).result.value.appliedVersion
      : completion.expectedVersion + 1);
  };
  const expected = (prior[table] ?? []).map(row => {
    const version = versionFor(row.run_id);
    if (table === "run_receipts") return { ...row, settlement_version: version };
    const owner = prior.runs?.find(run => run.id === row.run_id); assert.ok(owner);
    const context = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(owner.lifecycle_json)));
    const terminal = { ...context, envelope: z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(owner.envelope_json))), version, updatedAt: row.created_at };
    return { ...row, id: `${String(row.run_id)}:${version}`, settlement_version: version, terminal_run_json: canonicalJsonStringify(terminal) };
  });
  const canonical = actual.map(row => table === "run_results"
    ? { ...row, terminal_run_json: canonicalJsonStringify(JSON.parse(z.string().parse(row.terminal_run_json))) } : { ...row });
  assert.deepEqual(canonical, expected);
}
