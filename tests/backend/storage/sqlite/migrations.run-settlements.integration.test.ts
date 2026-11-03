import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { readRunSettlementRow, runSettlementContext } from "../../../../src/backend/storage/sqlite/run-settlement-row.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("migrates an authenticated terminal result and receipt without changing their bytes and retains exact native settlement identity", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  await f.canonical.execute(f.run, new AbortController().signal);
  const run = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(run?.completion?.kind === "done");
  const result = f.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
  const receipt = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor] }).ensureReceipt(run.envelope.runId);
  const version = run.completion.expectedVersion + 1;
  assert.deepEqual(f.database.authority.runResults.getSettlement(run.envelope.runId,version), { run, result });
  assert.equal(f.database.authority.runResults.getSettlement(run.envelope.runId,version + 1), undefined);
  const previous = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 19)) for (const sql of migration.statements) previous.exec(sql);
    const columns = runRecordColumns(run);
    previous.prepare(`INSERT INTO runs (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
    const resultJson = canonicalJsonStringify(result), receiptJson = canonicalJsonStringify(receipt);
    previous.prepare("INSERT INTO run_results VALUES(?,?,?,?,?,?)").run(result.runId,result.workflowId,result.attempt,result.resultDigest,resultJson,result.createdAt);
    previous.prepare("INSERT INTO run_receipts VALUES(?,?,?,?,?,?,?,?,?)").run(receipt.receiptId,receipt.runId,receipt.workflowId,receipt.attempt,receipt.result,receipt.confidence,null,receiptJson,receipt.generatedAt);
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 20); assert.ok(migration);
    for (const sql of migration.statements) previous.exec(sql);
    const row = readRunSettlementRow(previous,run.envelope.runId); assert.ok(row);
    assert.equal(row.id, `${run.envelope.runId}:${version}`);
    assert.equal(row.settlement_version, version);
    assert.equal(row.payload_json, resultJson);
    assert.deepEqual(runSettlementContext(row), run);
    assert.deepEqual(nativeOrdinaryRecordFromRow("run_results",row), result);
    const retained = previous.prepare("SELECT * FROM run_receipts WHERE id=?").get(receipt.receiptId); assert.ok(retained);
    assert.equal(retained.payload_json, receiptJson);
    assert.equal(retained.settlement_version, version);
    assert.deepEqual(nativeOrdinaryRecordFromRow("run_receipts",retained), receipt);
    assert.throws(() => previous.prepare("UPDATE run_results SET settlement_version=settlement_version+1").run(), /retained-evidence-immutable/);
    assert.throws(() => previous.prepare("INSERT OR REPLACE INTO run_results SELECT * FROM run_results").run(), /retained-identity-conflict/);
    assert.throws(() => previous.prepare("UPDATE run_receipts SET settlement_version=settlement_version+1").run(), /retained-evidence-immutable/);
    assert.throws(() => previous.prepare("DELETE FROM run_results").run(), /owner-deletion-required/);
    assert.throws(() => nativeOrdinaryRecordFromRow("run_results", { ...row, settlement_version: version + 1 }), /run-settlement-context-mismatch/);
    assert.throws(() => nativeOrdinaryRecordFromRow("run_results", { ...row, terminal_run_json: canonicalJsonStringify({ ...run, envelope: { ...run.envelope, runId: "00000000-0000-4000-8000-00000000f00d" } }) }), /run-settlement-context-mismatch/);
  } finally { previous.close(); }
});
