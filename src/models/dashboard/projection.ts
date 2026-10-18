import { z } from "zod";
import { WorkerControlRecordSchema } from "../run/worker-control.js";
import { WorkerPoolMemberSchema, WorkerSlotRecordSchema } from "../run/worker-slot.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { NotificationRecordSchema, NotificationTriggerSchema } from "../notifications/notifications.js";
import { NotificationTriggerEventSchema, projectNotificationTrigger } from "../../rules/notifications/notification-triggers.js";
/** The two worker vocabularies are IMPORTED, not mirrored; the queue's priority enum is a copy only because the envelope module reaches a checkpoint module. */
import { WorkerControlBasisSchema, WorkerDirectiveSchema, WorkerStopReasonSchema } from "../run/worker.js";
import { ActionDescriptorWireSchema } from "./actions.js";
import { RunSessionOriginSchema } from "../run/session.js";
import {
  ActorIdSchema,
  CommandIdSchema,
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FailureIdSchema,
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
  RunSessionIdSchema,
} from "../../rules/identity/ids.js";
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

export const ResolvedInstanceSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  instance: z.enum(["prod", "test"]),
});

export const QueueStatusSchema = z.enum([
  "queued", "running", "cancelling", "blocked", "awaiting-approval", "done", "failed", "cancelled", "partial",
]);

const PipelineStepWireSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
    /* The SAME vocabulary the run-detail timeline step carries, less its `replayed` arm (a replayed node emits no span, so no chip measures it). */
  state: z.enum(["pending", "active", "done", "failed", "skipped", "blocked", "cancelled"]),
    /* Sum before rounding; unmeasured categories have no duration, never zero. */
  durationSec: z.number().int().nonnegative().optional(),
    /* The largest execution count of a member node, present only at two or more; absence means no member reran. */
  executions: z.number().int().min(2).optional(),
});

/** The run's own so-what, as the queue's chip band prints it, with the values the RECEIPT prints — not a second derivation over the terminal result. */
const RunFactWireSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string().min(1),
});

/** How this row is contained by its parent — `root`, `member` or `linked` — projected from the run's own shape and lineage, never inferred from a workflow id. */
export const ContainmentSchema = z.enum(["root", "member", "linked"]);

/** A run this row DELEGATED TO and is waiting on; the chip needs where to jump, what to call it, and what it is doing, so the wire carries all three. */
const LinkedRunWireSchema = z.strictObject({
  runId: RunIdSchema,
  partitionDay: LocalDateSchema,
  workflowId: WorkflowIdSchema,
  label: z.string().min(1),
  panelKind: PanelKindSchema,
  status: QueueStatusSchema,
});

/** The run's scheduling class, read from the run envelope (its one home); a deliberate MIRROR kept member-for-member identical by the mirror joint. */
export const QueuePrioritySchema = z.enum(["interactive", "bulk"]);

const QueueSessionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), sessionId: RunSessionIdSchema,
    // Absent only in frozen pre-batch queue snapshots.
    presentation: z.strictObject({ groupInQueue: z.boolean(), version: PositiveIntSchema, startedAt: IsoInstantSchema }).optional(),
    origin: RunSessionOriginSchema.optional(),
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

/** The `△ N` chip's REAL count; the three visible channels — icon, hue and this count — are what separate two statuses that draw the same word. */
export const RunWarningsWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    count: PositiveIntSchema,
    first: z.string().min(1),
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const QueueBusinessOutcomeSchema = z.strictObject({
  label: z.string().min(1),
  tone: z.enum(["success", "warning", "neutral"]),
});
export type QueueBusinessOutcome = z.infer<typeof QueueBusinessOutcomeSchema>;

