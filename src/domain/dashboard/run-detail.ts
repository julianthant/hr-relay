import { z } from "zod";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  BrowserSystemIdSchema,
  DiagnosticBundleIdSchema,
  ElementIdSchema,
  ErrorCodeSchema,
  EvidenceRefSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  NoteIdSchema,
  PageStateIdSchema,
  ProjectionCursorSchema,
  ReviewRecordIdSchema,
  RunIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  WriteBindingProofIdSchema,
  WriteIntentIdSchema,
} from "../ids.js";
import { UnscopedCommitReasonIdSchema } from "../unscoped-commit.js";
import { directIdentifierDigestReference } from "../redaction.js";
import { IdentityEvidencePacketSchema } from "../separations/identity-evidence.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { TimelineCategoryKeySchema } from "../workflow/presentation.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";
import {
  FailureCauseSchema,
  RemediationActionSchema,
  SubjectEvidenceWireSchema,
  WriteStateSchema,
} from "../trust/failure.js";
import { ActionDescriptorWireSchema } from "./actions.js";
import { ArtifactRefWireSchema } from "./artifacts.js";
import {
  PanelKindSchema,
  RecordRevisionSchema,
  RowRevisionSchema,
  RunDetailSectionSchema,
  wireResourceSchema,
} from "./primitives.js";
import { QueueStatusSchema } from "./projection.js";
import { ObservedDataPointWireSchema } from "../../events/types.js";

export const RunIdentityWireSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  actorId: ActorIdSchema,
  title: z.string().min(1),
  status: QueueStatusSchema,
  attempt: z.number().int().positive(),
});

/**
 * The closed `not-run` reasons a conditional node can record (ref workflow-model §5.5,
 * mirrored by `RunResultRecord`'s `not-run` arm). This is the SAME vocabulary
 * the durable result uses; the timeline never invents a third value.
 */
export const TimelineNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]);

/**
 * How long ONE step took, or why that is not a number.
 *
 * It is the executor's own span measurement — `span.ended` minus `span.started`
 * for the SAME `(attempt, spanPath)` identity (ref dashboard-surfaces §1.1) — and never the
 * gap between two consecutive timeline events, which measures the space
 * between steps and would attribute a worker's idle time to whichever node
 * happened to follow it.
 *
 * The absence arms are the interesting half, and each names a genuinely
 * different fact: a step still running has no end yet; a step whose
 * `span.started` never reached the fold has no start to subtract from; a gate
 * is not a task span at all; and an end that precedes its start is a clock
 * anomaly that must surface as an anomaly rather than as a clamped zero.
 */
export const TimelineDurationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), ms: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type TimelineDuration = z.infer<typeof TimelineDurationSchema>;

/**
 * Read a timeline event's duration FORWARD (D133).
 *
 * `durationMs` is optional on the wire for exactly one reason: an archived run
 * freezes a whole `RunDetailWire` into an immutable record, and a record
 * written before this leaf existed must still parse. Nothing may back-fill it
 * — a duration nobody measured is not zero — so a record that predates the
 * measurement reports that, by name. The live query always emits the leaf, and
 * `run-detail-timeline` pins that it does.
 */
export function timelineEventDuration(
  event: Readonly<{ durationMs?: TimelineDuration }>,
): TimelineDuration {
  return event.durationMs ?? {
    state: "absent",
    reason: "this record was frozen before per-step durations were served; no measurement was stored",
  };
}

export const TimelineEventWireSchema = z.strictObject({
  noteId: NoteIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  label: z.string().min(1),
  /**
   * `skipped` is its own arm and is NOT a flavour of `cancelled` (ref dashboard-surfaces §9
   * D-status vocabulary: `Cancelled` means *"You stopped it"*). A node whose
   * `when` was false, or that a branch did not select, was never started by
   * anyone — presenting it as an act the operator took is exactly the kind of
   * lie the charter forbids, independently of the durable result being right.
   */
  state: z.enum(["pending", "active", "done", "failed", "blocked", "cancelled", "skipped"]),
  /**
   * WHY a `skipped` step did not run, carried through from the executor's span
   * rather than re-derived. Absence stays explicit and reasoned: a span that
   * recorded no reason must say so, never borrow a plausible one.
   */
  notRun: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("present"), reason: TimelineNotRunReasonSchema }),
  ]),
  /**
   * This step's OWN measured duration. Optional on the wire only so a
   * `RunDetailWire` frozen into an archived record before the leaf existed
   * still parses (D133); read it through `timelineEventDuration`, never
   * directly, so the read-forward absence stays a reasoned one.
   */
  durationMs: TimelineDurationSchema.optional(),
}).superRefine((event, context) => {
  if (event.state !== "skipped" && event.notRun.state === "present") {
    context.addIssue({
      code: "custom",
      path: ["notRun"],
      message: `a ${event.state} timeline event cannot carry a not-run reason`,
    });
  }
});
/**
 * `replayed` is its own arm, and it is NOT a flavour of `pending` (D259).
 *
 * A node whose checkpoint this run replayed emits NO spans, by design (ref workflow-model
 * §5.3), and the timeline folds spans — so a step that replayed had nothing to
 * render and came out `pending` on a run that had already finished. `pending`
 * means *this has not happened yet*, which is false twice over on a terminal
 * run: it did happen, and the fact it produced is the one the run consumed.
 */
const TimelineStepStateSchema = z.enum(["pending", "active", "done", "failed", "blocked", "cancelled", "skipped", "replayed"]);

/**
 * WHERE a replayed step's stored fact came from — the checkpoint row's own
 * identity, never a derived one. `attempt` is the item's attempt that wrote it
 * (D221) and `claimGeneration` is WHICH execution of that attempt (D214),
 * absent for a row written before D214 because that row names none and a
 * fabricated `1` would be a claim nobody recorded.
 */
export const TimelineReplaySourceSchema = z.strictObject({
  attempt: z.number().int().positive(),
  claimGeneration: z.number().int().positive().optional(),
});

/**
 * ONE member node's contribution to a categorical step (D225) — served so the
 * step's hover/accessible detail can name what folded into it without the
 * client re-deriving the graph.
 */
