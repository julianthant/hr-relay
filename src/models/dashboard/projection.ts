import { z } from "zod";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { NotificationRecordSchema, NotificationTriggerSchema } from "../notifications/notifications.js";
import { NotificationTriggerEventSchema, projectNotificationTrigger } from "../../rules/notifications/notification-triggers.js";
/**
 * The two worker vocabularies are IMPORTED, not mirrored (§8.8's fourth joint
 * is for copies forced by §8.13). `src/domain/run/worker.ts` value-imports zod
 * and `src/domain/ids.ts` and nothing else, so it is bundle-safe — unlike
 * `run/envelope.ts`, which reaches `workflow/checkpoint.js` and is why the
 * queue's priority enum has to be a copy.
 */
import { WorkerControlBasisSchema, WorkerDirectiveSchema, WorkerStopReasonSchema } from "../run/worker.js";
import { ActionDescriptorWireSchema } from "./actions.js";
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
  /**
   * D268 — the SAME vocabulary the run-detail timeline step carries, less its
   * `replayed` arm (a replayed node emits no span, so no chip measures it).
   *
   * `cancelled` was added when the two vocabularies became one: the pipeline
   * used to map `cancelled|discarded|superseded` to `blocked` while the
   * timeline mapped them to `cancelled`, so one span read as two different
   * things depending on which surface drew it. `blocked` named no act; those
   * three outcomes all name one (D123).
   */
  state: z.enum(["pending", "active", "done", "failed", "skipped", "blocked", "cancelled"]),
  /**
   * How long this category's member spans took, summed before rounding.
   *
   * Optional in the same shape (and for the same reason) as the run-detail
   * timeline's `durationMs` one surface over: a category with no measured
   * member spans carries NO duration rather than a zero. A span still open, a
   * span whose start was never folded, and a span whose two instants disagree
   * each contribute nothing. Zero would claim a measurement.
   *
   * Summed rather than latest-wins because a node re-executed across a gate
   * resume (D214) genuinely spent both intervals. `executions` beside it is
   * what keeps the two readings apart.
   */
  durationSec: z.number().int().nonnegative().optional(),
  /**
   * The largest execution count of a member node, present only at two or more
   * (D214/D225 — a gate park and its resume are two executions inside one
   * attempt). Absence means no member reran.
   */
  executions: z.number().int().min(2).optional(),
});

/**
 * The run's own so-what, as the queue's chip band prints it (ref dashboard-surfaces §9 D7).
 *
 * `label`/`value` is the demo's `FactChipView` shape, and the values are the
 * ones the RECEIPT prints — the receipt's `output` facts, not a second
 * derivation over the terminal result, so the chip on the row and the row in
 * the Receipt tab can never disagree about what a run produced.
 */
const RunFactWireSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string().min(1),
});

/**
 * How this row is contained by its parent (ref dashboard-surfaces §2's delegation vocabulary,
 * ref frontend-backend-integration §1.1 — *projected, never inferred from a workflow id*).
 *
 * - `root`   — no parent. The ordinary row.
 * - `member` — created by a parent fanning out. Renders nested in the group and
 *              is counted in its rollup, never at top level.
 * - `linked` — an independently meaningful sub-run the parent waits on. Keeps
 *              its OWN row in its own panel; the parent shows a chip.
 *
 * **There is deliberately no `rejected` arm**, though the doc's vocabulary
 * names one. A submission the parent could not turn into work never becomes a
 * run: `fanOutQueuedRuns` refuses the WHOLE fan-out inside the caller's
 * transaction, and a start-plan refusal rides the plan as data. So there is no
 * queue row a `rejected` containment could describe, and an arm nothing can
 * produce is the orphan `wire-connectivity` exists to catch. It lands with the
 * first producer that writes a rejected child row, and not before.
 */
export const ContainmentSchema = z.enum(["root", "member", "linked"]);

/**
 * A run this row DELEGATED TO and is waiting on — the demo's
 * `PanelRedirectChip`, which prints `Name · status ↗` and jumps panels.
 *
 * The chip needs three things and therefore so does the wire: where to jump
 * (`workflowId` + `panelKind`), what to call it (`label`), and what it is doing
 * right now (`status`). Serving bare ids would make the client re-derive the
 * target's status from the day payload — which only works while the target is
 * on the same day, and is the second status path D81 exists to delete.
 */
const LinkedRunWireSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  label: z.string().min(1),
  panelKind: PanelKindSchema,
  status: QueueStatusSchema,
});

/**
 * The run's scheduling class (`RunEnvelope.priority`, D95's `bump` target).
 *
 * A deliberate MIRROR of `RunPrioritySchema`, kept member-for-member identical
 * by `wire-connectivity.test.ts`'s mirror joint. The copy exists because
 * `src/domain/run/envelope.ts` reaches `workflow/checkpoint.js` and this module
 * is in the dashboard bundle's reach (ref frontend-backend-integration §8.13) — never because the two may
 * differ.
 */
export const QueuePrioritySchema = z.enum(["interactive", "bulk"]);

const QueueSessionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), sessionId: RunSessionIdSchema,
    // Absent only in frozen pre-batch queue snapshots.
    presentation: z.strictObject({ groupInQueue: z.boolean(), version: PositiveIntSchema, startedAt: IsoInstantSchema }).optional(),
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

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
 *
 * It is a NAMED export rather than an inline union because the Archive index
 * entry carries the same fact, copied verbatim off the frozen row: two
 * definitions of one shape are two things to keep in sync, and the whole point
 * of the copy is that the list and the detail can never disagree.
 */
export const RunWarningsWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    count: PositiveIntSchema,
    first: z.string().min(1),
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

