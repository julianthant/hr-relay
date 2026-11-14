import { z } from "zod";
import { OcrReviewRecordSchema, OcrOperatorPagesSchema } from "../../models/ocr/review-record.js";
import { AssistantModelPreferenceSchema } from "../../models/config/assistant-model-preference.js";
import { NotificationCollectionTargetSchema } from "../../models/notifications/notifications.js";
import { RunContinuationSchema } from "../../models/run/continuation.js";
import { RunDisplayNameSchema } from "../../models/run/display-name.js";
import { FailureResolutionActionSchema,FailureResolutionTargetSchema } from "../../models/trust/failure-resolution.js";
import { WriteIntentRecordSchema } from "../write-safety/write-safety.js";
export { RunDisplayNameSchema } from "../../models/run/display-name.js";

import { MarkedProtectedSettingsPatchSchema,ProtectedSettingsPatchSchema,ProtectedSettingsReceiptEntriesSchema,markProtectedSettingsPatch } from "../../models/config/protected-settings.js";
import { SettingsLeafOperationSchema,SettingsPatchSchema } from "../../models/config/settings.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";
import { ActorIdSchema,BrowserSessionIdSchema,CommandAuditIdSchema,CommandIdSchema,DependencyIdSchema,FingerprintSchema,GateIdSchema,IntakeManifestIdSchema,IntakeSessionIdSchema,IntakeTargetFieldIdSchema,IsoInstantSchema,ItemIdSchema,LOCAL_OPERATOR_ACTOR_ID,NodeIdSchema,NonNegativeIntSchema,NotificationIdSchema,PositiveIntSchema,RunIdSchema,RunSessionIdSchema,SourceColumnIdSchema,SourceSurfaceIdSchema,StartPlanIdSchema,TaskIdSchema,TraceIdSchema,WorkerIdSchema,WorkflowIdSchema,WriteAttemptIdSchema,WriteIntentIdSchema } from "../identity/ids.js";
import { JsonValueSchema,canonicalJsonStringify } from "../validation/canonical-json.js";
import { deepFreeze } from "../validation/immutability.js";
import { sha256Hex } from "../validation/sha256.js";

export const AssistantActionBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("proposal"), proposalId: z.uuid(), rowId: z.uuid() }),
  z.strictObject({ kind: z.enum(["session", "local-edit"]), actionId: z.uuid() }),
]);
export const AssistantCommandAttributionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unrecorded") }),
  z.strictObject({ kind: z.literal("assistant"), requestedBy: ActorIdSchema, profileId: z.uuid(), conversationId: z.uuid(), acceptedMessageId: z.uuid(), binding: AssistantActionBindingSchema }),
]);

/** A durable command identity cannot be reused by another command or authority. */
export class CommandIdentityConflictError extends Error {
  constructor(message = "command-divergent: command identity belongs to a different command") {
    super(message);
    this.name = "CommandIdentityConflictError";
  }
}

export const CommandFamilySchema = z.enum([
  "ocr-review",
  "application",
  "assistant-model-preference",
  "failure-resolution",
  "workflow-batch",
  "start",
  "intake",
  "worker-browser",
  "settings",
  "run",
  "gate",
  "notification",
]);

export const CommandActionSchema = z.enum([
  "correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record",
  "pause-all",
  "pause-all-and-quit",
  "check-parked-write",
  "set-assistant-model-preference",
  "annotate-failure",
  "set-batch-grouping",
  "start-run",
  "inspect-intake",
  "confirm-intake-mapping",
  "correct-intake-row",
  "exclude-intake-row",
  "validate-intake",
  "enqueue-intake-manifest",
  "plan-worker-count",
  "spawn-worker",
  "stop-worker",
  "remove-worker",
  "retry-worker",
  "pause-worker",
  "resume-worker",
  "refresh-browser",
  "reopen-browser",
  "apply-settings",
  "apply-protected-settings",
  "retry",
  "recover-run",
  "pause",
  "resume",
  "cancel",
  "bump",
  "rename",
  "delete",
  "recheck-write",
  "resolve-write-absent",
  "resolve-workbook-row",
  "resolve-workbook-reference-row",
  "resolve-gate",
  "notification-read",
  "notification-unread",
  "notification-snooze",
  "notification-unsnooze",
  "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all",
]);

export const OperatorReasonSchema = z.string().min(1).max(500).refine(
  (value) => value.trim() === value,
  "operator reason must already be trimmed",
);


export const SemverSchema = z.string().regex(
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "version must be semantic version text",
);

const CommandEnvelopeFields = {
  commandId: CommandIdSchema,
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  source: SourceSurfaceIdSchema,
  reason: OperatorReasonSchema.optional(),
} as const;

export const CommandEnvelopeSchema = z.strictObject(CommandEnvelopeFields);

const RunVersionTargetSchema = z.strictObject({
  runId: RunIdSchema,
  expectedVersion: PositiveIntSchema,
});

const IntakeVersionTargetSchema = z.strictObject({
  intakeSessionId: IntakeSessionIdSchema,
  expectedVersion: PositiveIntSchema,
});

// Pool CAS uses row versions; zero means unplanned, never a lease version or patch cursor.
const WorkerPoolVersionTargetSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  expectedVersion: NonNegativeIntSchema,
});

// A member command cites the pool member's lifetime in this boot (null before its first spawn) and its in-memory version.
const WorkerMemberTargetSchema = z.strictObject({
  workerId: WorkerIdSchema,
  lifetimeId: z.uuid().nullable(),
  expectedVersion: NonNegativeIntSchema,
});

export const StartCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("start"),
  type: z.literal("start-run"),
  target: z.strictObject({
    workflowId: WorkflowIdSchema,
    startPlanId: StartPlanIdSchema,
    expectedVersion: PositiveIntSchema,
  }),
  payload: z.strictObject({
    descriptorFingerprint: FingerprintSchema,
    configFingerprint: FingerprintSchema,
    ingressSchemaHash: FingerprintSchema,
    canonicalInputSchemaHash: FingerprintSchema,
    inputFingerprint: FingerprintSchema,
  }),
});