export const TimelineStepMemberWireSchema = z.strictObject({
  label: z.string().min(1),
  state: TimelineStepStateSchema,
  /** Sum of this node's measured execution durations; absent when none measured. */
  durationSec: z.number().int().nonnegative().optional(),
  /** D259 — present exactly when this member replayed; see the refinement. */
  replayedFrom: TimelineReplaySourceSchema.optional(),
  /**
   * D307 — WHY a `skipped` member did not run, read off its span's own closed
   * reason and never re-derived. It is what lets the strip draw an
   * `operator-asserted` member (the operator omitted its step and typed the
   * facts its producer rebuilt the output from) distinctly from a
   * `step-omitted` one (nothing rebuilt it and it did not run at all) — two
   * completely different facts that both fold to `skipped`.
   *
   * Absent when the span recorded no reason, which stays exactly that: a
   * member whose reason authority does not hold, never a plausible one.
   */
  notRunReason: TimelineNotRunReasonSchema.optional(),
}).superRefine((member, context) => {
  if (member.state !== "skipped" && member.notRunReason !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["notRunReason"],
      message: `a ${member.state} member cannot carry a not-run reason`,
    });
  }
  if ((member.state === "replayed") !== (member.replayedFrom !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["replayedFrom"],
      message: `a replayed member names the checkpoint it replayed and nothing else may: state ${member.state}`,
    });
  }
  if (member.state === "replayed" && member.durationSec !== undefined) {
    // A replayed node emitted no span, so nothing measured it. `0` would read
    // as "it ran instantly", which is the `took 0s` this decision exists to
    // delete from the surface.
    context.addIssue({
      code: "custom",
      path: ["durationSec"],
      message: "a replayed member has no measurement; a replay emits no span to measure",
    });
  }
});

/**
 * D225 — the CATEGORICAL timeline step. The run-detail strip renders these,
 * one segment per descriptor-declared category (or per node for a workflow
 * that declares nothing), never one per raw execution: the composed
 * separations graph drew eighteen truncated stubs before this. State is a fold
 * over the member nodes' own states; `executions` carries the demo's `×N`
 * marker when any member ran more than once (a gate park/resume re-running an
 * `always-rerun` node is the ordinary cause), so a re-execution folds into its
 * category instead of drawing a duplicate segment.
 *
 * A category is `replayed` (D259) only when EVERY member replayed; one member
 * that executed makes the category `done`, and the member list carries the
 * breakdown either way.
 */
export const TimelineStepWireSchema = z.strictObject({
  label: z.string().min(1),
  state: TimelineStepStateSchema,
  /** Sum of measured member durations; absent when nothing was measured. */
  durationSec: z.number().int().nonnegative().optional(),
  /** Max executions of any one member node; present only when ≥ 2. */
  executions: z.number().int().min(2).optional(),
  members: z.array(TimelineStepMemberWireSchema).min(1),
});
export type TimelineStepWire = z.infer<typeof TimelineStepWireSchema>;

export const TimelineWireSchema = z.strictObject({
  events: z.array(TimelineEventWireSchema),
  /**
   * D225's categorical steps. Optional on the wire ONLY so a `RunDetailWire`
   * frozen into an archived record before the field existed still parses
   * (D133) — the client falls back to the per-event strip for exactly those
   * records, and a live serve always carries it.
   */
  steps: z.array(TimelineStepWireSchema).optional(),
})
  .superRefine((timeline, context) => {
    const ids = timeline.events.map(({ noteId }) => noteId);
    const sequences = timeline.events.map(({ sequence }) => sequence);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline note ids must be unique" });
    if (new Set(sequences).size !== sequences.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline sequences must be unique" });
    // Step labels are DISPLAY values and may legitimately repeat: the derived
    // per-node default labels a node by its contract title, and two nodes may
    // share one. Declared category labels are author-controlled and the
    // factory demands THOSE unique; the wire does not re-litigate it.
  });

/**
 * D237 — the `resolved` arm carries the APPROVER.
 *
 * `resolvedBy` is REQUIRED and that is safe to require rather than read
 * forward: until D237 this arm was structurally unreachable (the command
 * service emits `resolutionKey: "resolved"` for every gate and the server
 * mapped only the literal keys `approved`/`rejected`), so no served wire and no
 * archived record can hold a `resolved` gate that predates the field. Making it
 * optional would have bought read-forward safety for a shape nothing ever
 * wrote, at the cost of a settled gate that can render without naming a human —
 * which is the whole defect this arm exists to close.
 *
 * The three facts are one durable row's, never three surfaces': the kernel
 * writes `resolvedBy`/`resolvedAt` onto the `gate_results` row inside the same
 * transaction that stores the result (D202), and the verdict comes from D204's
 * declared arm table over that row's own payload — the same source the evidence
 * receipt derives its decision row from.
 */
export const GateDecisionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("open"), gateId: NoteIdSchema, label: z.string().min(1), openedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
  z.strictObject({ state: z.literal("resolved"), gateId: NoteIdSchema, label: z.string().min(1), resolution: z.enum(["approved", "rejected"]), resolvedBy: ActorIdSchema, resolvedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
]);
/**
 * D238 — a REHEARSAL's terminal outcome.
 *
 * `rehearsal` states that this run's terminal record is a dry-run PREVIEW: the
 * envelope asked for a dry run and the stored terminal row is bound to the
 * preview schema (D210's coherence pair). It is not a sixth `result` and not a
 * new confidence tier — the verdict itself stays in the receipt's own closed
 * vocabulary, and a previewed run takes `partial`, which is exactly what
 * `buildRunEvidenceReceipt` derives for the same run (its terminal-result
 * obligation is `unknown` and its `DRY_RUN_PREVIEW` warning is load-bearing).
 * The refinement below is the load-bearing half: `verified-done` is reserved for
 * an independently verified REAL completion, so a rehearsal may never wear it.
 *
 * `z.literal(true).optional()` rather than a boolean: absence is the only other
 * spelling of "not a rehearsal", so `false` would be a second one. Optional for
 * D133 read-forward — a `RunDetailWire` frozen into an archived record before
 * this field existed still parses, and its silence is not a claim that the run
 * was real.
 */
export const OutcomeWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({
    state: z.literal("terminal"),
    result: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]),
    completedAt: IsoInstantSchema,
    rehearsal: z.literal(true).optional(),
  }).superRefine((outcome, context) => {
    if (outcome.rehearsal === true && outcome.result === "verified-done") {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "a rehearsal cannot be verified-done; that result names an independently verified real completion",
      });
    }
  }),
]);
export const ContextSummaryWireSchema = z.strictObject({
  dataFacts: z.number().int().nonnegative(),
  evidenceFacts: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
});

