import assert from "node:assert/strict";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SETTINGS_RECORD_CONVERSIONS, SETTINGS_RECORD_CONVERSION_VERSION } from "../../../../src/backend/storage/sqlite/settings-record-conversion.js";
import { NEUTRAL_PERSON_PREFERENCES } from "../../../../src/models/config/person-preferences.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";

it("ends the conversion chain on this build's settings schema; a changed schema needs a new entry and a numbered upgrade", () => {
  assert.equal(SETTINGS_RECORD_CONVERSIONS.at(-1)?.to, SETTINGS_SCHEMA_HASH,
    "the settings schema changed: append a conversion to SETTINGS_RECORD_CONVERSIONS and a migration that runs its marker");
  for (const [index, entry] of SETTINGS_RECORD_CONVERSIONS.entries()) {
    if (index > 0) assert.equal(entry.from, SETTINGS_RECORD_CONVERSIONS[index - 1]?.to);
  }
  assert.equal(new Set(SETTINGS_RECORD_CONVERSIONS.flatMap(entry => [entry.from, entry.to])).size, SETTINGS_RECORD_CONVERSIONS.length + 1);
});

it("adds, across every conversion, exactly the preferences a fresh store starts with", () => {
  assert.deepEqual(Object.assign({}, ...SETTINGS_RECORD_CONVERSIONS.map(entry => entry.adds)), NEUTRAL_PERSON_PREFERENCES);
  assert.equal(SETTINGS_RECORD_CONVERSIONS.flatMap(entry => Object.keys(entry.adds)).length, Object.keys(NEUTRAL_PERSON_PREFERENCES).length);
});

it("keeps the SQL of each numbered upgrade that converts settings records", () => {
  const markers = SQLITE_MIGRATIONS.flatMap(migration => migration.statements.filter(statement => statement.includes("-forward-conversion:"))
    .map(statement => ({ version: migration.version, statement })));
  assert.deepEqual(markers.filter(marker => SETTINGS_RECORD_CONVERSIONS.some(entry => entry.marker === marker.statement)), [
    { version: 16, statement: "SELECT 'person-preferences-forward-conversion:72ab4370a7a2766b8b169abdf2d6725b1cece28ddcd1bae6b70d28ab43ff99b4'" },
    { version: 32, statement: "SELECT 'runs-notifications-settings-forward-conversion:d7c2ef90355d8d28333c353c09625f73aaf2f7de031855cd063f7cddff6fa2f5'" },
    { version: 35, statement: "SELECT 'send-shortcut-forward-conversion:339305dc9e801baea651d0717bc85249238ed4ed708b0414d0cf3edb6ce478d2'" },
  ]);
  assert.equal(SETTINGS_RECORD_CONVERSION_VERSION, 35);
});
