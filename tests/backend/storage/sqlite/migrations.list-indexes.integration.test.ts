import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, LIST_INDEXES, LIST_INDEX_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { restoreSchema39ListIndexes } from "../../../support/fixtures/storage/historical-run-schema.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const AT = "2026-11-23T00:00:00.000Z";
const CAPTURE = { now: AT, captureFile: () => { throw new Error("no capture expected"); } };
const ObjectSchema = z.object({ type: z.string(), name: z.string(), sql: z.string().nullable() });
const schemaObjects = (database: DatabaseSync) => z.array(ObjectSchema)
  .parse(database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all());
const plan = (database: DatabaseSync, sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
  .map(row => z.object({ detail: z.string() }).parse(row).detail).join("\n");

/** A fresh store at the current schema, every migration statement applied in order. */
function currentStore(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
  return database;
}

/** Each statement this migration serves, as the store prepares it, and the index its plan must name. */
const PINNED_PLANS: readonly (readonly [string, RegExp])[] = [
  ["SELECT * FROM timeline_events WHERE run_id IN (SELECT value FROM json_each(?)) AND kind IN ('run.queued','run.claimed') ORDER BY cursor",
    /SEARCH timeline_events USING INDEX timeline_queue_events_idx \(run_id=\?\)/u],
  ["SELECT * FROM runs INDEXED BY runs_parent_idx WHERE parent_id IN (SELECT value FROM json_each(?)) ORDER BY id",
    /SEARCH runs USING INDEX runs_parent_idx \(parent_id=\?\)/u],
  ["SELECT * FROM runs WHERE owner_worker_id = ? ORDER BY created_at, id", /SEARCH runs USING INDEX runs_owned_idx \(owner_worker_id=\?\)/u],
  ["SELECT * FROM notifications WHERE actor_id = ? ORDER BY created_at, id", /SEARCH notifications USING INDEX notifications_actor_idx \(actor_id=\?\)/u],
  ["SELECT * FROM run_batches WHERE workflow = ? ORDER BY started_at, id", /SEARCH run_batches USING INDEX run_batches_workflow_idx \(workflow=\?\)/u],
  ["SELECT * FROM run_failures WHERE fingerprint = ? ORDER BY created_at, id", /SEARCH run_failures USING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  ["SELECT count(*) AS count FROM run_failures WHERE fingerprint = ?", /SEARCH run_failures USING COVERING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  ["SELECT * FROM ocr_approved_snapshots WHERE run_id=? ORDER BY created_at,id", /SEARCH ocr_approved_snapshots USING INDEX ocr_approved_run_idx \(run_id=\?\)/u],
  ["SELECT * FROM delegation_dependencies WHERE json_extract(payload_json, '$.parentRunId') = ? ORDER BY created_at, id",
    /SEARCH delegation_dependencies USING INDEX dependencies_parent_run_idx \(<expr>=\?\)/u],
  ["DELETE FROM debug_events WHERE run_id=?", /SEARCH debug_events USING (?:COVERING )?INDEX debug_events_run_idx \(run_id=\?\)/u],
  ["SELECT * FROM gate_results WHERE run_id = ? ORDER BY created_at, id", /SEARCH gate_results USING INDEX gates_owner_idx \(run_id=\?\)/u],
  ["SELECT 1 FROM commands WHERE family IN ('settings','settings-initialization') LIMIT 1", /SEARCH commands USING (?:COVERING )?INDEX commands_\w+ \(family=\?\)/u],
];

/**
 * Foreign keys left without an index that starts on the child column: no runtime path deletes or re-keys the parent row, or the
 * child table is bounded by the worker slots.
 */
const UNINDEXED_FOREIGN_KEYS = {
  "settings.audit_id": "settings holds one row and command audits are never deleted",
  "settings.command_id": "settings holds one row and commands are never deleted",
  "settings.snapshot_id": "settings holds one row and settings snapshots are immutable",
  "runs.settings_snapshot_id": "settings snapshots are immutable and never deleted",
  "deleted_runs.command_id": "commands are never deleted outside migrations",
  "run_requests.consumed_by": "commands are never deleted outside migrations",
  "auth_leases.holder_worker_id": "worker slots are retired, not deleted, and leases are bounded by the slots",
  "exclusive_session_leases.worker_id": "worker slots are retired, not deleted, and leases are bounded by the slots",
  "worker_slots.workflow": "worker pools are never deleted and slots are bounded by the pools",
} as const;

describe("list index migration 40", () => {
  it("is the current schema and changes no table", () => {
    assert.equal(LIST_INDEX_SCHEMA_VERSION, 40);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 40);
    assert.deepEqual(migrationTableNames(40), migrationTableNames(39));
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("adds each list index and keeps every row and other schema object", () => {
    const database = currentStore();
    try {
      database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
        VALUES('command','settings','operator',NULL,NULL,'digest','{}','admitted',NULL,?,?)`).run(AT, AT);
      database.exec("UPDATE database_states SET schema_version=40; PRAGMA user_version=40");
      restoreSchema39ListIndexes(database);
      const prior = schemaObjects(database);
      const stored = database.prepare("SELECT * FROM commands").all();
      database.exec("BEGIN");
      applyAuthorityMigrationsAfter(database, 39, CAPTURE);
      database.exec("COMMIT");
      const after = schemaObjects(database);
      assert.deepEqual(after.filter(object => !(object.name in LIST_INDEXES)), prior);
      assert.deepEqual(after.filter(object => object.name in LIST_INDEXES).map(object => [object.name, object.sql]).sort(),
        Object.entries(LIST_INDEXES).map(([name, index]) => [name, `CREATE INDEX ${name} ON ${index.on}`]).sort());
      assert.deepEqual(database.prepare("SELECT * FROM commands").all(), stored);
      assert.deepEqual(database.prepare("PRAGMA integrity_check").all().map(row => ({ ...row })), [{ integrity_check: "ok" }]);
    } finally { database.close(); }
  });

  it("plans each list and lookup it serves through its index", () => {
    const database = currentStore();
    try {
      for (const [sql, expected] of PINNED_PLANS) assert.match(plan(database, sql), expected, sql);
      database.exec("CREATE TEMP TABLE canonical_run_page(position INTEGER PRIMARY KEY,run_id TEXT NOT NULL UNIQUE)");
      assert.equal(plan(database, `SELECT r.* FROM canonical_run_page p CROSS JOIN runs r ON r.id=p.run_id
        WHERE p.position>? AND p.position<=? ORDER BY p.position`),
      "SEARCH p USING INTEGER PRIMARY KEY (rowid>? AND rowid<?)\nSEARCH r USING INDEX sqlite_autoindex_runs_1 (id=?)");
    } finally { database.close(); }
  });

  it("indexes every foreign key whose parent row is deleted, and names each one left out", () => {
    const database = currentStore();
    try {
      const tables = z.array(z.object({ name: z.string() })).parse(database.prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).map(row => row.name);
      const leading = (table: string) => new Set([
        ...z.array(z.object({ name: z.string() })).parse(database.prepare("SELECT name FROM pragma_index_list(?)").all(table))
          .map(index => z.object({ name: z.string().nullable() }).parse(database.prepare("SELECT name FROM pragma_index_info(?) WHERE seqno=0").get(index.name)).name),
        ...z.array(z.object({ name: z.string() })).parse(database.prepare("SELECT name FROM pragma_table_info(?) WHERE pk=1").all(table)).map(column => column.name),
      ]);
      const unindexed = tables.flatMap(table => z.array(z.object({ from: z.string(), seq: z.number() }))
        .parse(database.prepare("SELECT \"from\", seq FROM pragma_foreign_key_list(?)").all(table))
        .filter(key => key.seq === 0 && !leading(table).has(key.from)).map(key => `${table}.${key.from}`));
      assert.deepEqual(unindexed.sort(), Object.keys(UNINDEXED_FOREIGN_KEYS).sort());
    } finally { database.close(); }
  });

  it("upgrades a stopped schema-39 store through the store upgrade", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        restoreSchema39ListIndexes(database);
        assert.equal(inspectNativeAuthority(database, 39).schemaVersion, 39);
      } finally { database.close(); }
      const report = await f.run();
      assert.equal(report.state, "upgraded");
      assert.equal(report.fromSchemaVersion, 39);
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
        const names = schemaObjects(upgraded).map(object => object.name);
        assert.deepEqual(Object.keys(LIST_INDEXES).filter(name => !names.includes(name)), []);
      } finally { upgraded.close(); }
    } finally { await f.dispose(); }
  });
});
