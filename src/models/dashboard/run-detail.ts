import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { ParkedWriteCheckTargetSchema, ParkedWriteCheckResultSchema } from "../../rules/commands/commands.js";
import { FailureDisplaySchema } from "./failure-display.js";
import { DeclaredActionIdentitySchema } from "../workflow/operation-action-identity.js";
import { FailureResolutionCaptureSchema, FailureResolutionCapabilitySchema } from "../trust/failure-resolution.js";
import { PublicTransactionKeyDigestSchema } from "../write-safety/protected-input.js";
import { z } from "zod";
import { DataObservationOriginSchema } from "../events/data-observation-origin.js";
import { ConfirmedActionEventSchema } from "../events/confirmed-action.js";
import {
  ActorIdSchema,
  ArtifactIdSchema,
  BrowserSessionIdSchema,
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
  PositiveIntSchema,
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
} from "../../rules/identity/ids.js";
import { UnscopedCommitReasonIdSchema } from "../write-safety/unscoped-commit.js";
import { directIdentifierDisplay } from "../../rules/redaction/redaction.js";
import { IdentityEvidencePacketSchema } from "../../rules/separations/identity-evidence.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
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
import { RunOperationStructureWireSchema } from "./operation-structure.js";
import { NoteFieldWireSchema, ObservedDataPointWireSchema } from "../events/types.js";

export const RunIdentityWireSchema = z.strictObject({
  runId: RunIdSchema,
  traceId: TraceIdSchema,
  workflowId: WorkflowIdSchema,
  actorId: ActorIdSchema.optional(),
  title: z.string().min(1),
  status: QueueStatusSchema,
  attempt: z.number().int().positive(),
});

/** The closed `not-run` reasons a conditional node can record — the SAME vocabulary the durable result uses; the timeline never invents a third value. */
export const TimelineNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]);

/** How long ONE step took, or why that is not a number: the executor's own span measurement for the SAME `(attempt, spanPath)` identity, never a wall-clock reconstruction. */
export const TimelineDurationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), ms: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);
export type TimelineDuration = z.infer<typeof TimelineDurationSchema>;

/** Read a timeline event's duration FORWARD: `durationMs` is optional on the wire only so a record frozen into an archived run before the leaf existed still parses. */
export function timelineEventDuration(
  event: Readonly<{ durationMs?: TimelineDuration }>,
): TimelineDuration {
  return event.durationMs ?? {
    state: "absent",
    reason: "this record was frozen before per-step durations were served; no measurement was stored",
  };
}

export const NativeRunEventWireSchema = z.strictObject({
  eventId: z.uuid(),
  order: PositiveIntSchema,
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  traceId: TraceIdSchema,
  spanPath: z.string().min(1).optional(),
  nodeId: NodeIdSchema.optional(),
}).refine(identity => identity.spanPath !== undefined || identity.nodeId !== undefined, {
  message: "a native event must name its node or span",
});
export type NativeRunEventWire = z.infer<typeof NativeRunEventWireSchema>;

export const ConfirmedActionBindingWireSchema = z.strictObject({
  eventId: z.string().min(1),
  logId: NoteIdSchema,
  native: NativeRunEventWireSchema,
});
export type ConfirmedActionBindingWire = z.infer<typeof ConfirmedActionBindingWireSchema>;

export const TimelineEventWireSchema = z.strictObject({
  native: NativeRunEventWireSchema.optional(),
  categoryKey: TimelineCategoryKeySchema.optional(),
  noteId: NoteIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  label: z.string().min(1),
    /* `skipped` is its own arm and is NOT a flavour of `cancelled`: a node whose `when` was false was never started by anyone. */
  state: z.enum(["pending", "active", "done", "failed", "blocked", "cancelled", "skipped"]),
    /* WHY a `skipped` step did not run, carried through from the executor's span rather than re-derived; absence stays explicit, never borrowing a plausible reason. */
  notRun: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
    z.strictObject({ state: z.literal("present"), reason: TimelineNotRunReasonSchema }),
  ]),
    /* This step's OWN measured duration; optional on the wire only for read-forward, and read through the helper so a reasoned absence stays reasoned. */
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
/** `replayed` is its own arm, and it is NOT a flavour of `pending`: a replayed node emits NO spans by design, so the fold had nothing to measure. */
const TimelineStepStateSchema = z.enum(["pending", "active", "done", "failed", "blocked", "cancelled", "skipped", "replayed"]);

/** WHERE a replayed step's stored fact came from — the checkpoint row's own identity, never a derived one, with the claim generation absent for a row that names none. */
export const TimelineReplaySourceSchema = z.strictObject({
  attempt: z.number().int().positive(),
  claimGeneration: z.number().int().positive().optional(),
});

