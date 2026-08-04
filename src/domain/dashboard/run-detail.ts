import { z } from "zod";
import {
  ActorIdSchema,
  DiagnosticBundleIdSchema,
  ElementIdSchema,
  ErrorCodeSchema,
  EvidenceRefSchema,
  FailureFingerprintSchema,
  FailureIdSchema,
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
} from "../ids.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";
import {
  FailureCauseSchema,
  RemediationActionSchema,
  SubjectEvidenceWireSchema,
  WriteStateSchema,
} from "../trust/failure.js";
import { ArtifactResourceWireSchema } from "./artifacts.js";
import {
  PanelKindSchema,
  RecordRevisionSchema,
  RowRevisionSchema,
  RunDetailSectionSchema,
  wireResourceSchema,
} from "./primitives.js";
import { QueueStatusSchema } from "./projection.js";

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
 * The closed `not-run` reasons a conditional node can record (doc 02 §5.5,
 * mirrored by `RunResultRecord`'s `not-run` arm). This is the SAME vocabulary
 * the durable result uses; the timeline never invents a third value.
 */
export const TimelineNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected"]);

export const TimelineEventWireSchema = z.strictObject({
  noteId: NoteIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  label: z.string().min(1),
  /**
   * `skipped` is its own arm and is NOT a flavour of `cancelled` (doc 03 §9
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
}).superRefine((event, context) => {
  if (event.state !== "skipped" && event.notRun.state === "present") {
    context.addIssue({
      code: "custom",
      path: ["notRun"],
      message: `a ${event.state} timeline event cannot carry a not-run reason`,
    });
  }
});
export const TimelineWireSchema = z.strictObject({ events: z.array(TimelineEventWireSchema) })
  .superRefine((timeline, context) => {
    const ids = timeline.events.map(({ noteId }) => noteId);
    const sequences = timeline.events.map(({ sequence }) => sequence);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline note ids must be unique" });
    if (new Set(sequences).size !== sequences.length) context.addIssue({ code: "custom", path: ["events"], message: "timeline sequences must be unique" });
  });

export const GateDecisionWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("open"), gateId: NoteIdSchema, label: z.string().min(1), openedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
  z.strictObject({ state: z.literal("resolved"), gateId: NoteIdSchema, label: z.string().min(1), resolution: z.enum(["approved", "rejected"]), resolvedAt: IsoInstantSchema, revision: RecordRevisionSchema }),
]);
export const OutcomeWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  z.strictObject({ state: z.literal("terminal"), result: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]), completedAt: IsoInstantSchema }),
]);
export const ContextSummaryWireSchema = z.strictObject({
  dataFacts: z.number().int().nonnegative(),
  evidenceFacts: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
});

function sectionsCompatible(panelKind: z.infer<typeof PanelKindSchema>, sections: readonly z.infer<typeof RunDetailSectionSchema>[]): boolean {
  if (panelKind === "run" || panelKind === "member") return !sections.includes("review") && !sections.includes("people");
  if (panelKind === "review") return !sections.includes("people");
  return !sections.includes("review");
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
});

export const NoteWireSchema = z.strictObject({
  noteId: NoteIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  level: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
});
export const NotePageSchema = z.strictObject({
  runId: RunIdSchema,
  notes: z.array(NoteWireSchema),
  nextCursor: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: ProjectionCursorSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.literal("end-of-page") }),
  ]),
}).superRefine((page, context) => {
  if (page.notes.some(({ runId }) => runId !== page.runId)) context.addIssue({ code: "custom", path: ["notes"], message: "note run identities must match page" });
  const ids = page.notes.map(({ noteId }) => noteId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["notes"], message: "note ids must be unique" });
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
 * The receipt section serves the WHOLE `RunEvidenceReceipt` (D136), not a
 * pointer to it. Doc 12 §2.2 puts redaction at capture time — "Redaction is
 * not deferred to the UI" — and the receipt's every value is already a
 * `RedactedField` carrying its own classification and transform, so there is
 * nothing left for a wire projection to strip and nothing a second projection
 * could do except lose the classification that makes the value readable.
 */
const ReceiptSectionSchema = RunEvidenceReceiptSchema;

/**
 * The failure section serves CONTENT, not `{ runId, failureId }` (D138).
 *
 * Every field below is one the schema itself made display-safe: subject
 * identity travels as a digest plus an already-redacted display suffix, the
 * page as `urlRedacted`/`titleRedacted`, the input as a fingerprint. The
 * projection copies exactly those and NOTHING else off the `FailureRecord` —
 * an unclassified field is dropped by omission from this strict schema rather
 * than passed through, which is the doc-11 rule applied structurally instead
 * of by a filter someone has to remember to update.
 *
 * `sameFingerprintSeen` is doc 12 §2.1's "same failure seen before" as a
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
   * Doc 03 D18's write-state sentence renders UNCONDITIONALLY in the stream —
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

const CaptureListSchema = z.strictObject({ runId: RunIdSchema, artifacts: z.array(ArtifactResourceWireSchema) });

export const RunDetailSectionResponseSchema = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("logs"), payload: NotePageSchema }),
  z.strictObject({ section: z.literal("receipt"), payload: wireResourceSchema(ReceiptSectionSchema) }),
  z.strictObject({ section: z.literal("review"), payload: ReviewPageSchema }),
  z.strictObject({ section: z.literal("people"), payload: PeoplePageSchema }),
  z.strictObject({ section: z.literal("context-data"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("context-evidence"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("context-attempts"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("failure"), payload: wireResourceSchema(FailureDetailWireSchema) }),
  z.strictObject({ section: z.literal("captures"), payload: CaptureListSchema }),
]);

export type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;
export type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
export type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
