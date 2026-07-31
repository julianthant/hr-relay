import { z } from "zod";
import {
  ActorIdSchema,
  EvidenceReceiptIdSchema,
  EvidenceRefSchema,
  FailureIdSchema,
  IsoInstantSchema,
  NoteIdSchema,
  ProjectionCursorSchema,
  ReviewRecordIdSchema,
  RunIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
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

export const TimelineEventWireSchema = z.strictObject({
  noteId: NoteIdSchema,
  sequence: z.number().int().nonnegative(),
  at: IsoInstantSchema,
  label: z.string().min(1),
  state: z.enum(["pending", "active", "done", "failed", "blocked", "cancelled"]),
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
const ReceiptPointerSchema = z.strictObject({ runId: RunIdSchema, receiptId: EvidenceReceiptIdSchema });
const FailurePointerSchema = z.strictObject({ runId: RunIdSchema, failureId: FailureIdSchema });
const CaptureListSchema = z.strictObject({ runId: RunIdSchema, artifacts: z.array(ArtifactResourceWireSchema) });

export const RunDetailSectionResponseSchema = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("logs"), payload: NotePageSchema }),
  z.strictObject({ section: z.literal("receipt"), payload: wireResourceSchema(ReceiptPointerSchema) }),
  z.strictObject({ section: z.literal("review"), payload: ReviewPageSchema }),
  z.strictObject({ section: z.literal("people"), payload: PeoplePageSchema }),
  z.strictObject({ section: z.literal("context-data"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("context-evidence"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("context-attempts"), payload: ContextSectionSchema }),
  z.strictObject({ section: z.literal("failure"), payload: wireResourceSchema(FailurePointerSchema) }),
  z.strictObject({ section: z.literal("captures"), payload: CaptureListSchema }),
]);

export type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
export type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
