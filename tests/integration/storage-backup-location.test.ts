import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { storageRelocationDesiredDigest } from "../../src/domain/commands.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { hostConfigFacts } from "../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { ConfigSnapshotWriteSchema } from "../../src/domain/config/snapshot.js";
import { NonNegativeIntSchema } from "../../src/domain/ids.js";
import { ArchiveDatabase } from "../../src/infra/sqlite/archive-database.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { acquireExclusiveRuntimeAdmission, acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission } from "../../src/infra/runtime-control/admission.js";
import { acquireInstallation, type RelocationPlanBinding, type RuntimePair, type VerifiedRelocationEvidence, type VerifiedRelocationPreparation } from "../../src/infra/runtime-control/installation.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../src/infra/sqlite/runtime-process-locks.js";
import { RecoveryStopProofStore } from "../../src/infra/sqlite/recovery-stop-proof.js";
import { OfflineAuthorityRestoreService } from "../../src/infra/sqlite/offline-restore.js";
import { restoreLifecyclePair } from "../../src/infra/sqlite/lifecycle-storage.js";
import { doctorAuthorityStorage, summarizeBackupHealth } from "../../src/infra/sqlite/storage-doctor.js";
import { backupStoppedAuthority } from "../../src/server/storage/upgrade.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const workspaces: string[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });

