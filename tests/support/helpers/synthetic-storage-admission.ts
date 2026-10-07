import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { basename, dirname, join, resolve } from "node:path";
import { AuthorityBackupService as RealAuthorityBackupService, verifyBackupManifestAtPath as realVerifyBackupManifestAtPath } from "../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService as RealOfflineAuthorityRestoreService } from "../../../src/backend/storage/sqlite/offline-restore.js";
import { backupLifecyclePair as realBackupLifecyclePair, restoreLifecyclePair as realRestoreLifecyclePair, verifyLifecyclePair as realVerifyLifecyclePair } from "../../../src/backend/storage/sqlite/lifecycle-storage.js";
import { backupStoppedAuthority as realBackupStoppedAuthority, upgradeStorage as realUpgradeStorage } from "../../../src/backend/storage/maintenance/upgrade.js";
import { restoreHistoricalStorage as realRestoreHistoricalStorage } from "../../../src/backend/storage/maintenance/historical-restore.js";
import { doctorAuthorityStorage as realDoctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { inspectDoctorPair as realInspectDoctorPair } from "../../../src/backend/storage/sqlite/storage-recovery-status.js";
import { composeStorageCommand as realComposeStorageCommand } from "../../../src/backend/app/composition/storage-compose.js";
import { createCredentialStore as realCreateCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { createProviderKeyStore as realCreateProviderKeyStore } from "../../../src/backend/storage/configuration/provider-key-store.js";
import { migrateTestDataFromCredentials as realMigrateTestDataFromCredentials } from "../../../src/backend/storage/configuration/credential-test-data-migration.js";
import { composeTestDataCommand as realComposeTestDataCommand } from "../../../src/backend/app/test-data/compose.js";
import { AuthorityBootStore as RealAuthorityBootStore } from "../../../src/backend/storage/sqlite/authority-boot.js";
import { AuthorityHealthPreflightRunner as RealAuthorityHealthPreflightRunner } from "../../../src/backend/storage/sqlite/authority-health-runner.js";
import { withStoppedArchiveConversion as realWithStoppedArchiveConversion } from "../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly as realInspectAuthorityBackupReadOnly, openAuthorityBackupSourceReadOnly as realOpenAuthorityBackupSourceReadOnly, withAuthorityDatabaseReadOnly as realWithAuthorityDatabaseReadOnly, backupHasArchiveTransferCustody as realBackupHasArchiveTransferCustody, backupPendingCaptureFiles as realBackupPendingCaptureFiles } from "../../../src/backend/storage/compatibility/backup-inspection.js";
import { readLatestDatabaseUpgrade as realReadLatestDatabaseUpgrade } from "../../../src/backend/storage/sqlite/stopped-database-conversion.js";

export * from "../../../src/backend/storage/sqlite/authority-database.js";
export * from "../../../src/backend/storage/sqlite/archive-database.js";
export * from "../../../src/backend/storage/sqlite/index.js";
export * from "../../../src/backend/storage/sqlite/backup-service.js";
export * from "../../../src/backend/storage/sqlite/lifecycle-storage.js";
export * from "../../../src/backend/storage/sqlite/offline-restore.js";
export * from "../../../src/backend/storage/sqlite/storage-doctor.js";
export * from "../../../src/backend/storage/sqlite/storage-recovery-status.js";
export * from "../../../src/backend/storage/maintenance/upgrade.js";
export * from "../../../src/backend/storage/maintenance/historical-restore.js";
export * from "../../../src/backend/app/composition/storage-compose.js";
export * from "../../../src/backend/storage/configuration/credential-store.js";
export * from "../../../src/backend/storage/configuration/provider-key-store.js";
export * from "../../../src/backend/storage/configuration/credential-test-data-migration.js";
export * from "../../../src/backend/app/test-data/compose.js";
export * from "../../../src/backend/storage/sqlite/authority-boot.js";
export * from "../../../src/backend/storage/sqlite/authority-health-runner.js";
export { AuthorityDatabase, ArchiveDatabase } from "./synthetic-database-admission.js";
export function inspectAuthorityBackupReadOnly(path: string, expectedSchemaVersion?: number, busyTimeoutMs?: number) {
  return realInspectAuthorityBackupReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, expectedSchemaVersion, busyTimeoutMs);
}
export function openAuthorityBackupSourceReadOnly(path: string, busyTimeoutMs?: number) {
  return realOpenAuthorityBackupSourceReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, busyTimeoutMs);
}
export function withAuthorityDatabaseReadOnly<Result>(path: string, read: Parameters<typeof realWithAuthorityDatabaseReadOnly<Result>>[2]): Result {
  return realWithAuthorityDatabaseReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, read);
}
export function backupHasArchiveTransferCustody(path: string) {
  return realBackupHasArchiveTransferCustody(RuntimeAdmission.syntheticFixture(path, "authority"), path);
}
export function backupPendingCaptureFiles(path: string) {
  return realBackupPendingCaptureFiles(RuntimeAdmission.syntheticFixture(path, "authority"), path);
}
export function readLatestDatabaseUpgrade(path: string) {
  return realReadLatestDatabaseUpgrade(RuntimeAdmission.syntheticFixture(path, "authority"), path);
}
export function syntheticStateRoot(root: string): RuntimeAdmission {
  const stateRoot = resolve(root);
  return RuntimeAdmission.syntheticRoots(stateRoot, join(stateRoot, "artifacts"));
}

