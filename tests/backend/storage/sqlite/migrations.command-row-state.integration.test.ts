import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { commandFromRow, insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { COMMAND_ROW_STATE_MIGRATION, COMMAND_ROW_STATE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { deriveBulkChildCommand } from "../../../../src/rules/commands/command-groups.js";
import { BulkRunCommandRequestSchema, deriveBulkRunCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { restoreSchema32CommandRows } from "../../../support/fixtures/storage/historical-run-schema.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { LATER, NOW, UUID_1, UUID_2, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const ERRORED = { result: { state: "rejected", code: "bulk-child-errored" } };
const REFUSED = { result: { state: "rejected", code: "replan-required" } };
const AT = "2026-11-16T00:00:00.000Z";

const schemaObjects = (database: DatabaseSync) => database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row => ({ ...row }));
const states = (database: DatabaseSync) => Object.fromEntries(z.array(z.object({ id: z.string(), state: z.string() }))
  .parse(database.prepare("SELECT id,state FROM commands ORDER BY id").all()).map(row => [row.id, row.state]));
const changes = (database: DatabaseSync) => database.prepare("SELECT table_name,row_key,op FROM authority_changes ORDER BY seq").all().map(row => ({ ...row }));

/** A store at schema 32, the command row migration's predecessor. */
function schema32(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 32)) for (const statement of migration.statements) database.exec(statement);
  return database;
}

/** Applies migration 33 alone, so the schema it leaves is schema 33's. */
function migrateTo33(database: DatabaseSync): void {
  database.exec("BEGIN");
  for (const statement of COMMAND_ROW_STATE_MIGRATION.statements) database.exec(statement);
  database.exec("COMMIT");
}