async function movedFixture(paired: boolean, artifactOnly = false) {
  const workspace = mkdtempSync(join(tmpdir(), "backup-location-"));
  workspaces.push(workspace);
  const source: RuntimePair = { stateRoot: join(workspace, rebuildRuntimeIsolation.stateRoot),
    artifactRoot: join(workspace, rebuildRuntimeIsolation.artifactRoot) };
  mkdirSync(source.artifactRoot, { recursive: true, mode: 0o700 });
  const initial = acquireInitialRuntimeAdmission(workspace,
    (pair, inspection) => ({ kind: "verified-existing", pair,
      authorityGeneration: AuthorityDatabase.inspectExistingReadOnly(inspection, join(pair.stateRoot, "state.db")).authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db")) }),
    (pair, initialization) => {
      AuthorityDatabase.open(initialization, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250,
        migrationOwner: "backup-location-fixture" }, clock).close();
    });
  try {
    if (paired) new ArchiveDatabase(initial, join(source.stateRoot, "archive.sqlite")).close();
    writeFileSync(join(source.artifactRoot, "a.artifact"), "synthetic artifact");
    const backed = await backupStoppedAuthority(initial, source.stateRoot, clock);
    assert.ok(backed.manifests[0]);
  } finally { initial.release(); }

  const destination: RuntimePair = artifactOnly
    ? { stateRoot: source.stateRoot, artifactRoot: join(workspace, "moved-artifacts") }
    : { stateRoot: join(workspace, "moved-state"), artifactRoot: join(workspace, "moved-state", "artifacts") };
  const lease = acquireInstallation(workspace, "exclusive");
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot), pid: process.pid }, clock);
  try {
    const plan: RelocationPlanBinding = { commandId: "11111111-1111-4111-8111-111111111111", revision: 1,
      expectedRevision: 0, requestFingerprint: "a".repeat(64),
      desiredDigest: storageRelocationDesiredDigest({ installationId: lease.locator.installationId,
        sourceGeneration: NonNegativeIntSchema.parse(0), sourcePair: source,
        expectedRevision: NonNegativeIntSchema.parse(0) }, destination) };
    const operationId = lease.beginRelocation(destination, plan, held);
    const backupDir = join(source.stateRoot, "backups", "authority");
    const manifestFileName = readdirSync(backupDir).find((name) => name.endsWith(".manifest.json"));
    assert.ok(manifestFileName);
    const manifest = JSON.parse(readFileSync(join(backupDir, manifestFileName), "utf8")) as { backupFileName: string };
    const preparation: VerifiedRelocationPreparation = { operationId, installationId: lease.locator.installationId,
      sourceGeneration: 0, source, destination, plan,
      sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(source.stateRoot, "state.db")),
      sourceSchemaVersion: 56, sourceAuthorityGeneration: 0,
      sourceAuthorityContentFingerprint: "d".repeat(64), backupReceiptId: "synthetic-preparation",
      backupManifestPath: join(backupDir, manifestFileName), backupManifestSha256: "e".repeat(64),
      backupFilePath: join(backupDir, manifest.backupFileName), backupFileSha256: "f".repeat(64) };
    lease.recordVerifiedPreparation(() => preparation);
    lease.prepareDestinationRoots();
    if (!artifactOnly) {
      for (const name of ["state.db", "backups", ...(paired ? ["archive.sqlite"] : [])]) {
        cpSync(join(source.stateRoot, name), join(destination.stateRoot, name), { recursive: true });
      }
    }
    copyFileSync(join(source.artifactRoot, "a.artifact"), join(destination.artifactRoot, "a.artifact"));
    const inventory = lease.relocationInventory();
    const pinned = new Set(inventory.pinnedEntries);
    const managedStateEntries = artifactOnly ? [] : readdirSync(source.stateRoot).filter((name) => !["locks", ".runtime-owner.json", ".runtime-source-fence.json"].includes(name)
      && !pinned.has(name)).map((name) => ({ name,
        kind: statSync(join(source.stateRoot, name)).isDirectory() ? "directory" as const : "file" as const }));
    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock);
    const config = { ...resolved.config, paths: { ...resolved.config.paths,
      stateRoot: destination.stateRoot, artifactRoot: destination.artifactRoot } };
    const configFingerprint = createHash("sha256").update(canonicalJsonStringify(config)).digest("hex");
    const evidence: VerifiedRelocationEvidence = { operationId, installationId: lease.locator.installationId,
      sourceGeneration: 0, source, destination, plan, stagingReceiptId: "synthetic-stage", stagingDigest: "b".repeat(64),
      backupReceiptId: "synthetic-backup", backupDigest: "c".repeat(64),
      finalDatabasePath: join(destination.stateRoot, "state.db"), configSnapshotId: randomUUID(),
      configFingerprint, authorityVersion: 56, databaseIdentity: "synthetic-db", managedStateEntries };
    const verify = () => evidence;
    lease.recordActivationIntent(() => ({ operationId, installationId: lease.locator.installationId,
      sourceGeneration: 0, source, destination, plan,
      stageAuthority: { manifestPath: join(backupDir, manifestFileName), manifestSha256: "e".repeat(64),
        backupPath: join(backupDir, manifest.backupFileName), backupSha256: "f".repeat(64) },
      stageArchive: null, nativeDestinationPath: join(destination.stateRoot, "state.db"),
      nativeDestinationSha256: artifactOnly ? null : "f".repeat(64),
      preAuthorityGeneration: 0, preAuthorityContentFingerprint: "d".repeat(64),
      managedInventoryDigest: "a".repeat(64), settingsRevision: 1, settingsFingerprint: "b".repeat(64),
      priorActive: null, snapshot: ConfigSnapshotWriteSchema.parse({ configSnapshotId: evidence.configSnapshotId,
        revision: 1, fingerprint: configFingerprint, capturedAt: clock.now().toISOString(),
        capturedBy: "local-operator", config, provenance: resolved.provenance }) }));
    lease.recordVerifiedStage(verify);
    lease.fenceRelocationSource();
    lease.retainRelocationSources();
    lease.switchRelocationLocator(verify);
    lease.settleRelocation(verify);
  } finally { lease.release(); held.release(); }
  const admission = artifactOnly ? acquireExclusiveRuntimeAdmission(workspace) : acquireSharedRuntimeAdmission(workspace);
  const options = { stateRootTrustAnchor: workspace, stateRoot: destination.stateRoot,
    authorityPath: join(destination.stateRoot, "state.db"),
    backupDirectory: join(destination.stateRoot, "backups", "authority"), busyTimeoutMs: 250 };
  return { workspace, source, destination, admission, options };
}

