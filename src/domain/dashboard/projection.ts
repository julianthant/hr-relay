import { z } from "zod";
import { NotificationRecordSchema } from "../notifications.js";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  LocalDateSchema,
  NotificationIdSchema,
  PositiveIntSchema,
  ProjectionCursorSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import {
  PanelKindSchema,
  ProjectionGenerationSchema,
  RowRevisionSchema,
  RunAppVersionSchema,
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
  /**
   * The app build THIS RUN was enqueued under (D179) — not the build serving
   * the page. Before D179 the projection stamped its own `deps.appVersion`
   * here, which made every row claim the current build and left the run-detail
   * "served by a different app build" comparison structurally unable to fire.
   * A run enqueued before the stamp existed says so, with its reason.
   */
  appVersion: RunAppVersionSchema,
  descriptorVersion: PositiveIntSchema,
  descriptorHash: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  resolvedInstances: z.array(ResolvedInstanceSchema),
  startedAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
  /**
   * The run's terminal instant, served explicitly (D124).
   *
   * `updatedAt` happens to equal `lifecycle.endedAt` on a settled run, but the
   * wire never said so, and a row that computed a duration from it would be
   * relying on an invariant it cannot see. A terminal row therefore carries
   * `endedAt` in its own right so `endedAt − startedAt` is a real duration;
   * an in-flight row carries an explicit, reasoned absence, and a terminal row
   * whose end instant is genuinely unknown says exactly that instead of
   * letting the client silently substitute `now` and count forever.
   */
  endedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
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

/** The statuses whose run has stopped for good — the ones that HAVE a duration. */
export const TERMINAL_QUEUE_STATUSES: ReadonlySet<z.infer<typeof QueueStatusSchema>> =
  new Set(["done", "failed", "cancelled", "partial"]);

/** The same fact as a predicate, for surfaces that hold a plain status string. */
export function isTerminalQueueStatus(status: string): boolean {
  return TERMINAL_QUEUE_STATUSES.has(QueueStatusSchema.parse(status));
}

/**
 * An in-flight row may never claim a terminal instant: the row that says when
 * a run ended is the row that says it is over, and a running run that carried
 * one would let a surface print a finished duration for live work.
 */
function refineEndedAt(
  surface: { status: z.infer<typeof QueueStatusSchema>; endedAt: { state: "present" | "absent" } },
  context: z.RefinementCtx,
): void {
  if (!TERMINAL_QUEUE_STATUSES.has(surface.status) && surface.endedAt.state === "present") {
    context.addIssue({
      code: "custom",
      path: ["endedAt"],
      message: `a ${surface.status} run has not ended and cannot carry a terminal instant`,
    });
  }
}

const RegularQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.enum(["single", "preview"]),
}).superRefine(refineEndedAt);
const MemberQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.literal("member"),
}).superRefine((surface, context) => {
  refineEndedAt(surface, context);
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
  refineEndedAt(surface, context);
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
export const StatusCountWireSchema = z.strictObject({ status: QueueStatusSchema, count: z.number().int().nonnegative() });
/**
 * One workflow's day, counted ONCE (D81) and served with its status dimension.
 *
 * `count` alone could not answer the two questions the shell asks of it: the
 * Workflow Panel's `active │ all` column needs queued + running for THIS
 * workflow, and the Status Bar's pills are scoped to the workflow the queue
 * below them is showing (R4-1) — so a day-wide `statusCounts` fold made
 * `Failed 3` sit above a queue with no failures. Both are the same fact at
 * different scopes, and both now come off this one array rather than a second
 * client-side fold over `queueSurfaces`.
 *
 * `statusCounts` is sparse for the same documented reason the day-wide array
 * is: a status with no row simply has no entry, and absence IS zero. The two
 * refinements below are what make the shape self-checking — a status may
 * appear once, and the per-status counts must sum to `count`, because every
 * countable surface lands in exactly one status bucket.
 */
export const WorkflowCountWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  count: z.number().int().nonnegative(),
  statusCounts: z.array(StatusCountWireSchema),
}).superRefine((entry, context) => {
  const statuses = entry.statusCounts.map(({ status }) => status);
  if (new Set(statuses).size !== statuses.length) {
    context.addIssue({ code: "custom", path: ["statusCounts"], message: "workflow statusCounts identities must be unique" });
  }
  const summed = entry.statusCounts.reduce((sum, { count }) => sum + count, 0);
  if (summed !== entry.count) {
    context.addIssue({
      code: "custom",
      path: ["statusCounts"],
      message: `workflow statusCounts must sum to count (${summed} !== ${entry.count})`,
    });
  }
});
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
/**
 * 2i-B: durable notification row → wire. Severity orders by what the
 * operator must DO — a failure or an unknown write outcome is `error`, the
 * waiting/storage family is `warning`, and `verified-done` is `info`.
 * `snoozed` wins the state only while the snooze is still in force; an
 * expired snooze reads as its underlying status again, because snooze
 * suppresses delivery without changing read state (doc 03 §2.6, D138).
 */
export function notificationWireOf(
  record: z.infer<typeof NotificationRecordSchema>,
  nowMs: number,
): z.infer<typeof NotificationWireSchema> {
  const severity = record.trigger === "failed" || record.trigger === "write-parked"
    ? "error"
    : record.trigger === "verified-done"
      ? "info"
      : "warning";
  const snoozed = record.snooze.state === "snoozed" && Date.parse(record.snooze.until) > nowMs;
  return NotificationWireSchema.parse({
    notificationId: record.notificationId,
    actorId: record.actorId,
    severity,
    title: record.title,
    state: snoozed ? "snoozed" : record.status,
    occurredAt: record.lastSeenAt,
    revision: record.version,
  });
}

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
