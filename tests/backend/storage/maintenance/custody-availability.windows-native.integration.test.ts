import assert from "node:assert/strict";
import nativeFs, { constants, copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { describe, it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { inspectOpenDatabase, openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { StorageMaintenanceCustodyUnavailableError, type StorageMaintenanceOperation } from "../../../../src/backend/storage/maintenance/custody-availability.js";
import { initializeRegisteredPersonStores, RegisteredPersonUpgradeRefusedError, upgradeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";

import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";
import { resumeShutdownBackupRetirement } from "../../../../src/backend/storage/maintenance/clean-shutdown-backups.js";
import { createPrivateDirectory, writePrivateStage } from "../../../../src/backend/storage/private-path.js";
import { restoreSchema19RunSettlementFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { ATOMIC_WRITE_COMMIT, CONFIG_SNAPSHOT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";

const clock = manualClock(new Date("2026-11-04T02:00:00.000Z"));


function assertRefusal(error: unknown, operation: StorageMaintenanceOperation): boolean {
  assert.ok(error instanceof StorageMaintenanceCustodyUnavailableError);
  assert.equal(error.constructor, StorageMaintenanceCustodyUnavailableError);
  assert.equal(error.code, "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE");
  assert.equal(error.operation, operation);
  return true;
}

function workspaceSnapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = lstatSync(path), key = relative(root, path);
      if (stat.isSymbolicLink()) entries[key] = `symlink:${readlinkSync(path)}`;
      else if (stat.isDirectory()) { entries[key] = "directory"; visit(path); }
      else entries[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  visit(root);
  return entries;
}

function watchPayloadReads(paths: readonly string[]) {
  const watched = new Set(paths), reads = vi.spyOn(nativeFs, "openSync");
  syncBuiltinESMExports();
  return {
    assertUnread() { assert.deepEqual(reads.mock.calls.filter(args => watched.has(String(args[0]))), [], "maintenance payload opened before refusal"); },
    close() { reads.mockRestore(); syncBuiltinESMExports(); },
  };
}

function parkUnknown(database: AuthorityDatabase, path: string, stateRoot: string) {
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot, artifactRoot: join(stateRoot, "artifacts") });
  const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
  seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT,
    transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint } }, path, 2, snapshot);
  fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, path);
  const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(run);
  const claim = runClaim(run); assert.ok(claim);
  const now = clock.now().toISOString();
  database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
    code: "unknown", message: "synthetic-unresolved-submit", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-unresolved-submit"), now });
  assert.equal(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
      intentGeneration: 1, parkedAt: now, code: "unknown", message: "synthetic-unresolved-submit" }, now }).state, "applied");
  return { intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), run: database.authority.runs.get(run.envelope.runId) };
}

async function writeInspectedTestBackup(f: Awaited<ReturnType<typeof createBoundProfileFixture>>, createdAt: string) {
  assert.equal(existsSync(`${f.path}-wal`), false, "close the owned SQLite writer before copying test bytes");
  assert.equal(existsSync(`${f.path}-shm`), false);
  const binding = f.admission.profileBinding, directory = join(f.stateRoot, "backups", "authority");
  createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
  const stagedPath = join(directory, `.native-test-${randomUUID()}.sqlite`);
  copyFileSync(f.path, stagedPath, constants.COPYFILE_EXCL);
  const raw = new DatabaseSync(stagedPath, { readOnly: true });
  let observed: ReturnType<typeof inspectOpenDatabase>;
  try { observed = inspectOpenDatabase(raw); } finally { raw.close(); }
  assert.equal(observed.installationId, binding.installationId); assert.equal(observed.profileId, binding.profileId);
  const backupFileName = `authority-g${observed.authorityGeneration}-${Date.parse(createdAt)}-${randomUUID()}.shutdown.sqlite`, path = join(directory, backupFileName);
  renameSync(stagedPath, path);
  const bytes = readFileSync(path);
  const manifest = AuthorityBackupManifestSchema.parse({ kind: "hrauto-authority-backup", manifestVersion: 4,
    backupFileName, sourceDatabaseIdentity: authoritySourceDatabaseIdentity({ kind: "profile", binding }),
    applicationId: observed.applicationId, schemaVersion: observed.schemaVersion, ...binding,
    pageCount: observed.pageCount, authorityGeneration: observed.authorityGeneration,
    authorityContentFingerprint: observed.authorityContentFingerprint, createdAt, byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    verification: { state: "verified", observedFrom: "backup-copy", observedAt: createdAt,
      applicationId: observed.applicationId, schemaVersion: observed.schemaVersion, ...binding,
      pageCount: observed.pageCount, authorityGeneration: observed.authorityGeneration,
      authorityContentFingerprint: observed.authorityContentFingerprint, quickCheck: observed.quickCheck,
      foreignKeyViolations: observed.foreignKeyViolations, invariantViolations: observed.invariantViolations, exactTableRegistry: observed.exactTableRegistry } });
  const manifestPath = `${path}.manifest.json`;
  writePrivateStage(manifestPath, Buffer.from(JSON.stringify(manifest)));
  const verified = await verifyBackupManifestAtPath(f.admission, manifestPath);
  assert.deepEqual(verified.manifest, manifest); assert.equal(verified.backupPath, path);
  return { path, manifestPath, manifest };
}

