import { AssistantModelPreferenceSchema } from "../../models/dashboard/assistant.js";
import { NotificationCollectionTargetSchema } from "../../models/notifications/notifications.js";
import { AssistantPermissionModeSchema } from "../../models/profiles/assistant-permission-mode.js";
import { RunDisplayNameSchema } from "../../models/run/display-name.js";
export { RunDisplayNameSchema } from "../../models/run/display-name.js";
import { WorkerSlotRecordSchema } from "../../models/run/worker-slot.js";
import { WriteIntentRecordSchema } from "../write-safety/write-safety.js";
import { WorkerControlBasisSchema } from "../../models/run/worker.js";
import { FailureResolutionTargetSchema, FailureResolutionActionSchema } from "../../models/trust/failure-resolution.js";
import { z } from "zod";

import { JsonValueSchema, canonicalJsonStringify } from "../validation/canonical-json.js";
import { SettingsLeafOperationSchema, SettingsPatchSchema } from "../../models/config/settings.js";
import { MarkedProtectedSettingsPatchSchema, ProtectedSettingsPatchSchema, ProtectedSettingsReadbackSchema, markProtectedSettingsPatch } from "../../models/config/protected-settings.js";
import { deepFreeze } from "../validation/immutability.js";
import { ActorIdSchema, BrowserSessionIdSchema, CommandAuditIdSchema, CommandIdSchema, DependencyIdSchema, FingerprintSchema, GateIdSchema, IntakeSessionIdSchema, IntakeManifestIdSchema, IntakeTargetFieldIdSchema, IsoInstantSchema, LOCAL_OPERATOR_ACTOR_ID, NotificationIdSchema, NonNegativeIntSchema, PositiveIntSchema, RunIdSchema, RunSessionIdSchema, SourceColumnIdSchema, SourceSurfaceIdSchema, StartPlanIdSchema, WorkerIdSchema, WorkflowIdSchema, WriteIntentIdSchema, WriteAttemptIdSchema } from "../identity/ids.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../validation/sha256.js";
import { ExplorerEditApplyRequestSchema } from "../../models/dashboard/explorer.js";

/** A durable command identity cannot be reused by another command or authority. */
export class CommandIdentityConflictError extends Error {
  constructor(message = "command-divergent: command identity belongs to a different command") {
    super(message);
    this.name = "CommandIdentityConflictError";
  }
}

export const CommandFamilySchema = z.enum([
  "assistant-model-preference",
  "failure-resolution",
  "workflow-batch",
  "start",
  "intake",
  "worker-browser",
  "settings",
  "storage-relocation",
  "run",
  "gate",
  "notification",
  "explorer",
]);

export const CommandActionSchema = z.enum([
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
  "plan-storage-relocation",
  "cancel-storage-relocation",
  "retry",
  "restart",
  "cancel",
  "bump",
  "rename",
  "delete",
  "recheck-write",
  "resolve-write-absent",
  "resolve-gate",
  "notification-read",
  "notification-unread",
  "notification-snooze",
  "notification-unsnooze",
  "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all",
  "apply-explorer-edit",
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

const WorkerVersionTargetSchema = z.strictObject({
  workerId: WorkerIdSchema,
  expectedVersion: PositiveIntSchema,
  controlBasis: WorkerControlBasisSchema.optional(),
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

export const LiveWorkerResetRequestSchema = z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("stop-worker"),
  target: WorkerVersionTargetSchema.extend({ expectedVersion: PositiveIntSchema.optional(), membershipRevision: PositiveIntSchema, controlBasis: WorkerControlBasisSchema }) });

const WorkerMemberControlTargetSchema = z.strictObject({ workerId: WorkerIdSchema, workflowId: WorkflowIdSchema,
  membershipRevision: PositiveIntSchema, controlBasis: WorkerControlBasisSchema, expectedVersion: NonNegativeIntSchema });

export const WorkerBrowserCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["remove-worker", "retry-worker"]), target: WorkerMemberControlTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("stop-worker"), target: WorkerVersionTargetSchema.extend({ expectedVersion: PositiveIntSchema.optional(), membershipRevision: PositiveIntSchema.optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("plan-worker-count"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ desiredWorkers: z.number().int().min(0) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("spawn-worker"), target: WorkerPoolVersionTargetSchema, payload: z.strictObject({ workerId: WorkerIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["pause-worker", "resume-worker"]), target: WorkerVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["refresh-browser", "reopen-browser"]), target: z.strictObject({ workerId: WorkerIdSchema, browserSessionId: BrowserSessionIdSchema, expectedVersion: PositiveIntSchema, controlBasis: WorkerControlBasisSchema.optional() }) }),
]);

