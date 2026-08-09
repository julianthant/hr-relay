import { z } from "zod";
import { SettingsOverrideSchema } from "./config/schema.js";
import { deepFreeze } from "./immutability.js";
import {
  ActorIdSchema,
  BrowserSessionIdSchema,
  CapturePhotoIdSchema,
  CaptureSessionIdSchema,
  CommandAuditIdSchema,
  CommandIdSchema,
  DependencyIdSchema,
  FingerprintSchema,
  GateIdSchema,
  IntakeManifestIdSchema,
  IntakeSessionIdSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  NotificationIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  SourceColumnIdSchema,
  SourceSurfaceIdSchema,
  StartPlanIdSchema,
  VersionPlanIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  WriteIntentIdSchema,
} from "./ids.js";
import { ArtifactRefSchema } from "./artifacts.js";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";
import { CheckpointPatchSchema } from "./workflow/checkpoint.js";

export const CommandFamilySchema = z.enum([
  "start",
  "intake",
  "worker-browser",
  "settings",
  "version-archive",
  "run",
  "gate",
  "notification",
  "capture",
]);

export const CommandActionSchema = z.enum([
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
  "pause-worker",
  "resume-worker",
  "refresh-browser",
  "reopen-browser",
  "apply-settings",
  "plan-version-bump",
  "apply-version-bump",
  "relaunch-archived-run",
  "retry",
  "cancel",
  "bump",
  "rename",
  "hide",
  "unhide",
  "edit-checkpoint",
  "resolve-write-present",
  "resolve-write-absent",
  "resolve-gate",
  "notification-read",
  "notification-unread",
  "notification-snooze",
  "capture-upload",
  "capture-replace",
  "capture-reorder",
  "capture-delete",
  "capture-finalize",
  "capture-retry-finalize",
  "capture-discard",
]);

export const OperatorReasonSchema = z.string().min(1).max(500).refine(
  (value) => value.trim() === value,
  "operator reason must already be trimmed",
);

export const RunDisplayNameSchema = z.string().superRefine((value, context) => {
  if (value.trim() !== value) {
    context.addIssue({ code: "custom", message: "run display name must already be trimmed" });
  }
  if (value.normalize("NFC") !== value) {
    context.addIssue({ code: "custom", message: "run display name must be NFC-normalized" });
  }
  const codePoints = [...value].length;
  if (codePoints < 1 || codePoints > 120) {
    context.addIssue({ code: "custom", message: "run display name must contain 1 to 120 Unicode code points" });
  }
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({ code: "custom", message: "run display name cannot contain control characters" });
  }
});

const SemverSchema = z.string().regex(
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

const WorkerVersionTargetSchema = z.strictObject({
  workerId: WorkerIdSchema,
  expectedVersion: PositiveIntSchema,
});

const CaptureVersionTargetSchema = z.strictObject({
  captureSessionId: CaptureSessionIdSchema,
  expectedVersion: PositiveIntSchema,
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

// D170: the five non-enqueue intake payloads carry what doc 06 §2.2's flow
// actually sends. The old shapes named an artifact and two fingerprints the
// session itself now holds, and a `rowId` for something that has no item
// identity until it validates — they were deferred-arm placeholders no producer
// ever sent, so they are amended rather than migrated (D161/D167's rule).
// The artifact rides the SESSION, which the upload route creates.
export const IntakeCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("inspect-intake"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sheet: z.string().min(1).optional(), headerRowIndex: z.number().int().nonnegative().optional() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("confirm-intake-mapping"), target: IntakeVersionTargetSchema, payload: z.strictObject({ targetFieldId: IntakeTargetFieldIdSchema, sourceColumnId: SourceColumnIdSchema, headerFingerprint: FingerprintSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("correct-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, field: IntakeTargetFieldIdSchema, correctedValue: z.string() }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("exclude-intake-row"), target: IntakeVersionTargetSchema, payload: z.strictObject({ sourceRow: PositiveIntSchema, reason: OperatorReasonSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("validate-intake"), target: IntakeVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("intake"), type: z.literal("enqueue-intake-manifest"), target: z.strictObject({ intakeManifestId: IntakeManifestIdSchema, expectedVersion: PositiveIntSchema }) }),
]);

export const WorkerBrowserCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("plan-worker-count"), target: z.strictObject({ workflowId: WorkflowIdSchema, expectedVersion: PositiveIntSchema }), payload: z.strictObject({ desiredWorkers: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.literal("spawn-worker"), target: z.strictObject({ workflowId: WorkflowIdSchema, expectedVersion: PositiveIntSchema }), payload: z.strictObject({ workerId: WorkerIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["stop-worker", "pause-worker", "resume-worker"]), target: WorkerVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("worker-browser"), type: z.enum(["refresh-browser", "reopen-browser"]), target: z.strictObject({ workerId: WorkerIdSchema, browserSessionId: BrowserSessionIdSchema, expectedVersion: PositiveIntSchema }) }),
]);

export const SettingsCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("settings"),
  type: z.literal("apply-settings"),
  target: z.strictObject({ expectedRevision: PositiveIntSchema }),
  payload: z.strictObject({
    settingsSchemaHash: FingerprintSchema,
    patchFingerprint: FingerprintSchema,
    patch: SettingsOverrideSchema,
  }),
});

const VersionScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflows"), workflowIds: z.array(WorkflowIdSchema).min(1) }),
  z.strictObject({ kind: z.literal("application"), applicationVersion: SemverSchema }),
]);

