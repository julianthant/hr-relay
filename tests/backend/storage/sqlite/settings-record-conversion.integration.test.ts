import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { convertSettingsRecordRow } from "../../../../src/backend/storage/sqlite/settings-record-conversion.js";
import { PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH, RETIRED_PANEL_MODE } from "../../../../src/models/config/settings-record-conversion.js";
import { migrateSettingsRecords, readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { preRunsNotificationsSettingsRow, restorePreAssistantFullAccessSettingsRows, restorePreRunsNotificationsSettingsRows } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { restoreSchema32CommandRows, restoreSchema45RunSearch } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createSettingsAuthorityTestWorld();
afterEach(world.cleanup);

const ADDED_DEFAULTS = { preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run", notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" }, sendShortcut: "enter", assistantFullAccess: false };
const SAVED_BEFORE = { "concurrency.defaultWorkers": { set: 3 }, "preferences.theme": { set: "light" } };
const CONVERTED_TABLES = ["settings_snapshots", "settings", "commands", "command_audits"];
const PayloadSchema = z.object({ payload_json: z.string() });

function save(expectedRevision: number, patch: Record<string, unknown>) {
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}
function tables(database: DatabaseSync) {
  return Object.fromEntries(migrationTableNames(31).map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))]));
}
function triggers(database: DatabaseSync) {
  return database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN ('settings_snapshots_immutable','command_audits_immutable') ORDER BY name").all().map(row => ({ ...row }));
}
function snapshots(database: DatabaseSync) {
  return database.prepare("SELECT payload_json FROM settings_snapshots ORDER BY id").all().map(row => z.record(z.string(), z.unknown()).parse(JSON.parse(PayloadSchema.parse(row).payload_json)));
}
function upgrade(database: DatabaseSync, from = 31) {
  database.exec("BEGIN EXCLUSIVE");
  try {
    applyAuthorityMigrationsAfter(database, from, { now: "2026-11-16T00:00:00.000Z", captureFile: () => { throw new Error("artifact-unexpected"); } });
    database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; COMMIT`);
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

it("upgrades schema 44, leaves Full access off, and persists an explicit opt-in only in its own store", async () => {
  const f = await world.fixture();
  assert.equal(f.execute(save(1, SAVED_BEFORE)).state, "applied");
  world.databases.splice(world.databases.indexOf(f.database), 1)[0]?.close();
  {
    using raw = new DatabaseSync(f.path);
    restoreSchema45RunSearch(raw);
    restorePreAssistantFullAccessSettingsRows(raw);
    raw.exec("UPDATE database_states SET schema_version=44; PRAGMA user_version=44");
    const prior = snapshots(raw), priorTriggers = triggers(raw);
    assert.equal(inspectNativeAuthority(raw, 44).schemaVersion, 44);
    upgrade(raw, 44);
    assert.equal(inspectNormalAuthority(raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(triggers(raw), priorTriggers);
    assert.equal(readAppSettings(raw)?.saved?.settings.preferences?.assistantFullAccess, undefined);
    assert.deepEqual(snapshots(raw).map(snapshot => ConfigSnapshotRecordSchema.parse(snapshot).preferences),
      prior.map(snapshot => ({ ...z.record(z.string(), z.unknown()).parse(snapshot.preferences), assistantFullAccess: false })));
  }
  const open = () => {
    const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, f.clock);
    world.databases.push(database);
    return database;
  };
  const database = open();
  assert.equal(f.execute(save(2, { "preferences.assistantFullAccess": { set: true } }), database).state, "applied");
  world.databases.splice(world.databases.indexOf(database), 1)[0]?.close();
  assert.deepEqual(open().authority.settingsCurrent.get()?.settings, { concurrency: { defaultWorkers: 3 }, preferences: { theme: "light", assistantFullAccess: true } });
  const other = await world.fixture();
  assert.equal(other.database.authority.settingsCurrent.get()?.settings.preferences?.assistantFullAccess, undefined);
});

/** A store an older build wrote at schema 31: one saved settings revision, every settings row at the previous settings schema. */
async function schema31Store() {
  const f = await world.fixture();
  assert.equal(f.execute(save(1, SAVED_BEFORE)).state, "applied");
  world.databases.splice(world.databases.indexOf(f.database), 1)[0]?.close();
  const raw = new DatabaseSync(f.path);
  raw.exec("PRAGMA foreign_keys=ON");
  restorePreRunsNotificationsSettingsRows(raw);
  restoreSchema32CommandRows(raw);
  raw.exec("UPDATE database_states SET schema_version=31; PRAGMA user_version=31");
  return { ...f, raw };
}

it("upgrades a schema-31 store: every settings value is kept, the later preference defaults are added, nothing else changes and a save is accepted", async () => {
  const f = await schema31Store();
  try {
    const before = tables(f.raw), priorTriggers = triggers(f.raw), priorSnapshots = snapshots(f.raw);
    assert.equal(priorTriggers.length, 2);
    assert.ok(priorSnapshots.length >= 2 && priorSnapshots.every(snapshot => !Object.hasOwn(z.record(z.string(), z.unknown()).parse(snapshot.preferences), "notifications")));
    assert.throws(() => readAppSettings(f.raw), /does not match this build's/u);
    assert.equal(inspectNativeAuthority(f.raw, 31).schemaVersion, 31);
    const stopped = readAppSettings(f.raw, convertSettingsRecordRow);
    assert.deepEqual(stopped?.saved?.settings, { concurrency: { defaultWorkers: 3 }, preferences: { theme: "light" } });

    upgrade(f.raw);

    assert.equal(inspectNormalAuthority(f.raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const after = tables(f.raw);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table], rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (CONVERTED_TABLES.includes(table)) assert.deepEqual(after[table]?.map(row => preRunsNotificationsSettingsRow(table, row)), rows, table);
      else assert.deepEqual(after[table], rows, table);
    }
    const upgraded = readAppSettings(f.raw);
    assert.deepEqual(upgraded?.saved, stopped.saved);
    assert.equal(upgraded?.initialization.settings.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.deepEqual({ ...upgraded?.initialization, settings: null }, { ...stopped.initialization, settings: null });
    for (const [index, snapshot] of snapshots(f.raw).entries()) {
      const record = ConfigSnapshotRecordSchema.parse(snapshot);
      const { [RETIRED_PANEL_MODE]: retired, ...prior } = z.record(z.string(), z.unknown()).parse(priorSnapshots[index]?.preferences);
      assert.equal(retired, "floating");
      assert.deepEqual(record.preferences, { ...prior, ...ADDED_DEFAULTS });
      assert.equal(canonicalJsonStringify({ ...record, preferences: null, preferencesFingerprint: null }), canonicalJsonStringify({ ...priorSnapshots[index], preferences: null, preferencesFingerprint: null }));
    }
    assert.equal(snapshots(f.raw).some(snapshot => ConfigSnapshotRecordSchema.parse(snapshot).preferences.theme === "light"), true);
    assert.deepEqual(triggers(f.raw), priorTriggers);
    assert.throws(() => f.raw.exec("UPDATE settings_snapshots SET revision=revision+1"), /retained-evidence-immutable/u);
    assert.throws(() => f.raw.exec("UPDATE command_audits SET code='changed'"), /retained-evidence-immutable/u);
    assert.deepEqual(f.raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { f.raw.close(); }

  const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, f.clock); world.databases.push(reopened);
  assert.equal(f.execute(save(2, { "preferences.notifications.sound": { set: "none" }, "preferences.preventSleepWhileRunning": { set: false } }), reopened).state, "applied");
  assert.deepEqual(reopened.authority.settingsCurrent.get()?.settings, { concurrency: { defaultWorkers: 3 },
    preferences: { theme: "light", preventSleepWhileRunning: false, notifications: { sound: "none" } } });
});

it("refuses a settings row whose schema is neither the previous nor this build's, and leaves the store as it was", async () => {
  const f = await schema31Store();
  try {
    const unknown = "f".repeat(64);
    f.raw.prepare("UPDATE settings SET payload_json=json_set(payload_json,'$.initialization.settings.settingsSchemaHash',?)").run(unknown);
    const before = tables(f.raw), priorTriggers = triggers(f.raw);
    assert.throws(() => readAppSettings(f.raw), new RegExp(`persisted settings schema ${unknown} does not match this build's ${SETTINGS_SCHEMA_HASH}`, "u"));
    assert.throws(() => upgrade(f.raw), new RegExp(`persisted settings schema ${unknown} does not match this build's ${SETTINGS_SCHEMA_HASH}`, "u"));
    assert.deepEqual(tables(f.raw), before);
    assert.deepEqual(triggers(f.raw), priorTriggers);
    assert.equal(f.raw.prepare("PRAGMA user_version").get()?.user_version, 31);
  } finally { f.raw.close(); }
});

