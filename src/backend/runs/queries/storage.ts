import type { CredentialStore } from "../../../models/config/credential-store.js";

import type { Clock } from "../../../rules/time/clock.js";
import { StorageDoctorWireSchema, type StorageDoctorWire } from "../../../models/dashboard/storage.js";
import type { BackupServiceState } from "../../../models/storage/storage-status.js";
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
    busyTimeoutMs: number;
  }>;
  readonly clock: Clock;
  /** What the composition's backup service last did (never-run | ok | failed). */
  readonly serviceState: () => BackupServiceState;
}

export async function buildStorageDoctor(deps: StorageQueryDeps): Promise<StorageDoctorWire> {
  const report = await doctorAuthorityStorage(deps.admission, deps.doctorOptions, deps.clock, deps.credentials);
  return projectStorageDoctor(report, deps.serviceState());
}

/** The dashboard sees only the copy-inspection summary fields of a healthy authority. */
function doctorAuthorityWireOf(authority: StorageDoctorReport["authority"]): StorageDoctorWire["authority"] {
  if (authority.state === "degraded") return authority;
  const { schemaVersion, authorityGeneration, pageCount } = authority.inspection;
  return { state: "healthy", schemaVersion, authorityGeneration, pageCount };
}

export function projectStorageDoctor(report: StorageDoctorReport, service: BackupServiceState): StorageDoctorWire {
  return StorageDoctorWireSchema.parse({
    mode: report.mode,
    recovery: report.recovery,
    authorityUpgrades: report.authorityUpgrades,
    protectedSettings: report.protectedSettings,
    checkedAt: report.checkedAt,
    authority: doctorAuthorityWireOf(report.authority),
    counts: report.counts,
    spanAuthority: report.spanAuthority,
    backup: report.backup,
    restoreCandidates: report.restoreCandidates,
    service,
  });
}
