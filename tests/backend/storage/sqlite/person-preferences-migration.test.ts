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
import { convertPersonPreferencesRow, convertSendShortcutRow, PERSON_PREFERENCES_CONVERSION_ID, PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH } from "../../../../src/backend/storage/sqlite/person-preferences-migration.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { applyAuthorityMigrationsAfter, inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
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
  applyAuthorityMigrationsAfter(database, 15, { now: "2026-08-20T16:00:00.000Z", captureFile: () => { throw new Error("artifact-unexpected"); } });
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
    // The build-id step deletes the pre-build queued run through its cancel door.
    assert.deepEqual(database.prepare("SELECT * FROM runs").all(), []);
    assert.deepEqual(database.prepare("SELECT run_id, cleanup_state FROM deleted_runs").all().map(row => ({ ...row })), before[4].rows.map(row => ({ run_id: row.id, cleanup_state: "pending" })));
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

/** A schema-29 store: snapshots without sendShortcut and the initialization bound to the schema before it. */
function sendShortcutPredecessor(hash: string = PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH) {
  const database = fixture(); convert(database);
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('settings_snapshots_immutable','command_audits_immutable')").all();
  for (const row of triggers) database.exec(`DROP TRIGGER ${String(row.name)}`);
  for (const raw of database.prepare("SELECT id,payload_json FROM settings_snapshots").all()) {
    const value = z.object({ preferences: z.record(z.string(), z.unknown()) }).passthrough().parse(JSON.parse(String(raw.payload_json)));
    const { sendShortcut: _sendShortcut, ...preferences } = value.preferences;
    database.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?").run(canonicalJsonStringify({ ...value, preferences,
      preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) }), String(raw.id));
  }
  const previous = (json: unknown) => String(json).replaceAll(SETTINGS_SCHEMA_HASH, hash);
  database.prepare("UPDATE settings SET payload_json=?").run(previous(database.prepare("SELECT payload_json FROM settings").get()?.payload_json));
  for (const row of database.prepare("SELECT id,request_json,outcome_json FROM commands").all()) {
    const request = previous(row.request_json);
    database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?").run(request, sha256Hex(request), row.outcome_json === null ? null : previous(row.outcome_json), String(row.id));
  }
  database.exec(`UPDATE command_audits SET payload_json=replace(payload_json,'${SETTINGS_SCHEMA_HASH}','${hash}')`);
  for (const row of triggers) database.exec(String(row.sql));
  database.prepare("UPDATE database_states SET schema_version=29").run();
  database.exec("PRAGMA user_version=29");
  return database;
}
function convertFrom29(database: DatabaseSync) {
  applyAuthorityMigrationsAfter(database, 29, { now: "2026-11-14T16:00:00.000Z", captureFile: () => { throw new Error("artifact-unexpected"); } });
  database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
  database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
}

it("binds the predecessor schema hash and keeps migration 16's frozen conversion id", () => {
  assert.equal(PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH, "39fde8a538405f533301def527db504117799174867cc4d93beb55310382f29a");
  assert.notEqual(SETTINGS_SCHEMA_HASH, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH);
  assert.equal(PERSON_PREFERENCES_CONVERSION_ID, "72ab4370a7a2766b8b169abdf2d6725b1cece28ddcd1bae6b70d28ab43ff99b4");
});
it("opens a schema-29 store with every stored value kept and Send shortcut at Enter; rollback preserves the source", () => {
  const database = sendShortcutPredecessor();
  try {
    const before = rows(database);
    assert.throws(() => readAppSettings(database));
    assert.equal(inspectNativeAuthority(database, 29).schemaVersion, 29);
    database.exec("BEGIN EXCLUSIVE"); convertFrom29(database); database.exec("ROLLBACK");
    assert.deepEqual(rows(database), before);
    database.exec("BEGIN EXCLUSIVE"); convertFrom29(database); database.exec("COMMIT");
    assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const after = readAppSettings(database); assert.ok(after);
    assert.equal(after.initialization.settings.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.deepEqual(after.initialization.settings.settings, {});
    for (const [index, raw] of database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all().entries()) {
      const original = before[0].rows[index];
      assert.equal(raw.id, original.id); assert.equal(raw.fingerprint, original.fingerprint); assert.equal(raw.revision, original.revision);
      const value = ConfigSnapshotRecordSchema.parse(JSON.parse(String(raw.payload_json)));
      const prior = z.object({ config: z.unknown(), preferences: z.record(z.string(), z.unknown()) }).parse(JSON.parse(String(original.payload_json)));
      assert.equal(canonicalJsonStringify(value.config), canonicalJsonStringify(prior.config));
      assert.deepEqual(value.preferences, { ...prior.preferences, sendShortcut: "enter" });
    }
    assert.throws(() => database.exec("UPDATE settings_snapshots SET revision=revision+1"), /retained-evidence-immutable/);
    assert.throws(() => database.exec("UPDATE command_audits SET code='changed'"), /retained-evidence-immutable/);
  } finally { database.close(); }
});
it("still refuses a store bound to any other settings schema", () => {
  const database = sendShortcutPredecessor(sha256Hex("another-settings-schema"));
  try {
    assert.throws(() => inspectNativeAuthority(database, 29));
    assert.equal(convertSendShortcutRow("settings", database.prepare("SELECT * FROM settings").get()).payload_json, database.prepare("SELECT payload_json FROM settings").get()?.payload_json);
  } finally { database.close(); }
});