// Upload sessions own artifacts; enqueue targets their version and requires explicit dryRun.
export const IntakeCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("inspect-intake"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sheet: z.string().min(1).optional(), headerRowIndex: z.number().int().nonnegative().optional(), comparisonManifestId: IntakeManifestIdSchema.optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("confirm-intake-mapping"), target: IntakeVersionTargetSchema, payload: z.strictObject({ targetFieldId: IntakeTargetFieldIdSchema, sourceColumnId: SourceColumnIdSchema, headerFingerprint: FingerprintSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("correct-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, field: IntakeTargetFieldIdSchema, correctedValue: z.string() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("exclude-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, reason: OperatorReasonSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("validate-intake"), target: IntakeVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("enqueue-intake-manifest"), target: IntakeVersionTargetSchema, payload: z.strictObject({ dryRun: z.boolean(), reviewBinding: FingerprintSchema.optional() }) }),
]);

const WorkerMemberControlTargetSchema = WorkerMemberTargetSchema.extend({ workflowId: WorkflowIdSchema });

export const ParkedWriteCheckTargetSchema = WorkerMemberTargetSchema.extend({
  lifetimeId: z.uuid(),
  installationId: z.uuid(), profileId: z.uuid(), workflowId: WorkflowIdSchema, itemId: ItemIdSchema,
  runId: RunIdSchema, runVersion: PositiveIntSchema, runAttempt: PositiveIntSchema, traceId: TraceIdSchema, nodeId: NodeIdSchema,
  writeIntentId: WriteIntentIdSchema, intentVersion: PositiveIntSchema, intentGeneration: PositiveIntSchema,
  writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema, occurrenceKeyDigest: FingerprintSchema,
});
export const ParkedWriteCheckResultSchema = z.strictObject({
  commandId: CommandIdSchema, requestedBy: ActorIdSchema, target: ParkedWriteCheckTargetSchema,
  observedAt: IsoInstantSchema, held: z.literal(true), provenance: z.enum(["system-probe", "not-observed"]),
  state: z.enum(["absent", "ambiguous", "unknown", "unavailable"]),
  code: z.enum(["PARKED_CHECK_ABSENT", "PARKED_CHECK_AMBIGUOUS", "PARKED_CHECK_UNKNOWN", "PARKED_CHECK_UNAVAILABLE", "PARKED_CHECK_OCCURRENCE_UNPROVED"]),
  probeTaskId: TaskIdSchema.optional(), evidenceDigest: FingerprintSchema,
}).superRefine((result, context) => {
  const state = result.code === "PARKED_CHECK_ABSENT" ? "absent"
    : result.code === "PARKED_CHECK_UNAVAILABLE" ? "unavailable" : result.code === "PARKED_CHECK_UNKNOWN" ? "unknown" : "ambiguous";
  if (result.state !== state || (result.provenance === "system-probe") !== (result.probeTaskId !== undefined)
    || ((result.state === "absent" || result.state === "ambiguous") && result.provenance !== "system-probe")) {
    context.addIssue({ code: "custom", message: "a held check must state the actual registered observation and provenance" });
  }
});
export type ParkedWriteCheckTarget = z.infer<typeof ParkedWriteCheckTargetSchema>;
export type ParkedWriteCheckResult = z.infer<typeof ParkedWriteCheckResultSchema>;

/** The worker's observed check, kept on the command audit. */
export const ParkedWriteCheckAcknowledgementSchema = z.strictObject({ result: ParkedWriteCheckResultSchema, evidence: SchemaBoundCanonicalValueSchema.optional(),
  findingsIdentity: z.strictObject({ activityId: z.uuid(), descriptorVersion: PositiveIntSchema, contractFingerprint: FingerprintSchema,
    claimGeneration: PositiveIntSchema, implFingerprint: FingerprintSchema }).optional() }).superRefine((ack, context) => {
  if (ack.findingsIdentity !== undefined && (ack.evidence === undefined || ack.result.probeTaskId !== "ucpath/read-transaction-findings"
    || ack.result.state !== "unknown" || ack.result.provenance !== "system-probe")) {
    context.addIssue({ code: "custom", message: "held findings require their registered unverified read evidence" });
  }
});
export type ParkedWriteCheckAcknowledgement = z.infer<typeof ParkedWriteCheckAcknowledgementSchema>;

export const WorkerBrowserCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("check-parked-write"), target: ParkedWriteCheckTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["remove-worker", "retry-worker"]), target: WorkerMemberControlTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("stop-worker"), target: WorkerMemberControlTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("plan-worker-count"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ desiredWorkers: z.number().int().min(0) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("spawn-worker"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ workerId: WorkerIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["pause-worker", "resume-worker"]), target: WorkerMemberControlTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["refresh-browser", "reopen-browser"]), target: WorkerMemberTargetSchema.extend({ lifetimeId: z.uuid(), browserSessionId: BrowserSessionIdSchema }) }),
]);

export const AssistantModelPreferenceCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields, family: z.literal("assistant-model-preference"), type: z.literal("set-assistant-model-preference"),
  target: z.strictObject({ profileId: z.uuid(), epoch: z.number().int().nonnegative(), expectedRevision: NonNegativeIntSchema }),
  payload: AssistantModelPreferenceSchema,
});

export const SettingsCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("settings"),
  type: z.literal("apply-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({
    settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
    patch: z.record(z.string().min(1), SettingsLeafOperationSchema),
  }).superRefine((payload, context) => {
    const ordinary = SettingsPatchSchema.safeParse(payload.patch);
    if (!ordinary.success) for (const issue of ordinary.error.issues) context.addIssue({ ...issue, path: ["patch", ...issue.path] });
  }),
});

export const ProtectedSettingsCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("settings"),
  type: z.literal("apply-protected-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({
    protectedSchemaHash: FingerprintSchema,
    writeId: z.uuid(),
    entries: ProtectedSettingsPatchSchema,
  }),
});

/** The only protected command shape permitted in the durable journal and audit. */
export const MarkedProtectedSettingsCommandRequestSchema =
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("settings"),
    type: z.literal("apply-protected-settings"),
    target: z.strictObject({ expectedRevision: PositiveIntSchema }),
    payload: z.strictObject({
      protectedSchemaHash: FingerprintSchema,
      writeId: z.uuid(),
      entries: MarkedProtectedSettingsPatchSchema,
    }),
  });

