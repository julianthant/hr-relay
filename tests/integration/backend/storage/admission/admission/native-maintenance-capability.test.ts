import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import type { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireRuntimeRestoreAdmission } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../../../../src/backend/storage/maintenance/upgrade.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const roots: string[] = [];
const admissions: RuntimeAdmission[] = [];
afterEach(() => {
  for (const admission of admissions.splice(0)) admission.release();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "native-maintenance-custody-"));
  roots.push(workspace);
  const admission = acquireEntrypointAdmission(workspace, "exclusive");
  admissions.push(admission);
  const stateRoot = admission.stateRoot, processLockRoot = join(stateRoot, "locks"), path = join(stateRoot, "state.db");
  return { admission, stateRoot, processLockRoot, path };
}
it("keeps a current authority unchanged through stopped plan and no-op apply", async () => {
  const f = fixture(), before = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  assert.equal((await upgradeStorage(f.admission, { ...f, plan: true }, clock)).state, "planned");
  assert.equal((await upgradeStorage(f.admission, { ...f, plan: false }, clock)).state, "already-upgraded");
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.deepEqual(readFileSync(f.path), bytes);
});
it("verifies a stopped native backup and borrows the caller's exact restore lease without releasing it", async () => {
  const f = fixture();
  const source = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  try {
    const lock = join(f.processLockRoot, "restore-admission.lock.json"), heldBytes = readFileSync(lock);
    const report = await backupStoppedAuthority(f.admission, f.stateRoot, clock, f.processLockRoot, held);
    assert.equal(report.state, "verified");
    assert.equal(report.manifests.length, 1);
    const manifest = report.manifests[0]; assert.ok(manifest);
    assert.equal(manifest.schemaVersion, 1);
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
});
it("refuses a lost caller-held restore lease without modifying authority or publishing a backup", async () => {
  const f = fixture(), bytes = readFileSync(f.path), before = inspectAuthorityBackupReadOnly(f.admission, f.path);
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid }, clock);
  held.release();
  await assert.rejects(backupStoppedAuthority(f.admission, f.stateRoot, clock, f.processLockRoot, held), /ENOENT|restore-admission/u);
  assert.deepEqual(readFileSync(f.path), bytes);
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
});
