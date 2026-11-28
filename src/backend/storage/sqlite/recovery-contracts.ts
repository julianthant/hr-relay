import { z } from "zod";
import { AuthorityTableNameSchema, ProjectionTableNameSchema } from "../../../models/config/authority.js";
import { ConfigSnapshotIdSchema, FingerprintSchema, ItemIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, TraceIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import {
  InstanceSelectionSchema,
  RunPrioritySchema,
  RunShapeSchema,
} from "../../../models/run/envelope.js";
import { AUTHORITY_APPLICATION_ID, BOUND_AUTHORITY_SCHEMA_VERSIONS, CURRENT_AUTHORITY_SCHEMA_VERSION, RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS, SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS, UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS } from "../../../models/config/authority-schema-versions.js";
import {
  AuthorityInspectionSummarySchema,
  AuthorityPendingCountsSchema,
  AuthorityUpgradeInspectionSchema,
  BackupHealthSchema,
  DegradedDoctorAuthoritySchema,
  DeletedSpanAuthoritySchema,
  DoctorCountsSchema,
  HealthyAuthorityStateSchema,
  MalformedAuthorityRecordSchema,
  MalformedSpanAuthorityRunSchema,
  MissingSpanAuthorityRunSchema,
  ProtectedSettingsInspectionSchema,
  RestoreCandidateSchema,
  SafeFileNameSchema,
  SpanAuthorityReconciliationSchema,
  StorageHealthCauseSchema,
  StorageRecoveryInspectionSchema,
} from "../../../models/storage/storage-status.js";
import { WORKER_CUSTODY_DROPPED_TABLES } from "./migrations.js";
import { RETIRED_ASSISTANT_GRANT_TABLE } from "./assistant-grant-retirement.js";

const NonNegativeIntSchema = z.number().int().nonnegative();
const BackupSchemaVersionSchema = z.literal(RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS);

export const AuthorityInvariantResultSchema = z.strictObject({
  state: z.literal("valid"),
  violations: z.array(z.never()).max(0),
});

export const AuthorityCopyInspectionSchema = z.strictObject({
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: AuthorityInspectionSummarySchema.shape.schemaVersion,
  installationId: z.uuid(),
  profileId: z.uuid(),
  pageCount: AuthorityInspectionSummarySchema.shape.pageCount,
  authorityGeneration: AuthorityInspectionSummarySchema.shape.authorityGeneration,
  authorityContentFingerprint: FingerprintSchema,
  quickCheck: z.literal("ok"),
  foreignKeyViolations: z.literal(0),
  invariants: AuthorityInvariantResultSchema,
  tables: z.array(z.strictObject({
    name: z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]),
    classification: z.enum(["authority", "projection"]),
  })),
  counts: AuthorityPendingCountsSchema,
});

