/**
 * The run SESSION — a dashboard-started group of N runs (ref execution-and-sessions
 * §11, D269).
 *
 * It is not a browser session (§1), not a worker and not a workflow: it is what
 * an operator starts when they dispatch a batch — ten I-9 members, a
 * separations list — and it is the unit the dashboard reports progress
 * against. The row is DURABLE and insert-only: it has an id, a workflow, who
 * started it, the instant, and its origin. What it deliberately does NOT have
 * is a member list. Membership is DERIVED from authority — every run row a
 * fan-out enqueues carries this id in `RunRecord.sessionId` — so the group
 * survives a restart without any process remembering it, and a session can
 * never claim a member the run table does not show (§11.1, §11.3).
 *
 * One session per fan-out, N ≥ 1. There is no threshold: a single typed
 * subject is a group of one, and choosing a minimum would put a judgment call
 * where a rule belongs. A RETRY mints no session of its own — it is the same
 * item's next attempt (D221) and inherits the retried run's session, so the
 * group the operator started keeps reporting the item it contains.
 */
import { z } from "zod";
import {
  ActorIdSchema,
  CaptureSessionIdSchema,
  IntakeManifestIdSchema,
  IsoInstantSchema,
  RunIdSchema,
  RunSessionIdSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

/**
 * Where the group came from. Every arm names the durable record that minted
 * the fan-out; the three operator-driven arms carry the actor the command
 * recorded. The capture handoff carries NO actor on purpose: it runs inside
 * the finalize projector's settlement, the capture session row stores no
 * operator identity, and writing `local-operator` there would be a value
 * nobody recorded.
 */
export const RunSessionOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start-plan"), startPlanId: StartPlanIdSchema, actorId: ActorIdSchema }),
  z.strictObject({ kind: z.literal("intake-manifest"), intakeManifestId: IntakeManifestIdSchema, actorId: ActorIdSchema }),
  z.strictObject({ kind: z.literal("archive-relaunch"), archivedRunId: RunIdSchema, actorId: ActorIdSchema }),
  z.strictObject({
    kind: z.literal("capture-handoff"),
    captureSessionId: CaptureSessionIdSchema,
    intakeManifestId: IntakeManifestIdSchema,
  }),
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

/** The actor who started the session, or `undefined` for the one origin that records none. */
export function runSessionActorId(record: RunSessionRecord): string | undefined {
  return record.origin.kind === "capture-handoff" ? undefined : record.origin.actorId;
}
