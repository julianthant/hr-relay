import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { acquireRecoveryRuntimeRestore } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock, type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { type AuthorityRestoreInput } from "../../../../src/backend/storage/admission/installation.js";
import { BrowserRootsSchema, StoppedBrowserRootsV1Schema } from "../../../../src/backend/storage/browser-root-contract.js";
import { admitCommandBrowser, commandProfileDirectory, createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { restoreRetainedFilesDigest } from "../../../../src/backend/storage/maintenance/automatic-restore-files.js";
import { probeRestoreProfileBrowsersClosed, restoreBrowserMembershipDigest } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { resumeAutomaticAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { readRestoreWriteFences, restoreWriteFenceDigest } from "../../../../src/backend/storage/sqlite/restore-write-fences.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { ATOMIC_WRITE_COMMIT, CONFIG_SNAPSHOT, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../fixtures/phase1c-contract-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../admission-fixture.js";
import { seedAtomicWriteOwner } from "../timeline-write-fixture.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";

const hash = (value: unknown) => createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
function fileIdentity(path: string) {
  const bytes = readFileSync(path);
  return { byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function capturePredecessorRestoreFixture(replaced: boolean) {
  const f = await createBoundProfileFixture(), processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
  const browserPath = join(f.machine.stateRoot, "machine", "browser-roots.json"), profileId = f.admission.profileBinding.profileId;
  const profileRoot = join(f.stateRoot, "browsers"), directory = commandProfileDirectory(profileRoot);
  const capability = admitCommandBrowser(f.admission, { profileRoot, commandId: randomUUID(), requestDigest: "a".repeat(64) });
  const roots = createBrowserRoots(f.admission), launch = roots.beginLaunch({ profileId, profileRoot, profileDirectory: directory,
    owner: { kind: "command", capability }, credentialFingerprint: null });
  mkdirSync(directory, { recursive: true, mode: 0o700 }); launch.closing(); launch.closed();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "predecessor-restore" },
    systemClock, undefined, undefined, undefined, boundProfileCredentials(f.admission));
  let manifest: Awaited<ReturnType<AuthorityBackupService["request"]>>["manifests"][number];
  try {
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, systemClock,
      { stateRoot: f.stateRoot, artifactRoot: f.admission.artifactRoot });
    const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
    seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT, transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint } }, f.path, 2, snapshot);
    fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, f.path);
    const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId); assert.ok(run);
    const claim = runClaim(run); assert.ok(claim);
    const now = systemClock.now().toISOString();
    database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
      code: "unknown", message: "synthetic-unresolved-submit", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-unresolved-submit"), now });
    assert.equal(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
        intentGeneration: 1, parkedAt: now, code: "unknown", message: "synthetic-unresolved-submit" }, now }).state, "applied");
    manifest = (await new AuthorityBackupService(f.admission, database, { directory: join(f.stateRoot, "backups", "authority") })
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration })).manifests[0];
    assert.ok(manifest);
  } finally { database.close(); }
  const operation = f.admission.acquireOfflineMaintenance(), stopped = f.admission.forStoppedMaintenance(operation);
  operation.consume();
  await probeRestoreProfileBrowsersClosed(stopped, processLockRoot, operation, systemClock, profileBrowserClosure);
  const profile = stopped.captureProfileRestore(operation), current = BrowserRootsSchema.parse(JSON.parse(readFileSync(browserPath, "utf8")));
  const prior = StoppedBrowserRootsV1Schema.parse({ schemaVersion: 1, installationId: current.installationId,
    revision: current.revision, nextGeneration: current.nextGeneration, roots: current.roots.map(({ handle: _handle, ...row }) => row) });
  assert.ok(prior.roots.length > 0);
  const membership = prior.roots.filter(row => row.profileId === profileId).map(({ launch: _launch, native: _native, ...row }) => row);
  const originalDigest = hash(membership);
  assert.notEqual(originalDigest, restoreBrowserMembershipDigest(stopped));
  const operationId = randomUUID(), stagedPath = join(f.stateRoot, `.restore-${operationId}.sqlite.tmp`);
  const backupPath = join(f.stateRoot, "backups", "authority", manifest.backupFileName), manifestPath = backupPath + ".manifest.json";
  const suspectPath = join(f.stateRoot, "backups", "suspects", `suspect-predecessor-${operationId}.sqlite`);
  mkdirSync(join(f.stateRoot, "backups", "suspects"), { recursive: true, mode: 0o700 });
  copyFileSync(backupPath, stagedPath); chmodSync(stagedPath, 0o600);
  copyFileSync(f.path, suspectPath); chmodSync(suspectPath, 0o600);
  const companions = (["-wal", "-shm"] as const).filter(suffix => existsSync(f.path + suffix)).map(suffix => {
    copyFileSync(f.path + suffix, suspectPath + suffix); chmodSync(suspectPath + suffix, 0o600);
    return { suffix, binding: fileIdentity(f.path + suffix), suspect: fileIdentity(suspectPath + suffix) };
  });
  const fences = withReadonlyAuthoritySnapshot(f.path, readRestoreWriteFences);
  assert.ok(fences.unresolved.includes(WRITE_INTENT_ATTEMPTING.writeIntentId));
  const input: AuthorityRestoreInput = { operationId, profile, authorityPath: f.path, stagedPath, suspectPath, backupPath, manifestPath,
    manifestSha256: fileIdentity(manifestPath).sha256, backupSha256: manifest.sha256, sourceDatabaseIdentity: manifest.sourceDatabaseIdentity,
    authorityGeneration: manifest.authorityGeneration, authorityContentFingerprint: manifest.authorityContentFingerprint,
    browserMembershipDigest: originalDigest, retainedFilesDigest: restoreRetainedFilesDigest(f.stateRoot), unresolvedWriteDigest: restoreWriteFenceDigest(fences),
    backupTime: manifest.createdAt, restoredAt: systemClock.now().toISOString(), live: fileIdentity(f.path), staged: fileIdentity(stagedPath), suspect: fileIdentity(suspectPath), companions };
  writeFileSync(browserPath, canonicalJsonStringify(prior));
  stopped.beginAuthorityRestore(input, operation);
  const journalPath = join(f.workspace, ".tracker", "control", "journal.json"), originalJournal = readFileSync(journalPath);
  if (replaced) {
    for (const row of companions) renameSync(f.path + row.suffix, stagedPath + row.suffix + ".live-companion");
    renameSync(stagedPath, f.path);
  }
  operation.release(); stopped.release(); await f.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  let recoveryOperation: OfflineMaintenanceOperation | undefined, recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
  return { f, lifetime, input, directory, browserPath, journalPath, originalJournal, originalDigest, prior, fences,
    acquire() {
      recoveryOperation = lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, lifetime, operationId, recoveryOperation);
      return { operation: recoveryOperation, admission: recovery.admission };
    },
    async resume() {
      assert.ok(recoveryOperation); assert.ok(recovery);
      return resumeAutomaticAuthorityRestore({ admission: recovery.admission, operationId, processLockRoot,
        restoreAdmission: recoveryOperation, browserClosure: profileBrowserClosure });
    },
    release() { recoveryOperation?.release(); recovery?.admission.release(); recoveryOperation = undefined; recovery = undefined; },
    async close() { this.release(); await lifetime.close(); await f.close(); },
  };
}
