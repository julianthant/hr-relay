import { default as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m1, syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";

{

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const roots: string[] = [];
const admissions: RuntimeAdmission[] = [];
const _afterEachFixture0 = () => {
  for (const admission of admissions.splice(0)) admission.release();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
function fixture() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "native-maintenance-custody-"));
  roots.push(workspace);
  const admission = acquireEntrypointAdmission(workspace, "exclusive");
  admissions.push(admission);
  const stateRoot = admission.stateRoot, processLockRoot = join(stateRoot, "locks"), path = join(stateRoot, "state.db");
  return { admission, stateRoot, processLockRoot, path };
}
it("keeps a current authority unchanged through stopped plan and no-op apply", async () => {
try {

  const f = fixture(), before = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  assert.equal((await upgradeStorage(f.admission, { ...f, plan: true }, clock)).state, "planned");
  assert.equal((await upgradeStorage(f.admission, { ...f, plan: false }, clock)).state, "already-upgraded");
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.deepEqual(readFileSync(f.path), bytes);

} finally {
_afterEachFixture0();
}
});
it("verifies a stopped native backup and borrows the caller's exact restore lease without releasing it", async () => {
try {

  const f = fixture();
  const source = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  try {
    const lock = join(f.processLockRoot, "restore-admission.lock.json"), heldBytes = readFileSync(lock);
    const report = await backupStoppedAuthority(f.admission, f.stateRoot, clock, f.processLockRoot, held);
    assert.equal(report.state, "verified");
    assert.equal(report.manifests.length, 1);
    const manifest = report.manifests[0]; assert.ok(manifest);
    assert.equal(manifest.schemaVersion, 4);
    assert.equal(manifest.authorityGeneration, source.authorityGeneration);
    assert.equal(manifest.authorityContentFingerprint, source.authorityContentFingerprint);
    const verified = await verifyBackupManifestAtPath(f.admission,
      join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`),
      AuthorityDatabase.sourceDatabaseIdentity(f.path));
    assert.deepEqual(verified.manifest, manifest);
    assert.deepEqual(readFileSync(lock), heldBytes);
    assert.ok(held.admissionId); assert.deepEqual(readFileSync(f.path), bytes);
  } finally { held.release(); }
  assert.equal(existsSync(join(f.processLockRoot, "restore-admission.lock.json")), false);

} finally {
_afterEachFixture0();
}
});
it("refuses a lost caller-held restore lease without modifying authority or publishing a backup", async () => {
try {

  const f = fixture(), bytes = readFileSync(f.path), before = inspectAuthorityBackupReadOnly(f.admission, f.path);
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  held.release();
  await assert.rejects(backupStoppedAuthority(f.admission, f.stateRoot, clock, f.processLockRoot, held), /ENOENT|restore-admission/u);
  assert.deepEqual(readFileSync(f.path), bytes);
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);

} finally {
_afterEachFixture0();
}
});
}

{

it.each(["explorer_overrides", "notifications", "notification_states"])("does not hide a missing current authority table %s after a healthy native inspection", table => {
  const f = storageRecoveryFixture();
  try {
    AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-table-control" }, f.clock).close();
    const admission = syntheticStateRoot(f.root);
    inspectAuthorityBackupReadOnly(admission, f.path);
    const database = new DatabaseSync(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(admission, f.path), /authority|schema|table/u);
  } finally { f.dispose(); }
});

it("rechecks the actual native schema after priming its immutable expected identity", () => {
  for (const version of [CURRENT_AUTHORITY_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION]) {
    const f = storageRecoveryFixture();
    AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "schema-recheck" }, f.clock).close();
    const admission = syntheticStateRoot(f.root);
    try {
      assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, version);
      assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, version);
      const raw = new DatabaseSync(f.path);
      try { raw.exec("CREATE TABLE forged_schema (value TEXT) STRICT"); } finally { raw.close(); }
      const before = readFileSync(f.path);
      assert.throws(() => inspectAuthorityBackupReadOnly(admission, f.path), /schema.*match|match.*schema/u);
      assert.deepEqual(readFileSync(f.path), before);
    } finally { admission.release(); f.dispose(); }
  }
});
}