const QueueBaseFields = {
  runId: RunIdSchema,
  itemId: ItemIdSchema,
  workflowId: WorkflowIdSchema,
  traceId: TraceIdSchema,
  attempt: z.number().int().positive(),
  lineage: ParentRunSchema,
  actorId: ActorIdSchema.optional(),
    /* The app build THIS RUN was enqueued under — not the build serving the page; a run enqueued before the stamp existed says so, with its reason. */
  appVersion: RunAppVersionSchema,
  descriptorVersion: PositiveIntSchema,
  descriptorHash: FingerprintSchema,
  configFingerprint: FingerprintSchema,
  resolvedInstances: z.array(ResolvedInstanceSchema),
    /* Whether this run is a REHEARSAL, read from the one envelope home of the flag; there is no absent arm and there must never be one. */
  dryRun: z.boolean(),
    /* The scheduling class, read from the run envelope (its one home) exactly as `dryRun` is; there is no absent arm and there must never be one. */
  priority: QueuePrioritySchema,
    /* This run's ORDINAL within its workflow — the footer's `#N`; durable and assigned at enqueue, never derived from a row's position in a day's page. */
  runNumber: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: PositiveIntSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* The dashboard-started GROUP this run belongs to — read off `RunRecord.sessionId`, the ONE place membership lives; `run_batches` holds no member list to disagree with it. */
    /* How this row is contained by its parent — `root`, `member` or `linked`; projected from the run's own shape and lineage, and served in its own right. */
  containment: ContainmentSchema,
    /* The runs this row DELEGATED TO and is waiting on; an EMPTY array is a real answer — this run spawned no child that keeps its own row. */
  linkedRuns: z.array(LinkedRunWireSchema),
    /* What this run PRODUCED, in the words its receipt uses; read from the run's ALREADY-DERIVED evidence receipt, and never an act that persists a row. */
  facts: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.array(RunFactWireSchema).min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  startedAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
    /* The run's terminal instant, served explicitly: `updatedAt` happens to equal it on a settled run, but a row that computed a duration from it would rely on an invariant it cannot see. */
  endedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* When the OPEN gate opened — the row's `Waiting on you · 10m`; present ONLY on a waiting row, because an age is only computable from an instant the server dates the gate with. */
  gateOpenedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
    /* What this run is ABOUT, in the system's own words: the title `presentation.title` composed from the start input, REPLACED once the run's own reads settle the subject's name. */
  title: z.string().min(1),
    /* The operator's own name for this run, when they have given it one; authority-owned and written only by the `rename` command, served in its own right rather than collapsed into `title`. */
  displayName: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  subtitle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  status: QueueStatusSchema,
  outcome: QueueBusinessOutcomeSchema.optional(),
  liveMessage: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  warnings: RunWarningsWireSchema,
  pipeline: z.array(PipelineStepWireSchema),
  panelKind: PanelKindSchema,
  availableSections: z.array(RunDetailSectionSchema),
    /* The row's OWN command controls, satisfying the rule that interactive run controls require an `ActionDescriptorWire` and status-key-to-command branches fail. */
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

/** An in-flight row may never claim a terminal instant: the row that says when a run ended is the row that says it is over. */
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

/** Only a row that IS waiting may date a gate; the same shape as the ended-at refinement, so a status that names no wait can never draw an age. */
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

/** A served control must name THIS row's revision, and must name itself once; the CAS half is load-bearing because every action surface sends it as the command's target version. */
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

/** Containment, lineage and surface kind are three views of one fact, so the schema refuses a payload where they disagree rather than letting a surface pick a winner. */
function refineContainment(
  surface: {
    containment: z.infer<typeof ContainmentSchema>;
    surfaceKind: string;
    lineage: { state: "root" | "child" };
    runId: string;
    linkedRuns: readonly { runId: string }[];
  },
  context: z.RefinementCtx,
): void {
  const parented = surface.lineage.state === "child";
  if (parented === (surface.containment === "root")) {
    context.addIssue({
      code: "custom",
      path: ["containment"],
      message: `a ${surface.lineage.state} row cannot be contained as ${surface.containment}`,
    });
  }
  if ((surface.containment === "member") !== (surface.surfaceKind === "member")) {
    context.addIssue({
      code: "custom",
      path: ["containment"],
      message: `containment ${surface.containment} disagrees with surfaceKind ${surface.surfaceKind}; `
        + "a member is exactly the row counted in its parent's rollup instead of the day's totals",
    });
  }
  const linkedIds = surface.linkedRuns.map(({ runId }) => runId);
  if (new Set(linkedIds).size !== linkedIds.length) {
    context.addIssue({ code: "custom", path: ["linkedRuns"], message: "linked run ids must be unique" });
  }
  if (linkedIds.includes(surface.runId)) {
    context.addIssue({ code: "custom", path: ["linkedRuns"], message: "a run cannot be linked to itself" });
  }
}

function queueSurfaceWireSchema<SessionSchema extends z.ZodType>(session: SessionSchema) {
  const baseFields = { ...QueueBaseFields, session };
  const regular = z.strictObject({
    ...baseFields,
    surfaceKind: z.enum(["single", "preview"]),
  }).superRefine((surface, context) => {
    refineEndedAt(surface, context);
    refineGateOpenedAt(surface, context);
    refineActions(surface, context);
    refineContainment(surface, context);
  });
  const member = z.strictObject({
    ...baseFields,
    surfaceKind: z.literal("member"),
  }).superRefine((surface, context) => {
    refineEndedAt(surface, context);
    refineGateOpenedAt(surface, context);
    refineActions(surface, context);
    refineContainment(surface, context);
    if (surface.lineage.state !== "child") {
      context.addIssue({ code: "custom", path: ["lineage"], message: "member surfaces require a parent run" });
    }
  });
  const operation = z.strictObject({
    ...baseFields,
    surfaceKind: z.literal("operation"),
    memberRunIds: z.array(RunIdSchema),
    memberRollup: z.strictObject({
      total: z.number().int().nonnegative(),
      terminal: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
      /* The first few members BY NAME, so a counted anchor whose own title is a number still says who is in it; on the OPERATION variant alone and DERIVED from the member rows' own served titles. */
    memberPreview: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
      z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    ]),
  }).superRefine((surface, context) => {
    refineEndedAt(surface, context);
    refineGateOpenedAt(surface, context);
    refineActions(surface, context);
    refineContainment(surface, context);
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
  return z.union([regular, member, operation]);
}

/** The live queue wire: every projected row states session membership or its reasoned absence. */
export const QueueSurfaceWireSchema = queueSurfaceWireSchema(QueueSessionWireSchema);

/** Archive-storage read arm only; the archive generation says whether an absent key is historical or invalid. */
export const ArchivedQueueSurfaceStorageSchema = queueSurfaceWireSchema(QueueSessionWireSchema.optional());

export const DayCountWireSchema = z.strictObject({ day: LocalDateSchema, count: z.number().int().nonnegative() });
export const StatusCountWireSchema = z.strictObject({ status: QueueStatusSchema, count: z.number().int().nonnegative() });
/** One workflow's day, counted ONCE and served with its status dimension, because two questions of the shell ask of the same counted day. */
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
/** Current session identity plus dated resource-owner observation. Historical spans
 * without an observation remain explicitly unverified; URLs and private profile paths are not served. */
export const WorkerBrowserWireSchema = z.strictObject({
  sessionId: BrowserSessionIdSchema,
  system: BrowserSystemIdSchema,
  openedAt: IsoInstantSchema,
  observation: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), health: z.enum(["authenticated", "unknown", "failed"]), observedAt: IsoInstantSchema,
      instance: z.string().optional(), browserMode: z.enum(["headed", "headless"]), configFingerprint: FingerprintSchema }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  ]).optional(),
});