it("refuses a snapshot whose stored preferences were altered, and leaves the store as it was", async () => {
  const f = await schema31Store();
  try {
    f.raw.exec("DROP TRIGGER settings_snapshots_immutable");
    f.raw.exec("UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.preferences.animations',json('false'))");
    f.raw.exec("CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON settings_snapshots BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END");
    const before = tables(f.raw);
    assert.throws(() => upgrade(f.raw), /settings-record-predecessor-shape-invalid/u);
    assert.deepEqual(tables(f.raw), before);
  } finally { f.raw.close(); }
});

it.each([
  ["no members", () => ({})],
  ["only the members this upgrade adds", () => ADDED_DEFAULTS],
  ["one member short", (stored: Record<string, unknown>) => Object.fromEntries(Object.entries(stored).filter(([key]) => key !== "theme"))],
  ["an unknown member", (stored: Record<string, unknown>) => ({ ...stored, extra: true })],
])("refuses a snapshot whose preferences no build wrote (%s), though its fingerprint matches, and leaves the store as it was", async (_name, malformed) => {
  const f = await schema31Store();
  try {
    f.raw.exec("DROP TRIGGER settings_snapshots_immutable");
    const [first] = f.raw.prepare("SELECT id,payload_json FROM settings_snapshots ORDER BY id LIMIT 1").all();
    const record = z.record(z.string(), z.unknown()).parse(JSON.parse(PayloadSchema.parse(first).payload_json));
    const preferences = malformed(z.record(z.string(), z.unknown()).parse(record.preferences));
    f.raw.prepare("UPDATE settings_snapshots SET payload_json=? WHERE id=?").run(
      canonicalJsonStringify({ ...record, preferences, preferencesFingerprint: sha256Hex(canonicalJsonStringify(preferences)) }), z.string().parse(first?.id));
    f.raw.exec("CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON settings_snapshots BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END");
    const before = tables(f.raw), priorTriggers = triggers(f.raw);
    const altered = f.raw.prepare("SELECT * FROM settings_snapshots ORDER BY id LIMIT 1").get();
    assert.throws(() => convertSettingsRecordRow("settings_snapshots", altered), /settings-record-predecessor-shape-invalid/u);
    assert.throws(() => upgrade(f.raw), /settings-record-predecessor-shape-invalid/u);
    assert.deepEqual(tables(f.raw), before);
    assert.deepEqual(triggers(f.raw), priorTriggers);
    assert.equal(f.raw.prepare("PRAGMA user_version").get()?.user_version, 31);
  } finally { f.raw.close(); }
});

