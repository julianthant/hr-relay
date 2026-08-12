import { z } from "zod";
import {
  ActorIdSchema,
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
import {
  SubjectEvidenceSchema,
  WriteIntentParkCodeSchema,
} from "../write-safety-primitives.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { RunEvidenceReceiptSchema } from "../trust/evidence.js";
import {
  FailureCauseSchema,
  RemediationActionSchema,
  SubjectEvidenceWireSchema,
  WriteStateSchema,
} from "../trust/failure.js";
import { ActionDescriptorWireSchema } from "./actions.js";
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
 * A correctable value is a SCALAR leaf: the rail edits it as text and the
 * kernel re-parses the whole post-patch output, so a structured value has no
 * honest single-field edit affordance and stays locked with that reason.
 */
const EditableScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Doc 06 §6 / doc 03 D19 (2i-C): the Data section carries, per entry, exactly
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

const ContextDataSectionSchema = z.strictObject({
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
  })),
});
export type ContextDataSectionWire = z.infer<typeof ContextDataSectionSchema>;

/**
 * The receipt section serves the WHOLE `RunEvidenceReceipt` (D140), not a
 * pointer to it. Doc 12 §2.2 puts redaction at capture time — "Redaction is
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

/**
 * WHO the fenced write was bound to, in the only form a surface may see it.
 *
 * A `subject-match` binding proof carries `expected` AND `observed` subject
 * evidence, and its own `superRefine` already refuses any proof whose two
 * halves differ — so projecting ONE value is not a shortcut, it is the whole
 * fact: the proof exists precisely because the two agreed.
 *
 * The evidence is served as the DURABLE `SubjectEvidenceSchema`, not a second
 * projection of it. That schema is display-safe by construction — a binding
 * digest plus a bounded suffix, a branded artifact id, or a closed catalog key
 * — so re-shaping it into `{ digest, displayRedacted }` would claim a redaction
 * this projection did not perform and would drop the digest that makes the
 * value checkable against the failure panel's copy.
 *
 * The `unscoped` arm is doc 09's reviewed no-subject commit. It has no subject
 * to redact and must not pretend to one: it names the reviewed reason id from
 * the closed registry, which is repository-authored text by construction.
 */
export const ParkedWriteSubjectWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("subject-match"),
    proofId: WriteBindingProofIdSchema,
    observedAt: IsoInstantSchema,
    /** `expected` and `observed`, which the proof schema pins as identical. */
    evidence: SubjectEvidenceSchema,
  }),
  z.strictObject({
    state: z.literal("unscoped"),
    proofId: WriteBindingProofIdSchema,
    observedAt: IsoInstantSchema,
    reviewedReasonId: UnscopedCommitReasonIdSchema,
  }),
]);

/**
 * The parked-write section (doc 09 §4.1, doc 13 §3.3/§8.5).
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
 * **There is no negative-settlement/`wait` block here, deliberately.** Doc 09
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
  parkedCode: WriteIntentParkCodeSchema,
  /**
   * The park message as the kernel composed it. It is `external-text`, not
   * repository-authored: doc 09 §4's `park()` interpolates a thrown driver
   * error and a probe's own `reason` into it, and neither is authored here.
   */
  parkedMessage: z.string().min(1),
  subject: ParkedWriteSubjectWireSchema,
  /**
   * Doc 13 §8.5: an interactive control exists only because the SERVER
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
]);

export type ParkedWriteDetailWire = z.infer<typeof ParkedWriteDetailWireSchema>;
export type FailureDetailWire = z.infer<typeof FailureDetailWireSchema>;
export type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
export type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;