function backupRoot(path: string): string {
  const directory = dirname(resolve(path));
  return basename(directory) === "authority" && basename(dirname(directory)) === "backups"
    ? dirname(dirname(directory)) : directory;
}

export class AuthorityBackupService extends RealAuthorityBackupService {
  constructor(source: ConstructorParameters<typeof RealAuthorityBackupService>[1], input: ConstructorParameters<typeof RealAuthorityBackupService>[2],
    clock?: ConstructorParameters<typeof RealAuthorityBackupService>[3]) {
    const directory = (input as { directory: string }).directory;
    super(syntheticStateRoot(backupRoot(join(directory, "copy.sqlite"))), source, input, clock);
  }
}

export class OfflineAuthorityRestoreService extends RealOfflineAuthorityRestoreService {
  constructor(input: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[1],
    rebuild: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[2],
    clock?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[3],
    files?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[4],
    factory?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[5]) {
    super(RuntimeAdmission.syntheticFixture((input as { authorityPath: string }).authorityPath, "authority"), input, rebuild, clock, files, factory);
  }
}

export async function verifyBackupManifestAtPath(path: string, sourceIdentity?: string) {
  return realVerifyBackupManifestAtPath(syntheticStateRoot(backupRoot(path)), path, sourceIdentity);
}

export async function verifyLifecyclePair(path: string) {
  return realVerifyLifecyclePair(syntheticStateRoot(backupRoot(path)), path);
}

export async function backupLifecyclePair(source: Parameters<typeof realBackupLifecyclePair>[1], stateRoot: string,
  clock: Parameters<typeof realBackupLifecyclePair>[3]) {
  return realBackupLifecyclePair(syntheticStateRoot(stateRoot), source, stateRoot, clock);
}

export async function restoreLifecyclePair(options: Parameters<typeof realRestoreLifecyclePair>[1], request: Parameters<typeof realRestoreLifecyclePair>[2],
  rebuild: Parameters<typeof realRestoreLifecyclePair>[3], clock: Parameters<typeof realRestoreLifecyclePair>[4],
  afterStep?: Parameters<typeof realRestoreLifecyclePair>[5]) {
  return realRestoreLifecyclePair(RuntimeAdmission.syntheticFixture((options as {authorityPath:string}).authorityPath,"authority"), options, request, rebuild, clock, afterStep);
}

export async function backupStoppedAuthority(stateRoot: string, clock: Parameters<typeof realBackupStoppedAuthority>[2]) {
  return realBackupStoppedAuthority(syntheticStateRoot(stateRoot), stateRoot, clock);
}

export async function upgradeStorage(input: Parameters<typeof realUpgradeStorage>[1], clock: Parameters<typeof realUpgradeStorage>[2],
  acquire?: Parameters<typeof realUpgradeStorage>[3]) {
  return realUpgradeStorage(syntheticStateRoot(input.stateRoot), input, clock, acquire);
}

