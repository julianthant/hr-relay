import { ProtectedSettingsPresenceEntriesSchema } from "../../../models/config/protected-settings.js";
import { z } from "zod";
import { AuthorityTableNameSchema, ProjectionTableNameSchema, AuthorityUpgradePhaseSchema } from "../../../models/config/authority.js";
import {
  ActorIdSchema,
  CommandIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  ItemIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../../../rules/identity/ids.js";
import {
  InstanceSelectionSchema,
  RunPrioritySchema,
  RunShapeSchema,
} from "../../../models/run/envelope.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";

const NonNegativeIntSchema = z.number().int().nonnegative();
const SafeFileNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const BackupSchemaVersionSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION)]);

export const AuthorityPendingCountsSchema = z.strictObject({
  pendingCommands: NonNegativeIntSchema,
  unresolvedWriteIntents: NonNegativeIntSchema,
  leases: NonNegativeIntSchema,
  providerReservations: NonNegativeIntSchema,
  artifactOutbox: NonNegativeIntSchema,
});

export const AuthorityInvariantResultSchema = z.strictObject({
  state: z.literal("valid"),
  violations: z.array(z.never()).max(0),
});

export const AuthorityCopyInspectionSchema = z.strictObject({
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  installationId: z.uuid(),
  profileId: z.uuid(),
  pageCount: PositiveIntSchema,
  authorityGeneration: NonNegativeIntSchema,
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
export const AuthorityBackupManifestV3Schema = AuthorityBackupManifestBaseSchema.extend({
  manifestVersion: z.literal(3),
}).superRefine(requireObservedBackupIdentity);

export const AuthorityBackupManifestSchema = AuthorityBackupManifestV3Schema;

export const AuthorityBackupRequestSchema = z.strictObject({
  trigger: z.enum(["interval", "schema-migration", "external-write", "graceful-drain", "operator"]),
  requiredGeneration: NonNegativeIntSchema,
});

export const AuthorityBackupRunReportSchema = z.strictObject({
  state: z.literal("verified"),
  requestedGeneration: NonNegativeIntSchema,
  finalGeneration: NonNegativeIntSchema,
  coalescedRequests: PositiveIntSchema,
  followUpPerformed: z.boolean(),
  manifests: z.array(AuthorityBackupManifestSchema).min(1).max(2),
});

export const StorageHealthCauseSchema = z.strictObject({
  code: z.enum([
    "authority-empty",
    "authority-not-sqlite",
    "authority-corrupt",
    "authority-foreign-key",
    "authority-invariant",
    "authority-record-invalid",
    "authority-schema-newer",
    "authority-schema-mismatch",
    "authority-migration-locked",
    "authority-locked",
    "authority-unavailable",
    "backup-missing",
    "backup-stale",
    "backup-invalid",
    "span-stream-invalid",
    "span-authority-unavailable",
  ]),
  summary: z.string().min(1),
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


export const DeletedSpanAuthoritySchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  traceId: TraceIdSchema,
  origin: z.enum(["queue", "archive"]),
  commandId: CommandIdSchema,
  deletedAt: IsoInstantSchema,
});

const MissingSpanAuthorityRunSchema = z.strictObject({ state: z.literal("missing"), runId: RunIdSchema, possibleExternalWrite: z.literal(true).optional() });
const MalformedSpanAuthorityRunSchema = z.strictObject({
  state: z.literal("malformed"),
  runId: RunIdSchema,
  table: z.enum(["span_stream", "runs", "archived_runs", "deleted_runs"]),
  summary: z.string().min(1),
});

export const SpanAuthorityRunResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("live"), runId: RunIdSchema }),
  z.strictObject({ state: z.literal("archived"), runId: RunIdSchema, archivedAt: IsoInstantSchema }),
  MissingSpanAuthorityRunSchema,
  MalformedSpanAuthorityRunSchema,
  DeletedSpanAuthoritySchema.extend({ state: z.literal("deleted") }),
]);

const MalformedAuthorityRecordSchema = z.strictObject({
  state: z.literal("malformed-authority"),
  source: z.enum(["current", "archived"]),
  recordKey: z.string().min(1),
  summary: z.string().min(1),
});

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
  archivedRunCount: NonNegativeIntSchema,
  missingSpanRunIds: z.array(RunIdSchema).readonly(),
  malformedRecords: z.array(MalformedAuthorityRecordSchema).readonly(),
  resolutions: z.array(SpanAuthorityRunResolutionSchema).readonly(),
});