/** What the initial run read can truthfully say before the lazy capture list is requested. */
export const RunCaptureAvailabilityWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), artifactCount: z.number().int().positive() }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({
    state: z.literal("error"),
    code: ErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
]);
export type RunCaptureAvailabilityWire = z.infer<typeof RunCaptureAvailabilityWireSchema>;

function sectionsCompatible(panelKind: z.infer<typeof PanelKindSchema>, sections: readonly z.infer<typeof RunDetailSectionSchema>[]): boolean {
  if (panelKind === "run" || panelKind === "member") return !sections.includes("review") && !sections.includes("people");
  if (panelKind === "review") return !sections.includes("people");
  return !sections.includes("review");
}

/**
 * Every section a panel of this kind may ADVERTISE, derived from the same
 * compatibility rule the wire refinement above enforces (D274 item 4).
 *
 * It exists so a reference surface can print a panel kind's section set without
 * authoring one: an authored list is a second source that goes stale the day
 * `sectionsCompatible` gains an arm, and a catalog documenting a section set the
 * wire would refuse teaches the operator a product that does not exist. This is
 * the CEILING, not a promise — a real run advertises the subset its descriptor
 * actually produced, which is why the surface says so in its own words.
 */
export function sectionsForPanelKind(
  panelKind: z.infer<typeof PanelKindSchema>,
): readonly z.infer<typeof RunDetailSectionSchema>[] {
  return RunDetailSectionSchema.options.filter((section) => sectionsCompatible(panelKind, [section]));
}

export const RunDetailWireSchema = z.strictObject({
  runId: RunIdSchema,
  rowRevision: RowRevisionSchema,
  panelKind: PanelKindSchema,
  header: RunIdentityWireSchema,
  timeline: TimelineWireSchema,
  gate: GateDecisionWireSchema,
  outcome: OutcomeWireSchema,
  context: ContextSummaryWireSchema,
  /** Optional only for archived records frozen before DCA3; every live read emits it. */
  captures: RunCaptureAvailabilityWireSchema.optional(),
  /**
   * D307 — the timeline steps this run OMITTED at start, by descriptor key.
   *
   * Keys only. The operator's typed facts are the run's input to those steps
   * and never cross this wire: what a panel needs to say is WHICH steps nobody
   * read, and the timeline's own members say what each node of them did.
   *
   * Present only when the run omitted something (`.min(1)`), so absence is one
   * fact and not two: no run before D307 could omit a step, so an archived
   * record frozen without this field omitted none either.
   */
  omittedSteps: z.array(TimelineCategoryKeySchema).min(1).optional(),
  availableSections: z.array(RunDetailSectionSchema),
}).superRefine((detail, context) => {
  if (detail.runId !== detail.header.runId) {
    context.addIssue({ code: "custom", path: ["header", "runId"], message: "run detail and header identities must match" });
  }
  if (new Set(detail.availableSections).size !== detail.availableSections.length) {
    context.addIssue({ code: "custom", path: ["availableSections"], message: "available sections must be unique" });
  }
  if (!sectionsCompatible(detail.panelKind, detail.availableSections)) {
    context.addIssue({ code: "custom", path: ["availableSections"], message: `sections are incompatible with ${detail.panelKind} panel` });
  }
  if (detail.outcome.state === "terminal" && detail.gate.state === "open") {
    context.addIssue({ code: "custom", path: ["gate"], message: "terminal detail cannot retain an open gate" });
  }
  /*
   * D307 — a run that read a step from an operator's form is not a verified
   * completion, exactly as D238's rehearsal is not. Structural, so no producer
   * can serve the two together by forgetting the rule.
   */
  if (detail.omittedSteps !== undefined && detail.outcome.state === "terminal" && detail.outcome.result === "verified-done") {
    context.addIssue({
      code: "custom",
      path: ["outcome", "result"],
      message: "a run with an omitted step cannot be verified-done; nothing verified the values typed in its place",
    });
  }
});

export const NoteWireSchema = z.strictObject({
  noteId: NoteIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  level: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
});

/**
 * The one lazy-log row vocabulary. Notes retain their existing wire under the
 * `note` arm while the span stream supplies recorded page observations and the
 * durable fence beat. A row carries its own sequence because notes and spans
 * are one ordered log, not two independently paged feeds.
 */
const LogRowBase = {
  logId: NoteIdSchema,
  sequence: z.number().int().nonnegative(),
} as const;

const LogProducerWireSchema = z.strictObject({
  nodeId: NodeIdSchema,
  step: z.string().min(1),
  taskId: TaskIdSchema,
  system: BrowserSystemIdSchema.optional(),
});

const LogSpanIdentityWireSchema = z.strictObject({
  attempt: z.number().int().positive(),
  traceId: TraceIdSchema,
  spanPath: z.string().min(1),
});

export const LogRowWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("note"),
    ...LogRowBase,
    note: NoteWireSchema,
  }).superRefine((row, context) => {
    if (row.logId !== row.note.noteId) {
      context.addIssue({ code: "custom", path: ["logId"], message: "a note row's log id must be its existing note id" });
    }
    if (row.sequence !== row.note.sequence) {
      context.addIssue({ code: "custom", path: ["sequence"], message: "a note row and its existing note must carry one sequence" });
    }
  }),
  z.strictObject({
    kind: z.literal("observed"),
    ...LogRowBase,
    at: IsoInstantSchema,
    ...LogSpanIdentityWireSchema.shape,
    producer: LogProducerWireSchema,
    points: z.array(ObservedDataPointWireSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("transaction-fenced"),
    ...LogRowBase,
    at: IsoInstantSchema,
    ...LogSpanIdentityWireSchema.shape,
    producer: LogProducerWireSchema,
  }),
]);
export type LogRowWire = z.infer<typeof LogRowWireSchema>;

/** Immutable combined-log snapshot plus the next zero-based row offset. */
export const LogPageCursorSchema = z.string()
  .regex(/^lc:[0-9a-f]{64}:[1-9]\d*$/, "log cursor must be lc:<snapshot digest>:<positive offset>")
  .brand<"LogPageCursor">();

