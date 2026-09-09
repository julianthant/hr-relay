import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../src/domain/authority.js";
import { DeletedRunRecordSchema } from "../../src/domain/run/deleted-run.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../src/infra/compat/backup-inspection.js";
import { AUTHORITY_APPLICATION_ID, DATABASE_TABLE_RENAMES, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { CONFIG_SNAPSHOT, NOW, HASH_A, HASH_B, UUID_5, UUID_7, UUID_8 } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";

const clock = manualClock(new Date(NOW));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const runId = QUEUED_RUN.envelope.runId;
const diagnostic = {
  bundleId: UUID_5, runId, origin: { kind: "operator-request", requestedBy: "local-operator" },
  createdAt: NOW, contentDigest: HASH_A, configFingerprint: HASH_B, descriptorFingerprint: HASH_A,
  redaction: { fields: [], warnings: [] },
  attachments: [{ kind: "accessibility-excerpt", artifactId: UUID_7, mediaType: "text/yaml",
    byteLength: 128, digest: HASH_B, sensitivity: "redacted" }],
  retention: { kind: "pinned", reason: "write-recovery" },
};
const receipt = {
  receiptId: UUID_5, runId, traceId: QUEUED_RUN.envelope.traceId, workflowId: QUEUED_RUN.envelope.workflow,
  attempt: 1, generatedAt: NOW, descriptorFingerprint: HASH_A, configFingerprint: HASH_B,
  retryOf: { state: "absent" }, failure: { state: "absent" }, input: [], observations: [], decisions: [],
  actions: [], verification: [], output: [], reuse: [], warnings: [], confidence: "verified", result: "verified-done",
};
const dryrun = {
  resultId: UUID_8, scenarioId: "person-lookup/dry-run", workflow: "person-lookup", subjectLabel: "synthetic-rename",
  manifestDigest: HASH_A, verdict: "blocked", assertions: [{ assertionId: "subject-available", verdict: "blocked", reason: "subject-unavailable" }],
  wallTimeMs: 0, recordedAt: NOW, execution: { state: "not-started", reason: "subject-unavailable" },
};
function open(path: string, historical = false) {
  return AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "database-renames-test",
    ...(historical ? { openMode: "storage-backup-read-only-no-migrate" as const } : {}) }, clock);
}
function rows(path: string, table: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY ${table === "authority_meta" || table === "database_state" ? "singleton_id" : "record_key"}`).all(); }
  finally { db.close(); }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "database-renames-")); roots.push(root);
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), name), join(root, name));
  const stateRoot = join(root, ".tracker"); mkdirSync(stateRoot);
  const path = join(stateRoot, "state.db");
  const seedPath = join(root, "seed.db");
  const seed = open(seedPath);
  try {
    seed.authority.runs.enqueue(QUEUED_RUN);
    seed.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
    seed.authority.diagnosticBundles.insert(diagnostic);
    seed.authority.evidenceReceipts.insert(receipt);
    seed.authority.dryRunScenarioResults.insert(dryrun);
  } finally { seed.close(); }
  const source = new DatabaseSync(seedPath, { readOnly: true });
  const db = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 38)) {
      for (const statement of migration.statements) db.exec(statement);
    }
    db.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,38,7,?)").run(NOW);
    const pairs = [["workflow_runs", "workflow_runs"], ...Object.entries(DATABASE_TABLE_RENAMES).filter(([old]) => old !== "authority_meta")];
    for (const [old, current] of pairs) {
      for (const row of source.prepare(`SELECT * FROM ${current} ORDER BY record_key`).all()) {
        if (old === "workflow_runs") {
          row.state = "terminal";
          row.record_json = JSON.stringify({ ...QUEUED_RUN, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }, null, 2);
        }
        if (old === "authority_upgrades") {
          // Seed the exact released baseline grammar with a deterministic identity.
          row.record_key = UUID_8;
          row.record_json = JSON.stringify({ recordKey: UUID_8, upgradeId: "fresh", phase: "baseline",
            fromSchemaVersion: 0, toSchemaVersion: 38, by: "local-operator", recordedAt: NOW }, null, 2);
        }
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO ${old} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
    }
    const deleted = DeletedRunRecordSchema.parse({ runId: UUID_7, workflow: "person-lookup", traceId: "pl-120000-2222",
      itemId: UUID_8, attempt: 1, runNumber: 8, ordinalSource: "tombstone", origin: "queue", commandId: UUID_8,
      deletedAt: NOW, tallyVersion: 2, removed: ["diagnostic_attachments", "diagnostic_bundles", "evidence_receipts", "dry_run_scenario_results"].map((table) => ({ table, rows: 1 })) });
    const retained = db.prepare("SELECT * FROM workflow_runs WHERE record_key=?").get(runId);
    assert.ok(retained);
    const deleting = { ...retained, record_key: deleted.runId, item_id: deleted.itemId, run_number: deleted.runNumber,
      record_json: JSON.stringify({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: deleted.runId, itemId: deleted.itemId, traceId: deleted.traceId },
        runNumber: deleted.runNumber, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }, null, 2) };
    const columns = Object.keys(deleting);
    db.prepare(`INSERT INTO workflow_runs (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(deleting));
    db.prepare(`INSERT INTO deleted_runs(record_key,workflow,trace_id,origin,command_id,deleted_at,record_json,created_at,item_id,attempt,run_number,ordinal_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(deleted.runId, deleted.workflow, deleted.traceId, deleted.origin, deleted.commandId,
      NOW, JSON.stringify(deleted, null, 2), NOW, deleted.itemId, deleted.attempt, deleted.runNumber, deleted.ordinalSource);
    db.prepare("DELETE FROM workflow_runs WHERE record_key=?").run(deleted.runId);
    db.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=38`);
  } finally { source.close(); db.close(); }
  const input = { stateRoot, processLockRoot: join(stateRoot, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { path, input, backup: () => backupStoppedAuthority(stateRoot, clock), upgrade: () => upgradeStorage(input, clock) };
}

describe("seven database table renames", () => {
  it("migrates populated v38 once, preserving all row bytes, links, journal and generation", () => {
    const f = fixture();
    const before = new Map(Object.entries(DATABASE_TABLE_RENAMES).map(([old, current]) => [current, rows(f.path, old)]));
    const tallies = rows(f.path, "deleted_runs");
    const historical = inspectAuthorityBackupReadOnly(f.path);
    // Captured with the untouched reader at 27e073c0c69e1ff54fb699c805175589e8f016b3.
    assert.equal(historical.authorityContentFingerprint, "14a5057e1f70a3f5a821934a85fbb5511784d4c2cc115f8db39fdf7a0aa021b5");
    const original = readFileSync(f.path);
    const readOnly = open(f.path, true);
    try {
      assert.equal(readOnly.getMeta().schemaVersion, 38);
      assert.deepEqual(readOnly.readUpgradePhases(), { state: "available", phases: [
        { phase: "baseline", fromSchemaVersion: 0, toSchemaVersion: 38, recordedAt: NOW },
      ] });
    } finally { readOnly.close(); }
    assert.deepEqual(readFileSync(f.path), original);
    const db = open(f.path);
    try {
      assert.equal(db.getMeta().schemaVersion, 39);
      assert.equal(db.getMeta().authorityGeneration, 7);
      assert.deepEqual(db.authority.diagnosticBundles.get(UUID_5), diagnostic);
      assert.equal(db.authority.diagnosticBundles.listAttachments(UUID_5).length, 1);
      assert.deepEqual(db.authority.evidenceReceipts.get(UUID_5), receipt);
      assert.deepEqual(db.authority.configSnapshots.get(CONFIG_SNAPSHOT.configSnapshotId), CONFIG_SNAPSHOT);
      assert.deepEqual(db.authority.dryRunScenarioResults.get(UUID_8), dryrun);
      assert.equal(db.authority.diagnosticBundles.insert(diagnostic).state, "existing");
      assert.equal(db.getMeta().authorityGeneration, 7);
      assert.throws(() => db.authority.diagnosticBundles.insert({ ...diagnostic, contentDigest: HASH_B }), /different content/u);
      assert.throws(() => db.authority.diagnosticBundles.purge(UUID_5, NOW), /pinned/u);
      assert.throws(() => db.authority.evidenceReceipts.insert({ ...receipt, descriptorFingerprint: HASH_B }), /different content/u);
      db.withAuthorityTransaction(() => {
        db.authority.dryRunScenarioResults.insert({ ...dryrun, resultId: UUID_7 });
        db.authority.dryRunScenarioResults.insert({ ...dryrun, resultId: UUID_5 });
      });
      assert.equal(db.getMeta().authorityGeneration, 8);
    } finally { db.close(); }
    for (const [current, prior] of before) {
      if (current === "database_state" || current === "dryrun_results") continue;
      assert.deepEqual(rows(f.path, current), prior, `${current} must preserve every column and JSON byte`);
    }
    assert.deepEqual(rows(f.path, "dryrun_results").find((row) => row.record_key === UUID_8), before.get("dryrun_results")?.[0]);
    assert.deepEqual(rows(f.path, "deleted_runs"), tallies);
    const current = inspectAuthorityBackupReadOnly(f.path);
    assert.notEqual(current.authorityContentFingerprint, historical.authorityContentFingerprint);
    assert.equal(current.authorityContentFingerprint, AuthorityDatabase.inspectExistingReadOnly(f.path).authorityContentFingerprint);
    const settled = readFileSync(f.path);
    open(f.path).close();
    assert.deepEqual(readFileSync(f.path), settled);
    const raw = new DatabaseSync(f.path);
    try {
      assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
      assert.deepEqual(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name), AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort());
      assert.throws(() => raw.exec("DELETE FROM workflow_runs"), /FOREIGN KEY constraint failed/u);
      for (const table of ["dryrun_results", "database_upgrades"]) {
        assert.throws(() => raw.exec(`DELETE FROM ${table}`), /never deleted|tombstone/u);
        assert.throws(() => raw.exec(`UPDATE ${table} SET record_json='{}'`), /immutable/u);
      }
    } finally { raw.close(); }
    const deleting = open(f.path);
    try {
      const result = deleting.authority.runs.delete({ runId, origin: "queue", commandId: UUID_8, now: NOW });
      for (const name of ["diagnostic_files", "diagnostic_snapshots", "run_receipts"]) assert.equal(result.removed.find(({ table }) => table === name)?.rows, 1);
      for (const old of ["diagnostic_attachments", "diagnostic_bundles", "evidence_receipts"]) assert.equal(result.removed.some(({ table }) => table === old), false);
      assert.deepEqual(deleting.authority.deletedRuns.get(UUID_7)?.removed.map(({ table }) => table), ["diagnostic_attachments", "diagnostic_bundles", "evidence_receipts", "dry_run_scenario_results"]);
    } finally { deleting.close(); }
  });

  it.each(["malformed", "contradictory", "divergent"] as const)("refuses %s historical evidence after a valid populated control", (kind) => {
    const f = fixture();
    assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 38);
    const raw = new DatabaseSync(f.path);
    try {
      if (kind === "divergent") raw.exec("CREATE TABLE unexpected_rename_residue(id TEXT)");
      else {
        // Keep the exact released schema: drop and restore only the immutable-update trigger.
        const triggers = raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='evidence_receipts' AND sql LIKE '%BEFORE UPDATE%'").all();
        for (const trigger of triggers) raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
        raw.prepare(kind === "malformed" ? "UPDATE evidence_receipts SET record_json='{}'" : "UPDATE evidence_receipts SET workflow='separations'").run();
        for (const trigger of triggers) raw.exec(String(trigger.sql));
      }
    } finally { raw.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(f.path), kind === "malformed" ? /authority-record-invalid/u : kind === "contradictory" ? /authority-invariant-invalid: evidence-receipt-columns-match-record/u : /immutable migration replay/u);
  });

  it("rolls back a populated stopped conversion, settles once after commit, and preserves backup sources", async () => {
    const f = fixture();
    const before = inspectAuthorityBackupReadOnly(f.path);
    const journal = rows(f.path, "authority_upgrades");
    const tallies = rows(f.path, "deleted_runs");
    const backup = await f.backup();
    assert.equal(backup.state, "verified");
    const manifest = backup.manifests[0]; assert.ok(manifest);
    const backupPath = join(f.input.stateRoot, "backups", "authority", manifest.backupFileName);
    const backupBytes = readFileSync(backupPath);
    assert.equal(manifest.authorityContentFingerprint, before.authorityContentFingerprint);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("rename-before-commit"); } } }, clock), /rename-before-commit/u);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint, before.authorityContentFingerprint);
    assert.deepEqual(rows(f.path, "authority_upgrades"), journal);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("rename-after-commit"); } } }, clock), /rename-after-commit/u);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 39);
    assert.equal((await f.upgrade()).state, "converted");
    const settled = rows(f.path, "database_upgrades");
    assert.equal(settled.length, journal.length + 2);
    assert.deepEqual(settled.find((row) => row.phase === "baseline"), journal[0]);
    assert.deepEqual(rows(f.path, "deleted_runs"), tallies);
    const bytes = readFileSync(f.path);
    assert.equal((await f.upgrade()).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(readFileSync(backupPath), backupBytes);
    assert.equal(inspectAuthorityBackupReadOnly(backupPath).authorityContentFingerprint, before.authorityContentFingerprint);
  });
});