export const AssistantModelPreferenceCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields, family: z.literal("assistant-model-preference"), type: z.literal("set-assistant-model-preference"),
  target: z.strictObject({ profileId: z.uuid(), epoch: z.number().int().nonnegative(), expectedRevision: NonNegativeIntSchema }),
  payload: AssistantModelPreferenceSchema,
});

export const AssistantPermissionChangeSchema = z.strictObject({
  expectedPolicyRevision: NonNegativeIntSchema, mode: AssistantPermissionModeSchema,
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
    assistantPermission: AssistantPermissionChangeSchema.optional(),
  }).superRefine((payload, context) => {
    if (payload.assistantPermission !== undefined) {
      if (Object.keys(payload.patch).length !== 0) context.addIssue({ code: "custom", path: ["patch"], message: "permission command requires an empty ordinary patch" });
      return;
    }
    const ordinary = SettingsPatchSchema.safeParse(payload.patch);
    if (!ordinary.success) for (const issue of ordinary.error.issues) context.addIssue({ ...issue, path: ["patch", ...issue.path] });
  }),
});

export const StorageRelocationPairSchema = z.strictObject({
  stateRoot: z.string().min(1),
  artifactRoot: z.string().min(1),
});
const StorageRelocationTargetSchema = z.strictObject({
  installationId: z.uuid(),
  sourceGeneration: NonNegativeIntSchema,
  sourcePair: StorageRelocationPairSchema,
  expectedRevision: NonNegativeIntSchema,
});
const StorageRelocationPlanFields = {
  ...CommandEnvelopeFields,
  family: z.literal("storage-relocation"),
  type: z.literal("plan-storage-relocation"),
  target: StorageRelocationTargetSchema,
  payload: z.strictObject({
    writeId: z.uuid(),
    desiredPair: StorageRelocationPairSchema,
    desiredDigest: FingerprintSchema,
    requestFingerprint: FingerprintSchema,
  }),
};
const StorageRelocationCancelFields = {
  ...CommandEnvelopeFields,
  family: z.literal("storage-relocation"),
  type: z.literal("cancel-storage-relocation"),
  target: StorageRelocationTargetSchema,
  payload: z.strictObject({
    writeId: z.uuid(),
    cancelledPlanCommandId: CommandIdSchema,
    cancelledPlanDigest: FingerprintSchema,
    requestFingerprint: FingerprintSchema,
  }),
};
export const StorageRelocationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject(StorageRelocationPlanFields),
  z.strictObject(StorageRelocationCancelFields),
]);
export type StorageRelocationCommandRequest = z.infer<typeof StorageRelocationCommandRequestSchema>;
export const StorageRelocationPlanViewSchema = z.strictObject({
  revision: NonNegativeIntSchema,
  installationId: z.uuid(),
  sourceGeneration: NonNegativeIntSchema,
  sourcePair: StorageRelocationPairSchema,
  pending: z.strictObject({
    commandId: CommandIdSchema,
    writeId: z.uuid(),
    desiredPair: StorageRelocationPairSchema,
    desiredDigest: FingerprintSchema,
    requestFingerprint: FingerprintSchema,
  }).nullable(),
});
export type StorageRelocationPlanView = z.infer<typeof StorageRelocationPlanViewSchema>;

export function storageRelocationDesiredDigest(
  target: StorageRelocationCommandRequest["target"],
  desiredPair: z.infer<typeof StorageRelocationPairSchema>,
): string {
  return sha256Hex(`hrauto:storage-relocation-desired:v1\0${canonicalJsonStringify({
    installationId: target.installationId,
    sourceGeneration: target.sourceGeneration,
    sourcePair: target.sourcePair,
    desiredPair,
  })}`);
}

export function storageRelocationRequestFingerprint(request: StorageRelocationCommandRequest): string {
  const { requestFingerprint: _fingerprint, ...payload } = request.payload;
  const { requestedAt: _requestedAt, requestedBy: _requestedBy, source: _source, ...intent } = request;
  return sha256Hex(`hrauto:storage-relocation-command:v1\0${canonicalJsonStringify({ ...intent, payload })}`);
}

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

export const RunCommandRequestSchema = z.discriminatedUnion("type", [
  /** `retry` is Resume from checkpoints and `restart` is Restart from start: both mint the item's next attempt. */
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.enum(["retry", "restart", "cancel", "bump"]), target: RunVersionTargetSchema }),
  /** Delete means delete: a terminal queue run and every row it owns leave authority. */
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("delete"), target: RunVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("rename"), target: RunVersionTargetSchema, payload: z.strictObject({ displayName: RunDisplayNameSchema }) }),
    // Field-level patch model; an entry edits one field, never a whole checkpoint blob.
  // blob payload was a deferred-arm placeholder no producer ever sent.
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("recheck-write"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema, writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema }), payload: z.strictObject({ occurrenceKeyDigest: FingerprintSchema, transactionId: z.string().regex(/^T\d+$/u).optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-absent"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema, writeAttemptId: WriteAttemptIdSchema, bindingProofDigest: FingerprintSchema }), payload: z.strictObject({ occurrenceKeyDigest: FingerprintSchema }) }),
]);

