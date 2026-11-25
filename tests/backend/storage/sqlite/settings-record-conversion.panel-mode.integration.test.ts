import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter, inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { readSettingsRecordConversion } from "../../../../src/backend/storage/sqlite/settings-record-conversion.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH, RETIRED_PANEL_MODE } from "../../../../src/models/config/settings-record-conversion.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { CommandAuditRecordSchema, SettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { restorePrePanelModeRetirementSettingsRows } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createSettingsAuthorityTestWorld();
afterEach(world.cleanup);
const modePath = `preferences.${RETIRED_PANEL_MODE}`;
const ObjectSchema = z.record(z.string(), z.unknown());

function save(expectedRevision: number, patch: Record<string, unknown>) {
  return {
    family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z",
    requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  };
}

function readJson(input: unknown) {
  return ObjectSchema.parse(JSON.parse(z.string().parse(input)));
}

it.each([false, true])("upgrades a private schema-41 store with a settled panel-mode change (also changes theme: %s)", async changeTheme => {
  const f = await world.fixture();
  const command = save(1, { "preferences.theme": changeTheme ? { set: "light" } : { clear: true } });
  assert.equal(f.execute(command).state, "applied");
  world.databases.splice(world.databases.indexOf(f.database), 1)[0]?.close();

  const raw = new DatabaseSync(f.path);
  const settingsQuery = raw.prepare("SELECT payload_json FROM settings WHERE id='current'");
  const commandQuery = raw.prepare("SELECT * FROM commands WHERE id=?");
  const auditQuery = raw.prepare("SELECT payload_json FROM command_audits WHERE command_id=?");
  try {
    const current = readAppSettings(raw);
    assert.ok(current?.saved && current.active);
    restorePrePanelModeRetirementSettingsRows(raw);
    const patch = { ...(changeTheme ? command.payload.patch : {}), [modePath]: { set: "sidebar" } };
    const prior = SettingsCommandRequestSchema.parse({ ...command, payload: {
      settingsSchemaHash: PRE_PANEL_MODE_RETIREMENT_SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch,
    } });
    const oldSettings = { preferences: { ...current.saved.settings.preferences, [RETIRED_PANEL_MODE]: "sidebar" } };
    const oldFingerprint = sha256Hex(`hrauto:persisted-settings:v1\0${canonicalJsonStringify(oldSettings)}`);
    const oldAudit = CommandAuditRecordSchema.parse(JSON.parse(z.string().parse(auditQuery.get(command.commandId)?.payload_json)));
    const oldOutcome = canonicalJsonStringify({ ...oldAudit, request: prior, result: { ...oldAudit.result, settingsFingerprint: oldFingerprint } });
    const request = canonicalJsonStringify(prior);

    raw.exec("DROP TRIGGER command_audits_immutable");
    raw.prepare("UPDATE commands SET request_json=?,request_digest=?,outcome_json=? WHERE id=?")
      .run(request, sha256Hex(request), oldOutcome, command.commandId);
    raw.prepare("UPDATE command_audits SET payload_json=? WHERE command_id=?").run(oldOutcome, command.commandId);
    raw.exec("CREATE TRIGGER command_audits_immutable BEFORE UPDATE ON command_audits BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END");
    raw.prepare("UPDATE settings SET payload_json=? WHERE id='current'").run(canonicalJsonStringify({
      ...readJson(settingsQuery.get()?.payload_json),
      saved: { ...current.saved, settings: oldSettings, settingsFingerprint: oldFingerprint,
        commandFingerprint: deriveSettingsCommandFingerprint(prior) },
      active: { ...current.active, settingsFingerprint: oldFingerprint },
    }));
    raw.exec("UPDATE database_states SET schema_version=41; PRAGMA user_version=41");

    assert.equal(SettingsCommandRequestSchema.safeParse({ ...prior, payload: { ...prior.payload, settingsSchemaHash: SETTINGS_SCHEMA_HASH } }).success, false);
    assert.equal(inspectNativeAuthority(raw, 41).schemaVersion, 41);
    const stopped = readAppSettings(raw, readSettingsRecordConversion(raw));
    assert.deepEqual(stopped?.saved?.settings, current.saved.settings);
    assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 41);

    raw.exec("BEGIN EXCLUSIVE");
    try {
      applyAuthorityMigrationsAfter(raw, 41, { now: "2026-11-24T00:00:00.000Z", captureFile: () => { throw new Error("artifact-unexpected"); } });
      raw.exec("UPDATE database_states SET schema_version=42; PRAGMA user_version=42");
      assert.equal(inspectNormalAuthority(raw).schemaVersion, 42);
      raw.exec("COMMIT");
    } catch (error) { raw.exec("ROLLBACK"); throw error; }

    assert.deepEqual(readAppSettings(raw), stopped);
    assert.equal(stopped?.active?.settingsFingerprint, current.saved.settingsFingerprint);
    const migrated = commandQuery.get(command.commandId);
    assert.deepEqual(commandFromRow(migrated), prior);
    assert.equal(migrated?.request_digest, sha256Hex(request));
    assert.equal(migrated?.outcome_json, auditQuery.get(command.commandId)?.payload_json);
    assert.equal(CommandAuditRecordSchema.parse(readJson(migrated?.outcome_json)).result.settingsFingerprint, current.saved.settingsFingerprint);
    assert.throws(() => raw.exec("UPDATE command_audits SET code='changed'"), /retained-evidence-immutable/u);
  } finally { raw.close(); }

  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, f.clock);
  world.databases.push(reopened);
  assert.equal(f.execute(save(2, { "preferences.animations": { set: false } }), reopened).state, "applied");
  assert.deepEqual(reopened.authority.settingsCurrent.get()?.settings, { preferences: { ...(changeTheme ? { theme: "light" } : {}), animations: false } });
});