function insertCommand(database: DatabaseSync, id: string, row: Readonly<{ family?: string; parent?: string; state: string; outcome?: unknown }>): void {
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES(?,?,'operator',?,NULL,'digest',?,?,?,?,?)`)
    .run(id, row.family ?? "run", row.parent ?? null, JSON.stringify({ family: row.family ?? "run", target: { runId: `run-${id}` } }), row.state,
      row.outcome === undefined ? null : JSON.stringify(row.outcome), AT, AT);
}

/** A bulk parent with one errored child, one refused child and one unsettled single command. */
function seed(database: DatabaseSync): void {
  insertCommand(database, "parent", { family: "bulk-parent", state: "succeeded" });
  insertCommand(database, "errored", { parent: "parent", state: "refused", outcome: ERRORED });
  insertCommand(database, "refused", { parent: "parent", state: "refused", outcome: REFUSED });
  insertCommand(database, "single", { state: "admitted" });
  database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES('audit','errored','bulk-child-errored',?,?)").run(JSON.stringify(ERRORED), AT);
}

describe("command row state migration 33", () => {
  it("is schema version 33, under the current schema 48", () => {
    assert.equal(COMMAND_ROW_STATE_SCHEMA_VERSION, 33);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 48);
    assert.deepEqual(migrationTableNames(33), migrationTableNames(32));
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("stores an errored bulk child as uncertain, records that change and keeps every other row and schema object", () => {
    const database = schema32();
    try {
      seed(database);
      database.exec("DELETE FROM authority_changes");
      const prior = schemaObjects(database);
      const rows = migrationTableNames(32).filter(table => table !== "commands").map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
      const commands = database.prepare("SELECT * FROM commands WHERE id<>'errored' ORDER BY id").all();
      const references = database.prepare("SELECT * FROM run_references ORDER BY run_id,table_name,row_key").all();
      migrateTo33(database);
      assert.deepEqual(states(database), { errored: "uncertain", parent: "succeeded", refused: "refused", single: "admitted" });
      assert.deepEqual(changes(database), [{ table_name: "commands", row_key: '["errored"]', op: "update" }]);
      assert.deepEqual(database.prepare("SELECT * FROM commands WHERE id<>'errored' ORDER BY id").all(), commands);
      assert.deepEqual(database.prepare("SELECT * FROM run_references ORDER BY run_id,table_name,row_key").all(), references);
      assert.deepEqual(migrationTableNames(32).filter(table => table !== "commands").map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), rows);
      const after = schemaObjects(database);
      assert.deepEqual(after.map(object => `${String(object.type)}:${String(object.name)}`), prior.map(object => `${String(object.type)}:${String(object.name)}`));
      assert.deepEqual(after.filter(object => object.name !== "commands"), prior.filter(object => object.name !== "commands"));
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
      assert.deepEqual(database.prepare("PRAGMA integrity_check").all().map(row => ({ ...row })), [{ integrity_check: "ok" }]);
      assert.deepEqual(database.prepare("SELECT name FROM sqlite_temp_schema").all(), []);
    } finally { database.close(); }
  });

  it("refuses a row state that is never written and a state that disagrees with the outcome", () => {
    const database = schema32();
    try {
      seed(database);
      migrateTo33(database);
      assert.throws(() => insertCommand(database, "executing", { state: "executing" }), /CHECK constraint failed/u);
      assert.throws(() => insertCommand(database, "admitted-settled", { state: "admitted", outcome: REFUSED }), /CHECK constraint failed/u);
      for (const state of ["succeeded", "refused", "uncertain"]) assert.throws(() => insertCommand(database, `${state}-unsettled`, { state }), /CHECK constraint failed/u);
      insertCommand(database, "uncertain", { state: "uncertain", outcome: ERRORED });
      insertCommand(database, "second-parent", { family: "bulk-parent", state: "succeeded" });
      assert.equal(states(database).uncertain, "uncertain");
    } finally { database.close(); }
  });

  it("keeps the command guards, foreign keys, change capture and run references on the rebuilt table", () => {
    const database = schema32();
    try {
      seed(database);
      migrateTo33(database);
      assert.throws(() => database.exec("UPDATE commands SET updated_at='later' WHERE id='parent'"), /commands-bulk-immutable/u);
      assert.throws(() => database.exec("DELETE FROM commands WHERE id='parent'"), /commands-bulk-retained/u);
      assert.throws(() => database.exec("UPDATE commands SET parent_id=NULL WHERE id='refused'"), /commands-parent-immutable/u);
      assert.throws(() => insertCommand(database, "orphan", { parent: "single", state: "admitted" }), /commands-parent-kind/u);
      assert.throws(() => insertCommand(database, "unparented", { parent: "missing", state: "admitted" }), /commands-parent-kind/u);
      assert.throws(() => database.exec("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES('stray','missing',NULL,'{}','t')"), /FOREIGN KEY constraint failed/u);
      assert.throws(() => database.exec("DELETE FROM commands WHERE id='errored'"), /FOREIGN KEY constraint failed/u);
      const captured = (store: DatabaseSync) => {
        store.exec("DELETE FROM authority_changes");
        insertCommand(store, "later", { state: "admitted" });
        store.exec("UPDATE commands SET target_id='moved' WHERE id='later'; DELETE FROM commands WHERE id='later'");
        return changes(store);
      };
      const predecessor = schema32();
      try {
        const entries = captured(database);
        assert.deepEqual(entries, captured(predecessor));
        assert.deepEqual(entries.map(entry => `${String(entry.table_name)}:${String(entry.op)}`),
          ["run_references:insert", "commands:insert", "commands:update", "run_references:delete", "commands:delete"]);
      } finally { predecessor.close(); }
    } finally { database.close(); }
  });

  it("stops on a stored row the new table refuses and leaves the schema-32 store unchanged", () => {
    const database = schema32();
    try {
      seed(database);
      insertCommand(database, "executing", { state: "executing" });
      const prior = schemaObjects(database), rows = database.prepare("SELECT * FROM commands ORDER BY id").all();
      database.exec("BEGIN");
      assert.throws(() => applyAuthorityMigrationsAfter(database, 32, { now: AT, captureFile: () => { throw new Error("no capture expected"); } }), /CHECK constraint failed/u);
      database.exec("ROLLBACK");
      assert.deepEqual(schemaObjects(database), prior);
      assert.deepEqual(database.prepare("SELECT * FROM commands ORDER BY id").all(), rows);
    } finally { database.close(); }
  });

  it("validates and upgrades a schema-32 store whose errored bulk child is stored as refused", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      const request = BulkRunCommandRequestSchema.parse({ commandId: UUID_1, bulkCommandId: UUID_1, requestedBy: "local-operator", requestedAt: NOW,
        source: "dashboard", family: "run", type: "pause", targets: [{ runId: UUID_2, expectedVersion: 1 }], mode: "best-effort" });
      const parent = { kind: "bulk-parent", commandId: UUID_1, acceptance: { bulkCommandId: UUID_1, request, requestFingerprint: deriveBulkRunCommandFingerprint(request) } };
      const child = deriveBulkChildCommand(request, request.targets[0]);
      const audit = { auditId: UUID_3, request: child, result: { state: "rejected", commandId: child.commandId, code: "bulk-child-errored", message: "Unexpected failure" },
        completedAt: LATER, versionChanges: [], affectedDependencyIds: [] };
      const stored = (database: DatabaseSync) => database.prepare("SELECT * FROM commands WHERE id=?").get(child.commandId);
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        insertNativeCommand(database, parent);
        insertNativeCommand(database, child, parent.commandId);
        settleNativeCommand(database, audit);
        database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,?,?,?)")
          .run(UUID_3, child.commandId, "bulk-child-errored", canonicalJsonStringify(audit), LATER);
        assert.equal(stored(database)?.state, "uncertain");
        assert.equal(inspectNativeAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
        restoreSchema32CommandRows(database);
        assert.equal(stored(database)?.state, "refused");
        assert.throws(() => commandFromRow(stored(database)), /command-row-outcome-mismatch/u);
        assert.equal(inspectNativeAuthority(database, 32).schemaVersion, 32);
      } finally { database.close(); }
      assert.equal((await f.run()).state, "upgraded");
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(upgraded.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
        assert.equal(stored(upgraded)?.state, "uncertain");
        assert.deepEqual(commandFromRow(stored(upgraded)), child);
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      } finally { upgraded.close(); }
    } finally { await f.dispose(); }
  });

  it("steps a current store back to schema 32 and forward again without changing a row", () => {
    const database = schema32();
    try {
      seed(database);
      const at32 = schemaObjects(database);
      migrateTo33(database);
      database.exec("PRAGMA user_version=33");
      const at33 = schemaObjects(database), rows = database.prepare("SELECT * FROM commands ORDER BY id").all();
      restoreSchema32CommandRows(database);
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 32);
      assert.deepEqual(schemaObjects(database), at32);
      assert.deepEqual(states(database), { errored: "refused", parent: "succeeded", refused: "refused", single: "admitted" });
      migrateTo33(database);
      assert.deepEqual(schemaObjects(database), at33);
      assert.deepEqual(database.prepare("SELECT * FROM commands ORDER BY id").all(), rows);
    } finally { database.close(); }
  });
});