it.each([false, true])("verifies copied %s backups as previous-location evidence without current restore eligibility", async paired => {
  const f = await movedFixture(paired);
  try {
    const before = await doctorAuthorityStorage(f.admission, f.options, clock);
    assert.equal(before.backup.state, "missing");
    assert.ok(before.backup.state === "missing");
    assert.match(before.backup.cause.summary, /previous-location/u);
    assert.equal(before.restoreCandidates.length, 0);
    assert.equal(before.previousLocationBackups?.length, paired ? 2 : 1);
    assert.ok(before.previousLocationBackups?.every((backup) => backup.restoreEligibility === "not-admitted"));
    assert.equal(summarizeBackupHealth({ backupDirectory: f.options.backupDirectory }, 0, clock), "missing");

    await backupStoppedAuthority(f.admission, f.destination.stateRoot, clock);
    const oldManifest = before.previousLocationBackups?.find((entry) => entry.selection === "single-database");
    assert.ok(oldManifest);
    const nextMtime = new Date(clock.nowMs() + 30_000);
    utimesSync(join(f.options.backupDirectory, oldManifest.manifestFileName), nextMtime, nextMtime);
    const after = await doctorAuthorityStorage(f.admission, f.options, clock);
    assert.equal(after.backup.state, "current");
    assert.equal(after.previousLocationBackups?.length, paired ? 2 : 1);
    assert.ok(after.restoreCandidates.some((candidate) => candidate.state === "verified-compatible"));
    assert.equal(summarizeBackupHealth({ backupDirectory: f.options.backupDirectory }, 0, clock), "current");

    const unrelated = join(f.options.backupDirectory, "unrelated.manifest.json");
    const sourceManifest = JSON.parse(readFileSync(join(f.options.backupDirectory, oldManifest.manifestFileName), "utf8")) as Record<string, unknown>;
    writeFileSync(unrelated, JSON.stringify({ ...sourceManifest, sourceDatabaseIdentity: "f".repeat(64) }));
    const unrelatedReport = await doctorAuthorityStorage(f.admission, f.options, clock);
    assert.equal(unrelatedReport.backup.state, "invalid");
    assert.equal(unrelatedReport.restoreCandidates.find((candidate) => candidate.manifestFileName === "unrelated.manifest.json")?.state, "invalid");

    const receiptsDirectory = join(f.workspace, ".runtime-control", "relocation-receipts");
    const receiptName = readdirSync(receiptsDirectory)[0];
    assert.ok(receiptName);
    const receiptPath = join(receiptsDirectory, receiptName);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, installationId: randomUUID() }));
    const tampered = await doctorAuthorityStorage(f.admission, f.options, clock);
    assert.equal(tampered.backup.state, "invalid");
    assert.equal(tampered.previousLocationBackups, undefined);
    assert.equal(tampered.restoreCandidates.find((candidate) => candidate.manifestFileName === oldManifest.manifestFileName)?.state, "invalid");
  } finally { f.admission.release(); }
});

it.each([false, true])("refuses a same-origin pre-relocation %s backup before any restore effect", async paired => {
  const f = await movedFixture(paired, true);
  try {
    const authorityPath = f.options.authorityPath;
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
    const manifests = readdirSync(f.options.backupDirectory);
    const manifestFileName = manifests.find(name => name.endsWith(paired ? ".lifecycle.json" : ".manifest.json"));
    assert.ok(manifestFileName);
    const report = await doctorAuthorityStorage(f.admission, f.options, clock);
    const candidate = report.restoreCandidates.find(row => row.manifestFileName === manifestFileName);
    assert.ok(candidate?.state === "verified-compatible");
    assert.equal(candidate.restoreEligibility.state, "unavailable");
    const proofStore = new RecoveryStopProofStore({ processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot),
      maxProofAgeMs: 300_000 }, clock);
    proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot),
      sourceDatabaseIdentity }, clock));
    const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
    const options = { authorityPath, suspectDirectory: join(f.destination.stateRoot, "suspects"), busyTimeoutMs: 250,
      processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot), stoppedProofMaxAgeMs: 300_000 };
    const request = { manifestPath: join(f.options.backupDirectory, manifestFileName), stoppedSystemProof };
    const before = readFileSync(authorityPath);
    const restore = paired
      ? restoreLifecyclePair(f.admission, options, request, async () => undefined, clock)
      : new OfflineAuthorityRestoreService(f.admission, options, async () => undefined, clock).restore(request);
    await assert.rejects(restore, /activation receipt has no matching plan command/u);
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(options.suspectDirectory), false);
    assert.equal(existsSync(join(f.destination.stateRoot, ".lifecycle-restore.json")), false);
    assert.equal(existsSync(join(options.processLockRoot, "restore-admission.lock.json")), false);
  } finally { f.admission.release(); }
});