export const NotePageSchema = z.strictObject({
  runId: RunIdSchema,
  /**
   * D270 / L3 — the one combined page. Optional only so a frozen archive
   * written before observed-log rows existed remains readable; a live query
   * always sends it. `notes` below stays as an exact compatibility mirror for
   * the renderer that predates this row vocabulary.
   */
  rows: z.array(LogRowWireSchema).optional(),
  notes: z.array(NoteWireSchema),
  nextCursor: z.discriminatedUnion("state", [
    // `ProjectionCursorSchema` is retained only for archived note pages written
    // before immutable combined-log snapshots. Live queries emit `lc:`.
    z.strictObject({ state: z.literal("present"), value: z.union([LogPageCursorSchema, ProjectionCursorSchema]) }),
    z.strictObject({ state: z.literal("absent"), reason: z.literal("end-of-page") }),
  ]),
}).superRefine((page, context) => {
  if (page.notes.some(({ runId }) => runId !== page.runId)) context.addIssue({ code: "custom", path: ["notes"], message: "note run identities must match page" });
  const ids = page.notes.map(({ noteId }) => noteId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["notes"], message: "note ids must be unique" });
  if (page.rows !== undefined) {
    const sequences = page.rows.map(({ sequence }) => sequence);
    if (new Set(sequences).size !== sequences.length) context.addIssue({ code: "custom", path: ["rows"], message: "log row sequences must be unique" });
    const rowNotes = page.rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
    const sameNotes = rowNotes.length === page.notes.length && rowNotes.every((note, index) => {
      const mirrored = page.notes[index];
      return mirrored !== undefined
        && note.noteId === mirrored.noteId
        && note.runId === mirrored.runId
        && note.sequence === mirrored.sequence
        && note.at === mirrored.at
        && note.level === mirrored.level
        && note.message === mirrored.message;
    });
    if (!sameNotes) {
      context.addIssue({ code: "custom", path: ["notes"], message: "notes must exactly mirror the note rows of this combined log page" });
    }
  }
});

export const ReviewRecordWireSchema = z.strictObject({
  recordId: ReviewRecordIdSchema,
  runId: RunIdSchema,
  recordRevision: RecordRevisionSchema,
  label: z.string().min(1),
  state: z.enum(["pending", "accepted", "rejected", "failed"]),
  evidence: z.array(EvidenceRefSchema),
});
export const ReviewPageSchema = z.strictObject({
  runId: RunIdSchema,
  records: z.array(ReviewRecordWireSchema),
}).superRefine((page, context) => {
  if (page.records.some(({ runId }) => runId !== page.runId)) context.addIssue({ code: "custom", path: ["records"], message: "review record run identities must match page" });
  const ids = page.records.map(({ recordId }) => recordId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["records"], message: "review record ids must be unique" });
});

export const PeopleMemberWireSchema = z.strictObject({
  runId: RunIdSchema,
  parentRunId: RunIdSchema,
  rowRevision: RowRevisionSchema,
  label: z.string().min(1),
  status: QueueStatusSchema,
});
export const PeoplePageSchema = z.strictObject({
  parentRunId: RunIdSchema,
  members: z.array(PeopleMemberWireSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: ProjectionCursorSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.literal("end-of-page") }),
  ]),
}).superRefine((page, context) => {
  if (page.members.some(({ parentRunId }) => parentRunId !== page.parentRunId)) context.addIssue({ code: "custom", path: ["members"], message: "member parent identities must match page" });
  const ids = page.members.map(({ runId }) => runId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["members"], message: "member run ids must be unique" });
  if (page.total < page.members.length) context.addIssue({ code: "custom", path: ["total"], message: "people total cannot be smaller than the page" });
});

const ContextSectionSchema = z.strictObject({
  runId: RunIdSchema,
  entries: z.array(z.strictObject({ label: z.string().min(1), valueRedacted: z.string().min(1) })),
});

/**
 * A correctable value is a SCALAR leaf: the rail edits it as text and the
 * kernel re-parses the whole post-patch output, so a structured value has no
 * honest single-field edit affordance and stays locked with that reason.
 */
const EditableScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Ref data-intake-and-edit-data §6 / ref dashboard-surfaces D19 (2i-C): the Data section carries, per entry, exactly
 * what a checkpoint correction needs — the patch target identity and the raw
 * recorded scalar — or the reason it is not editable, so `editPolicyFor` shows
 * a reason instead of a dead control. `pendingCorrection` is the staged-write
 * honesty rule applied to corrections: a saved patch rides `envelope.injected`
 * and becomes authority only at replay, so until the run resumes the recorded
 * value and the pending value are BOTH true and both render.
 */
const ContextDataEntryEditSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("editable"),
    nodeId: NodeIdSchema,
    fieldPath: ContractFieldPathSchema,
    value: EditableScalarSchema,
    pendingCorrection: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("none") }),
      z.strictObject({
        state: z.literal("pending"),
        value: EditableScalarSchema,
        correctedAt: IsoInstantSchema,
      }),
    ]),
  }),
  z.strictObject({ state: z.literal("locked"), reason: z.string().min(1) }),
]);

/**
 * D252 — WHERE a ledger value came from: the step that recorded it, whether
 * that step READ it or WROTE it, and the system it was recorded against.
 *
 * Every leaf is DECLARED, not sniffed. `dir` is the producing node's own task
 * `effect` (`read` on a task node, `commit` on a transaction node), which is
 * the contract's word for what it does to the world — the rail's header used
 * to say "nothing durable says whether a recorded field was read or written",
 * and that was true of the CHECKPOINT ROW and false of the descriptor that
 * produced it. `system` is the driver system of the store that implements the
 * task, the same binding the explorer's node panel reads; a headless store
 * owns none, so the field is absent rather than a fabricated "internal".
 *
 * The whole block is optional and read forward (D133): an entry recorded under
 * an earlier descriptor has no field identity, so nothing can name its step —
 * which is the same absence the `edit` lock already states in words.
 */
const ContextDataOriginSchema = z.strictObject({
  nodeId: NodeIdSchema,
  /** The node's display label — what the timeline calls the same step. */
  step: z.string().min(1),
  dir: z.enum(["read", "write"]),
  system: BrowserSystemIdSchema.optional(),
});

