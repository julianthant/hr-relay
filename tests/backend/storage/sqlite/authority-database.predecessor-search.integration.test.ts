import { restoreEmptyPreMasterWorkbookFixture } from "../../../support/helpers/workbooks/pre-master-schema.js";
import { removeEmptyExclusiveSessionLeaseFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { writeAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ActiveRuntimeConfigRecordSchema } from "../../../../src/models/config/runtime-generation.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../../src/models/config/settings-initialization.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunSearchPublicationSchema } from "../../../../src/models/dashboard/search-index.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

it.each([[12, "published"], [12, "building"], [13, "published"], [13, "building"], [14, "published"], [14, "building"]] as const)("inspects exact schema%s with a populated %s search without changing source authority", (version, state) => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
    database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
      .run(CONFIG_SNAPSHOT.configSnapshotId, CONFIG_SNAPSHOT.revision, CONFIG_SNAPSHOT.fingerprint, JSON.stringify(CONFIG_SNAPSHOT), CONFIG_SNAPSHOT.capturedAt);
    database.prepare("INSERT INTO database_states VALUES(?,?,?,?,?,?,?,?)").run(1, 15, 0, QUEUED_RUN.createdAt, 0, "ready",
      "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    const settings = initialSettingsFileRecord();
    const command = SettingsInitializationCommandSchema.parse({ kind: "settings-initialization", commandId: randomUUID(), revision: 1,
      settings, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, initializedAt: CONFIG_SNAPSHOT.capturedAt });
    const audit = SettingsInitializationAuditSchema.parse({ kind: "settings-initialization", auditId: randomUUID(), request: command,
      result: { state: "initialized", revision: 1, snapshotId: CONFIG_SNAPSHOT.configSnapshotId, fingerprint: CONFIG_SNAPSHOT.fingerprint }, completedAt: command.initializedAt });
    insertNativeCommand(database, command); settleNativeCommand(database, audit);
    database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
      .run(audit.auditId, command.commandId, JSON.stringify(audit), audit.completedAt);
    writeAppSettings(database, { format: 1, saved: null, active: ActiveRuntimeConfigRecordSchema.parse({ generation: 1, settingsRevision: 1,
      settingsFingerprint: settings.settingsFingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      configFingerprint: CONFIG_SNAPSHOT.fingerprint, activatedAt: command.initializedAt }), initialization: { commandId: command.commandId, auditId: audit.auditId,
      configSnapshotId: command.configSnapshotId, configFingerprint: command.configFingerprint, initializedAt: command.initializedAt, settings } });
    const index = createRunSearchIndex(database);
    index.installTracking();
    const run = runRecordColumns(RunRecordSchema.parse(QUEUED_RUN));
    database.prepare(`INSERT INTO runs (${Object.keys(run).join(",")}) VALUES (${Object.keys(run).map(() => "?").join(",")})`).run(...Object.values(run));
    database.exec("UPDATE database_states SET authority_generation=1,search_generation=NULL,search_state='invalid'");
    index.publishChanges(1, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 0, afterRun: null, rowCount: 0 }));
    assert.equal(index.publication().state, "published");
    assert.equal(database.prepare("SELECT count(*) AS count FROM run_search").get()?.count, 1);
    database.exec("DROP TRIGGER run_pause_insert; DROP TRIGGER run_pause_update; ALTER TABLE runs DROP COLUMN pause_state");
    if (version < 14) removeEmptyExclusiveSessionLeaseFixture(database);
    if (version < 13) restoreEmptyPreMasterWorkbookFixture(database);
    database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=${version}; UPDATE database_states SET schema_version=${version}`);
    if (state === "building") database.exec("UPDATE database_states SET search_state='invalid'");
    assert.equal(index.publication().state, state);
    assert.throws(() => index.validateCoverage(), /run row columns do not match the native schema/u);
    assert.throws(() => inspectNormalAuthority(database), /normal-authority-schema-mismatch/u);
    const before = database.prepare("SELECT total_changes() AS count").get()?.count;
    assert.equal(inspectNativeAuthority(database, version).schemaVersion, version);
    assert.equal(database.prepare("SELECT total_changes() AS count").get()?.count, before);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { database.close(); }
});
