import { descriptorStatus, fileStatus, privateFileNumber, sameDirectory, type DirectoryIdentity } from "../file-identity.js";
import { assertMaintenanceCustodyAvailable } from "../maintenance/custody-availability.js";
import type { ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { AuthorityDatabase } from "./authority-database.js";
import { authoritySourceDatabaseIdentity, type AuthorityBackupExpectedSource } from "./database-identity.js";
import { privatePathRejects } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, constants, readSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { noSymlinkAncestry, readPrivateFile, removeExactPath, statDirectory } from "../configuration/credential-safe-file.js";
import { createReadonlyAuthoritySnapshot, withAuthorityDatabaseReadOnly, withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { AuthorityUpgradeRecordSchema, type AuthorityUpgradeRecord } from "../../../models/config/authority.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { type Clock, systemClock } from "../../../rules/time/clock.js";
import { inspectOpenDatabase, inspectVerifiedBackupCopyReadOnly, type AuthorityBackupSourceReadOnly, type BackupCopyInspection } from "./backup-inspection.js";
import { backupThreadIdle, buildBackupLogsOffThread, inspectAuthorityBackupOffThread } from "./backup-inspection-worker.js";
import { LOG_DATABASE_NAMES, PROFILE_LOG_FILES } from "../events/log-mutations.js";
import { isCurrentAuthoritySchemaVersion } from "./migrations.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import {
  StoppedAuthorityBackupManifestSchema,
  AuthorityBackupManifestSchema,
  UnboundPredecessorBackupManifestSchema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  type AuthorityBackupManifest,
  type StoppedAuthorityBackupManifest,
  type AuthorityBackupRunReport,
} from "./recovery-contracts.js";

export const AuthorityBackupServiceOptionsSchema = z.strictObject({
  directory: z.string().min(1),
  purpose: z.enum(["clean-shutdown", "in-session"]).optional(),
});

export type AuthorityBackupSource = Pick<
  AuthorityBackupSourceReadOnly,
  "getMeta" | "getSourceDatabaseIdentity" | "onlineBackupTo"
>;

// Read-only WAL connections can create SQLite companions and cannot remove them on close.
function removeReadOnlyInspectionCompanions(backupPath: string): void {
  const walPath = `${backupPath}-wal`;
  if (existsSync(walPath)) {
    const size = statSync(walPath).size;
    if (size !== 0) {
      throw new Error(
        `backup copy ${basename(backupPath)} has a ${String(size)}-byte WAL after read-only inspection; `
        + "the copy is not self-contained",
      );
    }
    rmSync(walPath);
  }
  const shmPath = `${backupPath}-shm`;
  if (existsSync(shmPath)) rmSync(shmPath);
}

export type VerifiedBackup = Readonly<{
  manifestPath: string;
  backupPath: string;
  manifest: StoppedAuthorityBackupManifest;
}>;

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  let primary: { error: unknown } | undefined;
  let descriptorIdentity: ReturnType<typeof descriptorStatus> | undefined;
  try { descriptorIdentity = descriptorStatus(descriptor); fsyncSync(descriptor); }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export async function verifyBackupBytesAtPath(
  pathInput: string,
  manifest: Readonly<{ backupFileName: string; byteSize: number; sha256: string }>,
  description = `backup file ${manifest.backupFileName}`,
): Promise<void> {
  const path = resolve(pathInput);
  if (!existsSync(path)) throw new Error(`${description} does not exist`);
  const stats = statSync(path);
  if (!stats.isFile() || stats.size !== manifest.byteSize) {
    throw new Error(`${description} byte size does not match verified manifest`);
  }
  const digest = await sha256File(path);
  if (digest !== manifest.sha256) {
    throw new Error(`${description} checksum does not match verified manifest`);
  }
}

export const backupLogPaths = (backupPath: string) => LOG_DATABASE_NAMES.map(name => `${backupPath}.${name}.db`);
export function verifiedBackupLogs({ backupPath, manifest }: VerifiedBackup) {
  const files = manifest.manifestVersion === 4 ? manifest.logFiles : undefined;
  return files === undefined ? [] : LOG_DATABASE_NAMES.map(name => ({
    path: `${backupPath}.${name}.db`,
    digest: files[name],
    table: name === "timeline" ? "timeline_events" as const : "debug_events" as const,
  }));
}
export const verifiedBackupFiles = (backup: VerifiedBackup) => [backup.backupPath, ...verifiedBackupLogs(backup).map(log => log.path)];

const sqliteCompanions = ["-wal", "-shm", "-journal"] as const;

export async function backupLogFileMatches(path: string, expected: Readonly<{ byteSize: number; sha256: string }>): Promise<boolean> {
  const metadata = fileStatus(path, true);
  if (metadata === undefined || !metadata.isFile() || BigInt(metadata.nlink) !== 1n
    || privatePathRejects(path, metadata, "owner") || BigInt(metadata.size) !== BigInt(expected.byteSize)
    || sqliteCompanions.some(suffix => fileStatus(path + suffix, true) !== undefined)) return false;
  let digest: string | undefined;
  try { digest = await sha256File(path); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return digest === expected.sha256;
}

export async function verifyBackupLogFile(path: string, expected: Readonly<{ byteSize: number; sha256: string }>): Promise<void> {
  if (!await backupLogFileMatches(path, expected)) throw new Error("backup-log-file-unverified");
}

export async function verifyBackupLogFiles(backupPath: string, manifest: Pick<AuthorityBackupManifest, "logFiles">): Promise<void> {
  if (manifest.logFiles === undefined) return;
  for (const name of LOG_DATABASE_NAMES) {
    await verifyBackupLogFile(`${backupPath}.${name}.db`, manifest.logFiles[name]);
  }
}

function parseCurrentBackupManifest(value: unknown): AuthorityBackupManifest {
  const manifest = StoppedAuthorityBackupManifestSchema.parse(value);
  if (manifest.manifestVersion !== 4) throw new Error("backup-profile-binding-required");
  return manifest;
}

export function parseBackupManifestFile(manifestPath: string): AuthorityBackupManifest {
  return parseCurrentBackupManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
}

export function verifyBackupManifestAtPath(admissionInput: RuntimeAdmission, manifestPathInput: string): Promise<VerifiedBackup> {
  return verifyManifest(admissionInput, manifestPathInput);
}

/** Verifies the bytes asynchronously and runs the SQLite inspection on a worker thread. */
export function verifyBackupManifestOffThread(admissionInput: RuntimeAdmission, manifestPathInput: string,
  options: Readonly<{ signal?: AbortSignal }>): Promise<VerifiedBackup> {
  return verifyManifest(admissionInput, manifestPathInput, options);
}

/**
 * Reads another person's backup, checked against `source` with the same identity and inspection checks as verifyBackupManifestAtPath.
 * The verified copy admission holds the backup file; the manifest digest is proved on the private snapshot that the inspection and
 * `read` use. Nothing next to the backup is written or removed.
 */
export function readVerifiedBackupManifestAtPath<T>(admissionInput: RuntimeAdmission, manifestPathInput: string,
  source: Extract<AuthorityBackupExpectedSource, { kind: "profile" }>, read: (database: Parameters<typeof inspectOpenDatabase>[0]) => T): VerifiedBackup & Readonly<{ value: T }> {
  const admission = requireRuntimeAdmission(admissionInput);
  const manifestPath = resolve(z.string().min(1).parse(manifestPathInput));
  if (!existsSync(manifestPath)) throw new Error(`backup manifest ${manifestPath} does not exist`);
  const manifest = parseBackupManifestFile(manifestPath);
  if (manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(source)) {
    throw new Error(`backup manifest ${basename(manifestPath)} belongs to a different authority database`);
  }
  assertExpectedBackupSource(source, manifest);
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  assertBackupLogFiles(backupPath, manifest);
  const copy = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
  try {
    const { inspection, value } = withAuthorityDatabaseReadOnly(copy, backupPath, database => {
      const image = database.location();
      if (image === null || resolve(image) === backupPath) throw new Error("authority-backup-snapshot-required");
      assertSnapshotBytes(image, manifest);
      const inspected = inspectOpenDatabase(database, manifest.schemaVersion);
      assertBackupInspection(manifest, inspected, source);
      const result = read(database);
      assertSnapshotBytes(image, manifest);
      return { inspection: inspected, value: result };
    });
    copy.assertLive();
    assertBackupInspection(manifest, inspection, source);
    return Object.freeze({ manifestPath, backupPath, manifest, value });
  } finally { copy.release(); }
}

/** The private snapshot holds exactly the manifest's bytes, with nothing pending in a write-ahead log beside it. */
function assertSnapshotBytes(path: string, manifest: Readonly<{ byteSize: number; sha256: string }>): void {
  const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
  if (wal !== undefined && wal.size !== 0) throw new Error("authority-backup-snapshot-wal-not-empty");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
  let count = 0;
  try {
    for (let size = readSync(descriptor, chunk, 0, chunk.length, null); size > 0; size = readSync(descriptor, chunk, 0, chunk.length, null)) {
      count += size; hash.update(chunk.subarray(0, size));
    }
  } finally { closeSync(descriptor); }
  if (count !== manifest.byteSize || hash.digest("hex") !== manifest.sha256) throw new Error("authority-backup-snapshot-digest-mismatch");
}

function assertBackupLogFiles(backupPath: string, manifest: Pick<AuthorityBackupManifest, "logFiles">): void {
  if (manifest.logFiles === undefined) return;
  for (const name of LOG_DATABASE_NAMES) {
    const path = `${backupPath}.${name}.db`, metadata = fileStatus(path);
    if (!metadata.isFile() || BigInt(metadata.nlink) !== 1n || privatePathRejects(path, metadata, "owner")
      || ["-wal", "-shm", "-journal"].some(suffix => existsSync(path + suffix))) throw new Error("backup-log-file-unsafe");
    assertSnapshotBytes(path, manifest.logFiles[name]);
  }
}

async function verifyManifest(
  admissionInput: RuntimeAdmission,
  manifestPathInput: string,
  offThread?: Readonly<{ signal?: AbortSignal }>,
): Promise<VerifiedBackup> {
  const admission = requireRuntimeAdmission(admissionInput);
  const manifestPath = resolve(z.string().min(1).parse(manifestPathInput));
  if (!existsSync(manifestPath)) throw new Error(`backup manifest ${manifestPath} does not exist`);
  const expected = admission.authorityBackupExpectedSource();
  if (expected.kind !== "profile") throw new Error("profile-backup-binding-required");
  const manifest = parseBackupManifestFile(manifestPath);
  if (manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(expected)) {
    throw new Error(`backup manifest ${basename(manifestPath)} belongs to a different authority database`);
  }
  assertExpectedBackupSource(expected, manifest);
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  await verifyBackupLogFiles(backupPath, manifest);
  const copyAdmission = offThread === undefined ? admission.verifiedReadOnlyCopy(backupPath, manifest.sha256)
    : await admission.verifiedReadOnlyCopyAsync(backupPath, manifest.sha256);
  let inspection: BackupCopyInspection;
  try {
    if (offThread === undefined) inspection = inspectVerifiedBackupCopyReadOnly(copyAdmission, backupPath, manifest.schemaVersion);
    else {
      inspection = await inspectAuthorityBackupOffThread(copyAdmission, backupPath, manifest.schemaVersion, offThread);
      copyAdmission.assertLive();
    }
  }
  finally { copyAdmission.release(); }
  removeReadOnlyInspectionCompanions(backupPath);
  assertBackupInspection(manifest, inspection, expected);
  return Object.freeze({ manifestPath, backupPath, manifest });
}

function assertExpectedBackupSource(expected: AuthorityBackupExpectedSource,
  observed: Pick<StoppedAuthorityBackupManifest, "schemaVersion" | "installationId" | "profileId" | "authorityContentFingerprint">): void {
  if (expected.kind === "profile") {
    if (observed.installationId !== expected.binding.installationId || observed.profileId !== expected.binding.profileId) {
      throw new Error("backup-profile-binding-mismatch");
    }
  } else if (observed.schemaVersion !== expected.schemaVersion || observed.installationId !== undefined
    || observed.profileId !== undefined || observed.authorityContentFingerprint !== expected.authorityContentFingerprint) {
    throw new Error("backup-predecessor-source-mismatch");
  }
}

function assertBackupInspection(manifest: StoppedAuthorityBackupManifest, inspection: BackupCopyInspection,
  expected: AuthorityBackupExpectedSource): void {
  assertExpectedBackupSource(expected, manifest);
  assertExpectedBackupSource(expected, inspection);
  for (const field of ["applicationId", "schemaVersion", "installationId", "profileId", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (inspection[field] !== manifest[field]) {
      throw new Error(`backup-manifest-field-mismatch: ${manifest.backupFileName} ${field}`);
    }
  }
}

export function verifyStoppedBackupManifestAtPath(admissionInput: RuntimeAdmission, manifestPathInput: string): VerifiedBackup {
  const admission = requireRuntimeAdmission(admissionInput), manifestPath = resolve(manifestPathInput);
  admission.assertReadOnlyAuthorityDatabase(join(admission.stateRoot, "state.db"));
  admission.assertStateRoot(manifestPath);
  return verifyStoppedManifest(manifestPath, admission.authorityBackupExpectedSource(), path => admission.assertStateRoot(path), (backupPath, manifest) => {
    const copy = admission.verifiedReadOnlyCopy(backupPath, manifest.sha256);
    try { return inspectVerifiedBackupCopyReadOnly(copy, backupPath, manifest.schemaVersion); }
    finally { copy.release(); }
  });
}

function verifyStoppedManifest(manifestPath: string, expected: AuthorityBackupExpectedSource, assertPath: (path: string) => void,
  inspect: (path: string, manifest: StoppedAuthorityBackupManifest) => BackupCopyInspection): VerifiedBackup {
  const file = readPrivateFile(manifestPath, { label: "lock", maxBytes: 64_000 });
  if (file === undefined) throw new Error("profile-maintenance-backup-manifest-required");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  const manifest = expected.kind === "profile" ? parseCurrentBackupManifest(value) : UnboundPredecessorBackupManifestSchema.parse(value);
  assertExpectedBackupSource(expected, manifest);
  if (expected.kind === "profile" && manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity(expected)) throw new Error("profile-maintenance-backup-source-mismatch");
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  assertPath(backupPath);
  if (manifest.manifestVersion === 4) {
    if (manifest.logFiles !== undefined) backupLogPaths(backupPath).forEach(assertPath);
    assertBackupLogFiles(backupPath, manifest);
  }
  const snapshot = createReadonlyAuthoritySnapshot(backupPath);
  let result: VerifiedBackup | undefined;
  const failures: unknown[] = [];
  try {
    const before = fileStatus(backupPath);
    if (!before.isFile() || before.isSymbolicLink() || privateFileNumber(before.nlink) !== 1 || privatePathRejects(backupPath, before, "private") || privateFileNumber(before.size) !== manifest.byteSize) throw new Error("profile-maintenance-backup-identity-invalid");
    const descriptor = openSync(backupPath, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash("sha256");
    let descriptorIdentity = before;
    let descriptorFailure: { error: unknown } | undefined;
    try {
      const opened = descriptorStatus(descriptor); descriptorIdentity = opened;
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("profile-maintenance-backup-changed");
      const chunk = Buffer.alloc(64 * 1024); let count = 0;
      for (;;) {
        const size = readSync(descriptor, chunk, 0, chunk.length, null);
        if (size === 0) break;
        count += size;
        if (count > manifest.byteSize) throw new Error("profile-maintenance-backup-size-invalid");
        hash.update(chunk.subarray(0, size));
      }
      if (count !== manifest.byteSize || hash.digest("hex") !== manifest.sha256) throw new Error("profile-maintenance-backup-digest-mismatch");
    } catch (error) { descriptorFailure = { error }; }
    try { closeSync(descriptor); }
    catch (error) { throw retainAuthoritySourceClosure(descriptorFailure === undefined ? [error] : [descriptorFailure.error, error],
      { snapshot, descriptor: { descriptor, identity: descriptorIdentity } }); }
    if (descriptorFailure !== undefined) throw descriptorFailure.error;
    snapshot.assertUnchanged();
    assertBackupInspection(manifest, inspect(backupPath, manifest), expected);
    snapshot.assertUnchanged();
    const after = readPrivateFile(manifestPath, { label: "lock", maxBytes: 64_000 });
    if (after === undefined || after.identity.device !== file.identity.device || after.identity.inode !== file.identity.inode || !after.bytes.equals(file.bytes)) throw new Error("profile-maintenance-backup-manifest-changed");
    result = Object.freeze({ manifestPath, backupPath, manifest });
  } catch (error) { failures.push(error); }
  if (failures.some(error => error instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(failures, { snapshot });
  try { snapshot.assertUnchanged(); } catch (error) { failures.push(error); }
  try { snapshot.dispose(); }
  catch (error) { throw retainAuthoritySourceClosure([...failures, error], { snapshot }); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "authority-backup-validation-failed", { cause: failures[0] });
  if (result === undefined) throw new Error("authority-backup-result-missing");
  return result;
}

function backupSuffix(purpose: "clean-shutdown" | "in-session" | undefined): string {
  if (purpose === "clean-shutdown") return ".shutdown";
  return purpose === "in-session" ? ".session" : "";
}

const BackupAttemptToken = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const BackupStageName = new RegExp(`^\\.authority-${BackupAttemptToken}\\.(?:sqlite\\.tmp(?:-(?:journal|wal|shm))?|manifest\\.json\\.tmp)$`, "u");
const BackupLogStageName = new RegExp(`^\\.authority-${BackupAttemptToken}\\.logs\\.tmp$`, "u");
const FinalBackupName = new RegExp(`^authority-g\\d+-\\d{17}-${BackupAttemptToken}(?:\\.shutdown|\\.session)?\\.sqlite$`, "u");
const RestoreStageName = new RegExp(`^(\\.restore-${BackupAttemptToken}\\.sqlite\\.tmp)(?:-(?:journal|wal|shm))?$`, "u");

export function reconcileBackupsAfterBrowserClosure(browserClosure: ProfileBrowserClosure, machine: RuntimeAdmission,
  operation: OfflineMaintenanceOperation): ProfileBrowserClosure {
  return {
    workerDirectory: input => browserClosure.workerDirectory(input),
    async probeClosed(...args) {
      await browserClosure.probeClosed(...args);
      const owner = args[4];
      if (!("assertLive" in owner)) throw new Error("abandoned-backup-stopped-profile-required");
      const admission = requireRuntimeAdmission(owner);
      const assertHeld = () => {
        admission.assertReadyStoppedProfileUpgradeOwner(machine);
        admission.assertOfflineMaintenance(operation);
      };
      assertHeld();
      reconcileAbandonedBackups(admission.stateRoot, assertHeld, () => AuthorityDatabase.readProfileMaintenanceInventory(admission).upgrades);
    },
  };
}

export function reconcileStartupAuthorityStages(machine: RuntimeAdmission, profileId: string, operation: OfflineMaintenanceOperation): number {
  const id = z.uuid().parse(profileId), root = join(machine.stateRoot, "profiles", id);
  const assertHeld = () => { machine.assertOfflineMaintenance(operation); machine.assertStateRoot(root); };
  assertHeld();
  const context = machine.readInstallationContext();
  if (context === undefined || fileStatus(join(context.workspace, ".tracker", "control", "journal.json"), true) !== undefined) {
    throw new Error("authority-restore-recovery-required");
  }
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(root, ancestry)) return 0;
  const names = new Set(readdirSync(root));
  const restores = [...names].flatMap(name => {
    const stage = RestoreStageName.exec(name)?.[1];
    if (stage === undefined || names.has(`${stage}-wal.live-companion`) || names.has(`${stage}-shm.live-companion`)) return [];
    const file = abandonedFile(root, name);
    return file === undefined ? [] : [file];
  });
  if (restores.length > 0) assertMaintenanceCustodyAvailable("restore");
  const backups = reconcileAbandonedBackups(root, assertHeld, () => {
    if (!machine.readStartupProfileIds().includes(id)) throw new Error("profile-startup-registration-required");
    const binding = { installationId: context.locator.installationId, profileId: id };
    return withReadonlyAuthoritySnapshot(join(root, "state.db"), database => {
      const { user_version: version } = z.strictObject({ user_version: z.number().int().positive() }).parse(database.prepare("PRAGMA user_version").get());
      assertExpectedBackupSource({ kind: "profile", binding }, inspectOpenDatabase(database, version));
      return database.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()
        .map(row => AuthorityUpgradeRecordSchema.parse(nativeOrdinaryRecordFromRow("database_upgrades", row)));
    });
  });
  return backups + removeAbandonedFiles(root, ancestry, restores, assertHeld, "restore-stage-custody-changed");
}

function reconcileAbandonedBackups(root: string, assertHeld: () => void, readUpgrades: () => readonly AuthorityUpgradeRecord[]): number {
  const directory = join(root, "backups", "authority");
  const ancestry = new Map<string, DirectoryIdentity>();
  if (!noSymlinkAncestry(directory, ancestry)) return 0;
  const names = new Set(readdirSync(directory));
  const stages = [...names].filter(name => BackupStageName.test(name));
  const logStages = [...names].filter(name => BackupLogStageName.test(name));
  const candidateNames = new Set([...names].map(name => name.replace(/\.(?:timeline|dashboard)\.db(?:-wal|-shm|-journal)?$/u, "")));
  const unpaired = [...candidateNames].filter(name => FinalBackupName.test(name)
    && !names.has(`${name}.manifest.json`) && !names.has(`${name}.manifest.json.retiring`));
  if (stages.length === 0 && logStages.length === 0 && unpaired.length === 0) return 0;
  assertMaintenanceCustodyAvailable("backup");
  statDirectory(directory, "authority backup", 0o700);

  const claimed = new Set<string>();
  if (unpaired.length > 0) {
    // A missing manifest cannot make a recorded upgrade backup eligible for cleanup.
    for (const record of readUpgrades()) {
      if (record.phase === "settled") claimed.add(basename(record.backup.manifestPath, ".manifest.json"));
    }
    for (const name of names) {
      if (!name.endsWith(".manifest.json") && !name.endsWith(".manifest.json.retiring")) continue;
      const file = readPrivateFile(join(directory, name), { label: "lock", maxBytes: 64_000 });
      if (file === undefined) throw new Error("abandoned-backup-manifest-changed");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
      claimed.add(parseCurrentBackupManifest(value).backupFileName);
    }
  }
  const orphans = unpaired.filter(name => !claimed.has(name));
  for (const name of orphans) {
    if (["-wal", "-shm", "-journal"].some(suffix => names.has(`${name}${suffix}`))) throw new Error("abandoned-backup-companion-unproved");
  }
  const orphanLogs = orphans.flatMap(name => backupLogPaths(name).flatMap(path =>
    [...sqliteCompanions.map(suffix => path + suffix), path].filter(entry => names.has(entry))));
  const abandoned = [...stages, ...orphanLogs, ...orphans.filter(name => names.has(name))].map(name => {
    const file = abandonedFile(directory, name);
    if (file === undefined) throw new Error("abandoned-backup-file-unsafe");
    return file;
  });
  const removed = removeAbandonedFiles(directory, ancestry, abandoned, assertHeld, "abandoned-backup-file-changed");
  for (const stage of logStages) removeBackupLogStage(join(directory, stage), assertHeld);
  if (logStages.length > 0) fsyncPath(directory);
  return removed + logStages.length;
}

function removeBackupLogStage(root: string, assertHeld: () => void): void {
  const identity = statDirectory(root, "log backup staging", 0o700);
  const owned = new Set(PROFILE_LOG_FILES);
  const files = readdirSync(root).map(name => {
    const file = owned.has(name) ? abandonedFile(root, name) : undefined;
    if (file === undefined) throw new Error("abandoned-backup-log-stage-unsafe");
    return file;
  });
  for (const file of files) {
    assertHeld();
    if (!sameDirectory(statDirectory(root, "log backup staging", 0o700), identity)) throw new Error("abandoned-backup-log-stage-changed");
    removeExactPath(file.path, file, false, "abandoned-backup-log-stage-changed");
  }
  assertHeld();
  if (!sameDirectory(statDirectory(root, "log backup staging", 0o700), identity)) throw new Error("abandoned-backup-log-stage-changed");
  rmdirSync(root);
}

function abandonedFile(directory: string, name: string): (DirectoryIdentity & { path: string }) | undefined {
  const path = join(directory, name), status = fileStatus(path);
  if (!status.isFile() || privateFileNumber(status.nlink) !== 1 || privatePathRejects(path, status, "group-write")) return undefined;
  return { path, device: status.dev, inode: status.ino };
}

function removeAbandonedFiles(directory: string, ancestry: Map<string, DirectoryIdentity>,
  abandoned: readonly (DirectoryIdentity & { path: string })[], assertHeld: () => void, changed: string): number {
  for (const file of abandoned) {
    assertHeld();
    noSymlinkAncestry(directory, ancestry);
    removeExactPath(file.path, file, false, changed);
  }
  if (abandoned.length > 0) fsyncPath(directory);
  return abandoned.length;
}

export class AuthorityBackupService {
  #admission: RuntimeAdmission;
  #source: AuthorityBackupSource;
  #directory: string;
  #purpose: "clean-shutdown" | "in-session" | undefined;
  #signal: AbortSignal | undefined;
  #clock: Clock;
  #inFlight: Promise<AuthorityBackupRunReport> | undefined;
  #requiredGeneration = 0;
  #coalescedRequests = 0;

  constructor(admissionInput: RuntimeAdmission, source: AuthorityBackupSource, input: unknown, clock: Clock = systemClock, signal?: AbortSignal) {
    this.#admission = requireRuntimeAdmission(admissionInput);
    const options = AuthorityBackupServiceOptionsSchema.parse(input);
    this.#source = source;
    this.#directory = resolve(options.directory);
    this.#purpose = options.purpose;
    this.#signal = signal;
    this.#admission.assertStateRoot(this.#directory);
    this.#clock = clock;
  }

  request(input: unknown): Promise<AuthorityBackupRunReport> {
    this.#admission.assertAuthorityBackupWrite(this.#directory);
    const request = AuthorityBackupRequestSchema.parse(input);
    assertMaintenanceCustodyAvailable("backup");
    this.#requiredGeneration = Math.max(this.#requiredGeneration, request.requiredGeneration);
    this.#coalescedRequests += 1;
    if (this.#inFlight !== undefined) return this.#inFlight;
    const tracked = this.#runBatch().then(
      (report) => {
        this.#clearFlight();
        return report;
      },
      (error: unknown) => {
        this.#clearFlight();
        throw error;
      },
    );
    this.#inFlight = tracked;
    return tracked;
  }

  #clearFlight(): void {
    this.#inFlight = undefined;
    this.#requiredGeneration = 0;
    this.#coalescedRequests = 0;
  }

  async #runBatch(): Promise<AuthorityBackupRunReport> {
    const manifests: StoppedAuthorityBackupManifest[] = [];
    manifests.push(await this.#createOne());
    const requiredAfterFirst = Math.max(
      this.#requiredGeneration,
      this.#source.getMeta().authorityGeneration,
    );
    if (manifests[0].authorityGeneration < requiredAfterFirst) {
      manifests.push(await this.#createOne());
    }
    const requiredAtCompletion = Math.max(
      this.#requiredGeneration,
      this.#source.getMeta().authorityGeneration,
    );
    const finalGeneration = manifests.at(-1)?.authorityGeneration;
    if (finalGeneration === undefined || finalGeneration < requiredAtCompletion) {
      throw new Error(
        `verified follow-up backup generation ${String(finalGeneration)} is behind required authority generation ${String(requiredAtCompletion)}`,
      );
    }
    return AuthorityBackupRunReportSchema.parse({
      state: "verified",
      requestedGeneration: requiredAtCompletion,
      finalGeneration,
      coalescedRequests: this.#coalescedRequests,
      followUpPerformed: manifests.length === 2,
      manifests,
    });
  }

  async #createOne(): Promise<StoppedAuthorityBackupManifest> {
    this.#admission.assertAuthorityBackupWrite(this.#directory);
    const expected = this.#admission.authorityBackupExpectedSource();
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const temporaryBackupPath = join(this.#directory, `.authority-${token}.sqlite.tmp`);
    const temporaryManifestPath = join(this.#directory, `.authority-${token}.manifest.json.tmp`);
    const temporaryLogRoot = join(this.#directory, `.authority-${token}.logs.tmp`);
    const temporaryPaths = [temporaryBackupPath, temporaryManifestPath];
    const finalPaths: string[] = [];
    let finalManifestPath: string | undefined;
    let result: StoppedAuthorityBackupManifest | undefined;
    let primary: { error: unknown } | undefined;
    try {
      await this.#source.onlineBackupTo(temporaryBackupPath);
      this.#admission.assertAuthorityBackupWrite(this.#directory);
      const inspectedDigest = await sha256File(temporaryBackupPath);
      const copyAdmission = this.#purpose === "in-session" ? await this.#admission.verifiedReadOnlyCopyAsync(temporaryBackupPath, inspectedDigest)
        : this.#admission.verifiedReadOnlyCopy(temporaryBackupPath, inspectedDigest);
      let inspection: BackupCopyInspection;
      try {
        const schemaVersion = this.#source.getMeta().schemaVersion;
        inspection = this.#purpose === "in-session"
          ? await inspectAuthorityBackupOffThread(copyAdmission, temporaryBackupPath, schemaVersion, { ...(this.#signal === undefined ? {} : { signal: this.#signal }) })
          : inspectVerifiedBackupCopyReadOnly(copyAdmission, temporaryBackupPath, schemaVersion);
        if (this.#purpose === "in-session") copyAdmission.assertLive();
      }
      finally { copyAdmission.release(); }
      assertExpectedBackupSource(expected, inspection);
      removeReadOnlyInspectionCompanions(temporaryBackupPath);
      chmodSync(temporaryBackupPath, 0o600);
      fsyncPath(temporaryBackupPath);
      const createdAt = this.#clock.now().toISOString();
      const compactTime = createdAt.replaceAll(/[^0-9]/g, "");
      const stem = `authority-g${String(inspection.authorityGeneration)}-${compactTime}-${token}`;
      const backupFileName = `${stem}${backupSuffix(this.#purpose)}.sqlite`;
      const finalBackupPath = join(this.#directory, backupFileName);
      let logFiles: z.input<typeof AuthorityBackupManifestSchema>["logFiles"];
      const withLogs = expected.kind === "profile" && isCurrentAuthoritySchemaVersion(inspection.schemaVersion);
      if (withLogs) {
        mkdirSync(temporaryLogRoot, { mode: 0o700 });
        try { await buildBackupLogsOffThread(temporaryBackupPath, temporaryLogRoot, this.#signal); }
        finally { await backupThreadIdle(); }
        this.#signal?.throwIfAborted();
        this.#admission.assertAuthorityBackupWrite(this.#directory);
        removeReadOnlyInspectionCompanions(temporaryBackupPath);
      }
      renameSync(temporaryBackupPath, finalBackupPath);
      finalPaths.push(finalBackupPath);
      if (withLogs) {
        const publish = async (name: typeof LOG_DATABASE_NAMES[number]) => {
          const source = join(temporaryLogRoot, `${name}.db`), target = `${finalBackupPath}.${name}.db`;
          if (sqliteCompanions.some(suffix => (fileStatus(source + suffix, true)?.size ?? 0n) > 0n)) {
            throw new Error("backup-log-file-not-self-contained");
          }
          fsyncPath(source);
          const byteSize = statSync(source).size, sha256 = await sha256File(source);
          this.#admission.assertAuthorityBackupWrite(this.#directory);
          renameSync(source, target);
          finalPaths.push(target);
          return { byteSize, sha256 };
        };
        logFiles = { timeline: await publish("timeline"), dashboard: await publish("dashboard") };
        removeBackupLogStage(temporaryLogRoot, () => this.#admission.assertAuthorityBackupWrite(this.#directory));
      }
      const stats = statSync(finalBackupPath);
      this.#admission.assertAuthorityBackupWrite(this.#directory);
      fsyncPath(this.#directory);
      const verification = {
        state: "verified",
        observedFrom: "backup-copy",
        observedAt: this.#clock.now().toISOString(),
        applicationId: inspection.applicationId,
        schemaVersion: inspection.schemaVersion,
        ...(inspection.installationId === undefined ? {} : { installationId: inspection.installationId }),
        ...(inspection.profileId === undefined ? {} : { profileId: inspection.profileId }),
        pageCount: inspection.pageCount,
        authorityGeneration: inspection.authorityGeneration,
        authorityContentFingerprint: inspection.authorityContentFingerprint,
        quickCheck: inspection.quickCheck,
        foreignKeyViolations: inspection.foreignKeyViolations,
        invariantViolations: inspection.invariantViolations,
        exactTableRegistry: inspection.exactTableRegistry,
      };
      const manifest = StoppedAuthorityBackupManifestSchema.parse({
        kind: "hrauto-authority-backup",
        manifestVersion: expected.kind === "profile" ? 4 : 3,
        backupFileName,
        sourceDatabaseIdentity: authoritySourceDatabaseIdentity(expected),
        applicationId: inspection.applicationId,
        schemaVersion: inspection.schemaVersion,
        ...(inspection.installationId === undefined ? {} : { installationId: inspection.installationId }),
        ...(inspection.profileId === undefined ? {} : { profileId: inspection.profileId }),
        pageCount: inspection.pageCount,
        authorityGeneration: inspection.authorityGeneration,
        authorityContentFingerprint: inspection.authorityContentFingerprint,
        createdAt,
        byteSize: stats.size,
        sha256: inspectedDigest,
        ...(logFiles === undefined ? {} : { logFiles }),
        verification,
      });
      // The one read of the final bytes: they must still be the bytes that were inspected.
      await verifyBackupBytesAtPath(finalBackupPath, manifest);
      if (manifest.manifestVersion === 4) await verifyBackupLogFiles(finalBackupPath, manifest);
      const manifestFileName = `${backupFileName}.manifest.json`, manifestText = `${canonicalJsonStringify(manifest)}\n`;
      writeFileSync(temporaryManifestPath, manifestText, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fsyncPath(temporaryManifestPath);
      if (readFileSync(temporaryManifestPath, "utf8") !== manifestText) throw new Error("backup-manifest-readback-mismatch");
      this.#admission.assertAuthorityBackupWrite(this.#directory);
      // A backup counts only once its manifest exists, so it is published last.
      finalManifestPath = join(this.#directory, manifestFileName);
      renameSync(temporaryManifestPath, finalManifestPath);
      finalPaths.push(finalManifestPath);
      fsyncPath(this.#directory);
      if (expected.kind !== "profile") verifyStoppedBackupManifestAtPath(this.#admission, finalManifestPath);
      result = manifest;
    } catch (error) { primary = { error }; }
    if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw primary.error;
    const cleanupFailures: unknown[] = [];
    try {
      if (existsSync(temporaryLogRoot)) removeBackupLogStage(temporaryLogRoot, () => this.#admission.assertAuthorityBackupWrite(this.#directory));
    } catch (error) { cleanupFailures.push(error); }
    if (primary !== undefined) {
      try { if (finalManifestPath !== undefined && existsSync(finalManifestPath)) rmSync(finalManifestPath); }
      catch (error) { cleanupFailures.push(error); }
      for (const finalPath of finalPaths.reverse()) {
        for (const path of [finalPath, `${finalPath}-wal`, `${finalPath}-shm`]) {
          try { if (existsSync(path)) rmSync(path); } catch (error) { cleanupFailures.push(error); }
        }
      }
    }
    for (const temporaryPath of temporaryPaths) {
      for (const path of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`]) {
        try { if (existsSync(path)) rmSync(path); } catch (error) { cleanupFailures.push(error); }
      }
    }
    if (cleanupFailures.length > 0) {
      if (primary !== undefined) throw new AggregateError([primary.error, ...cleanupFailures], "authority-backup-cleanup-failed", { cause: primary.error });
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
      throw new AggregateError(cleanupFailures, "authority-backup-cleanup-failed", { cause: cleanupFailures[0] });
    }
    if (primary !== undefined) throw primary.error;
    if (result === undefined) throw new Error("authority-backup-result-missing");
    return result;
  }
}
