import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { withOfflineMaintenance, boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { default as assert } from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { backupStoppedAuthority, upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const cleanup of [...cleanups]) { await cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } };
async function fixture() {
  const bound = await createBoundProfileFixture();
  let database: AuthorityDatabase | undefined = undefined;
  let openingFailure: AuthoritySourceClosureUnprovedError | undefined = undefined;
  let cleanupFailure: { error: unknown } | undefined = undefined;
  cleanups.push(async () => {
    if (openingFailure !== undefined) throw openingFailure;
    if (cleanupFailure !== undefined) throw cleanupFailure.error;
    try { database?.close(); await bound.close(); }
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

  const f = await fixture(), before = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  assert.equal((await withOfflineMaintenance(f.admission, operation => upgradeStorage(profileBrowserClosure, f.admission, { ...f, plan: true }, clock, operation))).state, "planned");
  assert.equal((await withOfflineMaintenance(f.admission, operation => upgradeStorage(profileBrowserClosure, f.admission, { ...f, plan: false }, clock, operation))).state, "already-upgraded");
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.deepEqual(readFileSync(f.path), bytes);

} finally {
await _afterEachFixture0();
}
});
it("verifies a stopped native backup and borrows the caller's exact restore lease without releasing it", async () => {
try {

  const f = await fixture();
  const source = inspectAuthorityBackupReadOnly(f.admission, f.path), bytes = readFileSync(f.path);
  const held = f.admission.acquireOfflineMaintenance();
  try {
    held.assertHeld();
    assert.throws(() => f.admission.beginOfflineMaintenance(), /offline-maintenance-busy/u);
    const report = await prepareStoppedBackupClosure(profileBrowserClosure, f.admission, held, clock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, f.admission, f.stateRoot, clock, f.processLockRoot, held));
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
    held.assertHeld();
    assert.ok(held.operationId); assert.deepEqual(readFileSync(f.path), bytes);
  } finally { held.release(); }
  assert.equal(existsSync(join(f.processLockRoot, "restore-admission.lock.json")), false);

} finally {
await _afterEachFixture0();
}
});
it("refuses a lost caller-held restore lease without modifying authority or publishing a backup", async () => {
try {

  const f = await fixture(), bytes = readFileSync(f.path), before = inspectAuthorityBackupReadOnly(f.admission, f.path);
  const held = f.admission.acquireOfflineMaintenance();
  held.release();
  await assert.rejects(prepareStoppedBackupClosure(profileBrowserClosure, f.admission, held, clock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, f.admission, f.stateRoot, clock, f.processLockRoot, held)), /offline-maintenance-unissued/u);
  assert.deepEqual(readFileSync(f.path), bytes);
  assert.deepEqual(inspectAuthorityBackupReadOnly(f.admission, f.path), before);
  assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);

} finally {
await _afterEachFixture0();
}
});
}

{

it.each(["explorer_overrides", "notifications", "notification_states"])("does not hide a missing current authority table %s after a healthy native inspection", async table => {
  const f = await fixture();
  try {
    inspectAuthorityBackupReadOnly(f.admission, f.path);
    const database = new DatabaseSync(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    const bytes = readFileSync(f.path);
    const inspection = f.machine.verifiedReadOnlyCopy(f.path, createHash("sha256").update(bytes).digest("hex"));
    assert.throws(() => inspection.assertProfileRuntime(), /profile-bound-authority-required/);
    try { assert.throws(() => inspectAuthorityBackupReadOnly(inspection, f.path), /authority|schema|table/u); } finally { inspection.release(); }
  } finally { await _afterEachFixture0(); }
});

it("rechecks the actual native schema after priming its immutable expected identity", async () => {
  for (const version of [CURRENT_AUTHORITY_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION]) {
    const f = await fixture();
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
    } finally { await _afterEachFixture0(); }
  }
});
}

for (const fault of ["missing", "copied", "foreign", "expired", "census-changed", "os-query"] as const) it(`refuses ${fault} stopped backup closure before backup IO`, async () => {
  const f = await fixture(), other = fault === "foreign" ? await fixture() : undefined;
  let operation = f.admission.acquireOfflineMaintenance();
  let foreignOperation: ReturnType<typeof f.admission.acquireOfflineMaintenance> | undefined;
  try {
    const closure = await prepareStoppedBackupClosure(profileBrowserClosure, f.admission, operation, f.clock, f.processLockRoot);
    const before = readFileSync(f.path);
    let candidate = closure;
    if (fault === "copied") candidate = { ...closure };
    if (other !== undefined) {
      foreignOperation = other.admission.acquireOfflineMaintenance();
      candidate = await prepareStoppedBackupClosure(profileBrowserClosure, other.admission, foreignOperation, other.clock, other.processLockRoot);
    }
    if (fault === "expired") { operation.release(); operation = f.admission.acquireOfflineMaintenance(); }
    if (fault === "census-changed") mkdirSync(join(f.stateRoot, "browsers", "w99", "ucpath"), { recursive: true, mode: 0o700 });
    const query = fault === "os-query" ? vi.spyOn(profileProcessQuery, "spawnSync").mockReturnValue({ pid: 0, output: [],
      stdout: "", stderr: "synthetic incomplete observation", status: 1, signal: null }) : undefined;
    try {
      await assert.rejects(async () => {
        if (fault === "missing") {
          const result: unknown = Reflect.apply(backupStoppedAuthority, undefined, [undefined, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation]);
          await result;
        } else await backupStoppedAuthority(candidate, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation);
      }, { code: "STORAGE_BACKUP_CLOSURE_UNPROVED" });
      assert.deepEqual(readFileSync(f.path), before);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
    } finally { query?.mockRestore(); }
  } finally { operation.release(); foreignOperation?.release(); await _afterEachFixture0(); }
});

it("backs up under genuine prepared closure without invoking native browser launch again", async () => {
  const f = await fixture(), operation = f.admission.acquireOfflineMaintenance();
  try {
    const closure = await prepareStoppedBackupClosure(profileBrowserClosure, f.admission, operation, f.clock, f.processLockRoot);
    const native = vi.spyOn(profileBrowserClosure, "probeClosed").mockRejectedValue(new Error("backup-must-not-launch-browser"));
    try {
      const before = readFileSync(f.path);
      const report = await backupStoppedAuthority(closure, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation);
      assert.equal(report.state, "verified"); assert.equal(native.mock.calls.length, 0);
      assert.deepEqual(readFileSync(f.path), before);
    } finally { native.mockRestore(); }
  } finally { operation.release(); await _afterEachFixture0(); }
});