const QueueBaseFields = {
  runId: RunIdSchema,
  itemId: ItemIdSchema,
  workflowId: WorkflowIdSchema,
  traceId: TraceIdSchema,
  attempt: z.number().int().positive(),
  lineage: ParentRunSchema,
  actorId: ActorIdSchema.optional(),
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
   * Whether this run is a REHEARSAL (ref workflow-model §2's envelope, D6 — the one home
   * for the flag; ref write-safety's `executeDryRun` vs `executeTransaction` is the same
   * bit deciding whether a real HR write may happen at all).
   *
   * There is no absent arm and there must never be one: every envelope carries
   * the flag, so "we do not know whether this run writes" is not a state this
   * system can be in. The queue is the one column an operator scans before
   * acting, and a rehearsal that renders identically to a real filing is the
   * cheapest possible way to read a dry run as a submitted transaction.
   */
  dryRun: z.boolean(),
  /**
   * D95's scheduling class, read from the run envelope (its one home) exactly
   * as `dryRun` is. There is no absent arm and there must never be one: every
   * envelope carries a priority, `bumpPriority` rewrites this same field, and
   * the footer chip is how an operator sees that their `bump` landed.
   */
  priority: QueuePrioritySchema,
  /**
   * This run's ORDINAL within its workflow — the footer's `#N` (D230).
   *
   * Durable on `RunRecord`, assigned at enqueue, never derived here: a number
   * computed from a row's position in THIS day's page would give the same run a
   * different number tomorrow, which is the one property a name may not have.
   *
   * The absent arm is read-forward (D133) and is the only one: a run enqueued
   * before schema v15 carries no ordinal, and the row draws its trace id in that
   * slot — the identity every log, receipt and support conversation already
   * uses. The two are siblings once both are present, never substitutes.
   */
  runNumber: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: PositiveIntSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  /**
   * The dashboard-started GROUP this run belongs to (D269, ref execution-and-sessions
   * §11.1) — read off `RunRecord.sessionId`, the ONE place membership lives.
   * The session view reads membership from THIS field across the day's rows;
   * `workflow_run_batches` holds no member list to disagree with it.
   *
   * The absent arm is read-forward (D133): a run enqueued before schema v17
   * carries no session, and the row says so with its reason rather than being
   * folded into some default group.
   */
  /**
   * How this row is contained by its parent — `root`, `member` or `linked`.
   *
   * It is PROJECTED from the run's own shape and lineage (ref frontend-backend-integration §1.1's
   * *never inferred from a workflow id*), and it is served in its own right
   * rather than left to the client to reconstruct from `surfaceKind` plus
   * `lineage`: those two answer "how do I lay this out" and "who is my parent",
   * and neither answers "am I counted", which is the question containment is.
   */
  containment: ContainmentSchema,
  /**
   * The runs this row DELEGATED TO and is waiting on (ref dashboard-surfaces §9 D6/D10/D13).
   *
   * An EMPTY array is a real answer, exactly as it is for `actions`: this run
   * spawned no child that keeps its own row. Today every registered workflow
   * produces an empty one, because no descriptor in this build declares a
   * `child-run` node that fans out to a separately-panelled run — that is an
   * honest zero, not a stub, and the projector fills it the moment a child with
   * a non-member shape appears in the fold.
   *
   * A MEMBER child never appears here: it is counted in its parent's rollup and
   * rendered nested, and listing it in both places would let a group's own
   * chips contradict its own count.
   */
  linkedRuns: z.array(LinkedRunWireSchema),
  /**
   * What this run PRODUCED, in the words its receipt uses (ref dashboard-surfaces §9 D7).
   *
   * Read from the run's ALREADY-DERIVED evidence receipt — the same plain
   * lookup `warnings` does, and never `ensureReceipt`: D141 makes derivation an
   * act that persists a row, and a read model that wrote authority while
   * rendering a queue would be a projection deciding when a durable record
   * exists.
   *
   * Only a receipt output fact whose redacted value is `allowed` AND primitive
   * becomes a chip. A dropped or transformed leaf is redacted, and the queue —
   * on screen all day, screenshotted into tickets — is the last surface that may
   * print one; a structured leaf is not a chip, and flattening an object into
   * one would be inventing a presentation the receipt never authored. The
   * absent `reason` distinguishes "not settled", "no receipt derived", "the
   * receipt recorded no output" and "every output leaf was redacted or
   * structured", because a silent empty band collapses all four.
   */
  facts: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.array(RunFactWireSchema).min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
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
  /**
   * What this run is ABOUT, in the system's own words (ref dashboard-surfaces §1.2).
   *
   * It starts as the title the workflow's `presentation.title` composed from
   * the start input — `Separation 4502`, `EID 10620118` — and is REPLACED, once,
   * when the run's own reads have settled the subject's name at the leaf the
   * descriptor DECLARES (`subjectProjection`). A run that has not resolved a
   * subject yet, and a workflow that declares no subject leaf at all, both keep
   * the composed title: there is no blank arm and no guessed one, because a
   * title is the one column an operator scans before acting.
   *
   * This is NOT the operator's own name for the run — see `displayName`, which
   * is served beside it rather than folded into it, so a renamed row can still
   * say what the system thinks it is about.
   */
  title: z.string().min(1),
  /**
   * The operator's own name for this run, when they have given it one.
   *
   * Durable and authority-owned (`RunRecord.displayName`, written only by the
   * `rename` run command), and served in its own right rather than collapsed
   * into `title`. The collapse is what made the demo's
   * *"Named by you — subject is …"* tooltip unbuildable: once the two strings
   * are one field, no surface can tell an operator-authored title from a
   * system-derived one, and the operator loses the subject they renamed away.
   *
   * The row renders `displayName ?? title`; the absent arm has exactly one
   * reason, which is the same shape `subtitle` carries for the same kind of
   * fact.
   */
  displayName: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  subtitle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  status: QueueStatusSchema,
  liveMessage: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  warnings: RunWarningsWireSchema,
  pipeline: z.array(PipelineStepWireSchema),
  panelKind: PanelKindSchema,
  availableSections: z.array(RunDetailSectionSchema),
  /**
   * The row's OWN command controls (ref dashboard-surfaces §2.4, ref frontend-backend-integration §3.2/§8.5).
   *
   * Ref frontend-backend-integration §8.5 is the rule this field exists to satisfy: *interactive run
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

/**
 * Containment, lineage and surface kind are three views of one fact, so the
 * schema refuses a payload where they disagree rather than letting a surface
 * pick a winner.
 *
 * A `root` row has no parent and a parented row is never `root` — that half is
 * pure bookkeeping. The load-bearing half is `member`: a member is the row that
 * is COUNTED inside its parent's rollup and never at top level, and
 * `surfaceKind` is what the projector's own count filter reads, so a row that
 * called itself a member while presenting as a single run would be counted
 * twice — once in its parent's rollup and once in the day's totals.
 */
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
    /**
     * The first few members BY NAME, so a counted anchor whose own title is a
     * number — `5 separations` — still says who is in it.
     *
     * It is on the OPERATION variant alone because only a group has members, and
     * it is DERIVED from the member rows' own served titles rather than authored:
     * a preview composed from anything but the titles those rows draw could name
     * somebody the group does not contain. The `+N more` tail is part of the
     * string for the same reason the count is — both come off one member list, in
     * one place, so the preview and the rollup cannot disagree.
     *
     * Absent when the group has no members yet, or when none of them has resolved
     * a subject the preview could print; a group is a real thing before its
     * fan-out lands, and an empty string in that slot would read as a group of
     * nobody.
     */
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

/**
 * Archive-storage read arm only. Rows frozen before D269 have no `session` key;
 * the archive generation says whether that absence is historical or invalid.
 */
export const ArchivedQueueSurfaceStorageSchema = queueSurfaceWireSchema(QueueSessionWireSchema.optional());

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

/**
 * The browser systems a worker for this workflow may need, independently of
 * whether any session is open yet. `browsers[]` remains observation of open
 * contexts; this block is descriptor authority for the Session Panel's
 * pre-acquisition tiles. Optional is read-forward compatibility with older
 * dashboard producers, never permission for the current producer to omit it.
 */
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

/**
 * ONE worker, AS AUTHORITY HOLDS IT (D248).
 *
 * The card is the durable worker lease (`src/domain/run/worker.ts`) joined with
 * the browser sessions its span stream has open. That direction is ref execution-and-sessions §3's
 * own sentence — the lease exists partly because *"the Session Panel needs
 * worker phase without inferring it from whatever rows happen to be claimed"* —
 * and the projector used to do precisely the inference it names (a claimed row
 * ⇒ working, anything else ⇒ idle), which is why a live-but-unstarted daemon
 * read as `idle` and neither a paused nor a crashed worker could appear at all.
 *
 * **`state` and `directive` stay separate**, for the reason the durable record
 * states in its own header: a command writes what the operator ASKED for and
 * the worker writes what is actually TRUE, so folding a pending `pause` into
 * the state word would let a card read `Paused` while it is mid-transaction on
 * a real HR system. Every arm of both has a producer: `starting`/`idle`/
 * `working`/`paused` are lifecycle states the worker's own heartbeat reports,
 * `stopped`/`failed` split the terminal lifecycle by its recorded reason
 * (`operator`/`shutdown` versus `crashed`/`lease-expired`, the latter written
 * by the recovery sweep), and `directive` is written only by the
 * `stop-worker`/`pause-worker`/`resume-worker` commands. `stopping` remains a
 * requested directive until observed terminal closure.
 *
 * `leaseVersion` retains row-version evidence. Mutations use the distinct
 * lifetime/control revision in `controls.basis`, which heartbeats cannot stale.
 * The span `revision` remains a projection cursor, never a control token.
 */
export const WorkerControlWireSchema = z.strictObject({
  basis: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("present"), value: WorkerControlBasisSchema }), z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) })]),
  ownership: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("owned") }), z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) })]),
  operation: z.strictObject({ commandId: CommandIdSchema, type: z.enum(["plan-worker-count", "spawn-worker", "pause-worker", "resume-worker", "stop-worker", "refresh-browser", "reopen-browser"]),
    state: z.enum(["admitted", "ready", "executing", "succeeded", "refused", "uncertain"]), at: IsoInstantSchema,
    browserSessionId: BrowserSessionIdSchema.optional(), message: z.string().optional(), unresolved: z.boolean() }).optional(),
});