/** The browser systems a worker for this workflow may need, independently of whether any session is open yet; this block is descriptor authority, and optional is read-forward compatibility only. */
export const WorkerBrowserRequirementsWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    systems: z.array(BrowserSystemIdSchema).superRefine((systems, context) => {
      if (new Set(systems).size !== systems.length) {
        context.addIssue({ code: "custom", message: "worker browser requirement systems must be unique" });
      }
    }),
  }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);

/** ONE worker, AS AUTHORITY HOLDS IT: the durable worker lease joined with the browser sessions its span stream has open, in that direction and no other. */
export const WorkerControlWireSchema = z.strictObject({
  basis: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("present"), value: WorkerControlBasisSchema }), z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) })]),
  ownership: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("owned") }), z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) })]),
  operation: z.strictObject({ commandId: CommandIdSchema, type: z.enum(["plan-worker-count", "spawn-worker", "pause-worker", "resume-worker", "stop-worker", "refresh-browser", "reopen-browser", "remove-worker", "retry-worker"]),
    state: z.enum(["admitted", "ready", "executing", "succeeded", "refused", "uncertain"]), at: IsoInstantSchema,
    browserSessionId: BrowserSessionIdSchema.optional(), message: z.string().optional(), unresolved: z.boolean() }).optional(),
});

