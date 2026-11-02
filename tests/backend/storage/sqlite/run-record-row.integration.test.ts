import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { expect,it } from "vitest";
import { runRecordColumns,runRecordFromRow,transitionRunRecord,updateRunRecord } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { LATER } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1, UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readNative6RunRecord, removeSchema15RunPause, updateNative6RunFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { testProcessImport } from "../../../support/compiled-process.js";

function historicalDatabase(version: 6 | 15) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= version)) for (const statement of migration.statements) database.exec(statement);
  database.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID}; PRAGMA user_version=${version}`);
  if (version === 6) database.prepare("INSERT INTO database_states VALUES(1,6,0,?,NULL,'unbuilt')").run(NOW);
  else database.prepare("INSERT INTO database_states VALUES(1,15,0,?,NULL,'unbuilt',?,?)").run(NOW, UUID_1, UUID_2);
  createSettingsActivationRepositories({ database, mutate: work => work().result, readRecord: () => undefined }).runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const record = RunRecordSchema.parse(QUEUED_RUN);
  const entries = Object.entries(runRecordColumns(record)).filter(([key]) => version === 15 || key !== "pause_state");
  database.prepare(`INSERT INTO runs (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
    .run(...entries.map(([, value]) => value));
  inspectNativeAuthority(database, version);
  return database;
}

it("updates a serializable transitioned row through the existing version fence", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const current = RunRecordSchema.parse(QUEUED_RUN), columns = runRecordColumns(current), entries = Object.entries(columns);
    database.exec(`CREATE TABLE runs (${entries.map(([key]) => `${key}`).join(",")})`);
    database.prepare(`INSERT INTO runs (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => value));
    const updated = transitionRunRecord(current, RunRecordSchema.parse({ ...current, displayName: "Renamed run" }), LATER);
    expect(updateRunRecord(database, updated)).toBe(1);
    expect(runRecordFromRow(database.prepare("SELECT * FROM runs").get())).toEqual(updated);
    expect(() => updateRunRecord(database, updated)).toThrow("run-version-fence-lost");
  } finally { database.close(); }
});

it("keeps native6 fixture reads and writes behind exact inspection while ordinary row APIs remain current-only", () => {
  const database = historicalDatabase(6);
  try {
    const row = database.prepare("SELECT * FROM runs").get();
    expect(() => runRecordFromRow(row)).toThrow("native schema");
    const current = readNative6RunRecord(database, row);
    expect(current).toEqual(RunRecordSchema.parse(QUEUED_RUN));
    const updated = transitionRunRecord(current, RunRecordSchema.parse({ ...current, displayName: "Historical native6 run" }), LATER);
    expect(() => updateRunRecord(database, updated)).toThrow(/pause_state/u);
    expect(readNative6RunRecord(database, database.prepare("SELECT * FROM runs").get())).toEqual(current);
    updateNative6RunFixture(database, updated);
    expect(readNative6RunRecord(database, database.prepare("SELECT * FROM runs").get())).toEqual(updated);
    expect(() => updateNative6RunFixture(database, updated)).toThrow("native6 fixture run-version-fence-lost");
    const paused = RunRecordSchema.parse({ ...updated, version: updated.version + 1,
      pause: { state: "paused", commandId: UUID_1, requestedAt: NOW, pausedAt: LATER } });
    expect(() => updateNative6RunFixture(database, paused)).toThrow();
    expect(readNative6RunRecord(database, database.prepare("SELECT * FROM runs").get())).toEqual(updated);
    expect(database.prepare("PRAGMA table_info(runs)").all().some(column => column.name === "pause_state")).toBe(false);
    expect(() => readNative6RunRecord(database, { ...row, pause_state: null })).toThrow();
    database.exec("PRAGMA user_version=15");
    expect(() => readNative6RunRecord(database, row)).toThrow();
  } finally { database.close(); }
});

it("removes only schema15 pause authority for a genuine predecessor and restores it through migration15", () => {
  const database = historicalDatabase(15);
  try {
    const before = runRecordFromRow(database.prepare("SELECT * FROM runs").get());
    const artifactTrigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name='artifacts_retained'").get();
    database.exec("BEGIN EXCLUSIVE");
    removeSchema15RunPause(database);
    database.exec("UPDATE database_states SET schema_version=14 WHERE id=1; PRAGMA user_version=14; COMMIT");
    expect(inspectNativeAuthority(database, 14).schemaVersion).toBe(14);
    expect(database.prepare("SELECT sql FROM sqlite_schema WHERE name='artifacts_retained'").get()).toEqual(artifactTrigger);
    expect(() => runRecordFromRow(database.prepare("SELECT * FROM runs").get())).toThrow("native schema");
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 15); assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    database.exec("UPDATE database_states SET schema_version=15 WHERE id=1; PRAGMA user_version=15");
    expect(inspectNativeAuthority(database, 15).schemaVersion).toBe(15);
    expect(runRecordFromRow(database.prepare("SELECT * FROM runs").get())).toEqual(before);
    expect(database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('run_pause_insert','run_pause_update')").get()?.count).toBe(2);
    expect(() => readNative6RunRecord(database, database.prepare("SELECT * FROM runs").get())).toThrow();
  } finally { database.close(); }
});

it("loads the finite historical fixture helpers through the compiled child-process loader", () => {
  const moduleUrl = new URL("../../../support/fixtures/storage/historical-run-schema.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e",
    `import { readNative6RunRecord, updateNative6RunFixture, removeSchema15RunPause } from ${JSON.stringify(moduleUrl)};
      process.stdout.write([typeof readNative6RunRecord, typeof updateNative6RunFixture, typeof removeSchema15RunPause].join('/'));`],
    { encoding: "utf8", env: {}, timeout: 20_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("function/function/function");
});
