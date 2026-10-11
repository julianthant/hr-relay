/** A dashboard-started workflow batch whose membership is derived from authority. */
import { z } from "zod";
import {
  ActorIdSchema,
  IntakeManifestIdSchema,
  IsoInstantSchema,
  RunSessionIdSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

/** Where the group came from; every arm names the durable record that minted the fan-out. */
export const RunSessionOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start-plan"), startPlanId: StartPlanIdSchema, actorId: ActorIdSchema }),
  z.strictObject({ kind: z.literal("intake-manifest"), intakeManifestId: IntakeManifestIdSchema, actorId: ActorIdSchema }),
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
