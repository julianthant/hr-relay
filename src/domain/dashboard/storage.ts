/**
 * The storage doctor wire (ref dashboard-surfaces §2.5, 2i-D): the read-only recovery report
 * the Settings surface and `cli storage doctor` both render.
 *
 * This is a browser-safe PROJECTION of `src/infra/sqlite/recovery-contracts.ts`
 * — the infra schemas pin literals (application id, current schema version)
 * and closed cause vocabularies that belong to the storage layer; the wire
 * carries the same facts as plain strings/numbers so the dashboard bundle
 * never reaches into `src/infra`. The server builds this ONLY from a parsed
 * infra report, so a value here is never weaker than its source — just
 * unpinned from constants the client has no business embedding.
 */
import { z } from "zod";
import { IsoInstantSchema, RunIdSchema } from "../ids.js";

const NonNegativeIntSchema = z.number().int().nonnegative();

/** `{code, summary}` off `StorageHealthCauseSchema`; the closed code vocabulary lives in infra. */
export const StorageCauseWireSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
});

export const RestoreCandidateWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("verified-compatible"),
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
  durableOutbox: NonNegativeIntSchema,
  runTerminalOutbox: NonNegativeIntSchema,
  providerReservations: NonNegativeIntSchema,
  artifactOutbox: NonNegativeIntSchema,
  captureFinalizationOutboxes: NonNegativeIntSchema,
});

/**
 * What the live BACKUP SERVICE last did — a fact the on-disk doctor cannot
 * see (a failed run leaves no manifest behind), so it rides the wire beside
 * the report instead of being inferred from backup age alone.
 */
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

export const StorageSpanAuthorityWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
    problems: z.array(z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("missing"), runId: RunIdSchema }),
      z.strictObject({
        state: z.literal("malformed"),
        runId: RunIdSchema,
        table: z.enum(["tasks", "archived_runs"]),
        summary: z.string().min(1),
      }),
    ])).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
]);

export const StorageDoctorWireSchema = z.strictObject({
  mode: z.literal("read-only"),
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
  spanAuthority: StorageSpanAuthorityWireSchema,
  backup: BackupHealthWireSchema,
  restoreCandidates: z.array(RestoreCandidateWireSchema),
  service: BackupServiceStateWireSchema,
});

export type StorageDoctorWire = z.infer<typeof StorageDoctorWireSchema>;
export type BackupServiceStateWire = z.infer<typeof BackupServiceStateWireSchema>;
