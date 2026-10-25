import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { default as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { backupStoppedAuthority, upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of [...cleanups]) { cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } };
function fixture() {
  const bound = createBoundProfileFixture();
  let database: AuthorityDatabase | undefined = undefined;
  let openingFailure: AuthoritySourceClosureUnprovedError | undefined = undefined;
  let cleanupFailure: { error: unknown } | undefined = undefined;
  cleanups.push(() => {
    if (openingFailure !== undefined) throw openingFailure;
    if (cleanupFailure !== undefined) throw cleanupFailure.error;
    try { database?.close(); bound.close(); }
    catch (error) { cleanupFailure = { error }; throw error; }
  });
  const admission = bound.admission, stateRoot = bound.stateRoot, path = bound.path;
  try {
    database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "backup-inspection-test" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(admission));
    assert.equal(inspectAuthorityBackupReadOnly(admission, path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.close();
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) openingFailure = error;
    throw error;
  }
  return { admission, machine: bound.machine, stateRoot, path, clock,
    processLockRoot: join(bound.workspace, rebuildRuntimeIsolation.processLockRoot) };
}
{
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
    assert.equal(manifest.schemaVersion, source.schemaVersion);
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
  const f = fixture();
  try {
    inspectAuthorityBackupReadOnly(f.admission, f.path);
    const database = new DatabaseSync(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    const bytes = readFileSync(f.path);
    const inspection = f.machine.verifiedReadOnlyCopy(f.path, createHash("sha256").update(bytes).digest("hex"));
    assert.throws(() => inspection.assertProfileRuntime(), /profile-bound-authority-required/);
    try { assert.throws(() => inspectAuthorityBackupReadOnly(inspection, f.path), /authority|schema|table/u); } finally { inspection.release(); }
  } finally { _afterEachFixture0(); }
});

it("rechecks the actual native schema after priming its immutable expected identity", () => {
  for (const version of [CURRENT_AUTHORITY_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION]) {
    const f = fixture();
    try {
      assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, version);
      assert.equal(inspectAuthorityBackupReadOnly(f.admission, f.path).schemaVersion, version);
      const raw = new DatabaseSync(f.path);
      try { raw.exec("CREATE TABLE forged_schema (value TEXT) STRICT"); } finally { raw.close(); }
      const before = readFileSync(f.path);
      const bytes = readFileSync(f.path);
      const inspection = f.machine.verifiedReadOnlyCopy(f.path, createHash("sha256").update(bytes).digest("hex"));
      assert.throws(() => inspection.assertProfileRuntime(), /profile-bound-authority-required/);
    try { assert.throws(() => inspectAuthorityBackupReadOnly(inspection, f.path), /schema.*match|match.*schema/u); } finally { inspection.release(); }
      assert.deepEqual(readFileSync(f.path), before);
    } finally { _afterEachFixture0(); }
  }
});
}
