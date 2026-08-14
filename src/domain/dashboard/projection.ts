import { z } from "zod";
import { NotificationRecordSchema } from "../notifications.js";
import { ActionDescriptorWireSchema } from "./actions.js";
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
  /**
   * Whether this run is a REHEARSAL (doc 02 §2's envelope, D6 — the one home
   * for the flag; doc 09's `executeDryRun` vs `executeTransaction` is the same
   * bit deciding whether a real HR write may happen at all).
   *
   * There is no absent arm and there must never be one: every envelope carries
   * the flag, so "we do not know whether this run writes" is not a state this
   * system can be in. The queue is the one column an operator scans before
   * acting, and a rehearsal that renders identically to a real filing is the
   * cheapest possible way to read a dry run as a submitted transaction.
   */
  dryRun: z.boolean(),
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
  /**
   * When the OPEN gate opened (D12) — the row's `Waiting on you · 10m`.
   *
   * D12's whole claim is that *an aging gate is the most actionable fact in
   * the queue*, and an age is only computable from an instant the server dates
   * the gate with. It is present ONLY on an `awaiting-approval` row (the
   * refinement below is what enforces that), because a run that is not parked
   * on a gate has no open gate whose age could be measured.
   *
   * **It is never derived from `updatedAt`.** That instant moves on every
   * patch — a heartbeat, a rename, a version bump — so an age computed from it
   * would report a gate as YOUNGER than it is, and "younger" is the one
   * direction this fact may never err in: a gate that has been waiting an hour
   * rendering as `· 2m` is exactly the row an operator scrolls past.
   */
  gateOpenedAt: z.discriminatedUnion("state", [
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
  /**
   * The `△ N` chip's REAL count (D22 as amended by D126).
   *
   * D126's argument for letting `verifiedDone` and `doneWarnings` draw the same
   * visible word rests on three visible channels separating them — icon, hue,
   * and *this count*. A chip that always read `1` because nothing counted made
   * the third channel a constant, which is weaker than the argument assumes.
   *
   * The present arm carries a POSITIVE count and the first warning's own
   * sentence (the chip's title). There is deliberately no `count: 0` arm:
   * absence IS zero here, exactly as it is for this file's sparse count arrays,
   * and a zero-count present arm would be a chip with nothing to say. The
   * absent arm's `reason` is what distinguishes "this run recorded no warning"
   * from "nothing has derived this run's warning set yet" — collapsing those
   * two into one silent zero is the absence-versus-failure conflation this
   * program bans.
   */
  warnings: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("present"),
      count: PositiveIntSchema,
      first: z.string().min(1),
    }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  pipeline: z.array(PipelineStepWireSchema),
  panelKind: PanelKindSchema,
  availableSections: z.array(RunDetailSectionSchema),
  /**
   * The row's OWN command controls (doc 03 §2.4, doc 13 §3.2/§8.5).
   *
   * Doc 13 §8.5 is the rule this field exists to satisfy: *interactive run
   * controls require an `ActionDescriptorWire`; status-key-to-command branches
   * fail.* Until this landed, `QueueBaseFields` carried no such field and no
   * projector built one, so `FooterActions`/`RowContextMenu` were handed an
   * empty list and every queue row drew nothing — the controls were not hidden,
   * they were unreachable.
   *
   * An EMPTY array is a real answer, not a stub: it says the projector found no
   * command this row's workflow enables that the kernel would accept in this
   * lifecycle. The surfaces already render exactly what they are handed, so an
   * empty list draws no controls with no client branch.
   *
   * Every descriptor's `expectedVersion` is bound to `rowRevision` by the
   * refinement below — the row the operator is holding IS the CAS target, and a
   * descriptor carrying any other version would be a control that either races
   * silently or refuses for a reason nobody could see.
   */
  actions: z.array(ActionDescriptorWireSchema),
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

/**
 * Only a row that IS waiting may date a gate (D12).
 *
 * The same shape as `refineEndedAt` and for the same reason: a `running` or
 * settled row carrying a gate instant would let a surface print `· 40m` beside
 * a status that names no wait at all, and an age that outlives its gate is a
 * standing invitation to act on a decision somebody already made.
 */
function refineGateOpenedAt(
  surface: {
    status: z.infer<typeof QueueStatusSchema>;
    gateOpenedAt: { state: "present" | "absent" };
  },
  context: z.RefinementCtx,
): void {
  if (surface.status !== "awaiting-approval" && surface.gateOpenedAt.state === "present") {
    context.addIssue({
      code: "custom",
      path: ["gateOpenedAt"],
      message: `a ${surface.status} run is not waiting on a gate and cannot carry a gate instant`,
    });
  }
}

/**
 * A served control must name THIS row's revision, and must name itself once.
 *
 * The CAS half is the load-bearing one. `FooterActions`, `RowContextMenu` and
 * the confirm dialog all send `action.expectedVersion` as the command's target
 * version, so a descriptor projected against anything but the row's own
 * `rowRevision` would be a control that conflicts on click for a reason the
 * operator cannot see — or, worse for the arms where the kernel does not CAS,
 * one that applies against a version nobody looked at. Binding the two here
 * means a projector cannot get it wrong silently.
 *
 * The key half is what makes a row's controls addressable at all: `key` is the
 * React key in both surfaces and the identifier `FooterActions` special-cases,
 * so two descriptors sharing one would collapse into a single control.
 */
function refineActions(
  surface: {
    actions: readonly { key: string; kind: string; expectedVersion?: number }[];
    rowRevision: number;
  },
  context: z.RefinementCtx,
): void {
  const keys = surface.actions.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["actions"], message: "queue row action keys must be unique" });
  }
  for (const [index, action] of surface.actions.entries()) {
    if (action.kind !== "command") continue;
    if (action.expectedVersion !== surface.rowRevision) {
      context.addIssue({
        code: "custom",
        path: ["actions", index, "expectedVersion"],
        message: `action "${action.key}" targets version ${String(action.expectedVersion)}, but this row is `
          + `at revision ${String(surface.rowRevision)}; a served control's CAS target is the row it rides`,
      });
    }
  }
}

const RegularQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.enum(["single", "preview"]),
}).superRefine((surface, context) => {
  refineEndedAt(surface, context);
  refineGateOpenedAt(surface, context);
  refineActions(surface, context);
});
const MemberQueueSurfaceWireSchema = z.strictObject({
  ...QueueBaseFields,
  surfaceKind: z.literal("member"),
}).superRefine((surface, context) => {
  refineEndedAt(surface, context);
  refineGateOpenedAt(surface, context);
  refineActions(surface, context);
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
  refineGateOpenedAt(surface, context);
  refineActions(surface, context);
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
