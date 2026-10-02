import { z } from "zod";
import { AtomicOutboxRecordSchema } from "../../src/domain/outbox.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { WriteIntentRecordSchema } from "../../src/domain/write-safety.js";
import { checkpointRecordKey } from "../../src/domain/workflow/checkpoint.js";
import { atomicWriteCheckpoint } from "../helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { inspectAuthorityBackupReadOnly } from "../helpers/synthetic-storage-admission.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../src/backend/storage/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../helpers/synthetic-storage-admission.js";
import { NOW, WRITE_INTENT_ATTEMPTING } from "../fixtures/phase1c-contract-fixtures.js";
import { createOperationRenameSource, operationFixtureId, OPERATION_TABLE_RENAMES } from "./helpers/operation-names-fixture.js";

const clock = manualClock(new Date(NOW));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(version = 34, complete = true) {
  const root = mkdtempSync(join(tmpdir(), "operation-names-")); roots.push(root);
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), name), join(root, name));
  const stateRoot = join(root, ".tracker"); mkdirSync(stateRoot);
  const path = join(stateRoot, "state.db"); createOperationRenameSource(path, version);
  if (complete) completeHistoricalConfirmation(path, version);
  const input = { stateRoot, processLockRoot: join(stateRoot, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { path, input, backup: () => backupStoppedAuthority(stateRoot, clock), run: (plan = false) => upgradeStorage({ ...input, plan }, clock) };
}
/** The released rename corpus has no checkpoint and mismatched generic facts.
 * Keep that corpus unchanged for its fingerprint guard; complete only these
 * stopped-conversion fixtures before taking their immutable source snapshot. */
function completeHistoricalConfirmation(path: string, version: number) {
  const db = new DatabaseSync(path);
  const operations = version < 36 ? "write_intents" : "run_operations";
  const outboxTable = version < 36 ? "durable_outbox" : "operation_outbox";
  const json = (row: unknown): unknown => JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json);
  try {
    const intent = WriteIntentRecordSchema.parse(json(db.prepare(`SELECT record_json FROM ${operations} WHERE record_key=?`).get(operationFixtureId(3))));
    assert.equal(intent.status, "committed");
    const boxes = db.prepare(`SELECT record_json FROM ${outboxTable}`).all().map((row) => AtomicOutboxRecordSchema.parse(json(row)));
    const ledgerBox = boxes.find((row) => row.payload.kind === "ledger-entry");
    const spanBox = boxes.find((row) => row.payload.kind === "write-committed-span");
    assert.ok(ledgerBox?.payload.kind === "ledger-entry" && spanBox?.payload.kind === "write-committed-span");
    if (intent.status !== "committed") assert.fail("committed rename fixture required");
    const transaction = { ...ledgerBox.payload.entry, proof: intent.completionProof, confirmedAt: intent.confirmedAt };
    const outcome = { ...spanBox.payload.outcome, proof: intent.completionProof, confirmedAt: intent.confirmedAt };
    const committedSpan = { ...spanBox.payload, outcome, occurredAt: intent.confirmedAt };
    for (const box of [{ ...ledgerBox, payload: { kind: "ledger-entry", entry: transaction } }, { ...spanBox, payload: committedSpan }]) {
      db.prepare(`UPDATE ${outboxTable} SET record_json=? WHERE record_key=?`).run(JSON.stringify(AtomicOutboxRecordSchema.parse(box)), box.outboxId);
    }
    for (const row of db.prepare("SELECT record_json FROM workflow_runs").all()) {
      const run = RunRecordSchema.parse(json(row));
      const updated = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, workflow: transaction.workflowId,
        traceId: transaction.traceId, resolvedInstance: { [transaction.system]: transaction.instance },
        configFingerprint: transaction.configFingerprint, dryRun: false } });
      db.prepare("UPDATE workflow_runs SET workflow=?,record_json=? WHERE record_key=?").run(updated.envelope.workflow, JSON.stringify(updated), updated.envelope.runId);
    }
    const checkpoint = atomicWriteCheckpoint({ writeIntentId: intent.writeIntentId, generation: intent.generation,
      completionProof: intent.completionProof, confirmedAt: intent.confirmedAt, outcome, transaction, committedSpan });
    db.prepare("INSERT INTO run_checkpoints(record_key,workflow,item_id,node_id,attempt,claim_generation,run_id,record_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(checkpointRecordKey(checkpoint), checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration ?? null, checkpoint.runId, JSON.stringify(checkpoint), checkpoint.writtenAt);
  } finally { db.close(); }
}
function currentOperationRows(path: string) {
  return OPERATION_TABLE_RENAMES.map(([, current]) => current === "operation_outbox"
    ? undefined : rows(path, current));
}
function assertConvertedRows(path: string, prior: ReturnType<typeof rows>[]) {
  for (const [index, current] of currentOperationRows(path).entries()) {
    if (current !== undefined) assert.deepEqual(current, prior[index]);
  }
  const db = open(path);
  try {
    const source = db.authority.historicalOperationSources.list();
    assert.equal(source.length, 1);
    const priorBoxes = prior[2].map((row) => JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json) as unknown);
    assert.deepEqual([source[0].ledgerOutbox, source[0].spanOutbox].sort((a,b) => a.outboxId.localeCompare(b.outboxId)),
      priorBoxes.map((row) => AtomicOutboxRecordSchema.parse(row)).sort((a,b) => a.outboxId.localeCompare(b.outboxId)));
  } finally { db.close(); }
}
function rows(path: string, table: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all(); }
  finally { db.close(); }
}
function supportedFixture() {
  const f = fixture();
  rmSync(f.path);
  const facts = z.record(z.string().regex(/^[a-z_]+$/u), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))).parse(
    JSON.parse(readFileSync(new URL("../unit/fixtures/migrated-operations.json", import.meta.url), "utf8")));
  const raw = new DatabaseSync(f.path);
  try {
    raw.exec("PRAGMA foreign_keys=OFF");
    for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= 46)) for (const sql of migration.statements) raw.exec(sql);
    // Restore a frozen database image, including tombstones whose owners are already deleted.
    const triggers = z.array(z.object({name:z.string().regex(/^[a-z_]+$/u),sql:z.string()})).parse(raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all());
    for (const trigger of triggers) raw.exec(`DROP TRIGGER ${trigger.name}`);
    for (const [table, records] of Object.entries(facts)) for (const row of records) {
      const columns = Object.keys(row);
      raw.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    for (const trigger of triggers) raw.exec(trigger.sql);
    raw.exec(`PRAGMA user_version=46; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { raw.close(); }
  assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 46);
  return f;
}
async function currentFixture() {
  const f = supportedFixture(); await f.backup(); await f.run(); return f;
}
function open(path: string) {
  return AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "operation-names-test" }, clock);
}

describe("operation table names", () => {
  it("retains the populated v34 fingerprint produced by the accepted baseline reader", () => {
    const f = fixture(34, false);
    // Captured with the unmodified reader at 35635a04e16e9c3cf1e99b16d4963752a18c616a.
    assert.equal(inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint,
      "2fc06e2ed8866535acad0ba9850200dbc34d2ea28e67fea2126f764f2c0ad71b");
  });

  it("retains shared-item operation history until the last run deletion and reports exact tallies", async () => {
    const f = await currentFixture();
    // The frozen rename corpus intentionally combines generic run/operation
    // fixtures. Deletion requires their actual ownership tuple to agree.
    const owners = new DatabaseSync(f.path);
    try { owners.prepare("UPDATE workflow_runs SET workflow = ?, record_json = json_set(record_json, '$.envelope.workflow', ?) WHERE item_id = ?")
      .run(WRITE_INTENT_ATTEMPTING.workflowId, WRITE_INTENT_ATTEMPTING.workflowId, WRITE_INTENT_ATTEMPTING.itemId); }
    finally { owners.close(); }
    const db = open(f.path);
    try {
      const receipt = db.authority.runs.delete({ runId: WRITE_INTENT_ATTEMPTING.runId,
        origin: "queue", commandId: operationFixtureId(80), now: NOW });
      assert.deepEqual(receipt.removed.filter(({ table }) => OPERATION_TABLE_RENAMES.some(([, current]) => current === table)), []);
      // The retained run can still consume this workflow/item's permanent keys.
      assert.equal(db.authority.writeIntents.get(operationFixtureId(3))?.status, "committed");
      assert.equal(db.authority.historicalOperationSources.list().length, 1);
      assert.equal(db.authority.writeAttempts.listByIntent(operationFixtureId(2)).length, 2);
      assert.equal(db.authority.writeIntents.get(operationFixtureId(2))?.status, "attempting");
      assert.deepEqual(db.authority.deletedRuns.get(receipt.runId)?.removed, receipt.removed);
      const last = db.authority.runs.delete({ runId: operationFixtureId(50),
        origin: "queue", commandId: operationFixtureId(81), now: NOW });
      assert.deepEqual(last.removed.filter(({ table }) => OPERATION_TABLE_RENAMES.some(([, current]) => current === table)), [
        { table: "run_operation_attempts", rows: 5 }, { table: "run_operations", rows: 4 },
      ]);
      assert.equal(db.authority.writeAttempts.listByIntent(operationFixtureId(2)).length, 0);
      assert.equal(db.authority.writeIntents.get(operationFixtureId(2)), undefined);
      assert.equal(db.authority.writeIntents.get(operationFixtureId(3)), undefined);
      assert.equal(db.authority.historicalOperationSources.list().length, 0);
      assert.deepEqual(db.authority.deletedRuns.get(last.runId)?.removed, last.removed);
      assert.equal(db.authority.deletedRuns.get(operationFixtureId(70))?.removed[0]?.table, "durable_outbox");
    } finally { db.close(); }
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.unresolvedWriteIntents, 0);
  });

  it.each([33, 34, 35, 36])("preserves populated v%s rows, old receipts and pending counts through stopped conversion", async (version) => {
    const historicalFixture = fixture(version);
    const originalBytes = readFileSync(historicalFixture.path);
    await assert.rejects(historicalFixture.run(), /authority-below-floor/u);
    assert.deepEqual(readFileSync(historicalFixture.path), originalBytes);
    const f = supportedFixture();
    const prior = OPERATION_TABLE_RENAMES.map(([old, current]) => rows(historicalFixture.path, version < 36 ? old : current));
    const receipts = rows(f.path, "deleted_runs");
    const historical = inspectAuthorityBackupReadOnly(historicalFixture.path);
    assert.equal(historical.counts.unresolvedWriteIntents, 3);
    assert.equal(historical.counts.durableOutbox, 1);
    const bytes = readFileSync(f.path);
    await f.backup();
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(readFileSync(f.path), bytes, "backup and rehearsal must not change the source");
    assert.equal((await f.run()).state, "converted");
    assertConvertedRows(f.path, prior);
    assert.deepEqual(rows(f.path, "deleted_runs"), receipts);
    const after = inspectAuthorityBackupReadOnly(f.path);
    assert.equal(after.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const { durableOutbox: historicalPending, runTerminalOutbox: historicalTerminal, ...currentCounts } = historical.counts;
    assert.equal(historicalTerminal, 0);
    assert.equal(historicalPending, 1);
    assert.deepEqual(after.counts, currentCounts);
    assert.equal(after.tables.some(({ name }) => OPERATION_TABLE_RENAMES.some(([old]) => old === name)), false);
    const db = open(f.path);
    try {
      assert.equal(db.authority.writeIntents.get(operationFixtureId(1))?.status, "observed-present");
      assert.deepEqual(db.authority.writeAttempts.listByIntent(operationFixtureId(2)).map((r) => [r.generation, r.runAttempt]), [[1, 1], [2, 3]]);
      assert.equal(db.authority.historicalOperationSources.list().length, 1);
      assert.equal(db.authority.deletedRuns.get(operationFixtureId(70))?.removed[2]?.table, "write_intents");

    } finally { db.close(); }
    const settled = readFileSync(f.path);
    assert.equal((await f.run()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), settled);
  });

  it.each(["beforeCommit", "afterCommit"] as const)("recovers populated conversion interrupted at %s", async (boundary) => {
    const historical = fixture();
    const prior = OPERATION_TABLE_RENAMES.map(([old]) => rows(historical.path, old));
    const f = supportedFixture();
    const retained = currentOperationRows(f.path);
    await f.backup();
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { [boundary]: () => { throw new Error("injected-operation-rename"); } } }, clock), /injected-operation-rename/u);
    const version = new DatabaseSync(f.path, { readOnly: true });
    try { assert.equal(version.prepare("PRAGMA user_version").get()?.user_version, boundary === "beforeCommit" ? 46 : CURRENT_AUTHORITY_SCHEMA_VERSION); }
    finally { version.close(); }
    if (boundary === "beforeCommit") {
      assert.deepEqual(currentOperationRows(f.path), retained);
    }
    assert.equal((await f.run()).state, "converted");
    assertConvertedRows(f.path, prior);
  });

  it("rolls all three DDL renames back together on an interrupted transaction", () => {
    const f = fixture(35);
    const db = new DatabaseSync(f.path);
    try {
      const migration = SQLITE_MIGRATIONS.find(({ version }) => version === 36); assert.ok(migration);
      db.exec("BEGIN IMMEDIATE");
      const [first, second] = migration.statements; assert.ok(first); assert.ok(second);
      db.exec(first); db.exec(second);
      assert.throws(() => db.exec("SELECT * FROM deliberately_missing_conversion_table"), /no such table/u);
      db.exec("ROLLBACK");
    } finally { db.close(); }
    assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 35);
  });

  it.each([33, 34, 35, 36, 37])("validates SQL mirrors and strict records at schema %s without skipping old operation queries", (version) => {
    const f = fixture(version);
    const names = version < 36 ? OPERATION_TABLE_RENAMES.map(([old]) => old) : OPERATION_TABLE_RENAMES.map(([, current]) => current);
    const db = new DatabaseSync(f.path);
    try { db.prepare(`UPDATE ${names[1]} SET generation=8 WHERE record_key=?`).run(operationFixtureId(12)); }
    finally { db.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(f.path), /write-attempt-columns-match-record/u);
  });

  it.each([34, 35, 36, 37])("refuses corrupt records in every operation family at schema %s", (version) => {
    for (const [old, current] of OPERATION_TABLE_RENAMES) {
      const f = fixture(version);
      const table = version < 36 ? old : current;
      const db = new DatabaseSync(f.path);
      try { db.exec(`UPDATE ${table} SET record_json=json_set(record_json,'$.unexpectedField',true)`); }
      finally { db.close(); }
      const bytes = readFileSync(f.path);
      assert.throws(() => inspectAuthorityBackupReadOnly(f.path), /authority-record-invalid/u);
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250,
        migrationOwner: "corrupt-historical-record", openMode: "storage-doctor-read-only-no-migrate" }, clock),
      /failed strict record schema validation/u);
      assert.deepEqual(readFileSync(f.path), bytes);
    }
  });

  it("preserves every v35 trigger through the isolated operation migration", () => {
    const f = fixture(35);
    const triggers = () => {
      const db = new DatabaseSync(f.path, { readOnly: true });
      try { return db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all().map((row) => {
        assert.equal(typeof row.name, "string"); assert.equal(typeof row.sql, "string");
        return [String(row.name), String(row.sql).replace(/"([a-z_]+)"/gu, "$1")];
      }); } finally { db.close(); }
    };
    const expected = triggers().map((row) => row.map((value) => OPERATION_TABLE_RENAMES.reduce<string>(
      (sql, [old, current]) => sql.replaceAll(old, current), value))).sort();
    const raw = new DatabaseSync(f.path);
    try {
      const migration = SQLITE_MIGRATIONS.find(({ version }) => version === 36); assert.ok(migration);
      for (const statement of migration.statements) raw.exec(statement);
      raw.exec("UPDATE authority_meta SET schema_version=36; PRAGMA user_version=36");
    } finally { raw.close(); }
    assert.deepEqual(triggers().sort(), expected);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 36);
  });

  it("retains foreign keys, generation uniqueness, permanent keys and immutable tombstones", async () => {
    const f = await currentFixture();
    const db = new DatabaseSync(f.path);
    try {
      assert.equal(db.prepare("PRAGMA foreign_key_list(run_operation_attempts)").get()?.table, "run_operations");
      assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='operation_outbox'").get(), undefined);
      assert.equal(db.prepare("SELECT count(*) AS n FROM timeline_operation_sources").get()?.n, 1);
      assert.throws(() => db.prepare("UPDATE run_operation_attempts SET write_intent_id=? WHERE record_key=?").run(operationFixtureId(99), operationFixtureId(12)), /FOREIGN KEY/u);
      assert.throws(() => db.exec("INSERT INTO run_operation_attempts SELECT 'duplicate-generation',write_intent_id,generation,record_json,created_at FROM run_operation_attempts LIMIT 1"), /UNIQUE/u);
      assert.throws(() => db.exec("UPDATE run_operations SET system=NULL"), /requires system/u);
      assert.throws(() => db.exec("DELETE FROM run_operations"), /FOREIGN KEY/u);
      assert.throws(() => db.exec("DELETE FROM deleted_runs"), /never deleted/u);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); }
  });
});
