import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SEND_SHORTCUT_CONVERSION_MARKER, convertSettingsRecordRow } from "../../../../src/backend/storage/sqlite/settings-record-conversion.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { RETIRED_PANEL_MODE } from "../../../../src/models/config/settings-record-conversion.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { preSendShortcutSettingsRow, restorePreSendShortcutSettingsRows } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { regressSchema35SendShortcut, removeSchema36WorkbookSyncStatus } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createSettingsAuthorityTestWorld } from "../../../support/helpers/backend/settings-authority-world.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createSettingsAuthorityTestWorld();
afterEach(world.cleanup);

const SAVED_BEFORE = { "concurrency.defaultWorkers": { set: 3 }, "preferences.theme": { set: "light" } };
const CONVERTED_TABLES = ["settings_snapshots", "settings", "commands", "command_audits"];
const PayloadSchema = z.object({ payload_json: z.string() });
const ObjectSchema = z.record(z.string(), z.unknown());

function save(expectedRevision: number, patch: Record<string, unknown>) {
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-11-17T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}
function tables(database: DatabaseSync) {
  return Object.fromEntries(migrationTableNames(34).map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))]));
}
function snapshots(database: DatabaseSync) {
  return database.prepare("SELECT payload_json FROM settings_snapshots ORDER BY id").all().map(row => ObjectSchema.parse(JSON.parse(PayloadSchema.parse(row).payload_json)));
}
function upgrade(database: DatabaseSync) {
  database.exec("BEGIN EXCLUSIVE");
  try {
    applyAuthorityMigrationsAfter(database, 34, { now: "2026-11-17T00:00:00.000Z", captureFile: () => { throw new Error("artifact-unexpected"); } });
    database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; COMMIT`);
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
function open(path: string, clock: Parameters<typeof AuthorityDatabase.open>[1]) {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "settings-test" }, clock); world.databases.push(database);
  return database;
}
function close(database: AuthorityDatabase) { world.databases.splice(world.databases.indexOf(database), 1)[0]?.close(); }

/** A store an older build wrote at schema 34: one saved settings revision, every settings row before the send shortcut existed. */
async function schema34Store() {
  const f = await world.fixture();
  assert.equal(f.execute(save(1, SAVED_BEFORE)).state, "applied");
  close(f.database);
  const raw = new DatabaseSync(f.path);
  raw.exec("PRAGMA foreign_keys=ON");
  removeSchema36WorkbookSyncStatus(raw);
  restorePreSendShortcutSettingsRows(raw);
  regressSchema35SendShortcut(raw);
  return { ...f, raw };
}

it("converts settings records in migration 35, under the current schema 49", () => {
  assert.ok(SQLITE_MIGRATIONS.find(migration => migration.version === 35)?.statements.includes(SEND_SHORTCUT_CONVERSION_MARKER));
  assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 49);
  assert.deepEqual(migrationTableNames(35), migrationTableNames(34));
});

it("upgrades a schema-34 store: every stored snapshot gains the Enter send shortcut, saved settings are kept and nothing else changes", async () => {
  const f = await schema34Store();
  try {
    const before = tables(f.raw), priorSnapshots = snapshots(f.raw);
    assert.ok(priorSnapshots.length >= 2 && priorSnapshots.every(snapshot => !Object.hasOwn(ObjectSchema.parse(snapshot.preferences), "sendShortcut")));
    assert.throws(() => readAppSettings(f.raw), /does not match this build's/u);
    assert.equal(inspectNativeAuthority(f.raw, 34).schemaVersion, 34);
    const stopped = readAppSettings(f.raw, convertSettingsRecordRow);
    assert.deepEqual(stopped?.saved?.settings, { concurrency: { defaultWorkers: 3 }, preferences: { theme: "light" } });

    upgrade(f.raw);

    assert.equal(inspectNormalAuthority(f.raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const after = tables(f.raw);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table], rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (CONVERTED_TABLES.includes(table)) assert.deepEqual(after[table]?.map(row => preSendShortcutSettingsRow(table, row)), rows, table);
      else assert.deepEqual(after[table], rows, table);
    }
    assert.deepEqual(readAppSettings(f.raw)?.saved, stopped.saved);
    for (const [index, snapshot] of snapshots(f.raw).entries()) {
      const record = ConfigSnapshotRecordSchema.parse(snapshot);
      const { [RETIRED_PANEL_MODE]: retired, ...prior } = ObjectSchema.parse(priorSnapshots[index]?.preferences);
      assert.equal(retired, "floating");
      assert.deepEqual(record.preferences, { ...prior, sendShortcut: "enter", assistantFullAccess: false });
      assert.equal(canonicalJsonStringify({ ...record, preferences: null, preferencesFingerprint: null }), canonicalJsonStringify({ ...priorSnapshots[index], preferences: null, preferencesFingerprint: null }));
    }
    assert.throws(() => f.raw.exec("UPDATE settings_snapshots SET revision=revision+1"), /retained-evidence-immutable/u);
    assert.throws(() => f.raw.exec("UPDATE command_audits SET code='changed'"), /retained-evidence-immutable/u);
  } finally { f.raw.close(); }
});

it("stores a person's Command-Enter pick and serves it back after the store reopens", async () => {
  const f = await schema34Store();
  try { upgrade(f.raw); } finally { f.raw.close(); }

  const first = open(f.path, f.clock);
  assert.equal(f.execute(save(2, { "preferences.sendShortcut": { set: "mod-enter" } }), first).state, "applied");
  close(first);

  const reopened = open(f.path, f.clock);
  assert.deepEqual(reopened.authority.settingsCurrent.get()?.settings, { concurrency: { defaultWorkers: 3 }, preferences: { theme: "light", sendShortcut: "mod-enter" } });
});