export const WorkerCardWireSchema = z.strictObject({
  member: WorkerPoolMemberSchema,
  workerId: WorkerIdSchema,
  /** The one workflow this worker claims for (ref execution-and-sessions ) — from the lease, never guessed. */
  workflowId: WorkflowIdSchema,
  state: z.enum(["running", "starting", "idle", "waiting", "paused", "failed"]),
  controls: WorkerControlWireSchema.optional(),
  /** What the operator last ASKED of this worker; `run` is the un-directed state. */
  directive: WorkerDirectiveSchema,
  startedAt: IsoInstantSchema,
  /** Present iff the lease is terminal — the instant it settled, never `now`. */
  endedAt: IsoInstantSchema.optional(),
  /** Present iff the lease is terminal — the recorded reason, never inferred. */
  stopReason: WorkerStopReasonSchema.optional(),
  currentRun: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("present"), runId: RunIdSchema, traceId: TraceIdSchema }),
  ]),
  browserRequirements: WorkerBrowserRequirementsWireSchema.optional(),
  browsers: z.array(WorkerBrowserWireSchema),
  leaseVersion: RowRevisionSchema,
  revision: RowRevisionSchema,
}).superRefine((card, context) => {
  const terminal = card.state === "failed";
  if (terminal !== (card.endedAt !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["endedAt"],
      message: `a ${card.state} worker card must ${terminal ? "carry" : "carry no"} endedAt`,
    });
  }
  if (terminal !== (card.stopReason !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["stopReason"],
      message: `a ${card.state} worker card must ${terminal ? "carry" : "carry no"} stopReason`,
    });
  }
  if (card.endedAt !== undefined && Date.parse(card.endedAt) < Date.parse(card.startedAt)) {
    context.addIssue({ code: "custom", path: ["endedAt"], message: "worker endedAt precedes startedAt" });
  }
  if (card.member.workerId !== card.workerId || card.member.workflowId !== card.workflowId) {
    context.addIssue({ code: "custom", path: ["member"], message: "worker card must bind its exact member" });
  }
  // Settled leases cannot claim live processes or browser resources.
  if (terminal && card.browsers.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["browsers"],
      message: `a ${card.state} worker card holds no browser sessions`,
    });
  }
  requireUnique(card.browsers.map(({ sessionId }) => String(sessionId)), "browsers", context);
});
/** Durable notification row → wire: severity orders by what the operator must DO, and `snoozed` wins the state only while the snooze is still in force. */
export function notificationWireOf(
  record: z.infer<typeof NotificationRecordSchema>,
  nowMs: number,
  context?: NotificationDisplayContext,
  sourceEvent?: z.infer<typeof NotificationSourceEventWireSchema>,
): z.infer<typeof NotificationWireSchema> {
  if (record.trigger === "backfill-gap") {
    return NotificationWireSchema.parse({
      kind: "backfill-gap",
      notificationId: record.notificationId,
      actorId: record.actorId,
      channel: record.channel,
      count: record.count,
      publicationId: sha256Hex(`notification-publication:${record.notificationId}:${String(record.count)}:${record.lastSeenAt}`),
      severity: "error",
      title: notificationTitle(record.trigger),
      state: "pinned",
      occurredAt: record.lastSeenAt,
      sourceEvent: sourceEvent ?? { state: "unavailable" },
    });
  }
  const severity = record.trigger === "failed" || record.trigger === "write-parked"
    ? "error"
    : record.trigger === "verified-done"
      ? "info"
      : "warning";
  const snoozed = record.snooze.state === "snoozed" && Date.parse(record.snooze.until) > nowMs;
  const link = record.links[0];
  return NotificationWireSchema.parse({
    kind: "notification",
    notificationId: record.notificationId,
    actorId: record.actorId,
    severity,
    title: notificationTitle(record.trigger),
    summary: record.summary,
    channel: record.channel,
    count: record.count,
    trigger: record.trigger,
    readState: record.status,
    publicationId: sha256Hex(`notification-publication:${record.notificationId}:${String(record.count)}:${record.lastSeenAt}`),
    state: snoozed ? "snoozed" : record.status,
    ...(snoozed && record.snooze.state === "snoozed" ? { snoozedUntil: record.snooze.until } : {}),
    occurredAt: record.lastSeenAt,
    revision: record.version,
    context: context ?? { state: "unavailable" },
    sourceEvent: sourceEvent ?? { state: "unavailable" },
    ...(link === undefined ? {} : { link: link.kind === "storage" ? { kind: "storage" } : link }),
  });
}

