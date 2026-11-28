import { fileStatus } from "../file-identity.js";
import { assertMaintenanceCustodyAvailable } from "./custody-availability.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { inventoryFileIdentity } from "./profile-inventory.js";
import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Clock } from "../../../rules/time/clock.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { noSymlinkAncestry, readPrivateFile, removeExactPath } from "../configuration/credential-safe-file.js";
import { fsyncPath, privatePathRejects } from "../private-path.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { LOG_DATABASE_NAMES } from "../events/log-mutations.js";
import { backupLogPaths, parseBackupManifestFile, verifyBackupBytesAtPath, verifyBackupLogFile, verifyBackupLogFiles, type VerifiedBackup } from "../sqlite/backup-service.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";

const ShutdownManifest = /^authority-g\d+-\d+-[0-9a-f-]{36}\.shutdown\.sqlite\.manifest\.json$/u;
const Retiring = ".retiring";

function retirementPaths(root: string): string[] {
  const directory = join(root, "backups", "authority");
  noSymlinkAncestry(directory, new Map());
  const metadata = fileStatus(directory, true);
  if (metadata === undefined) return [];
  if (!metadata.isDirectory() || privatePathRejects(directory, metadata, "group-write")) throw new Error("shutdown-backup-directory-unsafe");
  return readdirSync(directory).filter(name => name.endsWith(Retiring)).map(name => {
    if (!ShutdownManifest.test(name.slice(0, -Retiring.length))) throw new Error("shutdown-backup-retirement-unowned");
    return join(directory, name);
  }).sort();
}

export function hasPendingShutdownBackupRetirement(root: string): boolean { return retirementPaths(root).length !== 0; }

function assertFilesUnchanged(files: readonly ReturnType<typeof inventoryFileIdentity>[]) {
  if (files.some(file => canonicalJsonStringify(file) !== canonicalJsonStringify(inventoryFileIdentity(file.path)))) throw new Error("shutdown-backup-retirement-changed");
}

type CheckedShutdownBackup = VerifiedBackup & { files: ReturnType<typeof inventoryFileIdentity>[] };

// Bytes that match the manifest written after their one full inspection are the bytes that passed it; repair inspects again before use.
async function checkedShutdownBackup(admission: RuntimeAdmission, manifestPath: string): Promise<VerifiedBackup> {
  const manifest = parseBackupManifestFile(manifestPath), binding = admission.profileBinding;
  if (manifest.installationId !== binding.installationId || manifest.profileId !== binding.profileId
    || manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource())) throw new Error("shutdown-backup-retention-foreign");
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  await verifyBackupLogFiles(backupPath, manifest);
  return { manifestPath, backupPath, manifest };
}

// `known` holds backups already checked in this same quit; an unchanged file identity lets them stand without another read.
async function shutdownBackups(admission: RuntimeAdmission, clock: Clock, known: readonly CheckedShutdownBackup[] = []) {
  const directory = join(admission.stateRoot, "backups", "authority");
  const checked: CheckedShutdownBackup[] = [];
  for (const name of readdirSync(directory).filter(name => ShutdownManifest.test(name))) {
    const manifestPath = join(directory, name), backupPath = join(directory, name.slice(0, -".manifest.json".length));
    const logFiles = parseBackupManifestFile(manifestPath).logFiles;
    const files = [manifestPath, backupPath, ...(logFiles === undefined ? [] : backupLogPaths(backupPath))].map(inventoryFileIdentity);
    const prior = known.find(value => value.manifestPath === join(directory, name) && canonicalJsonStringify(value.files) === canonicalJsonStringify(files));
    const proof = prior ?? await checkedShutdownBackup(admission, join(directory, name));
    assertFilesUnchanged(files);
    if (name !== `${proof.manifest.backupFileName}.manifest.json` || Date.parse(proof.manifest.createdAt) > clock.nowMs()) throw new Error("shutdown-backup-retention-invalid");
    checked.push({ ...proof, files });
  }
  return checked.sort((left, right) => newerFirst(left.manifest, right.manifest));
}

type BackupOrder = Pick<CheckedShutdownBackup["manifest"], "createdAt" | "authorityGeneration" | "backupFileName">;
/** Negative when `left` is the newer backup; a frozen clock gives backups one creation time, so the generation decides. */
function newerFirst(left: BackupOrder, right: BackupOrder): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.authorityGeneration - left.authorityGeneration
    || right.backupFileName.localeCompare(left.backupFileName);
}

