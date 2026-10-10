/** The workflow-run BATCH (historical API name: session) — a dashboard-started group of N runs whose membership is derived from authority, never stored. */
import { z } from "zod";
import {
  ActorIdSchema,
  IntakeManifestIdSchema,
  IsoInstantSchema,
  RunIdSchema,
  RunSessionIdSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

/** Where the group came from; every arm names the durable record that minted the fan-out. */
export const RunSessionOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start-plan"), startPlanId: StartPlanIdSchema, actorId: ActorIdSchema }),
  z.strictObject({ kind: z.literal("intake-manifest"), intakeManifestId: IntakeManifestIdSchema, actorId: ActorIdSchema }),
  z.strictObject({ kind: z.literal("archive-relaunch"), archivedRunId: RunIdSchema, actorId: ActorIdSchema }),
]);
export type RunSessionOrigin = z.infer<typeof RunSessionOriginSchema>;

export const RunSessionRecordSchema = z.strictObject({
  sessionId: RunSessionIdSchema,
  /** A session groups runs of ONE workflow (§11.1); two workflows are two sessions. */
  workflow: WorkflowIdSchema,
  origin: RunSessionOriginSchema,
  /** The enqueue instant — the same `now` every member's `enqueuedAt` carries. */
  startedAt: IsoInstantSchema,
  createdAt: IsoInstantSchema,
  /** Queue presentation only; membership and execution never depend on this flag. */
  groupInQueue: z.boolean().default(false),
  version: z.number().int().positive().default(1),
}).superRefine((record, context) => {
  if (record.createdAt !== record.startedAt) {
    context.addIssue({
      code: "custom",
      path: ["createdAt"],
      message: "a run session is created at the instant it starts; the two instants are one fact",
    });
  }
});
export type RunSessionRecord = z.infer<typeof RunSessionRecordSchema>;

/** The actor who started the session. */
export function runSessionActorId(record: RunSessionRecord): string {
  return record.origin.actorId;
}

/** Strict reader for retained pre-v33 batch records; validates the original date invariant too. */
export const HistoricalRunSessionRecordSchema = z.strictObject(RunSessionRecordSchema.shape)
  .omit({ groupInQueue: true, version: true }).transform((record) => RunSessionRecordSchema.parse(record));
