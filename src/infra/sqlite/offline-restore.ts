import { requireSupportedRecoverySchema } from "./recovery-admission.js";
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
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { inspectAuthorityBackupReadOnly } from "../compat/backup-inspection.js";
import { AuthorityDatabase } from "./authority-database.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../runtime-control/admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import {
  verifyBackupBytesAtPath,
  verifyBackupManifestAtPath,
} from "./backup-service.js";
import {
  OfflineRestoreReportSchema,
  OfflineRestoreRequestSchema,
  type OfflineRestoreReport,
} from "./recovery-contracts.js";
import { RecoveryStopProofStore } from "./recovery-stop-proof.js";
import {
  acquireRuntimeRestoreAdmission,
  observeRuntimeLockSnapshot,
  type RestoreAdmissionHandle,
} from "./runtime-process-locks.js";

export const OfflineRestoreOptionsSchema = z.strictObject({
  authorityPath: z.string().min(1),
  suspectDirectory: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  processLockRoot: z.string().min(1),
  stoppedProofMaxAgeMs: z.number().int().positive(),
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

export type OfflineRestoreAdmissionFactory = (
  input: Readonly<{ processLockRoot: string; pid: number }>,
  clock: Clock,
) => RestoreAdmissionHandle;

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
    const rollbackTemporaryPath = `${companion.displacedPath}.rollback.tmp`;
    try {
      copyAndSync(companion.displacedPath, rollbackTemporaryPath, fileOperations);
      (fileOperations.renamePath ?? renameSync)(rollbackTemporaryPath, companion.livePath);
      (fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
      (fileOperations.removePath ?? rmSync)(companion.displacedPath);
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
  const bytes = readFileSync(path);
  return Object.freeze({
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
  readonly #runtimeAdmission: RuntimeAdmission;
  #authorityPath: string;
  #suspectDirectory: string;
  #busyTimeoutMs: number;
  #projectionRebuild: (stagedAuthorityPath: string) => Promise<void>;
  #clock: Clock;
  #fileOperations: OfflineRestoreFileOperations;
  #stopProofStore: RecoveryStopProofStore;
  #processLockRoot: string;
  #admissionFactory: OfflineRestoreAdmissionFactory;

  constructor(
    runtimeAdmissionInput: RuntimeAdmission,
    input: unknown,
    projectionRebuild: (stagedAuthorityPath: string) => Promise<void>,
    clock: Clock = systemClock,
    fileOperations: OfflineRestoreFileOperations = DEFAULT_FILE_OPERATIONS,
    admissionFactory: OfflineRestoreAdmissionFactory = acquireRuntimeRestoreAdmission,
  ) {
    const options = OfflineRestoreOptionsSchema.parse(input);
    this.#runtimeAdmission = requireRuntimeAdmission(runtimeAdmissionInput);
    this.#runtimeAdmission.assertExclusive();
    this.#runtimeAdmission.assertAuthorityDatabase(resolve(options.authorityPath));
    this.#runtimeAdmission.assertStateRoot(resolve(options.suspectDirectory));
    this.#authorityPath = resolve(options.authorityPath);
    this.#suspectDirectory = resolve(options.suspectDirectory);
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#projectionRebuild = projectionRebuild;
    this.#clock = clock;
    this.#fileOperations = fileOperations;
    this.#processLockRoot = resolve(options.processLockRoot);
    this.#admissionFactory = admissionFactory;
    this.#stopProofStore = new RecoveryStopProofStore({
      processLockRoot: options.processLockRoot,
      maxProofAgeMs: options.stoppedProofMaxAgeMs,
    }, clock);
  }

  async restore(input: unknown): Promise<OfflineRestoreReport> {
    this.#runtimeAdmission.assertExclusive();
    const request = OfflineRestoreRequestSchema.parse(input);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(this.#authorityPath);
    if (!existsSync(this.#authorityPath) || statSync(this.#authorityPath).size === 0) {
      throw new Error(`suspect authority database ${this.#authorityPath} is missing or empty`);
    }

    const verified = await verifyBackupManifestAtPath(this.#runtimeAdmission,request.manifestPath, sourceDatabaseIdentity);
  requireSupportedRecoverySchema(verified.manifest.schemaVersion);
    const restoreAdmission = this.#admissionFactory({
      processLockRoot: this.#processLockRoot,
      pid: process.pid,
    }, this.#clock);
    let authorityState: OfflineRestoreAuthorityState = "unchanged";
    let restoreReport: OfflineRestoreReport | undefined;
    let restoreError: OfflineRestoreFailure | undefined;
    try {
      restoreReport = await (async (): Promise<OfflineRestoreReport> => {
        const liveSnapshot = observeRuntimeLockSnapshot({
          processLockRoot: this.#processLockRoot,
          sourceDatabaseIdentity,
        }, this.#clock);
        this.#stopProofStore.consumeAgainstLiveSnapshot(
          request.stoppedSystemProof,
          liveSnapshot,
        );

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
          if (verified.manifest.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION) {
            await this.#projectionRebuild(stagedPath);
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
        const cleanupFailures = cleanupStagedPaths(
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
    try {
      restoreAdmission.release();
    } catch (releaseError) {
      if (restoreError !== undefined) {
        const aggregate = new AggregateError(
          [restoreError, releaseError],
          "offline authority restore failed and its exclusive admission could not release",
          { cause: restoreError },
        );
        throw new OfflineRestoreFailure(
          authorityState,
          "offline authority restore failed and its exclusive admission could not release",
          aggregate,
        );
      }
      throw new OfflineRestoreFailure(
        authorityState,
        "offline authority restore exclusive admission release failed",
        releaseError,
      );
    }
    if (restoreError !== undefined) {
      throw restoreError;
    }
    if (restoreReport === undefined) throw new Error("offline authority restore produced no report");
    return restoreReport;
  }
}