export async function resumeShutdownBackupRetirement(input: RuntimeAdmission, clock: Clock, known: readonly CheckedShutdownBackup[] = []): Promise<void> {
  const admission = requireRuntimeAdmission(input), directory = join(admission.stateRoot, "backups", "authority");
  admission.assertAuthorityBackupWrite(directory);
  const pending = retirementPaths(admission.stateRoot);
  if (pending.length !== 0) assertMaintenanceCustodyAvailable("backup-retirement");
  for (const path of pending) {
    const current = await shutdownBackups(admission, clock, known);
    const file = readPrivateFile(path, { label: "lock", maxBytes: 64_000 });
    if (file === undefined) throw new Error("shutdown-backup-retirement-missing");
    const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
    const binding = admission.profileBinding;
    if (basename(path) !== `${manifest.backupFileName}.manifest.json${Retiring}` || manifest.installationId !== binding.installationId
      || manifest.profileId !== binding.profileId || manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource())
      || current.filter(value => newerFirst(value.manifest, manifest) < 0).length < 3) throw new Error("shutdown-backup-retirement-unproved");
    const backupPath = join(directory, manifest.backupFileName);
    if (manifest.logFiles !== undefined) {
      for (const name of LOG_DATABASE_NAMES) {
        const companion = `${backupPath}.${name}.db`;
        if (!existsSync(companion)) continue;
        const before = inventoryFileIdentity(companion);
        await verifyBackupLogFile(companion, manifest.logFiles[name]);
        assertFilesUnchanged([before]);
        admission.assertAuthorityBackupWrite(directory);
        removeExactPath(companion, { device: before.device, inode: before.inode }, false, "shutdown-backup-retirement-changed");
        fsyncPath(directory);
      }
    }
    if (existsSync(backupPath)) {
      const before = inventoryFileIdentity(backupPath);
      if (before.directory) throw new Error("shutdown-backup-retirement-unsafe");
      const listed = known.find(value => value.backupPath === backupPath && canonicalJsonStringify(value.manifest) === canonicalJsonStringify(manifest));
      if (listed === undefined || canonicalJsonStringify(listed.files[1]) !== canonicalJsonStringify(before)) await verifyBackupBytesAtPath(backupPath, manifest);
      const observed = readPrivateFile(path, { label: "lock", maxBytes: 64_000 });
      if (observed === undefined || !observed.bytes.equals(file.bytes)
        || observed.identity.device !== file.identity.device || observed.identity.inode !== file.identity.inode) throw new Error("shutdown-backup-retirement-changed");
      assertFilesUnchanged([before]);
      for (const value of current) assertFilesUnchanged(value.files);
      admission.assertAuthorityBackupWrite(directory);
      removeExactPath(backupPath, { device: before.device, inode: before.inode }, false, "shutdown-backup-retirement-changed");
      fsyncPath(directory);
    }
    const after = readPrivateFile(path, { label: "lock", maxBytes: 64_000 });
    if (after === undefined || !after.bytes.equals(file.bytes)) throw new Error("shutdown-backup-retirement-changed");
    for (const value of current) assertFilesUnchanged(value.files);
    admission.assertAuthorityBackupWrite(directory);
    removeExactPath(path, file.identity, false, "shutdown-backup-retirement-changed"); fsyncPath(directory);
  }
}

/** `fresh` is the backup this same quit created and verified; nothing older is removed without it. */
export async function retainCleanShutdownBackups(input: RuntimeAdmission, clock: Clock, fresh: VerifiedBackup): Promise<void> {
  const admission = requireRuntimeAdmission(input), directory = join(admission.stateRoot, "backups", "authority");
  admission.assertAuthorityBackupWrite(directory);
  await resumeShutdownBackupRetirement(admission, clock);
  assertMaintenanceCustodyAvailable("backup-retirement");
  // The fresh backup is byte-checked again here: its files may have changed since the backup request verified them.
  const checked = await shutdownBackups(admission, clock);
  if (checked[0]?.manifestPath !== fresh.manifestPath || canonicalJsonStringify(checked[0].manifest) !== canonicalJsonStringify(fresh.manifest)) throw new Error("shutdown-backup-retention-unproved");
  for (const previous of checked.slice(3)) {
    const target = `${previous.manifestPath}${Retiring}`;
    if (existsSync(target)) throw new Error("shutdown-backup-retirement-busy");
    assertFilesUnchanged(previous.files);
    admission.assertAuthorityBackupWrite(directory);
    renameSync(previous.manifestPath, target); fsyncPath(directory);
    await resumeShutdownBackupRetirement(admission, clock, checked);
  }
}
