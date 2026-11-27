import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthorityBackupRequestSchema, AuthorityCopyInspectionSchema, StorageDoctorReportSchema } from "../../../src/backend/storage/sqlite/recovery-contracts.js";
import { createFrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { StorageDoctorWireSchema } from "../../../src/models/dashboard/storage.js";
import {
  AuthorityUpgradeInspectionSchema,
  BackupHealthSchema,
  BackupServiceStateSchema,
  DegradedDoctorAuthoritySchema,
  DoctorAuthorityWireSchema,
  DoctorCountsSchema,
  HealthyAuthorityStateSchema,
  ProtectedSettingsInspectionSchema,
  RestoreCandidateSchema,
  RestoreEligibilitySchema,
  SpanAuthorityReconciliationSchema,
  StorageAuthorityStateSchema,
  StorageAuthoritySummarySchema,
  StorageHealthCauseSchema,
  StorageRecoveryInspectionSchema,
} from "../../../src/models/storage/storage-status.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/models/config/authority-schema-versions.js";
import { ProtectedSettingsNameSchema } from "../../../src/models/config/protected-settings.js";

const NOW = "2026-07-31T17:00:00.000Z";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const COMMAND_ID = "77777777-7777-4777-8777-777777777777";
const cause = (code: string) => ({ code, summary: "storage diagnostic" });
const VERIFIED = {
  state: "verified-compatible", selection: "single-database", schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
  restoreEligibility: { state: "eligible" }, manifestFileName: "a.manifest.json", backupFileName: "a.sqlite",
  createdAt: NOW, authorityGeneration: 3, ageMs: 0, generationGap: { state: "known", value: 0 },
} as const;
const DELETED = { runId: RUN_ID, workflow: "person-lookup", traceId: "pl-170000-2222", commandId: COMMAND_ID, deletedAt: NOW };

describe("one storage status definition", () => {
  it.each([
    ["recovery", StorageRecoveryInspectionSchema],
    ["authorityUpgrades", AuthorityUpgradeInspectionSchema],
    ["protectedSettings", ProtectedSettingsInspectionSchema],
    ["counts", DoctorCountsSchema],
    ["spanAuthority", SpanAuthorityReconciliationSchema],
    ["backup", BackupHealthSchema],
  ] as const)("serves the backend %s schema object on the wire", (field, schema) => {
    expect(StorageDoctorWireSchema.shape[field]).toBe(schema);
    expect(StorageDoctorReportSchema.shape[field]).toBe(schema);
  });

  it("serves the same restore candidate, service state and bootstrap summary objects", () => {
    expect(StorageDoctorWireSchema.shape.restoreCandidates.element).toBe(RestoreCandidateSchema);
    expect(StorageDoctorReportSchema.shape.restoreCandidates.element).toBe(RestoreCandidateSchema);
    expect(StorageDoctorWireSchema.shape.service).toBe(BackupServiceStateSchema);
    expect(StorageDoctorWireSchema.shape.authority).toBe(DoctorAuthorityWireSchema);
    const bootstrap = createFrontendBootstrapWireSchema({ workflow: z.never() });
    expect(bootstrap.shape.storage).toBe(StorageAuthoritySummarySchema);
  });

  it("builds the backend and wire doctor authority arms from one state vocabulary", () => {
    const [backendHealthy, backendDegraded] = StorageDoctorReportSchema.shape.authority.options;
    const [wireHealthy, wireDegraded] = DoctorAuthorityWireSchema.options;
    expect(backendDegraded).toBe(DegradedDoctorAuthoritySchema);
    expect(wireDegraded).toBe(DegradedDoctorAuthoritySchema);
    expect(backendHealthy.shape.state).toBe(HealthyAuthorityStateSchema);
    expect(wireHealthy.shape.state).toBe(HealthyAuthorityStateSchema);
    expect([...HealthyAuthorityStateSchema.options, ...DegradedDoctorAuthoritySchema.shape.state.options]).toEqual(StorageAuthorityStateSchema.options);
  });

  it("picks the doctor authority wire fields from the backend copy inspection", () => {
    const healthy = DoctorAuthorityWireSchema.options[0].shape;
    for (const field of ["schemaVersion", "authorityGeneration", "pageCount"] as const) {
      expect(healthy[field]).toBe(AuthorityCopyInspectionSchema.shape[field]);
    }
  });

  it("drops the never-produced previous-location backups from both report and wire", () => {
    expect(Object.keys(StorageDoctorReportSchema.shape)).not.toContain("previousLocationBackups");
    expect(Object.keys(StorageDoctorWireSchema.shape)).not.toContain("previousLocationBackups");
  });
});

type Arm = readonly [name: string, schema: z.ZodType, value: unknown];

describe("every arm parses and every never-produced or contradictory arm is refused", () => {
  const accepted: readonly Arm[] = [
    ["cause", StorageHealthCauseSchema, cause("authority-corrupt")],
    ["recovery clear", StorageRecoveryInspectionSchema, { state: "clear" }],
    ["recovery interrupted", StorageRecoveryInspectionSchema, { state: "interrupted", findings: [{ marker: "authority-restore", state: "interrupted" }] }],
    ["recovery unavailable", StorageRecoveryInspectionSchema, { state: "unavailable", findings: [], cause: cause("authority-unavailable") }],
    ["eligible", RestoreEligibilitySchema, { state: "eligible" }],
    ["unsupported", RestoreEligibilitySchema, { state: "unsupported", reason: "schema 7 cannot be restored" }],
    ["eligibility unavailable", RestoreEligibilitySchema, { state: "unavailable", reason: "authority unreadable" }],
    ["verified candidate", RestoreCandidateSchema, VERIFIED],
    ["invalid candidate", RestoreCandidateSchema, { state: "invalid", manifestFileName: "b.manifest.json", cause: cause("backup-invalid") }],
    ["backup current", BackupHealthSchema, { state: "current", latest: VERIFIED }],
    ["backup stale", BackupHealthSchema, { state: "stale", latest: VERIFIED, cause: cause("backup-stale") }],
    ["backup missing", BackupHealthSchema, { state: "missing", cause: cause("backup-missing") }],
    ["backup invalid", BackupHealthSchema, { state: "invalid", cause: cause("authority-corrupt") }],
    ["service never-run", BackupServiceStateSchema, { state: "never-run", reason: "no backup yet" }],
    ["service ok", BackupServiceStateSchema, { state: "ok", finishedAt: NOW, finalGeneration: 3 }],
    ["service failed", BackupServiceStateSchema, { state: "failed", failedAt: NOW, message: "copy failed" }],
    ["span reconciled", SpanAuthorityReconciliationSchema, { state: "reconciled", streamRunCount: 1, liveRunCount: 0,
      deleted: [{ ...DELETED, origin: "queue" }, { ...DELETED, origin: "storage" }] }],
    ["span degraded", SpanAuthorityReconciliationSchema, { state: "degraded", streamRunCount: 1, liveRunCount: 1, deleted: [],
      problems: [{ state: "missing", runId: RUN_ID }, { state: "restore-loss", runId: RUN_ID }, { state: "missing-span", runId: RUN_ID },
        { state: "malformed", runId: RUN_ID, table: "deleted_runs", summary: "bad" },
        { state: "malformed-authority", source: "current", recordKey: RUN_ID, summary: "bad" }] }],
    ["span unavailable", SpanAuthorityReconciliationSchema, { state: "unavailable", cause: cause("span-stream-invalid") }],
    ["settings available", ProtectedSettingsInspectionSchema, { state: "available", entries: ProtectedSettingsNameSchema.options.map(name => ({ name, present: false })) }],
    ["settings unavailable", ProtectedSettingsInspectionSchema, { state: "unavailable", cause: cause("authority-unavailable") }],
    ["upgrades available", AuthorityUpgradeInspectionSchema, { state: "available",
      phases: [{ phase: "baseline", fromSchemaVersion: 0, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, recordedAt: NOW }] }],
    ["upgrades absent", AuthorityUpgradeInspectionSchema, { state: "absent", reason: "journal-empty" }],
    ["upgrades unavailable", AuthorityUpgradeInspectionSchema, { state: "unavailable", cause: cause("authority-unavailable") }],
    ["counts available", DoctorCountsSchema, { state: "available",
      values: { pendingCommands: 0, unresolvedWriteIntents: 0, providerReservations: 0, artifactOutbox: 0 } }],
    ["counts unavailable", DoctorCountsSchema, { state: "unavailable", cause: cause("authority-locked") }],
    ["authority healthy", DoctorAuthorityWireSchema, { state: "healthy", schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityGeneration: 3, pageCount: 9 }],
    ["authority degraded", DoctorAuthorityWireSchema, { state: "degraded", cause: cause("authority-corrupt") }],
    ["summary healthy", StorageAuthoritySummarySchema, { authority: "healthy" }],
    ["summary unavailable", StorageAuthoritySummarySchema, { authority: "unavailable" }],
    ["backup trigger interval", AuthorityBackupRequestSchema, { trigger: "interval", requiredGeneration: 0 }],
    ["backup trigger schema-migration", AuthorityBackupRequestSchema, { trigger: "schema-migration", requiredGeneration: 0 }],
    ["backup trigger graceful-drain", AuthorityBackupRequestSchema, { trigger: "graceful-drain", requiredGeneration: 0 }],
  ];
  it.each(accepted)("accepts %s", (_name, schema, value) => {
    expect(schema.parse(value)).toEqual(value);
  });

  const refused: readonly Arm[] = [
    ["an open cause code", StorageHealthCauseSchema, cause("authority-gone")],
    ["recovery unavailable without authority-unavailable", StorageRecoveryInspectionSchema, { state: "unavailable", findings: [], cause: cause("authority-locked") }],
    ["incomplete eligibility", RestoreEligibilitySchema, { state: "incomplete", reason: "never produced" }],
    ["an unsafe backup file name", RestoreCandidateSchema, { ...VERIFIED, backupFileName: "../a.sqlite" }],
    ["stale without backup-stale", BackupHealthSchema, { state: "stale", latest: VERIFIED, cause: cause("backup-missing") }],
    ["missing without backup-missing", BackupHealthSchema, { state: "missing", cause: cause("backup-stale") }],
    ["an archive deletion origin", SpanAuthorityReconciliationSchema, { state: "reconciled", streamRunCount: 1, liveRunCount: 0,
      deleted: [{ ...DELETED, origin: "archive" }] }],
    ["archived span arrays", SpanAuthorityReconciliationSchema, { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] }],
    ["the pre-journal-schema reason", AuthorityUpgradeInspectionSchema, { state: "absent", reason: "pre-journal-schema" }],
    ["a healthy authority at an older schema", DoctorAuthorityWireSchema, { state: "healthy", schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION - 1, authorityGeneration: 3, pageCount: 9 }],
    ["an unknown summary", StorageAuthoritySummarySchema, { authority: "degraded" }],
    ["the never-produced operator backup trigger", AuthorityBackupRequestSchema, { trigger: "operator", requiredGeneration: 0 }],
    ["the never-produced external-write backup trigger", AuthorityBackupRequestSchema, { trigger: "external-write", requiredGeneration: 0 }],
  ];
  it.each(refused)("refuses %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
