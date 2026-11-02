import { z } from "zod";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../../src/models/config/settings-initialization.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { convertPersonPreferencesRow, migratePersonPreferences, PRE_PREFERENCES_SETTINGS_SCHEMA_HASH } from "../../../../src/backend/storage/sqlite/person-preferences-migration.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../src/models/config/person-preferences.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT, NOW, UUID_2, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(row => row.version < 16)) for (const statement of migration.statements) database.exec(statement);
  database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=15`);
  database.prepare("INSERT INTO database_states VALUES(1,15,0,?,NULL,'unbuilt',?,?)").run(NOW, UUID_2, UUID_3);
  const repositories = createSettingsActivationRepositories({ database,
    mutate: work => work().result,
    readRecord(table, key, schema) { const row = database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key); return row === undefined ? undefined : schema.parse(table === "commands" ? commandFromRow(row) : JSON.parse(String(row.payload_json))); },
  });
  repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('settings_snapshots_immutable','command_audits_immutable')").all();
  for (const row of triggers) database.exec(`DROP TRIGGER ${String(row.name)}`);
  const legacy = { ...CONFIG_SNAPSHOT }; const { preferences: _preferences, preferencesFingerprint: _fingerprint, ...snapshot } = legacy;
  database.prepare("UPDATE settings_snapshots SET payload_json=?").run(canonicalJsonStringify(snapshot));
  database.prepare("INSERT INTO settings_snapshots VALUES(?,?,?,?,?)").run(UUID_3, 2, snapshot.fingerprint, canonicalJsonStringify({ ...snapshot, configSnapshotId: UUID_3, revision: 2 }), NOW);
  const settings = AppSettingsSchema.parse(JSON.parse(String(database.prepare("SELECT payload_json FROM settings").get()?.payload_json)));
  settings.initialization.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
  database.prepare("UPDATE settings SET payload_json=?").run(canonicalJsonStringify(settings));
  const command = SettingsInitializationCommandSchema.parse(JSON.parse(String(database.prepare("SELECT request_json FROM commands").get()?.request_json)));
  command.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
  const audit = SettingsInitializationAuditSchema.parse(JSON.parse(String(database.prepare("SELECT payload_json FROM command_audits").get()?.payload_json))); audit.request = command;
  database.prepare("UPDATE command_audits SET payload_json=?").run(canonicalJsonStringify(audit));
  database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=?").run(canonicalJsonStringify(command), sha256Hex(canonicalJsonStringify(command)), canonicalJsonStringify(audit));
  for (const row of triggers) database.exec(String(row.sql));
  const run = runRecordColumns(RunRecordSchema.parse(QUEUED_RUN));
  database.prepare(`INSERT INTO runs(${Object.keys(run).join(",")}) VALUES(${Object.keys(run).map(() => "?").join(",")})`).run(...Object.values(run));
  return database;
}
function convert(database: DatabaseSync) {
  const migration = SQLITE_MIGRATIONS.find(row => row.version === 16); assert.ok(migration);
  for (const [index, statement] of migration.statements.entries()) { database.exec(statement); if (index === 2) migratePersonPreferences(database); }
  database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
  database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
}
function rows(database: DatabaseSync) { return ["settings_snapshots", "settings", "commands", "command_audits", "runs"].map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table} ORDER BY id`).all() })); }

it("converts accepted snapshots and exact initialization links without changing execution identities; rollback preserves the source", () => {
  const database = fixture();
  try {
    const before = rows(database);
    assert.throws(() => readAppSettings(database));
    assert.equal(inspectNativeAuthority(database, 15).schemaVersion, 15);
    assert.equal(readAppSettings(database, convertPersonPreferencesRow)?.initialization.configSnapshotId, CONFIG_SNAPSHOT.configSnapshotId);
    database.exec("BEGIN EXCLUSIVE"); convert(database); database.exec("ROLLBACK");
    assert.deepEqual(rows(database), before);
    database.exec("BEGIN EXCLUSIVE"); convert(database); database.exec("COMMIT");
    assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const after = readAppSettings(database); assert.ok(after);
    assert.deepEqual(database.prepare("SELECT * FROM runs ORDER BY id").all(), before[4].rows);
    assert.equal(after.initialization.configSnapshotId, CONFIG_SNAPSHOT.configSnapshotId);
    assert.equal(after.initialization.configFingerprint, CONFIG_SNAPSHOT.fingerprint);
    assert.equal(after.initialization.commandId, z.object({ initialization: z.object({ commandId: z.string() }) }).parse(JSON.parse(String(before[1].rows[0].payload_json))).initialization.commandId);
    for (const [index, raw] of database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all().entries()) {
      const original = before[0].rows[index];
      assert.equal(raw.id, original.id); assert.equal(raw.fingerprint, original.fingerprint); assert.equal(raw.revision, original.revision);
      const value = ConfigSnapshotRecordSchema.parse(JSON.parse(String(raw.payload_json)));
      assert.equal(canonicalJsonStringify(value.config), canonicalJsonStringify(z.object({ config: z.unknown() }).parse(JSON.parse(String(original.payload_json))).config));
      assert.deepEqual(value.preferences, NEUTRAL_PERSON_PREFERENCES);
    }
    assert.throws(() => database.exec("UPDATE settings_snapshots SET revision=revision+1"), /retained-evidence-immutable/);
    assert.throws(() => database.exec("UPDATE command_audits SET code='changed'"), /retained-evidence-immutable/);
  } finally { database.close(); }
});
it.each(["fingerprint", "schema", "unexpected-preferences"])("refuses invalid predecessor %s and rolls back every converted row", kind => {
  const database = fixture();
  try {
    database.exec("DROP TRIGGER settings_snapshots_immutable");
    if (kind === "fingerprint") database.exec("UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.fingerprint','invalid')");
    if (kind === "schema") database.exec("UPDATE settings SET payload_json=json_set(payload_json,'$.initialization.settings.settingsSchemaHash','invalid')");
    if (kind === "unexpected-preferences") database.exec("UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.preferences.theme','light')");
    database.exec("CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON settings_snapshots BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END");
    const before = rows(database);
    database.exec("BEGIN EXCLUSIVE"); assert.throws(() => convert(database)); database.exec("ROLLBACK");
    assert.deepEqual(rows(database), before);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 15);
  } finally { database.close(); }
});
