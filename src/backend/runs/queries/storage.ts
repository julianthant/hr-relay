import type { CredentialStore } from "../../../models/config/credential-store.js";

import type { Clock } from "../../../rules/time/clock.js";
import {
  StorageDoctorWireSchema,
  type BackupServiceStateWire,
  type StorageDoctorWire,
} from "../../../models/dashboard/storage.js";
import { doctorAuthorityStorage } from "../../storage/sqlite/index.js";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";

export interface StorageQueryDeps {
  readonly admission: RuntimeAdmission;
  readonly credentials?: CredentialStore;
  readonly doctorOptions: Readonly<{
    stateRootTrustAnchor: string;
    stateRoot: string;
    authorityPath: string;
    backupDirectory: string;
    maxBackupAgeMs?: number;
    busyTimeoutMs: number;
  }>;
  readonly clock: Clock;
  /** What the composition's backup service last did (never-run | ok | failed). */
  readonly serviceState: () => BackupServiceStateWire;
}

export async function buildStorageDoctor(deps: StorageQueryDeps): Promise<StorageDoctorWire> {
  const report = await doctorAuthorityStorage(deps.admission, deps.doctorOptions, deps.clock, deps.credentials);
  return StorageDoctorWireSchema.parse({
    mode: report.mode,
    recovery: report.recovery,
    authorityUpgrades: report.authorityUpgrades,
    protectedSettings: report.protectedSettings,
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
    spanAuthority: report.spanAuthority,
    backup: report.backup,
    restoreCandidates: report.restoreCandidates,
    ...(report.previousLocationBackups === undefined ? {} : { previousLocationBackups: report.previousLocationBackups }),
    service: deps.serviceState(),
  });
}
