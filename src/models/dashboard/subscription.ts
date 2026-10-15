import { z } from "zod";
import { ActorIdSchema, LocalDateSchema, ArtifactIdSchema, FingerprintSchema, NoteIdSchema, ProjectionCursorSchema, ReviewRecordIdSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { ArtifactResourceWireSchema } from "./artifacts.js";
import { DashboardWireVersionSchema, ProjectionGenerationSchema, RecordRevisionSchema, RowRevisionSchema } from "./primitives.js";
import { DashboardDayWireSchema, NotificationWireSchema, QueueSurfaceWireSchema } from "./projection.js";
import {
  NotePageSchema,
  NoteWireSchema,
  PeopleMemberWireSchema,
  PeoplePageSchema,
  ReviewPageSchema,
  ReviewRecordWireSchema,
  RunDetailWireSchema,
} from "./run-detail.js";

export const TopicKeySchema = z.enum([
  "dashboard-day", "run-detail", "run-logs", "run-review", "run-people", "artifact",
]);

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

export const RunDetailPatchSchema = z.strictObject({
  operation: z.literal("replace-run-detail"),
  target: z.strictObject({ runId: RunIdSchema, rowRevision: RowRevisionSchema }),
  replacement: RunDetailWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.runId !== patch.replacement.runId || patch.target.rowRevision !== patch.replacement.rowRevision) {
    context.addIssue({ code: "custom", path: ["replacement"], message: "run-detail replacement identity and revision must match its target" });
  }
});

export const NoteAppendPatchSchema = z.strictObject({
  operation: z.literal("append-note"),
  target: z.strictObject({ runId: RunIdSchema, noteId: NoteIdSchema }),
  note: NoteWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.runId !== patch.note.runId || patch.target.noteId !== patch.note.noteId) {
    context.addIssue({ code: "custom", path: ["note"], message: "note identity must match its append target" });
  }
});

export const ReviewReplacementPatchSchema = z.strictObject({
  operation: z.literal("replace-review-record"),
  target: z.strictObject({ recordId: ReviewRecordIdSchema, recordRevision: RecordRevisionSchema }),
  replacement: ReviewRecordWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.recordId !== patch.replacement.recordId || patch.target.recordRevision !== patch.replacement.recordRevision) {
    context.addIssue({ code: "custom", path: ["replacement"], message: "review replacement identity and revision must match its target" });
  }
});

export const PeopleReplacementPatchSchema = z.strictObject({
  operation: z.literal("replace-person"),
  target: z.strictObject({ runId: RunIdSchema, rowRevision: RowRevisionSchema }),
  replacement: PeopleMemberWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.runId !== patch.replacement.runId || patch.target.rowRevision !== patch.replacement.rowRevision) {
    context.addIssue({ code: "custom", path: ["replacement"], message: "people replacement identity and revision must match its target" });
  }
});

function resourceArtifactId(resource: z.infer<typeof ArtifactResourceWireSchema>): string {
  return resource.state === "available" ? resource.value.artifactId : resource.artifactId;
}

export const ArtifactReplacementPatchSchema = z.strictObject({
  operation: z.literal("replace-artifact-resource"),
  target: z.strictObject({ artifactId: ArtifactIdSchema }),
  replacement: ArtifactResourceWireSchema,
}).superRefine((patch, context) => {
  if (patch.target.artifactId !== resourceArtifactId(patch.replacement)) {
    context.addIssue({ code: "custom", path: ["replacement"], message: "artifact replacement identity must match its target" });
  }
});

export const DashboardTopicSnapshotSchema = z.discriminatedUnion("topic", [
  z.strictObject({ topic: z.literal("dashboard-day"), payload: DashboardDayWireSchema }),
  z.strictObject({ topic: z.literal("run-detail"), payload: RunDetailWireSchema }),
  z.strictObject({ topic: z.literal("run-logs"), payload: NotePageSchema }),
  z.strictObject({ topic: z.literal("run-review"), payload: ReviewPageSchema }),
  z.strictObject({ topic: z.literal("run-people"), payload: PeoplePageSchema }),
  z.strictObject({ topic: z.literal("artifact"), payload: ArtifactResourceWireSchema }),
]);

export const DashboardTopicPatchSchema = z.discriminatedUnion("topic", [
  z.strictObject({ topic: z.literal("dashboard-day"), payload: DashboardDayPatchSchema }),
  z.strictObject({ topic: z.literal("run-detail"), payload: RunDetailPatchSchema }),
  z.strictObject({ topic: z.literal("run-logs"), payload: NoteAppendPatchSchema }),
  z.strictObject({ topic: z.literal("run-review"), payload: ReviewReplacementPatchSchema }),
  z.strictObject({ topic: z.literal("run-people"), payload: PeopleReplacementPatchSchema }),
  z.strictObject({ topic: z.literal("artifact"), payload: ArtifactReplacementPatchSchema }),
]);

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

const SnapshotEnvelopeSchemas = [
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("dashboard-day"), cursor: ProjectionCursorSchema, payload: DashboardDayWireSchema }),
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("run-detail"), cursor: ProjectionCursorSchema, payload: RunDetailWireSchema }),
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("run-logs"), cursor: ProjectionCursorSchema, payload: NotePageSchema }),
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("run-review"), cursor: ProjectionCursorSchema, payload: ReviewPageSchema }),
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("run-people"), cursor: ProjectionCursorSchema, payload: PeoplePageSchema }),
  z.strictObject({ type: z.literal("snapshot"), topic: z.literal("artifact"), cursor: ProjectionCursorSchema, payload: ArtifactResourceWireSchema }),
] as const;
const PatchEnvelopeSchemas = [
  z.strictObject({ type: z.literal("patch"), topic: z.literal("dashboard-day"), cursor: ProjectionCursorSchema, payload: DashboardDayPatchSchema }),
  z.strictObject({ type: z.literal("patch"), topic: z.literal("run-detail"), cursor: ProjectionCursorSchema, payload: RunDetailPatchSchema }),
  z.strictObject({ type: z.literal("patch"), topic: z.literal("run-logs"), cursor: ProjectionCursorSchema, payload: NoteAppendPatchSchema }),
  z.strictObject({ type: z.literal("patch"), topic: z.literal("run-review"), cursor: ProjectionCursorSchema, payload: ReviewReplacementPatchSchema }),
  z.strictObject({ type: z.literal("patch"), topic: z.literal("run-people"), cursor: ProjectionCursorSchema, payload: PeopleReplacementPatchSchema }),
  z.strictObject({ type: z.literal("patch"), topic: z.literal("artifact"), cursor: ProjectionCursorSchema, payload: ArtifactReplacementPatchSchema }),
] as const;

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
  ...SnapshotEnvelopeSchemas,
  ...PatchEnvelopeSchemas,
  ResetRequiredEnvelopeSchema,
  HealthEnvelopeSchema,
]);

export type DashboardStreamEnvelope = z.infer<typeof DashboardStreamEnvelopeSchema>;
