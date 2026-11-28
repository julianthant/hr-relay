import assert from "node:assert/strict";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SETTINGS_RECORD_CONVERSIONS, SETTINGS_RECORD_CONVERSION_VERSION, convertSettingsRecordRow } from "../../../../src/backend/storage/sqlite/settings-record-conversion.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../src/models/config/person-preferences.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";

it("retires a saved panel mode from a predecessor snapshot and authenticates the remaining preferences", () => {
  const historicalDefaults = SETTINGS_RECORD_CONVERSIONS[0]?.adds ?? {};
  const modeKey = Object.keys(historicalDefaults).find(key => historicalDefaults[key] === "floating");
  assert.ok(modeKey);
  const { assistantFullAccess: _fullAccess, ...prior } = NEUTRAL_PERSON_PREFERENCES;
  const remaining = { ...NEUTRAL_PERSON_PREFERENCES, theme: "light" };
  const preferences = { ...prior, theme: "light", [modeKey]: "sidebar" };
  const before = { ...CONFIG_SNAPSHOT, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) };
  const row = convertSettingsRecordRow("settings_snapshots", { payload_json: canonicalJsonStringify(before) });
  assert.ok(typeof row.payload_json === "string");
  const after: unknown = JSON.parse(row.payload_json);
  assert.deepEqual(after, {
    ...CONFIG_SNAPSHOT, preferences: remaining,
    preferencesFingerprint: sha256Hex(canonicalJsonStringify(remaining)),
  });
  ConfigSnapshotRecordSchema.parse(after);
  assert.deepEqual(convertSettingsRecordRow("settings_snapshots", row), row);
});

it("ends the conversion chain on this build's settings schema; a changed schema needs a new entry and a numbered upgrade", () => {
  assert.equal(SETTINGS_RECORD_CONVERSIONS.at(-1)?.to, SETTINGS_SCHEMA_HASH,
    "the settings schema changed: append a conversion to SETTINGS_RECORD_CONVERSIONS and a migration that runs its marker");
  for (const [index, entry] of SETTINGS_RECORD_CONVERSIONS.entries()) {
    if (index > 0) assert.equal(entry.from, SETTINGS_RECORD_CONVERSIONS[index - 1]?.to);
  }
  assert.equal(new Set(SETTINGS_RECORD_CONVERSIONS.flatMap(entry => [entry.from, entry.to])).size, SETTINGS_RECORD_CONVERSIONS.length + 1);
});

it("adds and retires, across every conversion, exactly the preferences a fresh store starts with", () => {
  const defaults: Record<string, unknown> = {};
  for (const { adds, removes } of SETTINGS_RECORD_CONVERSIONS) {
    for (const [key, value] of Object.entries(adds)) {
      assert.equal(Object.hasOwn(defaults, key), false);
      defaults[key] = value;
    }
    for (const key of removes ?? []) {
      assert.equal(Object.hasOwn(defaults, key), true);
      delete defaults[key];
    }
  }
  assert.deepEqual(defaults, NEUTRAL_PERSON_PREFERENCES);
});

it("keeps the SQL of each numbered upgrade that converts settings records", () => {
  const markers = SQLITE_MIGRATIONS.flatMap(migration => migration.statements.filter(statement => statement.includes("-forward-conversion:"))
    .map(statement => ({ version: migration.version, statement })));
  assert.deepEqual(markers.filter(marker => SETTINGS_RECORD_CONVERSIONS.some(entry => entry.marker === marker.statement)), [
    { version: 16, statement: "SELECT 'person-preferences-forward-conversion:72ab4370a7a2766b8b169abdf2d6725b1cece28ddcd1bae6b70d28ab43ff99b4'" },
    { version: 32, statement: "SELECT 'runs-notifications-settings-forward-conversion:d7c2ef90355d8d28333c353c09625f73aaf2f7de031855cd063f7cddff6fa2f5'" },
    { version: 35, statement: "SELECT 'send-shortcut-forward-conversion:339305dc9e801baea651d0717bc85249238ed4ed708b0414d0cf3edb6ce478d2'" },
    { version: 42, statement: "SELECT 'panel-mode-retirement-forward-conversion:ab406fb0f82e2e6e87054d731aba99033fadeb13a2fc43261c41c769b6e67e3e'" },
    { version: 45, statement: "SELECT 'assistant-full-access-forward-conversion:56a4aa510c0594c70ada31d78439d3b63abb6a43ea00b82bb72b6ea04a118f63'" },
  ]);
  assert.equal(SETTINGS_RECORD_CONVERSION_VERSION, 45);
});
