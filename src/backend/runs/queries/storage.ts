import { StorageHealthSummaryWireSchema } from "../../../models/dashboard/bootstrap.js";
import type { CredentialStore } from "../../../models/config/credential-store.js";

import type { Clock } from "../../../rules/time/clock.js";
import {
  StorageDoctorWireSchema,
  type BackupServiceStateWire,
  type StorageDoctorWire,
} from "../../../models/dashboard/storage.js";
import type { StorageDoctorReport } from "../../storage/sqlite/recovery-contracts.js";
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
  return projectStorageDoctor(report, deps.serviceState());
}

export function projectStorageDoctor(report: StorageDoctorReport, service: BackupServiceStateWire): StorageDoctorWire {
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
    service,
  });
}

type StorageHealthSummary = ReturnType<typeof StorageHealthSummaryWireSchema.parse>;
type StorageBackupSummary = Pick<StorageHealthSummary, "backup" | "lastBackupAt" | "backupCheckedAt" | "restoreTarget">;
type VerifiedCandidate = Extract<StorageDoctorWire["restoreCandidates"][number], { state: "verified-compatible" }>;

export function createStorageBackupObservation() {
  let observation: (StorageBackupSummary & { authorityGeneration: number | undefined }) | undefined;
  let invalidated: "failed" | "generation-changed" | "authority-unavailable" | undefined;
  const unavailable = (reason: string): StorageHealthSummary["restoreTarget"] => ({
    state: "unavailable", reason, fixAction: "check-again",
  });
  return {
    observe(value: StorageDoctorWire): void {
      const report = StorageDoctorWireSchema.parse(value);
      const candidates = report.restoreCandidates.filter((candidate): candidate is VerifiedCandidate => candidate.state === "verified-compatible")
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
          || right.authorityGeneration - left.authorityGeneration
          || left.manifestFileName.localeCompare(right.manifestFileName)
          || left.backupFileName.localeCompare(right.backupFileName));
      const backup = report.backup.state === "invalid" ? "unavailable" : report.backup.state;
      const candidate = candidates.find(candidate => candidate.restoreEligibility.state === "eligible");
      let restoreTarget = unavailable("No verified backup is eligible for restore. Check again.");
      if (backup !== "unavailable" && backup !== "missing" && report.authority.state === "healthy" && candidate !== undefined) {
        const { manifestFileName, backupFileName, createdAt, schemaVersion, authorityGeneration } = candidate;
        restoreTarget = StorageHealthSummaryWireSchema.shape.restoreTarget.parse({ state: "available", mode: "stopped-maintenance",
          candidate: { manifestFileName, backupFileName, createdAt, schemaVersion, authorityGeneration } });
      }
      observation = {
        backup, lastBackupAt: candidates[0]?.createdAt ?? null, backupCheckedAt: report.checkedAt, restoreTarget,
        authorityGeneration: report.authority.state === "healthy" ? report.authority.authorityGeneration : undefined,
      };
      invalidated = undefined;
    },
    invalidate(): void { invalidated = "failed"; },
    read(this: void, liveGeneration: number | undefined): StorageBackupSummary {
      if (observation === undefined) return {
        backup: "unavailable", lastBackupAt: null, backupCheckedAt: null,
        restoreTarget: unavailable("Backup verification has not completed. Check again."),
      };
      const { authorityGeneration, ...summary } = observation;
      if (invalidated === "failed") return {
        ...summary, backup: "unavailable", restoreTarget: unavailable("The storage check failed. Check again."),
      };
      if (liveGeneration === undefined || authorityGeneration === undefined) invalidated = "authority-unavailable";
      else if (liveGeneration !== authorityGeneration && invalidated !== "authority-unavailable") invalidated = "generation-changed";
      if (invalidated === "authority-unavailable") return {
        ...summary, backup: "unavailable", restoreTarget: unavailable("Storage authority is unavailable. Check again."),
      };
      if (invalidated === "generation-changed") return {
        ...summary, backup: summary.backup === "current" ? "stale" : summary.backup,
        restoreTarget: unavailable("Storage authority changed. Check again."),
      };
      return summary;
    },
  };
}