/**
 * D252 — the REUSE bound this value is recorded under (ref workflow-model §5.5).
 *
 * `maxAge` and `override` are the producing read contract's own
 * `FreshnessPolicy`, resolved at this entry's exact field path by the same
 * `byField`-beats-default rule `auditCheckpointFreshness` applies, so the
 * sentence the rail prints and the rule the executor enforces are one
 * declaration. `feeds` is the static set of commit nodes the value can reach —
 * the walk that decides whether the bound BITES at all, since a fact that
 * reaches no write is never refused for age.
 *
 * `Number.POSITIVE_INFINITY` is a legal limit and `JSON.stringify` turns it
 * into `null`, which would arrive as a MISSING bound rather than a deliberate
 * one, so an unbounded policy travels as the word (the explorer wire's rule).
 *
 * Absent for an entry whose producing node declares no freshness policy at
 * all — a `prepare` or `commit` contract has none, because a write is not a
 * fact anyone reuses.
 */
const ContextDataFreshnessSchema = z.strictObject({
  maxAge: z.union([z.number().int().nonnegative(), z.literal("unbounded")]),
  override: z.enum(["forbidden", "audited"]),
  feeds: z.array(z.strictObject({ nodeId: NodeIdSchema, label: z.string().min(1) })),
});

export const ContextDataSectionSchema = z.strictObject({
  runId: RunIdSchema,
  /**
   * The run-level half of the edit policy, computed against raw authority
   * lifecycle — the coarse `header.status` cannot distinguish `parked-gate`
   * from an open gate on a running row, and a client-side guess would be a
   * claim about whether a save can land. `expectedVersion` is the CAS basis
   * for the values THIS response serves.
   */
  editing: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("editable"), expectedVersion: z.number().int().positive() }),
    z.strictObject({ state: z.literal("locked"), reason: z.string().min(1) }),
  ]),
  entries: z.array(z.strictObject({
    label: z.string().min(1),
    valueRedacted: z.string().min(1),
    edit: ContextDataEntryEditSchema,
    /**
     * WHEN this value was established and by WHAT, off the producing
     * checkpoint's own `FactProvenance` row (ref workflow-model §5.6).
     *
     * The rail's header comment has listed an observation clock among four
     * axes the 1i wire dropped since the surface was ported, and of those four
     * this one was never missing from AUTHORITY — `editableEntryOf` has read
     * the checkpoint since 2i-C and thrown its `.provenance` away. So this is
     * a projection of a fact already loaded, not a new storage read and not a
     * migration: there is no schema version to move.
     *
     * All three are OPTIONAL and every one of them is read forward (D133). A
     * pre-2i checkpoint carries provenance for the leaves its task recorded and
     * nothing for a leaf it did not, an entry with no field identity at all
     * (a key recorded under an earlier descriptor) can have none by
     * construction, and a run whose step never checkpointed has no row to read
     * — three different absences, all of which mean "this build cannot date
     * this value", which is what an absent field says. Substituting the
     * checkpoint's `writtenAt` would date the ROW rather than the FACT, and a
     * derived value's own rule (`originalObservedAt`) exists precisely because
     * those two are not the same instant.
     *
     * `correctedAt` is present only on an operator correction and is what the
     * surface's `corrected` badge is drawn from. The demo's `refreshed` badge
     * has NO arm here on purpose: it means "this value changed on the server
     * since you looked", which needs the superseded reading beside the current
     * one, and this wire carries one value per entry.
     */
    observedAt: IsoInstantSchema.optional(),
    source: z.enum(["live", "derived", "operator"]).optional(),
    correctedAt: IsoInstantSchema.optional(),
    /**
     * D307 — the omitted STEP this value was asserted for, present exactly when
     * the checkpoint row that carries it is an operator assertion.
     *
     * Before D307 an `operator` source meant one thing — a correction, which
     * carries `correctedAt` — and the rail drew nothing for it because the
     * `corrected` badge already said it. An asserted value is operator-sourced
     * with NO correction, so without this leaf it would draw as an unmarked
     * row with a clock beside it: a value nobody read, presented exactly like
     * one a task observed.
     */
    assertedStep: TimelineCategoryKeySchema.optional(),
    origin: ContextDataOriginSchema.optional(),
    freshness: ContextDataFreshnessSchema.optional(),
  })).superRefine((entries, context) => {
    entries.forEach((entry, index) => {
      // A bound with no origin is a bound about nothing: `freshness` is
      // resolved from the producing node's contract, so an entry that cannot
      // name its step cannot have one either. Refused here rather than left to
      // a surface that would print an unattributed age.
      // An asserted ROW may hold a leaf no provenance point covers, which is
      // dateless and sourceless — and still asserted. What it may never be is
      // live or derived: those two say a task established the value.
      if (entry.assertedStep !== undefined && (entry.source === "live" || entry.source === "derived")) {
        context.addIssue({
          code: "custom",
          path: [index, "assertedStep"],
          message: `an asserted value is operator-sourced; a ${entry.source} leaf never names an omitted step`,
        });
      }
      if (entry.freshness !== undefined && entry.origin === undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "freshness"],
          message: "a freshness bound is the producing step's declaration; it cannot be served without an origin",
        });
      }
    });
  }),
});
export type ContextDataSectionWire = z.infer<typeof ContextDataSectionSchema>;

/**
 * The receipt section serves the WHOLE `RunEvidenceReceipt` (D140), not a
 * pointer to it. Ref operator-trust §2.2 puts redaction at capture time — "Redaction is
 * not deferred to the UI" — and the receipt's every value is already a
 * `RedactedField` carrying its own classification and transform, so there is
 * nothing left for a wire projection to strip and nothing a second projection
 * could do except lose the classification that makes the value readable.
 */
const ReceiptSectionSchema = RunEvidenceReceiptSchema;

/**
 * The failure section serves CONTENT, not `{ runId, failureId }` (D142).
 *
 * Every field below is one the schema itself made display-safe: subject
 * identity travels as a digest plus an already-redacted display suffix, the
 * page as `urlRedacted`/`titleRedacted`, the input as a fingerprint. The
 * projection copies exactly those and NOTHING else off the `FailureRecord` —
 * an unclassified field is dropped by omission from this strict schema rather
 * than passed through, which is the ref clock-config-secrets rule applied structurally instead
 * of by a filter someone has to remember to update.
 *
 * `sameFingerprintSeen` is ref operator-trust §2.1's "same failure seen before" as a
 * COUNT rather than a list: the count is what the operator acts on, and it is
 * answerable without projecting other runs' subjects onto this one's panel.
 * `diagnosticBundle` is an explicit absence union — the capture trigger is a
 * separate 2g slice, so an absent bundle says why instead of rendering empty.
 */
