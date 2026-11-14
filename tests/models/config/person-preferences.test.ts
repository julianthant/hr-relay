import assert from "node:assert/strict";
import { it } from "vitest";
import { PersonPreferencesSchema, NEUTRAL_PERSON_PREFERENCES, resolvePersonPreferences, derivePersonPreferencesFingerprint } from "../../../src/models/config/person-preferences.js";
import { mergeSettingsPatch } from "../../../src/models/config/settings.js";
import { SETTINGS_CATALOG } from "../../../src/models/config/catalog.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";

it("resolves only the existing preference leaves and preserves the execution fingerprint", () => {
  const settings = mergeSettingsPatch({}, { "preferences.theme": { set: "light" }, "preferences.shortcuts.bindings.start": { set: ["Meta+Shift+r"] } });
  const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}));
  const resolved = resolveConfigWithProvenance(settings, hostConfigFacts({}));
  assert.equal(resolved.preferences.theme, "light"); assert.deepEqual(resolved.preferences.shortcuts.bindings.start, ["Meta+Shift+r"]);
  assert.deepEqual(resolved.preferences.shortcuts.bindings.next, NEUTRAL_PERSON_PREFERENCES.shortcuts.bindings.next);
  assert.equal(resolved.fingerprint, defaults.fingerprint); assert.deepEqual(resolved.config, defaults.config);
  assert.notEqual(resolved.preferencesFingerprint, defaults.preferencesFingerprint);
  assert.equal(derivePersonPreferencesFingerprint(resolved.preferences), resolved.preferencesFingerprint);
  assert.deepEqual(resolvePersonPreferences(), NEUTRAL_PERSON_PREFERENCES);
});
it("refuses unknown fields, invalid enums and coupled shortcut collisions", () => {
  assert.throws(() => mergeSettingsPatch({}, { "preferences.theme": { set: "pink" } }));
  assert.throws(() => mergeSettingsPatch({}, { "preferences.newControl": { set: true } }));
  assert.throws(() => resolvePersonPreferences({ shortcuts: { bindings: { search: ["r"] } } }), /already assigned/);
  assert.equal(PersonPreferencesSchema.safeParse({ ...NEUTRAL_PERSON_PREFERENCES, animations: "off" }).success, false);
});
it("requires current preference fields and authenticates their exact persisted snapshot values", () => {
  const { preferences: _preferences, preferencesFingerprint: _fingerprint, ...oldSnapshot } = CONFIG_SNAPSHOT;
  assert.equal(ConfigSnapshotRecordSchema.safeParse(oldSnapshot).success, false);
  assert.equal(ConfigSnapshotRecordSchema.safeParse({ ...CONFIG_SNAPSHOT, preferences: { ...CONFIG_SNAPSHOT.preferences, theme: "light" } }).success, false);
  assert.equal(ConfigSnapshotRecordSchema.safeParse(CONFIG_SNAPSHOT).success, true);
});
it("sends on Enter until the person picks Command-Enter, as one catalogued leaf", () => {
  assert.equal(resolvePersonPreferences().sendShortcut, "enter");
  assert.equal(resolvePersonPreferences(mergeSettingsPatch({}, { "preferences.sendShortcut": { set: "mod-enter" } }).preferences).sendShortcut, "mod-enter");
  assert.equal(mergeSettingsPatch(mergeSettingsPatch({}, { "preferences.sendShortcut": { set: "mod-enter" } }), { "preferences.sendShortcut": { clear: true } }).preferences?.sendShortcut, undefined);
  assert.throws(() => mergeSettingsPatch({}, { "preferences.sendShortcut": { set: "shift-enter" } }));
  assert.deepEqual(SETTINGS_CATALOG.filter(row => row.key === "preferences.sendShortcut").map(row => [row.schema, row.defaultKind, row.sourceClass]), [["z.enum", "contract", "ordinary-settings"]]);
});
