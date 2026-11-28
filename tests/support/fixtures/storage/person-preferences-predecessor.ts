import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../src/models/config/person-preferences.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../../src/models/config/settings-initialization.js";
import { PRE_ASSISTANT_FULL_ACCESS_SETTINGS_SCHEMA_HASH, PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH, PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH,
  RETIRED_PANEL_MODE } from "../../../../src/models/config/settings-record-conversion.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

function predecessorSettingsRow(table: string, input: unknown, hash: string, priorSnapshot: (snapshot: z.infer<typeof ConfigSnapshotRecordSchema>) => unknown): Record<string, unknown> {
  const row = z.record(z.string(), z.unknown()).parse(input);
  if (table === "settings_snapshots") {
    const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    return { ...row, payload_json: canonicalJsonStringify(priorSnapshot(snapshot)) };
  }
  if (table === "settings") {
    const record = AppSettingsSchema.parse(JSON.parse(z.string().parse(row.payload_json)));
    record.initialization.settings.settingsSchemaHash = FingerprintSchema.parse(hash);
    return { ...row, payload_json: canonicalJsonStringify(record) };
  }
  if (table === "commands" && row.family === "settings-initialization") {
    const request = SettingsInitializationCommandSchema.parse(JSON.parse(z.string().parse(row.request_json)));
    const audit = row.outcome_json === null ? null : SettingsInitializationAuditSchema.parse(JSON.parse(z.string().parse(row.outcome_json)));
    request.settings.settingsSchemaHash = FingerprintSchema.parse(hash);
    if (audit !== null) audit.request = request;
    const json = canonicalJsonStringify(request);
    return { ...row, request_json: json, request_digest: sha256Hex(json), outcome_json: audit === null ? null : canonicalJsonStringify(audit) };
  }
  if (table === "command_audits") {
    const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(z.string().parse(row.payload_json)));
    if (payload.kind === "settings-initialization") {
      const audit = SettingsInitializationAuditSchema.parse(payload);
      audit.request.settings.settingsSchemaHash = FingerprintSchema.parse(hash);
      return { ...row, payload_json: canonicalJsonStringify(audit) };
    }
  }
  return row;
}


/** The row as a store wrote it before person preferences existed (below schema 16). */
export function prePreferencesSettingsRow(table: string, input: unknown): Record<string, unknown> {
  if (table === "settings") assert.equal(AppSettingsSchema.parse(JSON.parse(z.string().parse(z.record(z.string(), z.unknown()).parse(input).payload_json))).saved?.settings.preferences, undefined);
  return predecessorSettingsRow(table, input, PRE_PREFERENCES_SETTINGS_SCHEMA_HASH, snapshot => {
    assert.deepEqual(snapshot.preferences, NEUTRAL_PERSON_PREFERENCES);
    const { preferences: _preferences, preferencesFingerprint: _fingerprint, ...prior } = snapshot;
    return prior;
  });
}

/** The row as a store wrote it before the Runs and Notifications settings existed (schemas 16 through 31). */
export function preRunsNotificationsSettingsRow(table: string, input: unknown): Record<string, unknown> {
  return predecessorSettingsRow(table, input, PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, snapshot => {
    const { preventSleepWhileRunning, confirmCloseDuringRun, notifications, sendShortcut, assistantFullAccess, ...current } = snapshot.preferences;
    const preferences = { ...current, [RETIRED_PANEL_MODE]: "floating" };
    assert.deepEqual({ preventSleepWhileRunning, confirmCloseDuringRun, notifications, sendShortcut, assistantFullAccess }, { preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run",
      notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" }, sendShortcut: "enter", assistantFullAccess: false });
    return { ...snapshot, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) };
  });
}

/** The row as a store wrote it before the assistant send shortcut existed (schemas 32 through 34). */
export function preSendShortcutSettingsRow(table: string, input: unknown): Record<string, unknown> {
  return predecessorSettingsRow(table, input, PRE_SEND_SHORTCUT_SETTINGS_SCHEMA_HASH, snapshot => {
    const { sendShortcut, assistantFullAccess, ...current } = snapshot.preferences;
    const preferences = { ...current, [RETIRED_PANEL_MODE]: "floating" };
    assert.equal(sendShortcut, "enter");
    assert.equal(assistantFullAccess, false);
    return { ...snapshot, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) };
  });
}

function restorePredecessorSettingsRows(database: DatabaseSync, predecessor: (table: string, row: unknown) => Record<string, unknown>): void {
  const triggers = database.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('settings_snapshots_immutable','command_audits_immutable')").all()
    .map(row => z.object({ name: z.string(), sql: z.string() }).parse(row));
  for (const trigger of triggers) database.exec(`DROP TRIGGER ${trigger.name}`);
  for (const table of ["settings_snapshots", "settings", "commands", "command_audits"]) {
    for (const raw of database.prepare(`SELECT * FROM ${table}`).all()) {
      const row = predecessor(table, raw);
      if (canonicalJsonStringify(row) === canonicalJsonStringify(raw)) continue;
      if (table === "commands") database.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
        .run(z.string().parse(row.request_json), z.string().parse(row.request_digest), z.string().nullable().parse(row.outcome_json), z.string().parse(row.id));
      else database.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(z.string().parse(row.payload_json), z.string().parse(row.id));
    }
  }
  for (const trigger of triggers) database.exec(trigger.sql);
}

export function restorePrePreferencesSettingsRows(database: DatabaseSync): void { restorePredecessorSettingsRows(database, prePreferencesSettingsRow); }
export function restorePreRunsNotificationsSettingsRows(database: DatabaseSync): void { restorePredecessorSettingsRows(database, preRunsNotificationsSettingsRow); }
export function restorePreSendShortcutSettingsRows(database: DatabaseSync): void { restorePredecessorSettingsRows(database, preSendShortcutSettingsRow); }

export function prePanelModeRetirementSnapshot(snapshot: z.infer<typeof ConfigSnapshotRecordSchema>, mode: "floating" | "sidebar") {
  const { assistantFullAccess, ...current } = snapshot.preferences;
  assert.equal(assistantFullAccess, false);
  const preferences = { ...current, [RETIRED_PANEL_MODE]: mode };
  return { ...snapshot, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) };
}

export function restorePrePanelModeRetirementSettingsRows(database: DatabaseSync): void {
  restorePredecessorSettingsRows(database, (table, row) => predecessorSettingsRow(table, row, PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH,
    snapshot => prePanelModeRetirementSnapshot(snapshot, snapshot.revision === 1 ? "floating" : "sidebar")));
}

export function preAssistantFullAccessSnapshot(snapshot: z.infer<typeof ConfigSnapshotRecordSchema>) {
  const { assistantFullAccess, ...preferences } = snapshot.preferences;
  assert.equal(assistantFullAccess, false);
  return { ...snapshot, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) };
}

export function restorePreAssistantFullAccessSettingsRows(database: DatabaseSync): void {
  restorePredecessorSettingsRows(database, (table, row) =>
    predecessorSettingsRow(table, row, PRE_ASSISTANT_FULL_ACCESS_SETTINGS_SCHEMA_HASH, preAssistantFullAccessSnapshot));
}

export function removeSchema16PersonPreferences(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 16);
  restorePrePreferencesSettingsRows(database);
  database.exec("UPDATE database_states SET schema_version=15 WHERE id=1; PRAGMA user_version=15");
}