export const FailureDetailWireSchema = z.strictObject({
  runId: RunIdSchema,
  failureId: FailureIdSchema,
  traceId: TraceIdSchema,
  attempt: z.number().int().positive(),
  workflowId: WorkflowIdSchema,
  nodeId: NodeIdSchema.optional(),
  taskId: TaskIdSchema.optional(),
  fingerprint: FailureFingerprintSchema,
  code: ErrorCodeSchema,
  summary: z.string().min(1),
  transient: z.boolean(),
  /**
   * Ref dashboard-surfaces D18's write-state sentence renders UNCONDITIONALLY in the stream —
   * "what this run left behind" is the difference between a safe retry and a
   * duplicate termination, so it can never sit behind a disclosure.
   */
  writeState: WriteStateSchema,
  subject: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({
      state: z.literal("present"),
      expected: SubjectEvidenceWireSchema.optional(),
      observed: SubjectEvidenceWireSchema.optional(),
      proofRef: WriteBindingProofIdSchema.optional(),
    }),
  ]),
  page: z.strictObject({
    screen: ScreenIdSchema.optional(),
    state: PageStateIdSchema.optional(),
    urlRedacted: z.string().min(1).optional(),
    titleRedacted: z.string().min(1).optional(),
  }).optional(),
  action: z.strictObject({
    elementId: ElementIdSchema.optional(),
    operation: z.enum(["goto", "wait", "read", "fill", "click", "choose", "commit"]).optional(),
    sequence: z.number().int().positive().optional(),
  }).optional(),
  causeChain: z.array(FailureCauseSchema).min(1),
  remediation: z.array(RemediationActionSchema).min(1),
  sameFingerprintSeen: z.number().int().positive(),
  diagnosticBundle: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("present"), bundleId: DiagnosticBundleIdSchema }),
  ]),
  occurredAt: IsoInstantSchema,
}).superRefine((failure, context) => {
  if (failure.sameFingerprintSeen < 1) {
    context.addIssue({
      code: "custom",
      path: ["sameFingerprintSeen"],
      message: "the failure being projected is itself one occurrence; the count cannot be zero",
    });
  }
});

/** D292: provenance is a closed membership, not failure detail or actor data. */
export const RunCaptureOriginWireSchema = z.strictObject({
  bundleId: DiagnosticBundleIdSchema,
  originKind: z.enum(["failure", "unexpected-state", "subject-mismatch", "recovery-park", "operator-request"]),
});
export const RunCaptureArtifactWireSchema = z.strictObject({
  artifact: ArtifactRefWireSchema,
  origins: z.array(RunCaptureOriginWireSchema).min(1),
}).superRefine((capture, context) => {
  const seen = new Set<string>();
  for (const [index, origin] of capture.origins.entries()) {
    if (seen.has(origin.bundleId)) {
      context.addIssue({ code: "custom", path: ["origins", index, "bundleId"],
        message: "a capture requires one membership per verified bundle" });
    }
    seen.add(origin.bundleId);
  }
});
export type RunCaptureArtifactWire = z.infer<typeof RunCaptureArtifactWireSchema>;

export const CaptureListSchema = z.strictObject({
  runId: RunIdSchema,
  /** Every ref was verified before this response; later byte loss fails at the byte route. */
  artifacts: z.array(RunCaptureArtifactWireSchema).min(1),
}).superRefine((captures, context) => {
  const seen = new Set<string>();
  const origins = new Map<string, string>();
  for (const [index, capture] of captures.artifacts.entries()) {
    if (seen.has(capture.artifact.artifactId)) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "artifact", "artifactId"],
        message: "a capture list requires one entry per artifact" });
    }
    seen.add(capture.artifact.artifactId);
    for (const origin of capture.origins) {
      const existing = origins.get(origin.bundleId);
      if (existing !== undefined && existing !== origin.originKind) {
        context.addIssue({ code: "custom", path: ["artifacts", index, "origins"],
          message: "a verified bundle cannot have conflicting origin kinds" });
      }
      origins.set(origin.bundleId, origin.originKind);
    }
  }
});

/* ── the parked-write vocabulary, mirrored across the browser boundary ────── */

/**
 * Ref write-safety's park codes and subject-binding evidence, RE-DECLARED here rather
 * than imported, and pinned to the durable originals by `wire-connectivity`.
 *
 * The import would be the obvious move and it is not available: both live in
 * `write-safety.ts`, which imports `node:crypto`, and this module is in the
 * dashboard bundle's reach — a `node:*` binding several modules deep is the
 * exact defect ref frontend-backend-integration §8.13 exists for. Hoisting them into the browser-safe
 * `write-safety-primitives.ts` is the structurally right fix and is
 * deliberately NOT taken here: that file is inside every workflow descriptor's
 * source closure, so editing it moves `contractFingerprint`, which the
 * Workflow Explorer and archive surfaces RENDER — the parity corpus drifts on
 * a hash even though not one pixel of layout moves. That is a real finding
 * about the corpus, not a licence to re-freeze it, so the copy stays and the
 * guard makes it provable instead of hopeful: a member added to either
 * original and not to its mirror fails.
 */
const ParkedWriteCodeSchema = z.enum([
  "unknown",
  "ambiguous",
  "present-proof-invalid",
  "binding-invalid",
  "operator-required",
]);

export const ParkedWriteSubjectEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person"),
    identifierKind: z.enum(["eid", "kuali-id", "email"]),
    bindingDigest: FingerprintSchema,
    displaySuffix: z.string().regex(/^[A-Za-z0-9*@._-]{2,32}$/),
  }),
  z.strictObject({
    kind: z.literal("artifact"),
    artifactId: ArtifactIdSchema,
    bindingDigest: FingerprintSchema,
  }),
  z.strictObject({
    kind: z.literal("catalog"),
    catalogKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    bindingDigest: FingerprintSchema,
  }),
]);

