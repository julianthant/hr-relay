import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { withOfflineMaintenance, boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { detachBoundFixtureWorkers, stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { default as assert } from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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
  const stopped = f.admission.forStoppedMaintenance(held);
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
    const verified = await verifyBackupManifestAtPath(stopped,
      join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    assert.deepEqual(verified.manifest, manifest);
    held.assertHeld();
    assert.ok(held.operationId); assert.deepEqual(readFileSync(f.path), bytes);
  } finally { stopped.release(); held.release(); }
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

it.each(["notifications", "notification_states"])("does not hide a missing current authority table %s after a healthy native inspection", async table => {
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

for (const fault of ["missing", "copied", "foreign", "expired", "census-changed"] as const) it(`refuses ${fault} stopped backup closure before backup IO`, async () => {
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
    await assert.rejects(async () => {
        if (fault === "missing") {
          const result: unknown = Reflect.apply(backupStoppedAuthority, undefined, [undefined, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation]);
          await result;
        } else await backupStoppedAuthority(candidate, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation);
    }, { code: "STORAGE_BACKUP_CLOSURE_UNPROVED" });
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { operation.release(); foreignOperation?.release(); await _afterEachFixture0(); }
});

for (const state of ["open", "closing"] as const) it(`refuses a registered ${state} browser root before stopped backup IO`, async () => {
  const f = await fixture(), roots = createBrowserRoots(f.admission);
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "backup-registry-test" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  let launch: ReturnType<typeof roots.beginLaunch> | undefined;
  try {
    const resolved = resolveConfigWithProvenance({}, { primaryDisplay: null }, clock, f.admission);
    database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, ...resolved, capturedAt: clock.now().toISOString() });
    const worker = testAdmittedWorker(database, clock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: ["crm"] });
    const profileRoot = resolved.config.paths.browserProfileRoot, profileDirectory = join(profileRoot, `w${worker.member.ordinal}`, "crm");
    launch = roots.beginLaunch({ profileId: f.admission.profileBinding.profileId, profileRoot, profileDirectory,
      credentialFingerprint: resolved.fingerprint, owner: { kind: "worker", database, workerId: worker.workerId } });
    mkdirSync(profileDirectory, { recursive: true, mode: 0o700 }); launch.opened();
    if (state === "closing") launch.closing();
    database.authority.workerControls.observe({ workerId: worker.workerId, leaseGeneration: worker.lease.leaseGeneration,
      sessionId: randomUUID(), system: "crm", configFingerprint: resolved.fingerprint, signInFingerprint: resolved.fingerprint,
      browserMode: "headless", profileDirectory, acceptDownloads: false, exclusive: false, health: "closed",
      observedAt: clock.now().toISOString(), openedAt: clock.now().toISOString(), profileRevision: 1 });
    stopSyntheticDatabaseWorkers({ database, path: f.path }); detachBoundFixtureWorkers(database); database.close();
    const before = readFileSync(f.path), registry = roots.inventory();
    assert.equal(registry.roots.length, 1); assert.equal(registry.roots[0]?.launch.state, state);
    const operation = f.admission.acquireOfflineMaintenance();
    const native = vi.spyOn(profileBrowserClosure, "probeClosed").mockRejectedValue(new Error("unproved-registry-must-refuse-before-native-probe"));
    const query = vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(() => { throw new Error("current-owner-proof-must-not-query-os"); });
    try {
      await assert.rejects(prepareStoppedBackupClosure(profileBrowserClosure, f.admission, operation, clock, f.processLockRoot),
        { code: "STORAGE_BACKUP_CLOSURE_UNPROVED" });
      assert.equal(native.mock.calls.length, 0); assert.equal(query.mock.calls.length, 0);
      assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(roots.inventory(), registry);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
    } finally { native.mockRestore(); query.mockRestore(); operation.release(); }
  } finally { if (launch !== undefined) { launch.closing(); launch.closed(); } database.close(); await _afterEachFixture0(); }
});

it("backs up with a verified empty registry without an OS census or a second native launch", async () => {
  const f = await fixture(), operation = f.admission.acquireOfflineMaintenance();
  const query = vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(() => { throw new Error("current-owner-proof-must-not-query-os"); });
  try {
    const independent = [join(f.stateRoot, ".env"), join(f.stateRoot, "settings.json")];
    for (const path of independent) writeFileSync(path, "malformed disposable independent settings", { mode: 0o600 });
    assert.deepEqual(createBrowserRoots(f.admission).inventory().roots, []);
    const closure = await prepareStoppedBackupClosure(profileBrowserClosure, f.admission, operation, f.clock, f.processLockRoot);
    const native = vi.spyOn(profileBrowserClosure, "probeClosed").mockRejectedValue(new Error("backup-must-not-launch-browser"));
    try {
      const before = readFileSync(f.path);
      const report = await backupStoppedAuthority(closure, f.admission, f.stateRoot, f.clock, f.processLockRoot, operation);
      assert.equal(report.state, "verified"); assert.equal(native.mock.calls.length, 0); assert.equal(query.mock.calls.length, 0);
      assert.deepEqual(createBrowserRoots(f.admission).inventory().roots, []);
      assert.deepEqual(readFileSync(f.path), before);
      for (const path of independent) assert.equal(readFileSync(path, "utf8"), "malformed disposable independent settings");
    } finally { native.mockRestore(); }
  } finally { query.mockRestore(); operation.release(); await _afterEachFixture0(); }
});
