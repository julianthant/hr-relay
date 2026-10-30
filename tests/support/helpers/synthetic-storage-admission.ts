import { prepareStoppedBackupClosure, type ProfileBrowserClosure } from "../../../src/backend/storage/maintenance/profile-inventory.js";
import { createBoundProfileCredentialStore, findProfileFixtureAdmission, withOfflineMaintenance } from "./admission-fixture.js";
import { findProfileFixtureInWorkspace } from "./synthetic-database-admission.js";
import { withAuthorityDatabaseReadOnly as realWithAuthorityDatabaseReadOnly } from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { inspectAuthorityBackupReadOnly as realInspectAuthorityBackupReadOnly, openAuthorityBackupSourceReadOnly as realOpenAuthorityBackupSourceReadOnly } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { basename, dirname, join, resolve } from "node:path";
import { AuthorityBackupService as RealAuthorityBackupService, verifyBackupManifestAtPath as realVerifyBackupManifestAtPath } from "../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService as RealOfflineAuthorityRestoreService } from "../../../src/backend/storage/sqlite/offline-restore.js";
import { backupStoppedAuthority as realBackupStoppedAuthority, upgradeStorage as realUpgradeStorage } from "../../../src/backend/storage/maintenance/upgrade.js";
import { doctorAuthorityStorage as realDoctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { composeStorageCommand as realComposeStorageCommand } from "../../../src/backend/app/composition/storage-compose.js";
import { createCredentialStore as realCreateCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { composeTestDataCommand as realComposeTestDataCommand } from "../../../src/backend/app/test-data/compose.js";
import { AuthorityBootStore as RealAuthorityBootStore } from "../../../src/backend/storage/sqlite/authority-boot.js";
import { AuthorityHealthPreflightRunner as RealAuthorityHealthPreflightRunner } from "../../../src/backend/storage/sqlite/authority-health-runner.js";

export * from "../../../src/backend/storage/sqlite/authority-database.js";
export * from "../../../src/backend/storage/sqlite/index.js";
export * from "../../../src/backend/storage/sqlite/backup-service.js";
export * from "../../../src/backend/storage/sqlite/offline-restore.js";
export * from "../../../src/backend/storage/sqlite/storage-doctor.js";
export * from "../../../src/backend/storage/sqlite/storage-recovery-status.js";
export * from "../../../src/backend/storage/maintenance/upgrade.js";
export * from "../../../src/backend/app/composition/storage-compose.js";
export * from "../../../src/backend/storage/configuration/credential-store.js";
export * from "../../../src/backend/app/test-data/compose.js";
export * from "../../../src/backend/storage/sqlite/authority-boot.js";
export * from "../../../src/backend/storage/sqlite/authority-health-runner.js";
export { AuthorityDatabase } from "./synthetic-database-admission.js";
export function inspectAuthorityBackupReadOnly(path: string, expectedSchemaVersion?: number, busyTimeoutMs?: number) {
  return realInspectAuthorityBackupReadOnly(readAdmission(path), path, expectedSchemaVersion, busyTimeoutMs);
}
export function openAuthorityBackupSourceReadOnly(path: string, busyTimeoutMs?: number) {
  return realOpenAuthorityBackupSourceReadOnly(readAdmission(path), path, busyTimeoutMs);
}
export function withAuthorityDatabaseReadOnly<Result>(path: string, read: Parameters<typeof realWithAuthorityDatabaseReadOnly<Result>>[2],
  busyTimeoutMs?:number): Result {
  return realWithAuthorityDatabaseReadOnly(readAdmission(path), path, read,busyTimeoutMs);
}
export function syntheticStateRoot(root: string): RuntimeAdmission {
  const stateRoot = resolve(root);
  const profile = findProfileFixtureAdmission(stateRoot);
  if (profile !== undefined) return profile;
  return RuntimeAdmission.syntheticRoots(stateRoot, join(stateRoot, "artifacts"));
}

function readAdmission(path: string): RuntimeAdmission {
  return findProfileFixtureAdmission(backupRoot(path)) ?? RuntimeAdmission.syntheticFixture(path);
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
  constructor(browserClosure: ProfileBrowserClosure, input: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[2],
    rebuild: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[3],
    clock?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[4],
    files?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[5],
    credentials?: ConstructorParameters<typeof RealOfflineAuthorityRestoreService>[6]) {
    super(browserClosure, RuntimeAdmission.syntheticFixture((input as { authorityPath: string }).authorityPath), input, rebuild, clock, files, credentials);
  }
}

export async function verifyBackupManifestAtPath(path: string, sourceIdentity?: string) {
  return realVerifyBackupManifestAtPath(syntheticStateRoot(backupRoot(path)), path, sourceIdentity);
}

export async function backupStoppedAuthority(browserClosure: ProfileBrowserClosure, stateRoot: string, clock: Parameters<typeof realBackupStoppedAuthority>[3],
  processLockRoot: string, heldRestore?: Parameters<typeof realBackupStoppedAuthority>[5]) {
  const admission = syntheticStateRoot(stateRoot);
  return heldRestore === undefined
    ? withOfflineMaintenance(admission, operation => prepareStoppedBackupClosure(browserClosure, admission, operation, clock, processLockRoot).then(closure => realBackupStoppedAuthority(closure, admission, stateRoot, clock, processLockRoot, operation)))
    : prepareStoppedBackupClosure(browserClosure, admission, heldRestore, clock, processLockRoot).then(closure => realBackupStoppedAuthority(closure, admission, stateRoot, clock, processLockRoot, heldRestore));
}

export async function upgradeStorage(browserClosure: ProfileBrowserClosure, input: Parameters<typeof realUpgradeStorage>[2], clock: Parameters<typeof realUpgradeStorage>[3],
  operation?: Parameters<typeof realUpgradeStorage>[4]) {
  const admission = syntheticStateRoot(input.stateRoot);
  return operation === undefined
    ? withOfflineMaintenance(admission, issued => realUpgradeStorage(browserClosure, admission, input, clock, issued))
    : realUpgradeStorage(browserClosure, admission, input, clock, operation);
}

export async function doctorAuthorityStorage(options: Parameters<typeof realDoctorAuthorityStorage>[1], clock?: Parameters<typeof realDoctorAuthorityStorage>[2]) {
  const authorityPath = resolve((options as { authorityPath: string }).authorityPath);
  const admission = findProfileFixtureAdmission(dirname(authorityPath)) ?? RuntimeAdmission.syntheticFixture(authorityPath);
  return realDoctorAuthorityStorage(admission, options, clock);
}

export const AuthorityBootStore = new Proxy(RealAuthorityBootStore, {
  get(target, property, receiver) {
    if (property === "open") return (input: unknown, clock?: Parameters<typeof RealAuthorityBootStore.open>[2]) => {
      const path = resolve((input as { path: string }).path);
      const admission = findProfileFixtureAdmission(dirname(path)) ?? RuntimeAdmission.syntheticFixture(path);
      return target.open(admission, input, clock);
    };
    return Reflect.get(target,property,receiver) as unknown;
  },
}) as unknown as Omit<typeof RealAuthorityBootStore,"open"> & {open(input:unknown,clock?:Parameters<typeof RealAuthorityBootStore.open>[2]):RealAuthorityBootStore};
export type AuthorityBootStore = RealAuthorityBootStore;

export class AuthorityHealthPreflightRunner extends RealAuthorityHealthPreflightRunner {
  constructor(input: ConstructorParameters<typeof RealAuthorityHealthPreflightRunner>[1],
    clock?: ConstructorParameters<typeof RealAuthorityHealthPreflightRunner>[2]) {
    super(RuntimeAdmission.syntheticFixture((input as {authorityPath:string}).authorityPath),input,clock);
  }
}

export async function composeStorageCommand(isolation: Parameters<typeof realComposeStorageCommand>[0],
  args: Parameters<typeof realComposeStorageCommand>[1], clock?: Parameters<typeof realComposeStorageCommand>[2],
  repoRoot: string = process.cwd()) {
  const profile = findProfileFixtureInWorkspace(repoRoot);
  return realComposeStorageCommand(isolation,args,clock,repoRoot,profile ?? syntheticStateRoot(resolve(repoRoot,isolation.stateRoot)));
}

export function createCredentialStore(options: Omit<Parameters<typeof realCreateCredentialStore>[0],"admission">) {
  const profile = findProfileFixtureAdmission(options.stateRoot);
  return profile === undefined ? realCreateCredentialStore({ ...options, admission: syntheticStateRoot(options.stateRoot) })
    : createBoundProfileCredentialStore(profile, options);
}


export async function composeTestDataCommand(isolation: Parameters<typeof realComposeTestDataCommand>[1],
  args: Parameters<typeof realComposeTestDataCommand>[2], root: Parameters<typeof realComposeTestDataCommand>[3],
  dependencies: Parameters<typeof realComposeTestDataCommand>[4]) {
  return realComposeTestDataCommand(syntheticStateRoot(resolve(root,isolation.stateRoot)),isolation,args,root,dependencies);
}
