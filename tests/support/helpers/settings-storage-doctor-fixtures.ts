import { StorageHealthSummaryWireSchema } from "../../../src/models/dashboard/bootstrap.js";



export class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function createSettingsStorageDoctorFixtures() {
  const STORAGE = StorageHealthSummaryWireSchema.parse({
    authority: "healthy",
    backup: "current",
    checkedAt: "2026-08-31T16:00:00.000Z",
  });

  const REPORT_BASE = {
    recovery: { state: "clear" },
    protectedSettings: { state: "unavailable", cause: { code: "authority-unavailable", summary: "protected settings fixture is unavailable" } },
    mode: "read-only",
    authorityUpgrades: { state: "absent", reason: "journal-empty" },
    checkedAt: "2026-08-31T16:01:00.000Z",
    authority: {
      state: "healthy",
      schemaVersion: 27,
      authorityGeneration: 41,
      pageCount: 12,
    },
    counts: {
      state: "available",
      values: {
        pendingCommands: 0,
        unresolvedWriteIntents: 0,
        leases: 0,
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