/** ONE member node's contribution to a categorical step, served so the step's hover detail can name what folded into it without the client re-deriving the graph. */
export const TimelineStepMemberWireSchema = z.strictObject({
  nodeId: NodeIdSchema.optional(),
  categoryKey: TimelineCategoryKeySchema.optional(),
  label: z.string().min(1),
  state: TimelineStepStateSchema,
  /** Sum of this node's measured execution durations; absent when none measured. */
  durationSec: z.number().int().nonnegative().optional(),
  /** Present exactly when this member replayed; see the refinement. */
  replayedFrom: TimelineReplaySourceSchema.optional(),
    /* WHY a `skipped` member did not run, read off its span's own closed reason and never re-derived; it is what lets the strip draw an operator-asserted member distinctly. */
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
    // Replay has no measured duration; zero would claim instantaneous execution.
    context.addIssue({
      code: "custom",
      path: ["durationSec"],
      message: "a replayed member has no measurement; a replay emits no span to measure",
    });
  }
});

/** The CATEGORICAL timeline step: one segment per descriptor-declared category (or per node for a workflow that declares nothing), never one per raw execution. */
export const TimelineStepWireSchema = z.strictObject({
  system: z.union([BrowserSystemIdSchema, z.literal("local")]).optional(),
  key: TimelineCategoryKeySchema.optional(),
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
    /* Categorical steps, optional on the wire ONLY so a record frozen before the field existed still parses; a live serve always carries it. */
  steps: z.array(TimelineStepWireSchema).optional(),
})
  .superRefine((timeline, context) => {
    const ids = timeline.events.map(({ noteId }) => noteId);
    const sequences = timeline.events.map(({ sequence }) => sequence);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline note ids must be unique" });
    if (new Set(sequences).size !== sequences.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline sequences must be unique" });
    // Derived display labels may repeat; declared category uniqueness is factory-owned.
  });

/** The `resolved` arm carries the APPROVER: `resolvedBy` is REQUIRED and safe to require, because the arm is newly reachable and no stored record predates the field. */
export const GateDecisionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("open"), gateId: NoteIdSchema, nodeId: NodeIdSchema.optional(), label: z.string().min(1), openedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
  z.strictObject({ state: z.literal("resolved"), gateId: NoteIdSchema, nodeId: NodeIdSchema.optional(), label: z.string().min(1), resolution: z.enum(["approved", "rejected"]), resolvedBy: ActorIdSchema, resolvedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
]);
/** A REHEARSAL's terminal outcome: `rehearsal` states that this run's terminal record is a dry-run PREVIEW, so nothing downstream reads it as a completed workflow. */
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

/** Every section a panel of this kind may ADVERTISE, derived from the same compatibility rule the wire refinement enforces. */
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
  /** Historical archives may omit captures; every live read emits them. */
  captures: RunCaptureAvailabilityWireSchema.optional(),
    /* The timeline steps this run OMITTED at start, by descriptor key; keys only — the operator's typed facts are the run's input and never cross this wire. */
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
    /* A run that read a step from an operator's form is not a verified completion, exactly as a rehearsal is not; structural, so no producer can serve the two together. */
  if (detail.omittedSteps !== undefined && detail.outcome.state === "terminal" && detail.outcome.result === "verified-done") {
    context.addIssue({
      code: "custom",
      path: ["outcome", "result"],
      message: "a run with an omitted step cannot be verified-done; nothing verified the values typed in its place",
    });
  }
});

export const NoteWireSchema = z.strictObject({
  native: NativeRunEventWireSchema.optional(),
  noteId: NoteIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  level: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  fields: z.array(NoteFieldWireSchema).optional(),
  operatorAction: z.strictObject({
    kind: z.enum(["click", "fill", "read", "action", "screenshot"]),
    value: z.string().optional(),
    label: z.string().min(1),
    system: BrowserSystemIdSchema.optional(),
    state: z.enum(["started", "completed", "failed", "not-run", "confirmed"]).optional(),
    reason: z.enum(["condition-false", "dry-run", "cancelled", "callback-failed"]).optional(),
  }).optional(),
  screenshot: z.strictObject({ bundleId: DiagnosticBundleIdSchema, artifactId: ArtifactIdSchema, sessionId: BrowserSessionIdSchema }).optional(),
});