export const WorkerCardWireSchema = z.strictObject({
  workerId: WorkerIdSchema,
  /** The one workflow this worker claims for (ref execution-and-sessions §3.1) — from the lease, never guessed. */
  workflowId: WorkflowIdSchema,
  state: z.enum(["starting", "idle", "paused", "working", "stopped", "failed"]),
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
  const terminal = card.state === "stopped" || card.state === "failed";
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
  // The split IS the fact `failed` adds over `stopped`: a worker that was asked
  // to stop and a worker whose process died are two different mornings.
  const crashed = card.stopReason === "crashed" || card.stopReason === "lease-expired";
  if (card.stopReason !== undefined && crashed !== (card.state === "failed")) {
    context.addIssue({
      code: "custom",
      path: ["stopReason"],
      message: `stop reason ${card.stopReason} does not belong to a ${card.state} worker card`,
    });
  }
  // A settled lease holds nothing: its process is gone, and its browser
  // sessions went with it. Tiles on a dead card would be the panel claiming
  // resources nobody owns.
  if (terminal && card.browsers.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["browsers"],
      message: `a ${card.state} worker card holds no browser sessions`,
    });
  }
  requireUnique(card.browsers.map(({ sessionId }) => String(sessionId)), "browsers", context);
});
/**
 * 2i-B: durable notification row → wire. Severity orders by what the
 * operator must DO — a failure or an unknown write outcome is `error`, the
 * waiting/storage family is `warning`, and `verified-done` is `info`.
 * `snoozed` wins the state only while the snooze is still in force; an
 * expired snooze reads as its underlying status again, because snooze
 * suppresses delivery without changing read state (ref dashboard-surfaces §2.6, D138).
 */
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
});

