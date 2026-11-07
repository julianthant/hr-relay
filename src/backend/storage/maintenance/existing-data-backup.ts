import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateStage, fsyncPath } from "../private-path.js";
import { assertStoppedBackupClosure, type StoppedBackupClosure } from "./profile-inventory.js";
import { SourceRecordSchema, StorageBackupSchema, StorageBackupSourceChangedError, captureFlatArchiveSource,
  flatArchiveFiles, writeFlatArchiveCopies, hash, file, retainedStorageBackup } from "./existing-data-backup-files.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { noSymlinkAncestry, statDirectory, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { UnboundPredecessorBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import type { Clock } from "../../../rules/time/clock.js";

export async function backupFlatStorage(closure: StoppedBackupClosure, admission: RuntimeAdmission, _clock: Clock) {
  if (!admission.isFlatBackup()) throw new Error("flat-backup-authority-required");
  const revalidateClosure = () => { assertStoppedBackupClosure(closure, admission, admission.maintenanceOperation()); };
  revalidateClosure();
  const context = admission.readInstallationContext();
  if (context === undefined) throw new Error("existing-data-backup-installation-required");
  const installationId = admission.locator.installationId;
  const root = join(context.workspace, ".tracker", "control", "storage-backups", installationId);
  const ancestors = new Map<string, DirectoryIdentity>();
  noSymlinkAncestry(root, ancestors);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  statDirectory(dirname(root), "storage backups", 0o700); statDirectory(root, "storage backup", 0o700);
  if (readdirSync(dirname(root)).some(name => name !== installationId)
    || readdirSync(root).some(name => !["source.json", "files", "backup.json"].includes(name))) throw new Error("storage-backup-membership-refused");
  const sourcePath = join(root, "source.json"), backupPath = join(root, "backup.json");
  const prior = lstatSync(sourcePath, { throwIfNoEntry: false }) === undefined ? undefined
    : SourceRecordSchema.parse(JSON.parse(file(sourcePath).bytes.toString("utf8")));
  if (prior === undefined && readdirSync(root).length !== 0) throw new Error("existing-data-backup-source-required");
  const source = captureFlatArchiveSource({ workspace: context.workspace, stateRoot: admission.stateRoot,
    installationId, operationId: prior?.operationId ?? randomUUID() });
  const authorityFiles = source.document.members.filter(member => member.kind === "file" && member.path.startsWith("profile/backups/authority/"));
  for (const entry of authorityFiles) {
    const databasePath = entry.path.endsWith(".manifest.json") ? entry.path.slice(0, -".manifest.json".length) : entry.path;
    if (!authorityFiles.some(member => member.path === databasePath) || !authorityFiles.some(member => member.path === `${databasePath}.manifest.json`)) throw new Error("flat-archive-authority-pair-required");
    if (entry.path !== databasePath) continue;
    const physicalPath = join(admission.stateRoot, databasePath.slice("profile/".length));
    const manifest = UnboundPredecessorBackupManifestSchema.parse(JSON.parse(file(`${physicalPath}.manifest.json`).bytes.toString("utf8")));
    const bytes = file(physicalPath, "authority database").bytes;
    if (manifest.schemaVersion !== 6 || manifest.backupFileName !== databasePath.split("/").at(-1)
      || manifest.sha256 !== hash(bytes) || manifest.byteSize !== bytes.byteLength) throw new Error("flat-archive-authority-pair-refused");
    AuthorityDatabase.readFlatArchiveInventory(physicalPath, admission.maintenanceOperation());
  }
  const sourceBytes = Buffer.from(canonicalJsonStringify(source.document));
  if (prior !== undefined && !file(sourcePath).bytes.equals(sourceBytes)) throw new StorageBackupSourceChangedError();
  if (lstatSync(backupPath, { throwIfNoEntry: false }) !== undefined) retainedStorageBackup(context.workspace, installationId);
  source.assertCurrent(); revalidateClosure();
  if (prior === undefined) { writePrivateStage(sourcePath, sourceBytes); fsyncPath(root); }
  const assertCurrent = () => {
    noSymlinkAncestry(root, ancestors);
    source.assertCurrent(); admission.assertLive();
    if (!file(sourcePath).bytes.equals(sourceBytes)) throw new StorageBackupSourceChangedError();
  };
  writeFlatArchiveCopies(root, source.document, assertCurrent);
  assertCurrent(); revalidateClosure(); assertCurrent();
  const files = flatArchiveFiles(source.document);
  const record = StorageBackupSchema.parse({ schemaVersion: 2, kind: "flat-native6-archive", installationId,
    operationId: source.document.operationId, sourceStateRoot: admission.stateRoot, sourceDigest: hash(sourceBytes), files });
  const bytes = Buffer.from(canonicalJsonStringify(record));
  if (lstatSync(backupPath, { throwIfNoEntry: false }) === undefined) {
    writePrivateStage(backupPath, bytes); fsyncPath(root); fsyncPath(dirname(root));
  } else if (!file(backupPath).bytes.equals(bytes)) throw new Error("storage-backup-changed");
  retainedStorageBackup(context.workspace, installationId);
  assertCurrent(); revalidateClosure(); assertCurrent();
  return { kind: "flat-archive" as const, archive: { backupPath, backupDigest: hash(bytes), operationId: source.document.operationId,
    fileCount: files.length, byteSize: files.reduce((sum, entry) => sum + entry.size, 0) } };
}
