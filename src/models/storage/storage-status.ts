/** The one storage status definition: the backend doctor report and the dashboard wire are both built from these schema objects. */
import { z } from "zod";
import { AuthorityUpgradePhaseSchema } from "../config/authority.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../config/authority-schema-versions.js";
import { ProtectedSettingsPresenceEntriesSchema } from "../config/protected-settings.js";
import { DeletedRunOriginSchema } from "../run/deleted-run.js";
import { CommandIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, TraceIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

const NonNegativeIntSchema = z.number().int().nonnegative();
const DiagnosticTextSchema = z.string().min(1);
export const SafeFileNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

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
  summary: DiagnosticTextSchema,
});
export type StorageHealthCause = z.infer<typeof StorageHealthCauseSchema>;
type StorageHealthCauseCode = StorageHealthCause["code"];

function causeWithCode<Code extends StorageHealthCauseCode>(code: Code) {
  return StorageHealthCauseSchema.extend({ code: z.literal(code) });
}

const RecoveryFindingSchema = z.strictObject({
  marker: z.enum(["authority-restore", "unowned-recovery-entry"]),
  state: z.enum(["interrupted", "unavailable"]),
});
export const StorageRecoveryInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("clear") }),
  z.strictObject({ state: z.literal("interrupted"), findings: z.array(RecoveryFindingSchema).min(1) }),
  z.strictObject({ state: z.literal("unavailable"), findings: z.array(RecoveryFindingSchema), cause: causeWithCode("authority-unavailable") }),
]);

export const RestoreEligibilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("eligible") }),
  z.strictObject({ state: z.literal("unsupported"), reason: DiagnosticTextSchema }),
  z.strictObject({ state: z.literal("unavailable"), reason: DiagnosticTextSchema }),
]);

const VerifiedRestoreCandidateSchema = z.strictObject({
  state: z.literal("verified-compatible"),
  selection: z.literal("single-database"),
  schemaVersion: PositiveIntSchema,
  restoreEligibility: RestoreEligibilitySchema,
  manifestFileName: SafeFileNameSchema,
  backupFileName: SafeFileNameSchema,
  createdAt: IsoInstantSchema,
  authorityGeneration: NonNegativeIntSchema,
  ageMs: NonNegativeIntSchema,
  generationGap: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value: NonNegativeIntSchema }),
    z.strictObject({ state: z.literal("unavailable"), reason: DiagnosticTextSchema }),
  ]),
});
export const RestoreCandidateSchema = z.discriminatedUnion("state", [
  VerifiedRestoreCandidateSchema,
  z.strictObject({ state: z.literal("invalid"), manifestFileName: SafeFileNameSchema, cause: StorageHealthCauseSchema }),
]);
export type RestoreCandidate = z.infer<typeof RestoreCandidateSchema>;

/** `invalid` keeps any cause: the doctor forwards the newest candidate's own cause. */
export const BackupHealthSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("current"), latest: VerifiedRestoreCandidateSchema }),
  z.strictObject({ state: z.literal("stale"), latest: VerifiedRestoreCandidateSchema, cause: causeWithCode("backup-stale") }),
  z.strictObject({ state: z.literal("missing"), cause: causeWithCode("backup-missing") }),
  z.strictObject({ state: z.literal("invalid"), cause: StorageHealthCauseSchema }),
]);

/** What the live backup service last did: a failed run leaves no manifest, so the on-disk doctor cannot infer it. */
export const BackupServiceStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-run"), reason: DiagnosticTextSchema }),
  z.strictObject({ state: z.literal("ok"), finishedAt: IsoInstantSchema, finalGeneration: NonNegativeIntSchema }),
  z.strictObject({ state: z.literal("failed"), failedAt: IsoInstantSchema, message: DiagnosticTextSchema }),
]);
export type BackupServiceState = z.infer<typeof BackupServiceStateSchema>;

