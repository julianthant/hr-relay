/**
 * The span/notes wire and at-rest contract (ref dashboard-surfaces §1.1) — a leaf module.
 *
 * This file imports zod plus the zod-only canonical redaction-policy leaf on
 * purpose (the same import budget a bundle-safe descriptor gets): every JSONL line, projector ingest, and SSE
 * payload that carries a span or note parses through these schemas, so the
 * contract must not drag the server module graph — or the descriptor closure —
 * behind it. The id patterns are therefore restated locally; the
 * `tests/unit/events/span-events.test.ts` parity cases pin them byte-for-byte
 * against `src/domain/ids.ts` so a drift fails the suite instead of silently
 * forking the vocabulary.
 *
 * Identity (ref dashboard-surfaces §1.1): run/task spans are `(runId, attempt, spanPath)`;
 * worker/browser spans are `(workerId, spanPath)`. Identity attributes are
 * written exactly once, by `run.queued`, and no arm of this union can restate
 * one: every other event is a `strictObject` that does not name them.
 *
 * D254 (2026-08-20, operator ruling) — the `span.patched` detail channel is
 * RETIRED from this union. It carried a declared per-workflow key vocabulary
 * and had ZERO production emitters: the kernel's `SpanEmitter`
 * (`src/core/span-emitter.ts`) never had the arm, so nothing in `src/` could
 * produce one, and `.tracker-rebuild/spans` holds no such line. A vocabulary
 * arm nothing can emit is not "unused", it is unreachable — and it made every
 * surface fed by it render its empty state permanently while every gate stayed
 * green. Removing it is reversible and honest; building the emitter was work
 * nobody asked for. A `span.patched` line therefore now fails the union BY
 * NAME, which is the correct answer for a shape this repository never wrote.
 *
 * Deliberately absent from this 1g slice (each is a later owning slice, not a
 * forgotten arm): `subject.observed` (emitted by the write-sequencer /
 * driver lane), note `action` attribution and screenshot/data-point
 * attachments (driver instrumentation), and `resultRef` on `gate.resolved`
 * (gate results are keyed by `(runId, gateId)` in authority; a separate ref id
 * would duplicate that identity today).
 */
import { z } from "zod";
import {
  CURRENT_DIAGNOSTIC_SAFETY_VERSION,
  DiagnosticSafetyVersionSchema,
} from "../domain/trust/failure.js";
import { DataClassificationSchema, refineEvidenceTransformPair } from "../domain/redaction-policy.js";
import { RunRecoveryModeSchema } from "../domain/run/envelope.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const TRACE_PATTERN = /^[a-z0-9]{2}-(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]-[0-9a-f]{4}$/;
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

/**
 * `JsonValueSchema`, restated — the same recursion `src/domain/canonical-json.ts`
 * declares. It is restated rather than imported for this module's whole reason
 * for existing: the wire leaf must not drag the server module graph behind it.
 */
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

/** Ref dashboard-surfaces §1.1's outcome union; `skipped` is a task-span outcome. */
export const SpanOutcomeWireSchema = z.enum([
  "done", "failed", "cancelled", "discarded", "skipped", "interrupted", "superseded",
]);
export type SpanOutcomeWire = z.infer<typeof SpanOutcomeWireSchema>;

/**
 * Why a `skipped` task span did not run. Pinned against
 * `TerminalNotRunReasonSchema` (`src/domain/run/result.ts`) — the durable
 * result and the timeline must name a skip with the SAME closed word, or the
 * surface and the record disagree about the same fact.
 */
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

/**
 * Run is born at ENQUEUE (ref dashboard-surfaces §1.1). Carries the queue row's immutable
 * identity attributes — stamped once, never re-derived by a projector.
 */
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
  /** D307 — the step keys this run omits; the typed facts stay in run authority, never in a span. */
  omittedSteps: z.array(SlugSchema).min(1).optional(),
  retryOf: UuidSchema.optional(),
  /** D314 — present only on a Restart-from-start attempt; a Resume carries `retryOf` alone. */
  recovery: RunRecoveryModeSchema.optional(),
  actorId: SlugSchema,
  /** The exact title/subtitle the confirmation surface showed (start-plan D109). */
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: Hex64Schema,
  resolvedInstance: z.partialRecord(SpanBrowserSystemSchema, SpanSystemInstanceSchema),
  configFingerprint: Hex64Schema,
  configSnapshotId: UuidSchema,
  repair: AuthorityReconstructionRepairSchema.optional(),
});

