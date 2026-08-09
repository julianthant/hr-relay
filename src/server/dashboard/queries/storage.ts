/**
 * The storage doctor route (doc 03 §2.5, 2i-D): run the read-only doctor on
 * demand and project its infra report onto the browser-safe wire, with the
 * live backup service's last outcome beside it — a failed backup run leaves
 * no manifest for the on-disk doctor to see, so the service must say so
 * itself.
 */
import type { Clock } from "../../../domain/clock.js";
import {
  StorageDoctorWireSchema,
  type BackupServiceStateWire,
  type StorageDoctorWire,
} from "../../../domain/dashboard/storage.js";
import { doctorAuthorityStorage } from "../../../infra/sqlite/index.js";

export interface StorageQueryDeps {
  readonly doctorOptions: Readonly<{
    authorityPath: string;
    backupDirectory: string;
    maxBackupAgeMs: number;
    busyTimeoutMs: number;
  }>;
  readonly clock: Clock;
  /** What the composition's backup service last did (never-run | ok | failed). */
  readonly serviceState: () => BackupServiceStateWire;
}

export async function buildStorageDoctor(deps: StorageQueryDeps): Promise<StorageDoctorWire> {
  const report = await doctorAuthorityStorage(deps.doctorOptions, deps.clock);
  return StorageDoctorWireSchema.parse({
    mode: report.mode,
    checkedAt: report.checkedAt,
    authority: report.authority.state === "healthy"
      ? {
        state: "healthy",
        schemaVersion: report.authority.inspection.schemaVersion,
        authorityGeneration: report.authority.inspection.authorityGeneration,
        pageCount: report.authority.inspection.pageCount,
      }
      : { state: "degraded", cause: report.authority.cause },
    counts: report.counts,
    backup: report.backup,
    restoreCandidates: report.restoreCandidates,
    service: deps.serviceState(),
  });
}
