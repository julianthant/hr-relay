import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { AuthorityCapabilityUpgradeRecordSchema } from "../../src/domain/authority.js";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { acquireInitialRuntimeAdmission, type RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { ArchiveDatabase } from "../../src/backend/storage/sqlite/archive-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/backend/storage/sqlite/migrations.js";
import { inspectAuthorityBackupReadOnly } from "../../src/backend/storage/compat/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../src/backend/storage/sqlite/offline-restore.js";
import { restoreLifecyclePair, verifyLifecyclePair } from "../../src/backend/storage/sqlite/lifecycle-storage.js";
import { RecoveryStopProofStore } from "../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot, acquireRuntimeRestoreAdmission } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { backupStoppedAuthority, upgradeRelocationCapabilityV56 } from "../../src/backend/storage/storage/upgrade.js";

const NOW = "2026-09-26T12:00:00.000Z";
const clock = manualClock(new Date(NOW));
const roots: string[] = [];
const admissions: RuntimeAdmission[] = [];
afterEach(() => {
  for (const admission of admissions.splice(0)) admission.release();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(version: 55 | 56 = 55) {
  const root = mkdtempSync(join(tmpdir(), "storage-v56-"));
  roots.push(root);
  const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
  const artifactRoot = join(stateRoot, "artifacts");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const path = join(stateRoot, "state.db");
  const processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  const admission = acquireInitialRuntimeAdmission(root,
    (pair, inspection) => ({ kind: "verified-existing", pair,
      authorityGeneration: inspectAuthorityBackupReadOnly(inspection, path).authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) }),
    (_pair, initialization) => {
      if (version === 56) {
        const fresh = AuthorityDatabase.open(initialization, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
        fresh.close();
        return;
      }
      const database = new DatabaseSync(path);
      database.exec("BEGIN EXCLUSIVE");
      for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.version <= 55)) {
        for (const statement of migration.statements) database.exec(statement);
      }
      database.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at,migration_owner,migration_started_at) VALUES (1,55,0,?,NULL,NULL)").run(NOW);
      const baseline = { recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline",
        fromSchemaVersion: 0, toSchemaVersion: 55, by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: NOW };
      database.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)")
        .run(baseline.recordKey, baseline.upgradeId, baseline.phase, canonicalJsonStringify(baseline), NOW);
      database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version = 55; COMMIT`);
      database.close();
    });
  admissions.push(admission);
  return { root, workspaceRoot: root, stateRoot, path, processLockRoot, admission };
}

function proof(f: ReturnType<typeof fixture>) {
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
  const proofs = new RecoveryStopProofStore({ processLockRoot: f.processLockRoot, maxProofAgeMs: 300_000 }, clock);
  proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.processLockRoot, sourceDatabaseIdentity }, clock));
  return proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity });
}

function seedSettingsHistory(path: string): void {
  const fixture = JSON.parse(readFileSync(new URL("../unit/fixtures/migrated-settings.json", import.meta.url), "utf8")) as {
    tables: Record<string, Record<string, string | number | null>[]>;
  };
  const database = new DatabaseSync(path);
  try {
    for (const table of ["commands", "command_audits", "app_settings"] as const) {
      for (const row of fixture.tables[table] ?? []) {
        const columns = Object.keys(row);
        database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .run(...Object.values(row));
      }
    }
  } finally { database.close(); }
}

function history(path: string): Record<string, string[]> {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(["commands", "command_audits", "app_settings", "database_upgrades"].map(table =>
      [table, database.prepare(`SELECT record_json FROM ${table} ORDER BY rowid`).all().map(row => String(row.record_json))]));
  } finally { database.close(); }
}

async function ready(f: ReturnType<typeof fixture>) {
  const inspection = inspectAuthorityBackupReadOnly(f.admission, f.path);
  const backup = await backupStoppedAuthority(f.admission, f.stateRoot, clock);
  const manifest = backup.manifests[0];
  assert.ok(manifest);
  const pairedManifestPath = "pairedManifestPath" in backup && typeof backup.pairedManifestPath === "string"
    ? backup.pairedManifestPath : undefined;
  return { inspection, backupManifest: join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`),
    pairedManifestPath,
    expectedSource: { authorityGeneration: inspection.authorityGeneration,
      authorityContentFingerprint: inspection.authorityContentFingerprint } };
}

it("keeps a released v55 authority writable without automatic schema advancement", () => {
  const f = fixture();
  const before = inspectAuthorityBackupReadOnly(f.admission, f.path);
  const opened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  assert.equal(opened.getMeta().schemaVersion, 55);
  opened.close();
  const after = inspectAuthorityBackupReadOnly(f.admission, f.path);
  assert.equal(after.schemaVersion, 55);
  assert.equal(after.authorityGeneration, before.authorityGeneration);
  assert.equal(after.authorityContentFingerprint, before.authorityContentFingerprint);
});