export const VersionArchiveCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("plan-version-bump"),
    target: z.strictObject({ scope: VersionScopeSchema }),
    payload: z.strictObject({ targetVersion: SemverSchema, changeFingerprint: FingerprintSchema }),
  }),
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("apply-version-bump"),
    target: z.strictObject({ versionPlanId: VersionPlanIdSchema, expectedVersion: PositiveIntSchema }),
    payload: z.strictObject({ planFingerprint: FingerprintSchema }),
  }),
  z.strictObject({
    ...CommandEnvelopeFields,
    family: z.literal("version-archive"),
    type: z.literal("relaunch-archived-run"),
    target: z.strictObject({ archivedRunId: RunIdSchema, archiveFingerprint: FingerprintSchema }),
  }),
]);

export const RunCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.enum(["retry", "cancel", "bump", "hide", "unhide"]), target: RunVersionTargetSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("rename"), target: RunVersionTargetSchema, payload: z.strictObject({ displayName: RunDisplayNameSchema }) }),
  // D166: doc 06 §6.3's field-level patch model. The earlier whole-checkpoint
  // blob payload was a deferred-arm placeholder no producer ever sent.
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("edit-checkpoint"), target: RunVersionTargetSchema, payload: z.strictObject({ patches: z.array(CheckpointPatchSchema).min(1) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-present"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema }), payload: z.strictObject({ proof: SchemaBoundCanonicalValueSchema, evidenceNote: OperatorReasonSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("run"), type: z.literal("resolve-write-absent"), target: z.strictObject({ ...RunVersionTargetSchema.shape, writeIntentId: WriteIntentIdSchema, intentGeneration: PositiveIntSchema }), payload: z.strictObject({ evidenceNote: OperatorReasonSchema }) }),
]);

export const GateCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("gate"),
  type: z.literal("resolve-gate"),
  target: z.strictObject({ runId: RunIdSchema, gateId: GateIdSchema, expectedVersion: PositiveIntSchema }),
  payload: z.strictObject({ result: SchemaBoundCanonicalValueSchema }),
});

export const NotificationCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.enum(["notification-read", "notification-unread"]), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("notification"), type: z.literal("notification-snooze"), target: z.strictObject({ notificationId: NotificationIdSchema, actorId: ActorIdSchema, expectedVersion: PositiveIntSchema }), payload: z.strictObject({ until: IsoInstantSchema }) }),
]);

// D167: the WHOLE ArtifactRef, not an id+fingerprint pair — D161 recorded
// why: a reduced identity names bytes nobody can resolve. This was a
// deferred-arm placeholder; no producer ever sent the old shape.
const CapturePhotoPayloadSchema = z.strictObject({
  photoId: CapturePhotoIdSchema,
  artifact: ArtifactRefSchema,
  originalMediaType: z.string().min(1),
});

export const CaptureCommandRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.enum(["capture-upload", "capture-replace"]), target: CaptureVersionTargetSchema, payload: CapturePhotoPayloadSchema }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.literal("capture-reorder"), target: CaptureVersionTargetSchema, payload: z.strictObject({ orderedPhotoIds: z.array(CapturePhotoIdSchema).min(1) }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.literal("capture-delete"), target: CaptureVersionTargetSchema, payload: z.strictObject({ photoId: CapturePhotoIdSchema }) }),
  z.strictObject({ ...CommandEnvelopeFields, family: z.literal("capture"), type: z.enum(["capture-finalize", "capture-retry-finalize", "capture-discard"]), target: CaptureVersionTargetSchema }),
]);

export const CommandRequestSchema = z.union([
  StartCommandRequestSchema,
  IntakeCommandRequestSchema,
  WorkerBrowserCommandRequestSchema,
  SettingsCommandRequestSchema,
  VersionArchiveCommandRequestSchema,
  RunCommandRequestSchema,
  GateCommandRequestSchema,
  NotificationCommandRequestSchema,
  CaptureCommandRequestSchema,
]);

