import { OperationChildResultReferenceSchema } from "../workflow/operation-action-identity.js";
import { SnapshotWorkflowValueReferenceSchema } from "../workflow/operation-display-snapshot.js";
import { OperationInputLineageSchema, OperationChildResultIdentitySchema } from "../workflow/operation-action-identity.js";
/** The span/notes wire and at-rest contract: a zod-only leaf module whose id patterns are restated locally and pinned byte-for-byte by the parity test. */
import { z } from "zod";
import { DataObservationOriginsSchema } from "./data-observation-origin.js";
import { ConfirmedActionEventSchema } from "./confirmed-action.js";
import { DiagnosticSafetyVersionSchema } from "../trust/failure.js";
import { DataClassificationSchema, refineLocalEvidenceTransformPair } from "../../rules/redaction/redaction-policy.js";
import { RunRecoveryModeSchema } from "../run/envelope.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const TRACE_PATTERN = /^[a-z0-9]{2,4}-(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]-[0-9a-f]{4}$/;
/** `TaskIdSchema`'s grammar, restated (this leaf imports nothing but zod). */
const TASK_ID_PATTERN =
  /^(?:(?:ucpath|crm|onbase|kuali|servicenow|i9|new-kronos|old-kronos|sharepoint|extraction|normalization|ocr|roster)|workflow:[a-z0-9]+(?:-[a-z0-9]+)*)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `ContractFieldPathSchema`'s grammar, restated. */
const FIELD_PATH_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

const UuidSchema = z.string().regex(UUID_PATTERN, "must be a UUID");
const SlugSchema = z.string().regex(SLUG_PATTERN, "must be kebab-case");
const Hex64Schema = z.string().regex(HEX64_PATTERN, "must be SHA-256 hex");
const IsoInstantSchema = z.iso.datetime({ offset: true });
const PositiveIntSchema = z.number().int().positive();
const NonnegativeIntSchema = z.number().int().nonnegative();
const SpanPathSchema = z.string().min(1);
export const SpanTaskIdSchema = z.string().regex(TASK_ID_PATTERN, "must be <registered-store>/<kebab-case-operation>");
export const SpanFieldPathSchema = z.string().regex(FIELD_PATH_PATTERN, "must be a dot-delimited camelCase object path");

/** `JsonValueSchema`, restated: the wire leaf must not drag the server module graph behind it. */
const JsonValueWireSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueWireSchema),
  z.record(z.string(), JsonValueWireSchema),
]));

/** The closed browser-system vocabulary; pinned against `src/domain/ids.ts`. */
export const SpanBrowserSystemSchema = z.enum([
  "ucpath", "crm", "onbase", "kuali", "servicenow", "i9", "new-kronos", "old-kronos", "sharepoint",
]);
export const SpanSystemInstanceSchema = z.enum(["prod", "test"]);

/** Ref dashboard-surfaces's outcome union; `skipped` is a task-span outcome. */
export const SpanOutcomeWireSchema = z.enum([
  "done", "failed", "cancelled", "discarded", "skipped", "interrupted", "superseded",
]);
export type SpanOutcomeWire = z.infer<typeof SpanOutcomeWireSchema>;

/** Why a `skipped` task span did not run; pinned against `TerminalNotRunReasonSchema` so surface and record name a skip with the same word. */
export const SpanNotRunReasonSchema = z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]);

/** Why a queued row re-queued; pinned against `RequeueCauseSchema`. */
export const SpanRequeueCauseSchema = z.enum(["reassign", "bump", "recovery", "provider-capacity"]);

const BaseFields = {
  ts: IsoInstantSchema,
  workflow: SlugSchema,
  pid: PositiveIntSchema,
} as const;

