import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createStorageBackupObservation } from "../../../../src/backend/runs/queries/storage.js";
import { buildBootstrap } from "../../../../src/backend/runs/queries/bootstrap.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { RestoreCandidateWireSchema, StorageDoctorWireSchema, type StorageDoctorWire } from "../../../../src/models/dashboard/storage.js";
import { FingerprintSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";

const CHECKED_AT = "2026-11-06T12:00:00.000Z";
const CAPTURED_AT = "2026-11-06T11:00:00.000Z";

function candidate(input: Partial<Extract<StorageDoctorWire["restoreCandidates"][number], { state: "verified-compatible" }>> = {}) {
  return RestoreCandidateWireSchema.options[0].parse({
    state: "verified-compatible", selection: "single-database", schemaVersion: 27,
    manifestFileName: "backup-1.manifest.json", backupFileName: "backup-1.sqlite",
    createdAt: CAPTURED_AT, authorityGeneration: 41, ageMs: 3_600_000,
    restoreEligibility: { state: "eligible" }, generationGap: { state: "known", value: 0 }, ...input,
  });
}

function report(input: Partial<StorageDoctorWire> = {}): StorageDoctorWire {
  return StorageDoctorWireSchema.parse({
    mode: "read-only", checkedAt: CHECKED_AT, recovery: { state: "clear" },
    authority: { state: "healthy", schemaVersion: 27, authorityGeneration: 41, pageCount: 1 },
    authorityUpgrades: { state: "absent", reason: "journal-empty" },
    protectedSettings: { state: "unavailable", cause: { code: "unavailable", summary: "unavailable" } },
    counts: { state: "available", values: { pendingCommands: 0, unresolvedWriteIntents: 0, leases: 0, providerReservations: 0, artifactOutbox: 0 } },
    spanAuthority: { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] },
    backup: { state: "current", latest: candidate() }, restoreCandidates: [candidate()],
    service: { state: "never-run", reason: "none" }, ...input,
  });
}

describe("retained storage backup observation", () => {
  it("withholds times until a verification completes, independently per composition", () => {
    const first = createStorageBackupObservation(), second = createStorageBackupObservation();
    assert.deepEqual(first.read(41), {
      backup: "unavailable", lastBackupAt: null, backupCheckedAt: null
    });
    first.observe(report());
    assert.equal(first.read(41).lastBackupAt, CAPTURED_AT);
    assert.equal(second.read(41).lastBackupAt, null);
  });

  it("separates capture from verification time and selects by capture time rather than report order", () => {
    const observation = createStorageBackupObservation();
    const newest = candidate({ createdAt: IsoInstantSchema.parse("2026-11-06T11:30:00.000Z"), manifestFileName: "newest.manifest.json", backupFileName: "newest.sqlite" });
    observation.observe(report({ restoreCandidates: [candidate(), newest], backup: { state: "current", latest: candidate() } }));
    const summary = observation.read(41);
    assert.equal(summary.lastBackupAt, newest.createdAt);
    assert.equal(summary.backupCheckedAt, CHECKED_AT);
  });


  it("excludes invalid candidates from backup times and withholds unavailable authority", () => {
    const observation = createStorageBackupObservation();
    const invalid = { state: "invalid" as const, manifestFileName: "invalid.manifest.json", cause: { code: "invalid", summary: "invalid backup" } };
    observation.observe(report({ backup: { state: "invalid", cause: invalid.cause }, restoreCandidates: [invalid] }));
    assert.equal(observation.read(41).lastBackupAt, null);
    observation.observe(report({ authority: { state: "degraded", cause: { code: "unavailable", summary: "unavailable authority" } } }));
    assert.equal(observation.read(41).backupCheckedAt, CHECKED_AT);
    assert.equal(observation.read(41).backup, "unavailable");
  });

  it.each(["current", "stale", "missing", "invalid"] as const)("preserves %s doctor truth without admitting invalid backups", state => {
    const observation = createStorageBackupObservation();
    const cause = { code: "backup-unavailable", summary: "backup unavailable" };
    const backup = state === "current" ? { state, latest: candidate() }
      : state === "stale" ? { state, latest: candidate(), cause } : { state, cause };
    observation.observe(report({ backup }));
    const summary = observation.read(41);
    assert.equal(summary.backup, state === "invalid" ? "unavailable" : state);
    assert.equal(summary.lastBackupAt, CAPTURED_AT);
  });

  it.each([42, 40, undefined])("permanently invalidates backup currency after observed generation %s until a fresh successful check", generation => {
    const observation = createStorageBackupObservation();
    observation.observe(report());
    assert.equal(observation.read(generation).backup, generation === undefined ? "unavailable" : "stale");
    assert.equal(observation.read(41).backup, generation === undefined ? "unavailable" : "stale");
    assert.equal(observation.read(41).backupCheckedAt, CHECKED_AT);
    observation.observe(report({ checkedAt: IsoInstantSchema.parse("2026-11-06T12:30:00.000Z") }));
    assert.equal(observation.read(41).backupCheckedAt, "2026-11-06T12:30:00.000Z");
  });

  it("withholds a failed check while preserving the original historical times", () => {
    const observation = createStorageBackupObservation();
    observation.observe(report());
    observation.invalidate();
    const summary = observation.read(41);
    assert.equal(summary.backup, "unavailable");
    assert.equal(summary.lastBackupAt, CAPTURED_AT);
    assert.equal(summary.backupCheckedAt, CHECKED_AT);
    observation.observe(report());
    assert.equal(observation.read(41).backup, "current");
  });

  it("serves repeated bootstrap reads from the same observation and live generation without refreshing verification time", () => {
    const observation = createStorageBackupObservation();
    const clock = manualClock(new Date("2026-11-06T13:00:00.000Z"));
    let reads = 0;
    const bootstrap = () => buildBootstrap({
      appVersion: "0.1.0", actorLabel: () => "Fixture Operator", clock, timeZone: "UTC", modules: [],
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), settingsSchemaHash: FingerprintSchema.parse("b".repeat(64)),
      projection: { generation: () => 1 }, authorityMeta: () => { reads++; return { schemaVersion: 27, authorityGeneration: 41 }; },
      workbookReferences: () => [], backupSummary: observation.read, preflightReport: () => healthyDashboardPreflightReport(clock),
    });
    assert.equal(bootstrap().storage.backupCheckedAt, null);
    observation.observe(report());
    assert.equal(bootstrap().storage.backupCheckedAt, CHECKED_AT);
    assert.equal(bootstrap().storage.lastBackupAt, CAPTURED_AT);
    assert.equal(reads, 3);
  });

  it("requires explicit timestamps and rejects dashboard restore affordances", () => {
    assert.equal(StorageHealthSummaryWireSchema.safeParse({ authority: "healthy", backup: "current", checkedAt: CHECKED_AT }).success, false);
    const observation = createStorageBackupObservation();
    assert.equal(StorageHealthSummaryWireSchema.safeParse({ authority: "healthy", checkedAt: CHECKED_AT, ...observation.read(41) }).success, true);
    assert.equal(StorageHealthSummaryWireSchema.safeParse({ authority: "healthy", checkedAt: CHECKED_AT, ...observation.read(41), restoreTarget: { state: "available" } }).success, false);
  });
});