export const CommandTargetReferenceSchema = z.discriminatedUnion("family", [
  z.strictObject({
    family: z.literal("start"),
    workflowId: WorkflowIdSchema,
    startPlanId: StartPlanIdSchema,
    expectedVersion: PositiveIntSchema,
  }),
  z.strictObject({ family: z.literal("intake"), intakeSessionId: IntakeSessionIdSchema }),
  z.strictObject({ family: z.literal("worker-browser"), workerId: WorkerIdSchema }),
  z.strictObject({ family: z.literal("settings"), revision: PositiveIntSchema }),
  z.strictObject({ family: z.literal("version-archive"), versionPlanId: VersionPlanIdSchema }),
  z.strictObject({ family: z.literal("run"), runId: RunIdSchema }),
  z.strictObject({ family: z.literal("gate"), runId: RunIdSchema, gateId: GateIdSchema }),
  z.strictObject({ family: z.literal("notification"), notificationId: NotificationIdSchema }),
  z.strictObject({ family: z.literal("capture"), captureSessionId: CaptureSessionIdSchema }),
]);

export const CommandRejectionCodeSchema = z.enum([
  "invalid-state",
  "target-not-found",
  "authority-unavailable",
  "policy-refused",
  "schema-mismatch",
  "active-version-blockers",
  /**
   * D113: the arm is schema-recognized but its owning later milestone has not
   * activated it. This result is computed with ZERO authority side effects —
   * no journal row, no audit row, no generation advance.
   */
  "capability-unavailable",
]);

export const CommandResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["applied", "already-applied"]), commandId: CommandIdSchema, affectedTargets: z.array(CommandTargetReferenceSchema).min(1) }),
  z.strictObject({ state: z.literal("conflict"), commandId: CommandIdSchema, currentVersion: PositiveIntSchema, message: z.string().min(1) }),
  z.strictObject({ state: z.literal("rejected"), commandId: CommandIdSchema, code: CommandRejectionCodeSchema, message: z.string().min(1) }),
]);

export const CommandAuditRecordSchema = z.strictObject({
  auditId: CommandAuditIdSchema,
  request: CommandRequestSchema,
  result: CommandResultSchema,
  completedAt: IsoInstantSchema,
  versionChanges: z.array(z.strictObject({ target: CommandTargetReferenceSchema, before: PositiveIntSchema, after: PositiveIntSchema })),
  affectedDependencyIds: z.array(DependencyIdSchema),
});

export const BulkRunCommandRequestSchema = z.strictObject({
  ...CommandEnvelopeFields,
  family: z.literal("run"),
  type: z.enum(["retry", "cancel", "bump", "hide", "unhide"]),
  bulkCommandId: CommandIdSchema,
  targets: z.array(RunVersionTargetSchema).min(1),
  mode: z.enum(["all-or-none", "best-effort"]),
});

export const CommandFamilySpecSchema = z.strictObject({
  family: CommandFamilySchema,
  actions: z.array(CommandActionSchema).min(1),
});

const COMMAND_ACTIONS_BY_FAMILY = {
  start: ["start-run"],
  intake: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"],
  "worker-browser": ["plan-worker-count", "spawn-worker", "stop-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"],
  settings: ["apply-settings"],
  "version-archive": ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"],
  run: ["retry", "cancel", "bump", "rename", "hide", "unhide", "edit-checkpoint", "resolve-write-present", "resolve-write-absent"],
  gate: ["resolve-gate"],
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  capture: ["capture-upload", "capture-replace", "capture-reorder", "capture-delete", "capture-finalize", "capture-retry-finalize", "capture-discard"],
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
      context.addIssue({ code: "custom", path: [entries.indexOf(entry), "actions"], message: `${family} command actions do not match D95` });
    }
  }
});

export const COMMAND_FAMILY_REGISTRY = deepFreeze(CommandFamilyRegistrySchema.parse([
  { family: "start", actions: ["start-run"] },
  { family: "intake", actions: ["inspect-intake", "confirm-intake-mapping", "correct-intake-row", "exclude-intake-row", "validate-intake", "enqueue-intake-manifest"] },
  { family: "worker-browser", actions: ["plan-worker-count", "spawn-worker", "stop-worker", "pause-worker", "resume-worker", "refresh-browser", "reopen-browser"] },
  { family: "settings", actions: ["apply-settings"] },
  { family: "version-archive", actions: ["plan-version-bump", "apply-version-bump", "relaunch-archived-run"] },
  { family: "run", actions: ["retry", "cancel", "bump", "rename", "hide", "unhide", "edit-checkpoint", "resolve-write-present", "resolve-write-absent"] },
  { family: "gate", actions: ["resolve-gate"] },
  { family: "notification", actions: ["notification-read", "notification-unread", "notification-snooze"] },
  { family: "capture", actions: ["capture-upload", "capture-replace", "capture-reorder", "capture-delete", "capture-finalize", "capture-retry-finalize", "capture-discard"] },
]));

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type CommandAuditRecord = z.infer<typeof CommandAuditRecordSchema>;
export type RunDisplayName = z.infer<typeof RunDisplayNameSchema>;
