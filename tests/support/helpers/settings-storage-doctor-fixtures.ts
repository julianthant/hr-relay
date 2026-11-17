import { StorageAuthoritySummarySchema } from "../../../src/models/storage/storage-status.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/models/config/authority-schema-versions.js";



export class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function createSettingsStorageDoctorFixtures() {
  const STORAGE = StorageAuthoritySummarySchema.parse({
    authority: "healthy" });

  const REPORT_BASE = {
    recovery: { state: "clear" },
    protectedSettings: { state: "unavailable", cause: { code: "authority-unavailable", summary: "protected settings fixture is unavailable" } },
    mode: "read-only",
    authorityUpgrades: { state: "absent", reason: "journal-empty" },
    checkedAt: "2026-08-31T16:01:00.000Z",
    authority: {
      state: "healthy",
      schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
      authorityGeneration: 41,
      pageCount: 12,
    },
    counts: {
      state: "available",
      values: {
        pendingCommands: 0,
        unresolvedWriteIntents: 0,
        providerReservations: 0,
        artifactOutbox: 0,
      },
    },
    backup: {
      state: "missing",
      cause: { code: "backup-missing", summary: "no verified backup is present" },
    },
    restoreCandidates: [],
    service: { state: "never-run", reason: "backup service has not run" },
  } as const;
  return { STORAGE, REPORT_BASE };
}
