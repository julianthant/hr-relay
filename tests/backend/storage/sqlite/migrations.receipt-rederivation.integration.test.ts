import { applyOlderBuildStatements } from "../../../support/fixtures/storage/older-build-authority.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";

const at = "2026-11-02T00:00:00.000Z";
const ids = { ordinary: "run-ordinary", preview: "run-preview", failed: "run-failed", plain: "run-plain" } as const;

function migration(version: number) {
  const found = SQLITE_MIGRATIONS.find(value => value.version === version);
  assert.ok(found);
  return found.statements;
}

// Raw rows shaped like stored ones: the migration reads only these columns and json paths.
function insertRun(database: DatabaseSync, name: string, outcome: "done" | "failed" | "cancelled", warnings: readonly { code: string }[], delegated: boolean, actions: readonly unknown[] = []) {
  const lifecycle = JSON.stringify({ lifecycle: { state: "terminal", outcome, endedAt: at, failureId: outcome === "failed" ? "failure" : null },
    // Only done and failed runs carry a completion (runs_completion_insert).
    ...(outcome === "cancelled" ? {} : { completion: { schemaVersion: 1, kind: outcome, authorizedAt: at, claim: { claimGeneration: 0, workerId: "worker" }, expectedVersion: 3, resultDigest: "digest", failureId: "failure" } }) });
  database.prepare(`INSERT INTO runs(id,workflow,item_id,attempt,state,outcome,priority,claim_generation,version,settings_snapshot_id,descriptor_version,
    contract_fingerprint,trace_id,dry_run,local_day,enqueued_at,envelope_json,lifecycle_json,created_at,updated_at)
    VALUES(?,'emergency-contact',?,1,'terminal',?,'interactive',0,4,'snapshot',1,'fp','trace',0,'2026-11-02',?,'{}',?,?,?)`)
    .run(name, name, outcome, at, lifecycle, at, at);
  database.prepare("INSERT INTO run_results(id,run_id,settlement_version,terminal_run_json,workflow,attempt,result_digest,payload_json,created_at) VALUES(?,?,4,?,'emergency-contact',1,'digest',?,?)")
    .run(`${name}:4`, name, lifecycle, outcome === "cancelled" ? JSON.stringify({ result: { value: { appliedVersion: 4 } } }) : "{}", at);
  database.prepare("INSERT INTO run_receipts(id,run_id,settlement_version,workflow,attempt,result,confidence,failure_id,payload_json,created_at) VALUES(?,?,4,'emergency-contact',1,?,'high',NULL,?,?)")
    .run(`receipt-${name}`, name, outcome === "done" ? "verified-done" : "failed", JSON.stringify({ receiptId: `receipt-${name}`, warnings, actions }), at);
  database.prepare(`INSERT INTO run_search(run_id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,descriptor_version,has_receipt,has_diagnostic,systems_json,source_version,metadata_json,created_at,updated_at)
    VALUES(?,'emergency-contact','trace','2026-11-02','terminal','run',0,0,1,1,0,'[]',4,?,?,?)`)
    .run(name, JSON.stringify({ metadata: { evidence: { receipt: true } } }), at, at);
  if (delegated) database.prepare("INSERT INTO run_delegations(id,parent_run_id,payload_json,created_at) VALUES(?,?,'{}',?)").run(`delegation-${name}`, name, at);
}

function emptySchema25Store() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=OFF");
  applyOlderBuildStatements(database, 24);
  for (const statement of migration(25)) database.exec(statement);
  return database;
}

function schema25Store() {
  const database = emptySchema25Store();
  insertRun(database, ids.ordinary, "done", [], true);
  insertRun(database, ids.preview, "done", [{ code: "DRY_RUN_PREVIEW" }], true);
  insertRun(database, ids.failed, "failed", [], true);
  insertRun(database, ids.plain, "done", [], false);
  return database;
}

const snapshot = (database: DatabaseSync, table: string, where = "1=1") => database.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all();
const schema = (database: DatabaseSync) => database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();

