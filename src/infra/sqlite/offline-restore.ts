import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { AuthorityDatabase } from "./authority-database.js";
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

export class OfflineAuthorityRestoreService {
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
    input: unknown,
    projectionRebuild: (stagedAuthorityPath: string) => Promise<void>,
    clock: Clock = systemClock,
    fileOperations: OfflineRestoreFileOperations = DEFAULT_FILE_OPERATIONS,
    admissionFactory: OfflineRestoreAdmissionFactory = acquireRuntimeRestoreAdmission,
  ) {
    const options = OfflineRestoreOptionsSchema.parse(input);
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
    const request = OfflineRestoreRequestSchema.parse(input);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(this.#authorityPath);
    if (!existsSync(this.#authorityPath) || statSync(this.#authorityPath).size === 0) {
      throw new Error(`suspect authority database ${this.#authorityPath} is missing or empty`);
    }

    const verified = await verifyBackupManifestAtPath(request.manifestPath, sourceDatabaseIdentity);
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
        try {
          copyAndSync(verified.backupPath, stagedPath, this.#fileOperations);
          await verifyBackupBytesAtPath(
            stagedPath,
            verified.manifest,
            `staged restore ${basename(stagedPath)}`,
          );
          const beforeProjection = AuthorityDatabase.inspectExistingReadOnly(
            stagedPath,
            this.#busyTimeoutMs,
          );
          if (beforeProjection.authorityContentFingerprint
            !== verified.manifest.authorityContentFingerprint
            || beforeProjection.authorityGeneration !== verified.manifest.authorityGeneration) {
            throw new Error(
              `staged restore ${basename(stagedPath)} does not match verified backup authority`,
            );
          }

          await this.#projectionRebuild(stagedPath);
          const afterProjection = AuthorityDatabase.inspectExistingReadOnly(
            stagedPath,
            this.#busyTimeoutMs,
          );
          if (afterProjection.authorityContentFingerprint
            !== beforeProjection.authorityContentFingerprint
            || afterProjection.authorityGeneration !== beforeProjection.authorityGeneration) {
            throw new Error("projection rebuild mutated non-rebuildable authority state");
          }

          (this.#fileOperations.syncPath ?? fsyncPath)(stagedPath);
          const displacedCompanions: DisplacedCompanion[] = [];
          let authorityReplaced = false;
          try {
            for (const suffix of ["-wal", "-shm"] as const) {
              const companion = `${this.#authorityPath}${suffix}`;
              if (!existsSync(companion)) continue;
              const displacedPath = `${stagedPath}${suffix}.live-companion`;
              (this.#fileOperations.renamePath ?? renameSync)(companion, displacedPath);
              displacedCompanions.push({ livePath: companion, displacedPath });
            }
            (this.#fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
            this.#fileOperations.atomicReplace(stagedPath, this.#authorityPath);
            authorityReplaced = true;
            authorityState = "replaced";
          } catch (error) {
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
                  [error, ...rollbackFailures],
                  `authority replacement failed (${errorMessage(error)}); live SQLite companion rollback `
                  + `was not proven (${rollbackSummary})`,
                  { cause: error },
                );
              }
            }
            throw error;
          }
          for (const companion of displacedCompanions) {
            (this.#fileOperations.removePath ?? rmSync)(companion.displacedPath);
          }
          (this.#fileOperations.syncPath ?? fsyncPath)(authorityDirectory);
          return OfflineRestoreReportSchema.parse({
            state: "restored",
            restoredAt: this.#clock.now().toISOString(),
            manifestFileName: basename(verified.manifestPath),
            backupFileName: verified.manifest.backupFileName,
            suspectFileName,
            sourceDatabaseIdentity,
            authorityGeneration: afterProjection.authorityGeneration,
            projectionRebuilt: true,
            authorityPreservedAcrossProjectionRebuild: true,
          });
        } finally {
          for (const path of [stagedPath, `${stagedPath}-wal`, `${stagedPath}-shm`]) {
            if (existsSync(path)) rmSync(path);
          }
        }
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
