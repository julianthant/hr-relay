import { assertMaintenanceCustodyAvailable } from "./custody-availability.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { inventoryFileIdentity } from "./profile-inventory.js";
import { existsSync, lstatSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { Clock } from "../../../rules/time/clock.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { noSymlinkAncestry, readPrivateFile, removeExactPath } from "../configuration/credential-safe-file.js";
import { fsyncPath, privatePathRejects } from "../private-path.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";

const ShutdownManifest = /^authority-g\d+-\d+-[0-9a-f-]{36}\.shutdown\.sqlite\.manifest\.json$/u;
const Retiring = ".retiring";

function retirementPaths(root: string): string[] {
  const directory = join(root, "backups", "authority");
  noSymlinkAncestry(directory, new Map());
  const metadata = lstatSync(directory, { throwIfNoEntry: false });
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

async function verifiedShutdownBackups(admission: RuntimeAdmission, clock: Clock) {
  const directory = join(admission.stateRoot, "backups", "authority");
  const verified = [];
  for (const name of readdirSync(directory).filter(name => ShutdownManifest.test(name))) {
    const files = [join(directory, name), join(directory, name.slice(0, -".manifest.json".length))].map(inventoryFileIdentity);
    const proof = await verifyBackupManifestAtPath(admission, join(directory, name));
    assertFilesUnchanged(files);
    if (name !== `${proof.manifest.backupFileName}.manifest.json` || Date.parse(proof.manifest.createdAt) > clock.nowMs()) throw new Error("shutdown-backup-retention-invalid");
    verified.push({ ...proof, files });
  }
  return verified.sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt)
    || right.manifest.backupFileName.localeCompare(left.manifest.backupFileName));
}

export async function resumeShutdownBackupRetirement(input: RuntimeAdmission, clock: Clock): Promise<void> {
  const admission = requireRuntimeAdmission(input), directory = join(admission.stateRoot, "backups", "authority");
  admission.assertAuthorityBackupWrite(directory);
  const pending = retirementPaths(admission.stateRoot);
  if (pending.length !== 0) assertMaintenanceCustodyAvailable("backup-retirement");
  for (const path of pending) {
    const current = await verifiedShutdownBackups(admission, clock);
    const file = readPrivateFile(path, { label: "lock", maxBytes: 64_000 });
    if (file === undefined) throw new Error("shutdown-backup-retirement-missing");
    const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
    const binding = admission.profileBinding;
    if (basename(path) !== `${manifest.backupFileName}.manifest.json${Retiring}` || manifest.installationId !== binding.installationId
      || manifest.profileId !== binding.profileId || manifest.sourceDatabaseIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource())
      || current.filter(value => Date.parse(value.manifest.createdAt) > Date.parse(manifest.createdAt)
        || value.manifest.createdAt === manifest.createdAt && value.manifest.backupFileName.localeCompare(manifest.backupFileName) > 0).length < 3) throw new Error("shutdown-backup-retirement-unproved");
    const backupPath = join(directory, manifest.backupFileName);
    if (existsSync(backupPath)) {
      const before = inventoryFileIdentity(backupPath);
      if (before.directory) throw new Error("shutdown-backup-retirement-unsafe");
      const verified = await verifyBackupManifestAtPath(admission, path);
      const observed = readPrivateFile(path, { label: "lock", maxBytes: 64_000 });
      if (verified.backupPath !== backupPath || canonicalJsonStringify(verified.manifest) !== canonicalJsonStringify(manifest)
        || observed === undefined || !observed.bytes.equals(file.bytes)
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

export async function retainCleanShutdownBackups(input: RuntimeAdmission, clock: Clock): Promise<void> {
  const admission = requireRuntimeAdmission(input), directory = join(admission.stateRoot, "backups", "authority");
  admission.assertAuthorityBackupWrite(directory);
  await resumeShutdownBackupRetirement(admission, clock);
  assertMaintenanceCustodyAvailable("backup-retirement");
  const verified = await verifiedShutdownBackups(admission, clock);
  for (const previous of verified.slice(3)) {
    const target = `${previous.manifestPath}${Retiring}`;
    if (existsSync(target)) throw new Error("shutdown-backup-retirement-busy");
    await verifyBackupManifestAtPath(admission, previous.manifestPath);
    admission.assertAuthorityBackupWrite(directory);
    renameSync(previous.manifestPath, target); fsyncPath(directory);
    await resumeShutdownBackupRetirement(admission, clock);
  }
}
