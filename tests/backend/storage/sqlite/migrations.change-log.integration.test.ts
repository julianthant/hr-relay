import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames, auditMigrationTableCoverage } from "../../../../src/backend/storage/sqlite/migrations.js";

const EntrySchema = z.strictObject({ seq: z.number().int(), table_name: z.string(), row_key: z.string(), op: z.string(), keys_json: z.string() });
const entries = (database: DatabaseSync) => z.array(EntrySchema).parse(database.prepare("SELECT * FROM authority_changes ORDER BY seq").all())
  .map(entry => ({ ...entry, keys: z.array(z.string().nullable()).parse(JSON.parse(entry.keys_json)).filter(key => key !== null) }));
const references = (database: DatabaseSync) => database.prepare("SELECT run_id,table_name,row_key FROM run_references ORDER BY run_id,table_name,row_key").all()
  .map(row => ({ ...row }));
const schemaObjects = (database: DatabaseSync) => database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row => ({ ...row }));

/** A store at schema 30, the change log migration's predecessor. */
function schema30(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 30)) for (const statement of migration.statements) database.exec(statement);
  return database;
}

function migrateTo31(database: DatabaseSync): void {
  applyAuthorityMigrationsAfter(database, 30, { now: "2026-11-13T00:00:00.000Z", captureFile: () => { throw new Error("no capture expected"); } });
}

function insertCommand(database: DatabaseSync, id: string, request: unknown, outcome: unknown = null, target: string | null = null): void {
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES(?,'run','operator',NULL,?,'digest',?,'succeeded',?,'2026-11-13T00:00:00.000Z','2026-11-13T00:00:00.000Z')`)
    .run(id, target, JSON.stringify(request), outcome === null ? null : JSON.stringify(outcome));
}

describe("change log migration 31", () => {
  it("adds the change log and run references beside an unchanged schema-30 store, outside the table registry", () => {
    const database = schema30();
    try {
      insertCommand(database, "c1", { family: "run", target: { runId: "r1" } });
      const prior = schemaObjects(database);
      const rows = migrationTableNames(30).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
      migrateTo31(database);
      for (const value of prior) assert.deepEqual(schemaObjects(database).find(object => object.name === value.name), value);
      assert.deepEqual(migrationTableNames(30).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), rows);
      assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 31);
      assert.deepEqual(migrationTableNames(31), migrationTableNames(30));
      assert.deepEqual(auditMigrationTableCoverage(), []);
      assert.deepEqual(schemaObjects(database).filter(object => object.type === "table" && !prior.some(value => value.name === object.name)).map(object => object.name),
        ["authority_changes", "run_references"]);
      assert.deepEqual(schemaObjects(database).filter(object => object.type === "index" && !prior.some(value => value.name === object.name)).map(object => object.name), [
        "assistant_actions_chat_idx", "commands_request_family_idx", "dryrun_results_run_idx", "run_references_row_idx", "run_search_build_idx", "runs_owner_idx", "workbook_library_snapshots_workbook_idx"]);
    } finally { database.close(); }
  });

  it("backfills a reference for every runId at any depth of each source column and logs nothing for it", () => {
    const database = schema30();
    try {
      insertCommand(database, "c1", { family: "run", items: [{ runId: "r1" }, { nested: { runId: "r2" } }], runId: 7 }, { result: { runId: "r3" } });
      insertCommand(database, "c2", { family: "run", runId: "r1" });
      database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES('a1','c2',NULL,?,'2026-11-13T00:00:00.000Z')")
        .run(JSON.stringify({ request: { runId: "r4" } }));
      migrateTo31(database);
      assert.deepEqual(references(database), [
        { run_id: "r1", table_name: "commands", row_key: '["c1"]' },
        { run_id: "r1", table_name: "commands", row_key: '["c2"]' },
        { run_id: "r2", table_name: "commands", row_key: '["c1"]' },
        { run_id: "r3", table_name: "commands", row_key: '["c1"]' },
        { run_id: "r4", table_name: "command_audits", row_key: '["a1"]' },
      ]);
      assert.deepEqual(entries(database), []);
    } finally { database.close(); }
  });

  it("logs each changed row with the keys of both images, and a source row's references with run and source keys", () => {
    const database = schema30();
    try {
      migrateTo31(database);
      insertCommand(database, "c1", { family: "settings", runId: "r1" }, null, "t1");
      database.prepare("UPDATE commands SET outcome_json=? WHERE id='c1'").run(JSON.stringify({ runId: "r2" }));
      database.prepare("UPDATE commands SET state='refused' WHERE id='c1'").run();
      database.prepare("DELETE FROM commands WHERE id='c1'").run();
      const source = 'source:["commands","[\\"c1\\"]"]';
      const logged = entries(database);
      assert.deepEqual(logged.map(entry => entry.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const commandKeys = ["run:t1", "command:c1", "family:settings", source];
      const reference = (run: string, op: string) => ({ table_name: "run_references", row_key: `["${run}","commands","[\\"c1\\"]"]`, op, keys: [`run:${run}`, source] });
      const byContent = (values: readonly unknown[]) => values.map(value => JSON.stringify(value)).sort();
      assert.deepEqual(byContent(logged.map(({ table_name, row_key, op, keys }) => ({ table_name, row_key, op, keys }))), byContent([
        { table_name: "commands", row_key: '["c1"]', op: "insert", keys: commandKeys },
        reference("r1", "insert"),
        { table_name: "commands", row_key: '["c1"]', op: "update", keys: [...commandKeys, ...commandKeys] },
        reference("r1", "delete"),
        reference("r1", "insert"),
        reference("r2", "insert"),
        { table_name: "commands", row_key: '["c1"]', op: "update", keys: [...commandKeys, ...commandKeys] },
        { table_name: "commands", row_key: '["c1"]', op: "delete", keys: commandKeys },
        reference("r1", "delete"),
        reference("r2", "delete"),
      ]));
      assert.deepEqual(references(database), []);
    } finally { database.close(); }
  });

  it("leaves no sequence gap after a rolled-back transaction, a rolled-back savepoint or an aborted statement", () => {
    const database = schema30();
    try {
      migrateTo31(database);
      insertCommand(database, "c1", { family: "run" });
      database.exec("BEGIN");
      insertCommand(database, "c2", { family: "run" });
      database.exec("ROLLBACK");
      database.exec("BEGIN");
      database.exec("SAVEPOINT inner");
      insertCommand(database, "c3", { family: "run" });
      database.exec("ROLLBACK TO inner");
      database.exec("RELEASE inner");
      assert.throws(() => database.exec(`INSERT INTO commands(id,family,actor_id,target_id,request_digest,request_json,state,created_at,updated_at)
        VALUES('c4','run','operator',NULL,'digest','{}','succeeded','t','t'),('c1','run','operator',NULL,'digest','{}','succeeded','t','t')`), /UNIQUE constraint failed/u);
      insertCommand(database, "c5", { family: "run" });
      database.exec("COMMIT");
      assert.deepEqual(entries(database).map(({ seq, row_key }) => ({ seq, row_key })), [{ seq: 1, row_key: '["c1"]' }, { seq: 2, row_key: '["c5"]' }]);
      assert.deepEqual({ ...database.prepare("SELECT seq FROM sqlite_sequence WHERE name='authority_changes'").get() }, { seq: 2 });
    } finally { database.close(); }
  });
});