/** The public boundary accepts values; the durable schema additionally accepts the marked form because command/audit rows must never retain protected data. */
const SettingsCommandFamilyRequestSchema = z.union([
  ProtectedSettingsCommandRequestSchema,
  MarkedProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
]);

export function markSettingsCommand(command: unknown): z.infer<typeof SettingsCommandFamilyRequestSchema> {
  const parsed = SettingsCommandFamilyRequestSchema.parse(command);
  if (parsed.type === "apply-settings") return deepFreeze(parsed);
  const alreadyMarked = MarkedProtectedSettingsCommandRequestSchema.safeParse(parsed);
  if (alreadyMarked.success) return deepFreeze(alreadyMarked.data);
  const protectedCommand = ProtectedSettingsCommandRequestSchema.parse(parsed);
  return deepFreeze(MarkedProtectedSettingsCommandRequestSchema.parse({
    ...protectedCommand,
    payload: {
      ...protectedCommand.payload,
      entries: markProtectedSettingsPatch(protectedCommand.payload.entries),
    },
  }));
}

/** Crash recovery binds every canonical command-envelope field, not only the patch. */
export function deriveSettingsCommandFingerprint(command: unknown): string {
  const parsed = markSettingsCommand(command);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:settings-command:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export const ApplicationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("application"), type: z.literal("pause-all"),
    target: z.strictObject({ runtimeGeneration: PositiveIntSchema }), payload: z.strictObject({ targets: z.array(RunVersionTargetSchema) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("application"), type: z.literal("pause-all-and-quit"),
    target: z.strictObject({ runtimeGeneration: PositiveIntSchema }), payload: z.strictObject({ confirmed: z.literal(true), targets: z.array(RunVersionTargetSchema) }) }),
]);

export const WorkbookRowChoiceTargetSchema = RunVersionTargetSchema.extend({ libraryId: z.string().min(1), operationId: z.string().min(1),
  receiptDigest: FingerprintSchema, workbookVersion: PositiveIntSchema });
export const WorkbookReferenceRowChoiceTargetSchema = RunVersionTargetSchema.extend({
  libraryId: z.string().min(1), typeId: z.string().min(1), referenceDigest: FingerprintSchema,
  key: z.string().min(1), workbookVersion: PositiveIntSchema, gateId: GateIdSchema,
});
export const RunCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-workbook-reference-row"),
    target: WorkbookReferenceRowChoiceTargetSchema,
    payload: z.strictObject({ sheetId: z.string().min(1), rowId: z.string().min(1),
      referenceDigest: FingerprintSchema.optional(), workbookVersion: PositiveIntSchema.optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-workbook-row"),
    target: WorkbookRowChoiceTargetSchema,
    payload: z.strictObject({ sheetId: z.string().min(1), rowId: z.string().min(1) }) }),
    /** Native Retry remains distinct from explicit checkpoint recovery. */
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.enum(["retry", "pause", "resume", "cancel", "bump"]), target: RunVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("recover-run"), target: RunVersionTargetSchema }),
  /** Delete means delete: a terminal queue run and every row it owns leave authority. */
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("delete"), target: RunVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("rename"), target: RunVersionTargetSchema, payload: z.strictObject({ displayName: z.string() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("recheck-write"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema, writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema }), payload: z.strictObject({ occurrenceKeyDigest: FingerprintSchema, transactionId: z.string().regex(/^T\d+$/u).optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-absent"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema, writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema }), payload: z.strictObject({ occurrenceKeyDigest: FingerprintSchema }) }),
]);

export const GateCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("gate"),
  type: z.literal("resolve-gate"),
  target: z.strictObject({ runId: RunIdSchema, gateId: GateIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ result: SchemaBoundCanonicalValueSchema,
    ocrApproval: z.strictObject({ expectedRevision: PositiveIntSchema, reviewDigest: FingerprintSchema,
      selectedRecordIds: z.array(z.string().min(1)).min(1) }).optional() }),
});

/** The dashboard's identity-review answer: opaque refs the server served; ingress resolves them to a `resolve-gate` before the kernel. */
export const IdentityGateAnswerRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("gate"),
  type: z.literal("answer-identity-gate"),
  target: GateCommandRequestSchema.shape.target,
  payload: z.union([
    z.strictObject({ decision: z.literal("approved"), gateRef: z.uuid(), optionRef: z.uuid() }),
    z.strictObject({ decision: z.literal("approved"), gateRef: z.uuid(), typedEid: z.string().regex(/^\d{8}$/u) }),
    z.strictObject({ decision: z.literal("rejected"), gateRef: z.uuid() }),
  ]),
});
export type IdentityGateAnswerRequest = z.infer<typeof IdentityGateAnswerRequestSchema>;

export const OcrReviewCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("ocr-review"), type: z.literal("correct-ocr-record"),
    target: z.strictObject({ runId: RunIdSchema, expectedRevision: PositiveIntSchema }),
    payload: OcrReviewRecordSchema.pick({ recordId: true, fields: true, assertedEid: true }).extend({ pages: OcrOperatorPagesSchema.optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("ocr-review"), type: z.enum(["discard-ocr-record", "restore-ocr-record"]),
    target: z.strictObject({ runId: RunIdSchema, expectedRevision: PositiveIntSchema }),
    payload: z.strictObject({ recordId: OcrReviewRecordSchema.shape.recordId }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("ocr-review"), type: z.literal("add-ocr-record"),
    target: z.strictObject({ runId: RunIdSchema, expectedRevision: PositiveIntSchema }),
    payload: z.strictObject({ pages: OcrOperatorPagesSchema }) }),
]);

export const NotificationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"]), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"]), target: NotificationCollectionTargetSchema }),
]);


export const WorkflowBatchCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("workflow-batch"),
  type: z.literal("set-batch-grouping"),
  target: z.strictObject({ batchId: RunSessionIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ groupInQueue: z.boolean() }),
});