/**
 * WHO the fenced write was bound to, in the only form a surface may see it.
 *
 * A `subject-match` binding proof carries `expected` AND `observed` subject
 * evidence, and its own `superRefine` already refuses any proof whose two
 * halves differ — so projecting ONE value is not a shortcut, it is the whole
 * fact: the proof exists precisely because the two agreed.
 *
 * The evidence is served in the DURABLE `SubjectEvidence` shape, member for
 * member, not as a second projection of it. That shape is display-safe by
 * construction — a binding digest plus a bounded suffix, a branded artifact
 * id, or a closed catalog key — so re-shaping it into `{ digest,
 * displayRedacted }` would claim a redaction this projection did not perform
 * and would drop the digest that makes the value checkable against the
 * failure panel's copy.
 *
 * The `unscoped` arm is ref write-safety's reviewed no-subject commit. It has no subject
 * to redact and must not pretend to one: it names the reviewed reason id from
 * the closed registry, which is repository-authored text by construction.
 */
export const ParkedWriteSubjectWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("subject-match"),
    proofId: WriteBindingProofIdSchema,
    observedAt: IsoInstantSchema,
    /** `expected` and `observed`, which the proof schema pins as identical. */
    evidence: ParkedWriteSubjectEvidenceSchema,
  }),
  z.strictObject({
    state: z.literal("unscoped"),
    proofId: WriteBindingProofIdSchema,
    observedAt: IsoInstantSchema,
    reviewedReasonId: UnscopedCommitReasonIdSchema,
  }),
]);

/* ── the completion proof contract (ref write-safety §4.1, D245) ───────────────────── */

/**
 * One leaf of the proof a confirmed-present resolution carries, addressed by
 * the dot path it occupies in the proof value.
 *
 * The server derives these from the commit contract's own
 * `writeSafety.completion.proofSchema` (`describeProofShape`); nothing here is
 * authored. A `fixed` leaf is NOT an operator input — it is a literal the
 * schema pins, and a form that let a person type it would be offering a choice
 * the schema does not have.
 */
export const ProofFieldWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fixed"),
    path: ContractFieldPathSchema,
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.strictObject({
    kind: z.literal("text"),
    path: ContractFieldPathSchema,
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    /** The regex SOURCE — a client cannot be handed a zod schema. */
    pattern: z.string().min(1).optional(),
    format: z.literal("iso-datetime").optional(),
    /**
     * The leaf carries a `.refine()`, which no wire can transport. The surface
     * says the server checks more than the box does rather than implying its
     * own green tick is the verdict; the kernel's parse is the authority.
     */
    serverOnlyRules: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("choice"),
    path: ContractFieldPathSchema,
    options: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    kind: z.literal("integer"),
    path: ContractFieldPathSchema,
    minimum: z.number().int().optional(),
    maximum: z.number().int().optional(),
  }),
  z.strictObject({ kind: z.literal("boolean"), path: ContractFieldPathSchema }),
]);
export type ProofFieldWire = z.infer<typeof ProofFieldWireSchema>;

/**
 * WHAT A CONFIRMED-PRESENT RESOLUTION MUST CARRY (D245).
 *
 * `resolvePresent` refuses any proof whose `schemaHash` is not the commit
 * contract's own and then parses the value through that exact schema. Serving
 * neither half is why the present arm was unreachable from every surface in the
 * build: a client could compose neither, and minting a plausible `schemaHash`
 * to make a button clickable is the fabricated constant this program exists to
 * refuse.
 *
 * The `unavailable` arm is a REASON, never an empty form. A parked write whose
 * workflow is no longer registered, whose transaction node no longer commits
 * this task, or whose proof schema this build cannot describe still gets its
 * panel and still gets the confirmed-ABSENT arm — what it does not get is a
 * form that would compose something the kernel will not accept.
 */
export const ProofContractWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("served"),
    /** The commit contract the proof belongs to, for the operator's record. */
    commitTaskId: TaskIdSchema,
    /**
     * How this write WOULD have proved itself unattended. It is context the
     * operator needs: `save-verify` means a reload read-back is the only
     * landing proof, which is exactly what they are standing in for.
     */
    completionKind: z.enum(["receipt", "save-verify", "upload-verify"]),
    /** The exact value the resolution's `proof.schemaHash` must equal. */
    schemaHash: FingerprintSchema,
    fields: z.array(ProofFieldWireSchema).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type ProofContractWire = z.infer<typeof ProofContractWireSchema>;

/**
 * The parked-write section (ref write-safety §4.1, ref frontend-backend-integration §3.3/§8.5).
 *
 * A run in `parked-write` is the one lifecycle whose ordinary controls are
 * REFUSED BY NAME: the kernel rejects generic retry for it, because a fenced
 * write that may or may not exist in a real HR system is not a thing anyone
 * gets to "try again". Until this section existed the operator saw a run
 * rendered as generic `blocked` with two typed resolutions implemented, tested
 * and unreachable — the same "built one half, never connected" shape D181 and
 * D187 each found once.
 *
 * Every field is a durable fact re-read from authority at request time: the
 * `write_intents` row is the write-safety authority, and a cached copy of it is
 * exactly the value nobody may act on. `expectedVersion` on the served actions
 * is the RUN's version, which is what both resolutions CAS against.
 *
 * **There is no negative-settlement/`wait` block here, deliberately.** Ref write-safety
 * §4's `wait` decision is a scheduler answer that *changes no durable state* —
 * `createWriteRecovery` returns it and writes nothing, by design, so the run
 * stays unclaimable under its park. Nothing durable records that a probe ran,
 * how many qualifying observations it has, or when the next one is due, so a
 * `nextProbeAt` on this wire could only be re-derived from a policy the query
 * cannot reach or invented outright — the banned constant. When §4 recovery
 * gets a production caller that retains its probe verdicts, THAT is the commit
 * that earns this block; see the `pending-wire-bindings` note.
 */
