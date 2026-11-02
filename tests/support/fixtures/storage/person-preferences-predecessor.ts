import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../src/models/config/person-preferences.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../../src/models/config/settings-initialization.js";
import { PRE_PREFERENCES_SETTINGS_SCHEMA_HASH } from "../../../../src/backend/storage/sqlite/person-preferences-migration.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

export function removeSchema16PersonPreferences(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 16);
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('settings_snapshots_immutable','command_audits_immutable')").all()
    .map(row => z.object({ name: z.string(), sql: z.string() }).parse(row));
  for (const trigger of triggers) database.exec(`DROP TRIGGER ${trigger.name}`);
  for (const raw of database.prepare("SELECT id,payload_json FROM settings_snapshots").all()) {
    const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(String(raw.payload_json)));
    assert.deepEqual(snapshot.preferences, NEUTRAL_PERSON_PREFERENCES);
    const { preferences: _preferences, preferencesFingerprint: _fingerprint, ...prior } = snapshot;
    database.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?").run(canonicalJsonStringify(prior), String(raw.id));
  }
  for (const raw of database.prepare("SELECT id,payload_json FROM settings").all()) {
    const record = AppSettingsSchema.parse(JSON.parse(String(raw.payload_json)));
    assert.equal(record.saved?.settings.preferences, undefined);
    record.initialization.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
    database.prepare("UPDATE settings SET payload_json=? WHERE id=?").run(canonicalJsonStringify(record), String(raw.id));
  }
  for (const raw of database.prepare("SELECT id,request_json,outcome_json FROM commands WHERE family='settings-initialization'").all()) {
    const request = SettingsInitializationCommandSchema.parse(JSON.parse(String(raw.request_json)));
    const audit = raw.outcome_json === null ? null : SettingsInitializationAuditSchema.parse(JSON.parse(String(raw.outcome_json)));
    request.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
    if (audit !== null) audit.request = request;
    const json = canonicalJsonStringify(request);
    database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
      .run(json, sha256Hex(json), audit === null ? null : canonicalJsonStringify(audit), String(raw.id));
    if (audit !== null) database.prepare("UPDATE command_audits SET payload_json=? WHERE id=?").run(canonicalJsonStringify(audit), audit.auditId);
  }
  for (const trigger of triggers) database.exec(trigger.sql);
  database.exec("UPDATE database_states SET schema_version=15 WHERE id=1; PRAGMA user_version=15");
}