export const FailureResolutionCommandSchema = z.strictObject({ ...CommandEnvelopeFields,
  family: z.literal("failure-resolution"), type: z.literal("annotate-failure"),
  target: FailureResolutionTargetSchema, payload: FailureResolutionActionSchema });
export type FailureResolutionCommand = z.infer<typeof FailureResolutionCommandSchema>;
export const CommandRequestSchema = z.union([
  OcrReviewCommandRequestSchema,
  ApplicationCommandRequestSchema,
  AssistantModelPreferenceCommandRequestSchema,
  FailureResolutionCommandSchema,
  WorkflowBatchCommandRequestSchema,
  StartCommandRequestSchema,
  IntakeCommandRequestSchema,
  WorkerBrowserCommandRequestSchema,
  SettingsCommandRequestSchema,
  ProtectedSettingsCommandRequestSchema,
  MarkedProtectedSettingsCommandRequestSchema,
  RunCommandRequestSchema,
  GateCommandRequestSchema,
  NotificationCommandRequestSchema,
]);

export const CommandTargetReferenceSchema = z.discriminatedUnion("family", [
  z.strictObject({ family: z.literal("ocr-review"), runId: RunIdSchema }),
  z.strictObject({ family: z.literal("application"), runtimeGeneration: PositiveIntSchema }),
  z.strictObject({ family: z.literal("assistant-model-preference"), profileId: z.uuid(), revision: PositiveIntSchema }),
  z.strictObject({family:z.literal("failure-resolution"), runId:RunIdSchema, failureId:FailureResolutionTargetSchema.shape.failureId}),
  z.strictObject({ family: z.literal("workflow-batch"), batchId: RunSessionIdSchema }),
  z.strictObject({
    family: z.literal("start"),
    workflowId: WorkflowIdSchema,
    startPlanId: StartPlanIdSchema,
    expectedVersion: PositiveIntSchema,
  }),
  z.strictObject({ family: z.literal("intake"), intakeSessionId: IntakeSessionIdSchema }),
  z.strictObject({ family: z.literal("worker-browser"), workerId: WorkerIdSchema }),
  /** The per-workflow pool row `plan-worker-count` advanced. */
  z.strictObject({ family: z.literal("worker-pool"), workflowId: WorkflowIdSchema }),
  z.strictObject({ family: z.literal("settings"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("protected-settings"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ family: z.literal("gate"), runId: RunIdSchema, gateId: GateIdSchema }),
  z.strictObject({ family: z.literal("notification"), notificationId: NotificationIdSchema }),
]);

export const CommandRejectionCodeSchema = z.enum([
  "WORKER_PAUSE_SETTLING",
  "OCR_REVIEW_REFUSED",
  "RUN_CONTINUATION_REFUSED",
  "RUN_START_PLAN_EXPIRED",
  "RUN_START_READINESS_BLOCKED",
  "RUN_START_READINESS_UNAVAILABLE",
  "RUN_START_READINESS_CHANGED",
  "PREFLIGHT_EVIDENCE_EXPIRED",
  "PREFLIGHT_TIMEOUT",
  "invalid-state",
  "target-not-found",
  "target-deleted",
  "replan-required",
  "authority-unavailable",
  "policy-refused",
  "schema-mismatch",
  "patch-fingerprint-mismatch",
  "envelope-fingerprint-mismatch",
  "not-editable",
  "invalid-value",
  "cross-field-invalid",
  "document-too-large",
  "authority-unjournaled",
  "authority-uncertain",
  "directory-integrity",
  "lock-unavailable",
  "command-divergent",
  "write-id-reused",
  "active-version-blockers",
    /* The arm is schema-recognized but its owning milestone has not activated it; this result is computed with ZERO authority side effects. */
  "capability-unavailable",
  "bulk-child-errored",
]);

export const RunWorkerStartupFailureSchema = z.strictObject({
  state: z.enum(["refused", "unknown"]), code: z.literal("RUN_QUEUED_WORKER_UNAVAILABLE"),
  message: z.string().min(1), detail: z.string().min(1), commandId: CommandIdSchema.optional(),
});
export type RunWorkerStartupFailure = z.infer<typeof RunWorkerStartupFailureSchema>;

const CommandLandingResultSchema = z.strictObject({
  state: z.enum(["applied", "already-applied"]),
  commandId: CommandIdSchema,
  affectedTargets: z.array(CommandTargetReferenceSchema),
  noChange: z.literal("no-matching-notifications").optional(),
  restartRequired: z.boolean().optional(),
  settingsRevision: PositiveIntSchema.optional(),
  settingsFingerprint: FingerprintSchema.optional(),
  revision: PositiveIntSchema.optional(),
  entries: ProtectedSettingsReceiptEntriesSchema.optional(),
  workerStartup: RunWorkerStartupFailureSchema.optional(),
}).superRefine((result, context) => {
  if (result.workerStartup !== undefined && !result.affectedTargets.some(target => target.family === "run")) {
    context.addIssue({ code: "custom", path: ["workerStartup"], message: "worker startup requires the retained queued run targets" });
  }
  if ((result.affectedTargets.length === 0) !== (result.noChange !== undefined)) {
    context.addIssue({ code: "custom", path: ["affectedTargets"], message: "only an explicit no-matching-notifications result may have no affected targets" });
  }
  const settingsTargets = result.affectedTargets.filter((target) => target.family === "settings");
  const protectedTargets = result.affectedTargets.filter((target) => target.family === "protected-settings");
  const hasOrdinaryResult = result.restartRequired !== undefined
    || result.settingsRevision !== undefined
    || result.settingsFingerprint !== undefined;
  const hasProtectedResult = result.revision !== undefined
    || result.entries !== undefined;
  if (settingsTargets.length === 0 && protectedTargets.length === 0) {
    if (hasOrdinaryResult || hasProtectedResult) {
      context.addIssue({
        code: "custom",
        message: "settings result fields require one settings or protected-settings target",
      });
    }
    return;
  }
  if (settingsTargets.length === 1) {
    const target = settingsTargets[0];
    if (result.affectedTargets.length !== 1 || target === undefined
      || result.restartRequired === undefined
      || result.settingsRevision !== target.revision
      || result.settingsFingerprint === undefined

      || result.revision !== undefined
      || result.entries !== undefined) {
      context.addIssue({
        code: "custom",
        message: "an ordinary settings result requires an explicit restart decision and its exact revision/fingerprint only",
      });
    }
    return;
  }
  const target = protectedTargets[0];
  if (protectedTargets.length !== 1 || result.affectedTargets.length !== 1 || target === undefined) {
    context.addIssue({
      code: "custom",
      path: ["affectedTargets"],
      message: "a protected settings result must affect exactly one protected-settings revision",
    });
    return;
  }
  if (result.restartRequired !== false
    || result.revision !== target.revision
    || result.entries === undefined
    || result.settingsRevision !== undefined
    || result.settingsFingerprint !== undefined) {
    context.addIssue({
      code: "custom",
      message: "a protected settings result requires restartRequired=false and its exact revision/presence entries only",
    });
  }
});

export const CommandResultSchema = z.discriminatedUnion("state", [
  CommandLandingResultSchema,
  z.strictObject({ state: z.literal("pending"), commandId: CommandIdSchema }),
  z.strictObject({ state: z.literal("confirmation-required"), commandId: CommandIdSchema, warningDigest: FingerprintSchema, message: z.string().min(1) }),
  // Only unplanned pools report version zero; all other targets start at one.
  z.strictObject({ state: z.literal("conflict"), commandId: CommandIdSchema, currentVersion: NonNegativeIntSchema, message: z.string().min(1) }),
  z.strictObject({ state: z.literal("rejected"), commandId: CommandIdSchema, code: CommandRejectionCodeSchema, message: z.string().min(1) }),
]).superRefine((result, context) => {
  if (result.state !== "applied" && result.state !== "already-applied") return;
  const affectsSettings = result.affectedTargets.some((target) => target.family === "settings");
  const affectsProtected = result.affectedTargets.some((target) => target.family === "protected-settings");
  if ((affectsSettings && result.restartRequired === undefined)
    || (affectsProtected && result.restartRequired !== false)
    || (!affectsSettings && !affectsProtected && result.restartRequired !== undefined)) {
    context.addIssue({ code: "custom", path: ["restartRequired"], message: "restart decision requires its exact settings target" });
  }
});

export function commandNoChangeResultMatches(request: DashboardCommandRequest, result: CommandResult): boolean {
  if (result.state !== "applied" && result.state !== "already-applied" || result.noChange === undefined) return true;
  return request.family === "notification" && "members" in request.target && request.target.matchingCount === 0;
}

export const CommandAuditRecordSchema = z.strictObject({
  auditId: CommandAuditIdSchema,
  request: CommandRequestSchema,
  result: CommandResultSchema,
  completedAt: IsoInstantSchema,
  /** `before` admits 0 because the first pool plan moves 0 → 1. */
  versionChanges: z.array(z.strictObject({ target: CommandTargetReferenceSchema, before: NonNegativeIntSchema, after: PositiveIntSchema })),
  affectedDependencyIds: z.array(DependencyIdSchema),
  writeResolution: WriteIntentRecordSchema.optional(),
  parkedWriteCheck: ParkedWriteCheckAcknowledgementSchema.optional(),
}).superRefine((audit, context) => {
  if (audit.result.state === "pending") context.addIssue({ code: "custom", path: ["result"], message: "pending-command-cannot-have-terminal-audit" });
  const request = audit.request;
  if (audit.parkedWriteCheck !== undefined && (request.type !== "check-parked-write" || audit.result.state !== "applied"
    || audit.parkedWriteCheck.result.commandId !== request.commandId || audit.parkedWriteCheck.result.requestedBy !== request.requestedBy
    || canonicalJsonStringify(audit.parkedWriteCheck.result.target) !== canonicalJsonStringify(request.target))) {
    context.addIssue({ code: "custom", path: ["parkedWriteCheck"], message: "a parked-write check result belongs to its exact applied check command" });
  }
  if (!commandNoChangeResultMatches(request, audit.result)) context.addIssue({ code: "custom", path: ["result", "noChange"], message: "no-change result requires the exact empty notification collection request" });
  if ((audit.result.state === "applied" || audit.result.state === "already-applied") && audit.result.noChange !== undefined
    && (audit.versionChanges.length !== 0 || audit.affectedDependencyIds.length !== 0 || audit.writeResolution !== undefined)) {
    context.addIssue({ code: "custom", path: ["versionChanges"], message: "a no-change notification audit cannot record effects" });
  }
  const resolved = request.family === "run" && (request.type === "recheck-write" || request.type === "resolve-write-absent") && audit.result.state === "applied";
  if (!resolved) {
    if (audit.writeResolution !== undefined) context.addIssue({code:"custom",path:["writeResolution"],message:"resolution acknowledgement requires an applied resolution command"});
    return;
  }
  const intent = audit.writeResolution;
  if (request.type === "recheck-write") {
    if (intent?.status !== "parked" || intent.recheck?.commandId !== request.commandId
      || intent.recheck.auditId !== audit.auditId || intent.recheck.requestedAt !== audit.completedAt) {
      context.addIssue({ code: "custom", path: ["writeResolution"], message: "applied recheck requires its immutable request acknowledgement" });
    }
    return;
  }
  if (intent === undefined || (intent.status !== "committed" && intent.status !== "retryable") || intent.resolution === undefined
    || intent.resolution.commandId !== request.commandId || intent.resolution.auditId !== audit.auditId
    || intent.resolution.resolvedAt !== audit.completedAt) context.addIssue({code:"custom",path:["writeResolution"],message:"applied resolution requires its complete immutable settlement acknowledgement"});
});

/** Internal persistence for lifecycle idempotency, deliberately separate from the product command union: it cannot be submitted through the command kernel and carries no run input. */
export const RunLifecycleCommandOperationSchema = z.enum([
  "application-admission",
  "delegation-invocation",
  "delegation-admission",
  "delegation-settlement",
  "delegation-retry",
  "delegation-refresh",
  "create",
  "claim-next",
  "transition",
  "recover-crash",
  "renew-claim",
  "worker-transition",
  "pause",
  "resume",
  "acknowledge-pause",
  "terminalize",
  "requeue",
  "retry",
  "recover",
  "delete",
  "purge",
  "clear-history",
]);

export const RunLifecycleCommandFenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("version"), expectedVersion: PositiveIntSchema }),
  z.strictObject({
    kind: z.literal("claim"),
    workerId: WorkerIdSchema,
    claimGeneration: PositiveIntSchema,
  }),
  z.strictObject({
    kind: z.literal("terminal"),
    expectedVersion: PositiveIntSchema,
    workerId: WorkerIdSchema,
    claimGeneration: PositiveIntSchema,
  }),
]);

