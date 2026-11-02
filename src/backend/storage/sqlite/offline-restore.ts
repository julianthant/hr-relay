import { resolveConfigWithProvenance } from "../../app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { randomUUID } from "node:crypto";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import type { AuthorityRestoreInput } from "../admission/installation.js";
import { type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { assertOfflineMaintenanceForProcessRoot } from "../admission/process-root.js";
import { assertCredentialStoreOwner } from "../configuration/credential-store.js";
import { probeAutomaticRestoreBrowsersClosed,probeRestoreProfileBrowsersClosed,probeRetainedBrowsersClosed,restoreBrowserMembershipDigest,type ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { file, hash } from "../maintenance/existing-data-backup-files.js";
import { restoreRetainedFilesDigest, assertRestoreRootMembership } from "../maintenance/automatic-restore-files.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { assertProfileRestoreDatabaseBinding } from "./profile-local-databases.js";

import { chmodSync,closeSync,copyFileSync,existsSync,fsyncSync,mkdirSync,openSync,renameSync,rmSync,readdirSync,statSync } from "node:fs";
import { basename,dirname,join,resolve } from "node:path";
import { z } from "zod";

import { systemClock,type Clock } from "../../../rules/time/clock.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";

import { AuthorityDatabase } from "./authority-database.js";
import { inspectAuthorityBackupReadOnly } from "./backup-inspection.js";
import { parseBackupManifestFile,verifyBackupBytesAtPath,verifyBackupManifestAtPath } from "./backup-service.js";
import { withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { assertRestorePreservesWriteFences, readRestoreWriteFences, restoreWriteFenceDigest } from "./restore-write-fences.js";
import { isCurrentAuthoritySchemaVersion } from "./migrations.js";

import { OfflineRestoreReportSchema,OfflineRestoreRequestSchema,type OfflineRestoreReport } from "./recovery-contracts.js";
import { assertRestoreRuntimePaths,validateSamePersonRestoreCandidate } from "./same-person-restore-candidate.js";

export const OfflineRestoreOptionsSchema = z.strictObject({
  authorityPath: z.string().min(1),
  suspectDirectory: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  processLockRoot: z.string().min(1),
});

export interface OfflineRestoreFileOperations {
  copyFile(source: string, destination: string): void;
  atomicReplace(source: string, destination: string): void;
  /** File-system boundary used for reversible companion displacement and rollback. */
  readonly renamePath?: (source: string, destination: string) => void;
  /** File-system boundary used only after restored bytes are durable elsewhere. */
  readonly removePath?: (path: string) => void;
  /** Test seam for post-swap durability failures; production uses fsync. */
  readonly syncPath?: (path: string) => void;
}

export type OfflineRestoreAuthorityState =
  | "unchanged"
  | "companion-state-uncertain"
  | "authority-state-uncertain"
  | "replaced";

export class OfflineRestoreFailure extends Error {
  readonly authorityState: OfflineRestoreAuthorityState;

  constructor(authorityState: OfflineRestoreAuthorityState, message: string, cause: unknown) {
    super(`${message}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "OfflineRestoreFailure";
    this.authorityState = authorityState;
  }
}


const DEFAULT_FILE_OPERATIONS: OfflineRestoreFileOperations = Object.freeze({
  copyFile: copyFileSync,
  atomicReplace: renameSync,
  renamePath: renameSync,
  removePath: rmSync,
});

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function copyAndSync(
  source: string,
  destination: string,
  fileOperations: OfflineRestoreFileOperations,
): void {
  fileOperations.copyFile(source, destination);
  chmodSync(destination, 0o600);
  (fileOperations.syncPath ?? fsyncPath)(destination);
}

interface DisplacedCompanion {
  readonly livePath: string;
  readonly displacedPath: string;
}

function rollbackDisplacedCompanions(
  displaced: readonly DisplacedCompanion[],
  authorityDirectory: string,
  fileOperations: OfflineRestoreFileOperations,
): readonly unknown[] {
  const failures: unknown[] = [];
  for (const companion of displaced.toReversed()) {
    try {
      (fileOperations.renamePath ?? renameSync)(companion.displacedPath, companion.livePath);
      (fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
    } catch (error) {
      failures.push(error);
    }
  }
  return Object.freeze(failures);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeError(error: unknown, context: string): Error {
  return error instanceof Error ? error : new Error(`${context}: ${String(error)}`, { cause: error });
}

interface FileIdentity {
  readonly byteSize: number;
  readonly sha256: string;
}

function fileIdentity(path: string): FileIdentity {
  const { bytes } = file(path, "managed data");
  return Object.freeze({
    byteSize: bytes.byteLength,
    sha256: hash(bytes),
  });
}

function fileIdentityEquals(left: FileIdentity, right: FileIdentity): boolean {
  return left.byteSize === right.byteSize && left.sha256 === right.sha256;
}

type AuthorityReplaceReconciliation =
  | Readonly<{ state: "unchanged" | "replaced"; observationFailures: readonly unknown[] }>
  | Readonly<{ state: "uncertain"; observationFailures: readonly unknown[] }>;

function reconcileAuthorityReplaceError(
  stagedPath: string,
  authorityPath: string,
  stagedIdentityBefore: FileIdentity,
  liveIdentityBefore: FileIdentity,
): AuthorityReplaceReconciliation {
  try {
    const stagedExists = existsSync(stagedPath);
    const authorityExists = existsSync(authorityPath);
    if (!stagedExists && authorityExists) {
      return Object.freeze({
        state: fileIdentityEquals(fileIdentity(authorityPath), stagedIdentityBefore)
          ? "replaced"
          : "uncertain",
        observationFailures: Object.freeze([]),
      });
    }
    if (stagedExists && authorityExists
      && !fileIdentityEquals(stagedIdentityBefore, liveIdentityBefore)
      && fileIdentityEquals(fileIdentity(authorityPath), liveIdentityBefore)) {
      return Object.freeze({ state: "unchanged", observationFailures: Object.freeze([]) });
    }
    return Object.freeze({ state: "uncertain", observationFailures: Object.freeze([]) });
  } catch (error) {
    return Object.freeze({ state: "uncertain", observationFailures: Object.freeze([error]) });
  }
}

function cleanupStagedPaths(
  paths: readonly string[],
  fileOperations: OfflineRestoreFileOperations,
): readonly Error[] {
  const failures: Error[] = [];
  for (const path of paths) {
    try {
      if (existsSync(path)) (fileOperations.removePath ?? rmSync)(path);
    } catch (error) {
      failures.push(new Error(
        `staged restore cleanup failed for ${path}: ${errorMessage(error)}`,
        { cause: error },
      ));
    }
  }
  return Object.freeze(failures);
}

function restoreCandidateConfig(admission: RuntimeAdmission, facts: ReturnType<typeof AuthorityDatabase.readRestoreCandidateInventory>, clock: Clock) {
  const settings = facts.settingsAuthority.state === "never-initialized" ? undefined : facts.settingsAuthority.record;
  const active = settings?.active;
  const snapshot = active == null ? undefined : facts.configSnapshots.find(row => row.configSnapshotId === active.configSnapshotId);
  if (active != null && (snapshot === undefined || snapshot.fingerprint !== active.configFingerprint)
    || active == null && facts.configSnapshots.length !== 0) throw new Error("restore-candidate-active-settings-unavailable");
  const saved = settings?.saved?.settings ?? settings?.initialization.settings.settings ?? initialSettingsFileRecord().settings;
  const config = snapshot?.config ?? resolveConfigWithProvenance(saved, { primaryDisplay: null }, clock,
    { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config;
  const savedBrowserRoot = saved.paths?.browserProfileRoot;
  assertRestoreRuntimePaths({ stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot, activePaths: config.paths,
    ...(savedBrowserRoot === undefined ? {} : { savedBrowserRoot }) });
  return config;
}

export class OfflineAuthorityRestoreService {
  readonly #browserClosure: ProfileBrowserClosure;
  readonly #runtimeAdmission: RuntimeAdmission;
  #authorityPath: string;
  #suspectDirectory: string;
  #busyTimeoutMs: number;
  #projectionRebuild: (stagedAuthorityPath: string, restoreAdmission: OfflineMaintenanceOperation) => Promise<void>;
  #clock: Clock;
  #fileOperations: OfflineRestoreFileOperations;
  #processLockRoot: string;

  constructor(
    browserClosure: ProfileBrowserClosure,
    runtimeAdmissionInput: RuntimeAdmission,
    input: unknown,
    projectionRebuild: (stagedAuthorityPath: string, restoreAdmission: OfflineMaintenanceOperation) => Promise<void>,
    clock: Clock = systemClock,
    fileOperations: OfflineRestoreFileOperations = DEFAULT_FILE_OPERATIONS,
    credentialStore?: CredentialStore,
  ) {
    this.#browserClosure = browserClosure;
    const options = OfflineRestoreOptionsSchema.parse(input);
    this.#runtimeAdmission = requireRuntimeAdmission(runtimeAdmissionInput);
    this.#runtimeAdmission.assertProfileRestoreOwner(resolve(options.authorityPath));
    if (credentialStore === undefined) throw new Error("profile-restore-credential-owner-required");
    assertCredentialStoreOwner(credentialStore, this.#runtimeAdmission);
    this.#runtimeAdmission.assertStateRoot(resolve(options.suspectDirectory));
    this.#authorityPath = resolve(options.authorityPath);
    this.#suspectDirectory = resolve(options.suspectDirectory);
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#projectionRebuild = projectionRebuild;
    this.#clock = clock;
    this.#fileOperations = fileOperations;
    this.#processLockRoot = resolve(options.processLockRoot);

  }

  async restoreNewest(operation: OfflineMaintenanceOperation): Promise<OfflineRestoreReport> {
    this.#runtimeAdmission.assertOfflineMaintenance(operation);
    const admission = this.#runtimeAdmission.forStoppedMaintenance(operation);
    let primary: { error: unknown } | undefined, report: OfflineRestoreReport | undefined;
    try {
      admission.captureProfileRestore(operation);
      const directory = join(admission.stateRoot, "backups", "authority"); admission.assertStateRoot(directory);
      const originalFences = withReadonlyAuthoritySnapshot(this.#authorityPath, readRestoreWriteFences);
      const rejected: unknown[] = [], candidates: Array<{ path: string; createdAt: string }> = [];
      if (!existsSync(directory)) throw new Error("automatic-repair-backup-missing");
      for (const name of readdirSync(directory).filter(name => name.endsWith(".manifest.json")).sort()) {
        const path = join(directory, name);
        try {
          const manifest = parseBackupManifestFile(path);
          if (manifest.installationId !== admission.profileBinding.installationId || manifest.profileId !== admission.profileBinding.profileId
            || ![8, 9, 10, 11, 12].includes(manifest.schemaVersion) || Date.parse(manifest.createdAt) > this.#clock.nowMs()) {
            rejected.push(new Error("automatic-repair-backup-identity-version-or-time-invalid")); continue;
          }
          const verified = await verifyBackupManifestAtPath(admission, path);
          assertRestorePreservesWriteFences(originalFences, withReadonlyAuthoritySnapshot(verified.backupPath, readRestoreWriteFences));
          const copy = admission.verifiedReadOnlyCopy(verified.backupPath, verified.manifest.sha256);
          let candidateFailure: { error: unknown } | undefined;
          try { restoreCandidateConfig(admission, AuthorityDatabase.readRestoreCandidateInventory(admission, copy, verified.backupPath, operation), this.#clock); }
          catch (error) { candidateFailure = { error }; }
          if (candidateFailure !== undefined && hasUnprovedSourceClosure(candidateFailure.error)) throw retainAuthoritySourceClosure([candidateFailure.error], { admission: { admission, copy }, restore: operation });
          copy.release(); if (candidateFailure !== undefined) throw candidateFailure.error;
          candidates.push({ path, createdAt: manifest.createdAt });
        } catch (error) {
          if (hasUnprovedSourceClosure(error)) throw error;
          rejected.push(error);
        }
      }
      candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.path.localeCompare(left.path));
      const newest = candidates[0];
      if (newest === undefined) throw new AggregateError(rejected, "automatic-repair-verified-backup-missing");
      report = await this.restore({ manifestPath: newest.path }, operation);
    } catch (error) { primary = { error }; }
    if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) {
      this.#runtimeAdmission.retainSourceClosure(primary.error);
      throw retainAuthoritySourceClosure([primary.error], { admission: { admission, owner: this.#runtimeAdmission }, restore: operation });
    }
    try { if (admission !== this.#runtimeAdmission) admission.release(); operation.release(); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { admission, restore: operation }); }
    if (primary !== undefined) throw primary.error;
    if (report === undefined) throw new Error("automatic-restore-result-missing");
    return report;
  }

  async restore(input: unknown, operation: OfflineMaintenanceOperation): Promise<OfflineRestoreReport> {
    this.#runtimeAdmission.assertOfflineMaintenance(operation);
    operation.consume();
    let report: OfflineRestoreReport | undefined, primary: Error | undefined;
    let stopped: RuntimeAdmission | undefined;
    try {
      stopped = this.#runtimeAdmission.forStoppedMaintenance(operation);
      report = await this.#restoreHeld(input, operation, stopped);
    }
    catch (error) {
      primary = error instanceof Error ? error : new OfflineRestoreFailure(report === undefined ? "unchanged" : "replaced",
        "offline authority restore failed", error);
    }
    if (primary !== undefined && hasUnprovedSourceClosure(primary)) {
      retainUnprovedSourceOwners(primary, { admission: stopped ?? this.#runtimeAdmission, restore: operation });
      throw primary;
    }
    try { if (stopped !== this.#runtimeAdmission) stopped?.release(); operation.release(); }
    catch (error) {
      throw new OfflineRestoreFailure(primary instanceof OfflineRestoreFailure ? primary.authorityState : report === undefined ? "unchanged" : "replaced",
        "offline authority restore exclusive operation release failed",
        retainAuthoritySourceClosure(primary === undefined ? [error] : [primary, error], { admission: this.#runtimeAdmission, restore: operation }));
    }
    if (primary !== undefined) throw primary;
    if (report === undefined) throw new Error("offline authority restore produced no report");
    return report;
  }

  async #restoreHeld(input: unknown, restoreAdmission: OfflineMaintenanceOperation, admission: RuntimeAdmission): Promise<OfflineRestoreReport> {
    admission.assertExclusive();
    admission.assertOfflineMaintenance(restoreAdmission);
    assertOfflineMaintenanceForProcessRoot(restoreAdmission, this.#processLockRoot);
    const request = OfflineRestoreRequestSchema.parse(input);
    const profile = admission.captureProfileRestore(restoreAdmission);
    assertProfileRestoreDatabaseBinding(this.#authorityPath, profile.binding);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource());
    const originalFences = withReadonlyAuthoritySnapshot(this.#authorityPath, readRestoreWriteFences);
    if (!existsSync(this.#authorityPath) || statSync(this.#authorityPath).size === 0) {
      throw new Error(`suspect authority database ${this.#authorityPath} is missing or empty`);
    }

    const verified = await verifyBackupManifestAtPath(admission,request.manifestPath);
    if (![8, 9, 10, 11, 12].includes(verified.manifest.schemaVersion)) throw new Error("automatic-restore-backup-schema-unsupported");
    if (verified.manifest.installationId !== profile.binding.installationId || verified.manifest.profileId !== profile.binding.profileId) throw new Error("profile-restore-backup-binding-mismatch");
    validateSamePersonRestoreCandidate({ admission: admission,
      activeAuthorityPath: this.#authorityPath, verifiedBackup: verified });
    let authorityState: OfflineRestoreAuthorityState = "unchanged";
    let restoreReport: OfflineRestoreReport | undefined;
    let restoreError: OfflineRestoreFailure | undefined;
    try {
      restoreReport = await (async (): Promise<OfflineRestoreReport> => {
        admission.assertOfflineMaintenance(restoreAdmission);
        await probeRestoreProfileBrowsersClosed(admission, this.#processLockRoot, restoreAdmission, this.#clock, this.#browserClosure);
        mkdirSync(this.#suspectDirectory, { recursive: true, mode: 0o700 });
        const token = randomUUID();
        const compactTime = this.#clock.now().toISOString().replaceAll(/[^0-9]/g, "");
        const suspectFileName = `suspect-${compactTime}-${token}.sqlite`;
        const suspectPath = join(this.#suspectDirectory, suspectFileName);
        copyAndSync(this.#authorityPath, suspectPath, this.#fileOperations);
        for (const suffix of ["-wal", "-shm"] as const) {
          const companion = `${this.#authorityPath}${suffix}`;
          if (existsSync(companion)) copyAndSync(companion, `${suspectPath}${suffix}`, this.#fileOperations);
        }
        (this.#fileOperations.syncPath ?? fsyncPath)(this.#suspectDirectory);

        const authorityDirectory = dirname(this.#authorityPath);
        const stagedPath = join(authorityDirectory, `.restore-${token}.sqlite.tmp`);
        let stagedReport: OfflineRestoreReport | undefined;
        let stagedPrimaryError: Error | undefined;
        let stagedAdmission: RuntimeAdmission | undefined;
        let restoreBinding: AuthorityRestoreInput | undefined;
        let restoreJournalHeld = false;
        let restoreJournalSettled = false;
        try {
          copyAndSync(verified.backupPath, stagedPath, this.#fileOperations);
          await verifyBackupBytesAtPath(
            stagedPath,
            verified.manifest,
            `staged restore ${basename(stagedPath)}`,
          );
          stagedAdmission = admission.stoppedStagedAuthority(stagedPath);
          const beforeProjection = inspectAuthorityBackupReadOnly(
            stagedAdmission,
            stagedPath,
            verified.manifest.schemaVersion,
            this.#busyTimeoutMs,
          );
          if (beforeProjection.authorityContentFingerprint
            !== verified.manifest.authorityContentFingerprint
            || beforeProjection.authorityGeneration !== verified.manifest.authorityGeneration) {
            throw new Error(
              `staged restore ${basename(stagedPath)} does not match verified backup authority`,
            );
          }

          const candidate = AuthorityDatabase.readRestoreCandidateInventory(admission, stagedAdmission, stagedPath, restoreAdmission);
          const config = restoreCandidateConfig(admission, candidate, this.#clock);
          await probeRetainedBrowsersClosed({ admission, custody: candidate, config, browserClosure: this.#browserClosure, clock: this.#clock, signal: new AbortController().signal });
          let projectionRebuilt = false;
          let afterProjection = beforeProjection;
          if (isCurrentAuthoritySchemaVersion(verified.manifest.schemaVersion)) {
            await this.#projectionRebuild(stagedPath, restoreAdmission);
            afterProjection = inspectAuthorityBackupReadOnly(
              stagedAdmission,
              stagedPath,
              verified.manifest.schemaVersion,
              this.#busyTimeoutMs,
            );
            projectionRebuilt = true;
          }
          if (afterProjection.authorityContentFingerprint
            !== beforeProjection.authorityContentFingerprint
            || afterProjection.authorityGeneration !== beforeProjection.authorityGeneration) {
            throw new Error("projection rebuild mutated non-rebuildable authority state");
          }

          const restoredFences = withReadonlyAuthoritySnapshot(stagedPath, readRestoreWriteFences);
          assertRestorePreservesWriteFences(originalFences, restoredFences);
          if (restoreWriteFenceDigest(withReadonlyAuthoritySnapshot(this.#authorityPath, readRestoreWriteFences)) !== restoreWriteFenceDigest(originalFences)) throw new Error("restore-write-fences-changed");
          (this.#fileOperations.syncPath ?? fsyncPath)(stagedPath);
          const liveIdentityBeforeReplace = fileIdentity(this.#authorityPath);
          const stagedIdentityBeforeReplace = fileIdentity(stagedPath);
          restoreBinding = {
            operationId: token, profile, authorityPath: this.#authorityPath, stagedPath, suspectPath,
            manifestPath: verified.manifestPath, manifestSha256: fileIdentity(verified.manifestPath).sha256,
            backupPath: verified.backupPath, backupSha256: verified.manifest.sha256,
            sourceDatabaseIdentity, authorityGeneration: afterProjection.authorityGeneration,
            authorityContentFingerprint: afterProjection.authorityContentFingerprint,
            browserMembershipDigest: restoreBrowserMembershipDigest(admission), retainedFilesDigest: restoreRetainedFilesDigest(admission.stateRoot), unresolvedWriteDigest: restoreWriteFenceDigest(originalFences), backupTime: verified.manifest.createdAt, restoredAt: this.#clock.now().toISOString(),
            live: liveIdentityBeforeReplace, staged: stagedIdentityBeforeReplace, suspect: fileIdentity(suspectPath),
            companions: (["-wal", "-shm"] as const).filter(suffix => existsSync(`${this.#authorityPath}${suffix}`))
              .map(suffix => ({ suffix, binding: fileIdentity(`${this.#authorityPath}${suffix}`), suspect: fileIdentity(`${suspectPath}${suffix}`) })),
          };
          admission.beginAuthorityRestore(restoreBinding, restoreAdmission);
          restoreJournalHeld = true;
          const displacedCompanions: DisplacedCompanion[] = [];
          let authorityReplaced = false;
          let replacementAttempted = false;
          let replacementError: Error | undefined;
          let replacementReconciliation: AuthorityReplaceReconciliation | undefined;
          try {
            for (const suffix of ["-wal", "-shm"] as const) {
              const companion = `${this.#authorityPath}${suffix}`;
              if (!existsSync(companion)) continue;
              const displacedPath = `${stagedPath}${suffix}.live-companion`;
              try {
                (this.#fileOperations.renamePath ?? renameSync)(companion, displacedPath);
              } catch (error) {
                const liveExists = existsSync(companion);
                const displacedExists = existsSync(displacedPath);
                if (!liveExists && displacedExists) {
                  displacedCompanions.push({ livePath: companion, displacedPath });
                } else if (liveExists === displacedExists) {
                  authorityState = "companion-state-uncertain";
                  throw new AggregateError(
                    [error],
                    `companion rename failed and filesystem outcome is uncertain for source `
                    + `${companion} and destination ${displacedPath}`,
                    { cause: error },
                  );
                }
                throw error;
              }
              displacedCompanions.push({ livePath: companion, displacedPath });
            }
            (this.#fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
            admission.assertAuthorityRestoreCurrent(restoreBinding, restoreAdmission);
            if (restoreBrowserMembershipDigest(admission) !== restoreBinding.browserMembershipDigest) throw new Error("restore-browser-membership-changed");
            replacementAttempted = true;
            this.#fileOperations.atomicReplace(stagedPath, this.#authorityPath);
            authorityReplaced = true;
            authorityState = "replaced";
          } catch (error) {
            replacementError = normalizeError(error, "atomic authority replacement failed");
            replacementReconciliation = replacementAttempted
              ? reconcileAuthorityReplaceError(
                  stagedPath,
                  this.#authorityPath,
                  stagedIdentityBeforeReplace,
                  liveIdentityBeforeReplace,
                )
              : Object.freeze({
                  state: "unchanged" as const,
                  observationFailures: Object.freeze([]),
                });
          }
          if (replacementError !== undefined) {
            if (replacementReconciliation === undefined) {
              throw new Error("atomic authority replacement failed without reconciliation", {
                cause: replacementError,
              });
            }
            if (replacementReconciliation.state === "replaced") {
              authorityReplaced = true;
              authorityState = "replaced";
            } else if (replacementReconciliation.state === "uncertain") {
              authorityState = "authority-state-uncertain";
            }
            if (authorityState === "authority-state-uncertain") {
              throw new AggregateError(
                [replacementError, ...replacementReconciliation.observationFailures],
                `atomic authority replacement failed and filesystem outcome is uncertain for source `
                + `${stagedPath} and destination ${this.#authorityPath}`,
                { cause: replacementError },
              );
            }
            if (!authorityReplaced) {
              const rollbackFailures = rollbackDisplacedCompanions(
                displacedCompanions,
                authorityDirectory,
                this.#fileOperations,
              );
              if (rollbackFailures.length > 0) {
                authorityState = "companion-state-uncertain";
                const rollbackSummary = rollbackFailures.map(errorMessage).join("; ");
                throw new AggregateError(
                  [replacementError, ...rollbackFailures],
                  `authority replacement failed (${errorMessage(replacementError)}); live SQLite companion rollback `
                  + `was not proven (${rollbackSummary})`,
                  { cause: replacementError },
                );
              }
            }
            if (!authorityReplaced) throw replacementError;
          }
          let companionCleanupError: Error | undefined;
          try {
            for (const companion of displacedCompanions) {
              (this.#fileOperations.removePath ?? rmSync)(companion.displacedPath);
            }
            (this.#fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
          } catch (cleanupError) {
            companionCleanupError = normalizeError(cleanupError, "post-replacement companion cleanup failed");
          }
          if (companionCleanupError !== undefined) {
            if (replacementError === undefined) throw companionCleanupError;
            throw new AggregateError(
              [replacementError, companionCleanupError],
              "atomic authority replacement failed after taking effect and companion cleanup also failed",
              { cause: replacementError },
            );
          }
          if (replacementError !== undefined) throw replacementError;
          stagedReport = OfflineRestoreReportSchema.parse({
            state: "restored",
            restoredAt: this.#clock.now().toISOString(),
            manifestFileName: basename(verified.manifestPath),
            backupFileName: verified.manifest.backupFileName,
            suspectFileName,
            sourceDatabaseIdentity,
            schemaVersion: afterProjection.schemaVersion,
            authorityGeneration: afterProjection.authorityGeneration,
            projectionRebuilt,
            authorityPreservedAcrossProjectionRebuild: true,
          });
        } catch (error) {
          stagedPrimaryError = normalizeError(error, "offline authority restore failed");
        }
        if (stagedPrimaryError !== undefined && hasUnprovedSourceClosure(stagedPrimaryError)) {
          admission.retainSourceClosure(stagedPrimaryError);
          throw retainAuthoritySourceClosure([stagedPrimaryError], { admission: { admission, stagedAdmission }, restore: restoreAdmission });
        }
        stagedAdmission?.release();
        if (restoreJournalHeld && restoreBinding !== undefined && authorityState === "replaced" && stagedPrimaryError === undefined) {
          try {
            admission.settleAuthorityRestore(restoreBinding, () => {
              const actual = inspectAuthorityBackupReadOnly(admission, this.#authorityPath,
                verified.manifest.schemaVersion, this.#busyTimeoutMs);
              return { authorityGeneration: actual.authorityGeneration,
                authorityContentFingerprint: actual.authorityContentFingerprint };
            }, restoreAdmission);
            restoreJournalSettled = true;
          } catch (settlementError) {
            stagedPrimaryError = new AggregateError(stagedPrimaryError === undefined ? [settlementError]
              : [stagedPrimaryError, settlementError], "restore settlement is unproved; durable operation and staging evidence retained");
          }
        }
        const preserveEvidence = restoreJournalHeld && !restoreJournalSettled
          || authorityState === "authority-state-uncertain" || authorityState === "companion-state-uncertain";
        const cleanupFailures = preserveEvidence ? [] : cleanupStagedPaths(
          [stagedPath, `${stagedPath}-wal`, `${stagedPath}-shm`],
          this.#fileOperations,
        );
        if (cleanupFailures.length > 0) {
          const firstCleanupFailure = cleanupFailures[0];
          if (firstCleanupFailure === undefined) {
            throw new Error("staged cleanup reported failures without an error");
          }
          const cleanupSummary = cleanupFailures.map(errorMessage).join("; ");
          if (stagedPrimaryError !== undefined) {
            throw new AggregateError(
              [stagedPrimaryError, ...cleanupFailures],
              `offline authority restore failed (${errorMessage(stagedPrimaryError)}) and `
              + `staged cleanup also failed (${cleanupSummary})`,
              { cause: stagedPrimaryError },
            );
          }
          throw new AggregateError(
            cleanupFailures,
            `offline authority restore staged cleanup failed (${cleanupSummary})`,
            { cause: firstCleanupFailure },
          );
        }
        if (stagedPrimaryError !== undefined) throw stagedPrimaryError;
        if (stagedReport === undefined) throw new Error("offline authority restore produced no staged report");
        return stagedReport;
      })();
    } catch (error) {
      restoreError = error instanceof OfflineRestoreFailure
        ? error
        : new OfflineRestoreFailure(authorityState, "offline authority restore failed", error);
    }
    if (restoreError !== undefined) throw restoreError;
    if (restoreReport === undefined) throw new Error("offline authority restore produced no report");
    return restoreReport;
  }
}

export async function resumeAutomaticAuthorityRestore(input: Readonly<{
  admission: RuntimeAdmission; operationId: string; processLockRoot: string; restoreAdmission: OfflineMaintenanceOperation; browserClosure: ProfileBrowserClosure; clock?: Clock;
}>): Promise<Readonly<{ state: "settled"; operationId: string; outcome: "replaced" }>> {
  const admission = requireRuntimeAdmission(input.admission), operation = input.restoreAdmission;
  admission.assertExclusive(); admission.assertOfflineMaintenance(operation); operation.consume();
  assertOfflineMaintenanceForProcessRoot(operation, input.processLockRoot);
  const binding = admission.readAuthorityRestore(input.operationId);
  assertRestoreRootMembership(admission.stateRoot, binding.operationId);
  if (restoreRetainedFilesDigest(admission.stateRoot) !== binding.retainedFilesDigest) throw new Error("restore-retained-files-changed");
  await probeAutomaticRestoreBrowsersClosed(admission, input.processLockRoot, operation, input.clock ?? systemClock, input.browserClosure);
  if (restoreBrowserMembershipDigest(admission) !== binding.browserMembershipDigest) throw new Error("restore-browser-membership-changed");
  const verified = await verifyBackupManifestAtPath(admission, binding.manifestPath);
  if (verified.backupPath !== binding.backupPath || verified.manifest.sourceDatabaseIdentity !== binding.sourceDatabaseIdentity
    || verified.manifest.sha256 !== binding.backupSha256 || verified.manifest.createdAt !== binding.backupTime
    || fileIdentity(binding.manifestPath).sha256 !== binding.manifestSha256
    || verified.manifest.authorityGeneration !== binding.authorityGeneration
    || verified.manifest.authorityContentFingerprint !== binding.authorityContentFingerprint) throw new Error("restore-recovery-backup-authority-binding-mismatch");
  const same = (path: string, expected: FileIdentity) => {
    if (!fileIdentityEquals(fileIdentity(path), expected)) throw new Error("restore-recovery-file-changed");
  };
  same(binding.suspectPath, binding.suspect);
  const original = withReadonlyAuthoritySnapshot(binding.suspectPath, readRestoreWriteFences);
  if (restoreWriteFenceDigest(original) !== binding.unresolvedWriteDigest) throw new Error("restore-recovery-write-fences-changed");
  const stagePresent = existsSync(binding.stagedPath);
  if (stagePresent) {
    same(binding.authorityPath, binding.live); same(binding.stagedPath, binding.staged);
    assertRestorePreservesWriteFences(original, withReadonlyAuthoritySnapshot(binding.stagedPath, readRestoreWriteFences));
  } else same(binding.authorityPath, binding.staged);
  for (const suffix of ["-wal", "-shm"] as const) {
    const row = binding.companions.find(value => value.suffix === suffix), live = `${binding.authorityPath}${suffix}`,
      displaced = `${binding.stagedPath}${suffix}.live-companion`;
    if (row === undefined) { if (existsSync(live) || existsSync(displaced) || existsSync(`${binding.suspectPath}${suffix}`)) throw new Error("restore-recovery-companion-unowned"); continue; }
    same(`${binding.suspectPath}${suffix}`, row.suspect);
    if (stagePresent) {
      if (existsSync(live) === existsSync(displaced)) throw new Error("restore-recovery-companion-outcome-unproved");
      same(existsSync(live) ? live : displaced, row.binding);
      if (existsSync(live)) renameSync(live, displaced);
    } else {
      if (existsSync(live)) throw new Error("restore-recovery-live-companion-unowned");
      if (existsSync(displaced)) same(displaced, row.binding);
    }
  }
  fsyncPath(dirname(binding.authorityPath)); admission.assertAuthorityRestoreCurrent(binding, operation);
  if (stagePresent) { renameSync(binding.stagedPath, binding.authorityPath); fsyncPath(dirname(binding.authorityPath)); }
  same(binding.authorityPath, binding.staged);
  assertRestorePreservesWriteFences(original, withReadonlyAuthoritySnapshot(binding.authorityPath, readRestoreWriteFences));
  for (const row of binding.companions) {
    const path = `${binding.stagedPath}${row.suffix}.live-companion`;
    if (existsSync(path)) { same(path, row.binding); rmSync(path); }
  }
  fsyncPath(dirname(binding.authorityPath));
  admission.settleAuthorityRestore(binding, () => {
    const actual = inspectAuthorityBackupReadOnly(admission, binding.authorityPath, verified.manifest.schemaVersion);
    return { authorityGeneration: actual.authorityGeneration, authorityContentFingerprint: actual.authorityContentFingerprint };
  }, operation);
  return Object.freeze({ state: "settled", operationId: binding.operationId, outcome: "replaced" });
}
