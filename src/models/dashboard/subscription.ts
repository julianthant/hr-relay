import { z } from "zod";
import { ActorIdSchema, LocalDateSchema, FingerprintSchema, ProjectionCursorSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { DashboardWireVersionSchema, ProjectionGenerationSchema, RowRevisionSchema, WireErrorSchema } from "./primitives.js";
import { DashboardDayWireSchema, NotificationWireSchema, QueueSurfaceWireSchema } from "./projection.js";
import { NotePageSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "./run-detail.js";

const QueueReplacementPatchSchema = z.strictObject({
  operation: z.literal("replace-queue-surface"),
  target: z.strictObject({ runId: RunIdSchema, rowRevision: RowRevisionSchema }),
  replacement: QueueSurfaceWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.runId !== patch.replacement.runId || patch.target.rowRevision !== patch.replacement.rowRevision) {
    context.addIssue({ code: "custom", path: ["replacement"], message: "queue replacement identity and revision must match its target" });
  }
});
const QueueRemovalPatchSchema = z.strictObject({
  operation: z.enum(["remove-queue-surface", "tombstone-queue-surface"]),
  target: z.strictObject({ runId: RunIdSchema, rowRevision: RowRevisionSchema }),
  reason: z.string().min(1),
});
export const DashboardDayPatchSchema = z.union([QueueReplacementPatchSchema, QueueRemovalPatchSchema]);

const HelloEnvelopeSchema = z.strictObject({
  type: z.literal("hello"),
  wireVersion: DashboardWireVersionSchema,
  descriptorHash: FingerprintSchema,
  projectionGeneration: ProjectionGenerationSchema,
  cursor: ProjectionCursorSchema,
});
const ResetRequiredEnvelopeSchema = z.strictObject({
  type: z.literal("reset-required"),
  reason: z.enum(["cursor-expired", "generation-changed", "descriptor-changed"]),
  cursor: ProjectionCursorSchema,
});
const HealthEnvelopeSchema = z.strictObject({
  type: z.literal("health"),
  state: z.enum(["live", "reconnecting", "degraded"]),
});

/** Everything the run panel holds: the detail, the whole log in one page, and the panel's available sections.
 * A refused read carries the wire error its route would have answered. */
export const RunPanelSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("available"),
    detail: RunDetailWireSchema,
    logs: NotePageSchema,
    sections: z.array(RunDetailSectionResponseSchema),
  }).superRefine((panel, context) => {
    if (panel.logs.runId !== panel.detail.runId) context.addIssue({ code: "custom", path: ["logs"], message: "run panel logs must belong to its run" });
    if (panel.logs.nextCursor.state !== "absent") context.addIssue({ code: "custom", path: ["logs"], message: "run panel logs carry every page" });
  }),
  z.strictObject({ state: z.literal("refused"), error: WireErrorSchema }),
]);
export type RunPanel = z.infer<typeof RunPanelSchema>;

/** A whole read-model value for one `(model, key)`; it replaces the held value and is never patched. */
export const StreamRowSchema = z.discriminatedUnion("model", [
  z.strictObject({ model: z.literal("run-panel"), key: RunIdSchema, value: RunPanelSchema }).superRefine((row, context) => {
    if (row.value.state === "available" && row.value.detail.runId !== row.key) context.addIssue({ code: "custom", path: ["value"], message: "run panel must belong to its key" });
  }),
]);
export type StreamRow = z.infer<typeof StreamRowSchema>;

/** The highest `timeline_events.cursor` the projection had folded when it built the envelope. */
const TimelinePositionSchema = z.number().int().nonnegative();

const SnapshotEnvelopeSchema = z.strictObject({
  type: z.literal("snapshot"), topic: z.literal("dashboard-day"), cursor: ProjectionCursorSchema,
  position: TimelinePositionSchema, payload: DashboardDayWireSchema,
  /** The current value of every row model in the connection's topics. */
  rows: z.array(StreamRowSchema),
});
/** `after` is the cursor of the previous `change` or `snapshot` sent on the same connection.
 * A `change` without a `day` part or rows moves the cursor only. */
const ChangeEnvelopeSchema = z.strictObject({
  type: z.literal("change"),
  topic: z.literal("dashboard-day"),
  cursor: ProjectionCursorSchema,
  after: ProjectionCursorSchema,
  position: TimelinePositionSchema,
  day: DashboardDayPatchSchema.optional(),
  rows: z.array(StreamRowSchema),
});

export const NotificationPublicationWireSchema = z.strictObject({
  sourceId: FingerprintSchema,
  actorId: ActorIdSchema,
  durable: z.enum(["created", "folded"]),
  notification: NotificationWireSchema,
}).superRefine((publication, context) => {
  if (publication.actorId !== publication.notification.actorId) context.addIssue({ code: "custom", path: ["actorId"], message: "notification publication actor must match its row" });
});
export type NotificationPublicationWire = z.infer<typeof NotificationPublicationWireSchema>;

const NotificationPublicationEnvelopeSchema = z.strictObject({
  type: z.literal("notification-publication"),
  day: LocalDateSchema,
  descriptorHash: FingerprintSchema,
  projectionGeneration: ProjectionGenerationSchema,
  publication: NotificationPublicationWireSchema,
});

export const DashboardStreamEnvelopeSchema = z.union([
  HelloEnvelopeSchema,
  NotificationPublicationEnvelopeSchema,
  SnapshotEnvelopeSchema,
  ChangeEnvelopeSchema,
  ResetRequiredEnvelopeSchema,
  HealthEnvelopeSchema,
]);

export type DashboardStreamEnvelope = z.infer<typeof DashboardStreamEnvelopeSchema>;