/** Notes and spans share one sequenced log; notes retain their own wire arm. */
const LogRowBase = {
  native: NativeRunEventWireSchema.optional(),
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

export const ObservedLogRowWireSchema = z.strictObject({
  kind: z.literal("observed"),
  ...LogRowBase,
  at: IsoInstantSchema,
  ...LogSpanIdentityWireSchema.shape,
  producer: LogProducerWireSchema,
  points: z.array(ObservedDataPointWireSchema).min(1),
  displayFields: z.array(z.strictObject({ direction: z.enum(["read", "write"]), label: z.string().min(1), value: z.string().min(1),
    causal: z.strictObject({ declaration: z.string().min(1), origin: DataObservationOriginSchema }).optional() })).optional(),
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
  ObservedLogRowWireSchema,
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
  confirmedActions: z.array(ConfirmedActionEventSchema).optional(),
  confirmedActionBindings: z.array(ConfirmedActionBindingWireSchema).optional(),
  /** Live Logs always send this; older frozen archive pages predate it. */
  operationStructure: RunOperationStructureWireSchema.optional(),
    /* The one combined page; optional only so a frozen archive written before observed-log rows existed remains readable, and `notes` stays as an exact compatibility mirror. */
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
        && (note.native === undefined ? mirrored.native === undefined : mirrored.native !== undefined
          && canonicalJsonStringify(note.native) === canonicalJsonStringify(mirrored.native))
        && note.message === mirrored.message
        && canonicalJsonStringify(note.operatorAction ?? null) === canonicalJsonStringify(mirrored.operatorAction ?? null);
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

const ContextDataCoordinateSchema = z.strictObject({ nodeId: NodeIdSchema, fieldPath: ContractFieldPathSchema });
const ContextDataCheckpointSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    runId: RunIdSchema,
    attempt: PositiveIntSchema,
    claimGeneration: PositiveIntSchema.optional(),
    descriptorVersion: PositiveIntSchema,
    contractFingerprint: FingerprintSchema,
    schemaHash: FingerprintSchema,
    writtenAt: IsoInstantSchema,
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.enum(["no-checkpoint-for-run", "field-not-recorded"]) }),
  z.strictObject({
    state: z.literal("malformed"),
    reason: z.enum(["checkpoint-identity-mismatch", "descriptor-mismatch", "output-schema-mismatch"]),
  }),
]);

/** WHERE a ledger value came from: the step that recorded it, whether it READ or WROTE it, and the system against it; every leaf is DECLARED, not sniffed. */
const ContextDataOriginSchema = z.strictObject({
  nodeId: NodeIdSchema,
  /** The node's display label — what the timeline calls the same step. */
  step: z.string().min(1),
  dir: z.enum(["read", "write"]),
  system: BrowserSystemIdSchema.optional(),
});

/** The REUSE bound this value is recorded under — `maxAge` and `override` from the producing read contract's own policy, resolved at this entry's exact field path. */
const ContextDataFreshnessSchema = z.strictObject({
  maxAge: z.union([z.number().int().nonnegative(), z.literal("unbounded")]),
  override: z.enum(["forbidden", "audited"]),
  feeds: z.array(z.strictObject({ nodeId: NodeIdSchema, label: z.string().min(1) })),
});