/** Run/task span identity — `(runId, attempt, spanPath)`. */
const RunSpanIdentityFields = {
  runId: UuidSchema,
  attempt: PositiveIntSchema,
  traceId: z.string().regex(TRACE_PATTERN, "trace id must be <code>-<HHMMSS>-<runId4>"),
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

/** Worker/browser span identity — `(workerId, spanPath)`; never a run id. */
const WorkerSpanIdentityFields = {
  workerId: SlugSchema,
  spanPath: SpanPathSchema,
  parentSpanPath: SpanPathSchema.optional(),
} as const;

/** The run's immutable identity attributes, stamped at enqueue and never re-derived by a projector. */
const AuthorityReconstructionRepairSchema = z.strictObject({
  kind: z.literal("authority-reconstruction"),
  repairedAt: IsoInstantSchema,
  sourceAuthorityGeneration: NonnegativeIntSchema,
  sourceAuthorityFingerprint: Hex64Schema,
  priorStreamBytes: NonnegativeIntSchema,
  priorStreamSha256: Hex64Schema,
});

const RunQueuedSchema = z.strictObject({
  t: z.literal("run.queued"),
  kind: z.literal("run"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  itemId: UuidSchema,
  /** SCOPE axis — delegated iff present. */
  parentRunId: UuidSchema.optional(),
  /** SHAPE axis, stamped ONCE. */
  shape: z.enum(["single", "preview", "operation", "operation-member"]),
  priority: z.enum(["interactive", "bulk"]),
  dryRun: z.boolean(),
    /** The step keys this run omits; the typed facts stay in run authority, never in a span. */
  omittedSteps: z.array(SlugSchema).min(1).optional(),
  retryOf: UuidSchema.optional(),
    /** Present only on a Restart-from-start attempt; a Resume carries `retryOf` alone. */
  recovery: RunRecoveryModeSchema.optional(),
  actorId: SlugSchema,
    /** The exact title/subtitle the confirmation surface showed. */
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: Hex64Schema,
  resolvedInstance: z.partialRecord(SpanBrowserSystemSchema, SpanSystemInstanceSchema),
  configFingerprint: Hex64Schema,
  configSnapshotId: UuidSchema,
  repair: z.discriminatedUnion("kind", [AuthorityReconstructionRepairSchema, z.strictObject({
    kind: z.literal("timeline-authority-reconstruction"),
    repairedAt: IsoInstantSchema,
    sourceAuthorityGeneration: NonnegativeIntSchema,
    sourceAuthorityFingerprint: Hex64Schema,
    priorCursor: NonnegativeIntSchema,
  })]).optional(),
});

const RunClaimedSchema = z.strictObject({
  t: z.literal("run.claimed"),
  claimGeneration: z.number().int().positive().optional(),
  ...BaseFields,
  ...RunSpanIdentityFields,
  workerId: SlugSchema,
});

const RunRequeuedSchema = z.strictObject({
  t: z.literal("run.requeued"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  cause: SpanRequeueCauseSchema,
  nextAttempt: PositiveIntSchema,
});

const TaskSpanStartedSchema = z.strictObject({
  t: z.literal("span.started"),
  kind: z.literal("task"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  name: z.string().min(1),
  system: SpanBrowserSystemSchema.optional(),
});

const WorkerSpanStartedSchema = z.strictObject({
  t: z.literal("span.started"),
  kind: z.enum(["worker", "browser"]),
  ...BaseFields,
  ...WorkerSpanIdentityFields,
  name: z.string().min(1),
  system: SpanBrowserSystemSchema.optional(),
});

const GateOpenedSchema = z.strictObject({
  t: z.literal("gate.opened"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  gate: SlugSchema,
});

/** A dry run's transaction node; its parity twin in the span emitter carries why it is not a `span.ended`. */
const TransactionPreviewedSchema = z.strictObject({
  t: z.literal("transaction.previewed"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  node: SlugSchema,
    /* `not-observed` is the fourth verdict: the probe settled the node before anything was staged, so no page was prepared and no subject was read. */
  subject: z.enum(["match", "mismatch", "unscoped", "not-observed"]),
  externalCommit: z.literal("none"),
});

/** The strict wire twin of the kernel-only durable-fence beat. */
const TransactionFencedSchema = z.strictObject({
  t: z.literal("transaction.fenced"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  node: SlugSchema,
  taskId: SpanTaskIdSchema,
});

/** An observed data point's redacted value; the parity twin of the kernel's `RedactedFieldSchema`, restated arm-for-arm under one classification rule. */
export const SpanDataClassificationSchema = DataClassificationSchema;
const RedactedSpanValueSchema = z.discriminatedUnion("transform", [
  z.strictObject({
    key: z.string(),
    state: z.literal("redacted"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("drop"),
    rawValue: JsonValueWireSchema.optional(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("last4"),
    value: z.string().max(4, "must contain at most four characters"),
    rawValue: JsonValueWireSchema.optional(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("digest"),
    value: Hex64Schema,
    rawValue: JsonValueWireSchema.optional(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("basename"),
    value: z.string(),
    rawValue: JsonValueWireSchema.optional(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("count"),
    value: z.number().int().nonnegative(),
    rawValue: JsonValueWireSchema.optional(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("allowed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("allow"),
    value: JsonValueWireSchema,
    rawValue: JsonValueWireSchema.optional(),
  }),
]).superRefine(refineLocalEvidenceTransformPair);

/** One recorded point; see `src/backend/logs/span-emitter.ts` for why it carries no `system`. */
export const ObservedDataPointWireSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: SpanFieldPathSchema,
  values: z.array(RedactedSpanValueSchema).min(1),
  origins: DataObservationOriginsSchema.optional(),
});
export type ObservedDataPointWire = z.infer<typeof ObservedDataPointWireSchema>;

/** The observed-log emission; its parity twin in the span emitter carries the reasoning. */
const DataObservedSchema = z.strictObject({
  t: z.literal("data.observed"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  nodeId: SlugSchema,
  taskId: SpanTaskIdSchema,
  observedAt: IsoInstantSchema,
  points: z.array(ObservedDataPointWireSchema).min(1),
});

const GateResolvedSchema = z.strictObject({
  t: z.literal("gate.resolved"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  gate: SlugSchema,
  /** Descriptor-validated display/audit key, never the gate's decision payload. */
  resolutionKey: SlugSchema,
    /** The schema-parsed result lives in authority; this is its digest. */
  resultHash: Hex64Schema,
});

const TaskSpanEndedSchema = z.strictObject({
  t: z.literal("span.ended"),
  kind: z.literal("task"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  outcome: SpanOutcomeWireSchema,
  failureId: UuidSchema.optional(),
  /** Display-safe summary; never the only failure evidence. */
  errorSummary: z.string().min(1).optional(),
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
    /* Present only on `skipped`, and only when the executor recorded a reason; absence means no reason was recorded. */
  notRunReason: SpanNotRunReasonSchema.optional(),
}).superRefine((event, context) => {
  if (event.outcome !== "skipped" && event.notRunReason !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["notRunReason"],
      message: `a ${event.outcome} task span cannot carry a not-run reason`,
    });
  }
});

const RunSpanEndedSchema = z.strictObject({
  t: z.literal("span.ended"),
  workerId: SlugSchema.optional(),
  claimGeneration: z.number().int().positive().optional(),
  kind: z.literal("run"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  outcome: SpanOutcomeWireSchema,
  failureId: UuidSchema.optional(),
});

const WorkerSpanEndedSchema = z.strictObject({
  t: z.literal("span.ended"),
  kind: z.enum(["worker", "browser"]),
  ...BaseFields,
  ...WorkerSpanIdentityFields,
  outcome: SpanOutcomeWireSchema,
  errorSummary: z.string().min(1).optional(),
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
});

/** A plain union on purpose: `span.started`/`span.ended` appear for task, run, worker and browser identities, so `t` alone cannot discriminate. */
export const SpanEventWireSchema = z.union([
  RunQueuedSchema,
  RunClaimedSchema,
  RunRequeuedSchema,
  TaskSpanStartedSchema,
  WorkerSpanStartedSchema,
  GateOpenedSchema,
  GateResolvedSchema,
  TransactionPreviewedSchema,
  TransactionFencedSchema,
  DataObservedSchema,
  TaskSpanEndedSchema,
  RunSpanEndedSchema,
  WorkerSpanEndedSchema,
]);
export type SpanEventWire = z.infer<typeof SpanEventWireSchema>;
export type RunQueuedWire = z.infer<typeof RunQueuedSchema>;

/* ── the notes stream ──────────────────────────────────────────────── */

export const NoteLevelSchema = z.enum(["step", "success", "error", "waiting", "warn", "debug"]);

/** Closed key/value union for note fields. New notes keep original values as text. */
export const NoteFieldWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ key: z.string().min(1), kind: z.literal("text"), value: z.string() }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("count"), value: z.number().int().nonnegative() }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("digest"), value: Hex64Schema }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("last4"), value: z.string().max(4) }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("basename"), value: z.string() }),
]);
export type NoteFieldWire = z.infer<typeof NoteFieldWireSchema>;

const DeclaredActionIdentityWireSchema = z.strictObject({
  runId: UuidSchema,
  definitionFingerprint: Hex64Schema,
  nodeId: SlugSchema,
  taskId: SpanTaskIdSchema,
  childInvocation: z.strictObject({ parentRunId: UuidSchema, edgeId: SlugSchema }).optional(),
  attempt: PositiveIntSchema,
  claimGeneration: PositiveIntSchema,
  taskAttempt: PositiveIntSchema,
  invocationId: SlugSchema,
  occurrencePath: z.array(SlugSchema).min(1),
  logicalActionId: SlugSchema,
  occurrence: PositiveIntSchema,
  logicalSessionId: SlugSchema,
  physicalSessionId: UuidSchema.optional(),
  state: z.enum(["started", "completed", "failed", "not-run", "confirmed"]).optional(),
  confirmation: z.strictObject({ verificationActionId: SlugSchema, verificationOccurrence: PositiveIntSchema, verifiedAt: IsoInstantSchema }).optional(),
  reason: z.enum(["condition-false", "dry-run", "cancelled", "callback-failed"]).optional(),
}).superRefine((identity, context) => {
  if ((identity.state === "confirmed") !== (identity.confirmation !== undefined)) context.addIssue({ code: "custom", path: ["confirmation"], message: "confirmed action requires exact verification evidence" });
});

const ActionValueProducerWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-input"), path: SpanFieldPathSchema }),
  z.strictObject({ kind: z.literal("configuration"), key: z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u), schemaHash: Hex64Schema }),
  z.strictObject({ kind: z.literal("constant"), valueDigest: Hex64Schema }),
  z.strictObject({ kind: z.literal("task-output"), entryId: SlugSchema, path: SpanFieldPathSchema, source: DeclaredActionIdentityWireSchema.optional() }),
  z.strictObject({ kind: z.literal("transformation"), transformId: SlugSchema, path: SpanFieldPathSchema,
    inputs: z.array(z.strictObject({ inputId: SlugSchema, source: SnapshotWorkflowValueReferenceSchema, childResults: z.array(OperationChildResultReferenceSchema).max(256).optional(), identities: z.array(DeclaredActionIdentityWireSchema),
      state: z.enum(["retained", "definition-source", "unavailable"]), reason: z.literal("exact-input-occurrence-not-retained").optional() }).superRefine((input, context) => {
      if (input.state === "unavailable" ? input.identities.length !== 0 || input.reason === undefined
        : input.reason !== undefined || (input.state === "retained" ? input.identities.length === 0 : input.identities.length !== 0)) context.addIssue({ code: "custom", message: "transformation input lineage contradicts its state" });
    })).optional() }),
  z.strictObject({ kind: z.literal("child-output"), entryId: SlugSchema, path: SpanFieldPathSchema, source: DeclaredActionIdentityWireSchema.optional(), result: OperationChildResultIdentitySchema.optional(), inputs: z.array(OperationInputLineageSchema).optional() }),
]);

const ProtectedActionBindingWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("protected-store"), inputPath: z.literal("timekeeperName"), name: z.literal("timekeeperName"), valueId: UuidSchema }),
  z.strictObject({ kind: z.literal("test-data-local"), inputPath: z.enum(["documentNumber", "emplId"]),
    name: z.enum(["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]), sourceId: UuidSchema }),
  z.strictObject({ kind: z.literal("legacy-protected-input"), inputPath: z.enum(["timekeeperName", "documentNumber", "emplId"]),
    name: z.enum(["timekeeperName", "separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) }),
]);

const DeclaredActionOccurrenceWireSchema = DeclaredActionIdentityWireSchema.safeExtend({
  value: z.strictObject({
    slot: SlugSchema,
    fieldPath: SpanFieldPathSchema,
    producer: ActionValueProducerWireSchema,
    consumed: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("withheld"), reason: z.enum(["protection-unresolved", "classification-required"]) }),
      z.strictObject({ state: z.literal("observed"), value: JsonValueWireSchema }),
      z.strictObject({ state: z.literal("redacted"), binding: ProtectedActionBindingWireSchema }),
    ]),
  }).optional(),
});

const NoteBodyFields = {
  ...BaseFields,
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
  level: NoteLevelSchema,
  message: z.string().min(1),
  fields: z.array(NoteFieldWireSchema).optional(),
  confirmedAction: ConfirmedActionEventSchema.optional(),
  action: z.strictObject({
    kind: z.enum(["opened", "clicked", "typed", "selected", "checked", "set", "cleared", "pressed", "read", "computed", "verified", "branched", "joined", "gated", "delegated", "session", "screenshot"]),
    targetId: z.string().regex(/^[a-z][a-z0-9._/-]{2,119}$/iu),
    physicalSessionId: UuidSchema.optional(),
    value: z.union([z.string(), z.boolean()]).optional(),
    operation: DeclaredActionOccurrenceWireSchema.optional(),
  }).optional(),
} as const;

/** Same `SpanRef` addressing as spans — a note attributes to its exact task attempt or worker lifetime. */
export const NoteWireSchema = z.union([
  z.strictObject({ ...NoteBodyFields, ...RunSpanIdentityFields }),
  z.strictObject({ ...NoteBodyFields, ...WorkerSpanIdentityFields }),
]).superRefine((note, context) => {
  const confirmed = note.confirmedAction;
  if (confirmed === undefined) return;
  if (!("runId" in note) || note.runId !== confirmed.action.runId
    || note.traceId !== confirmed.traceId || note.attempt !== confirmed.action.attempt
    || note.workflow.length === 0 || note.ts !== confirmed.recordedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAction"], message: "confirmed action note owner or recorded instant mismatch" });
  }
});
export type NoteWire = z.infer<typeof NoteWireSchema>;

/** Serve retained note text, including older notes with no safety stamp. */
export function projectNoteForOperator(noteInput: unknown, _protectedInput?: boolean): NoteWire {
  return NoteWireSchema.parse(noteInput);
}

export function browserActionMessage(action: { readonly kind: string; readonly targetId: string; readonly value?: string | boolean; readonly operation?: { readonly state?: string; readonly reason?: string } }): string {
  const target = action.targetId.replaceAll(/[._/-]+/gu, " ").replaceAll(/\s+/gu, " ").trim();
  if (action.operation?.state === "started") return `Started ${action.kind} ${target}`;
  if (action.operation?.state === "failed") return `Callback failed during ${action.kind} ${target}`;
  if (action.operation?.state === "not-run") return `Did not run ${action.kind} ${target}: ${action.operation.reason}`;
  const verb = action.kind === "typed" ? "Typed" : action.kind === "selected" ? "Selected"
    : action.kind === "checked" ? "Checked" : action.kind === "set" ? "Set" : action.kind === "cleared" ? "Cleared"
      : action.kind === "pressed" ? "Pressed key in"
      : action.kind === "screenshot" ? "Screenshot" : action.kind === "opened" ? "Opened" : action.kind === "read" ? "Read" : action.kind === "computed" ? "Computed" : action.kind === "verified" ? "Verified" : action.kind === "branched" ? "Selected branch" : action.kind === "joined" ? "Joined" : action.kind === "gated" ? "Resolved gate" : action.kind === "delegated" ? "Delegated" : action.kind === "session" ? "Session lifecycle" : "Clicked";
  if (action.value === undefined) {
    if (action.kind === "typed") return `Typed into ${target}`;
    if (action.kind === "selected") return `Selected in ${target}`;
    return `${verb} ${target}`;
  }
  if (action.kind === "typed") return `Typed ${JSON.stringify(action.value)} into ${target}`;
  if (action.kind === "selected") return `Selected ${JSON.stringify(action.value)} in ${target}`;
  if (action.kind === "set") return `Set ${target} to ${JSON.stringify(action.value)}`;
  return `${verb} ${target}: ${JSON.stringify(action.value)}`;
}