/** The inspection as plain data, for a reader that receives it across a thread boundary. */
export const BackupCopyInspectionSchema = AuthorityCopyInspectionSchema.extend({
  schemaVersion: z.union([z.literal(SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]),
  installationId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  tables: z.array(z.union([AuthorityCopyInspectionSchema.shape.tables.element,
    z.strictObject({ name: z.enum(["explorer_overrides", RETIRED_ASSISTANT_GRANT_TABLE, ...WORKER_CUSTODY_DROPPED_TABLES]), classification: z.literal("authority") })])),
  invariantViolations: z.array(z.never()).max(0),
  exactTableRegistry: z.literal(true),
});

export const BackupVerificationSchema = z.strictObject({
  state: z.literal("verified"),
  observedFrom: z.literal("backup-copy"),
  observedAt: IsoInstantSchema,
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: BackupSchemaVersionSchema,
  installationId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  pageCount: PositiveIntSchema,
  authorityGeneration: NonNegativeIntSchema,
  authorityContentFingerprint: FingerprintSchema,
  quickCheck: z.literal("ok"),
  foreignKeyViolations: z.literal(0),
  invariantViolations: z.array(z.never()).max(0),
  exactTableRegistry: z.literal(true),
});

const AuthorityBackupManifestBaseSchema = z.strictObject({
  kind: z.literal("hrauto-authority-backup"),
  backupFileName: SafeFileNameSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: BackupSchemaVersionSchema,
  installationId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  pageCount: PositiveIntSchema,
  authorityGeneration: NonNegativeIntSchema,
  authorityContentFingerprint: FingerprintSchema,
  createdAt: IsoInstantSchema,
  byteSize: PositiveIntSchema,
  sha256: FingerprintSchema,
  verification: BackupVerificationSchema,
});

function requireObservedBackupIdentity(
  manifest: z.infer<typeof AuthorityBackupManifestBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (manifest.schemaVersion >= 7 && (manifest.installationId === undefined || manifest.profileId === undefined)) {
    context.addIssue({ code: "custom", message: "profile backup binding is required" });
  }
  for (const field of ["applicationId", "schemaVersion", "installationId", "profileId", "pageCount", "authorityGeneration", "authorityContentFingerprint"] as const) {
    if (manifest[field] !== manifest.verification[field]) {
      context.addIssue({ code: "custom", path: ["verification", field], message: `${field} must equal the value observed from the backup copy` });
    }
  }
}

/** DB-only current writer shape. Credentials have no backup representation. */
const BackupLogFileSchema = z.strictObject({ byteSize: PositiveIntSchema, sha256: FingerprintSchema });
export const AuthorityBackupManifestV4Schema = AuthorityBackupManifestBaseSchema.extend({
  manifestVersion: z.literal(4),
  schemaVersion: z.literal(BOUND_AUTHORITY_SCHEMA_VERSIONS),
  installationId: z.uuid(),
  profileId: z.uuid(),
  logFiles: z.strictObject({ timeline: BackupLogFileSchema, dashboard: BackupLogFileSchema }).optional(),
  verification: BackupVerificationSchema.extend({ installationId: z.uuid(), profileId: z.uuid() }),
}).superRefine(requireObservedBackupIdentity);

export const UnboundPredecessorBackupManifestSchema = AuthorityBackupManifestBaseSchema.extend({
  manifestVersion: z.literal(3),
  schemaVersion: z.literal(UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS),
  installationId: z.undefined().optional(),
  profileId: z.undefined().optional(),
  verification: BackupVerificationSchema.extend({ installationId: z.undefined().optional(), profileId: z.undefined().optional() }),
}).superRefine(requireObservedBackupIdentity);

export const AuthorityBackupManifestSchema = AuthorityBackupManifestV4Schema;
export const StoppedAuthorityBackupManifestSchema = z.union([AuthorityBackupManifestSchema, UnboundPredecessorBackupManifestSchema]);

export const AuthorityBackupRequestSchema = z.strictObject({
  trigger: z.enum(["interval", "schema-migration", "graceful-drain"]),
  requiredGeneration: NonNegativeIntSchema,
});

export const AuthorityBackupRunReportSchema = z.strictObject({
  state: z.literal("verified"),
  requestedGeneration: NonNegativeIntSchema,
  finalGeneration: NonNegativeIntSchema,
  coalescedRequests: PositiveIntSchema,
  followUpPerformed: z.boolean(),
  manifests: z.array(StoppedAuthorityBackupManifestSchema).min(1).max(2),
});

/** One run.queued occurrence plus the attempt reached by its ordered stream. */
export const SpanAuthorityRunRootSchema = z.strictObject({
  possibleExternalWrite: z.literal(true).optional(),
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  itemId: ItemIdSchema,
  traceId: TraceIdSchema,
  spanPath: z.string().min(1),
  parentRunId: RunIdSchema.optional(),
  shape: RunShapeSchema,
  priority: RunPrioritySchema,
  dryRun: z.boolean(),
  retryOf: RunIdSchema.optional(),
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  resolvedInstance: InstanceSelectionSchema,
  configFingerprint: FingerprintSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  queuedAt: IsoInstantSchema,
  reconstructed: z.boolean(),
  initialAttempt: PositiveIntSchema,
  finalAttempt: PositiveIntSchema,
  streamIssues: z.array(z.string().min(1)).readonly(),
}).superRefine((root, context) => {
  if (root.finalAttempt < root.initialAttempt) {
    context.addIssue({
      code: "custom",
      path: ["finalAttempt"],
      message: "final span attempt cannot precede its run.queued attempt",
    });
  }
});


export const SpanAuthorityRunResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("live"), runId: RunIdSchema }),
  MissingSpanAuthorityRunSchema,
  MalformedSpanAuthorityRunSchema,
  DeletedSpanAuthoritySchema.extend({ state: z.literal("deleted") }),
]);