const ArchivedSpanAuthoritySchema = z.strictObject({
  runId: RunIdSchema,
  archivedAt: IsoInstantSchema,
});

/** `deleted` and `archived` are ACCOUNTED, so neither is ever a problem arm. */
const SpanAuthorityProblemSchema = z.discriminatedUnion("state", [
  MissingSpanAuthorityRunSchema,
  z.strictObject({ state: z.literal("restore-loss"), runId: RunIdSchema,
    possibleExternalWrite: z.literal(true).optional() }),
  MalformedSpanAuthorityRunSchema,
  z.strictObject({ state: z.literal("missing-span"), runId: RunIdSchema }),
  MalformedAuthorityRecordSchema,
]);

export const SpanAuthorityReconciliationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(ArchivedSpanAuthoritySchema),
    deleted: z.array(DeletedSpanAuthoritySchema),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(ArchivedSpanAuthoritySchema),
    deleted: z.array(DeletedSpanAuthoritySchema),
    problems: z.array(SpanAuthorityProblemSchema).min(1),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    cause: StorageHealthCauseSchema,
  }),
]);

export const AuthorityBootReportSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("healthy"),
    checkedAt: IsoInstantSchema,
    mutationAvailability: z.literal("available"),
    inspection: AuthorityCopyInspectionSchema,
  }),
  z.strictObject({
    state: z.literal("degraded-read-only"),
    checkedAt: IsoInstantSchema,
    mutationAvailability: z.literal("blocked"),
    cause: StorageHealthCauseSchema,
  }),
]);

const RecoveryFindingSchema = z.strictObject({
  marker: z.enum(["authority-restore", "unowned-recovery-entry"]),
  state: z.enum(["interrupted", "unavailable"]),
});
export const StorageRecoveryInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("clear") }),
  z.strictObject({ state: z.literal("interrupted"), findings: z.array(RecoveryFindingSchema).min(1) }),
  z.strictObject({ state: z.literal("unavailable"), findings: z.array(RecoveryFindingSchema), cause: StorageHealthCauseSchema }),
]);
const RestoreEligibilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("eligible") }),
  z.strictObject({ state: z.literal("unsupported"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("incomplete"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);

export const RestoreCandidateSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("verified-compatible"),
    selection: z.literal("single-database"),
    schemaVersion: z.number().int().positive(),
    restoreEligibility: RestoreEligibilitySchema,
    manifestFileName: SafeFileNameSchema,
    backupFileName: SafeFileNameSchema,
    createdAt: IsoInstantSchema,
    authorityGeneration: NonNegativeIntSchema,
    ageMs: NonNegativeIntSchema,
    generationGap: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("known"), value: NonNegativeIntSchema }),
      z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
    ]),
  }),
  z.strictObject({
    state: z.literal("invalid"),
    manifestFileName: SafeFileNameSchema,
    cause: StorageHealthCauseSchema,
  }),
]);

export const PreviousLocationBackupSchema = z.strictObject({
  selection: z.literal("single-database"),
  schemaVersion: z.number().int().positive(),
  manifestFileName: SafeFileNameSchema,
  backupFileName: SafeFileNameSchema,
  createdAt: IsoInstantSchema,
  authorityGeneration: NonNegativeIntSchema,
  restoreEligibility: z.literal("not-admitted"),
});

export const BackupHealthSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("current"),
    latest: RestoreCandidateSchema.options[0],
  }),
  z.strictObject({
    state: z.literal("stale"),
    latest: RestoreCandidateSchema.options[0],
    cause: StorageHealthCauseSchema,
  }),
  z.strictObject({
    state: z.literal("missing"),
    cause: StorageHealthCauseSchema,
  }),
  z.strictObject({
    state: z.literal("invalid"),
    cause: StorageHealthCauseSchema,
  }),
]);

const DoctorCountsSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), values: AuthorityPendingCountsSchema }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

const DoctorAuthoritySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("healthy"), inspection: AuthorityCopyInspectionSchema }),
  z.strictObject({ state: z.literal("degraded"), cause: StorageHealthCauseSchema }),
]);