/** Compose public text from closed trigger codes, never private diagnostic prose. */
export function notificationTitle(trigger: z.infer<typeof NotificationTriggerSchema>): string {
  const titles = { failed: "Run failed", "gate-waiting": "Needs you", "write-parked": "Write parked", repeating: "Repeating failure", storage: "Storage needs attention", "verified-done": "Verified completion", "backfill-gap": "Notification history is incomplete" };
  return titles[trigger];
}
const NotificationLinkWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("failure"), runId: RunIdSchema, failureId: FailureIdSchema }),
  z.strictObject({ kind: z.literal("storage") }),
]);

export const NotificationDisplayContextSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), workflow: z.string().min(1), subject: z.string().min(1) }),
  z.strictObject({ state: z.literal("workflow-only"), workflow: z.string().min(1) }),
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({ state: z.literal("not-applicable") }),
]);
export type NotificationDisplayContext = z.infer<typeof NotificationDisplayContextSchema>;

export const NotificationSourceEventWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), kind: z.enum(NotificationTriggerEventSchema.options.map(option => option.shape.kind.value) as [string, ...string[]]) }),
  z.strictObject({ state: z.literal("unavailable") }),
]);

export function notificationSourceEventOf(record: z.infer<typeof NotificationRecordSchema>, source?: {
  actorId: string; notificationId: string; adopted: boolean; event: unknown;
}): z.infer<typeof NotificationSourceEventWireSchema> {
  if (source === undefined) return { state: "unavailable" };
  if (source.adopted || source.actorId !== record.actorId || source.notificationId !== record.notificationId) throw new Error("NOTIFICATION_PUBLICATION_OWNER_MISMATCH");
  const event = NotificationTriggerEventSchema.parse(source.event);
  const projection = projectNotificationTrigger(event);
  if (projection.trigger !== record.trigger || projection.dedupeFingerprint !== record.dedupeFingerprint) throw new Error("NOTIFICATION_PUBLICATION_ROW_MISMATCH");
  return { state: "available", kind: event.kind };
}

const StandardNotificationWireSchema = z.strictObject({
  kind: z.literal("notification"),
  channel: z.enum(["ping", "inbox"]),
  count: PositiveIntSchema,
  publicationId: FingerprintSchema,
  trigger: NotificationTriggerSchema.exclude(["backfill-gap"]),
  readState: z.enum(["read", "unread"]),
  notificationId: NotificationIdSchema,
  actorId: ActorIdSchema,
  severity: z.enum(["info", "warning", "error"]),
  title: z.string().min(1),
  summary: z.string().min(1).max(1_000).optional(),
  state: z.enum(["unread", "read", "snoozed"]),
  snoozedUntil: IsoInstantSchema.optional(),
  occurredAt: IsoInstantSchema,
  revision: RowRevisionSchema,
  context: NotificationDisplayContextSchema,
  sourceEvent: NotificationSourceEventWireSchema.optional(),
  link: NotificationLinkWireSchema.optional(),
});

const BackfillGapNotificationWireSchema = z.strictObject({
  kind: z.literal("backfill-gap"),
  channel: z.literal("ping"),
  count: z.literal(1),
  publicationId: FingerprintSchema,
  notificationId: NotificationIdSchema,
  actorId: ActorIdSchema,
  severity: z.literal("error"),
  title: z.literal("Notification history is incomplete"),
  state: z.literal("pinned"),
  occurredAt: IsoInstantSchema,
  sourceEvent: NotificationSourceEventWireSchema.optional(),
});