const TombstoneOrdinalFindingSchema = z.strictObject({
  code: z.literal("tombstone-ordinal-unknown"),
  runId: RunIdSchema,
  missingFields: z.array(z.enum(["itemId", "attempt", "runNumber"])).min(1),
});
export const TombstoneOrdinalInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), findings: z.array(TombstoneOrdinalFindingSchema) }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

export const SpanAuthorityReadSnapshotSchema = z.strictObject({
  tombstoneOrdinalFindings: z.array(TombstoneOrdinalFindingSchema),
  authorityGeneration: NonNegativeIntSchema,
  authorityContentFingerprint: FingerprintSchema,
  liveRunCount: NonNegativeIntSchema,
  missingSpanRunIds: z.array(RunIdSchema).readonly(),
  malformedRecords: z.array(MalformedAuthorityRecordSchema).readonly(),
  resolutions: z.array(SpanAuthorityRunResolutionSchema).readonly(),
});

const DoctorAuthoritySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: HealthyAuthorityStateSchema, inspection: AuthorityCopyInspectionSchema }),
  DegradedDoctorAuthoritySchema,
]);

export const StorageDoctorReportSchema = z.strictObject({
  recovery: StorageRecoveryInspectionSchema,
  authorityUpgrades: AuthorityUpgradeInspectionSchema,
  tombstoneOrdinals: TombstoneOrdinalInspectionSchema,
  kind: z.literal("authority-storage-doctor"),
  mode: z.literal("read-only"),
  protectedSettings: ProtectedSettingsInspectionSchema,
  checkedAt: IsoInstantSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  authority: DoctorAuthoritySchema,
  counts: DoctorCountsSchema,
  spanAuthority: SpanAuthorityReconciliationSchema,
  backup: BackupHealthSchema,
  restoreCandidates: z.array(RestoreCandidateSchema),
});

export const OfflineRestoreRequestSchema = z.strictObject({
  manifestPath: z.string().min(1),
});

export const OfflineRestoreReportSchema = z.strictObject({
  state: z.literal("restored"),
  restoredAt: IsoInstantSchema,
  manifestFileName: SafeFileNameSchema,
  backupFileName: SafeFileNameSchema,
  suspectFileName: SafeFileNameSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  schemaVersion: BackupSchemaVersionSchema,
  authorityGeneration: NonNegativeIntSchema,
  projectionRebuilt: z.boolean(),
  authorityPreservedAcrossProjectionRebuild: z.literal(true),
});

export type AuthorityCopyInspection = z.infer<typeof AuthorityCopyInspectionSchema>;
export type AuthorityBackupManifest = z.infer<typeof AuthorityBackupManifestSchema>;
export type StoppedAuthorityBackupManifest = z.infer<typeof StoppedAuthorityBackupManifestSchema>;
export type AuthorityBackupRequest = z.infer<typeof AuthorityBackupRequestSchema>;
export type AuthorityBackupRunReport = z.infer<typeof AuthorityBackupRunReportSchema>;
export type SpanAuthorityRunResolution = z.infer<typeof SpanAuthorityRunResolutionSchema>;
export type SpanAuthorityRunRoot = z.infer<typeof SpanAuthorityRunRootSchema>;
export type SpanAuthorityReadSnapshot = z.infer<typeof SpanAuthorityReadSnapshotSchema>;
export type StorageDoctorReport = z.infer<typeof StorageDoctorReportSchema>;
export type OfflineRestoreReport = z.infer<typeof OfflineRestoreReportSchema>;
