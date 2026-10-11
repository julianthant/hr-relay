import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { existsSync as existsSync_m0,mkdtempSync as mkdtempSync_m0,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,realpathSync as realpathSync_m0,rmSync as rmSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { it as it_m0,it as it_m1 } from "vitest";
import type { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority as backupStoppedAuthority_m0,upgradeStorage as upgradeStorage_m0 } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly as inspectAuthorityBackupReadOnly_m0,inspectAuthorityBackupReadOnly as inspectAuthorityBackupReadOnly_m1 } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath as verifyBackupManifestAtPath_m0 } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION as CURRENT_AUTHORITY_SCHEMA_VERSION_m1 } from "../../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission as acquireRuntimeRestoreAdmission_m0 } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture as storageRecoveryFixture_m1 } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m1,syntheticStateRoot as syntheticStateRoot_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const clock = manualClock_m0(new Date("2026-09-26T12:00:00.000Z"));
const roots: string[] = [];
const admissions: RuntimeAdmission_m0[] = [];
const _afterEachFixture0 = () => {
  for (const admission of admissions.splice(0)) admission.release();
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};
function fixture() {
  const workspace = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "native-maintenance-custody-"));
  roots.push(workspace);
  const admission = acquireEntrypointAdmission_m0(workspace, "exclusive");
  admissions.push(admission);
  const stateRoot = admission.stateRoot, processLockRoot = join_m0(stateRoot, "locks"), path = join_m0(stateRoot, "state.db");
  return { admission, stateRoot, processLockRoot, path };
}
it_m0("keeps a current authority unchanged through stopped plan and no-op apply", async () => {
try {


  const f = fixture(), before = inspectAuthorityBackupReadOnly_m0(f.admission, f.path), bytes = readFileSync_m0(f.path);
  assert_m0.equal((await upgradeStorage_m0(f.admission, { ...f, plan: true }, clock)).state, "planned");
  assert_m0.equal((await upgradeStorage_m0(f.admission, { ...f, plan: false }, clock)).state, "already-upgraded");
  assert_m0.deepEqual(inspectAuthorityBackupReadOnly_m0(f.admission, f.path), before);
  assert_m0.deepEqual(readFileSync_m0(f.path), bytes);

} finally {
_afterEachFixture0();
}
});
it_m0("verifies a stopped native backup and borrows the caller's exact restore lease without releasing it", async () => {
try {


  const f = fixture();
  const source = inspectAuthorityBackupReadOnly_m0(f.admission, f.path), bytes = readFileSync_m0(f.path);
  const held = acquireRuntimeRestoreAdmission_m0({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  try {
    const lock = join_m0(f.processLockRoot, "restore-admission.lock.json"), heldBytes = readFileSync_m0(lock);
    const report = await backupStoppedAuthority_m0(f.admission, f.stateRoot, clock, f.processLockRoot, held);
    assert_m0.equal(report.state, "verified");
    assert_m0.equal(report.manifests.length, 1);
    const manifest = report.manifests[0]; assert_m0.ok(manifest);
    assert_m0.equal(manifest.schemaVersion, 1);
    assert_m0.equal(manifest.authorityGeneration, source.authorityGeneration);
    assert_m0.equal(manifest.authorityContentFingerprint, source.authorityContentFingerprint);
    const verified = await verifyBackupManifestAtPath_m0(f.admission,
      join_m0(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`),
      AuthorityDatabase_m0.sourceDatabaseIdentity(f.path));
    assert_m0.deepEqual(verified.manifest, manifest);
    assert_m0.deepEqual(readFileSync_m0(lock), heldBytes);
    assert_m0.ok(held.admissionId); assert_m0.deepEqual(readFileSync_m0(f.path), bytes);
  } finally { held.release(); }
  assert_m0.equal(existsSync_m0(join_m0(f.processLockRoot, "restore-admission.lock.json")), false);

} finally {
_afterEachFixture0();
}
});
it_m0("refuses a lost caller-held restore lease without modifying authority or publishing a backup", async () => {
try {


  const f = fixture(), bytes = readFileSync_m0(f.path), before = inspectAuthorityBackupReadOnly_m0(f.admission, f.path);
  const held = acquireRuntimeRestoreAdmission_m0({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  held.release();
  await assert_m0.rejects(backupStoppedAuthority_m0(f.admission, f.stateRoot, clock, f.processLockRoot, held), /ENOENT|restore-admission/u);
  assert_m0.deepEqual(readFileSync_m0(f.path), bytes);
  assert_m0.deepEqual(inspectAuthorityBackupReadOnly_m0(f.admission, f.path), before);
  assert_m0.equal(existsSync_m0(join_m0(f.stateRoot, "backups", "authority")), false);

} finally {
_afterEachFixture0();
}
});
}

{


it_m1.each(["explorer_overrides", "notifications", "notification_states"])("does not hide a missing current authority table %s after a healthy native inspection", table => {
  const f = storageRecoveryFixture_m1();
  try {
    AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-table-control" }, f.clock).close();
    const admission = syntheticStateRoot_m1(f.root);
    inspectAuthorityBackupReadOnly_m1(admission, f.path);
    const database = new DatabaseSync_m1(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    assert_m1.throws(() => inspectAuthorityBackupReadOnly_m1(admission, f.path), /authority|schema|table/u);
  } finally { f.dispose(); }
});


it_m1("rechecks the actual native schema after priming its immutable expected identity", () => {
  for (const version of [CURRENT_AUTHORITY_SCHEMA_VERSION_m1, CURRENT_AUTHORITY_SCHEMA_VERSION_m1]) {
    const f = storageRecoveryFixture_m1();
    AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "schema-recheck" }, f.clock).close();
    const admission = syntheticStateRoot_m1(f.root);
    try {
      assert_m1.equal(inspectAuthorityBackupReadOnly_m1(admission, f.path).schemaVersion, version);
      assert_m1.equal(inspectAuthorityBackupReadOnly_m1(admission, f.path).schemaVersion, version);
      const raw = new DatabaseSync_m1(f.path);
      try { raw.exec("CREATE TABLE forged_schema (value TEXT) STRICT"); } finally { raw.close(); }
      const before = readFileSync_m1(f.path);
      assert_m1.throws(() => inspectAuthorityBackupReadOnly_m1(admission, f.path), /schema.*match|match.*schema/u);
      assert_m1.deepEqual(readFileSync_m1(f.path), before);
    } finally { admission.release(); f.dispose(); }
  }
});
}