export const RunLifecycleCommandRecordSchema = z.strictObject({
  kind: z.literal("run-lifecycle"),
  commandId: CommandIdSchema,
  operation: RunLifecycleCommandOperationSchema,
  requestFingerprint: FingerprintSchema,
  request: JsonValueSchema,
  fence: RunLifecycleCommandFenceSchema,
  recordedAt: IsoInstantSchema,
});

export const RunLifecycleCommandResultIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("application"), runtimeGeneration: PositiveIntSchema }),
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema, appliedVersion: PositiveIntSchema,
    continuation: RunContinuationSchema.optional(),
    terminal: z.strictObject({ outcome: z.enum(["cancelled", "discarded", "superseded"]), endedAt: IsoInstantSchema }).optional(),
  }),
  z.strictObject({ kind: z.literal("deletion"), runIds: z.array(RunIdSchema).min(1) }),
  z.strictObject({ kind: z.literal("history-deletion"), runIds: z.array(RunIdSchema) }),
  z.strictObject({
    kind: z.literal("purge"),
    evidenceClass: z.string().min(1),
    purged: NonNegativeIntSchema,
  }),
]);

export const RunLifecycleCommandAuditRecordSchema = z.strictObject({
  kind: z.literal("run-lifecycle"),
  auditId: CommandAuditIdSchema,
  request: RunLifecycleCommandRecordSchema,
  result: RunLifecycleCommandResultIdentitySchema,
  completedAt: IsoInstantSchema,
});