export const NotificationWireSchema = z.discriminatedUnion("kind", [
  StandardNotificationWireSchema,
  BackfillGapNotificationWireSchema,
]).superRefine((row, context) => {
  if (row.kind === "notification" && (row.state === "snoozed") !== (row.snoozedUntil !== undefined)) {
    context.addIssue({ code: "custom", path: ["snoozedUntil"], message: "snoozed state requires its server expiry hint" });
  }
});

/** Worker commands use only the worker_pools row version as their CAS basis. */
export const WorkerPoolWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  desiredWorkers: z.number().int().nonnegative(),
  version: PositiveIntSchema,
  plannedBy: ActorIdSchema,
  plannedAt: IsoInstantSchema,
});
export type WorkerPoolWire = z.infer<typeof WorkerPoolWireSchema>;

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
  attemptHistory: z.array(z.strictObject({ runId: QueueBaseFields.runId, startedAt: QueueBaseFields.startedAt, endedAt: QueueBaseFields.endedAt })).optional(),
  workerOperations: z.array(WorkerControlRecordSchema),
  workerCards: z.array(WorkerCardWireSchema),
  workerAuthority: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), members: z.array(WorkerSlotRecordSchema) }),
    z.strictObject({ state: z.literal("unavailable"), members: z.array(WorkerSlotRecordSchema), reason: z.string().min(1) }),
  ]),
  /** One entry per workflow that HAS a pool row; see `WorkerPoolWireSchema`. */
  workerPools: z.array(WorkerPoolWireSchema),
  notifications: z.array(NotificationWireSchema),
}).superRefine((day, context) => {
  requireUnique(day.monthCounts.map(({ day: value }) => value), "monthCounts", context);
  requireUnique(day.workflowCounts.map(({ workflowId }) => workflowId), "workflowCounts", context);
  requireUnique(day.statusCounts.map(({ status }) => status), "statusCounts", context);
  requireUnique(day.queueSurfaces.map(({ runId }) => runId), "queueSurfaces", context);
  requireUnique((day.attemptHistory ?? []).map(entry => entry.runId), "attemptHistory", context);
  if (day.attemptHistory !== undefined) {
    const rows = new Map(day.queueSurfaces.map(row => [row.runId, row]));
    if (day.attemptHistory.length !== day.queueSurfaces.length) {
      context.addIssue({ code: "custom", path: ["attemptHistory"], message: "attempt metadata must include every selected-day run" });
    }
    for (const [index, entry] of day.attemptHistory.entries()) {
      const row = rows.get(entry.runId);
      if (row === undefined || row.startedAt !== entry.startedAt || JSON.stringify(row.endedAt) !== JSON.stringify(entry.endedAt)) {
        context.addIssue({ code: "custom", path: ["attemptHistory", index], message: "attempt metadata must match its selected-day run" });
      }
    }
  }
  requireUnique(day.workerCards.map(({ workerId }) => workerId), "workerCards", context);
  requireUnique(day.workerAuthority.members.map(({ workerId }) => workerId), "workerAuthority", context);
  requireUnique(day.workerOperations.map(({ commandId }) => commandId), "workerOperations", context);
  if (day.workerAuthority.state === "present" && (day.workerAuthority.members.length !== day.workerCards.length
    || day.workerAuthority.members.some(member => member.retiredAt !== null || !day.workerCards.some(card =>
      card.workerId === member.workerId && card.member.membershipRevision === member.membershipRevision
      && card.member.ordinal === member.ordinal && card.member.poolIndex === member.poolIndex && card.workflowId === member.workflow)))) {
    context.addIssue({ code: "custom", path: ["workerAuthority"], message: "available worker authority requires every exact standing member card" });
  }
  requireUnique(day.workerPools.map(({ workflowId }) => workflowId), "workerPools", context);
  requireUnique(day.notifications.map(({ notificationId }) => notificationId), "notifications", context);
});

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
export type DashboardDayWire = z.infer<typeof DashboardDayWireSchema>;

export type NotificationWire = z.infer<typeof NotificationWireSchema>;