export const NotificationWireSchema = z.discriminatedUnion("kind", [
  StandardNotificationWireSchema,
  BackfillGapNotificationWireSchema,
]).superRefine((row, context) => {
  if (row.kind === "notification" && (row.state === "snoozed") !== (row.snoozedUntil !== undefined)) {
    context.addIssue({ code: "custom", path: ["snoozedUntil"], message: "snoozed state requires its server expiry hint" });
  }
});

/**
 * The per-workflow worker POOL declaration (D269, ref execution-and-sessions §11.5)
 * — the CAS basis `plan-worker-count` and `spawn-worker` cite, served on the
 * day wire from `worker_pools` and nowhere else.
 *
 * `version` is the pool row's version and is the ONLY honest `expectedVersion`
 * for those two commands. It is not `WorkerCardWire.leaseVersion` (one
 * worker's row, the basis `stop-worker` cites) and not `revision` (a patch
 * cursor). A workflow ABSENT from this list has no pool row: its basis is 0
 * and the first plan creates the row — the list carries authority rows only,
 * and serving a fabricated `{desiredWorkers: 1, version: 0}` for every
 * registered workflow would be the projection inventing a declaration nobody
 * made.
 *
 * Like `workerCards` and `notifications`, this is a SNAPSHOT-level block: the
 * day patch stream carries queue-row splices only (D4), so a changed pool
 * reaches the client on the next snapshot, never through a patch.
 */
export const WorkerPoolWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  desiredWorkers: PositiveIntSchema,
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
  workerCards: z.array(WorkerCardWireSchema),
  /** D269: one entry per workflow that HAS a pool row; see `WorkerPoolWireSchema`. */
  workerPools: z.array(WorkerPoolWireSchema),
  notifications: z.array(NotificationWireSchema),
}).superRefine((day, context) => {
  requireUnique(day.monthCounts.map(({ day: value }) => value), "monthCounts", context);
  requireUnique(day.workflowCounts.map(({ workflowId }) => workflowId), "workflowCounts", context);
  requireUnique(day.statusCounts.map(({ status }) => status), "statusCounts", context);
  requireUnique(day.queueSurfaces.map(({ runId }) => runId), "queueSurfaces", context);
  requireUnique(day.workerCards.map(({ workerId }) => workerId), "workerCards", context);
  requireUnique(day.workerPools.map(({ workflowId }) => workflowId), "workerPools", context);
  requireUnique(day.notifications.map(({ notificationId }) => notificationId), "notifications", context);
});

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
export type DashboardDayWire = z.infer<typeof DashboardDayWireSchema>;

export type NotificationWire = z.infer<typeof NotificationWireSchema>;
