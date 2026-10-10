import { ProtectedSettingsPresenceEntriesSchema } from "../config/protected-settings.js";
/** The storage doctor wire: a browser-safe projection of the recovery report, built only from a parsed infra report so a value here is never weaker than its source. */
import { z } from "zod";
import { CommandIdSchema, IsoInstantSchema, RunIdSchema, TraceIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

const NonNegativeIntSchema = z.number().int().nonnegative();
const StorageDiagnosticMessageSchema = z.string().min(1);

/** `{code, summary}` off `StorageHealthCauseSchema`; the closed code vocabulary lives in infra. */
export const StorageCauseWireSchema = z.strictObject({
  code: z.string().min(1),
  summary: StorageDiagnosticMessageSchema,
});

const RecoveryFindingSchema = z.strictObject({
  marker: z.enum(["authority-restore", "unowned-recovery-entry"]),
  state: z.enum(["interrupted", "unavailable"]),
});
export const StorageRecoveryInspectionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("clear") }),
  z.strictObject({ state: z.literal("interrupted"), findings: z.array(RecoveryFindingSchema).min(1) }),
  z.strictObject({ state: z.literal("unavailable"), findings: z.array(RecoveryFindingSchema), cause: StorageCauseWireSchema }),
]);
const RestoreEligibilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("eligible") }),
  z.strictObject({ state: z.literal("unsupported"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("incomplete"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);

export const RestoreCandidateWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("verified-compatible"),
    selection: z.literal("single-database"),
    schemaVersion: z.number().int().positive(),
    restoreEligibility: RestoreEligibilitySchema,
    manifestFileName: z.string().min(1),
    backupFileName: z.string().min(1),
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
    manifestFileName: z.string().min(1),
    cause: StorageCauseWireSchema,
  }),
]);

export const PreviousLocationBackupWireSchema = z.strictObject({
  selection: z.literal("single-database"),
  schemaVersion: z.number().int().positive(),
  manifestFileName: z.string().min(1),
  backupFileName: z.string().min(1),
  createdAt: IsoInstantSchema,
  authorityGeneration: NonNegativeIntSchema,
  restoreEligibility: z.literal("not-admitted"),
});

export const BackupHealthWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("current"),
    latest: RestoreCandidateWireSchema.options[0],
  }),
  z.strictObject({
    state: z.literal("stale"),
    latest: RestoreCandidateWireSchema.options[0],
    cause: StorageCauseWireSchema,
  }),
  z.strictObject({ state: z.literal("missing"), cause: StorageCauseWireSchema }),
  z.strictObject({ state: z.literal("invalid"), cause: StorageCauseWireSchema }),
]);

export const StoragePendingCountsWireSchema = z.strictObject({
  pendingCommands: NonNegativeIntSchema,
  unresolvedWriteIntents: NonNegativeIntSchema,
  leases: NonNegativeIntSchema,
  providerReservations: NonNegativeIntSchema,
  artifactOutbox: NonNegativeIntSchema,
});

/** What the live BACKUP SERVICE last did: a fact the on-disk doctor cannot see (a failed run leaves no manifest), so it rides the wire rather than being inferred from backup age. */
export const BackupServiceStateWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-run"), reason: z.string().min(1) }),
  z.strictObject({
    state: z.literal("ok"),
    finishedAt: IsoInstantSchema,
    finalGeneration: NonNegativeIntSchema,
  }),
  z.strictObject({
    state: z.literal("failed"),
    failedAt: IsoInstantSchema,
    message: z.string().min(1),
  }),
]);

/** A span root whose run was deleted: span files are never rewritten, so the root survives its run and the tombstone is what accounts for it. */
const DeletedSpanAuthorityWireSchema = z.strictObject({
  runId: RunIdSchema,
  workflow: WorkflowIdSchema,
  traceId: TraceIdSchema,
  origin: z.enum(["queue", "archive"]),
  commandId: CommandIdSchema,
  deletedAt: IsoInstantSchema,
});

export const SpanAuthorityReconciliationWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
    deleted: z.array(DeletedSpanAuthorityWireSchema),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
    deleted: z.array(DeletedSpanAuthorityWireSchema),
    problems: z.array(z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("missing"), runId: RunIdSchema, possibleExternalWrite: z.literal(true).optional() }),
      z.strictObject({ state: z.literal("restore-loss"), runId: RunIdSchema, possibleExternalWrite: z.literal(true).optional() }),
      z.strictObject({ state: z.literal("missing-span"), runId: RunIdSchema }),
      z.strictObject({
        state: z.literal("malformed-authority"),
        source: z.enum(["current", "archived"]),
        recordKey: z.string().min(1),
        summary: StorageDiagnosticMessageSchema,
      }),
      z.strictObject({
        state: z.literal("malformed"),
        runId: RunIdSchema,
        table: z.enum(["runs", "archived_runs", "span_stream", "deleted_runs"]),
        summary: StorageDiagnosticMessageSchema,
      }),
    ])).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
]);

export const ProtectedSettingsInspectionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), entries: ProtectedSettingsPresenceEntriesSchema }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
]);

const AuthorityUpgradeInspectionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), phases: z.array(z.strictObject({
    phase: z.enum(["baseline", "planned", "committed", "settled"]),
    fromSchemaVersion: NonNegativeIntSchema,
    toSchemaVersion: z.number().int().positive(),
    recordedAt: IsoInstantSchema,
  })).min(1) }),
  z.strictObject({ state: z.literal("absent"), reason: z.enum(["pre-journal-schema", "journal-empty"]) }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
]);

export const StorageDoctorWireSchema = z.strictObject({
  recovery: StorageRecoveryInspectionWireSchema,
  mode: z.literal("read-only"),
  authorityUpgrades: AuthorityUpgradeInspectionWireSchema,
  protectedSettings: ProtectedSettingsInspectionWireSchema,
  checkedAt: IsoInstantSchema,
  authority: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("healthy"),
      schemaVersion: z.number().int().positive(),
      authorityGeneration: NonNegativeIntSchema,
      pageCount: z.number().int().positive(),
    }),
    z.strictObject({ state: z.literal("degraded"), cause: StorageCauseWireSchema }),
  ]),
  counts: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), values: StoragePendingCountsWireSchema }),
    z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
  ]),
  spanAuthority: SpanAuthorityReconciliationWireSchema,
  backup: BackupHealthWireSchema,
  restoreCandidates: z.array(RestoreCandidateWireSchema),
  previousLocationBackups: z.array(PreviousLocationBackupWireSchema).optional(),
  service: BackupServiceStateWireSchema,
});

export type StorageDoctorWire = z.infer<typeof StorageDoctorWireSchema>;
export type BackupServiceStateWire = z.infer<typeof BackupServiceStateWireSchema>;

export const StorageDoctorLatestWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-run") }),
  z.strictObject({ state: z.literal("completed"), report: StorageDoctorWireSchema }),
]);
export type StorageDoctorLatestWire = z.infer<typeof StorageDoctorLatestWireSchema>;
