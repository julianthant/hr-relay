import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, it } from "vitest";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { updateRunRecord } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createEmergencyContactRetryWorld } from "../../../support/helpers/backend/emergency-contact-retry-world.js";
import { restoreSchema20CompletionFixture } from "../../../support/fixtures/storage/historical-run-schema.js";

const world = createEmergencyContactRetryWorld();
let fixture: Awaited<ReturnType<typeof world.fixture>>;
beforeEach(async () => { fixture = await world.fixture(); });
afterEach(world.cleanup);
afterAll(world.releaseTemplates);

for (const failed of [false, true]) it(`upgrades populated schema 20 with a ${failed ? "failed" : "done"} settlement without editing payloads or admitting forged completion removal`, async () => {
  const f = fixture;
  f.control.failAccounting = failed;
  await f.canonical.execute(f.parentRun, new AbortController().signal);
  const parent = f.current(); assert.ok(parent.completion);
  createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor] }).ensureReceipt(parent.envelope.runId);
  const path = join(f.harness.authority.profile.workspace, "schema20-copy.db");
  const source = new DatabaseSync(f.path, { readOnly: true });
  try { await backup(source, path); } finally { source.close(); }
  const copy = new DatabaseSync(path);
  try {
    restoreSchema20CompletionFixture(copy);
    assert.equal(inspectNativeAuthority(copy, 20).schemaVersion, 20);
    const schema = () => copy.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const rows = () => migrationTableNames(20).map(table => ({ table, rows: copy.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row })) }));
    const beforeSchema = schema(), before = rows();
    const migration = SQLITE_MIGRATIONS.find(value => value.version === 21); assert.ok(migration);
    assert.equal(migration.statements.length, 2);
    copy.exec("BEGIN EXCLUSIVE");
    for (const statement of migration.statements) copy.exec(statement);
    copy.exec("UPDATE database_states SET schema_version=21; PRAGMA user_version=21; COMMIT");
    assert.equal(inspectNativeAuthority(copy, 21).schemaVersion, 21);
    assert.deepEqual(schema().filter(row => row.name !== "runs_completion_immutable"), beforeSchema.filter(row => row.name !== "runs_completion_immutable"));
    const afterRows = rows();
    for (const table of before) {
      const after = afterRows.find(row => row.table === table.table); assert.ok(after);
      assert.deepEqual(after.rows, table.table === "database_states" ? table.rows.map(row => ({ ...row, schema_version: 21 })) : table.rows);
    }
    const { completion: _completion, ...retained } = parent;
    const removed = RunRecordSchema.parse({ ...retained, version: parent.version + 1, lifecycle: { state: "queued" } });
    assert.throws(() => updateRunRecord(copy, removed), /runs-completion-immutable/);
    const forged = RunRecordSchema.parse({ ...removed, delegationRefresh: { phase: "waiting", nodeId: "members",
      commandId: "00000000-0000-4000-8000-00000000f001", retryCommandIds: ["00000000-0000-4000-8000-00000000f002"] } });
    assert.throws(() => updateRunRecord(copy, forged), /runs-completion-immutable/);
    assert.deepEqual(copy.prepare("SELECT payload_json,terminal_run_json FROM run_results WHERE run_id=?").all(parent.envelope.runId).map(row => ({ ...row })),
      before.find(row => row.table === "run_results")?.rows.filter(row => row.run_id === parent.envelope.runId).map(row => ({ payload_json: row.payload_json, terminal_run_json: row.terminal_run_json })));
  } finally { copy.close(); }
});
