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

export function prePreferencesSettingsRow(table: string, input: unknown): Record<string, unknown> {
  const row = z.record(z.string(), z.unknown()).parse(input);
  if (table === "settings_snapshots") {
    const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    assert.deepEqual(snapshot.preferences, NEUTRAL_PERSON_PREFERENCES);
    const { preferences: _preferences, preferencesFingerprint: _fingerprint, ...prior } = snapshot;
    return { ...row, payload_json: canonicalJsonStringify(prior) };
  }
  if (table === "settings") {
    const record = AppSettingsSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    assert.equal(record.saved?.settings.preferences, undefined);
    record.initialization.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
    return { ...row, payload_json: canonicalJsonStringify(record) };
  }
  if (table === "commands" && row.family === "settings-initialization") {
    const request = SettingsInitializationCommandSchema.parse(JSON.parse(z.string().parse(row.request_json)));
    const audit = row.outcome_json === null ? null : SettingsInitializationAuditSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
    request.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
    if (audit !== null) audit.request = request;
    const json = canonicalJsonStringify(request);
    return { ...row, request_json: json, request_digest: sha256Hex(json), outcome_json: audit === null ? null : canonicalJsonStringify(audit) };
  }
  if (table === "command_audits") {
    const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(z.string().parse(row.payload_json)));
    if (payload.kind === "settings-initialization") {
      const audit = SettingsInitializationAuditSchema.parse(payload);
      audit.request.settings.settingsSchemaHash = FingerprintSchema.parse(PRE_PREFERENCES_SETTINGS_SCHEMA_HASH);
      return { ...row, payload_json: canonicalJsonStringify(audit) };
    }
  }
  return row;
}

export function restorePrePreferencesSettingsRows(database: DatabaseSync): void {
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('settings_snapshots_immutable','command_audits_immutable')").all()
    .map(row => z.object({ name: z.string(), sql: z.string() }).parse(row));
  for (const trigger of triggers) database.exec(`DROP TRIGGER ${trigger.name}`);
  for (const table of ["settings_snapshots", "settings", "commands", "command_audits"]) {
    for (const raw of database.prepare(`SELECT * FROM ${table}`).all()) {
      const row = prePreferencesSettingsRow(table, raw);
      if (canonicalJsonStringify(row) === canonicalJsonStringify(raw)) continue;
      if (table === "commands") database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
        .run(z.string().parse(row.request_json), z.string().parse(row.request_digest), z.string().nullable().parse(row.outcome_json), z.string().parse(row.id));
      else database.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(z.string().parse(row.payload_json), z.string().parse(row.id));
    }
  }
  for (const trigger of triggers) database.exec(trigger.sql);
}

export function removeSchema16PersonPreferences(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 16);
  restorePrePreferencesSettingsRows(database);
  database.exec("UPDATE database_states SET schema_version=15 WHERE id=1; PRAGMA user_version=15");
}