it.each([false, true])("verifies and restores a released v55 %s lifecycle backup without advancing the schema", async paired => {
  const f = fixture();
  if (paired) new ArchiveDatabase(f.admission, join(f.stateRoot, "archive.sqlite")).close();
  const source = await ready(f);
  const verified = await verifyBackupManifestAtPath(f.admission, source.backupManifest,
    AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion, 55);
  if (paired) {
    assert.ok(source.pairedManifestPath);
    assert.equal((await verifyLifecyclePair(f.admission, source.pairedManifestPath)).live.manifest.schemaVersion, 55);
  } else assert.equal(source.pairedManifestPath, undefined);
  const options = { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "suspects"),
    busyTimeoutMs: 250, processLockRoot: f.processLockRoot, stoppedProofMaxAgeMs: 300_000 };
  const request = { manifestPath: paired ? source.pairedManifestPath ?? "" : source.backupManifest,
    stoppedSystemProof: proof(f) };
  const rebuild = async () => undefined;
  const report = paired
    ? await restoreLifecyclePair(f.admission, options, request, rebuild, clock)
    : await new OfflineAuthorityRestoreService(f.admission, options, rebuild, clock).restore(request);
  assert.equal(report.schemaVersion, 55);
  assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, 55);
});

it("upgrades only under stopped proof and verified backup, rolling back before commit and replaying after commit", async () => {
  const f = fixture();
  seedSettingsHistory(f.path);
  const beforeHistory = history(f.path);
  const source = await ready(f);
  await assert.rejects(upgradeRelocationCapabilityV56(f.admission, { ...f, ...source,
    stoppedSystemProof: proof(f), hooks: { beforeCommit: () => { throw new Error("before-commit"); } } }, clock), /before-commit/u);
  assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, 55);
  await assert.rejects(upgradeRelocationCapabilityV56(f.admission, { ...f, ...source,
    stoppedSystemProof: proof(f), hooks: { afterCommit: () => { throw new Error("after-commit"); } } }, clock), /after-commit/u);
  assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, 56);
  const afterHistory = history(f.path);
  for (const table of ["commands", "command_audits", "app_settings"] as const) {
    assert.deepEqual(afterHistory[table], beforeHistory[table]);
  }
  assert.deepEqual(afterHistory.database_upgrades?.slice(0, -1), beforeHistory.database_upgrades);
  assert.equal(await upgradeRelocationCapabilityV56(f.admission, { ...f, ...source,
    stoppedSystemProof: proof(f) }, clock), "already-upgraded");
  assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).authorityGeneration, source.expectedSource.authorityGeneration + 1);
});

it("rolls back when the held restore admission disappears before commit", async () => {
  const f = fixture();
  const source = await ready(f);
  const heldRestoreAdmission = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  await assert.rejects(upgradeRelocationCapabilityV56(f.admission, { ...f, ...source,
    stoppedSystemProof: proof(f), heldRestoreAdmission,
    hooks: { beforeCommit: () => heldRestoreAdmission.release() } }, clock), /restore-admission/u);
  assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, 55);
});

it("accepts the caller's exact fixed restore lease without releasing it", async () => {
  const f = fixture();
  const source = await ready(f);
  const stoppedSystemProof = proof(f);
  const heldRestoreAdmission = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  try {
    assert.equal(await upgradeRelocationCapabilityV56(f.admission,
      { ...f, ...source, stoppedSystemProof, heldRestoreAdmission }, clock), "converted");
    assert.ok(heldRestoreAdmission.admissionId);
  } finally { heldRestoreAdmission.release(); }
});

it("refuses a forged v56 capability receipt in v55 and missing target receipt in v56", () => {
  const f = fixture();
  const database = new DatabaseSync(f.path);
  try {
    const forged = AuthorityCapabilityUpgradeRecordSchema.parse({ format: 4, recordKey: randomUUID(),
      upgradeId: "a".repeat(64), phase: "settled", fromSchemaVersion: 55, toSchemaVersion: 56,
      by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: NOW, sourceGeneration: 0,
      sourceFingerprint: "b".repeat(64), backupManifest: "/tmp/forged", backupSha256: "c".repeat(64) });
    database.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES (?,?,?,?,?)")
      .run(forged.recordKey, forged.upgradeId, forged.phase, canonicalJsonStringify(forged), NOW);
  } finally { database.close(); }
  assert.throws(() => inspectAuthorityBackupReadOnly(f.admission, f.path), /capability-upgrade-record-before-schema/u);

  const other = fixture(56);
  const raw = new DatabaseSync(other.path);
  try {
    for (const row of raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'database_upgrades'").all()) {
      raw.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
    }
    raw.prepare("DELETE FROM database_upgrades WHERE phase = 'baseline'").run();
  }
  finally { raw.close(); }
  assert.throws(() => inspectAuthorityBackupReadOnly(other.admission, other.path), /immutable migration replay/u);
});