export const AuthorityCommandRecordSchema = z.union([
  CommandRequestSchema,
  RunLifecycleCommandRecordSchema,
]);

export const AuthorityCommandAuditRecordSchema = z.union([
  CommandAuditRecordSchema,
  RunLifecycleCommandAuditRecordSchema,
]);

export const BulkRunCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("run"),
  type: z.enum(["retry", "pause", "resume", "cancel", "bump"]),
  bulkCommandId: CommandIdSchema,
  targets: z.array(RunVersionTargetSchema).min(1),
  mode: z.literal("best-effort"),
});

/** Exact accepted parent identity for ordered N-child replay. */
export function deriveBulkRunCommandFingerprint(input: unknown): string {
  const parsed = BulkRunCommandRequestSchema.parse(input);
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:bulk-run-command:v1\0${canonicalJsonStringify(parsed)}`,
  ));
}

export const BulkRunCommandAcceptanceRecordSchema = z.strictObject({
  bulkCommandId: CommandIdSchema,
  requestFingerprint: FingerprintSchema,
  request: BulkRunCommandRequestSchema,
}).superRefine((record, context) => {
  if (record.request.bulkCommandId !== record.bulkCommandId) {
    context.addIssue({
      code: "custom",
      path: ["request", "bulkCommandId"],
      message: "accepted bulk request must carry the record's bulk command id",
    });
  }
  if (record.request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || record.request.source !== "dashboard") {
    context.addIssue({
      code: "custom",
      path: ["request"],
      message: "accepted bulk request provenance must be owned by the dashboard operator ingress",
    });
  }
  if (deriveBulkRunCommandFingerprint(record.request) !== record.requestFingerprint) {
    context.addIssue({
      code: "custom",
      path: ["requestFingerprint"],
      message: "accepted bulk request fingerprint must bind its exact canonical envelope",
    });
  }
});

/** Stored acceptance only; never an executable command or lifecycle record. */
export const BulkParentCommandRecordSchema = z.strictObject({
  kind: z.literal("bulk-parent"),
  commandId: CommandIdSchema,
  acceptance: BulkRunCommandAcceptanceRecordSchema,
}).superRefine((record, context) => {
  if (record.commandId !== record.acceptance.bulkCommandId) {
    context.addIssue({ code: "custom", message: "bulk parent command identity must match acceptance" });
  }
});

export const StoredAuthorityCommandRecordSchema = z.union([
  AuthorityCommandRecordSchema,
  BulkParentCommandRecordSchema,
]);

// Keep structured child errors distinct from refusals; an errored child leaves later targets unattempted.
export const BulkRunCommandOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("applied"),
    runId: RunIdSchema,
    /** the CHILD command's own id — derived, so a re-delivered bulk replays it */
    commandId: CommandIdSchema,
    /** true when the child was already journaled and the kernel replayed it */
    replayed: z.boolean(),
    detail: z.string().min(1),
    workerStartup: RunWorkerStartupFailureSchema.optional(),
  }),
  z.strictObject({
    outcome: z.literal("conflict"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    /** Mirrors the single-command conflict shape; a run target never answers 0. */
    currentVersion: NonNegativeIntSchema,
    detail: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("refused"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    code: CommandRejectionCodeSchema,
    detail: z.string().min(1),
  }),
  z.strictObject({
    outcome: z.literal("errored"),
    runId: RunIdSchema,
    commandId: CommandIdSchema,
    detail: z.string().min(1),
  }),
]);

/** The bulk response; `requestedCount` is on the wire rather than derived, precisely so a stopped run is legible as a remainder that was NOT attempted. */
export const BulkRunCommandResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("vector"),
    bulkCommandId: CommandIdSchema,
    type: z.enum(["retry", "pause", "resume", "cancel", "bump"]),
    requestedCount: PositiveIntSchema,
    results: z.array(BulkRunCommandOutcomeSchema).min(1),
  }),
  z.strictObject({
    state: z.literal("refused"),
    code: CommandRejectionCodeSchema,
    message: z.string().min(1),
  }),
]);

export const CommandEffectClassSchema = z.enum([
  "read",
  "local-write",
  "destructive",
  "external-submit",
]);
export type CommandEffectClass = z.infer<typeof CommandEffectClassSchema>;

// destructive and external-submit both ask before submits, so neither is a weaker label.
const COMMAND_EFFECT_STRENGTH = {
  read: 0,
  "local-write": 1,
  destructive: 2,
  "external-submit": 2,
} as const satisfies Record<CommandEffectClass, number>;

export function commandEffectIsWeaker(stated: CommandEffectClass, actual: CommandEffectClass): boolean {
  return COMMAND_EFFECT_STRENGTH[stated] < COMMAND_EFFECT_STRENGTH[actual];
}

export const COMMAND_EFFECT_BY_ACTION = {
  "add-ocr-record": "local-write", "correct-ocr-record": "local-write", "discard-ocr-record": "local-write", "restore-ocr-record": "local-write",
  "pause-all": "local-write",
  "pause-all-and-quit": "destructive",
  "check-parked-write": "local-write",
  "set-assistant-model-preference": "local-write",
  "annotate-failure": "local-write",
  "set-batch-grouping": "local-write",
  "start-run": "external-submit",
  "inspect-intake": "local-write",
  "confirm-intake-mapping": "local-write",
  "correct-intake-row": "local-write",
  "exclude-intake-row": "local-write",
  "validate-intake": "local-write",
  "enqueue-intake-manifest": "external-submit",
  "plan-worker-count": "destructive",
  "spawn-worker": "external-submit",
  "stop-worker": "destructive",
  "remove-worker": "destructive",
  "retry-worker": "external-submit",
  "pause-worker": "local-write",
  "resume-worker": "external-submit",
  "refresh-browser": "local-write",
  "reopen-browser": "local-write",
  "apply-settings": "local-write",
  "apply-protected-settings": "destructive",
  pause: "local-write",
  resume: "external-submit",
  retry: "external-submit",
  "recover-run": "external-submit",
  cancel: "destructive",
  bump: "local-write",
  rename: "local-write",
  delete: "destructive",
  "recheck-write": "external-submit",
  "resolve-write-absent": "external-submit",
  "resolve-workbook-row": "local-write",
  "resolve-workbook-reference-row": "external-submit",
  "resolve-gate": "external-submit",
  "notification-read": "local-write",
  "notification-unread": "local-write",
  "notification-snooze": "local-write",
  "notification-unsnooze": "local-write",
  "notification-read-all": "local-write", "notification-unread-all": "local-write", "notification-snooze-all": "local-write", "notification-unsnooze-all": "local-write",
} as const satisfies Record<z.infer<typeof CommandActionSchema>, CommandEffectClass>;

export const COMMAND_ASSISTANT_METADATA = {
  "add-ocr-record": "Add an operator-authored OCR review record", "correct-ocr-record": "Correct a retained OCR review record", "discard-ocr-record": "Discard an OCR review record", "restore-ocr-record": "Restore a discarded OCR review record",
  "pause-all": "Pause current work",
  "pause-all-and-quit": "Pause current work and quit after explicit confirmation",
  "check-parked-write": "Read target state while keeping an uncertain write held",
  "set-assistant-model-preference": "Persist the selected profile model preference",
  "annotate-failure": "Resolve a recorded failure",
  "set-batch-grouping": "Change queue grouping",
  "start-run": "Start an approved workflow plan",
  "inspect-intake": "Inspect an imported document",
  "confirm-intake-mapping": "Confirm document mapping",
  "correct-intake-row": "Correct an imported row",
  "exclude-intake-row": "Exclude an imported row",
  "validate-intake": "Validate imported data",
  "enqueue-intake-manifest": "Queue validated imported data",
  "plan-worker-count": "Plan worker capacity",
  "spawn-worker": "Start an owned worker",
  "stop-worker": "Stop an owned worker",
  "remove-worker": "Remove a stopped worker",
  "retry-worker": "Retry an eligible worker",
  "pause-worker": "Pause an owned worker",
  "resume-worker": "Resume an owned worker",
  "refresh-browser": "Refresh an owned browser",
  "reopen-browser": "Reopen an owned browser",
  "apply-settings": "Save ordinary settings",
  "apply-protected-settings": "Save protected settings through operator entry",
  pause: "Pause a run after its current step",
  resume: "Continue a paused run",
  retry: "Resume an eligible run",
  "recover-run": "Recover authenticated completed steps from a failed or interrupted run",
  cancel: "Cancel an eligible run",
  bump: "Change run priority",
  rename: "Rename a run",
  delete: "Delete a terminal run",
  "recheck-write": "Check a parked write again",
  "resolve-write-absent": "Resolve a write with verified absence",
  "resolve-workbook-row": "Choose a live row for a held workbook change",
  "resolve-workbook-reference-row": "Choose a live reference row for a held run",
  "resolve-gate": "Resolve an operator gate",
  "notification-read": "Mark a notification read",
  "notification-unread": "Mark a notification unread",
  "notification-snooze": "Snooze a notification",
  "notification-unsnooze": "Unsnooze a notification",
  "notification-read-all": "Mark current unread notifications read",
  "notification-unread-all": "Mark current read notifications unread",
  "notification-snooze-all": "Snooze current notifications",
  "notification-unsnooze-all": "Unsnooze current notifications",
} as const satisfies Record<z.infer<typeof CommandActionSchema>, string>;

export const CommandFamilySpecSchema = z.strictObject({
  family: CommandFamilySchema,
  actions: z.array(CommandActionSchema).min(1),
  effects: z.array(CommandEffectClassSchema).min(1),
}).superRefine((spec, context) => {
  if (spec.effects.length !== spec.actions.length) {
    context.addIssue({ code: "custom", message: "each command action needs one effect class" });
  }
});

const COMMAND_ACTIONS_BY_FAMILY = {
  "ocr-review": ["correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record"],
  application: ["pause-all", "pause-all-and-quit"],
  "assistant-model-preference": ["set-assistant-model-preference"],
  "failure-resolution": ["annotate-failure"],
  "workflow-batch": ["set-batch-grouping"],
  start: ["start-run"],
  intake: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"],
  "worker-browser": ["plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser", "check-parked-write"],
  settings: ["apply-settings", "apply-protected-settings"],
  run: ["retry", "recover-run", "pause", "resume", "cancel", "bump", "rename", "delete", "recheck-write", "resolve-write-absent", "resolve-workbook-row", "resolve-workbook-reference-row"],
  gate: ["resolve-gate"],
  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"],
} as const satisfies Record<z.infer<typeof CommandFamilySchema>, readonly z.infer<typeof CommandActionSchema>[]>;

export const CommandFamilyRegistrySchema = z.array(CommandFamilySpecSchema).superRefine((entries, context) => {
  const families = entries.map(({ family }) => family);
  if (new Set(families).size !== families.length) {
    context.addIssue({ code: "custom", message: "command family registry families must be unique" });
  }
  for (const family of CommandFamilySchema.options) {
    const entry = entries.find((candidate) => candidate.family === family);
    if (entry === undefined) {
      context.addIssue({ code: "custom", message: `command family registry omits ${family}` });
      continue;
    }
    const expected = COMMAND_ACTIONS_BY_FAMILY[family];
    if (entry.actions.length !== expected.length || expected.some((action) => !entry.actions.includes(action))) {
      context.addIssue({ code: "custom", path: [entries.indexOf(entry), "actions"], message: `${family} command actions do not match the registered family` });
    }
    entry.actions.forEach((action, index) => {
      if (entry.effects[index] !== COMMAND_EFFECT_BY_ACTION[action]) {
        context.addIssue({ code: "custom", path: [entries.indexOf(entry), "effects", index], message: `${action} effect class does not match the canonical effect` });
      }
    });
  }
  const covered = entries.flatMap((entry) => entry.actions);
  if (covered.length !== CommandActionSchema.options.length
    || CommandActionSchema.options.some((action) => !covered.includes(action))) {
    context.addIssue({ code: "custom", message: "command family registry must include every action" });
  }
});

export const COMMAND_FAMILY_REGISTRY = deepFreeze(CommandFamilyRegistrySchema.parse([
  { family: "ocr-review", actions: ["correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record"] },
  { family: "application", actions: ["pause-all", "pause-all-and-quit"] },
  { family: "assistant-model-preference", actions: ["set-assistant-model-preference"] },
  { family: "failure-resolution", actions: ["annotate-failure"] },
  { family: "workflow-batch", actions: ["set-batch-grouping"] },
  { family: "start", actions: ["start-run"] },
  { family: "intake", actions: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"] },
  { family: "worker-browser", actions: ["plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser", "check-parked-write"] },
  { family: "settings", actions: ["apply-settings", "apply-protected-settings"] },
  { family: "run", actions: ["retry", "recover-run", "pause", "resume", "cancel", "bump", "rename", "delete", "recheck-write", "resolve-write-absent", "resolve-workbook-row", "resolve-workbook-reference-row"] },
  { family: "gate", actions: ["resolve-gate"] },
  { family: "notification", actions: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"] },
].map((entry) => ({
  ...entry,
  effects: entry.actions.map((action) => COMMAND_EFFECT_BY_ACTION[CommandActionSchema.parse(action)]),
}))));

/** Run actions the assistant proposes through its own confirmed card. */
const assistantRunAction = (family: string, action: string) => family === "run" && (action === "pause" || action === "resume" || action === "cancel");

export function commandAssistantAvailability(isActive: (family: string, action: string) => boolean) {
  return COMMAND_FAMILY_REGISTRY.flatMap(family => family.actions.map(action => {
    const active = isActive(family.family, action);
    return {
      family: family.family, action, summary: COMMAND_ASSISTANT_METADATA[action], classification: COMMAND_EFFECT_BY_ACTION[action],
    availability: !active ? "unavailable" as const
      : family.family === "notification" || assistantRunAction(family.family, action) ? "available" as const : "handoff" as const,
    argumentProjection: family.family === "notification" ? ["reference"] : [],
    subject: family.family === "notification" || family.family === "workflow-batch" || family.family === "settings" || family.family === "worker-browser"
      ? "none" as const : "unbound" as const,
    reason: !active ? "owner-unavailable" as const
      : family.family === "notification" || assistantRunAction(family.family, action) ? "canonical-command" as const : "operator-interface-required" as const,
    };
  }));
}

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
/** What the dashboard may send to `/api/v1/commands`: a kernel command, or an identity answer ingress resolves into one. */
export const DashboardCommandRequestSchema = z.union([CommandRequestSchema, IdentityGateAnswerRequestSchema]);
export type DashboardCommandRequest = z.infer<typeof DashboardCommandRequestSchema>;
/** Start, or a run command that leaves work queued for a worker of its workflow; only these may carry workerStartup. */
export type CapacityRequest = Extract<CommandRequest, { family: "start" } | { family: "run" }>;
const QUEUEING_RUN_TYPES: ReadonlySet<string> = new Set(["resume", "retry", "recover-run"]);
export function needsWorkerCapacity(request: DashboardCommandRequest): request is CapacityRequest {
  return request.family === "start" || request.family === "run" && QUEUEING_RUN_TYPES.has(request.type);
}
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type CommandAuditRecord = z.infer<typeof CommandAuditRecordSchema>;
export type RunDisplayName = z.infer<typeof RunDisplayNameSchema>;
export type BulkRunCommandRequest = z.infer<typeof BulkRunCommandRequestSchema>;
export type BulkRunCommandAcceptanceRecord = z.infer<typeof BulkRunCommandAcceptanceRecordSchema>;
export type BulkRunCommandOutcome = z.infer<typeof BulkRunCommandOutcomeSchema>;
export type BulkRunCommandResponse = z.infer<typeof BulkRunCommandResponseSchema>;

// A dry enqueue still journals local runs.
export function commandEffectClass(command: CommandRequest): CommandEffectClass {
  const declared = COMMAND_EFFECT_BY_ACTION[command.type];
  if (command.type === "enqueue-intake-manifest" && command.payload.dryRun && commandEffectIsWeaker("local-write", declared)) {
    return "local-write";
  }
  return declared;
}