const RunClaimedSchema = z.strictObject({
  t: z.literal("run.claimed"),
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

/**
 * D210 / ref task-contract §6.2 — a dry run's transaction node. Its parity twin lives in
 * `src/core/span-emitter.ts`; see that arm for why it is not a `span.ended`.
 */
const TransactionPreviewedSchema = z.strictObject({
  t: z.literal("transaction.previewed"),
  ...BaseFields,
  ...RunSpanIdentityFields,
  node: SlugSchema,
  /**
   * D215 — `not-observed` is the fourth verdict, and it is the one an
   * `already-present` preview reports: beat ①'s probe settled the node before
   * anything was staged, so no page was prepared and no subject was read.
   * It was ratified in ref workflow-model §2.1 and landed in the kernel's twin
   * (`src/core/span-emitter.ts`) without reaching this wire leaf, so the FIRST
   * preview that ever settled — chunk 6c's composed dry run on doc 4502,
   * whose ordinary subject has no pending transaction — threw inside the JSONL
   * writer and killed the worker one emit short of its terminal.
   */
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

/**
 * D270 — an observed data point's redacted value. The parity twin of
 * `RedactedFieldSchema` (`src/domain/redaction.ts`), restated arm-for-arm while
 * sharing its canonical classification/transform rule; the
 * round-trip cases in `tests/unit/events/span-events.test.ts` enumerate every
 * classification and every transform, because the D215 lesson is that two
 * schemas calling each other twins still fork on the arm nobody emits.
 */
export const SpanDataClassificationSchema = DataClassificationSchema;
const RedactedSpanValueSchema = z.discriminatedUnion("transform", [
  z.strictObject({
    key: z.string(),
    state: z.literal("redacted"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("drop"),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("last4"),
    value: z.string().max(4, "must contain at most four characters"),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("digest"),
    value: Hex64Schema,
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("basename"),
    value: z.string(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("transformed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("count"),
    value: z.number().int().nonnegative(),
  }),
  z.strictObject({
    key: z.string(),
    state: z.literal("allowed"),
    classification: SpanDataClassificationSchema,
    transform: z.literal("allow"),
    value: JsonValueWireSchema,
  }),
]).superRefine(refineEvidenceTransformPair);

/** One recorded point; see `src/core/span-emitter.ts` for why it carries no `system`. */
export const ObservedDataPointWireSchema = z.strictObject({
  direction: z.enum(["read", "write"]),
  field: SpanFieldPathSchema,
  values: z.array(RedactedSpanValueSchema).min(1),
});
export type ObservedDataPointWire = z.infer<typeof ObservedDataPointWireSchema>;

/**
 * D270 — the observed-log emission. Its parity twin lives in
 * `src/core/span-emitter.ts`; that arm carries the reasoning.
 */
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
  /** The schema-parsed result lives in authority (D67); this is its digest. */
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
  /**
   * Present only on `skipped`, and only when the executor actually recorded a
   * reason. Its absence means "no reason was recorded" and must stay legible
   * as that — never be back-filled with a plausible one.
   */
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

/**
 * A plain union on purpose: `span.started`/`span.ended` legitimately appear
 * for task, run, worker, and browser identities, so `t` alone cannot be a
 * unique discriminator. Every arm stays a strict object.
 */
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

/* ── the notes stream (D10) ──────────────────────────────────────────────── */

export const NoteLevelSchema = z.enum(["step", "success", "error", "waiting", "warn", "debug"]);

/**
 * A closed key/value union — never a decision-bearing open map. The kinds
 * mirror the redaction transforms (ref clock-config-secrets): a value that reached this wire
 * either passed `allow` as text, or was transformed. Dropped fields do not
 * appear at all.
 */
export const NoteFieldWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ key: z.string().min(1), kind: z.literal("text"), value: z.string() }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("count"), value: z.number().int().nonnegative() }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("digest"), value: Hex64Schema }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("last4"), value: z.string().max(4) }),
  z.strictObject({ key: z.string().min(1), kind: z.literal("basename"), value: z.string() }),
]);
export type NoteFieldWire = z.infer<typeof NoteFieldWireSchema>;

const NoteBodyFields = {
  ...BaseFields,
  diagnosticSafetyVersion: DiagnosticSafetyVersionSchema.optional(),
  level: NoteLevelSchema,
  message: z.string().min(1),
  fields: z.array(NoteFieldWireSchema).optional(),
} as const;

/** Same `SpanRef` addressing as spans — a note attributes to its exact task attempt or worker lifetime. */
export const NoteWireSchema = z.union([
  z.strictObject({ ...NoteBodyFields, ...RunSpanIdentityFields }),
  z.strictObject({ ...NoteBodyFields, ...WorkerSpanIdentityFields }),
]);
export type NoteWire = z.infer<typeof NoteWireSchema>;

/** Historical note messages and text fields predate the diagnostic-safe stamp. */
export function projectNoteForOperator(noteInput: unknown): NoteWire {
  const note = NoteWireSchema.parse(noteInput);
  if (note.diagnosticSafetyVersion === CURRENT_DIAGNOSTIC_SAFETY_VERSION) return note;
  const { fields: _historicalFields, ...identity } = note;
  return NoteWireSchema.parse({
    ...identity,
    message: "historical note text withheld (predates diagnostic safety v1)",
  });
}
