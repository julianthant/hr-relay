import { assertOfflineMaintenanceForProcessRoot } from "../admission/installation.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners, retainAuthoritySourceClosure } from "../source-closure.js";
import { type OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { probeRestoreProfileBrowsersClosed, type ProfileBrowserClosure } from "../maintenance/profile-inventory.js";
import { assertProfileRestoreDatabaseBinding } from "./profile-local-databases.js";
import { captureCredentialErasureHead } from "../configuration/credential-store.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";
import type { AuthorityRestoreInput } from "../admission/installation.js";
import { requireSupportedRecoverySchema } from "./recovery-admission.js";
import { validateStorageRelocationRestoreCandidate } from "./relocation-restore-candidate.js";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { type Clock, systemClock } from "../../../rules/time/clock.js";
import { inspectAuthorityBackupReadOnly } from "./backup-inspection.js";
import { AuthorityDatabase } from "./authority-database.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { isCurrentAuthoritySchemaVersion } from "./migrations.js";
import {
  verifyBackupBytesAtPath,
  verifyBackupManifestAtPath,
} from "./backup-service.js";
import {
  OfflineRestoreReportSchema,
  OfflineRestoreRequestSchema,
  type OfflineRestoreReport,
} from "./recovery-contracts.js";

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
  readonly dev: number;
  readonly ino: number;
  readonly byteSize: number;
  readonly sha256: string;
}

