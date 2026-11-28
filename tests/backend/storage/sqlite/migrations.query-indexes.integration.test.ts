import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { ASSISTANT_PHASE_ONE_TABLES, RUN_SEARCH_FTS_TABLES } from "../../../../src/models/config/authority.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, LIST_INDEXES, QUERY_INDEXES, QUERY_INDEX_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { restoreSchema36QueryIndexes } from "../../../support/fixtures/storage/historical-run-schema.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const AT = "2026-11-17T00:00:00.000Z";
const REPLAY = "SELECT * FROM run_checkpoints WHERE workflow = ? AND item_id = ? ORDER BY attempt, claim_generation, node_id";
const ObjectSchema = z.object({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string().nullable() });
const schemaObjects = (database: DatabaseSync) => z.array(ObjectSchema)
  .parse(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all());
const indexNames = (database: DatabaseSync) => schemaObjects(database).filter(object => object.type === "index").map(object => object.name);
const rows = (database: DatabaseSync) => migrationTableNames(36).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
const plan = (database: DatabaseSync, sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
  .map(row => z.object({ detail: z.string() }).parse(row).detail).join("\n");

/** A store at schema 36, the query index migration's predecessor, holding one command. */
function schema35(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 36)) for (const statement of migration.statements) database.exec(statement);
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES('command','run-lifecycle','operator',NULL,'run','digest',?,'admitted',NULL,?,?)`)
    .run(JSON.stringify({ kind: "run-lifecycle", operation: "delegation-invocation", request: { runId: "run" } }), AT, AT);
  return database;
}

function migrateTo36(database: DatabaseSync): void {
  database.exec("BEGIN");
  applyAuthorityMigrationsAfter(database, 36, { now: AT, captureFile: () => { throw new Error("no capture expected"); } });
  database.exec("COMMIT");
}

describe("query index migration 37", () => {
  it("is schema version 37, under the current schema 48, and changes no table", () => {
    assert.equal(QUERY_INDEX_SCHEMA_VERSION, 37);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 48);
    assert.deepEqual(migrationTableNames(37), migrationTableNames(36));
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("drops the checkpoint replay index, adds each query index and keeps every row and other schema object", () => {
    const database = schema35();
    try {
      database.exec("DELETE FROM authority_changes");
      const prior = schemaObjects(database), stored = rows(database);
      assert.ok(prior.some(object => object.name === "checkpoints_replay_idx"));
      migrateTo36(database);
      const after = schemaObjects(database);
      const laterObjectChanges = new Set(["delegation_dependencies", "run_search", "assistant_messages_settle_only",
        "run_search_fts_insert", "run_search_fts_delete", "run_search_fts_update"]);
      const laterTables = new Set(["workbook_payloads", "debug_events", ...ASSISTANT_PHASE_ONE_TABLES, "assistant_applied_edits", ...RUN_SEARCH_FTS_TABLES]);
      assert.deepEqual(after.filter(object => !(object.name in QUERY_INDEXES) && !(object.name in LIST_INDEXES)
        && !laterObjectChanges.has(object.name) && !laterTables.has(object.tbl_name)),
        prior.filter(object => object.name !== "checkpoints_replay_idx" && !laterObjectChanges.has(object.name)));
      assert.deepEqual(after.filter(object => object.name in QUERY_INDEXES).map(object => [object.name, object.sql]).sort(),
        Object.entries(QUERY_INDEXES).map(([name, index]) => [name, `CREATE INDEX ${name} ON ${index.on}`]).sort());
      assert.deepEqual(rows(database), stored);
      assert.deepEqual(database.prepare("SELECT * FROM authority_changes").all(), []);
      assert.deepEqual(database.prepare("PRAGMA integrity_check").all().map(row => ({ ...row })), [{ integrity_check: "ok" }]);
    } finally { database.close(); }
  });

  it("replays checkpoints through the table's unique key and finds a run's commands through the new index", () => {
    const database = schema35();
    try {
      assert.match(plan(database, REPLAY), /USING INDEX checkpoints_replay_idx/u);
      migrateTo36(database);
      assert.match(plan(database, REPLAY), /SEARCH run_checkpoints USING INDEX sqlite_autoindex_run_checkpoints_\d \(workflow=\? AND item_id=\?\)/u);
      const invocations = `SELECT id FROM commands WHERE family='run-lifecycle' AND json_extract(request_json,'$.operation')='delegation-invocation'
        AND json_extract(request_json,'$.request.runId')=? ORDER BY id`;
      assert.match(plan(database, invocations), /SEARCH commands USING INDEX commands_request_run_idx/u);
      assert.deepEqual(database.prepare(invocations).all("run").map(row => ({ ...row })), [{ id: "command" }]);
    } finally { database.close(); }
  });

  it("upgrades a schema-36 store through the store upgrade", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        restoreSchema36QueryIndexes(database);
        assert.equal(inspectNativeAuthority(database, 36).schemaVersion, 36);
        assert.ok(indexNames(database).includes("checkpoints_replay_idx"));
      } finally { database.close(); }
      assert.equal((await f.run()).state, "upgraded");
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(upgraded.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
        const names = indexNames(upgraded);
        assert.equal(names.includes("checkpoints_replay_idx"), false);
        assert.deepEqual(Object.keys(QUERY_INDEXES).filter(name => !names.includes(name)), []);
      } finally { upgraded.close(); }
    } finally { await f.dispose(); }
  });
});
