import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { NativeCommandAuditSchema, commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { FAILURE_NOTE_REMOVAL_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/failure-note-removal-migration.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { regressSchema34FailureNotes, regressSchema35SendShortcut, removeSchema36WorkbookSyncStatus } from "../../../support/fixtures/storage/historical-run-schema.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { LATER, NOW, UUID_1, UUID_2, UUID_3, UUID_4, UUID_5, UUID_6, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const AT = "2026-11-17T00:00:00.000Z";
const CAPTURE = { now: AT, captureFile: () => { throw new Error("no capture expected"); } };

/** A failure resolution request as schema 33 stored it: `resolve` could carry a note. */
function resolution(commandId: string, payload: Record<string, unknown>) {
  return { commandId, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", reason: "Synthetic failure follow-up",
    family: "failure-resolution", type: "annotate-failure", target: { runId: UUID_2, failureId: UUID_3, expectedVersion: 1 }, payload };
}
function auditOf(auditId: string, request: ReturnType<typeof resolution>) {
  const target = { family: "failure-resolution", runId: UUID_2, failureId: UUID_3 };
  return { auditId, request, result: { state: "applied", commandId: request.commandId, affectedTargets: [target] }, completedAt: LATER,
    versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [] };
}

/** Writes a command and its audit as schema 33 wrote them, bypassing the current grammar. */
function insertSettled(database: DatabaseSync, request: ReturnType<typeof resolution>, auditId: string): void {
  const json = canonicalJsonStringify(request), audit = canonicalJsonStringify(auditOf(auditId, request));
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES(?,'failure-resolution','local-operator',NULL,?,?,?,'succeeded',?,?,?)`).run(request.commandId, UUID_2, sha256Hex(json), json, audit, NOW, LATER);
  database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)").run(auditId, request.commandId, audit, LATER);
}

const noted = resolution(UUID_1, { action: "resolve", note: "Checked the record by hand" });
const plain = resolution(UUID_4, { action: "resolve" });
const reopened = resolution(UUID_6, { action: "reopen" });
const { note: _note, ...strippedPayload } = noted.payload;
const stripped = { ...noted, payload: strippedPayload };

function seed(database: DatabaseSync): void {
  insertSettled(database, noted, UUID_5);
  insertSettled(database, plain, UUID_7);
  const json = canonicalJsonStringify(reopened);
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES(?,'failure-resolution','local-operator',NULL,?,?,?,'admitted',NULL,?,?)`).run(reopened.commandId, UUID_2, sha256Hex(json), json, NOW, NOW);
}

const row = (database: DatabaseSync, table: "commands" | "command_audits", id: string) => database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const schemaObjects = (database: DatabaseSync) => database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(object => ({ ...object }));

function schema33(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 33)) for (const statement of migration.statements) database.exec(statement);
  return database;
}

describe("failure note removal migration 34", () => {
  it("is schema version 34, under the current schema 48, and changes no table", () => {
    assert.equal(FAILURE_NOTE_REMOVAL_SCHEMA_VERSION, 34);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 48);
    assert.deepEqual(migrationTableNames(34), migrationTableNames(33));
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("strips the note from a stored command, its outcome and its audit, and keeps every other row and schema object", () => {
    const database = schema33();
    try {
      seed(database);
      assert.throws(() => commandFromRow(row(database, "commands", UUID_1)), /unrecognized_keys|Unrecognized key/u);
      const unchanged = [row(database, "commands", UUID_4), row(database, "commands", UUID_6), row(database, "command_audits", UUID_7)];
      const others = migrationTableNames(33).filter(table => table !== "commands" && table !== "command_audits")
        .map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
      database.exec("BEGIN");
      applyAuthorityMigrationsAfter(database, 33, CAPTURE);
      database.exec("COMMIT");
      const command = row(database, "commands", UUID_1);
      assert.equal(command?.request_json, canonicalJsonStringify(stripped));
      assert.equal(command?.request_digest, sha256Hex(canonicalJsonStringify(stripped)));
      assert.equal(command?.outcome_json, canonicalJsonStringify(auditOf(UUID_5, stripped)));
      assert.deepEqual(commandFromRow(command), stripped);
      assert.equal(row(database, "command_audits", UUID_5)?.payload_json, canonicalJsonStringify(auditOf(UUID_5, stripped)));
      assert.deepEqual(NativeCommandAuditSchema.parse(JSON.parse(String(row(database, "command_audits", UUID_5)?.payload_json))), auditOf(UUID_5, stripped));
      assert.equal(JSON.stringify(database.prepare("SELECT request_json,outcome_json FROM commands").all()).includes("Checked the record"), false);
      assert.equal(JSON.stringify(database.prepare("SELECT payload_json FROM command_audits").all()).includes("Checked the record"), false);
      assert.deepEqual([row(database, "commands", UUID_4), row(database, "commands", UUID_6), row(database, "command_audits", UUID_7)], unchanged);
      assert.deepEqual(migrationTableNames(33).filter(table => table !== "commands" && table !== "command_audits")
        .map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), others);
      const current = new DatabaseSync(":memory:");
      try {
        for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) current.exec(statement);
        assert.deepEqual(schemaObjects(database), schemaObjects(current));
      } finally { current.close(); }
      assert.throws(() => database.exec(`UPDATE command_audits SET created_at='later' WHERE id='${UUID_5}'`), /retained-evidence-immutable/u);
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { database.close(); }
  });

  it("stops on a stored command whose digest does not match its request and leaves the store unchanged", () => {
    const database = schema33();
    try {
      seed(database);
      database.prepare("UPDATE commands SET request_digest='tampered' WHERE id=?").run(UUID_1);
      const rows = database.prepare("SELECT * FROM commands ORDER BY id").all();
      database.exec("BEGIN");
      assert.throws(() => applyAuthorityMigrationsAfter(database, 33, CAPTURE), /command-row-identity-mismatch/u);
      database.exec("ROLLBACK");
      assert.deepEqual(database.prepare("SELECT * FROM commands ORDER BY id").all(), rows);
    } finally { database.close(); }
  });

  it("validates and upgrades a schema-33 store that holds a note-bearing failure resolution", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        removeSchema36WorkbookSyncStatus(database);
        regressSchema35SendShortcut(database);
        regressSchema34FailureNotes(database);
        seed(database);
        assert.equal(inspectNativeAuthority(database, 33).schemaVersion, 33);
      } finally { database.close(); }
      assert.equal((await f.run()).state, "upgraded");
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(upgraded.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
        assert.deepEqual(commandFromRow(row(upgraded, "commands", UUID_1)), stripped);
        assert.deepEqual(commandFromRow(row(upgraded, "commands", UUID_4)), plain);
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      } finally { upgraded.close(); }
    } finally { await f.dispose(); }
  });
});