/** A span root whose run was deleted: the tombstone is what accounts for it. */
export const DeletedSpanAuthoritySchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  traceId: TraceIdSchema,
  origin: DeletedRunOriginSchema,
  commandId: CommandIdSchema,
  deletedAt: IsoInstantSchema,
});
export const MissingSpanAuthorityRunSchema = z.strictObject({ state: z.literal("missing"), runId: RunIdSchema, possibleExternalWrite: z.literal(true).optional() });
export const MalformedSpanAuthorityRunSchema = z.strictObject({
  state: z.literal("malformed"),
  runId: RunIdSchema,
  table: z.enum(["span_stream", "runs", "archived_runs", "deleted_runs"]),
  summary: DiagnosticTextSchema,
});
export const MalformedAuthorityRecordSchema = z.strictObject({
  state: z.literal("malformed-authority"),
  source: z.enum(["current", "archived"]),
  recordKey: DiagnosticTextSchema,
  summary: DiagnosticTextSchema,
});

/** `deleted` is accounted, so it is never a problem arm. */
const SpanAuthorityProblemSchema = z.discriminatedUnion("state", [
  MissingSpanAuthorityRunSchema,
  z.strictObject({ state: z.literal("restore-loss"), runId: RunIdSchema, possibleExternalWrite: z.literal(true).optional() }),
  MalformedSpanAuthorityRunSchema,
  z.strictObject({ state: z.literal("missing-span"), runId: RunIdSchema }),
  MalformedAuthorityRecordSchema,
]);

export const SpanAuthorityReconciliationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    deleted: z.array(DeletedSpanAuthoritySchema),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    deleted: z.array(DeletedSpanAuthoritySchema),
    problems: z.array(SpanAuthorityProblemSchema).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);
export type SpanAuthorityReconciliation = z.infer<typeof SpanAuthorityReconciliationSchema>;

export const ProtectedSettingsInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), entries: ProtectedSettingsPresenceEntriesSchema }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

export const AuthorityUpgradeInspectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), phases: z.array(z.strictObject({
    phase: AuthorityUpgradePhaseSchema,
    fromSchemaVersion: NonNegativeIntSchema,
    toSchemaVersion: PositiveIntSchema,
    recordedAt: IsoInstantSchema,
  })).min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.literal("journal-empty") }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

export const AuthorityPendingCountsSchema = z.strictObject({
  pendingCommands: NonNegativeIntSchema,
  unresolvedWriteIntents: NonNegativeIntSchema,
  providerReservations: NonNegativeIntSchema,
  artifactOutbox: NonNegativeIntSchema,
});
export type AuthorityPendingCounts = z.infer<typeof AuthorityPendingCountsSchema>;

export const DoctorCountsSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), values: AuthorityPendingCountsSchema }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageHealthCauseSchema }),
]);

/** The copy-inspection fields the dashboard may see; the backend inspection is built from these same field schemas. */
export const AuthorityInspectionSummarySchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  authorityGeneration: NonNegativeIntSchema,
  pageCount: PositiveIntSchema,
});

/** The one doctor-authority vocabulary: the backend report and the wire build their arms from these. */
export const StorageAuthorityStateSchema = z.enum(["healthy", "degraded"]);
export const HealthyAuthorityStateSchema = StorageAuthorityStateSchema.extract(["healthy"]);
export const DegradedDoctorAuthoritySchema = z.strictObject({ state: StorageAuthorityStateSchema.extract(["degraded"]), cause: StorageHealthCauseSchema });

export const DoctorAuthorityWireSchema = z.discriminatedUnion("state", [
  AuthorityInspectionSummarySchema.extend({ state: HealthyAuthorityStateSchema }),
  DegradedDoctorAuthoritySchema,
]);

/** Whether the bootstrap could read authority metadata: a different fact from doctor health. */
export const StorageAuthoritySummarySchema = z.strictObject({
  authority: z.enum(["healthy", "unavailable"]),
});
export type StorageAuthoritySummary = z.infer<typeof StorageAuthoritySummarySchema>;
