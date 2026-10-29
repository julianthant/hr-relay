import type { ProfileBrowserClosure } from "./profile-inventory.js";
import { SourceRecordSchema, StorageBackupSchema, hash, file, inventory, verifyCopies, retainedStorageBackup, existingDataFileLabel } from "./existing-data-backup-files.js";
import { decodeStoredArtifact } from "../artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { profileAuthorityFileWitnesses } from "../configuration/credential-store.js";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { writePrivateStage, fsyncPath, noSymlinkAncestry, statDirectory } from "../configuration/credential-safe-file.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";

async function inspectCoupledBackupSource(browserClosure: ProfileBrowserClosure, admission: RuntimeAdmission, flat: boolean, clock: Clock) {
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
    const membership = enumerateProfileCredentialMembership(admission, sourceFacts, settings?.paths?.browserProfileRoot ?? join(admission.stateRoot, "browsers"), browserClosure);
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

async function writeCoupledBackup(browserClosure: ProfileBrowserClosure, machine: RuntimeAdmission, admission: RuntimeAdmission, root: string, flat: boolean, clock: Clock) {
  const { AuthorityDatabase } = await import("../sqlite/authority-database.js");
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const { verifyStoppedBackupManifestAtPath } = await import("../sqlite/backup-service.js");
  const { profileAuthorityFileWitnesses } = await import("../configuration/credential-store.js");
  const { assertCredentialCopyResourcesClosed } = await import("./profile-inventory.js");
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const { current, processLockRoot } = await inspectCoupledBackupSource(browserClosure, admission, flat, clock);
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
  const census = () => {
    return coupledBackupCensus(context.workspace, admission.stateRoot, machine.stateRoot, flat,
      root === storageRoot || storageBackup !== undefined ? machine.locator.installationId : undefined);
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
    const backed = await backupStoppedAuthority(browserClosure, admission, admission.stateRoot, clock, processLockRoot, machine.maintenanceOperation());
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

export async function backupFlatStorage(browserClosure: ProfileBrowserClosure, admission: RuntimeAdmission, clock: Clock) {
  if (!admission.isFlatBackup()) throw new Error("flat-backup-authority-required");
  await inspectCoupledBackupSource(browserClosure, admission, true, clock);
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const root = join(context.workspace, ".tracker", "control", "storage-backups", admission.locator.installationId);
  mkdirSync(root, { recursive: true, mode: 0o700 }); noSymlinkAncestry(root, new Map());
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (readdirSync(dirname(root)).some(name => name !== admission.locator.installationId)
    || readdirSync(root).some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("storage-backup-membership-refused");
  if (lstatSync(join(root, "backup.json"), { throwIfNoEntry: false }) !== undefined) retainedStorageBackup(context.workspace, admission.locator.installationId);
  const coupled = await writeCoupledBackup(browserClosure, admission, admission, root, true, clock);
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
  storageInstallationId?: string) {
  return [
    ...inventory(profileRoot, "profile", new Set(["state.db", "state.db-wal", "state.db-shm", "state.db-journal", ...(flat ? ["locks"] : [])])),
    ...(flat ? [] : inventory(join(machineRoot, "machine"), "machine")),
    ...(flat && lstatSync(join(workspace, "data"), { throwIfNoEntry: false }) !== undefined ? inventory(join(workspace, "data"), "workspace-data") : []),
    ...inventory(join(workspace, ".tracker", "control"), "control", new Set(storageInstallationId === undefined ? [] : [`storage-backups/${storageInstallationId}`])),
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

function assertCoupledArtifacts(artifactRoot: string, references: ReturnType<typeof AuthorityDatabase.readProfileMaintenanceInventory>["artifactReferences"]) {
  for (const reference of references) {
    const stored = decodeStoredArtifact(JSON.parse(file(join(artifactRoot, `${reference.sha256}.artifact`), existingDataFileLabel(`profile/artifacts/${reference.sha256}.artifact`)).bytes.toString("utf8")), reference.sha256);
    if (canonicalJsonStringify(stored.ref) !== canonicalJsonStringify(reference)) throw new Error("existing-data-artifact-reference-mismatch");
  }
}