it("deletes only an ordinary done delegation parent's stored receipt at 26 and keeps the schema 25 shape", () => {
  const database = schema25Store();
  try {
    const kept = [ids.preview, ids.failed, ids.plain];
    const keptReceipts = snapshot(database, "run_receipts", `run_id IN (${kept.map(id => `'${id}'`).join(",")})`);
    const keptSearch = snapshot(database, "run_search", `run_id IN (${kept.map(id => `'${id}'`).join(",")})`);
    const before = schema(database);
    for (const statement of migration(26)) database.exec(statement);
    assert.deepEqual(snapshot(database, "run_receipts", `run_id='${ids.ordinary}'`), []);
    assert.deepEqual(snapshot(database, "run_receipts", `run_id IN (${kept.map(id => `'${id}'`).join(",")})`), keptReceipts);
    assert.deepEqual(snapshot(database, "run_search", `run_id IN (${kept.map(id => `'${id}'`).join(",")})`), keptSearch);
    const search = database.prepare("SELECT has_receipt, metadata_json FROM run_search WHERE run_id=?").get(ids.ordinary);
    assert.ok(search);
    assert.equal(search.has_receipt, 0);
    assert.deepEqual(JSON.parse(String(search.metadata_json)), { metadata: { evidence: { receipt: false } } });
    assert.deepEqual(schema(database), before);
    const triggers = ["run_receipts_no_replace", "run_receipts_immutable", "run_receipts_owner_delete"];
    for (const name of triggers) {
      const row = database.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name);
      assert.ok(row, name);
      const version20 = migration(20).find(statement => statement.includes(`CREATE TRIGGER ${name} `));
      assert.equal(row.sql, version20?.trim());
    }
    expect(() => database.exec("DELETE FROM run_receipts")).toThrow(/owner-deletion-required/);
  } finally { database.close(); }
});

// The migration reads only `proved.proofSource`; the rest of the object keeps the stored ActionWriteProof shape.
const commitAction = (proofSource: string | null) => ({ id: `action-${proofSource}`, taskId: "save", kind: "commit", writeState: "verified", occurredAt: at,
  ...(proofSource === null ? {} : { proved: { system: "ucpath", idempotencyKeyDigest: "a".repeat(64), completion: "save-verify", proofSource,
    values: [{ key: "effect", transform: "allowed", classification: "operational", value: "x" }], recordedAt: at } }) });

it("also deletes every ordinary terminal run's current already-present receipt at 26 and keeps preview, committed and superseded receipts", () => {
  const database = emptySchema25Store();
  try {
    const deleted = ["delegated", "live-done", "durable-failed", "live-cancelled", "overlap"];
    const kept = ["preview", "committed", "unproved", "superseded"];
    insertRun(database, "delegated", "done", [], true);
    insertRun(database, "live-done", "done", [], false, [commitAction("live-probe")]);
    insertRun(database, "durable-failed", "failed", [], false, [commitAction("normal-output"), commitAction("durable-intent")]);
    insertRun(database, "live-cancelled", "cancelled", [], false, [commitAction("live-probe")]);
    insertRun(database, "overlap", "done", [], true, [commitAction("durable-intent")]);
    insertRun(database, "preview", "done", [{ code: "DRY_RUN_PREVIEW" }], false, [commitAction("live-probe")]);
    insertRun(database, "committed", "done", [], false, [commitAction("normal-output"), commitAction("recovery-probe"), commitAction("operator-attestation")]);
    insertRun(database, "unproved", "done", [], false, [commitAction(null)]);
    insertRun(database, "superseded", "done", [], false);
    database.prepare("INSERT INTO run_results(id,run_id,settlement_version,terminal_run_json,workflow,attempt,result_digest,payload_json,created_at) SELECT 'superseded:3',run_id,3,terminal_run_json,workflow,attempt,result_digest,payload_json,created_at FROM run_results WHERE id='superseded:4'").run();
    database.prepare("INSERT INTO run_receipts(id,run_id,settlement_version,workflow,attempt,result,confidence,failure_id,payload_json,created_at) VALUES('receipt-superseded-3','superseded',3,'emergency-contact',1,'verified-done','high',NULL,?,?)")
      .run(JSON.stringify({ receiptId: "receipt-superseded-3", warnings: [], actions: [commitAction("live-probe")] }), at);
    const list = (names: readonly string[]) => names.map(name => `'${name}'`).join(",");
    const keptReceipts = snapshot(database, "run_receipts", `run_id IN (${list(kept)})`);
    const keptSearch = snapshot(database, "run_search", `run_id IN (${list(kept)})`);
    const before = schema(database);
    for (const statement of migration(26)) database.exec(statement);
    assert.deepEqual(snapshot(database, "run_receipts", `run_id IN (${list(deleted)})`), []);
    assert.equal(snapshot(database, "run_receipts", `run_id IN (${list(kept)})`).length, 5);
    assert.deepEqual(snapshot(database, "run_receipts", `run_id IN (${list(kept)})`), keptReceipts);
    assert.deepEqual(snapshot(database, "run_search", `run_id IN (${list(kept)})`), keptSearch);
    for (const name of deleted) {
      const search = database.prepare("SELECT has_receipt, metadata_json FROM run_search WHERE run_id=?").get(name);
      assert.ok(search, name);
      assert.equal(search.has_receipt, 0, name);
      assert.deepEqual(JSON.parse(String(search.metadata_json)), { metadata: { evidence: { receipt: false } } }, name);
    }
    assert.deepEqual(schema(database), before);
    expect(() => database.exec("DELETE FROM run_receipts")).toThrow(/owner-deletion-required/);
  } finally { database.close(); }
});
