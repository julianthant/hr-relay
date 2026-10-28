import { SourceRecordSchema, StorageBackupSchema, hash, file, inventory, verifyCopies, retainedStorageBackup, existingDataFileLabel } from "./existing-data-backup-files.js";
import { decodeStoredArtifact } from "../artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyFlatBackupRecoveryManifest } from "../sqlite/backup-service.js";
import { observeRuntimeLockSnapshot, inspectRuntimeProcessOrphans, assertRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { enumerateFlatBackupRecoveryMembership, assertCredentialCopyResourcesClosed } from "./profile-inventory.js";
import { profileAuthorityFileWitnesses } from "../configuration/credential-store.js";
import { type RuntimeLocator } from "../admission/installation.js";
import { FlatBackupRecoveryBindingSchema, MutexRecoveryReceiptSchema, MutexOwnerSchema } from "../admission/mutex-contracts.js";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { writePrivateStage, fsyncPath, noSymlinkAncestry, statDirectory, unpublishedDraftAbortMembership } from "../configuration/credential-safe-file.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";

async function inspectCoupledBackupSource(admission: RuntimeAdmission, flat: boolean, clock: Clock) {
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { assertCredentialCopyResourcesClosed, enumerateProfileCredentialMembership } = await import("./profile-inventory.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const processLockRoot = join(context.workspace, rebuildRuntimeIsolation.processLockRoot);
  const sourceFacts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  assertCredentialCopyResourcesClosed(sourceFacts);
  if (flat && sourceFacts.slots.some(slot => slot.retiredAt === null)) throw new Error("existing-data-flat-worker-custody-unsupported");
  {
    const settings = sourceFacts.settingsAuthority.state === "initialized"
      ? sourceFacts.settingsAuthority.record.saved?.settings ?? sourceFacts.settingsAuthority.record.initialization.settings.settings : undefined;
    const membership = enumerateProfileCredentialMembership(admission, sourceFacts, settings?.paths?.browserProfileRoot ?? join(admission.stateRoot, "browsers"));
    const backups = membership.manifests.map(path => verifyStoppedBackupManifestAtPath(admission, path, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db"))));
    if (backups.length !== membership.backupPaths.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("existing-data-backup-source-membership-unproved");
    assertCoupledArtifacts(admission.artifactRoot, sourceFacts.artifactReferences);
  }
  const current = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  if (flat) {
    if (admission.stateRoot !== join(context.workspace, rebuildRuntimeIsolation.stateRoot) || admission.artifactRoot !== join(admission.stateRoot, "artifacts")) throw new Error("flat-backup-source-refused");
    assertFlatBackupFacts(context.workspace, admission.stateRoot, admission.artifactRoot, sourceFacts);
  }
  return { current, processLockRoot };
}

async function writeCoupledBackup(machine: RuntimeAdmission, admission: RuntimeAdmission, root: string, flat: boolean, clock: Clock) {
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { profileAuthorityFileWitnesses } = await import("../configuration/credential-store.js");
  const { assertCredentialCopyResourcesClosed } = await import("./profile-inventory.js");
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const { current, processLockRoot } = await inspectCoupledBackupSource(admission, flat, clock);
  const authorityDirectory = join(admission.stateRoot, "backups", "authority"), controlRoot = join(context.workspace, ".tracker", "control");
  const sourcePath = join(root, "source.json");
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) !== undefined) {
    const prior = SourceRecordSchema.parse(JSON.parse(file(sourcePath).bytes.toString("utf8")));
    if (prior.installationId !== machine.locator.installationId || prior.sourceStateRoot !== admission.stateRoot
      || prior.sourceFingerprint !== current.authorityContentFingerprint || prior.sourceGeneration !== current.authorityGeneration) throw new Error("existing-data-backup-source-changed");
  }
  const storageRoot = join(controlRoot, "storage-backups", machine.locator.installationId);
  const storageBackup = root === storageRoot ? undefined : retainedStorageBackup(context.workspace, machine.locator.installationId);
  if (flat && storageBackup !== undefined) {
    const retained = StorageBackupSchema.parse(JSON.parse(file(storageBackup.backupPath).bytes.toString("utf8")));
    verifyStoppedBackupManifestAtPath(admission, retained.authorityManifest, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
    if (hash(file(retained.authorityManifest).bytes) !== retained.authorityDigest) throw new Error("storage-backup-authority-refused");
  }
  const profileRoot = admission.stateRoot;
  const databases = canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot));
  const recoveryHistory = root === storageRoot ? flatBackupRecoveryHistory(root, machine.locator.installationId, machine.locator.generation) : undefined;
  const census = () => {
    if (recoveryHistory !== undefined && flatBackupRecoveryHistory(root, machine.locator.installationId, machine.locator.generation).observation !== recoveryHistory.observation) throw new Error("flat-backup-recovery-history-changed");
    return coupledBackupCensus(context.workspace, admission.stateRoot, machine.stateRoot, flat,
      root === storageRoot || storageBackup !== undefined ? machine.locator.installationId : undefined, undefined, recoveryHistory?.excluded);
  };
  census();
  let authorityManifest: string | undefined;
  if (lstatSync(authorityDirectory, { throwIfNoEntry: false }) !== undefined) {
    for (const name of readdirSync(authorityDirectory).sort()) {
      if (!name.endsWith(".manifest.json")) continue;
      const path = join(authorityDirectory, name), existing = verifyStoppedBackupManifestAtPath(admission, path,
        AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
      if (existing.manifest.authorityContentFingerprint === current.authorityContentFingerprint && existing.manifest.authorityGeneration === current.authorityGeneration) authorityManifest = path;
    }
  }
  if (authorityManifest === undefined) {
    const backed = await backupStoppedAuthority(admission, admission.stateRoot, clock, processLockRoot, admission.maintenanceRestore() ?? machine.maintenanceRestore());
    if (backed.manifests.length !== 1 || backed.manifests[0] === undefined) throw new Error("existing-data-backup-single-authority-required");
    authorityManifest = join(authorityDirectory, `${backed.manifests[0].backupFileName}.manifest.json`);
  }
  verifyStoppedBackupManifestAtPath(admission, authorityManifest, AuthorityDatabase.sourceDatabaseIdentity(join(admission.stateRoot, "state.db")));
  const afterBackup = AuthorityDatabase.inspectStoppedUpgrade(admission, join(admission.stateRoot, "state.db"), processLockRoot, clock);
  if (afterBackup.authorityContentFingerprint !== current.authorityContentFingerprint || afterBackup.authorityGeneration !== current.authorityGeneration) throw new Error("existing-data-backup-source-changed");
  const source = census();
  const sourceRecordBytes = () => coupledSourceRecord(machine.locator.installationId, admission.stateRoot, current, census);
  const sourceRecord = sourceRecordBytes();
  const verifySource = () => { if (!sourceRecordBytes().equals(sourceRecord)) throw new Error("existing-data-backup-source-changed"); };
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) === undefined) {
    if (lstatSync(join(root, "files"), { throwIfNoEntry: false }) !== undefined || lstatSync(join(root, "backup.json"), { throwIfNoEntry: false }) !== undefined) throw new Error("existing-data-backup-source-required");
    writePrivateStage(sourcePath, sourceRecord); fsyncPath(root);
  } else if (!file(sourcePath).bytes.equals(sourceRecord)) throw new Error("existing-data-backup-source-changed");
  for (const entry of source) {
    const bytes = file(entry.path, existingDataFileLabel(entry.file.path)).bytes;
    if (hash(bytes) !== entry.file.digest) throw new Error("existing-data-backup-source-changed");
    const target = join(root, "files", entry.file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (lstatSync(target, { throwIfNoEntry: false }) === undefined) { writePrivateStage(target, bytes); fsyncPath(dirname(target)); }
    else {
      if (hash(file(target).bytes) !== entry.file.digest) throw new Error("existing-data-backup-copy-changed");
      fsyncPath(target);
    }
  }
  const directories = new Set([root, dirname(root), controlRoot]);
  for (const entry of source) {
    for (let directory = dirname(join(root, "files", entry.file.path)); directory.startsWith(`${root}/`); directory = dirname(directory)) directories.add(directory);
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) fsyncPath(directory);
  verifyCopies(root, source.map(entry => entry.file));
  if (canonicalJsonStringify(census()) !== canonicalJsonStringify(source)
    || canonicalJsonStringify(profileAuthorityFileWitnesses(profileRoot)) !== databases) throw new Error("existing-data-backup-source-changed");
  verifySource(); admission.assertLive();
  assertCredentialCopyResourcesClosed(AuthorityDatabase.readProfileMaintenanceInventory(admission));
  return { authorityManifest, authorityDigest: hash(file(authorityManifest).bytes), files: source.map(entry => entry.file),
    sourceDigest: hash(sourceRecord), source, census, databases, storageBackup, verifySource };
}

export async function backupFlatStorage(admission: RuntimeAdmission, clock: Clock) {
  if (!admission.isFlatBackup()) throw new Error("flat-backup-authority-required");
  await inspectCoupledBackupSource(admission, true, clock);
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const root = join(context.workspace, ".tracker", "control", "storage-backups", admission.locator.installationId);
  mkdirSync(root, { recursive: true, mode: 0o700 }); noSymlinkAncestry(root, new Map());
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (readdirSync(dirname(root)).some(name => name !== admission.locator.installationId)
    || readdirSync(root).some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("storage-backup-membership-refused");
  if (lstatSync(join(root, "backup.json"), { throwIfNoEntry: false }) !== undefined) retainedStorageBackup(context.workspace, admission.locator.installationId);
  const coupled = await writeCoupledBackup(admission, admission, root, true, clock);
  const record = StorageBackupSchema.parse({ schemaVersion: 1, installationId: admission.locator.installationId,
    sourceStateRoot: admission.stateRoot, authorityManifest: coupled.authorityManifest, authorityDigest: coupled.authorityDigest,
    sourceDigest: coupled.sourceDigest, files: coupled.files });
  const bytes = Buffer.from(canonicalJsonStringify(record)), path = join(root, "backup.json");
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) { writePrivateStage(path, bytes); fsyncPath(root); fsyncPath(dirname(root)); }
  else if (!file(path).bytes.equals(bytes)) throw new Error("storage-backup-changed");
  retainedStorageBackup(context.workspace, admission.locator.installationId);
  coupled.verifySource(); admission.assertLive();
  return { manifests: [AuthorityBackupManifestSchema.parse(JSON.parse(file(record.authorityManifest).bytes.toString("utf8")))],
    coupledBackup: { backupPath: path, backupDigest: hash(bytes) } };
}

export function assertFlatBackupFacts(workspace: string, stateRoot: string, artifactRoot: string,
  sourceFacts: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>) {
    const expectedPaths = { stateRoot, artifactRoot,
      browserProfileRoot: join(stateRoot, "browsers"), duoCredential: join(stateRoot, "credentials", "duo-webauthn.json"),
      reportsDir: join(workspace, "data", "reports"), downloadsDir: join(workspace, "data", "downloads"),
      onboardingDocsDir: join(workspace, "data", "onboarding"), i9CheckTrackerPath: join(workspace, "data", "reports", "i9-check-tracker.xlsx") };
    if (sourceFacts.configSnapshots.some(snapshot => {
      const { duoExtensionDir: _extension, ...paths } = snapshot.config.paths;
      return canonicalJsonStringify(paths) !== canonicalJsonStringify(expectedPaths);
    })) throw new Error("existing-data-flat-custom-paths-unsupported");
    const settings = sourceFacts.settingsAuthority;
    if (settings.state !== "initialized" || settings.record.active === null) throw new Error("existing-data-flat-settings-unavailable");
    const active = settings.record.active;
    if (Object.keys((settings.record.saved?.settings ?? settings.record.initialization.settings.settings).paths ?? {}).length !== 0) throw new Error("existing-data-flat-custom-paths-unsupported");
    if (!sourceFacts.configSnapshots.some(snapshot => snapshot.configSnapshotId === active.configSnapshotId && snapshot.fingerprint === active.configFingerprint)) throw new Error("existing-data-flat-settings-unavailable");
}

function coupledBackupCensus(workspace: string, profileRoot: string, machineRoot: string, flat: boolean,
  storageInstallationId?: string, recoveryReceipt?: string, recoveryMembers: readonly string[] = []) {
  return [
    ...inventory(profileRoot, "profile", new Set(["state.db", "state.db-wal", "state.db-shm", "state.db-journal", ...(flat ? ["locks"] : [])])),
    ...(flat ? [] : inventory(join(machineRoot, "machine"), "machine")),
    ...(flat && lstatSync(join(workspace, "data"), { throwIfNoEntry: false }) !== undefined ? inventory(join(workspace, "data"), "workspace-data") : []),
    ...inventory(join(workspace, ".tracker", "control"), "control", new Set(["leases", "admission-mutex",
      ...(storageInstallationId === undefined ? [] : [`storage-backups/${storageInstallationId}`]),
      ...(recoveryReceipt === undefined ? [] : [`admission-mutex-recovery/${recoveryReceipt}.json`]), ...recoveryMembers])),
  ];
}

function coupledSourceRecord(installationId: string, profileRoot: string,
  current: Pick<ReturnType<typeof AuthorityDatabase.inspectStoppedUpgrade>, "authorityContentFingerprint" | "authorityGeneration">,
  census: () => ReturnType<typeof inventory>) {
  return Buffer.from(canonicalJsonStringify({ schemaVersion: 1, installationId, sourceStateRoot: profileRoot,
    sourceFingerprint: current.authorityContentFingerprint, sourceGeneration: current.authorityGeneration,
    databases: profileAuthorityFileWitnesses(profileRoot).map(entry => ({ ...entry,
      ...(entry.file === undefined ? {} : { mode: file(join(profileRoot, `state.db${entry.suffix}`), "authority database").stat.mode }) })),
    files: census().map(entry => ({ ...entry.file, mode: file(entry.path, existingDataFileLabel(entry.file.path)).stat.mode })) }));
}

export function observeFlatBackupMutexRecovery(workspace: string, locator: RuntimeLocator, restore: RestoreAdmissionHandle,
  recoveryReceipt: string) {
  const stateRoot = join(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot = join(stateRoot, "artifacts");
  const control = join(workspace, ".tracker", "control"), processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  assertRuntimeRestoreAdmission(restore, processLockRoot);
  const locks = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")) });
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (Object.values(locks.processLocks).some(lock => lock.state !== "stopped") || orphans.staleServerRecords > 0 || orphans.staleWorkerRecords > 0) throw new Error("flat-backup-recovery-process-custody-refused");
  if (locator.stateRoot !== stateRoot || locator.artifactRoot !== artifactRoot
    || [join(stateRoot, "machine"), join(stateRoot, "profiles"), ...["profile-registry.json", "profile-flat-claim.json", "profile-publication.json", "profile-owner-claims"]
      .map(name => join(control, name))].some(path => lstatSync(path, { throwIfNoEntry: false }) !== undefined)) throw new Error("flat-backup-recovery-source-refused");
  noSymlinkAncestry(stateRoot, new Map()); noSymlinkAncestry(artifactRoot, new Map());
  const allocations = join(control, "storage-backups"), root = join(allocations, locator.installationId);
  statDirectory(allocations, "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (canonicalJsonStringify(readdirSync(allocations)) !== canonicalJsonStringify([locator.installationId])) throw new Error("flat-backup-recovery-membership-refused");
  const names = readdirSync(root).sort();
  if (names.some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("flat-backup-recovery-membership-refused");
  const { inspection, facts } = AuthorityDatabase.readFlatBackupRecoveryInventory(join(stateRoot, "state.db"), restore);
  assertCredentialCopyResourcesClosed(facts);
  if (facts.slots.some(slot => slot.retiredAt === null)) throw new Error("flat-backup-recovery-worker-custody-refused");
  assertFlatBackupFacts(workspace, stateRoot, artifactRoot, facts);
  assertCoupledArtifacts(artifactRoot, facts.artifactReferences);
  const membership = enumerateFlatBackupRecoveryMembership(stateRoot, facts);
  const backups = membership.manifests.map(path => verifyFlatBackupRecoveryManifest(path, AuthorityDatabase.sourceDatabaseIdentity(join(stateRoot, "state.db")), restore, processLockRoot));
  if (backups.length !== membership.backupPaths.length || membership.backupPaths.some(path => !backups.some(backup => backup.backupPath === path))) throw new Error("flat-backup-recovery-authority-membership-refused");
  const recoveryHistory = flatBackupRecoveryHistory(root, locator.installationId, locator.generation, recoveryReceipt);
  const census = () => coupledBackupCensus(workspace, stateRoot, stateRoot, true, locator.installationId, recoveryReceipt, recoveryHistory.excluded);
  const source = census(), currentSource = coupledSourceRecord(locator.installationId, stateRoot, inspection, census);
  if (names.length !== 0) {
    if (!names.includes("source.json") || !file(join(root, "source.json")).bytes.equals(currentSource)) throw new Error("flat-backup-recovery-source-changed");
    const record = SourceRecordSchema.parse(JSON.parse(currentSource.toString("utf8")));
    const currentBackups = backups.filter(backup => backup.manifest.authorityContentFingerprint === record.sourceFingerprint && backup.manifest.authorityGeneration === record.sourceGeneration);
    if (currentBackups.length === 0) throw new Error("flat-backup-recovery-authority-required");
    const expected = record.files.map(entry => ({ path: entry.path, digest: entry.digest }));
    const copies = names.includes("files") ? inventory(join(root, "files"), "") : [];
    const prefix = expected.slice(0, copies.length);
    if (copies.some(copy => !prefix.some(entry => entry.path === copy.file.path && entry.digest === copy.file.digest))) throw new Error("flat-backup-recovery-copy-refused");
    const directories = new Set([""]);
    for (const entry of expected.slice(0, copies.length + 1)) for (let path = dirname(entry.path); path !== "."; path = dirname(path)) directories.add(path);
    if (names.includes("files") && unpublishedDraftAbortMembership(join(root, "files")).some(entry => entry.directory && !directories.has(entry.path))) throw new Error("flat-backup-recovery-copy-membership-refused");
    if (names.includes("backup.json")) {
      const receipt = StorageBackupSchema.parse(JSON.parse(file(join(root, "backup.json")).bytes.toString("utf8")));
      if (receipt.installationId !== locator.installationId || receipt.sourceStateRoot !== stateRoot || receipt.sourceDigest !== hash(currentSource)
        || canonicalJsonStringify(receipt.files) !== canonicalJsonStringify(source.map(entry => entry.file))
        || !currentBackups.some(backup => backup.manifestPath === receipt.authorityManifest && hash(file(backup.manifestPath).bytes) === receipt.authorityDigest)) throw new Error("flat-backup-recovery-receipt-refused");
      verifyCopies(root, receipt.files);
    }
  }
  const roots = [workspace, control, stateRoot, artifactRoot, allocations].map(path => {
    const value = lstatSync(path); return { path, device: value.dev, inode: value.ino, mode: value.mode, owner: value.uid };
  });
  assertRuntimeRestoreAdmission(restore, processLockRoot);
  const allocation = lstatSync(root);
  return { binding: FlatBackupRecoveryBindingSchema.parse({ kind: names.length === 0 ? "empty-allocation" : "source-record",
    allocationDevice: allocation.dev, allocationInode: allocation.ino, sourceDigest: hash(currentSource) }),
    observation: canonicalJsonStringify({ roots, source: currentSource.toString("base64"), allocation: unpublishedDraftAbortMembership(root),
      recoveryHistory: recoveryHistory.observation, files: inventory(root, ""), membership: membership.identities.filter(entry => entry.path !== processLockRoot),
      inspection: { ...inspection, installationId: inspection.installationId ?? null, profileId: inspection.profileId ?? null } }) };
}

function assertCoupledArtifacts(artifactRoot: string, references: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>["artifactReferences"]) {
  for (const reference of references) {
    const stored = decodeStoredArtifact(JSON.parse(file(join(artifactRoot, `${reference.sha256}.artifact`), existingDataFileLabel(`profile/artifacts/${reference.sha256}.artifact`)).bytes.toString("utf8")), reference.sha256);
    if (canonicalJsonStringify(stored.ref) !== canonicalJsonStringify(reference)) throw new Error("existing-data-artifact-reference-mismatch");
  }
}

function flatBackupRecoveryHistory(root: string, installationId: string, generation: number, pendingId?: string) {
  const sourcePath = join(root, "source.json"), excluded: string[] = [], observed: unknown[] = [];
  if (lstatSync(sourcePath, { throwIfNoEntry: false }) === undefined) return { excluded, observation: canonicalJsonStringify(observed) };
  const sourceBytes = file(sourcePath).bytes, source = SourceRecordSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  if (source.installationId !== installationId) throw new Error("flat-backup-recovery-history-binding-refused");
  const allocation = lstatSync(root), history = join(dirname(dirname(root)), "admission-mutex-recovery");
  if (lstatSync(history, { throwIfNoEntry: false }) === undefined) return { excluded, observation: canonicalJsonStringify(observed) };
  noSymlinkAncestry(history, new Map()); statDirectory(history, "mutex recovery", 0o700);
  const prefix = "control/admission-mutex-recovery/", baseline = new Set(source.files.filter(entry => entry.path.startsWith(prefix)).map(entry => entry.path.slice(prefix.length).split("/")[0]));
  const allowed = new Set([...baseline, ...(pendingId === undefined ? [] : [pendingId, `${pendingId}.json`])]);
  for (const name of readdirSync(history).sort()) {
    if (baseline.has(name) || name === `${pendingId}.json` || !name.endsWith(".json")) continue;
    const path = join(history, name), raw = file(path), receipt = MutexRecoveryReceiptSchema.parse(JSON.parse(raw.bytes.toString("utf8")));
    const binding = receipt.flatBackup;
    if (name !== `${receipt.acquisitionId}.json` || receipt.installationId !== installationId || receipt.generation !== generation || binding === undefined
      || binding.kind !== "source-record" || binding.sourceDigest !== hash(sourceBytes)
      || binding.allocationDevice !== allocation.dev || binding.allocationInode !== allocation.ino) throw new Error("flat-backup-recovery-history-binding-refused");
    const archive = join(history, receipt.acquisitionId); statDirectory(archive, "mutex archive", 0o700);
    if ("pid" in receipt) {
      if (canonicalJsonStringify(readdirSync(archive)) !== canonicalJsonStringify([receipt.ownerFile])) throw new Error("flat-backup-recovery-history-membership-refused");
      const ownerFile = file(join(archive, receipt.ownerFile)), owner = MutexOwnerSchema.parse(JSON.parse(ownerFile.bytes.toString("utf8")));
      if (owner.acquisitionId !== receipt.acquisitionId || owner.pid !== receipt.pid
        || canonicalJsonStringify(owner.processIdentity) !== canonicalJsonStringify(receipt.processIdentity) || hash(ownerFile.bytes) !== receipt.ownerSha256) throw new Error("flat-backup-recovery-history-owner-refused");
    } else {
      const directory = lstatSync(archive);
      if (readdirSync(archive).length !== 0 || directory.dev !== receipt.directoryDevice || directory.ino !== receipt.directoryInode) throw new Error("flat-backup-recovery-history-owner-refused");
    }
    allowed.add(name); allowed.add(receipt.acquisitionId);
    excluded.push(`admission-mutex-recovery/${name}`, `admission-mutex-recovery/${receipt.acquisitionId}`);
    observed.push({ receipt: { ...raw.identity, digest: hash(raw.bytes) }, archive: unpublishedDraftAbortMembership(archive), files: inventory(archive, "") });
  }
  if (readdirSync(history).some(name => !allowed.has(name))) throw new Error("flat-backup-recovery-history-membership-refused");
  return { excluded, observation: canonicalJsonStringify(observed) };
}