export async function restoreHistoricalStorage(options: Parameters<typeof realRestoreHistoricalStorage>[1], request: Parameters<typeof realRestoreHistoricalStorage>[2],
  environmentFile: Parameters<typeof realRestoreHistoricalStorage>[3], clock: Parameters<typeof realRestoreHistoricalStorage>[4],
  afterStep?: Parameters<typeof realRestoreHistoricalStorage>[5]) {
  return realRestoreHistoricalStorage(RuntimeAdmission.syntheticFixture((options as {authorityPath:string}).authorityPath,"authority"),options,request,environmentFile,clock,afterStep);
}

export async function doctorAuthorityStorage(options: Parameters<typeof realDoctorAuthorityStorage>[1], clock?: Parameters<typeof realDoctorAuthorityStorage>[2]) {
  return realDoctorAuthorityStorage(RuntimeAdmission.syntheticFixture((options as {authorityPath:string}).authorityPath,"authority"),options,clock);
}

export async function inspectDoctorPair(path: string, sourceIdentity: string) {
  return realInspectDoctorPair(syntheticStateRoot(backupRoot(path)),path,sourceIdentity);
}

export const AuthorityBootStore = new Proxy(RealAuthorityBootStore, {
  get(target, property, receiver) {
    if (property === "open") return (input: unknown, clock?: Parameters<typeof RealAuthorityBootStore.open>[2]) =>
      target.open(RuntimeAdmission.syntheticFixture((input as {path:string}).path,"authority"),input,clock);
    return Reflect.get(target,property,receiver) as unknown;
  },
}) as unknown as Omit<typeof RealAuthorityBootStore,"open"> & {open(input:unknown,clock?:Parameters<typeof RealAuthorityBootStore.open>[2]):RealAuthorityBootStore};
export type AuthorityBootStore = RealAuthorityBootStore;

export class AuthorityHealthPreflightRunner extends RealAuthorityHealthPreflightRunner {
  constructor(input: ConstructorParameters<typeof RealAuthorityHealthPreflightRunner>[1],
    clock?: ConstructorParameters<typeof RealAuthorityHealthPreflightRunner>[2]) {
    super(RuntimeAdmission.syntheticFixture((input as {authorityPath:string}).authorityPath,"authority"),input,clock);
  }
}

export function withStoppedArchiveConversion<T>(database: Parameters<typeof realWithStoppedArchiveConversion<T>>[1],
  path: string, clock: Parameters<typeof realWithStoppedArchiveConversion<T>>[3],
  archive: Parameters<typeof realWithStoppedArchiveConversion<T>>[4],
  work: Parameters<typeof realWithStoppedArchiveConversion<T>>[5]): T {
  return realWithStoppedArchiveConversion(RuntimeAdmission.syntheticFixture(path,"authority"),database,path,clock,archive,work);
}

export async function composeStorageCommand(isolation: Parameters<typeof realComposeStorageCommand>[0],
  args: Parameters<typeof realComposeStorageCommand>[1], clock?: Parameters<typeof realComposeStorageCommand>[2],
  repoRoot: string = process.cwd()) {
  return realComposeStorageCommand(isolation,args,clock,repoRoot,syntheticStateRoot(resolve(repoRoot,isolation.stateRoot)));
}

export function createCredentialStore(options: Omit<Parameters<typeof realCreateCredentialStore>[0],"admission">) {
  return realCreateCredentialStore({ ...options, admission: syntheticStateRoot(options.stateRoot) });
}

export function createProviderKeyStore(input: Omit<Parameters<typeof realCreateProviderKeyStore>[0],"admission">) {
  return realCreateProviderKeyStore({ ...input, admission: syntheticStateRoot(dirname(input.envPath)) });
}

export async function migrateTestDataFromCredentials(input: Omit<Parameters<typeof realMigrateTestDataFromCredentials>[0],"admission">) {
  return realMigrateTestDataFromCredentials({ ...input, admission: syntheticStateRoot(input.stateRoot) });
}

export async function composeTestDataCommand(isolation: Parameters<typeof realComposeTestDataCommand>[1],
  args: Parameters<typeof realComposeTestDataCommand>[2], root: Parameters<typeof realComposeTestDataCommand>[3],
  dependencies: Parameters<typeof realComposeTestDataCommand>[4]) {
  return realComposeTestDataCommand(syntheticStateRoot(resolve(root,isolation.stateRoot)),isolation,args,root,dependencies);
}