export const GateCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("gate"),
  type: z.literal("resolve-gate"),
  target: z.strictObject({ runId: RunIdSchema, gateId: GateIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ result: SchemaBoundCanonicalValueSchema }),
});

export const NotificationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"]), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"]), target: NotificationCollectionTargetSchema }),
]);

/** The sole durable Explorer edit door; validation remains a read-only route. */
export const ExplorerCommandRequestSchema = ExplorerEditApplyRequestSchema;

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
  AssistantModelPreferenceCommandRequestSchema,
  FailureResolutionCommandSchema,
  WorkflowBatchCommandRequestSchema,
  StartCommandRequestSchema,
  IntakeCommandRequestSchema,
  WorkerBrowserCommandRequestSchema,
  SettingsCommandRequestSchema,
  StorageRelocationCommandRequestSchema,
  ProtectedSettingsCommandRequestSchema,
  MarkedProtectedSettingsCommandRequestSchema,
  RunCommandRequestSchema,
  GateCommandRequestSchema,
  NotificationCommandRequestSchema,
  ExplorerCommandRequestSchema,
]);

export const CommandTargetReferenceSchema = z.discriminatedUnion("family", [
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
  z.strictObject({ family: z.literal("storage-relocation"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("protected-settings"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ family: z.literal("gate"), runId: RunIdSchema, gateId: GateIdSchema }),
  z.strictObject({ family: z.literal("notification"), notificationId: NotificationIdSchema }),
  z.strictObject({ family: z.literal("explorer"), workflowId: WorkflowIdSchema, revision: PositiveIntSchema }),
]);

export const CommandRejectionCodeSchema = z.enum([
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
]);

const CommandLandingResultSchema = z.strictObject({
  state: z.enum(["applied", "already-applied"]),
  commandId: CommandIdSchema,
  affectedTargets: z.array(CommandTargetReferenceSchema),
  noChange: z.literal("no-matching-notifications").optional(),
  restartRequired: z.boolean().optional(),
  settingsRevision: PositiveIntSchema.optional(),
  settingsFingerprint: FingerprintSchema.optional(),
  revision: PositiveIntSchema.optional(),
  entries: ProtectedSettingsReadbackSchema.shape.entries.optional(),
}).superRefine((result, context) => {
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

export function commandNoChangeResultMatches(request: CommandRequest, result: CommandResult): boolean {
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
}).superRefine((audit, context) => {
  if (audit.result.state === "pending") context.addIssue({ code: "custom", path: ["result"], message: "pending-command-cannot-have-terminal-audit" });
  const request = audit.request;
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
  "delegation-invocation",
  "delegation-admission",
  "delegation-settlement",
  "delegation-retry",
  "create",
  "claim-next",
  "transition",
  "renew-claim",
  "worker-transition",
  "worker-admission",
  "worker-lifetime-birth",
  "worker-standing-recovery",
  "worker-verification-admission",
  "worker-verification-retirement",
  "terminalize",
  "requeue",
  "retry",
  "restart",
  "delete",
  "purge",
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
  z.strictObject({ kind: z.literal("worker-recovery"), workerId: WorkerIdSchema, oldLeaseGeneration: PositiveIntSchema,
    leaseGeneration: PositiveIntSchema, phase: z.enum(["idle", "paused"]), settledAt: IsoInstantSchema }),
  z.strictObject({ kind: z.literal("worker-birth"), workerId: WorkerIdSchema, leaseGeneration: PositiveIntSchema }),
  z.strictObject({ kind: z.literal("worker"), slot: WorkerSlotRecordSchema,
    beforePoolVersion: NonNegativeIntSchema, afterPoolVersion: PositiveIntSchema }),
  z.strictObject({ kind: z.literal("run"), runId: RunIdSchema, appliedVersion: PositiveIntSchema,
    terminal: z.strictObject({ outcome: z.enum(["cancelled", "discarded", "superseded"]), endedAt: IsoInstantSchema }).optional(),
  }),
  z.strictObject({ kind: z.literal("deletion"), runIds: z.array(RunIdSchema).min(1) }),
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
  type: z.enum(["retry", "cancel", "bump"]),
  bulkCommandId: CommandIdSchema,
  targets: z.array(RunVersionTargetSchema).min(1),
  mode: z.enum(["all-or-none", "best-effort"]),
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
    type: z.enum(["retry", "cancel", "bump"]),
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
  "plan-storage-relocation": "local-write",
  "cancel-storage-relocation": "local-write",
  retry: "external-submit",
  restart: "external-submit",
  cancel: "destructive",
  bump: "local-write",
  rename: "local-write",
  delete: "destructive",
  "recheck-write": "external-submit",
  "resolve-write-absent": "external-submit",
  "resolve-gate": "external-submit",
  "notification-read": "local-write",
  "notification-unread": "local-write",
  "notification-snooze": "local-write",
  "notification-unsnooze": "local-write",
  "notification-read-all": "local-write", "notification-unread-all": "local-write", "notification-snooze-all": "local-write", "notification-unsnooze-all": "local-write",
  "apply-explorer-edit": "local-write",
} as const satisfies Record<z.infer<typeof CommandActionSchema>, CommandEffectClass>;

export const COMMAND_ASSISTANT_METADATA = {
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
  "plan-storage-relocation": "Plan storage relocation",
  "cancel-storage-relocation": "Cancel storage relocation",
  retry: "Resume an eligible run",
  restart: "Restart an eligible run",
  cancel: "Cancel an eligible run",
  bump: "Change run priority",
  rename: "Rename a run",
  delete: "Delete a terminal run",
  "recheck-write": "Check a parked write again",
  "resolve-write-absent": "Resolve a write with verified absence",
  "resolve-gate": "Resolve an operator gate",
  "notification-read": "Mark a notification read",
  "notification-unread": "Mark a notification unread",
  "notification-snooze": "Snooze a notification",
  "notification-unsnooze": "Unsnooze a notification",
  "notification-read-all": "Mark current unread notifications read",
  "notification-unread-all": "Mark current read notifications unread",
  "notification-snooze-all": "Snooze current notifications",
  "notification-unsnooze-all": "Unsnooze current notifications",
  "apply-explorer-edit": "Apply a schema-bound Explorer edit",
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
  "assistant-model-preference": ["set-assistant-model-preference"],
  "failure-resolution": ["annotate-failure"],
  "workflow-batch": ["set-batch-grouping"],
  start: ["start-run"],
  intake: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"],
  "worker-browser": ["plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"],
  settings: ["apply-settings", "apply-protected-settings"],
  "storage-relocation": ["plan-storage-relocation", "cancel-storage-relocation"],
  run: ["retry", "restart", "cancel", "bump", "rename", "delete", "recheck-write", "resolve-write-absent"],
  gate: ["resolve-gate"],
  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"],
  explorer: ["apply-explorer-edit"],
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
  { family: "assistant-model-preference", actions: ["set-assistant-model-preference"] },
  { family: "failure-resolution", actions: ["annotate-failure"] },
  { family: "workflow-batch", actions: ["set-batch-grouping"] },
  { family: "start", actions: ["start-run"] },
  { family: "intake", actions: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"] },
  { family: "worker-browser", actions: ["plan-worker-count", "spawn-worker", "stop-worker", "remove-worker", "retry-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"] },
  { family: "settings", actions: ["apply-settings", "apply-protected-settings"] },
  { family: "storage-relocation", actions: ["plan-storage-relocation", "cancel-storage-relocation"] },
  { family: "run", actions: ["retry", "restart", "cancel", "bump", "rename", "delete", "recheck-write", "resolve-write-absent"] },
  { family: "gate", actions: ["resolve-gate"] },
  { family: "notification", actions: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all"] },
  { family: "explorer", actions: ["apply-explorer-edit"] },
].map((entry) => ({
  ...entry,
  effects: entry.actions.map((action) => COMMAND_EFFECT_BY_ACTION[CommandActionSchema.parse(action)]),
}))));

export function commandAssistantAvailability(isActive: (family: string, action: string) => boolean) {
  return COMMAND_FAMILY_REGISTRY.flatMap(family => family.actions.map(action => {
    const active = isActive(family.family, action);
    return {
      family: family.family, action, summary: COMMAND_ASSISTANT_METADATA[action], classification: COMMAND_EFFECT_BY_ACTION[action],
    availability: !active ? "unavailable" as const
      : family.family === "notification" ? "available" as const : "handoff" as const,
    argumentProjection: family.family === "notification" ? ["reference"] : [],
    subject: family.family === "notification" || family.family === "workflow-batch" || family.family === "settings" || family.family === "worker-browser"
      ? "none" as const : "unbound" as const,
    reason: !active ? "owner-unavailable" as const
      : family.family === "notification" ? "canonical-command" as const : "operator-interface-required" as const,
    };
  }));
}

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
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
