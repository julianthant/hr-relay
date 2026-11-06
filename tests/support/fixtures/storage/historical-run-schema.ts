import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { predecessorRunRecordFromRow, runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { PredecessorRunRecordSchema, type PredecessorRunRecord } from "../../../../src/models/run/record.js";

/** Steps an empty current authority back to schema 22: the two assistant history tables did not exist yet. */
export function removeEmptySchema23AssistantHistory(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 23);
  for (const table of ["assistant_messages", "assistant_conversations"]) assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  database.exec("DROP TABLE assistant_messages; DROP TABLE assistant_conversations");
  database.exec("UPDATE database_states SET schema_version=22; PRAGMA user_version=22");
}

export function restoreSchema20CompletionFixture(database: DatabaseSync): void {
  if (database.prepare("PRAGMA user_version").get()?.user_version === CURRENT_AUTHORITY_SCHEMA_VERSION) removeEmptySchema23AssistantHistory(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 22);
  const trigger = SQLITE_MIGRATIONS.find(migration => migration.version === 20)?.statements
    .find(statement => statement.startsWith("CREATE TRIGGER runs_completion_immutable"));
  assert.ok(trigger);
  database.exec(`DROP TRIGGER runs_completion_immutable; ${trigger}`);
  database.exec("UPDATE database_states SET schema_version=20; PRAGMA user_version=20");
}