export const ProtectedSettingsInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), entries: ProtectedSettingsPresenceEntriesSchema }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

export const AuthorityUpgradeInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), phases: z.array(z.strictObject({
    phase: AuthorityUpgradePhaseSchema,
    fromSchemaVersion: z.number().int().nonnegative(),
    toSchemaVersion: PositiveIntSchema,
    recordedAt: IsoInstantSchema,
  })).min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.enum(["pre-journal-schema", "journal-empty"]) }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
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
  previousLocationBackups: z.array(PreviousLocationBackupSchema).optional(),
});

export const RecoveryProcessLockStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("stopped"), generation: PositiveIntSchema }),
  z.strictObject({ state: z.literal("active"), generation: PositiveIntSchema, pid: PositiveIntSchema }),
]);

export const RecoveryRuntimeLockSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runtimeNamespace: z.literal("hrauto-rebuild"),
  runtimeGeneration: PositiveIntSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  recordedAt: IsoInstantSchema,
  processLocks: z.strictObject({
    server: RecoveryProcessLockStateSchema,
    workers: RecoveryProcessLockStateSchema,
    geocode: RecoveryProcessLockStateSchema,
    "live-smoke": RecoveryProcessLockStateSchema,
  }),
});

export const StoppedSystemProofSchema = z.strictObject({
  state: z.literal("stopped"),
  proofId: z.string().uuid(),
  observedAt: IsoInstantSchema,
  observedBy: ActorIdSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  runtimeNamespace: z.literal("hrauto-rebuild"),
  runtimeGeneration: PositiveIntSchema,
  runtimeStateFingerprint: FingerprintSchema,
  processLockGenerations: z.strictObject({
    server: PositiveIntSchema,
    workers: PositiveIntSchema,
    geocode: PositiveIntSchema,
    "live-smoke": PositiveIntSchema,
  }),
});

export const OfflineRestoreRequestSchema = z.strictObject({
  manifestPath: z.string().min(1),
  stoppedSystemProof: StoppedSystemProofSchema,
});

export const OfflineRestoreReportSchema = z.strictObject({
  state: z.literal("restored"),
  restoredAt: IsoInstantSchema,
  manifestFileName: SafeFileNameSchema,
  backupFileName: SafeFileNameSchema,
  suspectFileName: SafeFileNameSchema,
  sourceDatabaseIdentity: FingerprintSchema,
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  authorityGeneration: NonNegativeIntSchema,
  projectionRebuilt: z.boolean(),
  authorityPreservedAcrossProjectionRebuild: z.literal(true),
});

export type AuthorityPendingCounts = z.infer<typeof AuthorityPendingCountsSchema>;
export type AuthorityCopyInspection = z.infer<typeof AuthorityCopyInspectionSchema>;
export type AuthorityBackupManifest = z.infer<typeof AuthorityBackupManifestSchema>;
export type AuthorityBackupManifestV3 = z.infer<typeof AuthorityBackupManifestV3Schema>;
export type AuthorityBackupRequest = z.infer<typeof AuthorityBackupRequestSchema>;
export type AuthorityBackupRunReport = z.infer<typeof AuthorityBackupRunReportSchema>;
export type StorageHealthCause = z.infer<typeof StorageHealthCauseSchema>;
export type SpanAuthorityRunResolution = z.infer<typeof SpanAuthorityRunResolutionSchema>;
export type SpanAuthorityRunRoot = z.infer<typeof SpanAuthorityRunRootSchema>;
export type SpanAuthorityReadSnapshot = z.infer<typeof SpanAuthorityReadSnapshotSchema>;
export type SpanAuthorityReconciliation = z.infer<typeof SpanAuthorityReconciliationSchema>;
export type AuthorityBootReport = z.infer<typeof AuthorityBootReportSchema>;
export type RestoreCandidate = z.infer<typeof RestoreCandidateSchema>;
export type StorageDoctorReport = z.infer<typeof StorageDoctorReportSchema>;
export type RecoveryRuntimeLockSnapshot = z.infer<typeof RecoveryRuntimeLockSnapshotSchema>;
export type StoppedSystemProof = z.infer<typeof StoppedSystemProofSchema>;
export type OfflineRestoreReport = z.infer<typeof OfflineRestoreReportSchema>;