export const ParkedWriteDetailWireSchema = z.strictObject({
  runId: RunIdSchema,
  writeIntentId: WriteIntentIdSchema,
  /** The exact intent generation a resolution must name to be accepted. */
  generation: z.number().int().positive(),
  /** The run attempt that fenced it — a later attempt is a different story. */
  runAttempt: z.number().int().positive(),
  system: BrowserSystemIdSchema,
  taskId: TaskIdSchema,
  /** The permanent key as a digest; the key itself never reaches a surface. */
  idempotencyKeyDigest: FingerprintSchema,
  fencedAt: IsoInstantSchema,
  parkedAt: IsoInstantSchema,
  parkedCode: ParkedWriteCodeSchema,
  /** A repository-authored digest projection; authority retains the original park evidence. */
  parkedMessage: z.string().min(1),
  subject: ParkedWriteSubjectWireSchema,
  /**
   * D245 — what a confirmed-PRESENT resolution has to carry, derived from the
   * commit contract this intent names. Before it, the present arm was drawn
   * disabled on every parked run in the build (`proof-contract-unserved`), so
   * a write that DID land could only be recorded as absent — a durable lie —
   * or left parked forever.
   */
  proofContract: ProofContractWireSchema,
  /**
   * Ref frontend-backend-integration §8.5: an interactive control exists only because the SERVER
   * described it. Both typed resolutions are always served for a parked run —
   * which one is right is a question only the operator's look at the target
   * system can answer, so hiding either would be this wire pre-deciding it.
   */
  actions: z.array(ActionDescriptorWireSchema).min(1),
}).superRefine((parked, context) => {
  if (Date.parse(parked.parkedAt) < Date.parse(parked.fencedAt)) {
    context.addIssue({
      code: "custom",
      path: ["parkedAt"],
      message: "a write cannot park before it was fenced",
    });
  }
  const targeted = parked.actions.filter((action) => action.kind === "command"
    && action.writeTarget !== undefined
    && action.writeTarget.writeIntentId === parked.writeIntentId
    && action.writeTarget.intentGeneration === parked.generation);
  if (targeted.length !== parked.actions.length) {
    context.addIssue({
      code: "custom",
      path: ["actions"],
      message: "every parked-write action must target this exact intent and generation",
    });
  }
});

/**
 * The identity-approval gate section (ref write-safety §14.4, separations §3's chunk-3
 * directive: "a command arm plus wire state ONLY").
 *
 * This is the whole server side of the approval UI a later slice will build.
 * Every fact a surface needs to render the decision and compose a legal
 * `resolve-gate` command is here, because the alternative — a client that knows
 * how to build a gate payload — would put the gate's contract in two places.
 *
 * **The packet is served WHOLE and unredacted, and that is deliberate.** Every
 * other person-bearing wire in this tree redacts (the parked-write subject
 * serves a digest and a bounded suffix). This one cannot: §14.4's acceptance
 * standard is that the operator decides *without leaving the dashboard*, and a
 * wrong-person control whose evidence is redacted is a control that cannot be
 * exercised. The names, EIDs, departments and titles ARE the decision.
 *
 * **`resultSchemaHash` is served rather than derived by the caller.** The kernel
 * refuses a `resolve-gate` payload whose `result.schemaHash` is not the
 * descriptor's exact gate schema hash; a client computing that hash would be a
 * second implementation of the descriptor's identity. The server states it.
 *
 * **`options` is the checkable half of `chosenFrom`.** Each entry pairs an EID
 * the packet actually showed with the label the post-gate node will verify, so a
 * surface cannot invent a label and cannot offer an EID the run never read.
 */
export const IdentityGateOptionWireSchema = z.strictObject({
  eid: z.string().regex(/^\d{8}$/),
  /** The label a `resolve-gate` payload must carry for this EID. */
  chosenFrom: z.enum(["checked", "name-search", "manual"]),
  /** The name UCPath displayed for this EID, when the packet carried one. */
  displayName: z.string().min(1),
  /** Why this EID is on the list, in the operator's terms. */
  origin: z.string().min(1),
});

export const IdentityGateDetailWireSchema = z.strictObject({
  runId: RunIdSchema,
  gateId: NodeIdSchema,
  label: z.string().min(1),
  parkedAt: IsoInstantSchema,
  /** The node the run resumes at once the gate resolves. */
  resumeAt: NodeIdSchema,
  /** The run version a `resolve-gate` command must CAS against. */
  expectedVersion: z.number().int().positive(),
  /** The descriptor's exact gate-result schema hash the kernel will require. */
  resultSchemaHash: FingerprintSchema,
  /** The digest an approval or rejection must carry (ref write-safety §14.5). */
  evidenceDigest: FingerprintSchema,
  packet: IdentityEvidencePacketSchema,
  options: z.array(IdentityGateOptionWireSchema).min(1),
  /**
   * §14.6 risk 1: the SERVER decides how much ceremony the decision costs, so a
   * surface cannot quietly turn a risky approval into one click.
   */
  approvalShape: z.enum(["one-click", "choose-a-candidate", "type-the-eid"]),
  /** Ref frontend-backend-integration §8.5: an interactive control exists only because the server said so. */
  actions: z.array(ActionDescriptorWireSchema).min(1),
}).superRefine((gate, context) => {
  const eids = gate.options.map(({ eid }) => eid);
  if (new Set(eids).size !== eids.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "gate options must be unique by EID" });
  }
  for (const [index, option] of gate.options.entries()) {
    if (!gate.packet.approvableEids.map(String).includes(option.eid)) {
      context.addIssue({
        code: "custom",
        path: ["options", index, "eid"],
        message: `option ${directIdentifierDigestReference(option.eid)} is not one the packet showed`,
      });
    }
  }
  const targeted = gate.actions.filter((action) => action.kind === "command"
    && action.command === "resolve-gate"
    && action.expectedVersion === gate.expectedVersion);
  if (targeted.length !== gate.actions.length) {
    context.addIssue({
      code: "custom",
      path: ["actions"],
      message: "every identity-gate action must be a resolve-gate at this exact run version",
    });
  }
});
export type IdentityGateDetailWire = z.infer<typeof IdentityGateDetailWireSchema>;

export const RunDetailSectionResponseSchema = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("logs"), payload: NotePageSchema }),
  z.strictObject({ section: z.literal("receipt"), payload: wireResourceSchema(ReceiptSectionSchema) }),
  z.strictObject({ section: z.literal("review"), payload: ReviewPageSchema }),
  z.strictObject({ section: z.literal("people"), payload: PeoplePageSchema }),
  z.strictObject({ section: z.literal("context-data"), payload: ContextDataSectionSchema }),
  z.strictObject({ section: z.literal("context-evidence"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("context-attempts"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("failure"), payload: wireResourceSchema(FailureDetailWireSchema) }),
  z.strictObject({ section: z.literal("captures"), payload: CaptureListSchema }),
  z.strictObject({ section: z.literal("parked-write"), payload: ParkedWriteDetailWireSchema }),
  z.strictObject({ section: z.literal("identity-gate"), payload: wireResourceSchema(IdentityGateDetailWireSchema) }),
]);

export type ParkedWriteDetailWire = z.infer<typeof ParkedWriteDetailWireSchema>;
export type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;
export type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
export type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
