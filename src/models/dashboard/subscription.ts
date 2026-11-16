import { z } from "zod";
import { ActorIdSchema, LocalDateSchema, FingerprintSchema, ProjectionCursorSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { DashboardWireVersionSchema, ProjectionGenerationSchema, RowRevisionSchema } from "./primitives.js";
import { DashboardDayWireSchema, NotificationWireSchema, QueueSurfaceWireSchema } from "./projection.js";

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

const SnapshotEnvelopeSchema = z.strictObject({ type: z.literal("snapshot"), topic: z.literal("dashboard-day"), cursor: ProjectionCursorSchema, payload: DashboardDayWireSchema });
const PatchEnvelopeSchema = z.strictObject({ type: z.literal("patch"), topic: z.literal("dashboard-day"), cursor: ProjectionCursorSchema, payload: DashboardDayPatchSchema });

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
  PatchEnvelopeSchema,
  ResetRequiredEnvelopeSchema,
  HealthEnvelopeSchema,
]);

export type DashboardStreamEnvelope = z.infer<typeof DashboardStreamEnvelopeSchema>;
