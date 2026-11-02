import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runRecordColumns, runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import type { RunRecord } from "../../../../src/models/run/record.js";

export function removeSchema15RunPause(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 15);
  assert.equal(database.prepare("SELECT count(*) AS count FROM runs WHERE json_type(lifecycle_json,'$.pause') IS NOT NULL").get()?.count, 0);
  database.exec("DROP TRIGGER run_pause_insert; DROP TRIGGER run_pause_update; ALTER TABLE runs DROP COLUMN pause_state");
}

export function removeEmptyExclusiveSessionLeaseFixture(database: DatabaseSync): void {
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exclusive_session_leases").get()?.count, 0);
  database.exec("DROP TABLE exclusive_session_leases");
}

export function readNative6RunRecord(database: DatabaseSync, input: unknown): RunRecord {
  inspectNativeAuthority(database, 6);
  const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(input);
  assert.equal(Object.hasOwn(row, "pause_state"), false);
  return runRecordFromRow({ ...row, pause_state: null });
}

export function updateNative6RunFixture(database: DatabaseSync, record: RunRecord): void {
  inspectNativeAuthority(database, 6);
  assert.equal(Object.hasOwn(record, "pause"), false);
  const entries = Object.entries(runRecordColumns(record)).filter(([key]) => key !== "id" && key !== "pause_state");
  const changes = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
    .run(...entries.map(([, value]) => value), record.envelope.runId, record.version - 1).changes);
  assert.equal(changes, 1, "native6 fixture run-version-fence-lost");
}