export function restoreSchema19RunSettlementFixture(database: DatabaseSync): void {
  if (database.prepare("PRAGMA user_version").get()?.user_version !== 20) restoreSchema20CompletionFixture(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 20);
  assert.equal(database.prepare("SELECT count(*) AS count FROM (SELECT run_id FROM run_results GROUP BY run_id HAVING count(*)>1)").get()?.count, 0);
  database.exec("DROP TRIGGER runs_completion_immutable");
  for (const table of ["run_receipts", "run_results"]) for (const suffix of ["no_replace", "immutable", "owner_delete"]) database.exec(`DROP TRIGGER ${table}_${suffix}`);
  database.exec("ALTER TABLE run_receipts RENAME TO fixture_run_receipts; ALTER TABLE run_results RENAME TO fixture_run_results");
  const baseline = SQLITE_MIGRATIONS[0].statements[0];
  for (const table of ["run_results", "run_receipts"]) {
    const definition = baseline.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\) STRICT;`))?.[0];
    assert.ok(definition);
    database.exec(definition);
  }
  database.exec(`INSERT INTO run_results SELECT run_id,workflow,attempt,result_digest,payload_json,created_at FROM fixture_run_results;
    INSERT INTO run_receipts SELECT id,run_id,workflow,attempt,result,confidence,failure_id,payload_json,created_at FROM fixture_run_receipts;
    DROP TABLE fixture_run_receipts; DROP TABLE fixture_run_results`);
  for (const table of ["run_results", "run_receipts"]) for (const suffix of ["no_replace", "immutable", "owner_delete"]) {
    const definition = baseline.match(new RegExp(`CREATE TRIGGER ${table}_${suffix}[\\s\\S]*?END;`))?.[0];
    assert.ok(definition);
    database.exec(definition);
  }
  const completionTrigger = baseline.match(/CREATE TRIGGER runs_completion_immutable[\s\S]*?END;/)?.[0];
  assert.ok(completionTrigger);
  database.exec(completionTrigger);
  database.exec("UPDATE database_states SET schema_version=19; PRAGMA user_version=19");
}

export function restoreSchema18WorkbookReferenceFixture(database: DatabaseSync): void {
  restoreSchema19RunSettlementFixture(database);
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 19);
  assert.equal(database.prepare("SELECT schema_version FROM database_states WHERE id=1").get()?.schema_version, 19);
  assert.equal(database.prepare("UPDATE database_states SET schema_version=18 WHERE id=1").run().changes, 1);
  database.exec("PRAGMA user_version=18");
}

export function removeEmptySchema18WorkbookCatalog(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 18);
  for (const table of ["workbook_library_actions", "workbook_library_snapshots", "workbook_library_state"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  }
  for (const table of ["workbook_library_actions", "workbook_library_snapshots", "workbook_library_state"]) database.exec(`DROP TABLE ${table}`);
  database.exec("UPDATE database_states SET schema_version=17; PRAGMA user_version=17");
}

export function removeEmptySchema17OcrReview(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 17);
  for (const table of ["ocr_approved_snapshots", "ocr_review_revisions", "ocr_source_uploads"]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  }
  for (const table of ["ocr_approved_snapshots", "ocr_review_revisions", "ocr_source_uploads"]) database.exec(`DROP TABLE ${table}`);
  database.exec("UPDATE database_states SET schema_version=16; PRAGMA user_version=16");
}

export function removeSchema15RunPause(database: DatabaseSync): void {
  assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 15);
  assert.equal(database.prepare("SELECT count(*) AS count FROM runs WHERE json_type(lifecycle_json,'$.pause') IS NOT NULL").get()?.count, 0);
  database.exec("DROP TRIGGER run_pause_insert; DROP TRIGGER run_pause_update; ALTER TABLE runs DROP COLUMN pause_state");
}

export function removeEmptyExclusiveSessionLeaseFixture(database: DatabaseSync): void {
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exclusive_session_leases").get()?.count, 0);
  database.exec("DROP TABLE exclusive_session_leases");
}

export function readNative6RunRecord(database: DatabaseSync, input: unknown): PredecessorRunRecord {
  inspectNativeAuthority(database, 6);
  const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(input);
  assert.equal(Object.hasOwn(row, "pause_state"), false);
  return predecessorRunRecordFromRow({ ...row, pause_state: null });
}

export function updateNative6RunFixture(database: DatabaseSync, record: PredecessorRunRecord): void {
  inspectNativeAuthority(database, 6);
  assert.equal(Object.hasOwn(record, "pause"), false);
  const entries = Object.entries(runRecordColumns(record, PredecessorRunRecordSchema)).filter(([key]) => key !== "id" && key !== "pause_state");
  const changes = Number(database.prepare(`UPDATE runs SET ${entries.map(([key]) => `${key} = ?`).join(",")} WHERE id = ? AND version = ?`)
    .run(...entries.map(([, value]) => value), record.envelope.runId, record.version - 1).changes);
  assert.equal(changes, 1, "native6 fixture run-version-fence-lost");
}

export function assertUpgradedRunSettlementRows(table: "run_results" | "run_receipts", actual: readonly Record<string, unknown>[],
  prior: Readonly<Record<string, readonly Record<string, unknown>[]>>): void {
  const versionFor = (runId: unknown) => {
    const row = prior.runs?.find(run => run.id === runId), result = prior.run_results?.find(result => result.run_id === runId);
    assert.ok(row && result);
    const context = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(row.lifecycle_json)));
    const payload = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(result.payload_json)));
    const completion = context.completion === undefined ? undefined : z.object({ expectedVersion: z.number() }).parse(context.completion);
    return z.number().int().positive().parse(completion === undefined
      ? z.object({ result: z.object({ value: z.object({ appliedVersion: z.number() }) }) }).parse(payload).result.value.appliedVersion
      : completion.expectedVersion + 1);
  };
  const expected = (prior[table] ?? []).map(row => {
    const version = versionFor(row.run_id);
    if (table === "run_receipts") return { ...row, settlement_version: version };
    const owner = prior.runs?.find(run => run.id === row.run_id); assert.ok(owner);
    const context = z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(owner.lifecycle_json)));
    const terminal = { ...context, envelope: z.record(z.string(),z.unknown()).parse(JSON.parse(z.string().parse(owner.envelope_json))), version, updatedAt: row.created_at };
    return { ...row, id: `${String(row.run_id)}:${version}`, settlement_version: version, terminal_run_json: canonicalJsonStringify(terminal) };
  });
  const canonical = actual.map(row => table === "run_results"
    ? { ...row, terminal_run_json: canonicalJsonStringify(JSON.parse(z.string().parse(row.terminal_run_json))) } : { ...row });
  assert.deepEqual(canonical, expected);
}