it("finishes an upgrade that stopped between rows, and converts nothing twice", async () => {
  const f = await schema31Store();
  try {
    const before = tables(f.raw);
    // The interrupted store has its snapshots and its settings row converted; its commands and audits are still the older build's.
    f.raw.exec("DROP TRIGGER settings_snapshots_immutable");
    for (const table of ["settings_snapshots", "settings"]) for (const raw of f.raw.prepare(`SELECT * FROM ${table}`).all()) {
      f.raw.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(PayloadSchema.parse(convertSettingsRecordRow(table, raw)).payload_json, z.string().parse(raw.id));
    }
    f.raw.exec("CREATE TRIGGER settings_snapshots_immutable BEFORE UPDATE ON settings_snapshots BEGIN SELECT RAISE(ABORT,'retained-evidence-immutable'); END");
    assert.equal(f.raw.prepare("SELECT count(*) AS count FROM commands WHERE instr(request_json,?)>0").get(PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH)?.count, 1);
    assert.throws(() => readAppSettings(f.raw));

    upgrade(f.raw);

    assert.equal(inspectNormalAuthority(f.raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(readAppSettings(f.raw)?.saved?.settings, { concurrency: { defaultWorkers: 3 }, preferences: { theme: "light" } });
    const converted = tables(f.raw);
    for (const table of CONVERTED_TABLES) assert.deepEqual(converted[table]?.map(row => preRunsNotificationsSettingsRow(table, row)), before[table], table);
    assert.equal(f.raw.prepare("SELECT count(*) AS count FROM commands WHERE instr(request_json,?)>0").get(PRE_RUNS_NOTIFICATIONS_SETTINGS_SCHEMA_HASH)?.count, 0);

    f.raw.exec("DROP TRIGGER settings_snapshots_immutable; DROP TRIGGER command_audits_immutable");
    migrateSettingsRecords(f.raw);
    assert.deepEqual(tables(f.raw), converted);
  } finally { f.raw.close(); }
});