function fileIdentity(path: string): FileIdentity {
  const before = statSync(path);
  const bytes = readFileSync(path);
  const after = statSync(path);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== bytes.length
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("restore-file-changed-during-observation");
  return Object.freeze({
    dev: before.dev, ino: before.ino,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
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
  readonly #credentialStore: CredentialStore;

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
    this.#runtimeAdmission.assertExclusive();
    this.#runtimeAdmission.assertProfileRuntime();
    if (credentialStore === undefined) throw new Error("profile-restore-credential-owner-required");
    this.#credentialStore = credentialStore;
    this.#runtimeAdmission.assertAuthorityDatabase(resolve(options.authorityPath));
    this.#runtimeAdmission.assertStateRoot(resolve(options.suspectDirectory));
    this.#authorityPath = resolve(options.authorityPath);
    this.#suspectDirectory = resolve(options.suspectDirectory);
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#projectionRebuild = projectionRebuild;
    this.#clock = clock;
    this.#fileOperations = fileOperations;
    this.#processLockRoot = resolve(options.processLockRoot);

  }

  async restore(input: unknown, operation: OfflineMaintenanceOperation): Promise<OfflineRestoreReport> {
    this.#runtimeAdmission.assertOfflineMaintenance(operation);
    operation.consume();
    let report: OfflineRestoreReport | undefined, primary: Error | undefined;
    try { report = await this.#restoreHeld(input, operation); }
    catch (error) {
      primary = error instanceof Error ? error : new OfflineRestoreFailure(report === undefined ? "unchanged" : "replaced",
        "offline authority restore failed", error);
    }
    if (primary !== undefined && hasUnprovedSourceClosure(primary)) {
      retainUnprovedSourceOwners(primary, { admission: this.#runtimeAdmission, restore: operation });
      throw primary;
    }
    try { operation.release(); }
    catch (error) {
      throw new OfflineRestoreFailure(primary instanceof OfflineRestoreFailure ? primary.authorityState : report === undefined ? "unchanged" : "replaced",
        "offline authority restore exclusive operation release failed",
        retainAuthoritySourceClosure(primary === undefined ? [error] : [primary, error], { admission: this.#runtimeAdmission, restore: operation }));
    }
    if (primary !== undefined) throw primary;
    if (report === undefined) throw new Error("offline authority restore produced no report");
    return report;
  }

  async #restoreHeld(input: unknown, restoreAdmission: OfflineMaintenanceOperation): Promise<OfflineRestoreReport> {
    this.#runtimeAdmission.assertExclusive();
    this.#runtimeAdmission.assertOfflineMaintenance(restoreAdmission);
    assertOfflineMaintenanceForProcessRoot(restoreAdmission, this.#processLockRoot);
    const request = OfflineRestoreRequestSchema.parse(input);
    const profile = this.#runtimeAdmission.captureProfileRestore(captureCredentialErasureHead(this.#credentialStore));
    assertProfileRestoreDatabaseBinding(this.#authorityPath, profile.binding);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(this.#authorityPath);
    if (!existsSync(this.#authorityPath) || statSync(this.#authorityPath).size === 0) {
      throw new Error(`suspect authority database ${this.#authorityPath} is missing or empty`);
    }

    const verified = await verifyBackupManifestAtPath(this.#runtimeAdmission,request.manifestPath, sourceDatabaseIdentity);
    requireSupportedRecoverySchema(verified.manifest.schemaVersion);
    if (verified.manifest.installationId !== profile.binding.installationId || verified.manifest.profileId !== profile.binding.profileId) throw new Error("profile-restore-backup-binding-mismatch");
    validateStorageRelocationRestoreCandidate({ admission: this.#runtimeAdmission,
      activeAuthorityPath: this.#authorityPath, verifiedBackup: verified });
    let authorityState: OfflineRestoreAuthorityState = "unchanged";
    let restoreReport: OfflineRestoreReport | undefined;
    let restoreError: OfflineRestoreFailure | undefined;
    try {
      restoreReport = await (async (): Promise<OfflineRestoreReport> => {
        this.#runtimeAdmission.assertOfflineMaintenance(restoreAdmission);
        await probeRestoreProfileBrowsersClosed(this.#runtimeAdmission, this.#processLockRoot, restoreAdmission, this.#clock, this.#browserClosure);
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
          stagedAdmission = this.#runtimeAdmission.stoppedStagedAuthority(stagedPath);
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

          (this.#fileOperations.syncPath ?? fsyncPath)(stagedPath);
          const liveIdentityBeforeReplace = fileIdentity(this.#authorityPath);
          const stagedIdentityBeforeReplace = fileIdentity(stagedPath);
          restoreBinding = {
            operationId: token, profile, authorityPath: this.#authorityPath, stagedPath, suspectPath,
            manifestPath: verified.manifestPath, manifestSha256: fileIdentity(verified.manifestPath).sha256,
            backupPath: verified.backupPath, backupSha256: verified.manifest.sha256,
            sourceDatabaseIdentity, authorityGeneration: afterProjection.authorityGeneration,
            authorityContentFingerprint: afterProjection.authorityContentFingerprint,
            live: liveIdentityBeforeReplace, staged: stagedIdentityBeforeReplace, suspect: fileIdentity(suspectPath),
            companions: (["-wal", "-shm"] as const).filter(suffix => existsSync(`${this.#authorityPath}${suffix}`))
              .map(suffix => ({ suffix, binding: fileIdentity(`${this.#authorityPath}${suffix}`), suspect: fileIdentity(`${suspectPath}${suffix}`) })),
          };
          this.#runtimeAdmission.beginAuthorityRestore(restoreBinding, restoreAdmission);
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
            this.#runtimeAdmission.assertAuthorityRestoreCurrent(restoreBinding, restoreAdmission);
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
        stagedAdmission?.release();
        if (restoreJournalHeld && restoreBinding !== undefined && (authorityState === "unchanged" || authorityState === "replaced")) {
          try {
            this.#runtimeAdmission.settleAuthorityRestore(restoreBinding, authorityState, () => {
              const actual = inspectAuthorityBackupReadOnly(this.#runtimeAdmission, this.#authorityPath,
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

/** Recovery acknowledges an exact observed outcome; it never retries the replacement. */
export async function settleInterruptedAuthorityRestore(input: Readonly<{
  admission: RuntimeAdmission; operationId: string; manifestPath: string; outcome: "unchanged" | "replaced";
  processLockRoot: string;
  restoreAdmission: OfflineMaintenanceOperation; clock?: Clock;
}>): Promise<Readonly<{ state: "settled"; operationId: string; outcome: "unchanged" | "replaced" }>> {
  const admission = requireRuntimeAdmission(input.admission);
  admission.assertExclusive();
  admission.assertOfflineMaintenance(input.restoreAdmission);
  input.restoreAdmission.consume();
  assertOfflineMaintenanceForProcessRoot(input.restoreAdmission, input.processLockRoot);
  const binding = admission.readAuthorityRestore(input.operationId);
  if (resolve(input.manifestPath) !== binding.manifestPath) throw new Error("restore-recovery-manifest-binding-mismatch");
  const verified = await verifyBackupManifestAtPath(admission, binding.manifestPath, binding.sourceDatabaseIdentity);
  if (verified.backupPath !== binding.backupPath || verified.manifest.sha256 !== binding.backupSha256
    || verified.manifest.authorityGeneration !== binding.authorityGeneration
    || verified.manifest.authorityContentFingerprint !== binding.authorityContentFingerprint) {
    throw new Error("restore-recovery-backup-authority-binding-mismatch");
  }
  validateStorageRelocationRestoreCandidate({ admission, activeAuthorityPath: binding.authorityPath, verifiedBackup: verified });
  admission.settleAuthorityRestore(binding, input.outcome, () => {
    const actual = inspectAuthorityBackupReadOnly(admission, binding.authorityPath, verified.manifest.schemaVersion);
    return { authorityGeneration: actual.authorityGeneration, authorityContentFingerprint: actual.authorityContentFingerprint };
  }, input.restoreAdmission);
  return Object.freeze({ state: "settled", operationId: binding.operationId, outcome: input.outcome });
}
