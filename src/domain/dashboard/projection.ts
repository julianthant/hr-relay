import { z } from "zod";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  LocalDateSchema,
  NotificationIdSchema,
  ProjectionCursorSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import {
  AppVersionSchema,
  PanelKindSchema,
  ProjectionGenerationSchema,
  RowRevisionSchema,
  RunDetailSectionSchema,
} from "./primitives.js";

const ParentRunSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("root") }),
  z.strictObject({ state: z.literal("child"), parentRunId: RunIdSchema }),
]);

const ResolvedInstanceSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  instance: z.enum(["prod", "test"]),
});

export const QueueStatusSchema = z.enum([
  "queued", "running", "blocked", "awaiting-approval", "done", "failed", "cancelled", "partial",
]);

const PipelineStepWireSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  state: z.enum(["pending", "active", "done", "failed", "skipped", "blocked"]),
});

const QueueBaseFields = {
  runId: RunIdSchema,
  itemId: ItemIdSchema,
  workflowId: WorkflowIdSchema,
  traceId: TraceIdSchema,
  attempt: z.number().int().positive(),
  lineage: ParentRunSchema,
  actorId: ActorIdSchema,
  appVersion: AppVersionSchema,
  descriptorHash: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  resolvedInstances: z.array(ResolvedInstanceSchema),
  startedAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
  title: z.string().min(1),
  subtitle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  status: QueueStatusSchema,
  liveMessage: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  pipeline: z.array(PipelineStepWireSchema),
  panelKind: PanelKindSchema,
  availableSections: z.array(RunDetailSectionSchema),
  rowRevision: RowRevisionSchema,
} as const;

const RegularQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.enum(["single", "preview"]),
});
const MemberQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.literal("member"),
}).superRefine((surface, context) => {
  if (surface.lineage.state !== "child") {
    context.addIssue({ code: "custom", path: ["lineage"], message: "member surfaces require a parent run" });
  }
});
const OperationQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.literal("operation"),
  memberRunIds: z.array(RunIdSchema),
  memberRollup: z.strictObject({
    total: z.number().int().nonnegative(),
    terminal: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
}).superRefine((surface, context) => {
  if (new Set(surface.memberRunIds).size !== surface.memberRunIds.length) {
    context.addIssue({ code: "custom", path: ["memberRunIds"], message: "operation member ids must be unique" });
  }
  if (surface.memberRollup.total !== surface.memberRunIds.length) {
    context.addIssue({ code: "custom", path: ["memberRollup", "total"], message: "operation rollup total must match member ids" });
  }
  if (surface.memberRollup.terminal > surface.memberRollup.total || surface.memberRollup.failed > surface.memberRollup.terminal) {
    context.addIssue({ code: "custom", path: ["memberRollup"], message: "operation rollup counts are inconsistent" });
  }
});

export const QueueSurfaceWireSchema = z.union([
  RegularQueueSurfaceWireSchema,
  MemberQueueSurfaceWireSchema,
  OperationQueueSurfaceWireSchema,
]);

export const DayCountWireSchema = z.strictObject({ day: LocalDateSchema, count: z.number().int().nonnegative() });
export const WorkflowCountWireSchema = z.strictObject({ workflowId: WorkflowIdSchema, count: z.number().int().nonnegative() });
export const StatusCountWireSchema = z.strictObject({ status: QueueStatusSchema, count: z.number().int().nonnegative() });
export const WorkerCardWireSchema = z.strictObject({
  workerId: WorkerIdSchema,
  system: BrowserSystemIdSchema,
  state: z.enum(["idle", "working", "waiting", "paused", "failed", "stopped"]),
  currentRun: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("present"), runId: RunIdSchema, traceId: TraceIdSchema }),
  ]),
  revision: RowRevisionSchema,
});
export const NotificationWireSchema = z.strictObject({
  notificationId: NotificationIdSchema,
  actorId: ActorIdSchema,
  severity: z.enum(["info", "warning", "error"]),
  title: z.string().min(1),
  state: z.enum(["unread", "read", "snoozed"]),
  occurredAt: IsoInstantSchema,
  revision: RowRevisionSchema,
});

function requireUnique(values: readonly string[], path: string, context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [path], message: `${path} identities must be unique` });
  }
}

export const DashboardDayWireSchema = z.strictObject({
  day: LocalDateSchema,
  descriptorHash: FingerprintSchema,
  projectionGeneration: ProjectionGenerationSchema,
  snapshotCursor: ProjectionCursorSchema,
  monthCounts: z.array(DayCountWireSchema),
  workflowCounts: z.array(WorkflowCountWireSchema),
  statusCounts: z.array(StatusCountWireSchema),
  queueSurfaces: z.array(QueueSurfaceWireSchema),
  workerCards: z.array(WorkerCardWireSchema),
  notifications: z.array(NotificationWireSchema),
}).superRefine((day, context) => {
  requireUnique(day.monthCounts.map(({ day: value }) => value), "monthCounts", context);
  requireUnique(day.workflowCounts.map(({ workflowId }) => workflowId), "workflowCounts", context);
  requireUnique(day.statusCounts.map(({ status }) => status), "statusCounts", context);
  requireUnique(day.queueSurfaces.map(({ runId }) => runId), "queueSurfaces", context);
  requireUnique(day.workerCards.map(({ workerId }) => workerId), "workerCards", context);
  requireUnique(day.notifications.map(({ notificationId }) => notificationId), "notifications", context);
});

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
export type DashboardDayWire = z.infer<typeof DashboardDayWireSchema>;