describe.skipIf(process.platform !== "win32")("actual Windows maintenance refusal", () => {
  it("refuses service and direct backup capture while preserving source and credentials", async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-refusal" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    const credential = join(f.stateRoot, "credentials", "protected.json");
    const source = readFileSync(f.path), protectedBytes = readFileSync(credential), target = join(f.stateRoot, "refused-backup.sqlite");
    try {
      const service = new AuthorityBackupService(f.admission, database, { directory: join(f.stateRoot, "backups", "authority") }, clock);
      assert.throws(() => service.request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration }), StorageMaintenanceCustodyUnavailableError);
      assert.throws(() => openAuthorityBackupSourceReadOnly(f.admission, f.path), StorageMaintenanceCustodyUnavailableError);
      await assert.rejects(database.onlineBackupTo(target), StorageMaintenanceCustodyUnavailableError);
      assert.equal(existsSync(target), false);
      assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
      assert.deepEqual(readFileSync(f.path), source); assert.deepEqual(readFileSync(credential), protectedBytes);
    } finally { database.close(); await f.close(); }
  });

  it("refuses ready-account deletion while preserving registry and credential files", async () => {
    const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
    const epoch = createProfileRegistry(f.machine).advanceSession(null);
    f.admission.release();
    const registry = f.machine.readProfileRegistry(), key = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    const keyBytes = readFileSync(key), source = readFileSync(f.path);
    try {
      assert.throws(() => f.machine.deleteProfileAccount(profileId, epoch), StorageMaintenanceCustodyUnavailableError);
      assert.deepEqual(f.machine.readProfileRegistry(), registry);
      assert.deepEqual(readFileSync(key), keyBytes); assert.deepEqual(readFileSync(f.path), source);
    } finally { await f.close(); }
  });

  it("boots current profiles and closes runtime before reporting the unavailable shutdown backup", async () => {
    const f = await createBoundProfileFixture(), port = f.lifetime.port;
    f.admission.release(); f.machine.release();
    try {
      await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
      const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: machine,
        isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
        env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
      await assert.rejects(application.stop(), StorageMaintenanceCustodyUnavailableError);
      assert.throws(() => machine.assertLive());
      await assert.rejects(fetch(`http://127.0.0.1:${application.port}/api/v1/profile`));
      await f.lifetime.close();
      const restarted = await RuntimeLifetimeLock.acquire(port);
      try { restarted.assertHeld(); } finally { await restarted.close(); }
      assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
    } finally { await f.close(); }
  });
  it("refuses a readable public restore before payload capture and preserves UNKNOWN evidence", async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-readable-restore" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    let operation: ReturnType<typeof f.admission.acquireOfflineMaintenance> | undefined;
    let reads: ReturnType<typeof watchPayloadReads> | undefined;
    try {
      const unknown = parkUnknown(database, f.path, f.stateRoot);
      database.close();
      const candidate = await writeInspectedTestBackup(f, clock.now().toISOString());
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, {
        authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot),
      }, async () => { assert.fail("Windows refusal must precede projection rebuild"); }, clock, undefined, boundProfileCredentials(f.admission));
      operation = f.admission.acquireOfflineMaintenance();
      const before = workspaceSnapshot(f.workspace);
      reads = watchPayloadReads([candidate.path, candidate.manifestPath, join(f.stateRoot, "credentials", "protected.json"),
        join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`)]);
      await assert.rejects(restore.restore({ manifestPath: candidate.manifestPath }, operation), error => assertRefusal(error, "restore"));
      reads.assertUnread(); reads.close(); reads = undefined;
      assert.deepEqual(workspaceSnapshot(f.workspace), before);
      assert.equal(existsSync(join(f.stateRoot, "backups", "suspects")), false);
      assert.throws(() => operation?.assertAvailable());
      f.admission.assertLive(); f.lifetime.assertHeld();
      const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-unknown-readback" }, clock,
        undefined, undefined, undefined, boundProfileCredentials(f.admission));
      try {
        assert.deepEqual(reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), unknown.intent);
        assert.deepEqual(reopened.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId), unknown.run);
      } finally { reopened.close(); }
    } finally { reads?.close(); database.close(); operation?.release(); await f.close(); }
  });

  it("preserves a valid pending backup retirement before reading or unlinking retained payload", async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-pending-retirement" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    let reads: ReturnType<typeof watchPayloadReads> | undefined;
    try {
      parkUnknown(database, f.path, f.stateRoot);
      database.close();
      const backups = [];
      for (let index = 0; index < 4; index++) backups.push(await writeInspectedTestBackup(f, new Date(clock.nowMs() - (4 - index) * 1000).toISOString()));
      const oldest = backups[0]; assert.ok(oldest);
      const marker = `${oldest.manifestPath}.retiring`;
      renameSync(oldest.manifestPath, marker);
      const before = workspaceSnapshot(f.workspace);
      reads = watchPayloadReads([marker, ...backups.flatMap(backup => [backup.path, backup.manifestPath])]);
      await assert.rejects(resumeShutdownBackupRetirement(f.admission, clock), error => assertRefusal(error, "backup-retirement"));
      reads.assertUnread(); reads.close(); reads = undefined;
      assert.deepEqual(workspaceSnapshot(f.workspace), before);
      assert.equal(existsSync(marker), true); assert.equal(existsSync(oldest.path), true);
      f.admission.assertLive(); f.lifetime.assertHeld();
    } finally { reads?.close(); database.close(); await f.close(); }
  });

  it("refuses a valid schema 19 startup upgrade before credential capture or backup publication", async () => {
    const lifetime = await RuntimeLifetimeLock.acquire(0), f = await createBoundProfileFixture({ lifetime });
    const binding = f.admission.profileBinding, key = join(f.machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`);
    let reads: ReturnType<typeof watchPayloadReads> | undefined;
    try {
      await f.closeController();
      assert.throws(() => f.admission.assertLive()); lifetime.assertHeld();
      const raw = new DatabaseSync(f.path);
      try {
        raw.exec("BEGIN EXCLUSIVE"); restoreSchema19RunSettlementFixture(raw); raw.exec("COMMIT");
        const observed = inspectOpenDatabase(raw, 19);
        assert.equal(observed.schemaVersion, 19); assert.equal(observed.installationId, binding.installationId); assert.equal(observed.profileId, binding.profileId);
      } finally { raw.close(); }
      const before = workspaceSnapshot(f.workspace);
      reads = watchPayloadReads([key, join(f.stateRoot, "credentials", "protected.json")]);
      await assert.rejects(upgradeRegisteredPersonStores(f.workspace, lifetime, { primaryDisplay: null }, clock), error => {
        assert.ok(error instanceof RegisteredPersonUpgradeRefusedError);
        return assertRefusal(error.cause, "schema-upgrade");
      });
      reads.assertUnread(); reads.close(); reads = undefined;
      assert.deepEqual(workspaceSnapshot(f.workspace), before);
      assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
      const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, lifetime);
      try { machine.assertLive(); } finally { machine.release(); }
      lifetime.assertHeld();
    } finally { reads?.close(); await f.close(); await lifetime.close(); }
  });

  it("refuses a held profile layout migration before profile or credential capture", async () => {
    const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
    const operation = f.machine.acquireOfflineMaintenance(); operation.consume();
    let reads: ReturnType<typeof watchPayloadReads> | undefined;
    try {
      const before = workspaceSnapshot(f.workspace);
      reads = watchPayloadReads([f.path, join(f.stateRoot, "credentials", "protected.json"),
        join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`)]);
      await assert.rejects(f.machine.forStoppedProfileLayout(profileBrowserClosure, profileId, operation, clock, { primaryDisplay: null }),
        error => assertRefusal(error, "layout-migration"));
      reads.assertUnread(); reads.close(); reads = undefined;
      assert.deepEqual(workspaceSnapshot(f.workspace), before);
      operation.assertHeld(); assert.throws(() => operation.assertAvailable()); f.machine.assertLive(); f.lifetime.assertHeld();
    } finally { reads?.close(); operation.release(); await f.close(); }
  });

});