export const ContextDataSectionSchema = z.strictObject({
  runId: RunIdSchema,
  state: z.enum(["available", "archived", "deleted", "unavailable"]),
  reason: z.enum(["descriptor-unavailable", "descriptor-mismatch", "checkpoint-reader-unavailable"]).optional(),
  entries: z.array(z.strictObject({
    label: z.string().min(1),
    valueRedacted: z.string().min(1),
    coordinate: ContextDataCoordinateSchema,
    checkpoint: ContextDataCheckpointSchema,
    valueState: z.enum(["present", "absent", "redacted", "malformed"]),
    observedAt: IsoInstantSchema.optional(),
    source: z.enum(["live", "derived", "operator"]).optional(),
    correctedAt: IsoInstantSchema.optional(),
    assertedStep: TimelineCategoryKeySchema.optional(),
    origin: ContextDataOriginSchema.optional(),
    freshness: ContextDataFreshnessSchema.optional(),
  })),
  /** The run's recorded read/write facts, including fields without a checkpoint or edit declaration. */
  observations: z.array(ObservedLogRowWireSchema).optional(),
}).superRefine((payload, context) => {
  if ((payload.state === "deleted" || payload.state === "unavailable") && payload.entries.length > 0) {
    context.addIssue({ code: "custom", path: ["entries"], message: "deleted or unavailable context data cannot claim checkpoint values" });
  }
  if (payload.state === "deleted" && payload.observations !== undefined && payload.observations.length > 0) {
    context.addIssue({ code: "custom", path: ["observations"], message: "deleted context data cannot claim retained observations" });
  }
  if (payload.state === "unavailable" && payload.reason === undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "unavailable context data names why it cannot be read" });
  }
  if (payload.state !== "unavailable" && payload.reason !== undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "only unavailable context data carries a reason" });
  }
  payload.entries.forEach((entry, index) => {
    if (entry.checkpoint.state === "malformed" && entry.valueState !== "malformed") {
      context.addIssue({ code: "custom", path: ["entries", index, "valueState"], message: "malformed checkpoint values stay unprojected" });
    }
    if (entry.checkpoint.state === "absent" && entry.valueState !== "absent") {
      context.addIssue({ code: "custom", path: ["entries", index, "valueState"], message: "a missing checkpoint cannot provide a value" });
    }
    if (entry.checkpoint.state === "present" && entry.checkpoint.runId !== payload.runId) {
      context.addIssue({ code: "custom", path: ["entries", index, "checkpoint", "runId"], message: "checkpoint belongs to another source run" });
    }
    if (entry.assertedStep !== undefined && (entry.source === "live" || entry.source === "derived")) {
      context.addIssue({
        code: "custom",
        path: [index, "assertedStep"],
        message: `an asserted value is operator-sourced; a ${entry.source} leaf never names an omitted step`,
      });
    }
    if (entry.source === "operator" && entry.correctedAt === undefined && entry.assertedStep === undefined) {
      context.addIssue({
        code: "custom",
        path: [index, "assertedStep"],
        message: "an operator-sourced value is either a correction or an assertion; without `correctedAt` it must name the omitted step it was asserted for",
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
});
export type ContextDataSectionWire = z.infer<typeof ContextDataSectionSchema>;

/** The receipt section serves the WHOLE receipt rather than a pointer: redaction is at capture time, so every value already carries its own classification and transform. */
const ReceiptSectionSchema = RunEvidenceReceiptSchema;

/** The failure section serves CONTENT, not a pointer; every field below is one the schema itself made display-safe. */
export const FailureDetailWireSchema = z.strictObject({
  native: NativeRunEventWireSchema.optional(),
  rerunInput: z.strictObject({ field: z.literal("documentNumber"), expectedVersion: PositiveIntSchema }).optional(),
  display: FailureDisplaySchema.optional(),
  resolution: z.strictObject({capability:FailureResolutionCapabilitySchema,capture:FailureResolutionCaptureSchema}).optional(),
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
    /* The write-state sentence renders UNCONDITIONALLY in the stream — what this run left behind is the difference between a safe retry and a duplicate termination. */
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
  if (failure.rerunInput !== undefined && (failure.workflowId !== "separations" || failure.code !== "DOCUMENT_UNAVAILABLE"
    || failure.taskId !== "kuali/read-separation-document" || failure.nodeId === undefined || failure.writeState !== "not-attempted")) {
    context.addIssue({ code: "custom", path: ["rerunInput"], message: "document correction requires an exact read failure before any write" });
  }
  if (failure.sameFingerprintSeen < 1) {
    context.addIssue({
      code: "custom",
      path: ["sameFingerprintSeen"],
      message: "the failure being projected is itself one occurrence; the count cannot be zero",
    });
  }
});

/** Provenance is a closed membership, not failure detail or actor data. */
export const RunCaptureOriginWireSchema = z.strictObject({
  operation: DeclaredActionIdentitySchema.optional(),
  browserCapture: z.strictObject({ nodeId: NodeIdSchema, attempt: PositiveIntSchema, sessionId: BrowserSessionIdSchema }).optional(),
  capturedAt: IsoInstantSchema.optional(),
  bundleId: DiagnosticBundleIdSchema,
  originKind: z.enum(["failure", "unexpected-state", "subject-mismatch", "recovery-park", "operator-request"]),
}).superRefine((origin, context) => {
  if ((origin.operation === undefined && origin.browserCapture === undefined) !== (origin.capturedAt === undefined)) context.addIssue({ code: "custom", message: "an exact capture anchor requires its capture instant" });
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

/** The park codes and subject-binding evidence, RE-DECLARED here rather than imported, and pinned to the durable originals by the wire-connectivity test. */
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

/** WHO the fenced write was bound to, in the only form a surface may see it; a binding proof carries both the expected and the observed subject evidence. */
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

/* ── the completion proof contract (ref write-safety ) ───────────────────── */

/** One leaf of the proof a confirmed-present resolution carries, addressed by the dot path it occupies; the server derives these from the commit contract's own schema. */
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
      /* The leaf carries a `.refine()`, which no wire can transport; the kernel's parse is the authority, not the surface's own green tick. */
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

/** WHAT A CONFIRMED-PRESENT RESOLUTION MUST CARRY: the resolution refuses any proof whose `schemaHash` is not the commit contract's own, and parses the value through that exact schema. */
export const ProofContractWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("served"),
    /** The commit contract the proof belongs to, for the operator's record. */
    commitTaskId: TaskIdSchema,
      /* How this write WOULD have proved itself unattended; context the operator needs, because `save-verify` means a reload read-back is the only landing proof. */
    completionKind: z.enum(["receipt", "save-verify", "upload-verify"]),
    /** The exact value the resolution's `proof.schemaHash` must equal. */
    schemaHash: FingerprintSchema,
    fields: z.array(ProofFieldWireSchema).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type ProofContractWire = z.infer<typeof ProofContractWireSchema>;

/** The parked-write section: a `parked-write` run is the one lifecycle whose ordinary controls are REFUSED BY NAME, because a fenced write may already exist in a real HR system. */
export const ParkedWriteDetailWireSchema = z.strictObject({
  check: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), target: ParkedWriteCheckTargetSchema }),
    z.strictObject({ state: z.literal("unavailable"), code: z.literal("PARKED_CHECK_UNAVAILABLE") }),
  ]).optional(),
  lastCheck: ParkedWriteCheckResultSchema.optional(),
  native: NativeRunEventWireSchema.optional(),
  runId: RunIdSchema,
  writeIntentId: WriteIntentIdSchema,
  /** The exact intent generation a resolution must name to be accepted. */
  generation: z.number().int().positive(),
  /** The run attempt that fenced it — a later attempt is a different story. */
  runAttempt: z.number().int().positive(),
  system: BrowserSystemIdSchema,
  taskId: TaskIdSchema,
  /** The permanent key as a digest; the key itself never reaches a surface. */
  idempotencyKeyDigest: PublicTransactionKeyDigestSchema,
  fencedAt: IsoInstantSchema,
  parkedAt: IsoInstantSchema,
  parkedCode: ParkedWriteCodeSchema,
  /** A repository-authored digest projection; authority retains the original park evidence. */
  parkedMessage: z.string().min(1),
  subject: ParkedWriteSubjectWireSchema,
    /* What a confirmed-PRESENT resolution has to carry, derived from the commit contract this intent names; before it, a write that DID land could only be recorded as absent. */
  proofContract: ProofContractWireSchema,
    /* An interactive control exists only because the SERVER described it; both typed resolutions are always served for a parked run, because hiding either would pre-decide the operator's question. */
  actions: z.array(ActionDescriptorWireSchema).min(1),
}).superRefine((parked, context) => {
  for (const target of [parked.check?.state === "available" ? parked.check.target : undefined, parked.lastCheck?.target]) {
    if (target !== undefined && (target.runId !== parked.runId || target.writeIntentId !== parked.writeIntentId
      || target.intentGeneration !== parked.generation || target.runAttempt !== parked.runAttempt
      || parked.native === undefined || target.traceId !== parked.native.traceId || target.nodeId !== parked.native.nodeId
      || target.runAttempt !== parked.native.attempt)) {
      context.addIssue({ code: "custom", message: "a parked check must name this exact retained write and native occurrence" });
    }
  }
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

/** The identity-approval gate section: the whole server side of the approval UI — a command arm plus wire state ONLY. */
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
  native: NativeRunEventWireSchema.optional(),
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
  /** The digest an approval or rejection must carry (ref write-safety ). */
  evidenceDigest: FingerprintSchema,
  packet: IdentityEvidencePacketSchema,
  options: z.array(IdentityGateOptionWireSchema).min(1),
    /* The SERVER decides how much ceremony the decision costs, so a surface cannot quietly turn a risky approval into one click. */
  approvalShape: z.enum(["one-click", "choose-a-candidate"]),
  /** Ref frontend-backend-integration: an interactive control exists only because the server said so. */
  actions: z.array(ActionDescriptorWireSchema).min(1),
}).superRefine((gate, context) => {
  if (gate.approvalShape !== (gate.options.length > 1 ? "choose-a-candidate" : "one-click")) {
    context.addIssue({ code: "custom", path: ["approvalShape"], message: "presentation must match the shown candidate count" });
  }
  const eids = gate.options.map(({ eid }) => eid);
  if (new Set(eids).size !== eids.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "gate options must be unique by EID" });
  }
  for (const [index, option] of gate.options.entries()) {
    if (!gate.packet.approvableEids.map(String).includes(option.eid)) {
      context.addIssue({
        code: "custom",
        path: ["options", index, "eid"],
        message: `option ${directIdentifierDisplay(option.eid)} is not one the packet showed`,
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
